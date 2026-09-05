import * as cheerio from 'cheerio';
import { parsePrice, cleanSize, guessCondition, absoluteUrl } from '../normalize.js';

const BASE = 'https://www.2ndstreet.jp';

export default {
  id: '2ndstreet',
  name: 'セカンドストリート',
  short: 'セカスト',
  color: '#e8622a',

  // 人が見る検索結果ページ（取得に失敗したときのリンク先にも使う）
  searchPageUrl(keyword) {
    return `${BASE}/search?keyword=${encodeURIComponent(keyword)}&sortBy=arrival`;
  },

  fetchUrl(keyword) {
    return this.searchPageUrl(keyword);
  },

  parse(html) {
    const $ = cheerio.load(html);
    const items = [];
    $('li.itemCard, .itemCard').each((_, el) => {
      const $el = $(el);
      const $a = $el.find('a.itemCard_inner, a[href*="/goods/detail/"]').first();
      const href = $a.attr('href');
      const url = absoluteUrl(href, BASE);
      if (!url) return;
      const img = $el.find('img').first();
      let image = img.attr('src') || img.attr('data-src') || img.attr('data-original') || null;
      // 一覧のサムネイル(180px)より少し大きい画像に差し替える
      if (image) image = image.replace('/img/pc/', '/img/sp/');
      const brand = $el.find('.itemCard_brand').first().text().trim();
      const name = $el.find('.itemCard_name').first().text().trim();
      const size = cleanSize($el.find('.itemCard_size').first().text());
      const statusText = $el.find('.itemCard_status').first().text().trim();
      const price = parsePrice($el.find('.itemCard_price').first().text());
      if (!price) return;
      items.push({
        id: $el.attr('goodsid') || url,
        url,
        image: image ? absoluteUrl(image, BASE) : null,
        brand,
        name,
        size,
        condition: statusText.replace(/^商品の状態\s*[:：]\s*/, '').trim(),
        price,
        rawTitle: `${brand} ${name} ${statusText}`,
        categoryHint: name,
      });
    });
    return items;
  },
};
