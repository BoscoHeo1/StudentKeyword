/**
 * scripts/smoke-test-gemini.mjs
 * 
 * [선택적/수동 Gemini Smoke Test]
 * - GitHub Actions CI에서는 실행되지 않으며, 개발자가 실제 Gemini API 응답 품질을 수동 점검할 때 사용합니다.
 * - 보안 주의사항: API 키는 환경변수(GEMINI_API_KEY)로만 전달받으며, 키 값은 화면에 절대 출력하지 않습니다.
 * - 개인정보 보호: 실제 학생 데이터를 절대 사용하지 않으며, 순수 가상 합성 샘플(Synthetic Sample)만 사용합니다.
 * - 비용 주의사항: 실제 Gemini API 호출이 발생하므로 소정의 API 비용이 발생할 수 있습니다.
 */

import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { GoogleGenAI } from "@google/genai";

// 1. API 키 보안 확인 (출력 금지)
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.log("==================================================================");
  console.log("ℹ️  [Gemini Smoke Test 건너뜀]");
  console.log("GEMINI_API_KEY 환경변수가 설정되지 않아 실제 Gemini 호출을 건너뜁니다.");
  console.log("실제 API 품질을 수동 검증하려면 다음과 같이 실행하세요:");
  console.log("  $env:GEMINI_API_KEY=\"your_key_here\"; npm run test:gemini-smoke");
  console.log("==================================================================");
  process.exit(0);
}

// 2. 비용 및 실행 안내 (키 값은 마스킹하여 안전하게 처리)
console.log("==================================================================");
console.log("⚠️  [주의: 실제 Gemini API 호출 스모크 테스트]");
console.log("• 실제 Google Gemini API를 호출하므로 API 사용량 및 비용이 발생할 수 있습니다.");
console.log("• 감지된 API 키: " + "*".repeat(Math.min(apiKey.length, 24)) + ` (길이: ${apiKey.length}자)`);
console.log("• 테스트 데이터: 순수 가상 합성 학생 데이터 (Synthetic Sample)");
console.log("==================================================================\n");

// 3. server.ts에서 프로덕션 함수 로드
const source = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("server.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = new Set(["buildTeacherFeedbackPrompt", "postProcessFeedback", "generateFallbackText"]);
const declarations = ast.statements
  .filter(node => ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text))
  .map(node => node.getText(ast));

const compiled = ts.transpile(declarations.join("\n") + "\nmodule.exports = { buildTeacherFeedbackPrompt, postProcessFeedback, generateFallbackText };", {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022
});
const sandbox = { module: { exports: {} } };
vm.runInNewContext(compiled, sandbox);
const { buildTeacherFeedbackPrompt, postProcessFeedback } = sandbox.module.exports;

// 4. 가상 합성 학생 샘플 정의 (실제 학생 데이터 절대 사용 금지)
const syntheticSamples = [
  {
    label: "가상 샘플 1 (받침 없는 이름)",
    name: "민수",
    grade: "5",
    classNumber: "1",
    studentNumber: "12",
    keywords: ["배려", "성실함", "책임감", "자기주도성", "협력"]
  },
  {
    label: "가상 샘플 2 (받침 있는 이름)",
    name: "지훈",
    grade: "5",
    classNumber: "2",
    studentNumber: "7",
    keywords: ["끈기", "정직", "공감", "긍정", "용기"]
  }
];

// 5. 검증 헬퍼 함수
const FORBIDDEN_WORDS = [/AI/i, /인공지능/, /마술사/, /알고리즘/, /분석\s*시스템/, /데이터/, /분석가/];

function validateFeedback(feedback, studentName) {
  const issues = [];
  const sentences = feedback.split(/(?<=[.!?])\s+/).filter(Boolean);

  // 규칙 A: 문장 수 (3~5문장)
  if (sentences.length < 3 || sentences.length > 5) {
    issues.push(`문장 수 범위(3~5문장) 위반: 현재 ${sentences.length}문장`);
  }

  // 규칙 B: 교사 어조 및 금지 메타 표현
  for (const pattern of FORBIDDEN_WORDS) {
    if (pattern.test(feedback)) {
      issues.push(`금지 메타 표현 포함: ${pattern}`);
    }
  }
  if (feedback.includes("우리 반의 자랑")) {
    issues.push("과장된 표현('우리 반의 자랑') 포함");
  }

  // 규칙 C: 이름 사용 및 호칭
  const escaped = studentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameMatches = (feedback.match(new RegExp(escaped, "g")) || []).length;
  if (nameMatches > 1) {
    issues.push(`이름 1회 초과 사용: ${nameMatches}회`);
  }
  if (new RegExp(escaped + "(?:아아|야야|야아|아야|아|야)(?=[\\s,.!?]|$)").test(feedback)) {
    issues.push("이름 뒤 강제 아/야 또는 중복 호칭 포함");
  }

  return {
    valid: issues.length === 0,
    sentenceCount: sentences.length,
    nameCount: nameMatches,
    issues
  };
}

// 6. 스모크 테스트 실행
async function runSmokeTests() {
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "studentkeyword-smoke-test"
      }
    }
  });

  let totalPassed = 0;

  for (const sample of syntheticSamples) {
    console.log(`▶ [${sample.label}] 호출 시작: 이름='${sample.name}', 키워드=[${sample.keywords.join(", ")}]`);
    try {
      const prompt = buildTeacherFeedbackPrompt(sample);
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      const responseText = response.text || "";
      let parsed;
      try {
        parsed = JSON.parse(responseText.trim());
      } catch (err) {
        console.error("  ❌ JSON 파싱 실패:", responseText.slice(0, 100));
        continue;
      }

      console.log(`  [원본 응답]: "${parsed.aiFeedback || '(비어있음)'}"`);

      // 후처리 적용
      const processed = postProcessFeedback(parsed.aiFeedback || "", sample.name);
      console.log(`  [후처리 결과]: "${processed}"`);

      // 품질 검증 판정
      const result = validateFeedback(processed, sample.name);
      if (result.valid) {
        console.log(`  ✅ 품질 검증 통과 (문장 수: ${result.sentenceCount}, 이름 사용: ${result.nameCount}회)\n`);
        totalPassed++;
      } else {
        console.log(`  ❌ 품질 검증 실패:`);
        for (const issue of result.issues) {
          console.log(`     - ${issue}`);
        }
        console.log("");
      }
    } catch (err) {
      console.error(`  ❌ API 호출 실패: ${err.message}\n`);
    }
  }

  console.log("==================================================================");
  console.log(`📊 Gemini Smoke Test 완료: ${totalPassed}/${syntheticSamples.length} 성공`);
  console.log("==================================================================");

  if (totalPassed !== syntheticSamples.length) {
    process.exitCode = 1;
  }
}

runSmokeTests();
