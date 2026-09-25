'use strict';

const assert = require('node:assert/strict');
const { createServer, request: httpRequest } = require('node:http');
const { after, before, test } = require('node:test');
const { transitionHandler } = require('./transition-server.cjs');

let server;
let origin;

before(async () => {
  server = createServer(transitionHandler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
});

async function request(method, requestPath, body) {
  const response = await fetch(`${origin}${requestPath}`, {
    method,
    body,
    redirect: 'manual'
  });
  return { response, text: await response.text() };
}

test('ordinary GET and HEAD redirect only to the fixed Hosting root', async () => {
  for (const method of ['GET', 'HEAD']) {
    for (const requestPath of ['/', '/old/path?student=private']) {
      const { response, text } = await request(method, requestPath);
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), 'https://mykeyword-a832f.web.app/');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(text, '');
    }
  }
});

test('all API methods return 410 without redirecting', async () => {
  for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const requestPath of ['/api/config', '/api/submissions']) {
      const body = ['POST', 'PUT', 'PATCH'].includes(method) ? 'sensitive-body' : undefined;
      const { response, text } = await request(method, requestPath, body);
      assert.equal(response.status, 410, `${method} ${requestPath}`);
      assert.equal(response.headers.get('location'), null);
      assert.ok(!text.includes('sensitive-body'));
    }
  }
});

test('ordinary state-changing requests return 410', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const body = method === 'DELETE' ? undefined : 'sensitive-body';
    const { response } = await request(method, '/old/path', body);
    assert.equal(response.status, 410, method);
    assert.equal(response.headers.get('location'), null);
  }
});

test('encoded API paths and malformed paths never reach a redirect', async () => {
  for (const requestPath of ['/API/x', '/%61pi/x', '/api%2fx', '/x/../api/x', '/%ZZ']) {
    const { response } = await request('GET', requestPath);
    assert.equal(response.status, 410, requestPath);
  }
  const rawStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(`${origin}/`, { method: 'GET', path: '/api/../x' }, response => {
      response.resume();
      resolve(response.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(rawStatus, 410, '/api/../x');
});
