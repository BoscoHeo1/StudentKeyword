import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// 1. server.ts에서 피드백 관련 실제 프로덕션 함수 추출 및 VM 컴파일
const source = fs.readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("server.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = new Set(["buildTeacherFeedbackPrompt", "postProcessFeedback", "generateFallbackText"]);
const declarations = ast.statements
  .filter(node => ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text))
  .map(node => node.getText(ast));
assert.equal(declarations.length, names.size, "all production feedback functions must be found");
const compiled = ts.transpile(declarations.join("\n") + "\nmodule.exports = { buildTeacherFeedbackPrompt, postProcessFeedback, generateFallbackText };", {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022
});
const sandbox = { module: { exports: {} } };
vm.runInNewContext(compiled, sandbox);
const { buildTeacherFeedbackPrompt, postProcessFeedback, generateFallbackText } = sandbox.module.exports;
const keywords = ["배려", "성실함", "책임감", "자기주도성", "협력"];

// -------------------------------------------------------------------------
// QA 공통 검증 헬퍼 (QA 규칙 A~E 종합 판정)
// -------------------------------------------------------------------------
const FORBIDDEN_META_WORDS = [/AI/i, /인공지능/, /마술사/, /알고리즘/, /분석\s*시스템/, /데이터/, /분석가/];

function countSentences(text) {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/(?<=[.!?])\s+/).filter(Boolean).length;
}

function countOccurrences(text, searchStr) {
  if (!text || !searchStr) return 0;
  const escaped = searchStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = text.match(new RegExp(escaped, "g"));
  return matches ? matches.length : 0;
}

const HOMONYM_NAMES = new Set(["하나", "우리", "보람", "사랑", "믿음"]);

function verifyFeedbackQuality(feedback, options = {}) {
  const { name, expectedKeywords, allowNoName = true, minSentences = 3, maxSentences = 5 } = options;

  // A. 문장 수 검증 (기본 3~5문장)
  const sentenceCount = countSentences(feedback);
  assert.ok(
    sentenceCount >= minSentences && sentenceCount <= maxSentences,
    `[QA 규칙 A] 문장 수는 ${minSentences}~${maxSentences}문장이어야 합니다. 현재: ${sentenceCount}문장 (내용: ${feedback})`
  );

  // B. 교사 어조 및 금지 메타 표현 검증
  for (const pattern of FORBIDDEN_META_WORDS) {
    assert.ok(
      !pattern.test(feedback),
      `[QA 규칙 B] 금지된 메타 표현(${pattern})이 포함되어 있습니다: ${feedback}`
    );
  }
  assert.ok(
    !feedback.includes("우리 반의 자랑"),
    "[QA 규칙 B] 지나치게 과장된 표현('우리 반의 자랑')이 포함되어 있습니다."
  );

  // C & E. 이름 사용 및 호칭 검증
  if (name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // 일반 이름: 명백한 반복 인명이 2인칭으로 정리되어 최대 1회만 남아야 함
    // 동형어 이름: 의미 왜곡 방지를 위해 후처리에서 원문을 보존하므로 최대 1회 제약 면제
    if (!HOMONYM_NAMES.has(name)) {
      const nameOccurrences = countOccurrences(feedback, name);
      assert.ok(
        nameOccurrences <= 1,
        `[QA 규칙 C] 학생 이름은 최대 1회만 허용됩니다. 현재: ${nameOccurrences}회 (내용: ${feedback})`
      );
      if (!allowNoName) {
        assert.equal(nameOccurrences, 1, `[QA 규칙 C] 학생 이름이 정확히 1회 포함되어야 합니다.`);
      }
    }

    // 이름 뒤 강제 '아/야' 및 중복 호칭('아아', '야야', '야아', '아야') 금지
    assert.ok(
      !new RegExp(escapedName + "(?:아아|야야|야아|아야|아|야)(?=[\\s,.!?]|$)").test(feedback),
      `[QA 규칙 C] 이름 뒤 강제 아/야 또는 중복 호칭이 남아 있습니다: ${feedback}`
    );

    // 받침별 조사 적합성 검증
    const lastCode = name.charCodeAt(name.length - 1);
    if (lastCode >= 0xac00 && lastCode <= 0xd7a3) {
      const hasFinalConsonant = (lastCode - 0xac00) % 28 !== 0;
      if (hasFinalConsonant) {
        assert.ok(
          !new RegExp(escapedName + "(?:는|가|를|와)(?=[\\s,.!?]|$)").test(feedback),
          `[QA 규칙 C] 받침 있는 이름 뒤에 어색한 조사(는/가/를/와)가 사용되었습니다: ${feedback}`
        );
      } else {
        assert.ok(
          !new RegExp(escapedName + "(?:은|이|을|과)(?=[\\s,.!?]|$)").test(feedback),
          `[QA 규칙 C] 받침 없는 이름 뒤에 어색한 조사(은/이/을/과)가 사용되었습니다: ${feedback}`
        );
      }
    }
  }

  // D. 키워드 포함 검증
  if (expectedKeywords && expectedKeywords.length > 0) {
    for (const kw of expectedKeywords) {
      assert.ok(feedback.includes(kw), `[QA 규칙 D] 필수 키워드 '${kw}'가 누락되었습니다.`);
    }
  }
}

