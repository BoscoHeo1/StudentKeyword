import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { StudentSubmission } from "./src/types";

const app = express();
const PORT = 3000;
const SUBMISSIONS_FILE = path.join(process.cwd(), "data", "submissions.json");
const CONFIG_FILE = path.join(process.cwd(), "data", "config.json");

// Ensure data directory exists
const dataDir = path.dirname(SUBMISSIONS_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Config helper functions
function getConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const content = fs.readFileSync(CONFIG_FILE, "utf-8");
      return JSON.parse(content);
    }
  } catch (error) {
    console.error("Failed to read config file, using default", error);
  }
  return { adminPassword: "1234" };
}

function saveConfig(config: { adminPassword: string }) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to write config file", error);
  }
}

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

// In-memory or file-backed database helper
function getSubmissions(): StudentSubmission[] {
  try {
    if (fs.existsSync(SUBMISSIONS_FILE)) {
      const content = fs.readFileSync(SUBMISSIONS_FILE, "utf-8");
      return JSON.parse(content);
    } else {
      // Seed default sample data so the dashboard is immediately interactive and clear
      const defaultSamples: StudentSubmission[] = [
        {
          id: "seed-1",
          grade: "3",
          classNumber: "1",
          studentNumber: "05",
          name: "김민준",
          keywords: ["원만한 교우관계", "친구들의 의견 존중", "정직하고 올바른 태도", "늘 미소짓는 모습", "선생님 말씀 경청"],
          timestamp: new Date(Date.now() - 3600000 * 2).toISOString(), // 2 hours ago
          aiFeedback: "민준아! 친구들을 아끼고 존중하며 바르게 행동하는 모습이 정말 멋져요. 앞으로도 늘 밝은 미소와 따뜻한 마음으로 친구들과 함께 성장하는 멋진 어린이가 되길 응원할게요!",
          reportCardDraft: "공동체 활동 시 타인의 의견을 존중하고 경청하는 태도로 원만한 교우관계를 유지함. 매사 정직하고 올바른 마음가짐으로 학급 규칙을 준수하며 수업 시간 내내 선생님의 설명을 주의 깊게 경청하고 늘 밝은 미소로 학습에 성실히 임함."
        },
        {
          id: "seed-2",
          grade: "3",
          classNumber: "1",
          studentNumber: "12",
          name: "이서연",
          keywords: ["따뜻한 봉사정신", "책임감 있는 성품", "학습 이해력 우수", "자기주도적 학습태도", "정독과 속독의 조화"],
          timestamp: new Date(Date.now() - 3600000 * 1.5).toISOString(), // 1.5 hours ago
          aiFeedback: "서연아! 보이지 않는 곳에서도 남을 돕는 따뜻한 마음과 스스로 계획을 세워 공부하는 현명함이 조화를 이루네요. 멋진 꿈을 향해 나아가는 빛나는 서연이가 되세요!",
          reportCardDraft: "이타심과 봉사정신이 돋보여 자발적으로 주변을 배려하고 돕는 태도가 우수함. 맡은 바 일에 최선을 다하는 책임감 있는 성품을 지녔으며 뛰어난 학습 이해력을 바탕으로 늘 자기주도적인 자세로 공부에 열중함. 정독과 속독을 능숙하게 조화시키며 책을 깊이 있게 읽는 훌륭한 독서 습관을 생활화함."
        },
        {
          id: "seed-3",
          grade: "3",
          classNumber: "2",
          studentNumber: "03",
          name: "박예준",
          keywords: ["밝은 에너지", "유쾌한 유머감각", "끈기있고 도전적임", "수업 집중도가 높음", "논리적인 글쓰기"],
          timestamp: new Date(Date.now() - 3600000 * 1).toISOString(), // 1 hour ago
          aiFeedback: "예준아! 실패를 두려워하지 않는 끈기 있는 태도와 수업 시간에 뿜어져 나오는 고도의 집중력이 대단해요! 유쾌하고 밝은 웃음과 훌륭한 글쓰기 솜씨로 친구들과 기쁨을 더 나누어봐요!",
          reportCardDraft: "학급에 밝고 활기찬 에너지를 불어넣는 쾌활한 성격으로 유쾌한 유머감각을 발휘하여 교우관계가 원만함. 어려움에 직면해도 포기하지 않고 끝까지 성실하게 도전하는 끈기를 보이며 수업 시간의 집중도가 대단히 높음. 본인의 생각을 명확하고 짜임새 있게 표현하는 논리적인 글쓰기 능력이 뛰어남."
        },
        {
          id: "seed-4",
          grade: "3",
          classNumber: "2",
          studentNumber: "18",
          name: "최지우",
          keywords: ["뛰어난 의사소통 능력", "학급 규칙 준수", "끝까지 노력하는 자세", "질문과 답변 활동 우수", "효율적인 시간관리"],
          timestamp: new Date(Date.now() - 300000 * 4).toISOString(), // 20 mins ago
          aiFeedback: "지우야! 친구들의 이야기에 귀를 기울이고 똑부러지게 의견을 전하는 소통의 달인이군요! 무엇이든 끝까지 해내려는 끈기와 야무진 시간 관리 능력을 발휘해 매일 더 멋지게 자라나길 바랄게요!",
          reportCardDraft: "타인의 처지를 이해하며 본인의 생각을 명확히 표현하는 뛰어난 의사소통 능력을 갖추고 있음. 학급 내 규칙을 엄격히 준수하며 공정하게 생활하고 한 번 시작한 과제는 끝까지 완수하는 책임감 있는 노력이 돋보임. 수업 시간 중 적극적인 질문과 모범적인 답변 활동을 행하며 정해진 시간을 효율적으로 배분하여 자기관리를 실천함."
        }
      ];
      saveSubmissions(defaultSamples);
      return defaultSamples;
    }
  } catch (error) {
    console.error("Failed to read submissions file, using empty array", error);
  }
  return [];
}

