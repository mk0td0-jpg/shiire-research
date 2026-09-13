import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const B = process.env.BASE || 'http://localhost:3100';
const fx = (n) => readFileSync(fileURLToPath(new URL('./fixtures/' + n + '.html', import.meta.url)), 'utf8');
const bookmarklet = readFileSync(fileURLToPath(new URL('../tools/bookmarklet.min.txt', import.meta.url)), 'utf8')
  .trim().replace(/^javascript:/, '');
const scrapeSrc = readFileSync(fileURLToPath(new URL('../extension/scrape.js', import.meta.url)), 'utf8');

const R = []; const ok = (l, c) => R.push((c ? '✓' : '✗') + ' ' + l);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
const errs = [];

// 偽のセカスト／ブランディアを立てて、ブックマークレットを実行する
await ctx.route('https://www.2ndstreet.jp/**', (r) =>
  r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fx('2ndstreet') }));
await ctx.route('https://auction.brandear.jp/**', (r) =>
  r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fx('brandear') }));

const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

async function runBookmarklet(url) {
  await page.goto(url);
  return page.evaluate((code) => {
    let opened = null;
    const orig = window.open;
    window.open = (u) => { opened = u; return { closed: false }; };
    const alerts = [];
    const origAlert = window.alert;
    window.alert = (m) => alerts.push(m);
    try { eval(code); } finally { window.open = orig; window.alert = origAlert; }
    return { opened, alerts };
  }, bookmarklet);
}

function decode(u) {
  const m = /#import=(.+)$/.exec(u);
  if (!m) return null;
  let b = m[1].replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return JSON.parse(Buffer.from(b, 'base64').toString('utf8'));
}

// --- ブックマークレット：セカスト ---
const r1 = await runBookmarklet('https://www.2ndstreet.jp/search?keyword=ANTEPRIMA&sortBy=arrival');
ok('セカスト: 取り込みURLを開く', !!r1.opened && r1.opened.startsWith('https://shiire-research.vercel.app/#import='));
const d1 = decode(r1.opened || '');
ok('セカスト: サイト判定', d1 && d1.s === '2ndstreet');
ok('セカスト: 検索ワード', d1 && d1.k === 'ANTEPRIMA');
ok('セカスト: 2件読み取り', d1 && d1.i.length === 2);
const it = d1 && d1.i[0];
ok('セカスト: 商品名', it && it[4].includes('ニット'));
ok('セカスト: 価格', it && it[7] === 6490);
ok('セカスト: サイズ', it && it[5] === '42');
ok('セカスト: 状態', it && it[6] === '中古B');
ok('セカスト: 商品URL', it && String(it[1]).startsWith('https://www.2ndstreet.jp/goods/detail/'));
ok('セカスト: 画像URL', it && String(it[2]).includes('/img/sp/'));

// --- ブックマークレット：ブランディア ---
const r2 = await runBookmarklet('https://auction.brandear.jp/search/list/?SearchFullText=WACKO%20MARIA&ItemOrder=8');
const d2 = decode(r2.opened || '');
ok('ブランディア: サイト判定', d2 && d2.s === 'brandear');
ok('ブランディア: 検索ワード', d2 && d2.k === 'WACKO MARIA');
ok('ブランディア: 2件読み取り', d2 && d2.i.length === 2);
const b2 = d2 && d2.i[1];
ok('ブランディア: 価格', b2 && b2[7] === 18700);
ok('ブランディア: サイズ', b2 && b2[5] === 'XL');
ok('ブランディア: 状態', b2 && b2[6] === '美品');

// --- 対象外ページでは何もしない ---
await ctx.route('https://example.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>x</body></html>' }));
const r3 = await runBookmarklet('https://example.com/');
ok('対象外ページでは案内を出すだけ', !r3.opened && r3.alerts.length === 1);