// -------------------------------------------------------------------------
// [기존 15개 테스트 유지] - 기존 검증 의미 100% 보존
// -------------------------------------------------------------------------

for (const [name, particle] of [["민수", "는"], ["민석", "은"], ["민수", "가"], ["민석", "이"], ["민수", "를"], ["민석", "을"], ["민수", "와"], ["민석", "과"]]) {
  test("중복 조사 " + particle + " 하나만 보존", () => {
    const input = name + particle + " " + particle + " 오늘도 차근차근 해냈어.";
    const expected = name + particle + " 오늘도 차근차근 해냈어.";
    assert.equal(postProcessFeedback(input, name), expected);
  });
}

test("받침 있는 이름의 는 중복을 자연스러운 은으로 정리함", () => {
  const input = "검증학생는 는 오늘도 맡은 일을 해냈어.";
  const expected = "검증학생은 오늘도 맡은 일을 해냈어.";
  assert.equal(postProcessFeedback(input, "검증학생"), expected);
});

test("다른 조사가 연달아 붙어도 첫 조사만 유지함", () => {
  assert.equal(postProcessFeedback("민수와 과 친구들과 지냈어.", "민수"), "민수와 친구들과 지냈어.");
  assert.equal(postProcessFeedback("민수는 은 차분하게 생각했어.", "민수"), "민수는 차분하게 생각했어.");
});

test("정상적인 받침별 이름 조사는 훼손하지 않음", () => {
  for (const [name, particle] of [["민수", "는"], ["민석", "은"], ["민수", "가"], ["민석", "이"], ["민수", "를"], ["민석", "을"], ["민수", "와"], ["민석", "과"]]) {
    const sentence = name + particle + " 자기 생각을 차분히 말했어.";
    assert.equal(postProcessFeedback(sentence, name), sentence);
  }
});

test("이름이 없는 문장에는 이름을 억지로 삽입하지 않음", () => {
  const sentence = "오늘도 차분하게 생각하고 친구의 이야기를 잘 들었구나.";
  assert.equal(postProcessFeedback(sentence, "민수"), sentence);
});

test("아아·야야·야아·단일 아/야 호칭을 만들거나 남기지 않음", () => {
  for (const ending of ["아아", "야야", "야아", "아야", "아", "야"]) {
    const result = postProcessFeedback("민수" + ending + ", 오늘도 잘했어.", "민수");
    assert.equal(result, "민수, 오늘도 잘했어.");
  }
});

test("fallback은 5개 키워드와 차분한 교사 말투를 유지하고 이름을 강제하지 않음", () => {
  const fallbackObj = generateFallbackText("민수", keywords);
  const feedback = postProcessFeedback(fallbackObj.aiFeedback, "민수");
  for (const keyword of keywords) assert.ok(feedback.includes(keyword), "missing keyword: " + keyword);
  assert.ok(!feedback.includes("민수"));
  assert.ok(!/AI|인공지능|마술사|분석가|데이터|알고리즘/.test(feedback));
  assert.ok(!feedback.includes("우리 반의 자랑"));
  assert.equal(feedback.split(".").length - 1, 4);

  // QA 규칙 헬퍼로도 전수 검증
  verifyFeedbackQuality(feedback, {
    name: "민수",
    expectedKeywords: keywords,
    allowNoName: true,
    minSentences: 3,
    maxSentences: 5
  });
});

