import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PROJECT, SITE, HOSTING_SA, MARKERS, CLI_VERSION, validateConfig, validateSource,
  artifactManifest, validateLive, hash,
} from '../scripts/hosting-safety.mjs';
import { runHosting, realAdapter, sanitizeEvidence } from '../scripts/deploy-hosting.mjs';
import { HostingCliError, sanitizeCliFailure, versionObservation } from '../scripts/hosting-diagnostics.mjs';

const config = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url)));
const rc = JSON.parse(readFileSync(new URL('../.firebaserc', import.meta.url)));
const sha = 'a'.repeat(40);
const env = {
  MODE: 'deploy', GITHUB_SHA: sha, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1',
  HOSTING_DEPLOY_ENABLED: 'true', HOSTING_SERVICE_ACCOUNT: HOSTING_SA,
};
const message = `sha=${sha} run=123 attempt=1`;
const rewrites = [
  { glob: '/api/**', run: { serviceId: 'studentkeyword-api', region: 'asia-northeast3' } },
  { glob: '**', path: '/index.html' },
];
function release(id, version, msg = message) {
  return { name: `sites/${SITE}/channels/live/releases/${id}`, message: msg,
    releaseTime: new Date(Date.now() + 2000).toISOString(),
    version: { name: `sites/${SITE}/versions/${version}`, status: 'FINALIZED', config: { rewrites } } };
}
function fixture(overrides = {}) {
  const old = release('old', 'v0', 'previous');
  let live = old, history = [old];
  const calls = [], records = {};
  const candidate = release('candidate', 'v1');
  const artifact = { files: [{ path: '/index.html', sha256: hash('new') }] };
  const previousFiles = { files: [{ path: '/index.html', sha256: hash('old') }] };
  const adapter = {
    config: () => { calls.push('config'); validateConfig(config, rc); },
    source: () => { calls.push('source'); return { sha }; },
    project: async () => { calls.push('project'); },
    live: async () => { calls.push('live'); return live; },
    cloudRunRead: async () => { calls.push('cloud-run-read'); return { status: 'verified' }; },
    history: async () => history,
    snapshot: async () => { calls.push('snapshot'); return previousFiles; },
    build: async () => { calls.push('build'); return artifact; },
    deploy: async () => { calls.push('deploy'); live = candidate; history = [candidate, old]; return candidate.version.name; },
    smoke: async (files, api) => { calls.push(api ? 'smoke' : 'rollback-smoke'); },
    rollback: async (previous, msg) => {
      calls.push('rollback'); const r = release('restored', 'v0', msg); live = r; history = [r, candidate, old]; return r;
    },
    wait: async () => {},
    ...overrides,
  };
  const execute = (mode = 'deploy') => runHosting(adapter, { ...env, MODE: mode }, (name, data) => { records[name] = data; });
  return { old, candidate, artifact, previousFiles, adapter, calls, records, execute,
    setLive: (r) => { live = r; }, setHistory: (r) => { history = r; } };
}

test('current Hosting config is safe', () => validateConfig(config, rc));
for (const [name, change] of [
  ['Firestore product', (c) => { c.firestore = { rules: 'firestore.rules' }; }],
  ['Functions product', (c) => { c.functions = {}; }],
  ['Storage product', (c) => { c.storage = {}; }],
  ['pinTag', (c) => { c.hosting.rewrites[0].run.pinTag = true; }],
  ['Functions rewrite', (c) => { c.hosting.rewrites[0] = { source: '/api/**', function: 'api' }; }],
  ['framework deployment', (c) => { c.hosting.source = '.'; }],
  ['predeploy hook', (c) => { c.hosting.predeploy = ['echo unsafe']; }],
  ['postdeploy hook', (c) => { c.hosting.postdeploy = ['echo unsafe']; }],
  ['wrong public directory', (c) => { c.hosting.public = '.'; }],
  ['wrong API service', (c) => { c.hosting.rewrites[0].run.serviceId = 'other'; }],
  ['wrong region', (c) => { c.hosting.rewrites[0].run.region = 'us-central1'; }],
  ['missing SPA fallback', (c) => { c.hosting.rewrites.pop(); }],
  ['changed cache', (c) => { c.hosting.headers = []; }],
  ['removed source map exclusion', (c) => { c.hosting.ignore = []; }],
]) test(`reject unsafe config: ${name}`, () => {
  const unsafe = structuredClone(config); change(unsafe); assert.throws(() => validateConfig(unsafe, rc));
});
test('wrong Firebase project is rejected', () => assert.throws(() => validateConfig(config, { projects: { default: 'other' } })));

