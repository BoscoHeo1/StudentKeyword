'use strict';

const { createServer } = require('node:http');
const path = require('node:path');

const DESTINATION = 'https://mykeyword-a832f.web.app/';

function transitionHandler(req, res) {
  const method = (req.method || '').toUpperCase();
  let requestPath;
  let originalPath;
  try {
    const rawPath = (req.url || '/').split('?')[0].split('#')[0];
    if (!rawPath.startsWith('/')) throw new Error('Invalid request target');
    originalPath = decodeURIComponent(rawPath).replace(/\\/g, '/').replace(/\/{2,}/g, '/').toLowerCase();
    requestPath = path.posix.normalize(originalPath)
      .replace(/\/{2,}/g, '/')
      .toLowerCase();
  } catch {
    requestPath = '/api';
    originalPath = '/api';
  }

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const isApi = [originalPath, requestPath].some(candidate =>
    candidate === '/api' || candidate.startsWith('/api/')
  );
  if (!isApi && (method === 'GET' || method === 'HEAD')) {
    res.writeHead(302, { Location: DESTINATION });
    res.end();
    return;
  }

  res.writeHead(410, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(method === 'HEAD' ? undefined : JSON.stringify({ error: 'gone', url: DESTINATION }));
}

if (require.main === module) {
  const port = Number(process.env.PORT || 10000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  createServer(transitionHandler).listen(port, '0.0.0.0');
}

module.exports = { transitionHandler };