test("prompt는 조사 중복과 과장을 금지하고 이름 생략을 허용함", () => {
  const prompt = buildTeacherFeedbackPrompt({ name: "민수", grade: "5", classNumber: "1", keywords });
  assert.ok(prompt.includes("조사 하나만"));
  assert.ok(prompt.includes("우리 반의 자랑"));
  assert.ok(prompt.includes("생략해도 됩니다"));
});

// -------------------------------------------------------------------------
// [신규 QA 규칙 및 Edge Case 테스트]
// -------------------------------------------------------------------------

test("[QA 규칙 A: 문장 수] 6문장 이상의 과도하게 긴 피드백은 최대 5문장으로 제한함", () => {
  const longInput = "첫 번째 문장입니다. 두 번째 문장입니다. 세 번째 문장입니다. 네 번째 문장입니다. 다섯 번째 문장입니다. 여섯 번째 문장입니다. 일곱 번째 문장입니다.";
  const processed = postProcessFeedback(longInput, "민수");
  const count = countSentences(processed);
  assert.equal(count, 5, `5문장으로 제한되어야 합니다. 현재: ${count}`);
  assert.ok(!processed.includes("여섯 번째"), "6번째 이후 문장은 제거되어야 합니다.");
});

test("[QA 규칙 B: 교사 어조] AI, 마술사, 알고리즘, 분석 시스템 등 메타 표현을 완벽히 제거함", () => {
  const inputWithMeta = "AI 알고리즘 분석 시스템에 따르면 민수는 마술사처럼 놀라운 능력을 보여주었어. 데이터 분석가처럼 꼼꼼하게 문제를 해결했단다.";
  const processed = postProcessFeedback(inputWithMeta, "민수");
  for (const pattern of FORBIDDEN_META_WORDS) {
    assert.ok(!pattern.test(processed), `메타 표현(${pattern})이 제거되지 않았습니다: ${processed}`);
  }
});

test("[QA 규칙 C: 이름 사용] 받침 없는 이름(민수, 서아, 지우)의 잘못된 조사 및 호칭 교정", () => {
  const candidates = [
    { name: "민수", wrongParticle: "은", rightParticle: "는" },
    { name: "서아", wrongParticle: "이", rightParticle: "가" },
    { name: "지우", wrongParticle: "과", rightParticle: "와" },
    { name: "서아", wrongParticle: "을", rightParticle: "를" }
  ];
  for (const { name, wrongParticle, rightParticle } of candidates) {
    const input = `${name}${wrongParticle} 친구들에게 따뜻하게 배려하는 마음을 보였어.`;
    const processed = postProcessFeedback(input, name);
    assert.equal(processed, `${name}${rightParticle} 친구들에게 따뜻하게 배려하는 마음을 보였어.`);
  }
});

test("[QA 규칙 C: 이름 사용] 받침 있는 이름(민석, 지훈, 하람)의 잘못된 조사 및 호칭 교정", () => {
  const candidates = [
    { name: "민석", wrongParticle: "는", rightParticle: "은" },
    { name: "지훈", wrongParticle: "가", rightParticle: "이" },
    { name: "하람", wrongParticle: "와", rightParticle: "과" },
    { name: "민석", wrongParticle: "를", rightParticle: "을" }
  ];
  for (const { name, wrongParticle, rightParticle } of candidates) {
    const input = `${name}${wrongParticle} 친구들과 성실하게 협력했어.`;
    const processed = postProcessFeedback(input, name);
    assert.equal(processed, `${name}${rightParticle} 친구들과 성실하게 협력했어.`);
  }
});

test("[QA 규칙 C: 이름 사용] Gemini가 이름+아/야를 반환한 경우 호칭을 제거함", () => {
  // 받침 없는 이름 + 야
  const res1 = postProcessFeedback("민수야, 언제나 책임을 다하는 모습이 보기 좋아.", "민수");
  assert.equal(res1, "민수, 언제나 책임을 다하는 모습이 보기 좋아.");

  // 받침 있는 이름 + 아
  const res2 = postProcessFeedback("민석아, 오늘도 묵묵히 제 몫을 해냈구나.", "민석");
  assert.equal(res2, "민석, 오늘도 묵묵히 제 몫을 해냈구나.");
});

