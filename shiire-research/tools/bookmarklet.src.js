(function () {
  var S = 'https://shiire-research.vercel.app/';
  var h = location.hostname, id = null;
  if (/(^|\.)2ndstreet\.jp$/.test(h)) id = '2ndstreet';
  if (/(^|\.)brandear\.jp$/.test(h)) id = 'brandear';
  if (!id) { alert('セカンドストリートかブランディアの検索結果ページで押してください'); return; }
  var q = new URLSearchParams(location.search);
  var kw = id === '2ndstreet' ? q.get('keyword') : q.get('SearchFullText');
  if (!kw) { alert('検索結果ページで押してください'); return; }
  function T(e) { return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; }
  function A(u) { try { return new URL(u, location.origin).toString(); } catch (e) { return null; } }
  function P(t) { t = (t || '').replace(/,/g, ''); var m = t.match(/(\d{2,9})\s*円|[¥￥]\s*(\d{2,9})/); if (m) return Number(m[1] || m[2]); var n = t.match(/\d{2,9}/); return n ? Number(n[0]) : null; }
  var out = [], els, i;
  if (id === '2ndstreet') {
    els = document.querySelectorAll('li.itemCard');
    for (i = 0; i < els.length; i++) {
      var e = els[i], a = e.querySelector('a.itemCard_inner') || e.querySelector('a[href*="/goods/detail/"]');
      if (!a) continue;
      var p = P(T(e.querySelector('.itemCard_price')));
      if (!p) continue;
      var g = e.querySelector('img'), im = g ? (g.getAttribute('src') || g.getAttribute('data-src')) : null;
      if (im) im = A(String(im).replace('/img/pc/', '/img/sp/'));
      out.push([e.getAttribute('goodsid') || a.getAttribute('href'), A(a.getAttribute('href')), im,
        T(e.querySelector('.itemCard_brand')), T(e.querySelector('.itemCard_name')),
        T(e.querySelector('.itemCard_size')).replace(/サイズ/g, '').replace(/[：:]/g, '').trim(),
        T(e.querySelector('.itemCard_status')).replace(/^商品の状態\s*[:：]\s*/, ''), p]);
    }
  } else {
    els = document.querySelectorAll('div.item');
    for (i = 0; i < els.length; i++) {
      var f = els[i], b = f.querySelector('a[href*="/search/detail/"]');
      if (!b) continue;
      var pr = P(T(f.querySelector('.price2')) || T(f.querySelector('.auction_shousai')));
      if (!pr) continue;
      var gg = f.querySelector('img'), i2 = gg ? gg.getAttribute('src') : null;
      var ti = b.getAttribute('auctiontitle') || (gg ? gg.getAttribute('alt') : '') || '';
      var ms = ti.match(/サイズ\s*([A-Za-z0-9.\-\/]+)/);
      var cw = ['新品同様', '未使用に近い', '新品', '未使用', '極美品', '美品'], cd = '', c;
      for (c = 0; c < cw.length; c++) { if (ti.indexOf(cw[c]) >= 0) { cd = cw[c]; break; } }
      out.push([b.getAttribute('auctionid') || b.getAttribute('href'), A(b.getAttribute('href')), i2 ? A(i2) : null,
        T(f.querySelector('text.titlea')), T(f.querySelector('text.titleb')) || ti, ms ? ms[1] : '', cd, pr]);
    }
  }
  if (!out.length) { alert('この画面から商品が読み取れませんでした'); return; }
  var pl = JSON.stringify({ v: 1, s: id, k: kw, t: new Date().toISOString(), i: out });
  var by = new TextEncoder().encode(pl), bs = '', n;
  for (n = 0; n < by.length; n++) bs += String.fromCharCode(by[n]);
  var u = S + '#import=' + btoa(bs).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  var w = window.open(u, '_blank');
  if (!w) location.href = u;
})();
