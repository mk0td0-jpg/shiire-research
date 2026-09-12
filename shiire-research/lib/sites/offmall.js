import * as cheerio from 'cheerio';
import { parsePrice, absoluteUrl, toHalfWidth } from '../normalize.js';

const BASE = 'https://netmall.hardoff.co.jp';

// 状態ランク（商品カードのアイコンの alt から取得）
const RANK_LABEL = {
  s: 'Sランク(未使用に近い)',
  a: 'Aランク(美品)',
  b: 'Bランク(中古)',
  c: 'Cランク(難あり)',
  d: 'Dランク(ジャンク)',
};

// ブランド一覧（公開ページ）は重いので24時間キャッシュする
const INDEX_TTL_MS = 24 * 60 * 60 * 1000;
let brandIndex = null;

function normalizeKey(s) {
  return toHalfWidth(String(s || ''))
    .toUpperCase()
    .replace(/[\s・･‐\-'’.,()（）]/g, '')
    .replace(String.fromCharCode(96), '');
}

async function loadBrandIndex(ctx) {
  if (brandIndex && Date.now() - brandIndex.at < INDEX_TTL_MS) return brandIndex.list;
  const html = await ctx.fetchHtml(BASE + '/brandlist/');
  const $ = cheerio.load(html);
  const list = [];
  const seen = new Set();
  $('a[href*="/brand/"]').each((_, el) => {
    const href = String($(el).attr('href') || '');
    const m = href.match(/\/brand\/(\d+)\/?$/);
    if (!m) return;
    if (seen.has(m[1])) return;
    seen.add(m[1]);
    const text = $(el).text().replace(/\s+/g, ' ').trim().replace(/\(\s*\d+\s*\)\s*$/, '').trim();
    if (!text) return;
    list.push({ id: m[1], text, key: normalizeKey(text) });
  });
  if (list.length) brandIndex = { at: Date.now(), list };
  return list;
}

async function findBrandId(brand, ctx) {
  if (brand.offmallBrandId) return String(brand.offmallBrandId);
  const list = await loadBrandIndex(ctx);
  const keys = (brand.keywords || []).map(normalizeKey).filter((k) => k.length >= 2);
  // 完全一致を優先し、無ければ前方一致・部分一致
  for (const k of keys) {
    const exact = list.find((b) => b.key === k);
    if (exact) return exact.id;
  }
  for (const k of keys) {
    const starts = list.find((b) => b.key.startsWith(k));
    if (starts) return starts.id;
  }
  for (const k of keys) {
    const inc = list.find((b) => b.key.includes(k));
    if (inc) return inc.id;
  }
  return null;
}

export default {
  id: 'offmall',
  name: 'オフモール',
  short: 'オフモール',
  color: '#e2761b',

  // 人が見る検索ページ（robots.txt で自動取得は禁止なので、リンク先としてのみ使う）
  searchPageUrl(keyword) {
    return BASE + '/search/?q=' + encodeURIComponent(keyword);
  },

  fetchUrl(keyword) {
    return this.searchPageUrl(keyword);
  },

  // robots.txt で許可されている「ブランド別一覧」から取得する
  async collect(brand, ctx) {
    const brandId = await findBrandId(brand, ctx);
    if (!brandId) {
      return { items: [], note: 'このブランドはオフモールに登録がありません' };
    }
    const html = await ctx.fetchHtml(BASE + '/brand/' + brandId + '/?s=1');
    return { items: this.parse(html), pageUrl: BASE + '/brand/' + brandId + '/?s=1' };
  },

  parse(html) {
    const $ = cheerio.load(html);
    const items = [];
    $('.itemcolmn_item').each((_, el) => {
      const $el = $(el);
      const $a = $el.find('a[href*="/product/"]').first();
      const url = absoluteUrl(String($a.attr('href') || ''), BASE);
      if (!url) return;

      const $img = $el.find('.item-img-square img').first();
      let image = $img.attr('src') || $img.attr('data-src') || null;
      // 画像CDNのサイズ指定を少し大きくする
      if (image) image = image.replace(/w=\d+,h=\d+/, 'w=480,h=480');

      const brand = $el.find('.item-brand-name').first().text().trim();
      const name = $el.find('.item-name').first().text().trim();
      const code = $el.find('.item-code').first().text().trim();
      const price = parsePrice($el.find('.item-price').first().text());
      if (!price) return;

      const rank = String($el.find('.item-price-icon img').first().attr('alt') || '').toLowerCase();
      const tags = $el
        .find('.item-taglist')
        .text()
        .replace(/\s+/g, ' ')
        .trim();

      const idMatch = url.match(/\/product\/(\d+)/);
      items.push({
        id: idMatch ? idMatch[1] : url,
        url,
        image,
        brand,
        name: [name, code].filter(Boolean).join(' '),
        size: '',
        condition: RANK_LABEL[rank] || (rank ? rank.toUpperCase() + 'ランク' : ''),
        price,
        rawTitle: brand + ' ' + name + ' ' + tags,
        categoryHint: name + ' ' + tags,
      });
    });
    return items;
  },
};
