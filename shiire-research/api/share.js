import { readShared, writeShared, shareEnabled, storeKind } from '../lib/share.js';

function send(res, status, data) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.status(status).end(JSON.stringify(data));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 2 * 1024 * 1024) throw Object.assign(new Error('送られてきた内容が大きすぎます'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const code = url.searchParams.get('code');

  try {
    if (req.method === 'GET' && !code) {
      return send(res, 200, { enabled: shareEnabled(), store: storeKind() });
    }
    if (req.method === 'GET') {
      return send(res, 200, await readShared(code));
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      return send(res, 200, await writeShared(code, body && body.imported));
    }
    return send(res, 405, { error: '使えない方法です' });
  } catch (err) {
    return send(res, err.status || 500, { error: err.message || 'error' });
  }
}
