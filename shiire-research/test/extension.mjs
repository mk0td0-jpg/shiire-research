// Chrome拡張を実際に読み込んで、収集→自作サイトへの受け渡しを確認する
import { chromium } from 'playwright';
import { readFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

const B = process.env.BASE || 'http://localhost:3100';
const extPath = fileURLToPath(new URL('../extension', import.meta.url));
const fx = (n) => readFileSync(fileURLToPath(new URL('./fixtures/' + n + '.html', import.meta.url)), 'utf8');
const R = []; const ok = (l, c) => R.push((c ? '✓' : '✗') + ' ' + l);

const userDataDir = mkdtempSync(path.join(tmpdir(), 'pw-ext-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  executablePath: '/opt/pw-browsers/chromium',
  headless: true,
  args: ['--disable-extensions-except=' + extPath, '--load-extension=' + extPath],
  viewport: { width: 390, height: 844 },
});

await ctx.route('https://www.2ndstreet.jp/**', (r) =>
  r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fx('2ndstreet') }));
await ctx.route('https://shiire-research.vercel.app/**', async (r) => {
  const u = new URL(r.request().url());
  const res = await fetch(B + u.pathname + u.search).catch(() => null);
  if (!res) return r.abort();
  const body = Buffer.from(await res.arrayBuffer());
  r.fulfill({ status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'text/html' }, body });
});

const p = await ctx.newPage();
await p.goto('https://www.2ndstreet.jp/search?keyword=ANTEPRIMA');
await p.waitForTimeout(2500);
const toastText = await p.evaluate(() => {
  const els = [...document.querySelectorAll('div')].map((d) => d.textContent || '');
  return els.find((t) => t.includes('取り込みました')) || '';
});
ok('セカストのページで自動取り込み (' + toastText.trim() + ')', /取り込みました/.test(toastText));

const app = await ctx.newPage();
await app.goto('https://shiire-research.vercel.app/');
await app.waitForSelector('.card', { timeout: 20000 });
await app.waitForTimeout(2500);
const stats = await app.$$eval('.stat', (e) => e.map((x) => x.textContent.replace(/\s+/g, '')));
ok('自作サイトに自動で流し込まれる (' + stats.join('/') + ')', stats.some((s) => s.includes('📥') && s.includes('セカスト')));

const names = await app.$$eval('.card', (cards) => cards
  .filter((c) => (c.querySelector('.badge') || {}).textContent === 'セカスト')
  .map((c) => c.querySelector('.card__name').textContent));
ok('ブランド条件（バッグのみ）が効く', names.length === 1 && names[0].includes('トートバッグ'));

console.log(R.join('\n'));
console.log('失敗:', R.filter((r) => r.startsWith('✗')).length, '/ 合計', R.length);
await ctx.close();
