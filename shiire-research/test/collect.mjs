// 一括取り込みボタン（セカスト・ブランディア）のテスト
// 本物と同じホスト名を手元のサーバーに向けて、拡張機能が裏でタブを開くところまで確かめる。
import { chromium } from 'playwright';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';

const B = process.env.BASE || 'http://localhost:3100';
const extPath = fileURLToPath(new URL('../extension', import.meta.url));
const fx = (n) => readFileSync(fileURLToPath(new URL('./fixtures/' + n + '.html', import.meta.url)), 'utf8');
const R = []; const ok = (l, c) => R.push((c ? '✓' : '✗') + ' ' + l);

// --- 手元のHTTPSサーバー（セカスト・ブランディア・アプリの3役） ---
const KEY = path.join(tmpdir(), 'shiire-test.key');
const CRT = path.join(tmpdir(), 'shiire-test.crt');
if (!existsSync(KEY) || !existsSync(CRT)) {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', KEY, '-out', CRT, '-days', '2', '-subj', '/CN=test',
    '-addext', 'subjectAltName=DNS:www.2ndstreet.jp,DNS:auction.brandear.jp,DNS:shiire-research.vercel.app'],
    { stdio: 'ignore' });
}

const opened = [];
const server = https.createServer({ key: readFileSync(KEY), cert: readFileSync(CRT) }, async (req, res) => {
  const host = String(req.headers.host || '').split(':')[0];
  if (host === 'www.2ndstreet.jp' || host === 'auction.brandear.jp') {
    if (/^\/search/.test(req.url)) opened.push(host + req.url);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fx(host === 'www.2ndstreet.jp' ? '2ndstreet' : 'brandear'));
    return;
  }
  const upstream = await fetch(B + req.url).catch(() => null);
  if (!upstream) { res.writeHead(502); res.end(''); return; }
  res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'text/html' });
  res.end(Buffer.from(await upstream.arrayBuffer()));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const MAP = ['www.2ndstreet.jp', 'auction.brandear.jp', 'shiire-research.vercel.app']
  .map((h) => 'MAP ' + h + ':443 127.0.0.1:' + PORT).join(', ');

const userDataDir = mkdtempSync(path.join(tmpdir(), 'pw-collect-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  executablePath: '/opt/pw-browsers/chromium',
  headless: true,
  ignoreHTTPSErrors: true,
  args: [
    '--disable-extensions-except=' + extPath,
    '--load-extension=' + extPath,
    '--host-resolver-rules=' + MAP,
    '--ignore-certificate-errors',
    '--no-proxy-server',
  ],
  viewport: { width: 390, height: 844 },
});

const app = await ctx.newPage();
const errs = [];
app.on('pageerror', (e) => { if (!/ServiceWorker/.test(e.message)) errs.push('PAGEERROR: ' + e.message); });
await app.goto('https://shiire-research.vercel.app/');
await app.waitForSelector('.card', { timeout: 25000 });
await app.waitForTimeout(2500);

// --- ボタンの見た目 ---
const label0 = (await app.textContent('#collectBtn')).trim();
ok('一括取り込みボタンが出る (' + label0 + ')', /セカスト/.test(label0) && /ブランディア/.test(label0));
ok('残り件数が出る', /（\d+件）/.test(label0));
const note = await app.textContent('.collect__note');
ok('拡張機能ありの案内になる', /裏で1ページずつ/.test(note));

// --- 押すと順番に取り込む ---
await app.click('#collectBtn');
await app.waitForTimeout(1500);
const running = (await app.textContent('#collectBtn')).trim();
ok('押すと「取り込み中 n/10」になる (' + running + ')', /取り込み中\s*\d+\/10/.test(running));
const rows = await app.$$eval('.collect__item', (e) => e.length);
ok('取り込む一覧が出る (' + rows + '件)', rows >= 4);

await app.waitForFunction(
  () => !/取り込み中/.test(document.querySelector('#collectBtn').textContent),
  null, { timeout: 180000 }
);
await app.waitForTimeout(1500);

ok('検索ページを10ページぶん開いた (' + opened.length + 'ページ)', opened.length === 10);
ok('セカストとブランディアの両方を開いた',
  opened.some((u) => u.startsWith('www.2ndstreet.jp')) && opened.some((u) => u.startsWith('auction.brandear.jp')));

// --- サイトへの配慮：同時ではなく1つずつ ---
const maxOpen = await app.evaluate(() => document.querySelectorAll('.collect__item.is-now').length);
ok('同時に複数ページを開かない', maxOpen === 0);

const stats = await app.$$eval('.stat', (e) => e.map((x) => x.textContent.replace(/\s+/g, '')));
ok('取り込み結果が一覧に反映される (' + stats.join('/') + ')', stats.some((s) => s.includes('📥')));

const store = await app.evaluate(() => JSON.parse(localStorage.getItem('sr.imported') || '{}'));
ok('セカストが保存された', Object.keys(store['2ndstreet'] || {}).length > 0);
ok('ブランディアが保存された', Object.keys(store.brandear || {}).length > 0);

const label1 = (await app.textContent('#collectBtn')).trim();
ok('取り込み済みなら「取り直す」になる (' + label1 + ')', /取り直す/.test(label1));

const left = ctx.pages().filter((p) => /2ndstreet|brandear/.test(p.url()));
ok('取り込みに使ったタブは閉じられる', left.length === 0);

console.log(R.join('\n'));
console.log('\nJSエラー:', errs.length ? errs.join('\n') : 'なし');
console.log('失敗:', R.filter((r) => r.startsWith('✗')).length, '/ 合計', R.length);
await ctx.close();
server.close();
