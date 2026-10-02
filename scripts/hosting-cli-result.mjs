import assert from 'node:assert/strict';
import { SITE } from './hosting-safety.mjs';

// 15.32.0: command.js wraps deploy/index.js's { hosting: string | string[] }.
// No recursive/string scan; only this documented field can nominate a version.
// An absent field or empty array supplies no candidate, never ownership.
export function extractHostingVersionFromCliResult(payload) {
  let output = payload;
  if (typeof payload === 'string') {
    assert(payload.length <= 1024 * 1024, 'Hosting CLI response too large');
    try { output = JSON.parse(payload); }
    catch { throw new Error('Malformed Hosting CLI JSON; raw output withheld'); }
  }
  assert(output && typeof output === 'object' && !Array.isArray(output), 'Malformed Hosting CLI success payload');
  assert(output.status === 'success', 'Hosting CLI did not report success');
  const result = output.result;
  assert(result && typeof result === 'object' && !Array.isArray(result), 'CLI must identify this deployment version: missing result object');
  assert(Object.keys(result).every((key) => key === 'hosting'), 'Unsupported Hosting CLI result shape');
  if (!Object.hasOwn(result, 'hosting')) return null;
  let version = result.hosting;
  if (Array.isArray(version)) {
    assert(version.length <= 1, 'Ambiguous Hosting CLI versions');
    if (version.length === 0) return null;
    [version] = version;
  }
  assert(typeof version === 'string', 'Malformed Hosting CLI version');
  // Do not pass received text as assertion actual/expected: it may be sensitive.
  assert(new RegExp(`^sites/${SITE}/versions/[A-Za-z0-9_-]+$`).test(version), 'Unexpected Hosting CLI site/version');
  return version;
}
