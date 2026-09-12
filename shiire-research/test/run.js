import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import two from '../lib/sites/2ndstreet.js';
import brandear from '../lib/sites/brandear.js';
import trefac from '../lib/sites/trefac.js';
import okoku from '../lib/sites/okoku.js';
import offmall from '../lib/sites/offmall.js';
import { sizeRank, matchesCategory, looksLikeBrand, parsePrice } from '../lib/normalize.js';

const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const fx = (n) => readFileSync(fileURLToPath(new URL(`./fixtures/${n}.html`, import.meta.url)), 'utf8');

let pass = 0;
function ok(label, fn) {
  try { fn(); pass++; console.log('  ✓', label); }
  catch (e) { console.error('  ✗', label, '\n   ', e.message); process.exitCode = 1; }
}

console.log('\n[ パーサー ]');
const a = two.parse(fx('2ndstreet'));
ok('セカスト: 2件取得', () => assert.equal(a.length, 2));
ok('セカスト: 価格', () => assert.equal(a[0].price, 6490));
ok('セカスト: サイズ', () => assert.equal(a[0].size, '42'));
ok('セカスト: 状態', () => assert.equal(a[0].condition, '中古B'));
ok('セカスト: URL絶対化', () => assert.ok(a[0].url.startsWith('https://www.2ndstreet.jp/goods/detail/')));
ok('セカスト: 画像を大きいものに差し替え', () => assert.ok(a[0].image.includes('/img/sp/')));

const b = brandear.parse(fx('brandear'));
ok('ブランディア: 2件取得', () => assert.equal(b.length, 2));
ok('ブランディア: 価格', () => assert.equal(b[0].price, 2488));
ok('ブランディア: 状態推定', () => assert.equal(b[0].condition, '美品'));
ok('ブランディア: サイズ抽出', () => assert.equal(b[1].size, 'XL'));
ok('ブランディア: URL', () => assert.ok(b[0].url.includes('/search/detail/AuctionID/19427119')));

const t = trefac.parse(fx('trefac'));
ok('トレファク: 2件取得', () => assert.equal(t.length, 2));
ok('トレファク: 価格', () => assert.equal(t[0].price, 3300));
ok('トレファク: 商品名', () => assert.equal(t[0].name, 'ANTEPRIMA ショルダーバッグ'));
ok('トレファク: サイズ', () => assert.equal(t[1].size, 'L'));
ok('トレファク: 画像を大きいものに差し替え', () => assert.ok(t[0].image.includes('/w360/')));
ok('トレファク: 状態推定', () => assert.equal(t[1].condition, '未使用'));

const k = okoku.parse(fx('okoku'));
ok('買取王国: 3件取得', () => assert.equal(k.length, 3));
ok('買取王国: 価格', () => assert.ok(k.some((x) => x.price === 15500)));
ok('買取王国: NEWが先頭', () => assert.equal(k[0].isNew, true));
ok('買取王国: URLからクエリを除去', () => assert.ok(k.every((x) => x.url.indexOf('?') < 0)));
ok('買取王国: 画像をhttpsに', () => assert.ok(k[0].image.startsWith('https://okoku.jp/')));
ok('買取王国: 画像サイズを縮小', () => assert.ok(k[0].image.includes('width=500')));
ok('買取王国: 商品名末尾のサイズを取得', () => {
  const jacket = k.find((x) => x.name.indexOf('ジャケット') === 0);
  assert.equal(jacket.size, 'M');
});
ok('買取王国: (L) L 表記のサイズ', () => {
  const tee = k.find((x) => x.name.indexOf('半袖') === 0);
  assert.equal(tee.size, 'L');
});
ok('買取王国: サイズでない語はサイズにしない', () => {
  const coin = k.find((x) => x.name.indexOf('コインケース') === 0);
  assert.equal(coin.size, '');
});
ok('買取王国: 別ブランドのコラボも本文で拾える', () =>
  assert.ok(looksLikeBrand(k.find((x) => x.brand === 'PORTER'), ['WACKO MARIA'])));

console.log('\n[ オフモール ]');
const o = offmall.parse(fx('offmall'));
ok('オフモール: 2件取得', () => assert.equal(o.length, 2));
ok('オフモール: 価格', () => assert.equal(o[0].price, 22000));
ok('オフモール: 状態ランク', () => assert.equal(o[0].condition, 'Bランク(中古)'));
ok('オフモール: 状態ランクA', () => assert.equal(o[1].condition, 'Aランク(美品)'));
ok('オフモール: 商品URL', () => assert.ok(o[0].url.includes('/product/6508419')));
ok('オフモール: 画像を大きく', () => assert.ok(o[0].image.includes('w=480,h=480')));
ok('オフモール: ブランド名', () => assert.equal(o[0].brand, 'WACKO MARIA'));
ok('オフモール: 検索URL（人が見る用）', () =>
  assert.ok(offmall.searchPageUrl('AURALEE').startsWith('https://netmall.hardoff.co.jp/search/?q=')));

