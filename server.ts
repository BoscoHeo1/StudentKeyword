import express from "express";
import path from "path";
import { randomUUID } from "node:crypto";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { StudentSubmission } from "./src/types";
import { createPasswordHash, verifyClassPassword } from "./server/password";
import { assertTeacherAuthConfigured, issueTeacherCookie, clearTeacherCookie, readTeacherSession, requireTeacherOrigin, teacherRateLimit } from "./server/teacher-auth";
import { getServerFirestore } from "./server/firestore";
import { createWindowRateLimiter } from "./server/request-limit";
import { FieldValue } from "firebase-admin/firestore";

const app = express();

const studentRequestLimit = createWindowRateLimiter(15 * 60 * 1000);
const aiRequestLimit = createWindowRateLimiter(15 * 60 * 1000);

export function resolvePort(value = process.env.PORT): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : 3000;
}

const PORT = resolvePort();

// Korean name friendly calling helper
function getFriendlyName(name: string): string {
  if (!name) return "";
  let callName = name;
  if (name.length === 3) {
    callName = name.substring(1); // e.g. "김민준" -> "민준"
  } else if (name.length === 4) {
    callName = name.substring(2); // e.g. "황보현우" -> "현우"
  }
  const lastChar = callName.charAt(callName.length - 1);
  const code = lastChar.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const batchim = (code - 0xac00) % 28;
    if (batchim > 0) {
      return `${callName}아`;
    } else {
      return `${callName}야`;
    }
  }
  return `${callName}야`;
}

