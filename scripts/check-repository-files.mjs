import { execFileSync } from 'node:child_process';

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const blocked = tracked.filter((file) => {
  const name = file.split('/').at(-1);
  return (
    /(^|\/)\.env(?:\..*)?$/.test(file) ||
    /^(?:node_modules|dist|server-dist|data|\.firebase)\//.test(file) ||
    /(?:^|\/)(?:HANDOFF|RENDER-MIGRATION-RUNBOOK|SOURCE-OF-TRUTH-MIGRATION)\.md$/.test(file) ||
    /(?:^|\/)(?:credential|credentials|service[-_]account|backup|archive)[^/]*\.(?:json|key|pem|p12|pfx|tar|gz|zip)$/i.test(file) ||
    /\.(?:log|tar|tar\.gz|tgz|zip|pem|key|p12|pfx)$/i.test(name)
  );
});

if (blocked.length > 0) {
  console.error('Forbidden tracked files:', blocked.join(', '));
  process.exitCode = 1;
} else {
  console.log(`Tracked-file policy passed (${tracked.length} files).`);
}