function saveSubmissions(submissions: StudentSubmission[]): void {
  try {
    fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(submissions, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to write submissions file", error);
  }
}

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
    console.error("Failed to initialize Gemini API Client", e);
  }
} else {
  console.warn("GEMINI_API_KEY environment variable is missing. App will use fallback rule-based generation.");
}

app.use(express.json());

// API: Get current config (password)
app.get("/api/config", (req, res) => {
  const config = getConfig();
  res.json(config);
});

// API: Update config (password)
app.post("/api/config", (req, res) => {
  const { adminPassword } = req.body;
  if (!adminPassword || adminPassword.trim().length === 0) {
    res.status(400).json({ success: false, message: "올바른 비밀번호를 입력해주세요." });
    return;
  }
  saveConfig({ adminPassword: adminPassword.trim() });
  res.json({ success: true, message: "비밀번호가 성공적으로 변경되었습니다." });
});

// API: Get all submissions
app.get("/api/submissions", (req, res) => {
  const submissions = getSubmissions();
  res.json(submissions);
});

// API: Delete a submission (for teacher dashboard management)
app.delete("/api/submissions/:id", (req, res) => {
  const { id } = req.params;
  const submissions = getSubmissions();
  const filtered = submissions.filter((s) => s.id !== id);
  if (submissions.length === filtered.length) {
    res.status(404).json({ success: false, message: "Submission not found" });
    return;
  }
  saveSubmissions(filtered);
  res.json({ success: true });
});

// API: Reset all submissions
app.post("/api/submissions/reset", (req, res) => {
  saveSubmissions([]);
  res.json({ success: true, message: "All submissions cleared." });
});