// Post-process report card draft to strictly adhere to the rules
function postProcessDraft(draft: string): string {
  if (!draft) return "";
  
  // 1. Remove all newlines and line breaks
  let cleaned = draft.replace(/[\r\n]+/g, " ");
  
  // 2. Remove math symbols and English letters (preserving units like cm, kg, m, g, etc.)
  // Replace mathematical characters
  cleaned = cleaned.replace(/\+/g, " 덧셈 ");
  cleaned = cleaned.replace(/-/g, " 뺄셈 ");
  cleaned = cleaned.replace(/X/g, " 곱셈 ");
  cleaned = cleaned.replace(/\*/g, " 곱셈 ");
  cleaned = cleaned.replace(/\//g, " 나눗셈 ");
  cleaned = cleaned.replace(/=/g, " 같음 ");
  
  // Protect measuring units (case insensitive)
  const units = ["cm", "kg", "mm", "ml", "km", "kg", "g", "m", "l"];
  const placeholders: string[] = [];
  units.forEach((unit, idx) => {
    const regex = new RegExp(`\\b${unit}\\b`, "gi");
    const placeholder = `__UNIT_PLACEHOLDER_${idx}__`;
    placeholders.push(placeholder);
    cleaned = cleaned.replace(regex, placeholder);
  });
  
  // Remove any remaining English alphabet characters
  cleaned = cleaned.replace(/[a-zA-Z]/g, "");
  
  // Restore measuring units
  units.forEach((unit, idx) => {
    const placeholder = `__UNIT_PLACEHOLDER_${idx}__`;
    cleaned = cleaned.replace(new RegExp(placeholder, "g"), unit);
  });

  // 3. Normalize multiple spaces to single spaces
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // 4. Force sentence-endings to follow Korean rules (~함., ~임.)
  cleaned = cleaned.replace(/합니다\./g, "함.");
  cleaned = cleaned.replace(/입니다\./g, "임.");
  cleaned = cleaned.replace(/가지고 있습니다\./g, "지님.");
  cleaned = cleaned.replace(/있습니다\./g, "임.");
  cleaned = cleaned.replace(/보여줍니다\./g, "보임.");
  cleaned = cleaned.replace(/태도를 보임\./g, "태도가 우수함.");
  cleaned = cleaned.replace(/행동을 보여줌\./g, "모습을 보임.");
  cleaned = cleaned.replace(/할 수 있음\./g, "함.");
  cleaned = cleaned.replace(/수 있음\./g, "함.");
  cleaned = cleaned.replace(/있음\./g, "임.");
  cleaned = cleaned.replace(/돋보입니다\./g, "돋보임.");
  cleaned = cleaned.replace(/우수합니다\./g, "우수함.");
  cleaned = cleaned.replace(/뛰어납니다\./g, "뛰어남.");
  cleaned = cleaned.replace(/참여합니다\./g, "참여함.");
  cleaned = cleaned.replace(/노력합니다\./g, "노력함.");
  cleaned = cleaned.replace(/바람직합니다\./g, "바람직함.");
  cleaned = cleaned.replace(/적극적입니다\./g, "적극적임.");
  cleaned = cleaned.replace(/성실합니다\./g, "성실함.");
  cleaned = cleaned.replace(/노력형입니다\./g, "노력형임.");
  cleaned = cleaned.replace(/모습입니다\./g, "모습임.");

  // Split into sentences
  let sentences = cleaned.split(/(?<=\.)\s+/);
  sentences = sentences.map(s => {
    s = s.trim();
    if (!s) return "";
    
    // Ensure period
    if (!s.endsWith(".")) {
      s += ".";
    }
    
    // Strict end check - must end in 함. or 임.
    if (!s.endsWith("함.") && !s.endsWith("임.")) {
      if (s.endsWith("음.")) {
        if (!s.endsWith("함.") && !s.endsWith("임.")) {
          s = s.slice(0, -2) + "함.";
        }
      } else {
        s = s.slice(0, -1) + "함.";
      }
    }
    return s;
  });
  
  return sentences.filter(Boolean).join(" ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Post-process student feedback to use friendly vocative


function buildTeacherFeedbackPrompt(input: {
  name: string;
  grade: string;
  classNumber: string;
  studentNumber?: string;
  keywords: string[];
}): string {
  const studentNumber = input.studentNumber ? ` ${input.studentNumber}번` : "";
  return `
당신은 학생을 잘 이해하고 따뜻하게 격려하는 담임 선생님입니다.
학생이 직접 선택한 5개의 키워드를 바탕으로 학생 피드백과 생활기록부 추천 초안을 작성하세요.

[학생 정보]
이름: ${input.name} (${input.grade}학년 ${input.classNumber}반${studentNumber})
선택한 키워드: [${input.keywords.join(", ")}]

[출력 형식]
마크다운 없이 아래 구조의 순수 JSON만 반환하세요.
{
  "aiFeedback": "학생 피드백",
  "reportCardDraft": "생활기록부 초안"
}

[학생 피드백 규칙]
1. 실제 담임 선생님이 학생에게 직접 이야기하듯 자연스럽고 따뜻하게 작성하세요.
2. 5개 키워드를 나열하지 말고 서로 연결해 학생의 강점과 앞으로의 가능성을 3~5문장으로 설명하세요.
3. 초등학생이 쉽게 이해할 수 있는 말투를 사용하고, 과장된 칭찬·오글거리는 표현·광고 문구·반복 칭찬을 피하세요.
4. 'AI', '인공지능', '마술사', '분석가', '데이터', '알고리즘', '분석 시스템'이라는 표현을 사용하지 마세요.
5. 학생 이름은 전체에서 최대 1회만, 호칭 없이 입력된 이름 그대로 사용하세요. 이름 뒤에 '아'나 '야'를 붙이지 마세요.
6. '민수아아', '민수야야', '민수야아'처럼 이름이나 호칭이 반복되는 표현을 만들지 마세요.

[이름과 말투 추가 규칙]
- 이름은 필요할 때만 최대 한 번 사용하고, 생략해도 됩니다. 이름이 없는 문장에 이름을 새로 넣지 마세요.
- 이름 뒤에 조사를 쓸 때는 받침에 맞는 조사 하나만 붙이고 반복하지 마세요. '민수는 는'처럼 조사 중복을 만들지 마세요.
- 이름 뒤에 '아'나 '야'를 붙이지 마세요.
- '우리 반의 자랑'처럼 지나치게 치켜세우거나 미래를 단정하지 말고, 키워드와 연결되는 구체적인 모습과 현실적인 가능성을 말하세요.
[생활기록부 추천 초안 규칙]
1. 모든 문장은 마침표를 포함해 '~함.' 또는 '~임.'으로 끝내세요.
2. 줄바꿈 없이 한 문단으로 작성하세요.
3. 영문과 수학 기호를 피하고, 키워드를 그대로 나열하지 말고 의미를 자연스럽게 녹이세요.
4. 공백 포함 약 150~220자로 작성하세요.
`;
}

function postProcessFeedback(feedback: string, name: string): string {
  if (!feedback) return "";
  const fullName = name.trim();
  let cleaned = feedback
    .replace(/AI|인공지능|마술사|분석가|분석\s*시스템|데이터|알고리즘/gi, "")
    .replace(/[\r\n]+/g, " ")
    .trim();
  if (fullName) {
    const escapedName = fullName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const particles = "은|는|이|가|을|를|와|과";
    cleaned = cleaned
      .replace(
        new RegExp("(" + escapedName + ")(" + particles + ")\\s*(?:" + particles + ")(?=\\s|[,.!?]|$)", "g"),
        "$1$2"
      )
      .replace(
        new RegExp("(" + escapedName + ")(?:아아|야야|야아|아야|아|야)(?:\\s*(?:어린이|친구|학생))?(?=\\s|[,.!?]|$)", "g"),
        "$1"
      );
    const lastCode = fullName.charCodeAt(fullName.length - 1);
    const isHangulSyllable = lastCode >= 0xac00 && lastCode <= 0xd7a3;
    if (isHangulSyllable) {
      const hasFinalConsonant = (lastCode - 0xac00) % 28 !== 0;
      const particleCorrections: Record<string, string> = hasFinalConsonant
        ? { 는: "은", 가: "이", 를: "을", 와: "과" }
        : { 은: "는", 이: "가", 을: "를", 과: "와" };
      const incorrectParticles = Object.keys(particleCorrections).join("|");
      cleaned = cleaned.replace(
        new RegExp("(" + escapedName + ")(" + incorrectParticles + ")(?=\\s|[,.!?]|$)", "g"),
        (_match, matchedName, particle: string) => matchedName + particleCorrections[particle]
      );
    }
    // Match complete name mentions only. Keep the first; use a natural
    // student-facing pronoun for later mentions and preserve their particles.
    const nameSuffixes = "처럼|보다|에게|한테|은|는|이|가|을|를|와|과|의";
    const nameMention = new RegExp(
      "(?<![\\p{L}\\p{N}])" + escapedName + "(" + nameSuffixes + ")?(?=$|[^\\p{L}\\p{N}])",
      "gu"
    );
    const secondPersonParticle: Record<string, string> = {
      은: "는", 는: "는", 을: "를", 를: "를", 와: "와", 과: "와"
    };
    let occurrenceCount = 0;
    cleaned = cleaned.replace(nameMention, (match, suffix: string = "") => {
      occurrenceCount++;
      if (occurrenceCount === 1) return match;
      if (suffix === "이" || suffix === "가") return "네가";
      return "너" + (secondPersonParticle[suffix] ?? suffix);
    });
  }

  cleaned = cleaned
    .replace(/^[\s!,.]+/, "")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 5);
  cleaned = sentences.join(" ");
  return cleaned;
}


// Rule-based high-quality fallback generator

function generateFallbackText(name: string, keywords: string[]): { aiFeedback: string; reportCardDraft: string } {
  const [k1 = "따뜻한 배려", k2 = "성실함", k3 = "책임감", k4 = "자기주도성", k5 = "원만한 관계"] = keywords;
  const aiFeedback = [
    "네가 고른 ‘" + k1 + "’, ‘" + k2 + "’ 두 가지를 함께 살펴보면, 다른 사람을 생각하고 맡은 일을 꾸준히 해내려는 모습이 보여.",
    "‘" + k3 + "’의 의미에서는 맡은 일을 책임 있게 마무리하려는 태도가, ‘" + k4 + "’의 의미에서는 스스로 생각해 실천하려는 모습이 느껴져.",
    "마지막으로 고른 ‘" + k5 + "’도 친구들과 생각을 나누고 함께 지내는 데 도움이 될 수 있어.",
    "지금 가진 강점을 생활 속에서 차근차근 이어 가면 좋겠어."
  ].join(" ");
  const reportCardDraft = [
    "학급 공동체 속에서 주변 동료들을 배려하고 이해하려는 마음가짐으로 타인과 조화롭게 소통함.",
    "자신이 선택한 가치들을 마음속에 품고서 매 학급 활동마다 성실하고 끈기 있게 참여하는 학습 태도가 돋보임.",
    "주어진 과제를 스스로 계획하여 끝까지 완수해내는 훌륭한 자기주도성과 책임감 있는 성향을 지님.",
    "풍부한 공감 능력을 바탕으로 교우들의 생각에 귀를 기울이며 긍정적인 사회성과 성장의 잠재력을 두루 갖춘 학생임.",
  ].join(" ");
  return { aiFeedback, reportCardDraft };
}


// Initialize dynamic Gemini Client resolver
function getGeminiClient(customKey?: string): GoogleGenAI | null {
  const key = customKey || process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    return new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  } catch (e) {
    console.error("Failed to initialize Gemini Client");
    return null;
  }
}

// Firestore-only persistence; no local seeding or alternate-store fallback.
function submissionForTeacher(data: any, id: string): StudentSubmission {
  return {
    id, grade: data.grade || "", classNumber: data.classNumber || "",
    studentNumber: data.studentNumber || "", name: data.name || "",
    keywords: data.keywords || [], timestamp: data.timestamp || "",
    aiFeedback: data.aiFeedback || "", reportCardDraft: data.reportCardDraft || "",
    classCode: data.classCode
  };
}

async function getSubmissionsAsync(classCode: string): Promise<StudentSubmission[]> {
  if (!classCode) throw new Error("Class scope required");
  const snapshot = await getServerFirestore().collection("submissions").where("classCode", "==", classCode).get();
  const items: StudentSubmission[] = [];
  snapshot.forEach(snap => {
    const data = snap.data();
    if (data.classCode === classCode) items.push(submissionForTeacher(data, snap.id));
  });
  return items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

async function addSubmissionAsync(s: StudentSubmission): Promise<void> {
  if (!s.classCode) throw new Error("Class scope required");
  const db = getServerFirestore();
  const ref = db.collection("submissions").doc(s.id);
  // Explicit whitelist. A collision must fail, never overwrite an existing ID.
  await db.runTransaction(async transaction => {
    const cls = await transaction.get(db.collection("classes").doc(s.classCode!));
    if (!cls.exists) throw new Error("Class no longer exists");
    transaction.create(ref, {
      grade: s.grade, classNumber: s.classNumber, studentNumber: s.studentNumber,
      name: s.name, keywords: s.keywords, timestamp: s.timestamp,
      aiFeedback: s.aiFeedback, reportCardDraft: s.reportCardDraft, classCode: s.classCode
    });
  });
}

async function updateSubmissionAsync(s: StudentSubmission, classCode: string): Promise<void> {
  if (!classCode || s.classCode !== classCode) throw new Error("Submission access denied");
  const db = getServerFirestore();
  const ref = db.collection("submissions").doc(s.id);
  await db.runTransaction(async transaction => {
    const current = await transaction.get(ref);
    if (!current.exists || current.data()!.classCode !== classCode) throw new Error("Submission access denied");
    transaction.update(ref, { aiFeedback: s.aiFeedback, reportCardDraft: s.reportCardDraft });
  });
}

async function deleteSubmissionAsync(id: string, classCode: string): Promise<boolean> {
  if (!classCode) throw new Error("Class scope required");
  const db = getServerFirestore();
  const ref = db.collection("submissions").doc(id);
  return db.runTransaction(async transaction => {
    const current = await transaction.get(ref);
    if (!current.exists || current.data()!.classCode !== classCode) return false;
    transaction.delete(ref);
    return true;
  });
}

async function resetSubmissionsAsync(classCode: string): Promise<void> {
  if (!classCode) throw new Error("Class scope required");
  const db = getServerFirestore();
  const snapshot = await db.collection("submissions").where("classCode", "==", classCode).get();
  for (let i = 0; i < snapshot.docs.length; i += 400) {
    const batch = snapshot.docs.slice(i, i + 400);
    await db.runTransaction(async transaction => {
      const current = await transaction.getAll(...batch.map(item => item.ref));
      current.forEach(item => {
        if (item.exists && item.data()!.classCode === classCode) transaction.delete(item.ref);
      });
    });
  }
}

// ==========================================
// CLASS CONFIGURATION ACCESS LAYERS
// ==========================================

interface ClassConfig {
  classCode: string;
  password?: string;
  passwordHash?: string;
  passwordVersion?: number;
  authVersion?: number;
  passwordMigratedAt?: string;
  createdAt: string;
}

async function getClassAsync(classCode: string): Promise<ClassConfig | null> {
  const targetCode = classCode.toLowerCase().trim();
  const snapshot = await getServerFirestore().collection("classes").doc(targetCode).get();
  if (!snapshot.exists) return null;
  return { ...snapshot.data(), classCode: snapshot.id } as ClassConfig;
}

async function saveClassAsync(classCode: string, password: string, createOnly = false, expected?: ClassConfig): Promise<ClassConfig> {
  const targetCode = classCode.toLowerCase().trim();
  const db = getServerFirestore();
  const passwordHash = await createPasswordHash(password);
  const now = new Date().toISOString();
  const ref = db.collection("classes").doc(targetCode);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (createOnly && snapshot.exists) throw new Error("Class already exists. Please log in again.");
    const previous = snapshot.data() || {};
    if (expected && (!snapshot.exists || (previous.authVersion ?? 0) !== (expected.authVersion ?? 0)
      || previous.passwordHash !== expected.passwordHash || previous.password !== expected.password)) {
      throw new Error("Class credentials changed. Please log in again.");
    }
    const saved = {
      passwordHash, passwordVersion: 1, authVersion: (previous.authVersion ?? 0) + 1,
      createdAt: previous.createdAt ?? now
    };
    if (createOnly) transaction.create(ref, saved);
    else transaction.set(ref, expected ? { ...saved, password: FieldValue.delete() } : saved, { merge: true });
    return { ...saved, classCode: targetCode };
  });
}