// --- 拡張機能の読み取りコード（scrape.js）も同じ結果になるか ---
await page.goto('https://www.2ndstreet.jp/search?keyword=ANTEPRIMA');
const s1 = await page.evaluate((src) => {
  // eslint-disable-next-line no-eval
  eval(src);
  return window.ShiireScrape.collect(document, location);
}, scrapeSrc);
ok('拡張機能の読み取り: 2件', s1 && s1.items.length === 2);
ok('拡張機能の読み取り: 価格一致', s1 && s1.items[0].price === 6490);
ok('拡張機能の読み取り: サイト/検索語', s1 && s1.siteId === '2ndstreet' && s1.keyword === 'ANTEPRIMA');

// --- 自作サイト側：#import= を受け取って一覧に混ぜる ---
const app = await ctx.newPage();
app.on('pageerror', (e) => errs.push('APP PAGEERROR: ' + e.message));
const hash1 = (r1.opened || '').split('#')[1];
await app.goto(B + '/#' + hash1, { waitUntil: 'networkidle' });
await app.waitForSelector('.card', { timeout: 15000 });
await app.waitForTimeout(1500);

ok('URLのimportが消えている', !(await app.evaluate(() => location.hash)));
const stats1 = await app.$$eval('.stat', (e) => e.map((x) => x.textContent.replace(/\s+/g, '')));
ok('取り込み表示📥 (' + stats1.join('/') + ')', stats1.some((s) => s.includes('📥') && s.includes('セカスト')));

const imported = await app.$$eval('.card', (cards) => cards
  .filter((c) => (c.querySelector('.badge') || {}).textContent === 'セカスト')
  .map((c) => ({ name: c.querySelector('.card__name').textContent, price: c.querySelector('.card__price').textContent })));
ok('アンテプリマ(バッグのみ)で1件だけ混ざる', imported.length === 1 && imported[0].name.includes('トートバッグ'));
ok('取り込み商品の価格', imported.length === 1 && imported[0].price.includes('12,100'));

// リンクをクリックすると元の商品ページへ
const href = await app.$eval('.card .badge', (b) => b.closest('.card').querySelector('.card__link').href);
ok('取り込み商品のリンクが元サイト', href.startsWith('https://www.2ndstreet.jp/goods/detail/'));

// --- リロードしても残る ---
await app.reload({ waitUntil: 'networkidle' });
await app.waitForSelector('.card');
await app.waitForTimeout(1200);
const stats2 = await app.$$eval('.stat', (e) => e.map((x) => x.textContent.replace(/\s+/g, '')));
ok('リロード後も取り込みが残る', stats2.some((s) => s.includes('📥')));

// --- ブランドを切り替えると、そのブランドのものだけ ---
const hash2 = (r2.opened || '').split('#')[1];
await app.goto(B + '/#' + hash2, { waitUntil: 'networkidle' });
await app.waitForSelector('.card');
await app.waitForTimeout(1200);
await app.click('.brandBtn[data-brand="wackomaria"]');
await app.waitForTimeout(2500);
const wmStats = await app.$$eval('.stat', (e) => e.map((x) => x.textContent.replace(/\s+/g, '')));
ok('ワコマリアでブランディアが📥 (' + wmStats.join('/') + ')', wmStats.some((s) => s.includes('📥') && s.includes('ブランディア')));
const wmCards = await app.$$eval('.card', (cards) => cards
  .filter((c) => (c.querySelector('.badge') || {}).textContent === 'ブランディア')
  .map((c) => c.querySelector('.card__name').textContent));
ok('L以上の条件が効いている(XLの1件)', wmCards.length === 1);
await app.click('.brandBtn[data-brand="anteprima"]');
await app.waitForTimeout(2500);
const apBrandear = await app.$$eval('.card .badge', (e) => e.map((x) => x.textContent).filter((t) => t === 'ブランディア'));
ok('別ブランドには混ざらない', apBrandear.length === 0);

// --- 設定ページ ---
const help = await ctx.newPage();
await help.goto(B + '/import.html', { waitUntil: 'networkidle' });
ok('取り込み設定ページが開く', (await help.title()).includes('取り込み'));
ok('ブックマークレットのコードが載っている', (await help.inputValue('#code')).startsWith('javascript:'));

console.log(R.join('\n'));
console.log('\nJSエラー:', errs.length ? errs.join('\n') : 'なし');
console.log('失敗:', R.filter((r) => r.startsWith('✗')).length, '/ 合計', R.length);
await browser.close();
