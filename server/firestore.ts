import { readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

// Imported only by server.ts, never by src/ or any browser entry point.
let database: Firestore | undefined;

export function getServerFirestore(): Firestore {
  if (typeof window !== "undefined") throw new Error("Server-only module");
  if (database) return database;
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
    const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const cloudRun = Boolean(process.env.K_SERVICE);
    if (!projectId || (json && file) || (cloudRun && (json || file)) || (!cloudRun && !json && !file)) {
      throw new Error("Missing or ambiguous credentials");
    }
    const name = "studentkeyword-server";
    const existing = getApps().find(app => app.name === name);
    if (existing && existing.options.projectId !== projectId) throw new Error("Project mismatch");
    let credential;
    if (cloudRun) {
      // Cloud Run obtains short-lived credentials from its runtime service account.
      credential = applicationDefault();
    } else {
      const serviceAccount = JSON.parse(json || readFileSync(file!, "utf8"));
      if (serviceAccount.type !== "service_account" || serviceAccount.project_id !== projectId
        || typeof serviceAccount.client_email !== "string" || !serviceAccount.client_email
        || typeof serviceAccount.private_key !== "string" || !serviceAccount.private_key) {
        throw new Error("Invalid service account");
      }
      credential = cert(serviceAccount);
    }
    const app = existing || initializeApp({ projectId, credential }, name);
    database = getFirestore(app);
    return database;
  } catch {
    // Never log credentials or fall back to another project/store.
    throw new Error("Server Firestore configuration is unavailable.");
  }
}