// config/adminPassword is deliberately not read, generated, or modified.

// Initialize Gemini Client
let ai: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  try {
    ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
    console.log("Gemini API Client successfully initialized.");
  } catch (e) {
    console.error("Failed to initialize Gemini API Client");
  }
} else {
  console.warn("GEMINI_API_KEY environment variable is missing. App will use fallback rule-based generation.");
}

app.use(express.json()); // Custom Class Code and Authentication Endpoints
app.use("/api", (_req, res, next) => {
  // API responses can contain teacher session and student data; never cache them.
  res.setHeader("Cache-Control", "no-store");
  next();
});

// API: Check if class exists
app.get("/api/classes/check/:classCode", async (req, res) => {
  const { classCode } = req.params;
  if (!classCode || classCode.trim().length === 0) {
    res.json({ exists: false });
    return;
  }
  try {
    const cls = await getClassAsync(classCode);
    res.json({ exists: !!cls });
  } catch (error) {
    res.status(503).json({ message: "학급 정보를 확인할 수 없습니다. 잠시 후 다시 시도해주세요." });
  }
});

// Authentication applies to teacher session/password routes only in this phase.
function teacherConfiguration(_req: express.Request, res: express.Response, next: express.NextFunction) {
  try { assertTeacherAuthConfigured(); next(); }
  catch { res.status(503).json({ success: false, message: "교사 인증 설정을 확인해주세요." }); }
}

