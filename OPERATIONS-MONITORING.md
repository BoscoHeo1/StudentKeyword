# Operations monitoring plan

Status: design only, not activated. Project: mykeyword-a832f; Cloud Run service: studentkeyword-api.

Read-only check on 2026-09-27: Cloud Run logs exist; no custom log-based metrics, alerting policies, or notification channels were listed. The service can scale to 20 instances at concurrency 80. Confirm a notification destination and any recurring Monitoring/Logging cost before creating policies. Do not include request bodies, student names, keywords, credentials, or Gemini responses in log filters or alert text.

## Proposed signals

| Signal | Safe source | Initial review threshold | Action |
| --- | --- | --- | --- |
| Cloud Run 5xx | Cloud Run request count or request log status | 5 in 5 minutes | Inspect revision health and recent errors; do not roll back automatically. |
| Request surge | Cloud Run request count | Establish 7-day baseline before setting a threshold | Distinguish classroom use from abuse. |
| Firestore failure | Server 503 request count plus sanitized error category | 3 in 5 minutes | Check Firestore availability/IAM without printing documents. |
| Gemini failure | Sanitized fixed Gemini failure log messages | 3 in 15 minutes | Check API/secret reference and fallback rate; do not print model output. |
| Teacher login failures | POST /api/classes/auth request status 401 | 10 in 15 minutes | Review abuse or user access trouble. |
| Submission surge | POST /api/submissions request count | Establish class-hour baseline before threshold | Check classroom schedule and rate-limit 429s. |

All thresholds are proposals, not assertions about normal traffic. Cloud Run request logs can contain URLs; aggregate statuses and counts rather than exporting individual entries. Existing server-side teacher login limits are per-instance. Proposed student and AI limits on the operations branch are also per-instance and best-effort; they do not provide a global quota across 20 instances.

Activation sequence: choose recipient/channel; verify Monitoring pricing and IAM; create one low-noise 5xx policy; test delivery without changing student data; observe a week; then add scoped signals after baseline review. No alert policies or log-based metrics are created by this document.

Official references: https://docs.cloud.google.com/run/docs/monitoring and https://docs.cloud.google.com/monitoring/alerts and https://cloud.google.com/products/observability/pricing
