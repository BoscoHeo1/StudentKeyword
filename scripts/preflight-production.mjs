import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const shaPattern = /^[0-9a-f]{40}$/;
const isSha = (value) => typeof value === 'string' && shaPattern.test(value);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function requireCondition(condition, reason) {
  if (!condition) throw new Error(reason);
}

// Never trust server-side filters alone. Validate every returned record before
// counting exact successful runs; malformed or incomplete listings fail closed.
export function verifyRuns({ sha, workflow, getPage, log = () => {} }) {
  requireCondition(object(workflow) && Number.isSafeInteger(workflow.id) && workflow.id > 0 &&
    workflow.name === 'Verify source' && workflow.path === '.github/workflows/verify.yml' &&
    workflow.state === 'active', 'verify_workflow_invalid');
  let total;
  let found = 0;
  let success = 0;
  const ids = new Set();
  for (let page = 1; page <= 10; page++) {
    const response = getPage(page);
    requireCondition(object(response) && Number.isSafeInteger(response.total_count) &&
      response.total_count >= 0 && response.total_count <= 1000 && Array.isArray(response.workflow_runs),
    'verify_response_invalid');
    total ??= response.total_count;
    requireCondition(response.total_count === total && response.workflow_runs.length <= 100,
      'verify_listing_ambiguous');
    for (const run of response.workflow_runs) {
      requireCondition(object(run) && Number.isSafeInteger(run.id) && run.id > 0 && !ids.has(run.id) &&
        run.workflow_id === workflow.id && run.name === workflow.name && run.path === workflow.path &&
        isSha(run.head_sha) && typeof run.head_branch === 'string' &&
        ['completed', 'in_progress', 'queued', 'requested', 'waiting', 'pending'].includes(run.status) &&
        (run.status === 'completed'
          ? ['success', 'failure', 'cancelled', 'neutral', 'skipped', 'stale', 'timed_out', 'action_required', 'startup_failure'].includes(run.conclusion)
          : run.conclusion === null), 'verify_run_invalid');
      ids.add(run.id);
      found++;
      if (run.head_sha === sha && run.head_branch === 'main' &&
          run.status === 'completed' && run.conclusion === 'success') success++;
    }
    requireCondition(found <= total, 'verify_listing_ambiguous');
    if (found === total) {
      log(`verify_runs_found=${found}`);
      log(`verify_success_for_sha=${success > 0}`);
      requireCondition(success > 0, 'verify_success_missing');
      return { found, success };
    }
    requireCondition(response.workflow_runs.length === 100, 'verify_listing_incomplete');
  }
  throw new Error('verify_listing_incomplete');
}

export function preflight({ env, checkoutSha, getMain, getWorkflow, getPage, log = () => {} }) {
  requireCondition(env.GITHUB_REPOSITORY === 'BoscoHeo1/StudentKeyword' &&
    env.GITHUB_REF === 'refs/heads/main' && isSha(env.GITHUB_SHA), 'source_context_invalid');
  const mode = ['validate', 'deploy'].includes(env.MODE) ? env.MODE : 'invalid';
  log(`mode=${mode}`);
  log(`confirm_sha_required=${mode === 'deploy'}`);
  log(`checkout_sha_match=${checkoutSha === env.GITHUB_SHA}`);
  requireCondition(mode !== 'invalid', 'mode_invalid');
  requireCondition(checkoutSha === env.GITHUB_SHA, 'checkout_sha_mismatch');
  const main = getMain();
  requireCondition(object(main) && isSha(main.sha), 'remote_main_response_invalid');
  log(`remote_main_sha_match=${main.sha === env.GITHUB_SHA}`);
  requireCondition(main.sha === env.GITHUB_SHA, 'remote_main_sha_mismatch');
  requireCondition(mode !== 'deploy' || env.CONFIRM_SHA === env.GITHUB_SHA, 'confirm_sha_mismatch');
  return verifyRuns({ sha: env.GITHUB_SHA, workflow: getWorkflow(), getPage, log });
}

function command(program, args) {
  try {
    return execFileSync(program, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  } catch {
    // Do not echo command output, environment, headers or credentials.
    throw new Error(program === 'gh' ? 'github_api_request_failed' : 'checkout_read_failed');
  }
}
function api(path, fields = []) {
  const output = command('gh', ['api', '-X', 'GET', path, ...fields.flatMap(([key, value]) => ['-f', `${key}=${value}`])]);
  try { return JSON.parse(output); } catch { throw new Error('github_api_json_invalid'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const repo = 'repos/BoscoHeo1/StudentKeyword';
    preflight({ env: process.env, checkoutSha: command('git', ['rev-parse', 'HEAD']).trim(),
      getMain: () => api(`${repo}/commits/main`),
      getWorkflow: () => api(`${repo}/actions/workflows/verify.yml`),
      getPage: (page) => api(`${repo}/actions/workflows/verify.yml/runs`, [
        ['head_sha', process.env.GITHUB_SHA], ['branch', 'main'], ['status', 'completed'],
        ['per_page', '100'], ['page', String(page)],
      ]), log: (message) => console.log(message) });
    console.log('preflight_passed=true');
  } catch (error) {
    console.error(`preflight_failed=${error.message}`);
    process.exitCode = 1;
  }
}