async function requireTeacherSession(req: express.Request, res: express.Response, next: express.NextFunction) {
  res.setHeader("Cache-Control", "no-store");
  try {
    assertTeacherAuthConfigured();
    const session = readTeacherSession(req);
    if (!session) {
      clearTeacherCookie(res);
      res.status(401).json({ success: false, message: "교사 로그인이 필요합니다." }); return;
    }
    const cls = await getClassAsync(session.classCode);
    if (!cls || (cls.authVersion ?? 0) !== session.authVersion) {
      clearTeacherCookie(res);
      res.status(401).json({ success: false, message: "인증이 만료되었습니다. 다시 로그인해주세요." }); return;
    }
    res.locals.teacherClass = cls;
    next();
  } catch {
    res.status(503).json({ success: false, message: "인증 정보를 확인할 수 없습니다. 잠시 후 다시 시도해주세요." });
  }
}

app.get("/api/classes/session", requireTeacherSession, (_req, res) => {
  res.json({ success: true, classCode: res.locals.teacherClass.classCode });
});

app.post("/api/classes/logout", requireTeacherOrigin, (_req, res) => {
  clearTeacherCookie(res);
  res.json({ success: true });
});

// API: Authenticate an existing class. Creation requires a separate, explicit request.
app.post("/api/classes/auth", requireTeacherOrigin, teacherConfiguration, teacherRateLimit, async (req, res) => {
  const { classCode, password } = req.body || {};
  if (typeof classCode !== "string" || !classCode.trim()
    || typeof password !== "string" || !password.trim()) {
    res.status(400).json({ success: false, message: "학급 코드와 비밀번호를 올바르게 입력해주세요." }); return;
  }
  const trimmedCode = classCode.toLowerCase().trim();
  try {
    const existingClass = await getClassAsync(trimmedCode);
    if (existingClass) {
      if (!(await verifyClassPassword(password, existingClass)).valid) {
        res.status(401).json({ success: false, message: "비밀번호가 일치하지 않습니다. 다시 입력해주세요." }); return;
      }
      issueTeacherCookie(res, existingClass.classCode, existingClass.authVersion ?? 0);
      res.json({ success: true, isNew: false, classCode: existingClass.classCode, message: "로그인에 성공했습니다." });
    } else {
      res.status(404).json({ success: false, code: "CLASS_NOT_FOUND", classCode: trimmedCode,
        message: "등록되지 않은 학급 코드입니다." });
    }
  } catch {
    res.status(503).json({ success: false, message: "로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." });
  }
});