// API: Submit survey
app.post("/api/submissions", async (req, res) => {
  const { grade, classNumber, studentNumber, name, keywords } = req.body;

  if (!grade || !classNumber || !studentNumber || !name || !keywords || keywords.length !== 5) {
    res.status(400).json({ success: false, message: "모든 항목을 올바르게 채워주세요. (키워드는 정확히 5개)" });
    return;
  }

  const submissions = getSubmissions();
  const newId = Date.now().toString();

  // Create base submission
  const friendlyName = getFriendlyName(name);
  const newSubmission: StudentSubmission = {
    id: newId,
    grade,
    classNumber,
    studentNumber,
    name,
    keywords,
    timestamp: new Date().toISOString(),
    aiFeedback: `안녕, ${friendlyName}! 직접 고른 다섯 가지 멋진 열쇠고리 키워드처럼 스스로의 다양한 가능성을 넓혀나가는 멋진 모습을 보여주어 정말 기뻐. 앞으로도 너의 멋진 꿈을 활짝 펼치기를 항상 마음 깊이 응원할게!`,
    reportCardDraft: `학급 공동체 활동 시 타인을 배려하고 존중하는 노력이 우수함. 평소 주어진 과제에 높은 흥미를 보이며 적극적이고 자기주도적으로 성실하게 참여함. 매사 올바른 행동을 실천하기 위해 노력하는 태도가 돋보이며 친구들과의 소통 활동에서도 깊은 이타심과 긍정적인 리더십을 발휘함.`
  };

  // Enhance with Gemini if key is active
  if (ai) {
    try {
      const keywordsStr = keywords.join(", ");
      const prompt = `
당신은 대한민국 초등학교/중학교 교사이자 다정한 어린이 상담사입니다.
학생이 자신을 표현하는 5가지 핵심 키워드를 골랐습니다. 이 키워드를 기반으로 학생에게 주는 다정한 피드백 카드 내용과 교사가 생활기록부(행동특성 및 종합의견 또는 교과세특)에 기재할 수 있는 고품질 추천 초안 문구를 작성해주세요.

[학생 정보]
이름: ${name} (${grade}학년 ${classNumber}반 ${studentNumber}번)
학생이 직접 선택한 자신을 나타내는 5가지 키워드: [${keywordsStr}]

[출력 요구사항 - 반드시 JSON 형식으로만 응답할 것]
반드시 아래의 JSON 구조만 반환해주세요. 마크다운 블록(\`\`\`json)은 포함하지 말고 순수 JSON 문자열로만 응답하세요.

{
  "aiFeedback": "격려 메시지",
  "reportCardDraft": "생활기록부 초안 문구"
}

[중요 지침: 학생 피드백 (aiFeedback) 작성 규칙]
1. 학생의 이름을 다정하게 부를 때, 반드시 'ㅁㅁ야' 또는 'ㅁㅁ아' 형태로 부르십시오. (예: 이름이 '김민준'인 경우 성을 떼고 '민준아!', '이서연'인 경우 성을 떼고 '서연아!', '최지우'인 경우 '지우야!'라고 시작하세요.) 'ㅁㅁㅁ 친구'나 'ㅁㅁㅁ 어린이' 같은 딱딱하거나 격식차린 표현은 절대로 사용하지 마십시오.
2. 학생이 선택한 키워드를 자연스럽게 칭찬하고 용기를 주는 따뜻한 어린이 맞춤형 격려 메시지를 작성하십시오. (경어체, 2~3문장)

[중요 지침: 생활기록부 추천 초안 (reportCardDraft) 작성 규칙]
1. 모든 문장의 끝은 반드시 '~함.' 또는 '~임.'으로 끝나야 합니다. (온점/마침표 포함)
   - 절대 '~함'이나 '~임'처럼 마침표 없이 끝내지 마십시오. 반드시 마침표 '.'를 포함해야 합니다.
   - 절대 '~할 수 있음', '~수 있음', '~있습니다', '~입니다', '~함이 돋보입니다', '~행동을 보여줌' 이외에 다른 끝맺음이나 '~수 있음(X)' 형태는 쓰지 마십시오. 오직 명사형 종결어미 '~함.', '~임.'으로만 끝나야 합니다. (예: '참여함.', '우수함.', '돋보임.')
2. 줄 바꿈(개행 문자 \\n)을 절대 사용하지 마십시오. 문장이 끝나도 줄을 바꾸지 않고, 온점 후 정확히 한 칸을 띄운 뒤(예: '. ') 이어서 한 줄의 완성된 문단으로 기록하십시오.
3. 영문 알파벳이나 수학적 특수문자(+, -, X 등)는 절대 기재하지 마십시오. 수학 기호나 특수문자는 반드시 한글로 풀어서 기재하십시오. (예: '+' -> '더하기' 또는 '덧셈', '-' -> '빼기' 또는 '뺄셈', 'X' 또는 '*' -> '곱하기' 또는 '곱셈').
   - 단, 측정 단위인 'cm', 'kg' 등은 영문 알파벳 기재가 허용됩니다.
4. 학생이 선택한 5가지 키워드를 그대로 문장 속에 Verbatim(토씨 하나 안 틀리고 그대로)으로 나열하지 마십시오. 그 키워드의 의미와 표현을 문장 속에 잘 녹여내어 자연스럽고 아름답게 활용하여 고품질의 관찰 서술 문장으로 다듬어 작성하십시오. (글자 수: 공백 포함 약 150자 ~ 220자 사이)
`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      const responseText = response.text;
      if (responseText) {
        try {
          const result = JSON.parse(responseText.trim());
          if (result.aiFeedback) newSubmission.aiFeedback = result.aiFeedback;
          if (result.reportCardDraft) newSubmission.reportCardDraft = result.reportCardDraft;
        } catch (parseError) {
          console.error("Failed to parse Gemini JSON output, using default drafts", parseError, responseText);
        }
      }
    } catch (apiError) {
      console.error("Gemini API execution failed, utilizing rich local fallback drafts", apiError);
    }
  }

  submissions.push(newSubmission);
  saveSubmissions(submissions);

  res.json({ success: true, submission: newSubmission });
});