// ブランドIDの自動判定
const brandListHtml = fx('offmall-brandlist');
const fakeCtx = { fetchHtml: async (url) => (url.includes('/brandlist/') ? brandListHtml : fx('offmall')) };
await (async () => {
  const r1 = await offmall.collect({ id: 'wm', label: 'ワコマリア', keywords: ['WACKO MARIA', 'ワコマリア'] }, fakeCtx);
  ok('オフモール: ブランドIDを自動で見つける', () => assert.equal(r1.pageUrl, 'https://netmall.hardoff.co.jp/brand/2700/?s=1'));
  const r2 = await offmall.collect({ id: 'im', label: 'イッセイミヤケ', keywords: ['ISSEY MIYAKE', 'イッセイミヤケ'] }, fakeCtx);
  ok('オフモール: 日本語表記でも一致', () => assert.ok(r2.pageUrl.includes('/brand/2921/')));
  const r3 = await offmall.collect({ id: 'x', label: 'ないブランド', keywords: ['ZZZZ_NOT_EXIST'] }, fakeCtx);
  ok('オフモール: 未登録ブランドは案内を返す', () => assert.ok(r3.note && r3.items.length === 0));
  const r4 = await offmall.collect({ id: 'y', label: '手動ID', keywords: ['X'], offmallBrandId: '9999' }, fakeCtx);
  ok('オフモール: IDを直接指定できる', () => assert.ok(r4.pageUrl.includes('/brand/9999/')));
})();

console.log('\n[ 価格・サイズ・カテゴリー ]');
ok('価格: ￥1,234', () => assert.equal(parsePrice('￥1,234 税込'), 1234));
ok('価格: 12,100円', () => assert.equal(parsePrice('12,100 円'), 12100));
const al = config.sizeAliases;
ok('サイズ L < XL', () => assert.ok(sizeRank('L', al) < sizeRank('XL', al)));
ok('サイズ フリーはnull', () => assert.equal(sizeRank('F', al), null));
ok('サイズ 全角ＸＬ', () => assert.equal(sizeRank('ＸＬ', al), sizeRank('XL', al)));
ok('サイズ 「サイズ：M」', () => assert.equal(sizeRank('サイズ：M', al), sizeRank('M', al)));
ok('サイズ 「SIZE L」', () => assert.equal(sizeRank('SIZE L', al), sizeRank('L', al)));
ok('サイズ 「その他」は不明', () => assert.equal(sizeRank('その他', al), null));
ok('サイズ 「サイズ3 L」から拾う', () => assert.equal(sizeRank('3', al), sizeRank('L', al)));
ok('サイズ 「SIZE1」', () => assert.equal(sizeRank('SIZE1', al), sizeRank('S', al)));
ok('サイズ 「サイズ：SIZE L」', () => assert.equal(sizeRank('サイズ：SIZE L', al), sizeRank('L', al)));

const bagCat = config.categories.bag;
ok('カテゴリー: トートバッグ○', () => assert.ok(matchesCategory({ name: 'ワイヤーバッグ/トートバッグ/ゴールド' }, bagCat)));
ok('カテゴリー: ニット×', () => assert.ok(!matchesCategory({ name: 'ニット・セーター(薄手)/42' }, bagCat)));
ok('カテゴリー: コインケース×', () => assert.ok(!matchesCategory({ name: 'コインケース' }, bagCat)));

console.log('\n[ ブランド表記ゆれ ]');
const kw = ['WACKO MARIA', 'ワコマリア'];
ok('WACKOMARIA（スペースなし）', () => assert.ok(looksLikeBrand({ name: 'WACKOMARIA アロハ' }, kw)));
ok('ワコマリア（日本語）', () => assert.ok(looksLikeBrand({ brand: 'ワコマリア' }, kw)));
ok('wacko maria（小文字）', () => assert.ok(looksLikeBrand({ name: 'wacko maria shirt' }, kw)));
ok('別ブランドは除外', () => assert.ok(!looksLikeBrand({ name: 'ISSEY MIYAKE シャツ' }, kw)));
ok('ISSEY MIYAKE 全角', () => assert.ok(looksLikeBrand({ name: 'ＩＳＳＥＹ ＭＩＹＡＫＥ' }, ['ISSEY MIYAKE'])));

console.log(`\n${pass} 件のテストに合格\n`);
