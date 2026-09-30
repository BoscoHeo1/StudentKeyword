import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const sha = 'd62c002fb2c0a58617bb770a3ff70c9f15b795d1';
const candidate = `studentkeyword-api-p${sha.slice(0, 12)}r123a1`;
const previous = 'studentkeyword-api-00009-klk';
const script = process.env.DEPLOY_SCRIPT_UNDER_TEST || resolve('scripts/deploy-production.sh');

// All external GCP/HTTP/git commands resolve to this isolated executable.
// Unexpected commands fail instead of falling through to a real CLI/network.
const mock = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const scenario = process.env.DEPLOY_SCENARIO;
const file = process.env.DEPLOY_MOCK_STATE;
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : { reads: 0, deployed: false, promoted: false, rolledBack: false, updates: [], smokes: [], commands: [] };
const sha = process.env.GITHUB_SHA;
const tag = 'p' + sha.slice(0, 12) + 'r123a1';
const candidate = 'studentkeyword-api-' + tag;
const old = 'studentkeyword-api-00009-klk';
const other = 'studentkeyword-api-concurrent';
const root = 'asia-northeast3-docker.pkg.dev/mykeyword-a832f/studentkeyword/studentkeyword-api';
const digest = 'sha256:' + '1'.repeat(64);
const image = root + '@' + digest;
const account = 'studentkeyword-run@mykeyword-a832f.iam.gserviceaccount.com';
function finish(output = '', code = 0) { fs.writeFileSync(file, JSON.stringify(state)); process.stdout.write(typeof output === 'string' ? output : JSON.stringify(output)); process.exit(code); }
function fail(message, code = 1) { process.stderr.write(message + '\n'); finish('', code); }
state.commands.push([command, ...args]);
if (command === 'git') finish(sha + '\n');
if (command === 'sleep') fail('Unexpected retry/sleep in mock', 90);
if (command === 'curl') {
 const url = args.at(-1);
 if (args.includes('PUT')) {
  const request = JSON.parse(fs.readFileSync(args[args.indexOf('--data-binary') + 1].slice(1)));
  if (request.metadata.resourceVersion !== 'mock-version') fail('Missing checked resourceVersion', 90);
  if (request.spec.template.spec.containers[0].image !== image) fail('Unexpected template change', 90);
  if (scenario === 'concurrent-at-promotion') fail('HTTP 409: resourceVersion changed', 22);
  const target = request.spec.traffic.find(t => t.percent === 100).revisionName;
  state.updates.push('--to-revisions=' + target + '=100'); state.promoted = true; state.promotedRevision = target; finish();
 }
 state.smokes.push(url);
 let status = url.endsWith('/api/config') ? '410' : url.endsWith('/api/classes/session') ? '401' : url.endsWith('/api/classes/logout') ? (args.some(a => a.startsWith('Origin:')) ? '200' : '403') : '200';
 if (url.startsWith('https://service.invalid') && scenario.startsWith('rollback-') && !state.rolledBack) status = '500';
 finish(status);
}
if (command !== 'gcloud') fail('Unexpected executable: ' + command, 90);
const call = args.slice(0, 3).join(' ');
if (args.slice(0, 2).join(' ') === 'auth print-access-token') finish('mock-token');
if (call === 'artifacts docker images') {
 if (scenario === 'tag-exists') finish(digest);
 if (scenario.startsWith('registry-')) fail('ERROR: (gcloud.artifacts.docker.images.describe) ' + ({'registry-permission':'PERMISSION_DENIED: denied','registry-auth':'UNAUTHENTICATED: expired','registry-network':'ConnectionError: network down','registry-api':'INTERNAL: unavailable','registry-unknown':'Unexpected error'}[scenario]));
 if (scenario === 'cli-not-found') fail('ERROR: (gcloud.artifacts.docker.images.describe) Image not found.');
 fail('ERROR: (gcloud.artifacts.docker.images.describe) NOT_FOUND: Image tag not found.');
}
if (call === 'artifacts docker tags') {
 if (scenario === 'tags-query-failure') fail('PERMISSION_DENIED: cannot list tags');
 if (scenario === 'tags-malformed') finish({unexpected: true});
 finish([{image: root, tag: 'projects/mykeyword-a832f/locations/asia-northeast3/repositories/studentkeyword/packages/studentkeyword-api/tags/' + (scenario === 'tag-appeared' ? 'sha-' + sha + '-r123-a1' : 'cr10')}]);
}
if (call === 'artifacts repositories describe') {
 if (scenario === 'repository-missing') fail('NOT_FOUND: repository absent');
 finish('studentkeyword');
}
if (args.slice(0, 2).join(' ') === 'builds submit') finish({id: 'mock-build'});
if (args.slice(0, 2).join(' ') === 'builds describe') finish({status: 'SUCCESS', results: { images: [{ name: root + ':sha-' + sha + '-r123-a1', digest }] }});
if (args.slice(0, 2).join(' ') === 'run deploy') { state.deployed = true; finish(); }
if (call === 'run revisions describe') {
 const wrong = scenario === 'digest-mismatch';
 finish({metadata: {name: scenario === 'revision-name-mismatch' ? other : candidate}, spec: {serviceAccountName: account, containers: [{image: wrong ? root + '@sha256:' + '2'.repeat(64) : image}]}, status: {imageDigest: scenario === 'resolved-digest-mismatch' ? root + '@sha256:' + '2'.repeat(64) : image, conditions: [{type: 'Ready', status: 'True'}]}});
}
if (call === 'run services describe') {
 state.reads++;
 if (state.rolledBack && scenario === 'rollback-query-failure') fail('Service query unavailable');
 const afterSmoke = state.smokes.length >= 5 && !state.promoted;
 const concurrent = state.deployed && (scenario === 'concurrent-before-smoke' || (afterSmoke && scenario === 'concurrent-after-smoke'));
 let traffic = state.promoted && !state.rolledBack ? state.promotedRevision : old;
 if (afterSmoke && scenario === 'concurrent-traffic-after-smoke') traffic = other;
 if (state.rolledBack && scenario === 'rollback-verification-failure') traffic = candidate;
 const latest = concurrent ? other : state.deployed ? candidate : old;
 const spec = {serviceAccountName: account, containers: [{image: state.deployed ? image : root + ':cr10'}]};
 const tags = state.deployed ? [{revisionName: scenario === 'tag-mismatch' ? other : candidate, tag, url: 'https://candidate.invalid', percent: 0}] : [];
 finish({apiVersion: 'serving.knative.dev/v1', kind: 'Service', metadata: {name: 'studentkeyword-api', namespace: 'mykeyword-a832f', resourceVersion: 'mock-version', generation: 1}, spec: {template: {spec}, traffic: [{revisionName: traffic, percent: 100}, ...tags.map(({url, ...t}) => t)]}, status: {observedGeneration: 1, latestCreatedRevisionName: latest, url: 'https://service.invalid', traffic: [{revisionName: traffic, percent: 100}, ...tags]}});
}
if (call === 'run services update-traffic') {
 const target = args.find(a => a.startsWith('--to-revisions=')); state.updates.push(target);
 if (target === '--to-revisions=' + old + '=100') {
  if (scenario === 'rollback-command-failure') fail('Rollback update rejected');
  state.rolledBack = true;
 } else { state.promoted = true; state.promotedRevision = target.slice('--to-revisions='.length, -'=100'.length); }
 finish();
}
fail('Unexpected GCP command: ' + args.join(' '), 90);
`;

function run(scenario) {
  const dir = mkdtempSync(join(tmpdir(), 'studentkeyword-deploy-test-'));
  try {
    const executable = join(dir, 'mock.cjs');
    writeFileSync(executable, mock, { mode: 0o755 });
    for (const name of ['gcloud', 'git', 'curl', 'sleep']) symlinkSync(executable, join(dir, name));
    const stateFile = join(dir, 'state.json');
    const result = spawnSync('bash', [script, 'deploy'], {
      encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, DEPLOY_SCENARIO: scenario, DEPLOY_MOCK_STATE: stateFile,
        GITHUB_REPOSITORY: 'BoscoHeo1/StudentKeyword', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha,
        GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' },
    });
    assert.ifError(result.error);
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.doesNotMatch(result.stderr, /Unexpected executable|Unexpected GCP command|Unexpected retry/);
    return { ...result, state, output: result.stdout + result.stderr };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('verified candidate is the smoke and promotion target', () => {
  const result = run('success');
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.state.updates, [`--to-revisions=${candidate}=100`]);
  assert.equal(result.state.smokes.filter(url => url.startsWith('https://candidate.invalid')).length, 5);
  const deploy = result.state.commands.find(args => args[0] === 'gcloud' && args[1] === 'run' && args[2] === 'deploy');
  assert.ok(deploy.includes(`--revision-suffix=p${sha.slice(0, 12)}r123a1`));
  assert.ok(deploy.includes('--no-traffic'));
});

test('CLI Image not found format proceeds only after verified tag absence', () => {
  const result = run('cli-not-found');
  assert.equal(result.status, 0, result.output);
  assert.ok(result.state.commands.some(args => args.slice(1, 4).join(' ') === 'artifacts docker tags'));
});

for (const scenario of ['concurrent-before-smoke', 'concurrent-after-smoke', 'concurrent-traffic-after-smoke', 'concurrent-at-promotion', 'tag-mismatch', 'revision-name-mismatch', 'digest-mismatch', 'resolved-digest-mismatch']) {
  test(`${scenario} fails closed without traffic update`, () => {
    const result = run(scenario);
    assert.notEqual(result.status, 0, result.output);
    assert.deepEqual(result.state.updates, []);
    if (scenario.endsWith('after-smoke') || scenario === 'concurrent-at-promotion') assert.equal(result.state.smokes.length, 5);
  });
}

test('successful rollback is verified and deployment remains failed', () => {
  const result = run('rollback-success');
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.state.updates, [`--to-revisions=${candidate}=100`, `--to-revisions=${previous}=100`]);
  assert.match(result.output, /Rollback verified/);
  assert.doesNotMatch(result.output, /Production revision:/);
});

for (const scenario of ['rollback-command-failure', 'rollback-query-failure', 'rollback-verification-failure']) {
  test(`${scenario} is reported as a failure`, () => {
    const result = run(scenario);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /ROLLBACK FAILED/);
    assert.doesNotMatch(result.output, /Rollback verified|Production revision:/);
  });
}

for (const scenario of ['tag-exists', 'registry-permission', 'registry-auth', 'registry-network', 'registry-api', 'registry-unknown', 'repository-missing', 'tags-query-failure', 'tags-malformed', 'tag-appeared']) {
  test(`${scenario} blocks build and deployment`, () => {
    const result = run(scenario);
    assert.notEqual(result.status, 0);
    assert.equal(result.state.deployed, false);
    assert.equal(result.state.commands.some(args => args[1] === 'builds'), false);
  });
}
