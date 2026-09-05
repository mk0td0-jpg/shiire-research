import * as cheerio from 'cheerio';
import { parsePrice, cleanSize, guessCondition, absoluteUrl } from '../normalize.js';

const BASE = 'https://www.trefac.jp';

export default {
  id: 'trefac',
  name: 'トレファクファッション',
  short: 'トレファク',
  color: '#2f7d5c',

  searchPageUrl(keyword) {
    return `${BASE}/store/search_result.html?srchword=${encodeURIComponent(keyword)}&order=new`;
  },

  fetchUrl(keyword) {
    return `${this.searchPageUrl(keyword)}&disp_num=90`;
  },

  parse(html) {
    const $ = cheerio.load(html);
    const items = [];
    $('li.p-itemlist_item').each((_, el) => {
      const $el = $(el);
      const $a = $el.find('a.p-itemlist_btn, a[href*="/store/"]').first();
      const href = $a.attr('href');
      const url = absoluteUrl(href, BASE);
      if (!url || !/\/store\/\d{6,}/.test(url)) return;
      const img = $el.find('img').first();
      let image = img.attr('src') || img.attr('data-src') || img.attr('data-original') || null;
      // 144px のサムネイルより大きい画像に差し替える
      if (image) image = image.replace('/w144/', '/w360/');
      const alt = img.attr('alt') || '';
      const brand = $el.find('.p-itemlist_brand').first().text().trim();
      // alt 例: ANTEPRIMA（アンテプリマ）の古着「ANTEPRIMA ネックレス」｜シルバー
      const m = alt.match(/「([^」]+)」/);
      const name = (m ? m[1] : alt).trim();
      const size = cleanSize($el.find('.p-itemlist_size').first().text());
      const price = parsePrice($el.find('.p-price2_a, [class*="p-price"]').first().text());
      if (!price) return;
      const idMatch = url.match(/\/store\/(\d+)/);
      items.push({
        id: idMatch ? idMatch[1] : url,
        url,
        image: image ? absoluteUrl(image, BASE) : null,
        brand,
        name,
        size,
        condition: guessCondition(alt, $el.text()),
        price,
        rawTitle: alt,
        categoryHint: `${name} ${alt}`,
      });
    });
    return items;
  },
};