// Called only after the teacher confirms creation in the UI. The transaction's
// create-only write prevents a concurrent request from replacing a class.
app.post("/api/classes/create", requireTeacherOrigin, teacherConfiguration, teacherRateLimit, async (req, res) => {
  const { classCode, password, confirmCreate } = req.body || {};
  if (typeof classCode !== "string" || !classCode.trim()
    || typeof password !== "string" || !password.trim() || confirmCreate !== true) {
    res.status(400).json({ success: false, message: "학급 코드, 비밀번호와 생성 확인을 올바르게 입력해주세요." }); return;
  }
  const trimmedCode = classCode.toLowerCase().trim();
  let created: ClassConfig;
  try {
    created = await saveClassAsync(trimmedCode, password, true);
  } catch {
    try {
      if (await getClassAsync(trimmedCode)) {
        res.status(409).json({ success: false, code: "CLASS_ALREADY_EXISTS",
          message: "그 사이 학급 코드가 등록되었습니다. 기존 학급으로 로그인해주세요." }); return;
      }
    } catch { /* Preserve the original service error. */ }
    res.status(503).json({ success: false, message: "학급을 생성하지 못했습니다. 잠시 후 다시 시도해주세요." }); return;
  }
  issueTeacherCookie(res, created.classCode, created.authVersion ?? 0);
  res.status(201).json({ success: true, isNew: true, classCode: created.classCode,
    message: "새로운 학급 대시보드가 성공적으로 개설되었습니다!" });
});

