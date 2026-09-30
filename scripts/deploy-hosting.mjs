import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  PROJECT, SITE, REPOSITORY, CLI_VERSION, HOSTING_SA, hash, assetPaths,
  validateConfig, validateSource, artifactManifest, validateLive,
  sameRelease, assertCandidate, assertExclusiveHistory,
} from './hosting-safety.mjs';

const API = 'https://firebasehosting.googleapis.com/v1beta1/';
const ORIGIN = `https://${SITE}.web.app`;

export function sanitizeEvidence(value) {
  if (Array.isArray(value)) return value.map(sanitizeEvidence);
  if (!value || typeof value !== 'object') return value;
  if (value.version?.name && typeof value.name === 'string') {
    return { name: value.name, message: value.message, releaseTime: value.releaseTime,
      version: { name: value.version.name, status: value.version.status } };
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['releaseUser', 'createUser', 'finalizeUser', 'deleteUser', 'labels'].includes(key))
    .map(([key, item]) => [key, sanitizeEvidence(item)]));
}

function defaultCommand(binary, args, options = {}) {
  // Never echo command stderr: auth/CLI debug output can contain credentials.
  try { return execFileSync(binary, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options }); }
  catch { throw new Error(`Command failed: ${binary.split(/[\\/]/).at(-1)} ${args[0] || ''}; raw output withheld`); }
}

