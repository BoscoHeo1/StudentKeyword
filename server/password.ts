import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const PREFIX = "scrypt-v1";
const OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, OPTIONS, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function createPasswordHash(password: string): Promise<string> {
  const normalized = password.trim();
  if (!normalized) throw new Error("Password must not be empty.");
  const salt = randomBytes(16);
  const key = await derive(normalized, salt);
  return `${PREFIX}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPasswordHash(password: string, hash: unknown): Promise<boolean> {
  if (typeof password !== "string" || typeof hash !== "string") return false;
  const match = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(hash);
  if (!match || !password.trim()) return false;
  const actual = await derive(password.trim(), Buffer.from(match[1], "hex"));
  return timingSafeEqual(actual, Buffer.from(match[2], "hex"));
}

export async function verifyClassPassword(
  password: string,
  config: { passwordHash?: string; password?: string }
): Promise<{ valid: boolean; needsMigration: boolean }> {
  // Even an invalid/empty hash must never fall back to the legacy password.
  if (Object.prototype.hasOwnProperty.call(config, "passwordHash")) {
    return { valid: await verifyPasswordHash(password, config.passwordHash), needsMigration: false };
  }
  const valid = typeof password === "string" && password.trim().length > 0
    && typeof config.password === "string" && config.password === password.trim();
  // Informational only: callers must not persist a migration in this phase.
  return { valid, needsMigration: valid };
}