async function changeTeacherPassword(req: express.Request, res: express.Response) {
  const { oldPassword, newPassword } = req.body || {};
  if (typeof oldPassword !== "string" || !oldPassword.trim()
    || typeof newPassword !== "string" || !newPassword.trim()) {
    res.status(400).json({ success: false, message: "현재 비밀번호와 새 비밀번호를 입력해주세요." }); return;
  }
  const cls = res.locals.teacherClass as ClassConfig;
  try {
    if (!(await verifyClassPassword(oldPassword, cls)).valid) {
      res.status(401).json({ success: false, code: "CURRENT_PASSWORD_INVALID", message: "현재 비밀번호가 일치하지 않습니다." }); return;
    }
    // Ignore body.classCode; the verified session determines the target.
    const saved = await saveClassAsync(cls.classCode, newPassword, false, cls);
    issueTeacherCookie(res, saved.classCode, saved.authVersion ?? 0);
    res.json({ success: true, message: "비밀번호가 성공적으로 변경되었습니다." });
  } catch {
    res.status(409).json({ success: false, message: "비밀번호 변경을 완료하지 못했습니다. 다시 로그인한 뒤 확인해주세요." });
  }
}

app.post("/api/classes/change-password", requireTeacherOrigin, teacherConfiguration, teacherRateLimit, requireTeacherSession, changeTeacherPassword);
app.post("/api/classes/update-password", requireTeacherOrigin, teacherConfiguration, teacherRateLimit, requireTeacherSession, changeTeacherPassword);

// Retired public config endpoints. Existing config documents remain untouched.
app.all("/api/config", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(410).json({ success: false, message: "이 설정 API는 더 이상 제공되지 않습니다." });
});

// Reject explicit cross-class requests; never derive authorization from them.
function requireTeacherClassScope(req: express.Request, res: express.Response, next: express.NextFunction) {
  const classCode = res.locals.teacherClass.classCode;
  for (const requested of [req.query.classCode, req.body?.classCode]) {
    if (requested !== undefined && requested !== classCode) {
      res.status(403).json({ success: false, message: "다른 학급 자료에 접근할 수 없습니다." }); return;
    }
  }
  next();
}

app.get("/api/submissions", requireTeacherSession, requireTeacherClassScope, async (_req, res) => {
  try {
    res.json(await getSubmissionsAsync(res.locals.teacherClass.classCode));
  } catch {
    res.status(503).json({ success: false, message: "제출 자료를 조회할 수 없습니다. 잠시 후 다시 시도해주세요." });
  }
});

app.delete("/api/submissions/:id", requireTeacherOrigin, requireTeacherSession, requireTeacherClassScope, async (req, res) => {
  try {
    if (!await deleteSubmissionAsync(req.params.id, res.locals.teacherClass.classCode)) {
      res.status(404).json({ success: false, message: "접근 가능한 제출 자료를 찾을 수 없습니다." }); return;
    }
    res.json({ success: true });
  } catch {
    res.status(503).json({ success: false, message: "삭제를 완료하지 못했습니다. 자료를 다시 조회해주세요." });
  }
});