function source() {
  return { repository: 'BoscoHeo1/StudentKeyword', ref: 'refs/heads/main', event: 'workflow_dispatch',
    sha, head: sha, main: sha, confirmSha: sha, clean: true,
    run: { name: 'Verify source', path: '.github/workflows/verify.yml', head_sha: sha, head_branch: 'main', event: 'push',
      status: 'completed', conclusion: 'success', jobs: ['Build and regression', 'Gitleaks'].map((name) => ({ name, status: 'completed', conclusion: 'success' })) } };
}
test('exact SHA with successful main CI is accepted', () => validateSource(source()));
for (const key of ['sha', 'head', 'main', 'confirmSha']) test(`wrong ${key} blocked`, () => {
  const s = source(); s[key] = 'b'.repeat(40); assert.throws(() => validateSource(s));
});
for (const key of ['repository', 'ref', 'event', 'clean']) test(`wrong ${key} blocked`, () => {
  const s = source(); s[key] = key === 'clean' ? false : 'unexpected'; assert.throws(() => validateSource(s));
});
test('missing Verify source blocked', () => { const s = source(); delete s.run; assert.throws(() => validateSource(s)); });
test('successful PR CI cannot substitute for main push CI', () => {
  const s = source(); s.run.event = 'pull_request'; assert.throws(() => validateSource(s));
});
test('failed or incomplete required CI jobs blocked', () => {
  for (const field of ['conclusion', 'status']) { const s = source(); s.run.jobs[0][field] = 'failure'; assert.throws(() => validateSource(s)); }
});
test('wrong Verify source SHA blocked', () => { const s = source(); s.run.head_sha = 'b'.repeat(40); assert.throws(() => validateSource(s)); });

