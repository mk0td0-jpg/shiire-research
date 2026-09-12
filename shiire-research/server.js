// ローカル/一般サーバー用。`npm start` で起動します。
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getConfigPayload, getProducts } from './lib/handler.js';

const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function json(res, status, data, cache) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': cache || 'no-store',
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/config') {
      return json(res, 200, await getConfigPayload(), 's-maxage=300');
    }
    if (url.pathname === '/api/products') {
      const refresh = url.searchParams.get('refresh') === '1';
      const data = await getProducts({
        brandId: url.searchParams.get('brand'),
        siteId: url.searchParams.get('site'),
        spec: url.searchParams.get('spec'),
        refresh,
      });
      return json(res, 200, data, refresh ? 'no-store' : 's-maxage=1500, stale-while-revalidate=3600');
    }

    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) {
      const fallback = await readFile(path.join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'] });
      return res.end(fallback);
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch (err) {
    json(res, err.status || 500, { error: err.message || 'error' });
  }
});

server.listen(PORT, () => {
  console.log(`仕入れリサーチ: http://localhost:${PORT}`);
});