app.post("/api/submissions/reset", requireTeacherOrigin, requireTeacherSession, requireTeacherClassScope, async (_req, res) => {
  try {
    await resetSubmissionsAsync(res.locals.teacherClass.classCode);
    res.json({ success: true, message: "현재 학급의 제출 자료를 초기화했습니다." });
  } catch {
    res.status(503).json({ success: false, message: "초기화를 완료하지 못했습니다. 일부 자료가 처리됐을 수 있으니 다시 조회해주세요." });
  }
});

// Strict student input validation; generated fields are never taken from the body.
function validateStudentInput(body: unknown): {
  grade: string; classNumber: string; studentNumber: string; name: string; keywords: string[]; classCode: string; apiKey?: string;
} | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const data = body as Record<string, unknown>;
  const allowed = ["grade", "classNumber", "studentNumber", "name", "keywords", "classCode", "apiKey"];
  if (Object.keys(data).some(key => !allowed.includes(key))) return null;
  const text = (value: unknown, max: number): value is string =>
    typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
  const positiveNumber = (value: unknown): value is string =>
    text(value, 3) && /^[0-9]{1,3}$/.test(value) && Number(value) > 0;
  if (!positiveNumber(data.grade) || !positiveNumber(data.classNumber) || !positiveNumber(data.studentNumber)
    || !text(data.name, 50) || !text(data.classCode, 100)
    || !/^[a-z0-9][a-z0-9_-]{0,99}$/i.test(data.classCode.trim())
    || !Array.isArray(data.keywords) || data.keywords.length !== 5
    || !data.keywords.every(keyword => text(keyword, 100))
    || (data.apiKey !== undefined && !text(data.apiKey, 512))) return null;
  return {
    grade: data.grade, classNumber: data.classNumber, studentNumber: data.studentNumber,
    name: data.name.trim(), keywords: data.keywords.map(keyword => keyword.trim()),
    classCode: data.classCode.trim().toLowerCase(),
    ...(typeof data.apiKey === "string" ? { apiKey: data.apiKey } : {})
  };
}

// API: Submit survey (intentionally does not require a teacher cookie)
app.post("/api/submissions", async (req, res) => {
  try {
  const input = validateStudentInput(req.body);
  const headerKey = req.headers["x-gemini-api-key"];
  if (!input || (headerKey !== undefined && (typeof headerKey !== "string" || headerKey.length > 512))) {
    res.status(400).json({ success: false, message: "학급 코드와 학생 정보를 확인해주세요. 키워드는 정확히 5개여야 합니다." }); return;
  }
  const { grade, classNumber, studentNumber, name, keywords, apiKey, classCode } = input;
  const clientApiKey = headerKey as string || apiKey;
  try {
    if (!await getClassAsync(classCode)) {
      res.status(404).json({ success: false, message: "존재하지 않는 학급 코드입니다." }); return;
    }
  } catch {
    res.status(503).json({ success: false, message: "학급 정보를 확인할 수 없습니다. 잠시 후 다시 시도해주세요." }); return;
  }
  // Avoid an IP-only quota: classmates can share one school network.
  const studentQuota = studentRequestLimit("student:" + JSON.stringify([classCode, grade, classNumber, studentNumber]), 8);
  const classQuota = studentQuota.allowed ? studentRequestLimit("class:" + classCode, 300) : studentQuota;
  if (!studentQuota.allowed || !classQuota.allowed) {
    res.setHeader("Retry-After", String(Math.max(studentQuota.retryAfterSeconds, classQuota.retryAfterSeconds)));
    res.status(429).json({ success: false, message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }); return;
  }
  const newId = randomUUID();

  // Create base submission using robust rule-based generator
  const fallback = generateFallbackText(name, keywords);
  const newSubmission: StudentSubmission = {
    id: newId,
    grade,
    classNumber,
    studentNumber,
    name,
    keywords,
    timestamp: new Date().toISOString(),
    aiFeedback: fallback.aiFeedback,
    reportCardDraft: fallback.reportCardDraft,
    classCode
  };

  // Get dynamic Gemini client
  const activeAi = getGeminiClient(clientApiKey);

  // Enhance with Gemini if key is active
  if (activeAi) {
    try {
      const prompt = buildTeacherFeedbackPrompt({ name, grade, classNumber, studentNumber, keywords });
const response = await activeAi.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      const responseText = response.text;
      if (responseText) {
        try {
          const result = JSON.parse(responseText.trim());
          if (result.aiFeedback) {
            newSubmission.aiFeedback = postProcessFeedback(result.aiFeedback, name);
          }
          if (result.reportCardDraft) {
            newSubmission.reportCardDraft = postProcessDraft(result.reportCardDraft);
          }
        } catch (parseError) {
          console.error("Failed to parse Gemini JSON output, using default drafts");
        }
      }
    } catch (apiError) {
      console.error("Gemini API execution failed, utilizing rich local fallback drafts");
    }
  }

  // Double check our post-processing filters on the final output to guarantee compliance 100%
  newSubmission.aiFeedback = postProcessFeedback(newSubmission.aiFeedback, name);
  newSubmission.reportCardDraft = postProcessDraft(newSubmission.reportCardDraft);

  try { await addSubmissionAsync(newSubmission); }
  catch {
    res.status(503).json({ success: false, message: "제출 저장을 확인하지 못했습니다. 선생님께 확인한 뒤 다시 시도해주세요." }); return;
  }

  res.json({ success: true, submission: newSubmission });
  } catch {
    res.status(503).json({ success: false, message: "제출을 처리하지 못했습니다. 잠시 후 다시 시도해주세요." });
  }
});

