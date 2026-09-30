# Manual Firebase Hosting deployment (Phase 3D)

## Scope and current state

This change is based directly on main `d62c002fb2c0a58617bb770a3ff70c9f15b795d1`.
PR #6 / `phase3c-deployment-automation` remains independent and Cloud Run only.
Neither PR is merged by this automation. No Hosting, Cloud Run, IAM, WIF,
Secret, Rules or student data changes were performed to implement this PR.

Known production backend: `studentkeyword-api-00009-klk`, 100% traffic.
Known live Hosting release: `1790142455605000`, version `255f0b036e92c215`.
That frontend does not contain the Phase 3A explicit class creation UI.
Implementing or merging this workflow alone does not repair the live frontend.
A separately authorized Hosting deployment is required.

## Manual workflow and gates

`.github/workflows/deploy-hosting.yml` has only `workflow_dispatch` and only
accepts the exact `BoscoHeo1/StudentKeyword` repository on `refs/heads/main`.
The default mode is `validate`; `confirm_sha` is required in both modes.
The source gate verifies:

1. workflow SHA = checkout HEAD = supplied SHA = current public main;
2. an unchanged tracked checkout;
3. the latest `Verify source` main/push run for that SHA and its latest attempt;
4. completed/successful `Build and regression` and `Gitleaks` jobs.

It repeats source and configuration checks immediately before publication.
If main advanced during the build, publish is refused; dispatch again with
the new main SHA after its CI succeeds. A successful PR run is insufficient.

`validate` authenticates with the dedicated WIF identity and performs GET-only
project/site, live-channel and exact-version inspection. It installs no app/CLI
dependencies, does not build, snapshot public content, create a preview channel,
enable APIs, create versions or deploy. The local configuration must match the
current static `dist` configuration before any GCP call.

`deploy` requires environment variable `HOSTING_DEPLOY_ENABLED=true`, installs
the locked CLI, records the old release and entrypoint/JS/CSS hashes, and builds
a new `dist` from the exact checkout. Existing `dist` is rejected, not reused.
It runs app `npm ci`, TypeScript, mocked frontend/Hosting regression, production
build and artifact checks. Authentication files are external-account ADC, not
service account private keys; they must never be copied into `dist` or artifacts.

The only Firebase deployment command is:

```sh
firebase deploy --only hosting --project mykeyword-a832f --non-interactive \
  --json --message "sha=$GITHUB_SHA run=$GITHUB_RUN_ID attempt=$GITHUB_RUN_ATTEMPT"
```

The safety guard permits only the existing `hosting` section, `public: dist`,
the exact unpinned `/api/**` Cloud Run rewrite and SPA fallback, cache headers
and exclusions. Other products, Functions rewrites, `pinTag`, framework
deployment, predeploy/postdeploy hooks or unknown settings fail closed.
`--only hosting` alone is insufficient protection if pinned rewrites are added.
No Cloud Run deploy/update-traffic, rules, secrets, migration or student write
command is included.

## CLI version and reproducibility

Firebase CLI is pinned to **15.32.0**, installed with
`npm ci --prefix tools/hosting-cli --ignore-scripts --no-audit --no-fund`.
Its separate checked-in package-lock pins transitive dependencies and integrity
hashes without changing the application dependency tree. The script checks the
executable version before deploy. No global install or `latest` is used.

The published package supports Node 24, matching existing Verify source CI;
this PR uses Node 24. The installed CLI source is reviewed for Hosting-only
permission checks and the JSON deployment version result. Future upgrades must
repeat that review and the mock regressions. CLI installation/version checks
do not perform a production deploy.

## Identity and minimum IAM proposal — NOT APPLIED

Proposed dedicated identity:
`studentkeyword-hosting-deploy@mykeyword-a832f.iam.gserviceaccount.com`.
Do not reuse the Cloud Run deploy, build or runtime service accounts.
Do not generate keys, use `FIREBASE_TOKEN`, or grant Owner/Editor/Firebase Admin.

The existing `studentkeyword-github` pool can be reused with a **new**, reviewed
`github-main-hosting` provider. The existing `github-main-deploy` provider and
Cloud Run IAM bindings must remain unchanged. Suggested new mapping:

```text
google.subject = 'hosting:' + assertion.sub
attribute.hosting_repository = assertion.repository
```

Do not map `attribute.repository` for this provider: the existing Cloud Run
deploy SA accepts that pool's repository principalSet. Sharing that attribute
would permit Hosting tokens to reach the backend deploy identity. The new SA's
`roles/iam.workloadIdentityUser` binding must use only:

```text
principalSet://iam.googleapis.com/projects/783209447753/locations/global/workloadIdentityPools/studentkeyword-github/attribute.hosting_repository/BoscoHeo1/StudentKeyword
```

Restrict the new provider to immutable repository ID `1278700793`, owner ID
`285608743`, repository `BoscoHeo1/StudentKeyword`, `refs/heads/main`,
`workflow_dispatch`, exact workflow_ref
`BoscoHeo1/StudentKeyword/.github/workflows/deploy-hosting.yml@refs/heads/main`,
and subject `repo:BoscoHeo1/StudentKeyword:environment:hosting-production`.
Confirm these claims and absence of cross-identity access before enabling deploy.
If this boundary cannot be demonstrated, propose a separate pool for approval;
do not broaden existing bindings.

### Role comparison

Bindings below are on project `mykeyword-a832f` for the new SA only; they do not
provide site-level IAM isolation. The workflow fixes the site explicitly.

| Option | Permissions | Difference / remaining verification |
| --- | --- | --- |
| Documented predefined roles | `roles/firebasehosting.admin` plus `roles/serviceusage.apiKeysViewer` | Hosting Admin includes `firebasehosting.sites.create/delete/get/list/update`, `firebase.clients.get/list`, `firebase.projects.get`, `resourcemanager.projects.get/list`. API Keys Viewer includes `apikeys.keys.get/getKeyString/list/lookup`; it can read key strings and is not merely metadata access. |
| Existing-site custom role candidate | `firebasehosting.sites.get/list/update`, `firebase.projects.get`, `firebase.clients.get/list`, `resourcemanager.projects.get/list` | Omits site creation/deletion and API key reading. This is a candidate, not a demonstrated sufficient role for the complete CLI path. |

The pinned CLI Hosting target preflight requires `firebasehosting.sites.update`
plus shared `firebase.projects.get`; Hosting preparation reads an existing site,
and uses Hosting version/file/release APIs. Its optional implicit SDK setup
reads web-app configuration. These observations do **not** establish that API
Keys Viewer can be omitted: the official Firebase product-role documentation
explicitly lists it as an additional Firebase CLI requirement.

Before IAM approval, review the pinned CLI call path and read-only permission
tests with the proposed SA, including web-app configuration lookup requirements.
Do not add speculative permissions or print/read API key values for this review.
No write-path permission sufficiency claim can be made from this PR's mock tests.
Any required API key string access needs separate review; do not silently grant
the project-wide API Keys Viewer role. Missing/disabled APIs must stop the run;
no API enable or IAM administration role is granted to the workflow.

### Manual setup before first dispatch

After resource/IAM approval:

1. Create the dedicated SA/provider and approved minimal IAM bindings.
2. Configure GitHub environment `hosting-production`: required reviewer,
   prevent self-review where available, deployment branch main only.
   An `environment:` declaration alone does **not** enforce approval; configure
   and verify the protection rules in GitHub before enabling deploy.
3. Set environment variable `HOSTING_WIF_PROVIDER` to
   `projects/783209447753/locations/global/workloadIdentityPools/studentkeyword-github/providers/github-main-hosting`.
4. Run `validate` on current main and preserve its results; perform no deploy.
5. Set `HOSTING_DEPLOY_ENABLED=true` only after review, then obtain explicit
   authorization for the first production Hosting dispatch.

IAM/WIF rollback: disable Hosting dispatch by clearing the enable variable,
remove this SA's project role binding and WIF-user binding, disable/delete only
the new Hosting provider, and remove the unused new SA. Do not delete the shared
pool or touch the existing Cloud Run identities/provider. Resource creation and
deletion are administrative tasks, not performed by the workflow.

## Artifact/source verification

`tests/frontend-class-auth.mjs` executes the real unchanged Header component's
event handlers with mocked React renderer/hooks and API responses. It covers
CLASS_NOT_FOUND confirmation, cancellation/code correction without create,
explicit `confirmCreate:true`, existing login, wrong password, conflict and
rapid-click duplicate prevention. No real backend call is possible in that test.

The supplementary dist guard requires `CLASS_NOT_FOUND`, `/api/classes/create`,
`confirmCreate` and the Korean confirmation title in the generated JS. It records
all public file paths, sizes and uncompressed SHA-256 hashes, rejects unexpected
files/symlinks, and checks that HTML references existing JS/CSS files.

