import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';
import { transformSync } from 'esbuild';

// Execute the real Header component and its real event handlers. Only React's
// renderer/hooks, icons, storage and fetch are mocked; no network is possible.
function mount(responses) {
  const calls = [], states = [], refs = [], storage = new Map(), modes = [];
  let stateIndex = 0, refIndex = 0, tree;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: (initial) => {
      const i = stateIndex++;
      if (!(i in states)) states[i] = initial;
      return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }];
    },
    useRef: (initial) => refs[refIndex++] ||= { current: initial },
    useEffect: () => {},
  };
  const sandbox = {
    exports: {}, module: { exports: {} }, console,
    require: (name) => {
      if (name === 'react') return React;
      if (name === 'lucide-react') return { Shield: 'svg', GraduationCap: 'svg', LayoutDashboard: 'svg' };
      throw new Error(`Unexpected component import: ${name}`);
    },
    localStorage: { setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) },
    window: { addEventListener() {}, removeEventListener() {} },
    alert: (message) => { throw new Error(message); },
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      assert(['/api/classes/session', '/api/classes/auth', '/api/classes/create'].includes(url));
      const result = responses[url];
      assert(result, `Unexpected API request: ${url}`);
      const { status, body } = typeof result === 'function' ? await result() : result;
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    },
  };
  const compiled = transformSync(readFileSync(new URL('../src/components/Header.tsx', import.meta.url), 'utf8'), {
    loader: 'tsx', format: 'cjs', jsx: 'transform', target: 'es2022',
  }).code;
  new Script(compiled).runInContext(createContext(sandbox));
  function render() { stateIndex = refIndex = 0; tree = sandbox.module.exports.default({ currentMode: 'student', onChangeMode: (m) => modes.push(m) }); }
  function nodes(value = tree) {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) return value.flatMap((v) => nodes(v));
    return [value, ...nodes(value.props?.children)];
  }
  const byId = (id) => { const node = nodes().find((n) => n.props?.id === id); assert(node, `missing UI: ${id}`); return node; };
  const button = (text) => { const node = nodes().find((n) => n.type === 'button' && n.props.children.flat(Infinity).includes(text)); assert(node, `missing button: ${text}`); return node; };
  async function login() {
    render(); await byId('mode-toggle-button').props.onClick(); render();
    byId('class-code-login-input').props.onChange({ target: { value: 'Test123' } });
    byId('password-input').props.onChange({ target: { value: 'test-only-password' } }); render();
    await byId('password-form').props.onSubmit({ preventDefault() {} }); render();
  }
  return { calls, modes, storage, login, render, byId, button, nodes };
}

const absent = {
  '/api/classes/session': { status: 401, body: {} },
  '/api/classes/auth': { status: 404, body: { code: 'CLASS_NOT_FOUND', classCode: 'test123' } },
  '/api/classes/create': { status: 200, body: { success: true, classCode: 'test123' } },
};

test('CLASS_NOT_FOUND displays confirmation without automatically creating a class', async () => {
  const ui = mount(absent); await ui.login();
  assert(ui.byId('create-class-title').props.children.includes('새 학급으로 생성할까요?'));
  assert.equal(ui.calls.filter((c) => c.url === '/api/classes/create').length, 0);
  assert(!ui.modes.includes('teacher'));
});
test('cancel/code correction returns to login and never calls create', async () => {
  const ui = mount(absent); await ui.login();
  ui.button('코드 수정').props.onClick(); ui.render();
  ui.byId('password-form');
  assert(!ui.nodes().some((n) => n.props?.id === 'create-class-title'));
  assert.equal(ui.calls.filter((c) => c.url === '/api/classes/create').length, 0);
});
test('explicit confirmation calls create once with confirmCreate:true and retained inputs', async () => {
  const ui = mount(absent); await ui.login();
  await ui.button('새 학급 생성').props.onClick(); ui.render();
  const create = ui.calls.filter((c) => c.url === '/api/classes/create');
  assert.equal(create.length, 1);
  assert.equal(create[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(create[0].options.body), { classCode: 'test123', password: 'test-only-password', confirmCreate: true });
  assert(ui.modes.includes('teacher')); assert.equal(ui.storage.get('teacher_class_code'), 'test123');
});
test('existing class login succeeds without confirmation or create request', async () => {
  const ui = mount({ ...absent, '/api/classes/auth': { status: 200, body: { success: true, classCode: 'test123' } } });
  await ui.login(); assert(ui.modes.includes('teacher'));
  assert.equal(ui.calls.filter((c) => c.url === '/api/classes/create').length, 0);
  assert(!ui.nodes().some((n) => n.props?.id === 'create-class-title'));
});
test('bad password stays in login and never offers class creation', async () => {
  const ui = mount({ ...absent, '/api/classes/auth': { status: 401, body: { message: 'incorrect password' } } });
  await ui.login(); ui.byId('password-error');
  assert(!ui.modes.includes('teacher')); assert.equal(ui.calls.filter((c) => c.url === '/api/classes/create').length, 0);
});
test('create conflict returns to existing login without authenticating', async () => {
  const ui = mount({ ...absent, '/api/classes/create': { status: 409, body: { code: 'CLASS_ALREADY_EXISTS', message: 'login again' } } });
  await ui.login(); await ui.button('새 학급 생성').props.onClick(); ui.render();
  ui.byId('password-form'); assert(!ui.modes.includes('teacher'));
});
test('rapid confirmation clicks cannot submit duplicate create requests', async () => {
  let complete;
  const ui = mount({ ...absent, '/api/classes/create': () => new Promise((r) => { complete = r; }) });
  await ui.login(); const confirm = ui.button('새 학급 생성').props.onClick;
  const pending = confirm(); await confirm();
  assert.equal(ui.calls.filter((c) => c.url === '/api/classes/create').length, 1);
  complete({ status: 200, body: { success: true, classCode: 'test123' } }); await pending;
});
