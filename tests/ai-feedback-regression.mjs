import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

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
  const feedback = postProcessFeedback(generateFallbackText("민수", keywords).aiFeedback, "민수");
  for (const keyword of keywords) assert.ok(feedback.includes(keyword), "missing keyword: " + keyword);
  assert.ok(!feedback.includes("민수"));
  assert.ok(!/AI|인공지능|마술사|분석가|데이터|알고리즘/.test(feedback));
  assert.ok(!feedback.includes("우리 반의 자랑"));
  assert.equal(feedback.split(".").length - 1, 4);
});

test("prompt는 조사 중복과 과장을 금지하고 이름 생략을 허용함", () => {
  const prompt = buildTeacherFeedbackPrompt({ name: "민수", grade: "5", classNumber: "1", keywords });
  assert.ok(prompt.includes("조사 하나만"));
  assert.ok(prompt.includes("우리 반의 자랑"));
  assert.ok(prompt.includes("생략해도 됩니다"));
});
