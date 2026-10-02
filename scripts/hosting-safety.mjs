import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

export const PROJECT = 'mykeyword-a832f';
export const SITE = 'mykeyword-a832f';
export const REPOSITORY = 'BoscoHeo1/StudentKeyword';
export const CLI_VERSION = '15.32.0';
export const HOSTING_SA = `studentkeyword-hosting-deploy@${PROJECT}.iam.gserviceaccount.com`;
export const MARKERS = ['CLASS_NOT_FOUND', '/api/classes/create', 'confirmCreate', '새 학급으로 생성할까요?'];
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function keys(object, allowed, label) {
  assert(object && typeof object === 'object' && !Array.isArray(object), `${label}: object required`);
  for (const key of Object.keys(object)) assert(allowed.includes(key), `${label}: unexpected ${key}`);
}

export function validateConfig(config, rc) {
  keys(config, ['hosting'], 'firebase.json');
  const h = config.hosting;
  keys(h, ['public', 'ignore', 'headers', 'rewrites'], 'hosting');
  assert.equal(h.public, 'dist');
  assert.deepEqual(h.rewrites, [
    { source: '/api/**', run: { serviceId: 'studentkeyword-api', region: 'asia-northeast3' } },
    { source: '**', destination: '/index.html' },
  ], 'rewrites must remain unpinned Cloud Run then SPA; no Functions/framework');
  assert.deepEqual(h.headers, [
    { source: '/', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    { source: '/index.html', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    { source: '/api/**', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
  ], 'cache headers changed');
  assert.deepEqual(h.ignore, ['firebase.json', '**/.*', '**/node_modules/**', '**/*.map', 'server.cjs', 'server.cjs.map']);
  assert.deepEqual(rc, { projects: { default: PROJECT } });
}

export function validateSource({ repository, ref, event, sha, confirmSha, head, main, clean, run }) {
  assert.equal(repository, REPOSITORY);
  assert.equal(ref, 'refs/heads/main');
  assert.equal(event, 'workflow_dispatch');
  assert.match(sha || '', /^[a-f0-9]{40}$/);
  for (const value of [confirmSha, head, main]) assert.equal(value, sha, 'SHA mismatch');
  assert.equal(clean, true, 'tracked checkout changed');
  assert.equal(run?.name, 'Verify source', 'missing Verify source');
  assert.equal(run?.path, '.github/workflows/verify.yml');
  assert.equal(run?.head_sha, sha);
  assert.equal(run?.head_branch, 'main');
  assert.equal(run?.event, 'push');
  assert.equal(run?.status, 'completed');
  assert.equal(run?.conclusion, 'success');
  for (const name of ['Build and regression', 'Gitleaks']) {
    assert(run.jobs?.some((j) => j.name === name && j.status === 'completed' && j.conclusion === 'success'), `missing successful ${name}`);
  }
}

export function assertMarkers(text) {
  for (const marker of MARKERS) assert(text.includes(marker), `missing Phase 3A marker: ${marker}`);
}

export function assetPaths(html) {
  const paths = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1]).filter((p) => /\.(?:js|css)(?:\?|$)/.test(p));
  assert(paths.some((p) => p.endsWith('.js')), 'HTML has no JS entry');
  for (const path of paths) assert.match(path, /^\/assets\/[A-Za-z0-9_.-]+\.(?:js|css)$/, 'unexpected asset URL');
  return [...new Set(paths)];
}

export function artifactManifest(root) {
  const dist = resolve(root, 'dist');
  const files = [];
  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const file = join(dir, name);
      const stat = lstatSync(file);
      assert(!stat.isSymbolicLink(), 'symlink in dist');
      const path = '/' + relative(dist, file).split(sep).join('/');
      assert(!/(?:^|\/)(?:\.|node_modules|server-dist|data)/.test(path), 'forbidden public path');
      if (stat.isDirectory()) walk(file);
      else {
        assert(/\.(?:html|js|css|svg|png|ico|jpg|jpeg|webp|woff2?|txt)$/.test(name), 'unexpected public file');
        const bytes = readFileSync(file);
        files.push({ path, sha256: hash(bytes), size: bytes.length });
      }
    }
  }
  walk(dist);
  assert(files.some((f) => f.path === '/index.html'), 'missing index.html');
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  for (const path of assetPaths(html)) assert(files.some((f) => f.path === path), `missing ${path}`);
  assertMarkers(files.filter((f) => f.path.endsWith('.js')).map((f) => readFileSync(join(dist, f.path.slice(1)), 'utf8')).join('\n'));
  return { algorithm: 'sha256-uncompressed', files };
}

export function validateLive(channel) {
  assert.equal(channel.name, `sites/${SITE}/channels/live`);
  const r = channel.release;
  assert.match(r?.name || '', new RegExp(`^sites/${SITE}/(?:channels/live/)?releases/[A-Za-z0-9_-]+$`), 'missing live release');
  assert.match(r.version?.name || '', new RegExp(`^sites/${SITE}/versions/[A-Za-z0-9_-]+$`));
  assert.equal(r.version.status, 'FINALIZED', 'version not retained/finalized');
  assert(Number.isFinite(Date.parse(r.releaseTime)), 'missing release time');
  // An unpinned API rewrite is essential for Hosting-only rollback.
  assert.deepEqual(r.version.config?.rewrites, [
    { glob: '/api/**', run: { serviceId: 'studentkeyword-api', region: 'asia-northeast3' } },
    { glob: '**', path: '/index.html' },
  ], 'live rewrite differs from safe unpinned configuration');
  return r;
}

export function sameRelease(a, b) {
  return a.name === b.name && a.version.name === b.version.name;
}

export function assertCandidate(live, version, message, started) {
  assert.equal(live.version.name, version, 'live version mismatch');
  assert.equal(live.message, message, 'release message mismatch');
  assert(Date.parse(live.releaseTime) >= started, 'release predates this deployment');
}

export function assertExclusiveHistory(releases, previous, candidate) {
  const index = releases.findIndex((r) => r.name === previous.name);
  assert(index >= 0, 'previous release absent from bounded history; cannot exclude concurrency');
  const intervening = releases.slice(0, index);
  assert.equal(intervening.length, 1, 'concurrent Hosting deployment detected');
  assert.equal(intervening[0].name, candidate.name, 'foreign Hosting release detected');
  assert.equal(intervening[0].version.name, candidate.version.name);
}