After publish, the controller requires the version returned by the pinned CLI's
JSON result, the exact unique release message, a server release time no earlier
than publication start, and that version as the current live version. It GETs
`/` and every local public file, compares hashes, and GETs `/api/config` (410).
Matching all JS bytes also verifies the checked Phase 3A markers. It calls no
class auth/create/student-write endpoint. It rechecks live ownership/history
after smoke; successful log output alone is not deployment verification.

## Concurrency and evidence

The workflow concurrency group serializes its own Hosting runs without
canceling an in-progress deployment. Baseline/live checks detect changes during
snapshot and build. Live-channel release history must contain exactly the new
candidate followed by the recorded old release: a foreign release is rejected,
even if our candidate is the latest. Missing/truncated baseline history fails.

**Hosting release creation has no compare-and-swap precondition used here.**
External console/CLI deployments are not locked by GitHub concurrency. They must
be paused during a production deployment/rollback. The checks detect observable
intervening releases but cannot prevent a writer in the gap between a read and
publication, or after the last check. Never claim atomic mutual exclusion.

Sanitized records in `$RUNNER_TEMP/studentkeyword-hosting-evidence` include
previous release/version, previous HTML/JS/CSS hashes, exact source/CI run,
new artifact hashes, CLI-created version, candidate release/message/time and
final outcome. They are uploaded as a 90-day GitHub artifact. Retain the records
longer externally if needed. No tokens, credential files, CLI debug logs or
environment dumps are uploaded. Release message preserves SHA/run/attempt even
after artifact retention expires. No unsupported CLI Git-SHA-label flag is used.

Separate workflows guarantee the same SHA between CI, checkout, frontend build
and Hosting. For a coordinated backend/frontend release, explicitly use that
same SHA in each workflow and compare deployment records. An unpinned Hosting
rewrite follows current Cloud Run traffic; it does not guarantee backend source
SHA equality. An independent frontend deployment must retain backend API
compatibility. Neither workflow automatically executes the other.

## Rollback and manual recovery

After an owned candidate fails smoke, automatic rollback is allowed only while
live still identifies our exact candidate/message and no foreign release has
intervened. It creates a new Hosting rollback release selecting the saved old
version, then verifies returned release identity, live version, release history,
old entrypoint/JS/CSS hashes and unchanged live ownership. A rollback API or
verification failure is explicitly reported; the job remains failed even when
rollback succeeds. No `|| true` masks recovery failures.

If CLI publication fails without a reliable version result, ownership cannot
be established. If another deployment intervenes, automatic rollback is refused.
Use the preserved evidence for separately authorized manual recovery:

1. Confirm saved previous version is retained/FINALIZED and safe rewrites remain.
2. Query current live and history; identify the current owner and pause writers.
3. After approval, use Firebase Hosting console release history rollback or
   `POST https://firebasehosting.googleapis.com/v1beta1/sites/mykeyword-a832f/channels/live/releases?versionName=OLD_VERSION`
   with `{ "message": "rollback sha=... run=..." }`. Do not set an output-only
   release type; selecting the saved version performs the content rollback.
4. GET live channel and exact version; verify OLD_VERSION and the new rollback
   release ID. Compare `/` and referenced JS/CSS with saved previous hashes.
5. Record the rollback release/time/outcome. Do not delete old versions.

Rollback restores Hosting content/configuration only. In the guarded unpinned
configuration it does not deploy or change Cloud Run, Rules, IAM, secrets or data.

## Validation and sources

Run existing lint/build/security/auth/request-limit/AI QA (51) checks plus the
new frontend and Hosting tests, artifact guard, repository policy, YAML/inline
shell syntax, diff check and Gitleaks. Phase 3C mock regression is run separately
in the unchanged PR #6 worktree: those files are not copied into this main-based
branch. No actual Gemini smoke test or real production validate/deploy is run.

- [Firebase CLI and ADC](https://firebase.google.com/docs/cli)
- [Firebase product roles](https://firebase.google.com/docs/projects/iam/roles-predefined-product)
- [API Keys Viewer permissions](https://docs.cloud.google.com/iam/docs/roles-permissions/serviceusage)
- [Firebase CLI 15.32.0](https://github.com/firebase/firebase-tools/releases/tag/v15.32.0)
- [Live channel inspection](https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.channels/get)
- [Release creation / version selection](https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.releases/create)
- [WIF deployment pipeline identities](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)
