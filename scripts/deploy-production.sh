#!/usr/bin/env bash
set -Eeuo pipefail

mode="${1:-}"
[[ "$mode" == validate || "$mode" == deploy ]] || { echo 'Expected validate or deploy' >&2; exit 2; }

project=mykeyword-a832f
region=asia-northeast3
service=studentkeyword-api
runtime_account=studentkeyword-run@mykeyword-a832f.iam.gserviceaccount.com
build_account=studentkeyword-build@mykeyword-a832f.iam.gserviceaccount.com
image_root=asia-northeast3-docker.pkg.dev/mykeyword-a832f/studentkeyword/studentkeyword-api

[[ "${GITHUB_REPOSITORY:-}" == BoscoHeo1/StudentKeyword ]]
[[ "${GITHUB_REF:-}" == refs/heads/main ]]
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]]
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]]

before="$(mktemp)"
after="$(mktemp)"
build_record="$(mktemp)"
trap 'rm -f "$before" "$after" "$build_record"' EXIT

gcloud run services describe "$service" --project="$project" --region="$region" --format=json > "$before"
old_revision="$(jq -er '[.status.traffic[] | select(.percent == 100) | .revisionName] | if length == 1 then .[0] else error("Expected exactly one 100% production revision") end' "$before")"
current_account="$(jq -er '.spec.template.spec.serviceAccountName' "$before")"
[[ "$current_account" == "$runtime_account" ]] || { echo 'Unexpected runtime service account' >&2; exit 1; }
echo "Current production: $old_revision (100%); source: $GITHUB_SHA"

if [[ "$mode" == validate ]]; then
  gcloud iam service-accounts describe "$build_account" --project="$project" --format='value(email)' >/dev/null
  gcloud artifacts repositories describe studentkeyword --project="$project" --location="$region" --format='value(name)' >/dev/null
  echo 'Read-only production prerequisites passed; no build or deployment started.'
  exit 0
fi

[[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ && "${GITHUB_RUN_ATTEMPT:-}" =~ ^[0-9]+$ ]]
tag="sha-${GITHUB_SHA}-r${GITHUB_RUN_ID}-a${GITHUB_RUN_ATTEMPT}"
image_tag="$image_root:$tag"
if gcloud artifacts docker images describe "$image_tag" --project="$project" --format='value(image_summary.digest)' >/dev/null 2>&1; then
  echo "Image tag already exists: $image_tag" >&2
  exit 1
fi

gcloud builds submit --project="$project" --region="$region" --no-source \
  --config=cloudbuild.production.yaml \
  --substitutions="_SOURCE_SHA=$GITHUB_SHA,_IMAGE=$image_tag" \
  --async --quiet --format=json > "$build_record"
build_id="$(jq -er '.id' "$build_record")"
echo "Cloud Build ID: $build_id"

for _ in {1..90}; do
  gcloud builds describe "$build_id" --project="$project" --region="$region" --format=json > "$build_record"
  build_status="$(jq -er '.status' "$build_record")"
  case "$build_status" in
    SUCCESS) break ;;
    FAILURE|INTERNAL_ERROR|TIMEOUT|CANCELLED|EXPIRED)
      echo "Cloud Build failed: $build_status ($build_id)" >&2
      exit 1 ;;
  esac
  sleep 10
done
[[ "$build_status" == SUCCESS ]] || { echo 'Cloud Build did not finish in time' >&2; exit 1; }

digest="$(jq -er --arg name "$image_tag" '[.results.images[] | select(.name == $name) | .digest] | if length == 1 then .[0] else error("Expected one built image digest") end' "$build_record")"
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo 'Invalid built image digest' >&2; exit 1; }
image_digest="$image_root@$digest"
echo "Built image: $image_tag"
echo "Immutable digest: $image_digest"

# Abort if a person or another system changed production during the build.
gcloud run services describe "$service" --project="$project" --region="$region" --format=json > "$after"
[[ "$(jq -er '[.status.traffic[] | select(.percent == 100) | .revisionName] | .[0]' "$after")" == "$old_revision" ]]

preview_tag="p${GITHUB_SHA:0:12}r${GITHUB_RUN_ID}a${GITHUB_RUN_ATTEMPT}"
gcloud run deploy "$service" --project="$project" --region="$region" \
  --image="$image_digest" --no-traffic --tag="$preview_tag" --quiet
gcloud run services describe "$service" --project="$project" --region="$region" --format=json > "$after"
new_revision="$(jq -er '.status.latestCreatedRevisionName' "$after")"
[[ "$new_revision" != "$old_revision" ]]
[[ "$(jq -er '[.status.traffic[] | select(.percent == 100) | .revisionName] | .[0]' "$after")" == "$old_revision" ]]
[[ "$(jq -c '.spec.template.spec | .containers[0].image = ""' "$before")" == "$(jq -c '.spec.template.spec | .containers[0].image = ""' "$after")" ]] || {
  echo 'Runtime settings differ from the previous revision; traffic unchanged.' >&2
  exit 1
}

ready=false
for _ in {1..30}; do
  condition="$(gcloud run revisions describe "$new_revision" --project="$project" --region="$region" --format=json \
    | jq -r '[.status.conditions[] | select(.type == "Ready") | .status] | .[0] // "Unknown"')"
  if [[ "$condition" == True ]]; then ready=true; break; fi
  if [[ "$condition" == False ]]; then break; fi
  sleep 10
done
[[ "$ready" == true ]] || { echo "New revision is not Ready: $new_revision" >&2; exit 1; }

preview_url="$(jq -er --arg tag "$preview_tag" '[.status.traffic[] | select(.tag == $tag) | .url] | .[0]' "$after")"
service_url="$(jq -er '.status.url' "$after")"

check_status() {
  local expected="$1" url="$2"; shift 2
  local actual
  actual="$(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' "$@" "$url")"
  [[ "$actual" == "$expected" ]] || { echo "Smoke failed: $url returned $actual, expected $expected" >&2; return 1; }
}

smoke() {
  local base="$1"
  check_status 200 "$base/"
  check_status 410 "$base/api/config"
  check_status 401 "$base/api/classes/session"
  check_status 403 "$base/api/classes/logout" -X POST
  check_status 200 "$base/api/classes/logout" -X POST -H 'Origin: https://mykeyword-a832f.web.app'
}

smoke "$preview_url"
echo "Preview smoke passed: $new_revision"

rollback_on_error() {
  echo "Post-switch failure; restoring $old_revision to 100% traffic." >&2
  gcloud run services update-traffic "$service" --project="$project" --region="$region" \
    --to-revisions="$old_revision=100" --quiet || true
}
trap rollback_on_error ERR
gcloud run services update-traffic "$service" --project="$project" --region="$region" \
  --to-revisions="$new_revision=100" --quiet
smoke "$service_url"
gcloud run services describe "$service" --project="$project" --region="$region" --format=json > "$after"
[[ "$(jq -er '[.status.traffic[] | select(.percent == 100) | .revisionName] | .[0]' "$after")" == "$new_revision" ]]
trap - ERR
echo "Production revision: $new_revision (100%); rollback revision retained: $old_revision"
