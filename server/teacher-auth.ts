import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const TTL = 8 * 60 * 60;
const developmentKey = randomBytes(32);
const production = () => process.env.NODE_ENV === "production";
// Firebase Hosting forwards only this cookie name to Cloud Run rewrites.
const cookieName = () => production() ? "__session" : "teacher_session";

export interface TeacherSession {
  classCode: string;
  authVersion: number;
  iat: number;
  exp: number;
  purpose: "teacher";
}

function signingKey(): Buffer {
  const secret = process.env.TEACHER_AUTH_SECRET;
  if (secret && Buffer.byteLength(secret) >= 32) return Buffer.from(secret);
  if (production() || secret) throw new Error("TEACHER_AUTH_SECRET must contain at least 32 bytes.");
  return developmentKey;
}

export function assertTeacherAuthConfigured(): void { signingKey(); }

export function signTeacherSession(classCode: string, authVersion: number, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({ classCode, authVersion, iat, exp: iat + TTL, purpose: "teacher" })).toString("base64url");
  return payload + "." + createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

export function verifyTeacherToken(token: string, now = Date.now()): TeacherSession | null {
  if (token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
  const expected = createHmac("sha256", signingKey()).update(parts[0]).digest();
  const signature = Buffer.from(parts[1], "base64url");
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const seconds = Math.floor(now / 1000);
    if (value.purpose !== "teacher" || typeof value.classCode !== "string" || !value.classCode
      || value.classCode !== value.classCode.trim().toLowerCase()
      || !Number.isSafeInteger(value.authVersion) || value.authVersion < 0
      || !Number.isSafeInteger(value.iat) || !Number.isSafeInteger(value.exp)
      || value.iat > seconds || value.exp <= seconds || value.exp - value.iat !== TTL) return null;
    return value;
  } catch { return null; }
}

export function readTeacherSession(req: Request): TeacherSession | null {
  const prefix = cookieName() + "=";
  const values = (req.headers.cookie || "").split(";").map(v => v.trim()).filter(v => v.startsWith(prefix));
  if (values.length !== 1) return null;
  try { return verifyTeacherToken(decodeURIComponent(values[0].slice(prefix.length))); }
  catch { return null; }
}

const cookieOptions = () => ({ httpOnly: true, secure: production(), sameSite: "lax" as const, path: "/" });

export function issueTeacherCookie(res: Response, classCode: string, authVersion: number): void {
  res.cookie(cookieName(), signTeacherSession(classCode, authVersion), { ...cookieOptions(), maxAge: TTL * 1000 });
  res.setHeader("Cache-Control", "no-store");
}
export function clearTeacherCookie(res: Response): void {
  res.clearCookie(cookieName(), cookieOptions());
  res.setHeader("Cache-Control", "no-store");
}

export function requireTeacherOrigin(req: Request, res: Response, next: NextFunction): void {
  const configured = process.env.TEACHER_ALLOWED_ORIGINS
    || (!production() ? "http://localhost:3000,http://127.0.0.1:3000" : "");
  const origins = configured.split(",").map(v => v.trim()).filter(Boolean);
  const origin = req.get("origin");
  // Do not trust Host/X-Forwarded-Host or accept an absent/null Origin.
  if (!origin || origin === "null" || !origins.includes(origin)) {
    res.status(403).json({ success: false, message: "허용되지 않은 요청 출처입니다." }); return;
  }
  next();
}

const attempts = new Map<string, { count: number; until: number }>();
function consume(key: string, limit: number, now: number): boolean {
  for (const [k, value] of attempts) if (value.until <= now) attempts.delete(k);
  let entry = attempts.get(key);
  if (!entry) {
    if (attempts.size >= 10000) return false;
    entry = { count: 0, until: now + 15 * 60 * 1000 };
    attempts.set(key, entry);
  }
  return ++entry.count <= limit;
}

export function teacherRateLimit(req: Request, res: Response, next: NextFunction): void {
  // No untrusted forwarded headers. A proxy may share this budget across users.
  const peer = req.socket.remoteAddress || "unknown";
  const session = readTeacherSession(req);
  const code = req.path === "/api/classes/auth" ? req.body?.classCode : session?.classCode;
  const now = Date.now();
  const peerAllowed = consume("peer:" + peer, 60, now);
  const classAllowed = typeof code !== "string" || consume("class:" + code.trim().toLowerCase(), 10, now);
  if (!peerAllowed || !classAllowed) {
    res.setHeader("Retry-After", "900");
    res.status(429).json({ success: false, message: "요청이 너무 많습니다. 15분 후 다시 시도해주세요." }); return;
  }
  next();
}