test("[QA 규칙 C & E: 이름 사용] Gemini가 이름을 여러 번 반환한 경우 최대 1회만 유지함", () => {
  const inputMultiName = "민수는 친구들을 잘 배려해. 민수는 책임감도 강한 학생이야. 앞으로도 민수의 성장을 항상 응원할게.";
  const processed = postProcessFeedback(inputMultiName, "민수");
  const count = countOccurrences(processed, "민수");
  assert.equal(count, 1, `이름은 최대 1회만 유지되어야 합니다. 현재 ${count}회: ${processed}`);
  assert.ok(!processed.includes("민수는 책임감"), "두 번째 민수는 제거되어 자연스러워야 합니다.");
});

test("[QA 규칙 C & E: 이름 사용] 이름이 문장 중간에 위치한 경우에도 정상 처리함", () => {
  const input = "선생님이 지켜본 결과 민수이 매사에 최선을 다하고 있어.";
  const processed = postProcessFeedback(input, "민수");
  assert.equal(processed, "선생님이 지켜본 결과 민수가 매사에 최선을 다하고 있어.");
});

test("[QA 규칙 E: post-processing] 매우 짧거나 빈 입력에 대해서도 안전하게 동작함", () => {
  assert.equal(postProcessFeedback("", "민수"), "");
  assert.equal(postProcessFeedback("   ", "민수"), "");
  const oneSentence = "참 잘했어.";
  assert.equal(postProcessFeedback(oneSentence, "민수"), "참 잘했어.");
});

test("[QA 규칙 D: Fallback 품질] 다양한 키워드와 이름에 대해 Fallback이 QA 기준을 충족함", () => {
  const testCases = [
    { name: "지훈", kws: ["끈기", "정직", "예의", "호기심", "나눔"] },
    { name: "서아", kws: ["도전", "공감", "긍정", "소통", "용기"] }
  ];
  for (const tc of testCases) {
    const fallback = generateFallbackText(tc.name, tc.kws);
    const processed = postProcessFeedback(fallback.aiFeedback, tc.name);
    verifyFeedbackQuality(processed, {
      name: tc.name,
      expectedKeywords: tc.kws,
      allowNoName: true,
      minSentences: 3,
      maxSentences: 5
    });
  }
});

test("[Mock Gemini 시나리오 1: 표준적인 정상 응답]", () => {
  const mockGeminiResponse = {
    aiFeedback: "민수는 친구들의 이야기를 차분하게 들어주는 따뜻한 마음을 지니고 있단다. 스스로 계획한 일을 성실하게 끝까지 해내려는 태도도 참 인상 깊었어. 앞으로도 지금처럼 주변을 배려하며 함께 성장해 나가길 기대할게."
  };
  const processed = postProcessFeedback(mockGeminiResponse.aiFeedback, "민수");
  verifyFeedbackQuality(processed, {
    name: "민수",
    allowNoName: false,
    minSentences: 3,
    maxSentences: 5
  });
});

test("[Mock Gemini 시나리오 2: 호칭 오류·메타표현·조사오류가 복합된 불량 응답 정제]", () => {
  const mockGeminiResponse = {
    aiFeedback: "민수야야! AI 분석 시스템에 따르면 민수은 는 마술사처럼 놀라운 협동심을 발휘했어. 민수는 책임감 있게 과제를 마무리했어. 앞으로도 멋진 모습을 보여주렴."
  };
  const processed = postProcessFeedback(mockGeminiResponse.aiFeedback, "민수");
  verifyFeedbackQuality(processed, {
    name: "민수",
    allowNoName: false,
    minSentences: 3,
    maxSentences: 5
  });
  assert.ok(!/AI|마술사|분석\s*시스템/.test(processed), "모든 메타 표현이 제거되어야 함");
  assert.ok(!processed.includes("민수야"), "호칭 오류가 정제되어야 함");
  assert.equal(countOccurrences(processed, "민수"), 1, "이름은 최대 1회만 존재해야 함");
});

test("[Mock Gemini 시나리오 3: 7문장 장문 응답의 5문장 제한]", () => {
  const mockGeminiResponse = {
    aiFeedback: "민수는 배려심이 참 깊은 친구야. 항상 친구들을 먼저 생각하는 모습이 예뻐. 과제를 할 때도 성실하게 책임을 다하더구나. 스스로 목표를 세우고 실천하는 힘도 대단해. 친구들과 함께할 때 더욱 빛이 나는 학생이란다. 앞으로의 성장이 더욱 기대되는구나. 언제나 응원할게."
  };
  const processed = postProcessFeedback(mockGeminiResponse.aiFeedback, "민수");
  verifyFeedbackQuality(processed, {
    name: "민수",
    allowNoName: false,
    minSentences: 3,
    maxSentences: 5
  });
  assert.equal(countSentences(processed), 5);
});