function dist(content = MARKERS.join('\n')) {
  const root = mkdtempSync(join(tmpdir(), 'studentkeyword-hosting-test-'));
  mkdirSync(join(root, 'dist/assets'), { recursive: true });
  writeFileSync(join(root, 'dist/index.html'), '<script type="module" src="/assets/index-test.js"></script><link rel="stylesheet" href="/assets/index-test.css">');
  writeFileSync(join(root, 'dist/assets/index-test.js'), content);
  writeFileSync(join(root, 'dist/assets/index-test.css'), 'body {}');
  return root;
}
test('artifact manifest records all new-build file hashes', () => {
  const root = dist(); try { const m = artifactManifest(root); assert.equal(m.files.length, 3); assert(m.files.every((f) => /^[a-f0-9]{64}$/.test(f.sha256))); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
for (const marker of MARKERS) test(`artifact missing ${marker} is rejected`, () => {
  const root = dist(MARKERS.filter((m) => m !== marker).join('\n'));
  try { assert.throws(() => artifactManifest(root), /missing Phase 3A marker/); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
test('server/source map/credential artifact files are rejected', () => {
  const root = dist(); try {
    for (const path of ['server.cjs', 'index.js.map', 'credentials.json', '.env']) {
      writeFileSync(join(root, 'dist', path), 'unsafe'); assert.throws(() => artifactManifest(root)); rmSync(join(root, 'dist', path));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('live lookup requires safe finalized version and correct site', () => {
  const r = release('old', 'v0'); validateLive({ name: `sites/${SITE}/channels/live`, release: r });
  assert.throws(() => validateLive({ name: 'sites/other/channels/live', release: r }));
  assert.throws(() => validateLive({ name: `sites/${SITE}/channels/live`, release: { ...r, version: { ...r.version, status: 'DELETED' } } }));
});

test('validate performs reads only, with no build/snapshot/deploy/rollback', async () => {
  const f = fixture(); const result = await f.execute('validate'); assert.equal(result.mode, 'validate');
  assert(!f.calls.some((c) => ['build', 'snapshot', 'deploy', 'rollback'].includes(c)));
});
test('verified candidate and matching live files succeed', async () => {
  const f = fixture(); const result = await f.execute(); assert.equal(result.release.name, f.candidate.name);
  assert.equal(f.records.result.status, 'verified'); assert(!f.calls.includes('rollback'));
  assert.equal(f.calls.filter((c) => c === 'source').length, 2);
});
test('unexpected product/deploy mode rejected before any adapter call', async () => {
  const f = fixture(); await assert.rejects(f.execute('firestore'), /only validate\/deploy/); assert.equal(f.calls.length, 0);
});
test('deploy disabled by default', async () => {
  const f = fixture(); await assert.rejects(runHosting(f.adapter, { ...env, HOSTING_DEPLOY_ENABLED: '' }), /deployment disabled/);
  assert(!f.calls.includes('build')); assert(!f.calls.includes('deploy'));
});
test('unexpected deploy identity blocked', async () => {
  const f = fixture(); await assert.rejects(runHosting(f.adapter, { ...env, HOSTING_SERVICE_ACCOUNT: 'runtime' }), /unexpected Hosting identity/);
  assert(!f.calls.includes('deploy'));
});
test('main changed during build blocks publish', async () => {
  const f = fixture(); let n = 0;
  f.adapter.source = () => { if (++n === 2) throw new Error('SHA mismatch'); return { sha }; };
  await assert.rejects(f.execute(), /SHA mismatch/); assert(!f.calls.includes('deploy'));
});
test('concurrent deployment during build blocks publish', async () => {
  const f = fixture(); f.adapter.build = () => { f.setLive(release('foreign', 'v2')); return f.artifact; };
  await assert.rejects(f.execute(), /concurrent Hosting/); assert(!f.calls.includes('deploy'));
});
test('CLI failure never reports success or restores over an unknown release', async () => {
  const f = fixture(); f.adapter.deploy = () => { throw new Error('CLI failed'); };
  await assert.rejects(f.execute(), /Firebase CLI deploy failed/); assert(!f.calls.includes('rollback'));
});
test('release message mismatch fails without overwriting foreign release', async () => {
  const f = fixture(); const deploy = f.adapter.deploy;
  f.adapter.deploy = async () => { const v = await deploy(); f.setLive(release('foreign', 'v1', 'other run')); return v; };
  await assert.rejects(f.execute(), /release message mismatch/); assert(!f.calls.includes('rollback'));
});
test('CLI version/live version mismatch fails closed', async () => {
  const f = fixture(); const deploy = f.adapter.deploy;
  f.adapter.deploy = async () => { await deploy(); return `sites/${SITE}/versions/different`; };
  await assert.rejects(f.execute(), /live version mismatch/); assert(!f.calls.includes('rollback'));
});
test('concurrent deployment hidden behind our latest release is detected in history', async () => {
  const f = fixture(); const deploy = f.adapter.deploy;
  f.adapter.deploy = async () => { const v = await deploy(); f.setHistory([f.candidate, release('foreign', 'v2'), f.old]); return v; };
  await assert.rejects(f.execute(), /concurrent Hosting/); assert(!f.calls.includes('rollback'));
});
test('foreign live deployment after candidate smoke is never overwritten', async () => {
  const f = fixture(); f.adapter.smoke = async () => { f.setLive(release('foreign', 'v2', 'other run')); };
  await assert.rejects(f.execute(), /mismatch/); assert(!f.calls.includes('rollback'));
});
test('missing baseline history fails closed', async () => {
  const f = fixture(); f.adapter.history = async () => [f.candidate];
  await assert.rejects(f.execute(), /previous release absent/); assert(!f.calls.includes('rollback'));
});
test('own failed smoke rolls back and verifies old version and hashes but job still fails', async () => {
  const f = fixture(); f.adapter.smoke = async (files, api) => {
    if (api) throw new Error('live hash mismatch'); assert.deepEqual(files, f.previousFiles); f.calls.push('rollback-smoke');
  };
  await assert.rejects(f.execute(), /rollback verified/);
  assert(f.calls.includes('rollback-smoke')); assert.equal(f.records.result.status, 'failed');
});
test('rollback API failure explicitly fails', async () => {
  const f = fixture(); f.adapter.smoke = async () => { throw new Error('smoke failed'); };
  f.adapter.rollback = async () => { throw new Error('rollback API failed'); };
  await assert.rejects(f.execute(), /rollback FAILED: rollback API failed/);
});
test('rollback live version verification failure explicitly fails', async () => {
  const f = fixture(); f.adapter.smoke = async () => { throw new Error('smoke failed'); };
  f.adapter.rollback = async () => release('restored', 'v0', `rollback ${message}`);
  await assert.rejects(f.execute(), /rollback FAILED: rollback release mismatch/);
});
test('rollback content verification failure explicitly fails', async () => {
  const f = fixture(); f.adapter.smoke = async (files, api) => { throw new Error(api ? 'candidate failure' : 'old file hash mismatch'); };
  await assert.rejects(f.execute(), /rollback FAILED: old file hash mismatch/);
});
test('concurrent deployment during rollback fails verification', async () => {
  const f = fixture(); f.adapter.smoke = async (files, api) => { if (api) throw new Error('candidate failure'); };
  const rollback = f.adapter.rollback;
  f.adapter.rollback = async (...args) => { const r = await rollback(...args); f.setHistory([r, release('foreign', 'v2'), f.candidate, f.old]); return r; };
  await assert.rejects(f.execute(), /rollback FAILED: concurrent deployment/);
});

test('real CLI adapter passes only hosting/project/non-interactive and parses its exact version', () => {
  const calls = [];
  const adapter = realAdapter('/mock', env, { command: (binary, args) => {
    calls.push({ binary, args });
    return args[0] === '--version' ? CLI_VERSION : JSON.stringify({ status: 'success', result: { hosting: `sites/${SITE}/versions/v1` } });
  }, fetch: () => { throw new Error('network forbidden'); } });
  assert.equal(adapter.deploy(), `sites/${SITE}/versions/v1`);
  assert.deepEqual(calls[1].args, ['deploy', '--only', 'hosting', '--project', PROJECT, '--non-interactive', '--json', '--message', message]);
});
test('CLI without version result is rejected rather than guessing latest release', () => {
  const adapter = realAdapter('/mock', env, { command: (binary, args) => args[0] === '--version' ? CLI_VERSION : '{"status":"success"}' });
  assert.throws(() => adapter.deploy(), /CLI must identify/);
});
test('CLI version drift and legacy token are rejected', () => {
  const adapter = realAdapter('/mock', env, { command: () => '99.0.0' }); assert.throws(() => adapter.deploy());
  const withKey = realAdapter('/mock', { ...env, FIREBASE_TOKEN: 'test-only-legacy-token' }, { command: () => CLI_VERSION });
  assert.throws(() => withKey.deploy(), /authentication forbidden/);
});
test('Hosting project/live inspection uses GET only and fetches exact version', async () => {
  const calls = []; const old = release('old', 'v0');
  const adapter = realAdapter('/mock', env, {
    command: () => 'test-only-access-token',
    fetch: async (url, options) => {
      calls.push({ url, options }); assert.equal(options.method, 'GET');
      let body;
      if (url.endsWith(`/projects/${PROJECT}/sites/${SITE}`)) body = { name: `projects/${PROJECT}/sites/${SITE}`, defaultUrl: `https://${SITE}.web.app` };
      else if (url.endsWith('/channels/live')) body = { name: `sites/${SITE}/channels/live`, release: old };
      else if (url.endsWith('/versions/v0')) body = old.version;
      else throw new Error('unexpected API');
      return { ok: true, json: async () => body };
    },
  });
  await adapter.project(); assert.equal((await adapter.live()).version.name, old.version.name);
  assert.equal(calls.length, 3);
});
test('HTTP permissions/network errors fail closed', async () => {
  const adapter = realAdapter('/mock', env, { command: () => 'test-only-access-token', fetch: async () => ({ ok: false, status: 403 }) });
  await assert.rejects(adapter.project(), /HTTP 403/);
});
test('evidence retains release tracking without operator identities or arbitrary labels', () => {
  const r = release('old', 'v0'); r.releaseUser = { email: 'test-only-operator@example.invalid' };
  r.version.createUser = r.releaseUser; r.version.labels = { 'test-only-private-label': 'not-for-artifacts' };
  const cleaned = sanitizeEvidence({ previous: r });
  assert.equal(cleaned.previous.name, r.name); assert.equal(cleaned.previous.version.name, r.version.name);
  const output = JSON.stringify(cleaned); assert(!output.includes('operator')); assert(!output.includes('not-for-artifacts'));
});
test('isolated CLI package and lockfile pin Firebase 15.32.0', () => {
  const pkg = JSON.parse(readFileSync(new URL('../tools/hosting-cli/package.json', import.meta.url)));
  const lock = JSON.parse(readFileSync(new URL('../tools/hosting-cli/package-lock.json', import.meta.url)));
  assert.equal(pkg.dependencies['firebase-tools'], CLI_VERSION);
  assert.equal(lock.packages[''].dependencies['firebase-tools'], CLI_VERSION);
  assert.equal(lock.packages['node_modules/firebase-tools'].version, CLI_VERSION);
});
test('rollback adapter selects only the recorded Hosting version and does not set output-only type', async () => {
  const old = release('old', 'v0'); const calls = [];
  const adapter = realAdapter('/mock', env, {
    command: () => 'test-only-access-token',
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => old }; },
  });
  await adapter.rollback(old, 'rollback test'); assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].url, `https://firebasehosting.googleapis.com/v1beta1/sites/${SITE}/channels/live/releases?versionName=${encodeURIComponent(old.version.name)}`);
  assert.deepEqual(JSON.parse(calls[0].options.body), { message: 'rollback test' });
});
test('Hosting site lookup accepts the canonical project number but rejects other projects', async () => {
  for (const project of ['783209447753', 'other']) {
    const adapter = realAdapter('/mock', env, { command: () => 'test-only-access-token',
      fetch: async () => ({ ok: true, json: async () => ({ name: `projects/${project}/sites/${SITE}`, defaultUrl: `https://${SITE}.web.app` }) }) });
    if (project === '783209447753') await adapter.project();
    else await assert.rejects(adapter.project(), /unexpected Hosting project/);
  }
});

const sensitive = [
  'ya29.' + 'fixtureAccessValue', 'eyJfixture' + '.fixturePayload.fixtureSignature',
  'ghp_' + 'fixtureGithubValue', 'github_pat_' + 'fixtureGithubValue',
  'AIza' + 'fixtureApiKeyValue', '/runner/private/credential-file.json',
  'fixtureRefreshValue', 'fixturePrivateKeyValue', 'fixtureOpaqueValue',
];
function noSecrets(value) {
  const serialized = JSON.stringify(value);
  for (const secret of sensitive) assert(!serialized.includes(secret), `sensitive fixture escaped sanitizer`);
  assert(!serialized.includes('PRIVATE KEY'));
}

test('CLI JSON 403 preserves permission/status/code but discards token', () => {
  const d = sanitizeCliFailure({ status: 2, stdout: JSON.stringify({ status: 'error', error:
    `HTTP 403 PERMISSION_DENIED: Permission firebasehosting.sites.update denied. Bearer ${sensitive[0]}` }) });
  assert.deepEqual(d.httpStatus, [403]); assert.deepEqual(d.permissions, ['firebasehosting.sites.update']);
  assert.deepEqual(d.codes, ['PERMISSION_DENIED']); assert.equal(d.cliStatus, 'error');
  assert.equal(d.exitCode, 2); assert.equal(d.parsedJson, true); noSecrets(d);
});
test('nested error/context/body JSON keeps only diagnostic facts', () => {
  const d = sanitizeCliFailure({ stdout: JSON.stringify({ status: 'error', error: { context: { body: JSON.stringify({
    error: { code: 403, status: 'PERMISSION_DENIED', message: 'firebasehosting.sites.update',
      details: [{ permission: 'firebase.projects.get', resource: `sites/${SITE}/versions/123` }],
      credentials: { private_key: sensitive[7] }, env: { SECRET: sensitive[8] } } }) } } }) });
  assert.deepEqual(d.httpStatus, [403]); assert.deepEqual(d.resources, [`sites/${SITE}/versions/123`]);
  assert(d.permissions.includes('firebase.projects.get')); noSecrets(d);
});
test('non-JSON stderr extracts safe lines without dumping unknown lines', () => {
  const d = sanitizeCliFailure({ stderr: `noise ${sensitive[8]}\nHTTP 403 PERMISSION_DENIED\nfirebasehosting.sites.update\nBearer ${sensitive[0]}` });
  assert.equal(d.parsedJson, false); assert.deepEqual(d.httpStatus, [403]); noSecrets(d);
});
for (const [label, raw] of [
  ['API key', `HTTP 403 https://firebasehosting.googleapis.com/v1beta1/sites/${SITE}/versions/123?key=${sensitive[4]}`],
  ['bearer/access/OIDC/GitHub tokens', sensitive.slice(0, 5).map((v) => `Bearer ${v}`).join('\n')],
  ['credential path and environment dump', `GOOGLE_APPLICATION_CREDENTIALS=${sensitive[5]}\nenv={SECRET:${sensitive[8]}}`],
  ['credential JSON/private key/refresh token', JSON.stringify({ type: 'service_account', private_key:
    '-----BEGIN ' + 'PRIVATE KEY-----\n' + sensitive[7] + '\n-----END ' + 'PRIVATE KEY-----', refresh_token: sensitive[6] })],
]) test(`sanitizer withholds ${label}`, () => {
  const d = sanitizeCliFailure({ stderr: raw }); noSecrets(d); assert.equal(d.rawOutputWithheld, true);
});
test('endpoint output excludes query/auth data and unknown hosts/paths', () => {
  const d = sanitizeCliFailure({ message: `Request to https://firebasehosting.googleapis.com/v1beta1/sites/${SITE}/versions/123?key=${sensitive[4]} had HTTP 403\nhttps://unknown.invalid/${sensitive[8]}\nhttps://firebasehosting.googleapis.com/private/${sensitive[8]}` });
  assert.deepEqual(d.endpoints, [`firebasehosting.googleapis.com/v1beta1/sites/${SITE}/versions/123`]); noSecrets(d);
});
test('unknown errors and malformed JSON never return raw text/stack', () => {
  for (const raw of ['{broken ' + sensitive[8], sensitive[8]]) {
    const d = sanitizeCliFailure({ message: raw, stderr: raw, stack: raw });
    assert.equal(d.message, 'Unrecognized CLI error; raw output withheld'); noSecrets(d);
  }
});
test('CLI error object does not retain raw output or cause', () => {
  const error = new HostingCliError({ stderr: `HTTP 403 ${sensitive[0]}`, stdout: sensitive[8] });
  assert(!('stdout' in error)); assert(!('stderr' in error)); assert(!('cause' in error));
  noSecrets({ message: error.message, diagnosis: error.diagnosis });
});
test('real child-process stderr is piped rather than echoed before sanitizing', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'studentkeyword-diagnostic-command-'));
  try {
    const dir = join(root, 'tools/hosting-cli/node_modules/.bin'); mkdirSync(dir, { recursive: true });
    const cli = join(dir, 'firebase');
    writeFileSync(cli, `#!/usr/bin/env node\nif (process.argv[2] === '--version') console.log('${CLI_VERSION}'); else { console.error('Bearer ' + ${JSON.stringify(sensitive[0])}); console.log(JSON.stringify({status:'error',error:'HTTP 403 firebasehosting.sites.update'})); process.exitCode=2; }\n`);
    chmodSync(cli, 0o700);
    const module = new URL('../scripts/deploy-hosting.mjs', import.meta.url).href;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {realAdapter} from ${JSON.stringify(module)}; try { realAdapter(${JSON.stringify(root)},${JSON.stringify(env)}).deploy(); } catch(e) { console.error(e.message); process.exitCode=1; }`], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert(result.stderr.includes('firebasehosting.sites.update'));
    noSecrets({ stdout: result.stdout, stderr: result.stderr });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('real adapter sanitizes thrown command output and non-success JSON', () => {
  for (const mode of ['throws', 'json']) {
    const adapter = realAdapter('/mock', env, { command: (binary, args) => {
      if (args[0] === '--version') return CLI_VERSION;
      const output = JSON.stringify({ status: 'error', error: `HTTP 403 firebasehosting.sites.update Bearer ${sensitive[0]}` });
      if (mode === 'throws') throw Object.assign(new Error(sensitive[8]), { stdout: output, stderr: sensitive[4], status: 2 });
      return output;
    } });
    assert.throws(() => adapter.deploy(), (e) => {
      assert(e instanceof HostingCliError); assert.deepEqual(e.diagnosis.httpStatus, [403]); noSecrets(e); return true;
    });
  }
});
test('CLI failure records before/after observations and sanitized diagnosis with no rollback', async () => {
  const f = fixture(); let read = 0;
  f.adapter.diagnosticState = async () => ({ release: f.old, versions: ++read === 1 ? [] :
    [versionObservation({ name: `sites/${SITE}/versions/orphan`, status: 'CREATED', labels: { secret: sensitive[8] } })] });
  f.adapter.deploy = () => { throw Object.assign(new Error(sensitive[8]), { stdout: JSON.stringify({ status: 'error', error:
    `HTTP 403 firebasehosting.sites.update Bearer ${sensitive[0]}` }), stderr: sensitive[5] }); };
  await assert.rejects(f.execute(), /Firebase CLI deploy failed/);
  assert.equal(read, 2); assert.equal(f.records['cli-start'].stage, 'cli-start');
  const failure = f.records['cli-failure'];
  assert.equal(failure.internalCliStage, 'unknown'); assert.equal(failure.newlyObservedVersions[0].status, 'CREATED');
  assert.equal(failure.comparisonComplete, true); assert(!f.calls.includes('rollback'));
  noSecrets(sanitizeEvidence(f.records)); assert(!f.records.result);
});
test('diagnostic read failure preserves original CLI failure and does not change live', async () => {
  const f = fixture(); f.adapter.diagnosticState = () => { throw new Error(`HTTP 403 ${sensitive[0]}`); };
  f.adapter.deploy = () => { throw new Error('PERMISSION_DENIED firebasehosting.sites.update'); };
  await assert.rejects(f.execute(), /PERMISSION_DENIED/);
  assert.equal(f.records['cli-failure'].comparisonComplete, false);
  assert.equal(f.records['cli-failure'].after.unavailable, true); assert(!f.calls.includes('rollback'));
  noSecrets(sanitizeEvidence(f.records));
});
test('concurrent deployment during diagnostic snapshot prevents CLI invocation', async () => {
  const f = fixture();
  f.adapter.diagnosticState = async () => { f.setLive(release('foreign', 'v2')); return { versions: [] }; };
  await assert.rejects(f.execute(), /concurrent Hosting deployment during diagnostic snapshot/);
  assert(!f.calls.includes('deploy')); assert(!f.calls.includes('rollback'));
});
test('diagnostic state uses bounded GETs only, omitting config/users/labels and raw tokens', async () => {
  const calls = []; const old = release('old', 'v0');
  const adapter = realAdapter('/mock', env, { command: () => sensitive[0], fetch: async (url, options) => {
    calls.push({ url, method: options.method }); assert.equal(options.method, 'GET');
    return { ok: true, json: async () => url.endsWith('/channels/live') ? { release: old } :
      { versions: [{ name: `sites/${SITE}/versions/orphan`, status: 'CREATED', config: { secret: sensitive[8] },
        labels: { secret: sensitive[8] }, createUser: { secret: sensitive[8] } }], nextPageToken: 'fixture-page' } };
  } });
  const state = await adapter.diagnosticState(); assert.equal(calls.length, 4); assert.equal(state.truncated, true);
  noSecrets(sanitizeEvidence(state)); assert(!('config' in state.versions[0]));
});
test('release evidence never includes arbitrary old/foreign release messages', () => {
  const cleaned = sanitizeEvidence({ release: release('foreign', 'v2', sensitive[8]), stdout: sensitive[0],
    GOOGLE_APPLICATION_CREDENTIALS: sensitive[5], env: { SECRET: sensitive[8] } });
  noSecrets(cleaned); assert.equal(cleaned.release.message, '[withheld]');
});


const runResource = 'projects/mykeyword-a832f/locations/asia-northeast3/services/studentkeyword-api';
const runUrl = `https://run.googleapis.com/v2/${runResource}`;
function runReadAdapter(body, response = {}) {
  const calls = [];
  const adapter = realAdapter('/mock', env, {
    command: (binary, args) => {
      assert.equal(binary, 'gcloud'); assert.deepEqual(args, ['auth', 'print-access-token']);
      return sensitive[0];
    },
    fetch: async (url, options) => {
      calls.push({ url, method: options.method, body: options.body });
      assert.equal(url, runUrl); assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
      assert.equal(options.headers.Authorization, `Bearer ${sensitive[0]}`);
      return { ok: true, status: 200, json: async () => body, ...response };
    },
  });
  return { adapter, calls };
}
test('Cloud Run read uses the fixed v2 GET and retains only permission/resource evidence', async () => {
  const f = runReadAdapter({ name: runResource, template: { env: sensitive[8] }, labels: { private: sensitive[8] } });
  const result = await f.adapter.cloudRunRead();
  assert.deepEqual(result, { status: 'verified', method: 'GET', permission: 'run.services.get', resource: runResource });
  assert.deepEqual(f.calls, [{ url: runUrl, method: 'GET', body: undefined }]); noSecrets(result);
});
for (const [field, name] of [
  ['project', 'projects/other/locations/asia-northeast3/services/studentkeyword-api'],
  ['region', 'projects/mykeyword-a832f/locations/us-central1/services/studentkeyword-api'],
  ['service', 'projects/mykeyword-a832f/locations/asia-northeast3/services/other'],
]) test(`Cloud Run read rejects wrong ${field} before validate can succeed`, async () => {
  const read = runReadAdapter({ name }); const f = fixture({ cloudRunRead: read.adapter.cloudRunRead });
  await assert.rejects(f.execute('validate'), /unexpected project\/region\/service/);
  assert.equal(f.records['cloud-run-read'].status, 'failed');
  assert(!f.calls.some((c) => ['build', 'deploy', 'rollback'].includes(c))); assert.equal(read.calls.length, 1);
});
test('Cloud Run read rejects missing service name', async () => {
  const f = runReadAdapter({}); await assert.rejects(f.adapter.cloudRunRead(), /unexpected project\/region\/service/);
});
test('validate reports HTTP 403 run.services.get without reading or printing the response body', async () => {
  let parsed = false;
  const read = runReadAdapter(undefined, { ok: false, status: 403, json: async () => { parsed = true; return { error: sensitive[8] }; } });
  const f = fixture({ cloudRunRead: read.adapter.cloudRunRead });
  await assert.rejects(f.execute('validate'), /run\.services\.get GET failed: HTTP 403/);
  const evidence = f.records['cloud-run-read'];
  assert.equal(evidence.status, 'failed'); assert.deepEqual(evidence.diagnosis.httpStatus, [403]);
  assert.deepEqual(evidence.diagnosis.permissions, ['run.services.get']); assert.equal(evidence.resource, runResource);
  assert.equal(parsed, false); noSecrets(sanitizeEvidence(evidence));
  assert(!f.calls.some((c) => ['build', 'deploy', 'rollback'].includes(c)));
});
test('validate Cloud Run network failure fails closed with sanitized evidence', async () => {
  const adapter = realAdapter('/mock', env, { command: () => sensitive[0], fetch: async () => { throw new Error(sensitive[8]); } });
  const f = fixture({ cloudRunRead: adapter.cloudRunRead });
  await assert.rejects(f.execute('validate')); assert.equal(f.records['cloud-run-read'].status, 'failed');
  noSecrets(sanitizeEvidence(f.records)); assert(!f.calls.includes('deploy'));
});
test('validate performs Hosting and Cloud Run GETs only while the deployment gate is false', async () => {
  const requests = [], commands = []; const old = release('old', 'v0');
  const adapter = realAdapter('/mock', env, {
    command: (binary, args) => { commands.push({ binary, args }); return sensitive[0]; },
    fetch: async (url, options) => {
      requests.push({ url, method: options.method, body: options.body });
      assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
      let body;
      if (url.endsWith(`/projects/${PROJECT}/sites/${SITE}`)) body = { name: `projects/${PROJECT}/sites/${SITE}`, defaultUrl: `https://${SITE}.web.app` };
      else if (url.endsWith('/channels/live')) body = { name: `sites/${SITE}/channels/live`, release: old };
      else if (url.endsWith('/versions/v0')) body = old.version;
      else if (url === runUrl) body = { name: runResource };
      else throw new Error('unexpected request');
      return { ok: true, status: 200, json: async () => body };
    },
  });
  // Existing source/config gates are covered above; exercise the actual API adapters here.
  const f = fixture({ project: adapter.project, live: adapter.live, cloudRunRead: adapter.cloudRunRead });
  const result = await runHosting(f.adapter, { ...env, MODE: 'validate', HOSTING_DEPLOY_ENABLED: 'false' },
    (name, data) => { f.records[name] = data; });
  assert.equal(result.cloudRunRead.status, 'verified'); assert.equal(requests.length, 4);
  assert.deepEqual(commands, [{ binary: 'gcloud', args: ['auth', 'print-access-token'] }]);
  assert(!f.calls.some((c) => ['build', 'snapshot', 'deploy', 'rollback'].includes(c)));
  assert.equal(f.records['cloud-run-read'].resource, runResource); noSecrets(sanitizeEvidence(f.records));
});
test('deploy mode does not invoke the new Cloud Run read path', async () => {
  const f = fixture({ cloudRunRead: () => { throw new Error('validate-only read called in deploy'); } });
  const result = await f.execute(); assert.equal(result.mode, 'deploy');
  assert.equal(f.records['cloud-run-read'], undefined); assert(f.calls.includes('deploy'));
});
test('validate refuses an unexpected Hosting identity before the Cloud Run GET', async () => {
  const f = fixture();
  await assert.rejects(runHosting(f.adapter, { ...env, MODE: 'validate', HOSTING_SERVICE_ACCOUNT: 'other' }), /unexpected Hosting identity/);
  assert(!f.calls.includes('cloud-run-read')); assert(!f.calls.includes('deploy'));
});