// API: Manually request AI Draft generation for a specific existing student
app.post("/api/submissions/:id/regenerate-ai", async (req, res) => {
  const { id } = req.params;
  const submissions = getSubmissions();
  const subIndex = submissions.findIndex((s) => s.id === id);

  if (subIndex === -1) {
    res.status(404).json({ success: false, message: "Submission not found" });
    return;
  }

  const student = submissions[subIndex];

  if (!ai) {
    res.status(400).json({ success: false, message: "Gemini API key is not configured on the server." });
    return;
  }

  try {
    const keywordsStr = student.keywords.join(", ");
    const friendlyName = getFriendlyName(student.name);
    const prompt = `
당신은 대한민국 초등학교/중학교 교사이자 다정한 어린이 상담사입니다.
학생이 자신을 표현하는 5가지 핵심 키워드를 골랐습니다. 이 키워드를 기반으로 학생에게 주는 다정한 피드백 카드 내용과 교사가 생활기록부(행동특성 및 종합의견 또는 교과세특)에 기재할 수 있는 고품질 추천 초안 문구를 작성해주세요.

[학생 정보]
이름: ${student.name} (${student.grade}학년 ${student.classNumber}반)
선택한 키워드: [${keywordsStr}]

[출력 요구사항 - 반드시 JSON 형식으로만 응답할 것]
반드시 아래의 JSON 구조만 반환해주세요. 마크다운 블록(\`\`\`json)은 포함하지 말고 순수 JSON 문자열로만 응답하세요.

{
  "aiFeedback": "격려 메시지",
  "reportCardDraft": "생활기록부 초안 문구"
}

[중요 지침: 학생 피드백 (aiFeedback) 작성 규칙]
1. 학생의 이름을 다정하게 부를 때, 반드시 'ㅁㅁ야' 또는 'ㅁㅁ아' 형태로 부르십시오. (예: 이름이 '김민준'인 경우 성을 떼고 '민준아!', '이서연'인 경우 성을 떼고 '서연아!', '최지우'인 경우 '지우야!'라고 시작하세요.) 'ㅁㅁㅁ 친구'나 'ㅁㅁㅁ 어린이' 같은 딱딱하거나 격식차린 표현은 절대로 사용하지 마십시오.
2. 학생이 선택한 키워드를 자연스럽게 칭찬하고 용기를 주는 따뜻한 어린이 맞춤형 격려 메시지를 작성하십시오. (경어체, 2~3문장)

[중요 지침: 생활기록부 추천 초안 (reportCardDraft) 작성 규칙]
1. 모든 문장의 끝은 반드시 '~함.' 또는 '~임.'으로 끝나야 합니다. (온점/마침표 포함)
   - 절대 '~함'이나 '~임'처럼 마침표 없이 끝내지 마십시오. 반드시 마침표 '.'를 포함해야 합니다.
   - 절대 '~할 수 있음', '~수 있음', '~있습니다', '~입니다', '~함이 돋보입니다', '~행동을 보여줌' 이외에 다른 끝맺음이나 '~수 있음(X)' 형태는 쓰지 마십시오. 오직 명사형 종결어미 '~함.', '~임.'으로만 끝나야 합니다. (예: '참여함.', '우수함.', '돋보임.')
2. 줄 바꿈(개행 문자 \\n)을 절대 사용하지 마십시오. 문장이 끝나도 줄을 바꾸지 않고, 온점 후 정확히 한 칸을 띄운 뒤(예: '. ') 이어서 한 줄의 완성된 문단으로 기록하십시오.
3. 영문 알파벳이나 수학적 특수문자(+, -, X 등)는 절대 기재하지 마십시오. 수학 기호나 특수문자는 반드시 한글로 풀어서 기재하십시오. (예: '+' -> '더하기' 또는 '덧셈', '-' -> '빼기' 또는 '뺄셈', 'X' 또는 '*' -> '곱하기' 또는 '곱셈').
   - 단, 측정 단위인 'cm', 'kg' 등은 영문 알파벳 기재가 허용됩니다.
4. 학생이 선택한 5가지 키워드를 그대로 문장 속에 Verbatim(토씨 하나 안 틀리고 그대로)으로 나열하지 마십시오. 그 키워드의 의미 and 표현을 문장 속에 잘 녹여내어 자연스럽고 아름답게 활용하여 고품질의 관찰 서술 문장으로 다듬어 작성하십시오. (글자 수: 공백 포함 약 150자 ~ 220자 사이)
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const responseText = response.text;
    if (responseText) {
      const result = JSON.parse(responseText.trim());
      if (result.aiFeedback) student.aiFeedback = result.aiFeedback;
      if (result.reportCardDraft) student.reportCardDraft = result.reportCardDraft;
      
      submissions[subIndex] = student;
      saveSubmissions(submissions);
      res.json({ success: true, student });
      return;
    }
  } catch (error) {
    console.error("Failed to regenerate AI text", error);
    res.status(500).json({ success: false, message: "AI 생성 중 오류가 발생했습니다." });
    return;
  }

  res.status(500).json({ success: false, message: "AI 생성 결과가 올바르지 않습니다." });
});

// Serve frontend assets
async function startServer() {
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

startServer();