test("[Prompt Template 종합 검증] 프롬프트가 문장 수, 교사 어조, 금지어, 이름 규칙을 모두 명시함", () => {
  const prompt = buildTeacherFeedbackPrompt({
    name: "홍길동",
    grade: "4",
    classNumber: "2",
    studentNumber: "15",
    keywords
  });

  // 1. 학생 정보 포함
  assert.ok(prompt.includes("홍길동"));
  assert.ok(prompt.includes("4학년 2반 15번"));

  // 2. 문장 수 제약
  assert.ok(prompt.includes("3~5문장"));

  // 3. 교사 어조 및 금지어
  assert.ok(prompt.includes("담임 선생님"));
  assert.ok(prompt.includes("AI"));
  assert.ok(prompt.includes("마술사"));
  assert.ok(prompt.includes("알고리즘"));
  assert.ok(prompt.includes("분석 시스템"));

  // 4. 이름 사용 제약
  assert.ok(prompt.includes("최대 1회"));
  assert.ok(prompt.includes("'아'나 '야'를 붙이지 마세요"));
  assert.ok(prompt.includes("조사 중복"));

  // 5. JSON 형식 명시
  assert.ok(prompt.includes('"aiFeedback"'));
  assert.ok(prompt.includes('"reportCardDraft"'));
});

// Repeated names must not leave orphaned particles or fragments in Korean prose.
const repeatedNameCases = [
  ["처럼", "민수", "민수는 친구를 잘 도와. 친구들은 민수처럼 배려해.", "민수는 친구를 잘 도와. 친구들은 너처럼 배려해."],
  ["보다", "민수", "민수는 성실해. 친구들은 민수보다 먼저 준비했어.", "민수는 성실해. 친구들은 너보다 먼저 준비했어."],
  ["에게", "민수", "민수는 책임감이 있어. 선생님은 민수에게 고마움을 느꼈어.", "민수는 책임감이 있어. 선생님은 너에게 고마움을 느꼈어."],
  ["한테", "민수", "민수는 배려심이 있어. 친구가 민수한테 도움을 받았어.", "민수는 배려심이 있어. 친구가 너한테 도움을 받았어."],
  ["의", "민수", "민수는 꾸준해. 민수의 성장을 기대할게.", "민수는 꾸준해. 너의 성장을 기대할게."],
  ["와 함께", "민수", "민수는 차분해. 민수와 함께 활동한 친구들도 즐거워했어.", "민수는 차분해. 너와 함께 활동한 친구들도 즐거워했어."],
  ["받침 있는 이름+처럼", "민석", "민석은 친구를 배려해. 친구들도 민석처럼 행동해.", "민석은 친구를 배려해. 친구들도 너처럼 행동해."],
  ["받침 있는 이름+에게", "지훈", "지훈은 성실해. 선생님은 지훈에게 고마워.", "지훈은 성실해. 선생님은 너에게 고마워."],
  // [조사 확장: 랑/이랑]
  ["받침 없는 이름+랑", "민수", "민수는 성실해. 친구들은 민수랑 함께했어.", "민수는 성실해. 친구들은 너랑 함께했어."],
  ["받침 있는 이름+이랑(민석)", "민석", "민석은 성실해. 친구들은 민석이랑 함께했어.", "민석은 성실해. 친구들은 너랑 함께했어."],
  ["받침 있는 이름+이랑(지훈)", "지훈", "지훈은 책임감이 있어. 친구들은 지훈이랑 활동했어.", "지훈은 책임감이 있어. 친구들은 너랑 활동했어."],
  ["받침 없는 이름+구어체 이랑", "민수", "민수는 성실해. 친구들은 민수이랑 함께했어.", "민수는 성실해. 친구들은 너랑 함께했어."]
];
for (const [suffix, name, input, expected] of repeatedNameCases) {
  test("[이름 중복 문장 보존] " + suffix, () => {
    const processed = postProcessFeedback(input, name);
    assert.equal(processed, expected);
    assert.equal(countOccurrences(processed, name), 1);
  });
}

