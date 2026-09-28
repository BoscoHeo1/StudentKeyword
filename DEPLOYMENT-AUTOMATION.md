# Manual production deployment (Phase 3C)

The `Deploy production manually` GitHub Action has only a `workflow_dispatch` trigger. Select `main`, run `validate` first, and confirm that `Verify source` passed for the current main SHA. For `deploy`, enter that complete SHA in `confirm_sha`. A changed main, a missing CI success, or a mismatched SHA stops the run before any build. Configure the `production` GitHub environment with required reviewers if an additional human approval gate is desired; the typed SHA is the required confirmation in the workflow itself. Do not add a `push` or `pull_request` trigger to the deploy workflow.

The workflow uses GitHub OIDC to impersonate a dedicated deploy service account. Cloud Build uses a different build service account. The Cloud Run runtime keeps `studentkeyword-run@mykeyword-a832f.iam.gserviceaccount.com`. No service account keys or GitHub secrets are needed. Set these non-secret GitHub repository variables before the first `validate` run:

| Variable | Value |
| --- | --- |
| `GCP_DEPLOY_WIF_PROVIDER` | `projects/783209447753/locations/global/workloadIdentityPools/studentkeyword-github/providers/github-main-deploy` |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | `studentkeyword-deploy@mykeyword-a832f.iam.gserviceaccount.com` |

## GCP setup to review before applying

The project currently has no Workload Identity Federation pool and no dedicated build or deploy account. Create only these resources and bindings after checking the current IAM policy:

| Resource or binding | Role and scope | Purpose |
| --- | --- | --- |
| WIF pool `studentkeyword-github`, provider `github-main-deploy` | GitHub OIDC issuer; condition restricts `repository` to `BoscoHeo1/StudentKeyword`, `ref` to `refs/heads/main`, `event_name` to `workflow_dispatch`, and `workflow_ref` to `BoscoHeo1/StudentKeyword/.github/workflows/deploy-production.yml@refs/heads/main` | Accept only this manual main workflow. Map `google.subject=assertion.sub` and `attribute.repository=assertion.repository`. |
| `studentkeyword-deploy@...` | `roles/iam.workloadIdentityUser` on this account for the pool's `attribute.repository/BoscoHeo1/StudentKeyword` principal set | Keyless GitHub impersonation. |
| Deploy account | Custom role on project `mykeyword-a832f` with `cloudbuild.builds.create`, `cloudbuild.builds.get`, `cloudbuild.builds.list`, and `serviceusage.services.use` | Submit and inspect a build. |
| Deploy account | `roles/iam.serviceAccountUser` on `studentkeyword-build@...` | Submit a build using only that build identity. |
| Deploy account | `roles/run.developer` on Cloud Run service `studentkeyword-api` only | Create a revision and change its traffic. |
| Deploy account | `roles/iam.serviceAccountUser` on runtime account `studentkeyword-run@...` | Keep the existing runtime identity when deploying. |
| Deploy account | `roles/artifactregistry.reader` on existing `studentkeyword` repository in `asia-northeast3` | Check image tag existence and read the built digest. |
| `studentkeyword-build@...` | `roles/artifactregistry.writer` on that repository only; `roles/logging.logWriter` on project | Build/push the image and write Cloud Build logs. No Secret Manager or Firestore access. |

Do not grant Owner, Editor, Secret Manager access, Firestore access, or project-wide Artifact Registry writer. Confirm the selected Cloud Build service account and whether its agent needs any existing service-agent binding before applying IAM. The WIF provider and accounts do not themselves start builds or deployments; an executed build consumes billable Cloud Build time, its immutable image consumes Artifact Registry storage, and a new Cloud Run revision may incur usage. See [Cloud Build pricing](https://cloud.google.com/build/pricing) and [Artifact Registry pricing](https://cloud.google.com/artifact-registry/pricing).

To undo this setup, remove the deploy account's service, registry, build, and service-account bindings; remove its WIF impersonation binding; disable or delete the provider and pool after verifying no other workload uses them; then delete the two dedicated service accounts. Do not delete the existing Artifact Registry repository or the Cloud Run runtime account.

## What a deploy run does

1. Checks that the selected commit is the current public `main` and its `Verify source` workflow succeeded.
2. Uses a keyless token and checks current production configuration. `validate` stops here without a build.
3. For `deploy`, Cloud Build clones public `main`, verifies its exact SHA, and builds `sha-<full SHA>-r<run ID>-a<attempt>` in the existing Artifact Registry repository. A duplicate tag fails closed. The build ID and image digest are logged.
4. Deploys the image **by digest** with `--no-traffic`, verifies the old revision still has 100% traffic, checks the new revision is Ready, and compares runtime service account and container settings to the previous revision.
5. Performs read-only HTTP checks against the tagged candidate: `/` 200, `/api/config` 410, unauthenticated `/api/classes/session` 401, logout without Origin 403, and logout with the allowed Hosting Origin 200. Logout clears only the request's empty cookie; it does not touch student data.
6. Switches traffic to the new revision, repeats the checks, and attempts to restore the old revision to 100% if a post-switch step fails. Old revisions are retained.

The workflow does not deploy Firebase Hosting or Firestore Rules, change IAM or secrets, run a database migration, or use Gemini. It does not create, modify, or delete student data.

## Manual rollback

Use the **previous revision recorded in that deployment run**, not a hard-coded revision. For the current pre-Phase-3C production state, the revision is `studentkeyword-api-00009-klk`:

```sh
gcloud run services update-traffic studentkeyword-api \
  --project=mykeyword-a832f --region=asia-northeast3 \
  --to-revisions=studentkeyword-api-00009-klk=100
gcloud run services describe studentkeyword-api \
  --project=mykeyword-a832f --region=asia-northeast3 \
  --format='table(status.traffic.revisionName,status.traffic.percent)'
```

Review the service and candidate revision after any failure. A failed pre-traffic check leaves production traffic on its prior revision; it may leave a 0% candidate revision and image for later investigation.
