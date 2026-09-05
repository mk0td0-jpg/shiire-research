import * as cheerio from 'cheerio';
import { parsePrice, cleanSize, guessCondition, absoluteUrl } from '../normalize.js';

const BASE = 'https://auction.brandear.jp';

export default {
  id: 'brandear',
  name: 'ブランディア',
  short: 'ブランディア',
  color: '#c9a227',

  searchPageUrl(keyword) {
    return `${BASE}/search/list/?SearchFullText=${encodeURIComponent(keyword)}&ItemOrder=8`;
  },

  fetchUrl(keyword) {
    return this.searchPageUrl(keyword);
  },

  parse(html) {
    const $ = cheerio.load(html);
    const items = [];
    $('div.item').each((_, el) => {
      const $el = $(el);
      const $a = $el.find('a[href*="/search/detail/"]').first();
      const href = $a.attr('href');
      const url = absoluteUrl(href, BASE);
      if (!url) return;
      const img = $el.find('img').first();
      const image = img.attr('src') || img.attr('data-src') || null;
      const title = $a.attr('auctiontitle') || img.attr('alt') || $a.attr('title') || '';
      const brand = ($el.find('text.titlea').first().text() || '').trim();
      let name = ($el.find('text.titleb').first().text() || '').trim();
      if (!name) name = title;
      const price = parsePrice($el.find('.price2').first().text() || $el.find('.auction_shousai').first().text());
      if (!price) return;
      const sizeMatch = title.match(/サイズ\s*([A-Za-zＡ-Ｚａ-ｚ0-9０-９.\-/]+)/);
      items.push({
        id: $a.attr('auctionid') || url,
        url,
        image: image ? absoluteUrl(image, BASE) : null,
        brand: brand || '',
        name,
        size: sizeMatch ? cleanSize(sizeMatch[1]) : '',
        condition: guessCondition(title, $el.text()),
        price,
        rawTitle: title,
        categoryHint: `${name} ${title}`,
      });
    });
    return items;
  },
};