export function realAdapter(root, env, dependencies = {}) {
  const command = dependencies.command || defaultCommand;
  const fetch = dependencies.fetch || globalThis.fetch;
  let accessToken;
  async function json(url, method = 'GET', body) {
    if (!accessToken) accessToken = command('gcloud', ['auth', 'print-access-token']).trim();
    const response = await fetch(url, {
      method, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
    });
    assert(response.ok, `Hosting API ${method} failed: HTTP ${response.status}`);
    return response.json();
  }
  async function live() {
    const channel = await json(`${API}sites/${SITE}/channels/live`);
    assert.match(channel.release?.version?.name || '', new RegExp(`^sites/${SITE}/versions/[A-Za-z0-9_-]+$`));
    channel.release.version = await json(`${API}${channel.release.version.name}`);
    return validateLive(channel);
  }
  async function content(path) {
    assert(path === '/' || /^\/[A-Za-z0-9_./-]+$/.test(path), 'unexpected public path');
    assert(!path.includes('..'));
    const response = await fetch(`${ORIGIN}${path}?verify=${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`, {
      cache: 'no-store', headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200, `public ${path}: expected 200`);
    return Buffer.from(await response.arrayBuffer());
  }
  return {
    config: () => {
      validateConfig(JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8')), JSON.parse(readFileSync(join(root, '.firebaserc'), 'utf8')));
    },
    source: () => {
      const main = JSON.parse(command('gh', ['api', `repos/${REPOSITORY}/commits/main`])).sha;
      const result = JSON.parse(command('gh', ['api', '-X', 'GET', `repos/${REPOSITORY}/actions/workflows/verify.yml/runs`,
        '-f', `head_sha=${env.GITHUB_SHA}`, '-f', 'branch=main', '-f', 'event=push', '-f', 'per_page=100']));
      const runs = result.workflow_runs.filter((r) => r.head_sha === env.GITHUB_SHA && r.event === 'push' && r.head_branch === 'main');
      const run = runs.sort((a, b) => b.id - a.id)[0];
      if (run) {
        // Check the latest attempt, not a previously successful attempt.
        const current = JSON.parse(command('gh', ['api', `repos/${REPOSITORY}/actions/runs/${run.id}`]));
        Object.assign(run, current);
        const pages = JSON.parse(command('gh', ['api', '--paginate', '--slurp',
          `repos/${REPOSITORY}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`]));
        run.jobs = pages.flatMap((p) => p.jobs);
      }
      validateSource({ repository: env.GITHUB_REPOSITORY, ref: env.GITHUB_REF, event: env.GITHUB_EVENT_NAME,
        sha: env.GITHUB_SHA, confirmSha: env.CONFIRM_SHA, head: command('git', ['rev-parse', 'HEAD'], { cwd: root }).trim(),
        main, clean: command('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root }).trim() === '', run });
      return { sha: env.GITHUB_SHA, verifyRunId: run.id, verifyAttempt: run.run_attempt };
    },
    project: async () => {
      const site = await json(`${API}projects/${PROJECT}/sites/${SITE}`);
      assert([`projects/${PROJECT}/sites/${SITE}`, `projects/783209447753/sites/${SITE}`].includes(site.name), 'unexpected Hosting project/site');
      assert.equal(site.defaultUrl, ORIGIN);
    },
    live,
    history: async (previous) => {
      const all = [];
      let token = '';
      for (let page = 0; page < 10; page++) {
        const result = await json(`${API}sites/${SITE}/channels/live/releases?pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
        all.push(...(result.releases || []));
        if (all.some((r) => r.name === previous.name)) return all;
        token = result.nextPageToken;
        if (!token) break;
      }
      throw new Error('Cannot find previous release in live history; concurrency cannot be excluded');
    },
    snapshot: async () => {
      const html = await content('/');
      const files = [{ path: '/index.html', sha256: hash(html), size: html.length }];
      for (const path of assetPaths(html.toString('utf8'))) {
        const bytes = await content(path);
        files.push({ path, sha256: hash(bytes), size: bytes.length });
      }
      return { algorithm: 'sha256-uncompressed', files };
    },
    build: () => {
      assert(!existsSync(join(root, 'dist')), 'pre-existing dist forbidden; use a clean checkout');
      command('npm', ['ci', '--no-audit', '--no-fund'], { cwd: root });
      command('npm', ['run', 'lint'], { cwd: root });
      command('node', ['--test', 'tests/frontend-class-auth.mjs', 'tests/hosting-regression.mjs'], { cwd: root });
      command('npm', ['run', 'build'], { cwd: root });
      return artifactManifest(root);
    },
    deploy: () => {
      const cli = join(root, 'tools/hosting-cli/node_modules/.bin/firebase');
      assert.equal(command(cli, ['--version'], { cwd: root }).trim(), CLI_VERSION);
      assert(!env.FIREBASE_TOKEN && !env.GOOGLE_CREDENTIALS, 'legacy/key authentication forbidden');
      const output = JSON.parse(command(cli, ['deploy', '--only', 'hosting', '--project', PROJECT, '--non-interactive', '--json',
        '--message', `sha=${env.GITHUB_SHA} run=${env.GITHUB_RUN_ID} attempt=${env.GITHUB_RUN_ATTEMPT}`], { cwd: root }));
      assert.equal(output.status, 'success', 'Firebase CLI did not report success');
      assert.match(output.result?.hosting || '', new RegExp(`^sites/${SITE}/versions/[A-Za-z0-9_-]+$`), 'CLI must identify this deployment version');
      return output.result.hosting;
    },
    smoke: async (manifest, checkApi) => {
      // Every expected file is fetched; no auth/create/student mutation endpoints.
      for (const file of manifest.files) {
        const bytes = await content(file.path === '/index.html' ? '/' : file.path);
        assert.equal(hash(bytes), file.sha256, `live hash mismatch: ${file.path}`);
      }
      if (checkApi) {
        const response = await fetch(`${ORIGIN}/api/config`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
        assert.equal(response.status, 410, '/api/config: expected 410');
      }
    },
    rollback: async (previous, message) => json(`${API}sites/${SITE}/channels/live/releases?versionName=${encodeURIComponent(previous.version.name)}`,
      'POST', { message }),
    wait: () => new Promise((done) => setTimeout(done, 2000)),
  };
}

export async function verifyFiles(adapter, manifest, checkApi) {
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    try { await adapter.smoke(manifest, checkApi); return; }
    catch (error) { last = error; if (attempt < 5) await adapter.wait(); }
  }
  throw last;
}

export async function runHosting(adapter, env, record = () => {}) {
  assert(['validate', 'deploy'].includes(env.MODE), 'only validate/deploy modes allowed');
  adapter.config();
  const source = adapter.source();
  await adapter.project();
  const previous = await adapter.live();
  record('previous', { source, release: previous });
  if (env.MODE === 'validate') return { mode: 'validate', source, previous };
  assert.equal(env.HOSTING_DEPLOY_ENABLED, 'true', 'deployment disabled until identity and environment review');
  assert.equal(env.HOSTING_SERVICE_ACCOUNT, HOSTING_SA, 'unexpected Hosting identity');
  assert.match(env.GITHUB_RUN_ID || '', /^\d+$/);
  assert.match(env.GITHUB_RUN_ATTEMPT || '', /^\d+$/);
  const beforeFiles = await adapter.snapshot();
  assert(sameRelease(previous, await adapter.live()), 'live changed during baseline snapshot');
  record('previous-files', beforeFiles);
  const artifact = await adapter.build();
  record('artifact', { source, ...artifact });
  adapter.config();
  adapter.source();
  assert(sameRelease(previous, await adapter.live()), 'concurrent Hosting deployment before publish');
  const message = `sha=${env.GITHUB_SHA} run=${env.GITHUB_RUN_ID} attempt=${env.GITHUB_RUN_ATTEMPT}`;
  const started = Date.now();
  let candidate;
  const version = await adapter.deploy();
  record('cli-version', { version, message, started });
  try {
    candidate = await adapter.live();
    assertCandidate(candidate, version, message, started);
    record('candidate', { source, release: candidate });
    assertExclusiveHistory(await adapter.history(previous), previous, candidate);
    await verifyFiles(adapter, artifact, true);
    const final = await adapter.live();
    assertCandidate(final, version, message, started);
    assert(sameRelease(final, candidate), 'live release changed during smoke');
    assertExclusiveHistory(await adapter.history(previous), previous, candidate);
    record('result', { status: 'verified', source, release: final, previous });
    return { mode: 'deploy', source, release: final, previous };
  } catch (error) {
    const result = { status: 'failed', reason: error.message, version, previous };
    // Never restore over a release owned by another run or an intervening deployment.
    try {
      const live = await adapter.live();
      assertCandidate(live, version, message, started);
      assert(candidate && sameRelease(live, candidate), 'candidate ownership not established; manual inspection required');
      assertExclusiveHistory(await adapter.history(previous), previous, candidate);
    } catch (guardError) {
      result.rollback = `not attempted: ${guardError.message}`;
      record('result', result);
      throw new Error(`Hosting failed: ${error.message}; rollback ${result.rollback}`);
    }
    try {
      const rollback = await adapter.rollback(previous, `rollback ${message}`);
      const restored = await adapter.live();
      assert.equal(restored.name, rollback.name, 'rollback release mismatch');
      assert.equal(restored.message, `rollback ${message}`, 'rollback message mismatch');
      assert.equal(restored.version.name, previous.version.name, 'rollback live version mismatch');
      const history = await adapter.history(previous);
      assert.equal(history[0].name, restored.name);
      assert.equal(history[1]?.name, candidate.name, 'concurrent deployment during rollback');
      assert.equal(history[2]?.name, previous.name, 'unexpected rollback history');
      await verifyFiles(adapter, beforeFiles, false);
      assert(sameRelease(restored, await adapter.live()), 'live changed during rollback verification');
      result.rollback = 'verified: previous version and entrypoint/JS/CSS hashes restored';
    } catch (rollbackError) {
      result.rollback = `FAILED: ${rollbackError.message}; manual recovery required`;
    }
    record('result', result);
    throw new Error(`Hosting failed: ${error.message}; rollback ${result.rollback}`);
  }
}

async function main() {
  const root = process.cwd();
  const env = { ...process.env, MODE: process.argv[2] };
  const adapter = realAdapter(root, env);
  if (env.MODE === 'source') { adapter.config(); console.log(JSON.stringify(adapter.source())); return; }
  if (env.MODE === 'artifact') { console.log(JSON.stringify(artifactManifest(root), null, 2)); return; }
  const output = resolve(env.RUNNER_TEMP || '/tmp', 'studentkeyword-hosting-evidence');
  mkdirSync(output, { recursive: true });
  const result = await runHosting(adapter, env, (name, data) => {
    writeFileSync(join(output, `${name}.json`), JSON.stringify(sanitizeEvidence(data), null, 2) + '\n');
  });
  console.log(JSON.stringify(sanitizeEvidence(result), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