// API: Manually request AI Draft generation for a specific existing student
app.post("/api/submissions/:id/regenerate-ai", requireTeacherOrigin, requireTeacherSession, requireTeacherClassScope, async (req, res) => {
  const { id } = req.params;
  const { apiKey } = req.body || {};
  const classCode = res.locals.teacherClass.classCode;
  const clientApiKey = req.headers["x-gemini-api-key"] as string || apiKey;

  let submissions: StudentSubmission[];
  try { submissions = await getSubmissionsAsync(classCode); }
  catch {
    res.status(503).json({ success: false, message: "제출 자료를 확인할 수 없습니다. 잠시 후 다시 시도해주세요." }); return;
  }
  const subIndex = submissions.findIndex((s) => s.id === id);

  if (subIndex === -1) {
    res.status(404).json({ success: false, message: "Submission not found" });
    return;
  }

  const student = submissions[subIndex];
  const activeAi = getGeminiClient(clientApiKey);

  if (!activeAi) {
    res.status(400).json({ success: false, message: "개인 Gemini API 키가 설정되어 있지 않습니다. 우측 상단의 '설정 및 API 키 관리'에서 본인의 API 키를 입력해주세요." });
    return;
  }

  const submissionQuota = aiRequestLimit("ai:submission:" + classCode + ":" + id, 6);
  const classQuota = submissionQuota.allowed ? aiRequestLimit("ai:class:" + classCode, 60) : submissionQuota;
  if (!submissionQuota.allowed || !classQuota.allowed) {
    res.setHeader("Retry-After", String(Math.max(submissionQuota.retryAfterSeconds, classQuota.retryAfterSeconds)));
    res.status(429).json({ success: false, message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }); return;
  }

  try {
    const prompt = buildTeacherFeedbackPrompt({
      name: student.name,
      grade: student.grade,
      classNumber: student.classNumber,
      studentNumber: student.studentNumber,
      keywords: student.keywords,
    });
const response = await activeAi.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const responseText = response.text;
    if (responseText) {
      const result = JSON.parse(responseText.trim());
      if (result.aiFeedback) {
        student.aiFeedback = postProcessFeedback(result.aiFeedback, student.name);
      }
      if (result.reportCardDraft) {
        student.reportCardDraft = postProcessDraft(result.reportCardDraft);
      }
      
      // Secondary filter run to guarantee strict adherence to the rules
      student.aiFeedback = postProcessFeedback(student.aiFeedback, student.name);
      student.reportCardDraft = postProcessDraft(student.reportCardDraft);

      try { await updateSubmissionAsync(student, classCode); }
      catch {
        res.status(503).json({ success: false, message: "자료 접근 권한 또는 저장 상태가 변경되어 저장하지 못했습니다. 다시 조회해주세요." }); return;
      }
      res.json({ success: true, student });
      return;
    }
  } catch (error) {
    console.error("Failed to regenerate AI text");
    res.status(500).json({ success: false, message: "AI 생성 중 오류가 발생했습니다. 입력하신 API 키가 올바른지 확인해주세요." });
    return;
  }

  res.status(500).json({ success: false, message: "AI 생성 결과가 올바르지 않습니다." });
});

// Serve frontend assets
async function startServer() {
  getServerFirestore(); // Configuration errors stop startup; no alternate store.

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(() => {
  console.error("Server startup failed. Check server configuration.");
  process.exitCode = 1;
});