test("[이름 경계] 일반 단어 속 같은 글자를 학생 이름으로 바꾸지 않음", () => {
  const input = "하나는 성실해. 친구들은 하나씩 준비했어.";
  assert.equal(postProcessFeedback(input, "하나"), input);
});

// -------------------------------------------------------------------------
// [필수 회귀 테스트 10종: 일반 이름 2인칭 정리 & 동형어 이름 원문 보존]
// -------------------------------------------------------------------------

test("[필수 회귀 1] 민수의 성장을 기대해 -> 너의 성장으로 정리", () => {
  const input = "민수는 성실해. 선생님은 민수의 성장을 기대해.";
  const expected = "민수는 성실해. 선생님은 너의 성장을 기대해.";
  assert.equal(postProcessFeedback(input, "민수"), expected);
  assert.equal(countOccurrences(postProcessFeedback(input, "민수"), "민수"), 1);
});

test("[필수 회귀 2] 민수랑 함께했어 -> 너랑", () => {
  const input = "민수는 성실해. 친구들은 민수랑 함께했어.";
  const expected = "민수는 성실해. 친구들은 너랑 함께했어.";
  assert.equal(postProcessFeedback(input, "민수"), expected);
  assert.equal(countOccurrences(postProcessFeedback(input, "민수"), "민수"), 1);
});

test("[필수 회귀 3] 민석이랑 함께했어 -> 너랑", () => {
  const input = "민석은 성실해. 친구들은 민석이랑 함께했어.";
  const expected = "민석은 성실해. 친구들은 너랑 함께했어.";
  assert.equal(postProcessFeedback(input, "민석"), expected);
  assert.equal(countOccurrences(postProcessFeedback(input, "민석"), "민석"), 1);
});

test("[필수 회귀 4] 민수에게 고마워 -> 너에게", () => {
  const input = "민수는 책임감이 있어. 선생님은 민수에게 고마워.";
  const expected = "민수는 책임감이 있어. 선생님은 너에게 고마워.";
  assert.equal(postProcessFeedback(input, "민수"), expected);
  assert.equal(countOccurrences(postProcessFeedback(input, "민수"), "민수"), 1);
});

test("[필수 회귀 5] 동형어 이름 '하나' - '하나의 목표' 원문 보존", () => {
  const input = "하나는 성실해. 친구들은 하나의 목표를 세웠어.";
  assert.equal(postProcessFeedback(input, "하나"), input);
});

test("[필수 회귀 6] 동형어 이름 '하나' - '하나의 성장' 원문 보존 허용 (의미 추측 금지)", () => {
  const input = "하나는 성실해. 선생님은 하나의 성장을 기대해.";
  assert.equal(postProcessFeedback(input, "하나"), input);
});

test("[필수 회귀 7] 동형어 이름 '하나' - '하나씩' 접미사 원문 보존", () => {
  const input = "하나는 성실해. 친구들은 하나씩 준비했어.";
  assert.equal(postProcessFeedback(input, "하나"), input);
});

test("[필수 회귀 8] 동형어 이름 '우리' - '우리 반' 원문 보존", () => {
  const input = "우리는 책임감이 있어. 우리 반 친구들도 함께 도왔어.";
  assert.equal(postProcessFeedback(input, "우리"), input);
});

test("[필수 회귀 9] 동형어 이름 '보람' - '활동에서 큰 보람을 느꼈어' 원문 보존", () => {
  const input = "보람은 성실해. 활동에서 큰 보람을 느꼈어.";
  assert.equal(postProcessFeedback(input, "보람"), input);
});

test("[필수 회귀 10] 기존 처럼 / 보다 / 에게 / 한테 / 의 / 와 함께 / 랑 / 이랑 케이스 회귀 유지", () => {
  // repeatedNameCases 12종에서 전수 검증되므로 대표 조합 1건 추가 검증
  const input = "민수는 성실해. 친구들은 민수와 함께 활동했고 민수보다 앞서기도 했어.";
  const processed = postProcessFeedback(input, "민수");
  assert.equal(processed, "민수는 성실해. 친구들은 너와 함께 활동했고 너보다 앞서기도 했어.");
  assert.equal(countOccurrences(processed, "민수"), 1);
});
