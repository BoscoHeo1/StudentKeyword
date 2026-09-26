// Offline regression tests: SDK/database calls are mocked; no production access.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const source = file => fs.readFileSync(path.join(root, file), "utf8");
function load(file, imports = {}, globals = {}, transform = s => s) {
  const module = { exports: {} };
  const js = ts.transpileModule(transform(source(file)), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText;
  const sandbox = {
    module, exports: module.exports, Buffer, URL, console: { log() {}, warn() {}, error() {} },
    process: { env: {}, cwd: () => root },
    require: name => {
      if (Object.hasOwn(imports, name)) return imports[name];
      if (name === "node:crypto" || name === "path") return require(name);
      throw new Error("Unexpected dependency: " + name);
    }, ...globals
  };
  vm.runInNewContext(js, sandbox, { filename: file });
  return module.exports;
}
const password = load("server/password.ts");
const auth = load("server/teacher-auth.ts");
const deleted = Symbol("deleted");
let records = new Map(), writes = 0, reads = 0, broken = false, writeFailure = false, aiCalls = 0;
let nextId, beforeTransaction, failGeneration = false;
const copy = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const snapshot = ref => ({ id: ref.id, ref, exists: records.has(ref.path), data: () => copy(records.get(ref.path)) });
const ref = (col, id) => ({ id, path: col + "/" + id, get: async () => {
  reads++; if (broken) throw Error("DB failed"); return snapshot(ref(col, id));
}});
const database = {
  collection(col) {
    assert.ok(["classes", "submissions"].includes(col), "config must never be accessed");
    return {
      doc: id => ref(col, id),
      where: (field, op, value) => ({ get: async () => {
        reads++; if (broken) throw Error("DB failed");
        assert.equal(field, "classCode"); assert.equal(op, "==");
        const docs = [...records].filter(([p, data]) => p.startsWith(col + "/") && data[field] === value)
          .map(([p]) => snapshot(ref(col, p.split("/")[1])));
        return { docs, forEach: f => docs.forEach(f) };
      } })
    };
  },
  async runTransaction(fn) {
    if (broken || writeFailure) throw Error("DB failed");
    if (beforeTransaction) { const f = beforeTransaction; beforeTransaction = null; f(); }
    const operations = [];
    const result = await fn({
      get: async r => snapshot(r),
      getAll: async (...refs) => refs.map(snapshot),
      create: (r, data) => {
        if (records.has(r.path)) throw Error("ALREADY_EXISTS");
        operations.push(() => records.set(r.path, copy(data)));
      },
      set: (r, data) => operations.push(() => {
        const value = { ...records.get(r.path), ...data };
        if (value.password === deleted) delete value.password;
        records.set(r.path, copy(value));
      }),
      update: (r, data) => {
        if (!records.has(r.path)) throw Error("NOT_FOUND");
        operations.push(() => records.set(r.path, { ...records.get(r.path), ...copy(data) }));
      },
      delete: r => operations.push(() => records.delete(r.path))
    });
    operations.forEach(f => { f(); writes++; });
    return result;
  }
};
const routes = new Map();
const app = { use() {}, listen() { throw Error("Must not start server"); } };
for (const method of ["get", "post", "delete", "all"]) app[method] = (route, ...handlers) => routes.set(method + " " + route, handlers);
const express = Object.assign(() => app, { json: () => () => {}, static: () => () => {} });
const server = load("server.ts", {
  express, vite: {}, "@google/genai": { GoogleGenAI: class {
    models = { generateContent: async () => {
      aiCalls++; return { text: JSON.stringify({ aiFeedback: "모의 피드백", reportCardDraft: "성장함." }) };
    } };
  } },
  "node:crypto": { randomUUID: () => {
    if (failGeneration) throw Error("Simulated processing exception");
    return nextId || crypto.randomUUID();
  } },
  "./server/password": password, "./server/teacher-auth": auth,
  "./server/firestore": { getServerFirestore: () => { if (broken) throw Error("Unavailable"); return database; } },
  "firebase-admin/firestore": { FieldValue: { delete: () => deleted } }
}, {}, s => s.slice(0, s.indexOf("startServer().catch")) +
  "\nexport { validateStudentInput, getClassAsync, saveClassAsync, escapeRegExp, postProcessFeedback };");
let peers = 0;
async function call(method, route, { body = {}, token = "", query = {}, id = "", origin = "http://localhost:3000" } = {}) {
  const req = { body, query, params: { id }, path: route, headers: { cookie: token },
    socket: { remoteAddress: "test-" + (++peers) }, get: key => key === "origin" ? origin : undefined };
  const res = { statusCode: 200, locals: {}, headers: {}, status(n) { this.statusCode = n; return this; },
    json(data) { this.data = data; }, setHeader(k, v) { this.headers[k] = v; },
    cookie(name, value, options) { this.cookieValue = name + "=" + value; this.cookieOptions = options; }, clearCookie() {} };
  const handlers = routes.get(method + " " + route) || routes.get("all " + route);
  async function run(i) {
    if (i === handlers.length) return;
    let pending;
    await handlers[i](req, res, () => { pending = run(i + 1); });
    if (pending) await pending;
  }
  await run(0);
  return res;
}
const student = { grade: "3", classNumber: "1", studentNumber: "1", name: "테스트", keywords: ["가", "나", "다", "라", "마"], classCode: "a" };

async function main() {
  // Initialization failure, project mismatch, malformed credential, and mock success.
  const credential = { type: "service_account", project_id: "test-only", client_email: "test@example.invalid", private_key: "test-only" };
  function initialize(env, shouldFail = false) {
    return load("server/firestore.ts", {
      "node:fs": { readFileSync: () => JSON.stringify(credential) },
      "firebase-admin/app": { getApps: () => [], cert: x => x, applicationDefault: () => ({ source: "adc" }),
        initializeApp: options => { if (shouldFail) throw Error("invalid"); return options; } },
      "firebase-admin/firestore": { getFirestore: () => database }
    }, { process: { env } });
  }
  for (const env of [{}, { FIREBASE_PROJECT_ID: "test-only" },
    { FIREBASE_PROJECT_ID: "test-only", FIREBASE_SERVICE_ACCOUNT_JSON: "{" },
    { FIREBASE_PROJECT_ID: "wrong", FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(credential) }]) {
    assert.throws(() => initialize(env).getServerFirestore());
  }
  const env = { FIREBASE_PROJECT_ID: "test-only", FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(credential) };
  assert.throws(() => initialize(env, true).getServerFirestore());
  assert.equal(initialize(env).getServerFirestore(), database);
  assert.equal(initialize({ FIREBASE_PROJECT_ID: "test-only", GOOGLE_APPLICATION_CREDENTIALS: "/test-only" }).getServerFirestore(), database);
  const cloudRun = initialize({ FIREBASE_PROJECT_ID: "test-only", K_SERVICE: "studentkeyword-api" });
  assert.equal(cloudRun.getServerFirestore(), database);
  assert.throws(() => initialize({ FIREBASE_PROJECT_ID: "test-only", K_SERVICE: "studentkeyword-api", FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(credential) }).getServerFirestore());

  // Real SDK construction with a generated test key; no reads, writes, or token requests.
  const adminApp = require("firebase-admin/app");
  const adminFirestore = require("firebase-admin/firestore");
  const privateKey = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
    .export({ type: "pkcs8", format: "pem" });
  const realInit = load("server/firestore.ts", {
    "node:fs": fs, "firebase-admin/app": adminApp, "firebase-admin/firestore": adminFirestore
  }, { process: { env: { FIREBASE_PROJECT_ID: "test-only",
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ ...credential, private_key: privateKey }) } } });
  const initialized = realInit.getServerFirestore();
  assert.equal(initialized.projectId, "test-only");
  assert.equal(realInit.getServerFirestore(), initialized);
  await initialized.terminate();
  await adminApp.deleteApp(adminApp.getApp("studentkeyword-server"));

  // Hosting/Cloud Run production cookie and Origin behavior are fail-closed.
  const productionAuth = load("server/teacher-auth.ts", {}, { process: { env: {
    NODE_ENV: "production", TEACHER_AUTH_SECRET: "x".repeat(32), TEACHER_ALLOWED_ORIGINS: "https://test-only.web.app"
  } } });
  const cookieRes = { headers: {}, cookie(name, value, options) { this.name = name; this.value = value; this.options = options; },
    clearCookie(name, options) { this.cleared = name; this.clearOptions = options; }, setHeader(k, v) { this.headers[k] = v; } };
  productionAuth.issueTeacherCookie(cookieRes, "a", 1);
  assert.equal(cookieRes.name, "__session");
  assert.equal(cookieRes.options.httpOnly, true); assert.equal(cookieRes.options.secure, true);
  assert.equal(cookieRes.options.sameSite, "lax"); assert.equal(cookieRes.options.path, "/");
  assert.equal(productionAuth.readTeacherSession({ headers: { cookie: cookieRes.name + "=" + cookieRes.value } }).classCode, "a");
  productionAuth.clearTeacherCookie(cookieRes);
  assert.equal(cookieRes.cleared, "__session");
  function originResult(module, origin) {
    let statusCode, nextCalled = false;
    module.requireTeacherOrigin({ get: key => key === "origin" ? origin : undefined }, {
      status(code) { statusCode = code; return this; }, json() {}
    }, () => { nextCalled = true; });
    return { statusCode, nextCalled };
  }
  assert.equal(originResult(productionAuth, "https://test-only.web.app").nextCalled, true);
  assert.equal(originResult(productionAuth, "https://other.invalid").statusCode, 403);
  const renderOnlyAuth = load("server/teacher-auth.ts", {}, { process: { env: {
    NODE_ENV: "production", TEACHER_AUTH_SECRET: "x".repeat(32), RENDER_EXTERNAL_URL: "https://render.invalid"
  } } });
  assert.equal(originResult(renderOnlyAuth, "https://render.invalid").statusCode, 403);

  records.set("classes/a", { password: "old", createdAt: "original" });
  records.set("classes/b", { passwordHash: await password.createPasswordHash("hashed"), authVersion: 2, createdAt: "original" });
  let r = await call("post", "/api/classes/auth", { body: { classCode: "a", password: " old " } });
  assert.equal(r.statusCode, 200); assert.equal(writes, 0);
  const cookieA = r.cookieValue;
  r = await call("post", "/api/classes/auth", { body: { classCode: "b", password: "hashed" } });
  assert.equal(r.statusCode, 200); assert.equal(writes, 0);
  r = await call("post", "/api/classes/auth", { body: { classCode: "new", password: "new" } });
  assert.equal(r.data.isNew, true); assert.equal("password" in records.get("classes/new"), false);
  r = await call("post", "/api/classes/update-password", { token: cookieA, body: { classCode: "b", oldPassword: "old", newPassword: "changed" } });
  assert.equal(r.statusCode, 200); assert.equal(records.get("classes/a").createdAt, "original");
  assert.equal("password" in records.get("classes/a"), false); assert.equal(records.get("classes/a").authVersion, 1);
  const currentCookie = r.cookieValue;
  assert.equal((await call("get", "/api/classes/session", { token: cookieA })).statusCode, 401);

  for (const invalid of [
    { classCode: undefined }, { classCode: "" }, { classCode: "../bad" }, { classCode: "x".repeat(101) },
    { grade: 3 }, { classNumber: "0" }, { studentNumber: "-1" }, { name: "" }, { name: "x".repeat(51) },
    { keywords: ["가"] }, { keywords: ["가", "나", "다", "라", 5] }, { keywords: "12345" },
    { timestamp: "injected" }, { aiFeedback: "injected" }, { reportCardDraft: "injected" }, { arbitrary: "field" }
  ]) {
    r = await call("post", "/api/submissions", { body: { ...student, ...invalid } });
    assert.equal(r.statusCode, 400);
  }
  assert.equal((await call("post", "/api/submissions", { body: { ...student, classCode: "missing" } })).statusCode, 404);
  const names = ["홍길동", "[", "]", "김(민수)", "A+B", "test.*", "역\\슬래시", "^$${}|?+*().[]\\", "$&"];
  for (const name of names) {
    const pattern = new RegExp("^" + server.escapeRegExp(name) + "$");
    assert.equal(pattern.test(name), true);
    assert.equal(pattern.test("prefix" + name), false);
    assert.doesNotThrow(() => server.postProcessFeedback(name + " 친구, 응원해요!", name));
    const named = await call("post", "/api/submissions", { body: { ...student, name } });
    assert.equal(named.statusCode, 200);
    assert.equal(named.data.submission.name, name);
  }
  const writesBeforeError = writes;
  failGeneration = true;
  const unexpected = await call("post", "/api/submissions", { body: student });
  assert.equal(unexpected.statusCode, 503);
  assert.equal(unexpected.data.success, false);
  assert.equal(writes, writesBeforeError);
  failGeneration = false;
  r = await call("post", "/api/submissions", { body: student });
  assert.equal(r.statusCode, 200);
  const id = r.data.submission.id;
  assert.match(id, /^[a-f0-9-]{36}$/);
  const saved = copy(records.get("submissions/" + id));
  assert.deepEqual(Object.keys(saved).sort(), ["grade","classNumber","studentNumber","name","keywords","timestamp","aiFeedback","reportCardDraft","classCode"].sort());
  nextId = id;
  r = await call("post", "/api/submissions", { body: student }); assert.equal(r.statusCode, 503);
  assert.deepEqual(records.get("submissions/" + id), saved); nextId = undefined;
  r = await call("post", "/api/submissions", { body: student }); assert.notEqual(r.data.submission.id, id);
  writeFailure = true;
  const beforeWrites = writes;
  assert.equal((await call("post", "/api/submissions", { body: student })).statusCode, 503);
  assert.equal(writes, beforeWrites); writeFailure = false;
  broken = true;
  assert.equal((await call("post", "/api/submissions", { body: student })).statusCode, 503);
  broken = false;

  records.set("submissions/b1", { ...saved, classCode: "b" });
  const legacy = { ...saved }; delete legacy.classCode;
  records.set("submissions/legacy", legacy);
  const protectedRoutes = [["get", "/api/submissions"], ["delete", "/api/submissions/:id"],
    ["post", "/api/submissions/reset"], ["post", "/api/submissions/:id/regenerate-ai"]];
  for (const token of ["", "teacher_session=forged", "teacher_session=" + auth.signTeacherSession("a", 1, Date.now()-9*3600000)]) {
    for (const [method, route] of protectedRoutes) assert.equal((await call(method, route, { token, id })).statusCode, 401);
  }
  r = await call("get", "/api/submissions", { token: currentCookie });
  assert.ok(r.data.every(s => s.classCode === "a"));
  assert.equal((await call("get", "/api/submissions", { token: currentCookie, query: { classCode: "b" } })).statusCode, 403);
  for (const deniedId of ["b1", "legacy"]) {
    assert.equal((await call("delete", "/api/submissions/:id", { token: currentCookie, id: deniedId })).statusCode, 404);
    assert.equal((await call("post", "/api/submissions/:id/regenerate-ai", { token: currentCookie, id: deniedId, body: { apiKey: "mock" } })).statusCode, 404);
  }
  assert.equal(aiCalls, 0);
  assert.equal((await call("post", "/api/submissions/:id/regenerate-ai", { token: currentCookie, id, body: { apiKey: "mock" } })).statusCode, 200);
  assert.equal(aiCalls, 1);
  beforeTransaction = () => { records.get("submissions/" + id).classCode = "b"; };
  assert.equal((await call("delete", "/api/submissions/:id", { token: currentCookie, id })).statusCode, 404);
  records.get("submissions/" + id).classCode = "a";
  assert.equal((await call("delete", "/api/submissions/:id", { token: currentCookie, id })).statusCode, 200);
  assert.equal((await call("post", "/api/submissions/reset", { token: currentCookie, body: { classCode: "b" } })).statusCode, 403);
  assert.equal((await call("post", "/api/submissions/reset", { token: currentCookie })).statusCode, 200);
  assert.ok(records.has("submissions/b1")); assert.ok(records.has("submissions/legacy"));
  const beforeReads = reads;
  for (const method of ["get", "post"]) assert.equal((await call(method, "/api/config")).statusCode, 410);
  assert.equal(reads, beforeReads);
  assert.ok(!/firebase\/firestore|from "pg"|writeFileSync|Date\.now\(\)\.toString|getConfigAsync/.test(source("server.ts")));
  assert.ok(source("server.ts").includes('app.use("/api", (_req, res, next) =>'));
  assert.equal(server.resolvePort("43123"), 43123);
  assert.equal(server.resolvePort(undefined), 3000);
  assert.equal(server.resolvePort("0"), 3000);
  assert.equal(server.resolvePort("invalid"), 3000);

  // Run the actual student handlers with UI setters mocked.
  const ui = source("src/components/StudentSurvey.tsx");
  let step = "", message = "", succeeded = 0, response;
  const front = { ...student, selectedKeywords: student.keywords.map(text => ({ text })),
    validationChecks: { isPerfect: true }, fetch: async () => { if (response instanceof Error) throw response; return response; },
    setInfoError: s => { message = s; }, setStep: s => { step = s; }, setSubmitting() {},
    setSubmittedData() {}, onSurveySubmitted() { succeeded++; }, alert: s => { message = s; },
    console: { error() {} } };
  const info = ui.slice(ui.indexOf("const handleInfoSubmit"), ui.indexOf("// Check which domain"));
  const submit = ui.slice(ui.indexOf("const handleSubmitSurvey"), ui.indexOf("// Clipboard copy"));
  vm.createContext(front);
  vm.runInContext(ts.transpileModule(info + submit + "\nglobalThis.info = handleInfoSubmit; globalThis.submit = handleSubmitSurvey;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText, front);
  for (const result of [new Error("network"), { ok: false }, { ok: true, json: async () => ({ exists: false }) }]) {
    step = ""; response = result; await front.info({ preventDefault() {} }); assert.equal(step, ""); assert.ok(message);
  }
  response = { ok: true, json: async () => ({ exists: true }) }; await front.info({ preventDefault() {} }); assert.equal(step, "keywords");
  for (const result of [new Error("network"), { ok: false, json: async () => ({ message: "failed" }) }, { ok: true, json: async () => ({ success: false }) }]) {
    step = ""; response = result; await front.submit(); assert.equal(step, ""); assert.equal(succeeded, 0);
  }
  response = { ok: true, json: async () => ({ success: true, submission: saved }) };
  await front.submit(); assert.equal(step, "success"); assert.equal(succeeded, 1);
  console.log("PASS: initialization/fail-closed including Cloud Run ADC branch, Hosting session/origin behavior, legacy/hash/new-class auth, session version, validation/injection, UUID/create collision, no fallback, teacher permissions, config closure, API no-store policy, PORT resolution, student UI failure/success flows, regex-special names and safe processing-error response.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
