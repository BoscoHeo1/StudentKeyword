# Firestore backup and restore runbook

Status: prepared, not activated. Project: mykeyword-a832f. Database: (default), Firestore Native, asia-northeast3.

## Scope and current baseline

The database contains classes, submissions, and any config documents. Scheduled Firestore backups cover the entire database and indexes, so these collections are included. As of 2026-09-27, no backup schedule and no backup were listed. The previous read-only data baseline was classes 2 and submissions 3; collect a fresh count before any actual change. Never print student records, passwords, hashes, or IDs in a ticket.

## Choice and cost gate

Recommend one daily Firestore managed backup retained for 7 days. The backup remains in asia-northeast3 and needs no new storage bucket. Backup storage is billed by size and retention; restores are billed by size. Database size and future growth are unknown, so no exact cost is asserted. Billing is enabled. Get approval for recurring cost and confirm the operator has the backup-schedule permission before creation; do not broaden IAM without a separate reason and approval.

Managed export is an alternative when portable files or selective collection-group export are needed. It requires a Cloud Storage bucket, export/import permissions, document-read/write charges, and storage cost. It is not the default here.

## Activation gate (do not run until approved)

1. Confirm project, database location, billing, existing schedule/backup list, and current deny-all Rules. Check a fresh non-sensitive count/fingerprint baseline.
2. Confirm 7-day retention and ongoing cost acceptance. Use an authorized operator; do not create service-account keys.
3. Create a daily schedule:

    gcloud firestore backups schedules create --project=mykeyword-a832f --database='(default)' --recurrence=daily --retention=7d

4. List the schedule and record its identifier. Later list backups in asia-northeast3 and verify the first backup is READY. A schedule alone does not prove a usable backup exists.
5. Record the first READY backup timestamp and size without exposing its contents. Review costs and retention after the first week.

Read-only checks:

    gcloud firestore backups schedules list --project=mykeyword-a832f --database='(default)'
    gcloud firestore backups list --project=mykeyword-a832f --location=asia-northeast3 --format='table(name,state,backupTime,expireTime)'

## Restore decision and isolation

A restore is a separate, explicitly approved incident action. First preserve evidence and stop writes if needed. Choose a READY backup whose timestamp precedes corruption; calculate potential data loss from its backup time. Firestore scheduled-backup restore creates a NEW database; it does not silently replace (default). Do not point production Cloud Run at it during inspection.

1. Record current classes/submissions/config counts and ID-set fingerprints without printing data. Confirm the selected backup identifier and state.
2. Obtain approval for restore cost, a new database, and any needed IAM. Restore to an unused database ID by following the official Firestore restore procedure. Never use (default) as the destination.
3. Inspect the restored database using an authorized server-side identity. Compare counts and fingerprints. Check application schema compatibility.
4. Backups do not include Firebase Security Rules or TTL policies. Verify deny-all Rules and IAM for the restored database before any client or application access.
5. Prepare a separate, reviewed cutover plan if production must use restored data. Preserve the original database and avoid automatic overwrites or deletes. Run Hosting/Cloud Run read-only smoke checks after any approved cutover.
6. Record backup ID, restore operation ID, validation results, decision, and rollback boundary. Do not record student data or secrets.

If the backup is missing, failed, too old, or count/fingerprint checks differ unexpectedly, stop; do not overwrite production data. A restore to a new database can be abandoned without changing the current service, but a later application cutover needs its own rollback plan.

Official references: https://docs.cloud.google.com/firestore/native/docs/backups and https://docs.cloud.google.com/firestore/native/docs/manage-data/export-import
