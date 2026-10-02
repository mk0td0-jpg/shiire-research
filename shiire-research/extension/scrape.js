/* セカンドストリート／ブランディアの「いま開いている検索結果ページ」から
   商品情報だけを読み取る共通コード。
   Cookie・ログイン情報・認証情報は読み取りません。
   ページを開いたときに画面に出ている商品だけを対象にし、
   裏で別のページを読みに行くことはしません。 */
(function (global) {
  'use strict';

  var SITES = {
    '2ndstreet': { id: '2ndstreet', name: 'セカンドストリート', short: 'セカスト', color: '#e8622a' },
    brandear: { id: 'brandear', name: 'ブランディア', short: 'ブランディア', color: '#c9a227' }
  };

  function txt(el) { return el ? String(el.textContent).replace(/\s+/g, ' ').trim() : ''; }

  function abs(href, origin) {
    if (!href) return null;
    try { return new URL(href, origin).toString(); } catch (e) { return null; }
  }

  function toHalf(s) {
    return String(s == null ? '' : s)
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); })
      .replace(/　/g, ' ');
  }

  function price(text) {
    var s = toHalf(text).replace(/,/g, '');
    var m = s.match(/(\d{2,9})\s*円|[¥￥]\s*(\d{2,9})/);
    if (m) return Number(m[1] || m[2]);
    var n = s.match(/\d{2,9}/);
    return n ? Number(n[0]) : null;
  }

  function size(text) {
    var s = toHalf(text).replace(/サイズ/g, '').replace(/[：:]/g, '').replace(/\s+/g, ' ').trim();
    if (!s || s === '-' || s === '−') return '';
    return s;
  }

  function condition(text) {
    var words = ['新品同様', '未使用に近い', '新品', '未使用', '極美品', '美品',
      '中古S', '中古A', '中古B', '中古C', '中古D', '難あり', 'ジャンク'];
    for (var i = 0; i < words.length; i++) if (text.indexOf(words[i]) >= 0) return words[i];
    return '';
  }

  function scrape2ndstreet(doc, loc) {
    var items = [];
    var cards = doc.querySelectorAll('li.itemCard, .itemCard');
    for (var i = 0; i < cards.length; i++) {
      var el = cards[i];
      var a = el.querySelector('a.itemCard_inner') || el.querySelector('a[href*="/goods/detail/"]');
      if (!a) continue;
      var url = abs(a.getAttribute('href'), loc.origin);
      var p = price(txt(el.querySelector('.itemCard_price')));
      if (!url || !p) continue;
      var img = el.querySelector('img');
      var image = img ? (img.getAttribute('src') || img.getAttribute('data-src')) : null;
      if (image) image = abs(String(image).replace('/img/pc/', '/img/sp/'), loc.origin);
      items.push({
        id: el.getAttribute('goodsid') || url,
        url: url,
        image: image,
        brand: txt(el.querySelector('.itemCard_brand')),
        name: txt(el.querySelector('.itemCard_name')),
        size: size(txt(el.querySelector('.itemCard_size'))),
        condition: txt(el.querySelector('.itemCard_status')).replace(/^商品の状態\s*[:：]\s*/, ''),
        price: p,
        isNew: !!el.querySelector('.itemCard_label.-new, .itemCard_label.-New')
      });
    }
    return items;
  }

  function scrapeBrandear(doc, loc) {
    var items = [];
    var cards = doc.querySelectorAll('div.item');
    for (var i = 0; i < cards.length; i++) {
      var el = cards[i];
      var a = el.querySelector('a[href*="/search/detail/"]');
      if (!a) continue;
      var url = abs(a.getAttribute('href'), loc.origin);
      var p = price(txt(el.querySelector('.price2')) || txt(el.querySelector('.auction_shousai')));
      if (!url || !p) continue;
      var img = el.querySelector('img');
      var image = img ? (img.getAttribute('src') || img.getAttribute('data-src')) : null;
      var title = a.getAttribute('auctiontitle') || (img && img.getAttribute('alt')) || a.getAttribute('title') || '';
      var name = txt(el.querySelector('text.titleb')) || title;
      var m = title.match(/サイズ\s*([A-Za-zＡ-Ｚａ-ｚ0-9０-９.\-\/]+)/);
      items.push({
        id: a.getAttribute('auctionid') || url,
        url: url,
        image: image ? abs(image, loc.origin) : null,
        brand: txt(el.querySelector('text.titlea')),
        name: name,
        size: m ? size(m[1]) : '',
        condition: condition(title + ' ' + txt(el)),
        price: p,
        isNew: !!el.querySelector('em.icon-shinchaku')
      });
    }
    return items;
  }

  function detect(loc) {
    if (/(^|\.)2ndstreet\.jp$/.test(loc.hostname)) return '2ndstreet';
    if (/(^|\.)brandear\.jp$/.test(loc.hostname)) return 'brandear';
    return null;
  }

  function keywordOf(siteId, loc) {
    var q = new URLSearchParams(loc.search);
    if (siteId === '2ndstreet') return q.get('keyword') || '';
    if (siteId === 'brandear') return q.get('SearchFullText') || '';
    return '';
  }

  // ページ全体を読み取って、取り込み用のかたまりを返す
  function collect(doc, loc) {
    var siteId = detect(loc);
    if (!siteId) return null;
    var items = siteId === '2ndstreet' ? scrape2ndstreet(doc, loc) : scrapeBrandear(doc, loc);
    var keyword = keywordOf(siteId, loc);
    if (!items.length || !keyword) return { siteId: siteId, keyword: keyword, items: items, at: new Date().toISOString() };
    return { siteId: siteId, keyword: keyword, items: items, at: new Date().toISOString() };
  }

  global.ShiireScrape = {
    SITES: SITES,
    detect: detect,
    keywordOf: keywordOf,
    collect: collect,
    scrape2ndstreet: scrape2ndstreet,
    scrapeBrandear: scrapeBrandear
  };
})(typeof window !== 'undefined' ? window : globalThis);
