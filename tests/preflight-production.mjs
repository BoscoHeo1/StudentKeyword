import test from 'node:test';
import assert from 'node:assert/strict';
import { preflight } from '../scripts/preflight-production.mjs';

const sha = 'e6904a688e366fdc06c7e552a60420e47868ea1f';
const workflow = { id: 123, name: 'Verify source', path: '.github/workflows/verify.yml', state: 'active' };
const run = { id: 1, workflow_id: 123, name: workflow.name, path: workflow.path,
  head_sha: sha, head_branch: 'main', status: 'completed', conclusion: 'success' };
function check({ mode = 'validate', confirm = '', head = sha, main = { sha },
  runs = [run], descriptor = workflow, response, pages } = {}) {
  const logs = [];
  const requested = [];
  const result = preflight({
    env: { GITHUB_REPOSITORY: 'BoscoHeo1/StudentKeyword', GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: sha, MODE: mode, CONFIRM_SHA: confirm },
    checkoutSha: head, getMain: () => main, getWorkflow: () => descriptor,
    getPage: (page) => { requested.push(page); return pages ? pages[page - 1] :
      response === undefined ? { total_count: runs.length, workflow_runs: runs } : response; },
    log: (message) => logs.push(message),
  });
  return { result, logs, requested };
}

test('correct SHA, main, completed/success passes with safe diagnostics', () => {
  const { result, logs } = check();
  assert.deepEqual(result, { found: 1, success: 1 });
  assert.deepEqual(logs, ['mode=validate', 'confirm_sha_required=false', 'checkout_sha_match=true',
    'remote_main_sha_match=true', 'verify_runs_found=1', 'verify_success_for_sha=true']);
  assert.ok(logs.every((line) => !line.includes(sha)));
});
for (const [name, patch] of [
  ['completed/failure', { conclusion: 'failure' }],
  ['in_progress only', { status: 'in_progress', conclusion: null }],
  ['wrong head SHA', { head_sha: 'a'.repeat(40) }],
  ['wrong branch', { head_branch: 'feature' }],
]) test(`${name} fails closed`, () => assert.throws(() => check({ runs: [{ ...run, ...patch }] }), /verify_success_missing/));
test('remote main advanced fails', () => assert.throws(() => check({ main: { sha: 'b'.repeat(40) } }), /remote_main_sha_mismatch/));
test('checkout SHA mismatch fails', () => assert.throws(() => check({ head: 'b'.repeat(40) }), /checkout_sha_mismatch/));
test('deploy wrong confirmation fails', () => assert.throws(() => check({ mode: 'deploy', confirm: 'b'.repeat(40) }), /confirm_sha_mismatch/));
test('deploy exact confirmation passes', () => assert.equal(check({ mode: 'deploy', confirm: sha }).result.success, 1));
test('validate empty confirmation passes', () => assert.equal(check({ confirm: '' }).result.success, 1));
test('unknown mode fails', () => assert.throws(() => check({ mode: 'invalid' }), /mode_invalid/));
test('zero runs fails', () => assert.throws(() => check({ runs: [] }), /verify_success_missing/));
for (const response of [null, [], {}, { total_count: '1', workflow_runs: [run] },
  { total_count: 1, workflow_runs: null }, { total_count: 1, workflow_runs: [{}] },
  { total_count: 1001, workflow_runs: [run] }]) {
  test(`malformed API response ${JSON.stringify(response)} fails`, () => assert.throws(() => check({ response }), /verify_/));
}
test('malformed main response fails', () => assert.throws(() => check({ main: {} }), /remote_main_response_invalid/));
test('array SHA cannot be coerced into a valid SHA', () => assert.throws(() => check({ main: { sha: [sha] } }), /remote_main_response_invalid/));
test('wrong workflow identity fails', () => assert.throws(() => check({ descriptor: { ...workflow, path: 'other.yml' } }), /verify_workflow_invalid/));
test('wrong run workflow identity fails', () => assert.throws(() => check({ runs: [{ ...run, workflow_id: 456 }] }), /verify_run_invalid/));
test('success with unfinished status is ambiguous', () => assert.throws(() => check({ runs: [{ ...run, status: 'in_progress' }] }), /verify_run_invalid/));
test('duplicate IDs fail', () => assert.throws(() => check({ runs: [run, run] }), /verify_run_invalid/));
test('truncated listing fails even when first page has a success', () => assert.throws(() => check({ response: { total_count: 2, workflow_runs: [run] } }), /verify_listing_incomplete/));
test('pagination finds exact success on second page', () => {
  const first = Array.from({ length: 100 }, (_, i) => ({ ...run, id: i + 1, conclusion: 'failure' }));
  const result = check({ pages: [{ total_count: 101, workflow_runs: first },
    { total_count: 101, workflow_runs: [{ ...run, id: 101 }] }] });
  assert.deepEqual(result.requested, [1, 2]);
  assert.equal(result.result.success, 1);
});
test('changing pagination total fails', () => {
  const first = Array.from({ length: 100 }, (_, i) => ({ ...run, id: i + 1 }));
  assert.throws(() => check({ pages: [{ total_count: 101, workflow_runs: first },
    { total_count: 102, workflow_runs: [{ ...run, id: 101 }] }] }), /verify_listing_ambiguous/);
});
