import * as cheerio from 'cheerio';
import { parsePrice, cleanSize, guessCondition, absoluteUrl } from '../normalize.js';

const BASE = 'https://okoku.jp';

// 商品名の末尾によく付いているサイズ表記（例「… ジャケット M」「… ピンク (L) L」）
const SIZE_TOKEN =
  /^(XXXL|XXXS|XXL|XXS|3XL|2XL|XL|XS|LL|3L|4L|S|M|L|F|FREE|フリー|\d{2})$/i;

export default {
  id: 'okoku',
  name: '買取王国',
  short: '買取王国',
  color: '#2563a8',

  searchPageUrl(keyword) {
    return BASE + '/search?q=' + encodeURIComponent(keyword);
  },

  fetchUrl(keyword) {
    return this.searchPageUrl(keyword);
  },

  parse(html) {
    const $ = cheerio.load(html);
    const items = [];
    let $cards = $('product-item');
    if ($cards.length === 0) $cards = $('.product-item');

    $cards.each((_, el) => {
      const $el = $(el);
      const $a = $el.find('a.product-item-meta__title, a[href*="/products/"]').first();
      const href = String($a.attr('href') || '').split('?')[0];
      const url = absoluteUrl(href, BASE);
      if (!url || url.indexOf('/products/') < 0) return;

      const $img = $el.find('img').first();
      let image = $img.attr('src') || $img.attr('data-src') || null;
      if (image) {
        if (image.indexOf('//') === 0) image = 'https:' + image;
        image = image.replace(/([?&])width=\d+/, '$1width=500');
      }

      const brand = $el.find('.product-item-meta__vendor').first().text().trim();
      const name = ($el.find('a.product-item-meta__title').first().text() || $a.text()).trim();
      const priceText = $el
        .find('.price-list .price:not(.price--compare), .price:not(.price--compare)')
        .first()
        .text()
        .replace(/セール価格|通常価格|単価|税込/g, '');
      const price = parsePrice(priceText);
      if (!price) return;

      // 商品名の最後がサイズ表記ならサイズとして拾う
      let size = '';
      const tokens = name.replace(/　/g, ' ').trim().split(/\s+/);
      const last = (tokens[tokens.length - 1] || '').replace(/[（()）【】[\]]/g, '');
      if (SIZE_TOKEN.test(last)) size = cleanSize(last);

      const isNew = /NEW/i.test($el.find('[class*="label"], [class*="badge"]').text());
      const idMatch = url.match(/\/products\/([^/?#]+)/);

      items.push({
        id: idMatch ? idMatch[1] : url,
        url,
        image,
        brand,
        name,
        size,
        condition: guessCondition(name),
        price,
        rawTitle: brand + ' ' + name,
        categoryHint: name,
        isNew,
      });
    });

    // このサイトは新着順で並べ替えできないため、NEW表示の商品を前に出す
    items.sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0));
    return items;
  },
};
