// CLI output is untrusted. Extract diagnostic facts, never return a redacted raw dump.
const CODES = new Set(['PERMISSION_DENIED', 'UNAUTHENTICATED', 'NOT_FOUND', 'INVALID_ARGUMENT',
  'FAILED_PRECONDITION', 'RESOURCE_EXHAUSTED', 'ALREADY_EXISTS', 'ABORTED', 'UNAVAILABLE',
  'INTERNAL', 'DEADLINE_EXCEEDED', 'UNKNOWN', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT']);
const STAGES = new Set(['cli-start', 'cli-failed', 'post-deploy-verify', 'diagnostic-read', 'unknown']);
const KEYS = new Set(['error', 'errors', 'message', 'code', 'status', 'context', 'body',
  'details', 'reason', 'permission', 'resource', 'url', 'httpStatus', 'statusCode']);
const SITE = 'mykeyword-a832f';
const RESOURCE = /\bsites\/mykeyword-a832f(?:\/(?:versions\/[A-Za-z0-9_-]{1,64}(?:\/files)?|channels\/live(?:\/releases\/[A-Za-z0-9_-]{1,64})?|releases\/[A-Za-z0-9_-]{1,64}))?\b/g;

function scrub(text) {
  return text.slice(0, 65536)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '')
    .replace(/\b(?:Bearer|Basic)\s+[^\s"',;]+/gi, '')
    .replace(/\b(?:ya29\.[\w.-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+|gh[pousr]_[\w]+|github_pat_[\w]+|AIza[\w-]+)/g, '')
    .replace(/(?:authorization|access[_ -]?token|refresh[_ -]?token|id[_ -]?token|oidc[_ -]?token|api[_ -]?key|private[_ -]?key|GOOGLE_APPLICATION_CREDENTIALS|credentials?|environment|env)\s*["']?\s*[:=]\s*[^\r\n]+/gi, '');
}

export function sanitizeCliFailure(error, stage = 'cli-start') {
  const status = new Set(), codes = new Set(), permissions = new Set(), resources = new Set(), endpoints = new Set();
  const summaries = new Set();
  let parsedJson = false, cliStatus;
  function extract(raw) {
    const text = scrub(String(raw));
    for (const m of text.matchAll(/\b(?:HTTP(?: status)?|status(?: code)?|response(?: status)?|error)\s*[:=]?\s*([45]\d\d)\b/gi)) status.add(Number(m[1]));
    for (const code of CODES) if (new RegExp(`\\b${code}\\b`).test(text)) codes.add(code);
    for (const m of text.matchAll(/\b(?:firebasehosting\.sites\.(?:get|list|update|create|delete)|firebase\.projects\.get|firebase\.clients\.(?:get|list)|serviceusage\.services\.use|apikeys\.keys\.(?:get|getKeyString|list)|iam\.serviceAccounts\.getAccessToken|run\.services\.get|resourcemanager\.projects\.get)\b/g)) permissions.add(m[0]);
    for (const m of text.matchAll(RESOURCE)) resources.add(m[0]);
    for (const m of text.matchAll(/https:\/\/[^\s"'<>]+/g)) {
      try {
        const url = new URL(m[0]);
        if (url.username || url.password) continue;
        if (!['firebasehosting.googleapis.com', 'firebase.googleapis.com'].includes(url.hostname)) continue;
        // Paths are reconstructed from this project's known API grammar; queries never survive.
        const safePath = url.pathname.match(/^\/(v1beta1|v1beta|v1)\/(?:projects\/(?:mykeyword-a832f|783209447753)\/)?sites\/mykeyword-a832f(?:\/(?:versions(?:\/[A-Za-z0-9_-]{1,64}(?::populateFiles|\/files)?)?|channels\/live(?:\/releases)?|releases))?$/);
        if (safePath) endpoints.add(url.hostname + safePath[0]);
      } catch { /* Unknown URLs are withheld. */ }
    }
    for (const [pattern, summary] of [
      [/\bPermission .{0,100} denied\b/i, 'Permission denied'],
      [/\binsufficient permissions\b/i, 'Insufficient permissions'],
      [/\bFailed to authenticate\b/i, 'Failed to authenticate'],
      [/\bFailed to (?:upload|populate) files\b/i, 'Failed to upload/populate files'],
      [/\bFailed to finalize (?:the )?version\b/i, 'Failed to finalize version'],
      [/\bFailed to create (?:the )?release\b/i, 'Failed to create release'],
      [/\bAn unexpected error has occurred\b/i, 'Unexpected Firebase CLI error'],
      [/\bRequest to https:\/\//i, 'API request failed'],
    ]) if (pattern.test(text)) summaries.add(summary);
    // Preserve known wrapper failures as fixed phrases, without assertion diff/values.
    for (const phrase of ['SHA mismatch', 'concurrent Hosting deployment', 'live version mismatch',
      'release message mismatch', 'rollback release mismatch', 'rollback live version mismatch',
      'live hash mismatch', 'candidate ownership not established', 'deployment disabled',
      'CLI must identify this deployment version']) if (text.includes(phrase)) summaries.add(phrase);
  }
  let visited = 0;
  function visit(value, depth = 0, key = '') {
    if (++visited > 256 || depth > 12 || value == null) return;
    if (typeof value === 'number') {
      if (['code', 'status', 'httpStatus', 'statusCode'].includes(key) && value >= 400 && value <= 599) status.add(value);
      return;
    }
    if (typeof value === 'string') {
      if (value.length > 65536) { extract(value); return; }
      try { const nested = JSON.parse(value); if (nested && typeof nested === 'object') { parsedJson = true; visit(nested, depth + 1); return; } } catch { /* bounded text fallback */ }
      if (key === 'status' && value === 'error') cliStatus = 'error';
      extract(value);
    } else if (Array.isArray(value)) value.slice(0, 32).forEach((v) => visit(v, depth + 1, key));
    else if (typeof value === 'object') for (const [k, v] of Object.entries(value)) if (KEYS.has(k)) visit(v, depth + 1, k);
  }
  for (const field of ['stdout', 'stderr']) {
    const raw = error?.[field];
    if (typeof raw === 'string' || Buffer.isBuffer(raw)) visit(raw.toString());
  }
  // execFileSync.message embeds command arguments/output; only extract facts, never echo it.
  visit(error?.message);
  visit(error);
  const result = { stage: STAGES.has(stage) ? stage : 'diagnostic-read', parsedJson,
    message: [...summaries].slice(0, 6).join('; ') || 'Unrecognized CLI error; raw output withheld',
    httpStatus: [...status].sort().slice(0, 8), codes: [...codes].sort().slice(0, 12),
    permissions: [...permissions].sort().slice(0, 12), resources: [...resources].sort().slice(0, 12),
    endpoints: [...endpoints].sort().slice(0, 8), rawOutputWithheld: true };
  if (cliStatus) result.cliStatus = cliStatus;
  if (Number.isInteger(error?.status) && error.status >= 0 && error.status <= 255) result.exitCode = error.status;
  return result;
}

export class HostingCliError extends Error {
  constructor(error) {
    const diagnosis = sanitizeCliFailure(error);
    super(`Firebase CLI deploy failed: ${JSON.stringify(diagnosis)}`);
    this.name = 'HostingCliError';
    this.diagnosis = diagnosis;
    // No raw cause/stdout/stderr/stack from the child process is retained.
  }
}

export function versionObservation(version) {
  const name = String(version?.name || '');
  if (!new RegExp(`^sites/${SITE}/versions/[A-Za-z0-9_-]{1,64}$`).test(name)) return { unavailable: true };
  const result = { name };
  if (['CREATED', 'FINALIZED', 'DELETED', 'ABANDONED', 'EXPIRED'].includes(version.status)) result.status = version.status;
  for (const k of ['createTime', 'finalizeTime']) if (typeof version[k] === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(version[k])) result[k] = version[k];
  for (const k of ['fileCount', 'versionBytes']) if (/^\d+$/.test(String(version[k]))) result[k] = String(version[k]);
  return result;
}
