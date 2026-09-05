/* 仕入れリサーチ — フロントエンド（ライブラリなしの素のJavaScript） */
(function () {
  'use strict';

  /* ---------------- localStorage（ログイン不要の保存） ---------------- */
  var K = {
    fav: 'sr.favorites',
    hide: 'sr.hidden',
    cand: 'sr.candidates',
    snap: 'sr.snapshots',
    seen: 'sr.seen',
    conf: 'sr.settings',
    last: 'sr.lastBrand'
  };

  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  var favorites = load(K.fav, {});
  var hidden = load(K.hide, {});
  var candidates = load(K.cand, {});
  var snapshots = load(K.snap, {});
  var seen = load(K.seen, {});
  var settings = Object.assign({ shipping: 850, feeRate: 0.1 }, load(K.conf, {}));

  /* ---------------- 状態 ---------------- */
  var state = {
    config: null,
    brandId: null,
    view: 'all',
    items: [],
    sources: [],
    fetchedAt: null,
    newIds: {},
    loading: false,
    sort: 'new',
    newOnly: false,
    filters: { sites: {}, min: '', max: '', sizes: {}, keyword: '' }
  };

  var $ = function (sel) { return document.querySelector(sel); };
  var grid = $('#grid');

  /* ---------------- 便利関数 ---------------- */
  function yen(n) { return '¥' + Number(n || 0).toLocaleString('ja-JP'); }

  function timeLabel(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.getHours() + '時' + String(d.getMinutes()).padStart(2, '0') + '分';
  }

  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 1600);
  }

  function pruneSnapshots() {
    var keys = Object.keys(snapshots);
    if (keys.length <= 800) return;
    var keep = {};
    keys.forEach(function (uid) {
      if (favorites[uid] || candidates[uid] || hidden[uid]) keep[uid] = snapshots[uid];
    });
    snapshots = keep;
  }

  function remember(item) {
    snapshots[item.uid] = {
      uid: item.uid, url: item.url, image: item.image, brand: item.brand,
      name: item.name, size: item.size, condition: item.condition,
      price: item.price, siteId: item.siteId, siteShort: item.siteShort,
      brandId: state.brandId, brandLabel: state.config ? brandLabel(state.brandId) : ''
    };
    pruneSnapshots();
    save(K.snap, snapshots);
  }

  function brandLabel(id) {
    var b = (state.config && state.config.brands || []).filter(function (x) { return x.id === id; })[0];
    return b ? b.label : '';
  }

  /* ---------------- API ---------------- */
  function api(path) {
    return fetch(path, { headers: { accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* ---------------- 初期化 ---------------- */
  function init() {
    bindUi();
    api('/api/config').then(function (cfg) {
      state.config = cfg;
      if (cfg.settings) {
        if (settings.shipping == null) settings.shipping = cfg.settings.shippingCost;
        if (settings.feeRate == null) settings.feeRate = cfg.settings.feeRate;
      }
      $('#shippingInput').value = settings.shipping;
      $('#feeInput').value = Math.round(settings.feeRate * 1000) / 10;
      renderBrands();
      var last = load(K.last, null);
      var first = cfg.brands[0] && cfg.brands[0].id;
      selectBrand(last && cfg.brands.some(function (b) { return b.id === last; }) ? last : first);
    }).catch(function (e) {
      grid.innerHTML = '';
      showEmpty('設定の読み込みに失敗しました（' + e.message + '）');
    });
  }

  function renderBrands() {
    var bar = $('#brandBar');
    bar.innerHTML = '';
    state.config.brands.forEach(function (b) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'brandBtn';
      btn.dataset.brand = b.id;
      var note = [];
      if (b.category) note.push((state.config.categories && state.config.categories[b.category]) || b.category);
      if (b.minSize) note.push(b.minSize + '以上');
      btn.innerHTML = '<span>' + esc(b.label) + '</span>' + (note.length ? '<small>' + esc(note.join(' / ')) + '</small>' : '<small>全商品</small>');
      btn.addEventListener('click', function () { selectBrand(b.id); });
      bar.appendChild(btn);
    });
  }

  function selectBrand(id, refresh) {
    state.brandId = id;
    save(K.last, id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    Array.prototype.forEach.call(document.querySelectorAll('.brandBtn'), function (el) {
      el.classList.toggle('is-active', el.dataset.brand === id);
    });
    fetchProducts(refresh);
  }

  function fetchProducts(refresh) {
    state.loading = true;
    renderSkeleton();
    $('#updatedAt').textContent = '読み込み中…';
    var url = '/api/products?brand=' + encodeURIComponent(state.brandId) + (refresh ? '&refresh=1' : '');
    api(url).then(function (data) {
      state.items = data.items || [];
      state.sources = data.sources || [];
      state.fetchedAt = data.fetchedAt;
      computeNew();
      state.loading = false;
      resetSizeFilter();
      render();
    }).catch(function (e) {
      state.loading = false;
      state.items = [];
      state.sources = [];
      render();
      showEmpty('商品を取得できませんでした（' + e.message + '）。少し時間をおいて「商品を更新」を押してください。');
    });
  }

  /* NEW判定：前回この画面で見た商品IDと比べる */
  function computeNew() {
    var key = state.brandId;
    var prev = seen[key] || [];
    var prevSet = {};
    prev.forEach(function (id) { prevSet[id] = true; });
    state.newIds = {};
    var hadHistory = prev.length > 0;
    var all = [];
    state.items.forEach(function (it) {
      all.push(it.uid);
      if (hadHistory && !prevSet[it.uid]) state.newIds[it.uid] = true;
    });
    // 次回のために今回見た商品を記録（直近3000件まで）
    var merged = all.concat(prev).slice(0, 3000);
    seen[key] = merged;
    save(K.seen, seen);
  }

  /* ---------------- 表示するデータの組み立て ---------------- */
  function currentPool() {
    if (state.view === 'all') {
      return state.items.filter(function (it) { return !hidden[it.uid]; });
    }
    var map = state.view === 'fav' ? favorites : state.view === 'cand' ? candidates : hidden;
    var out = [];
    var live = {};
    state.items.forEach(function (it) { live[it.uid] = it; });
    Object.keys(map).forEach(function (uid) {
      if (state.view === 'cand' && !candidates[uid]) return;
      var item = live[uid] || snapshots[uid];
      if (item) out.push(item);
    });
    return out;
  }

  function applyFilters(list) {
    var f = state.filters;
    var kw = (f.keyword || '').trim().toLowerCase();
    var min = f.min === '' ? null : Number(f.min);
    var max = f.max === '' ? null : Number(f.max);
    var siteOn = Object.keys(f.sites).filter(function (k) { return f.sites[k]; });
    var sizeOn = Object.keys(f.sizes).filter(function (k) { return f.sizes[k]; });

    return list.filter(function (it) {
      if (state.newOnly && state.view === 'all' && !state.newIds[it.uid]) return false;
      if (siteOn.length && siteOn.indexOf(it.siteId) < 0) return false;
      if (min !== null && it.price < min) return false;
      if (max !== null && it.price > max) return false;
      if (sizeOn.length) {
        var s = it.size ? String(it.size) : '__none__';
        if (sizeOn.indexOf(s) < 0) return false;
      }
      if (kw) {
        var hay = ((it.name || '') + ' ' + (it.brand || '')).toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
  }

  function sortList(list) {
    var arr = list.slice();
    if (state.sort === 'priceAsc') arr.sort(function (a, b) { return a.price - b.price; });
    else if (state.sort === 'priceDesc') arr.sort(function (a, b) { return b.price - a.price; });
    else arr.sort(function (a, b) {
      var ra = a.rank == null ? 999 : a.rank, rb = b.rank == null ? 999 : b.rank;
      return ra - rb || String(a.siteId).localeCompare(String(b.siteId));
    });
    return arr;
  }

  /* ---------------- 描画 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderSkeleton() {
    grid.innerHTML = '';
    $('#emptyMsg').hidden = true;
    for (var i = 0; i < 6; i++) {
      var d = document.createElement('div');
      d.className = 'card';
      d.innerHTML = '<div class="card__imgWrap skeleton"></div><div class="card__body"><div class="skeleton" style="height:12px"></div><div class="skeleton" style="height:24px;margin-top:6px"></div></div>';
      grid.appendChild(d);
    }
  }

  function showEmpty(msg) {
    var el = $('#emptyMsg');
    el.textContent = msg;
    el.hidden = false;
  }

  function render() {
    renderUpdated();
    renderNotices();
    renderSiteFilter();
    renderSizeFilter();
    renderCounts();

    var list = sortList(applyFilters(currentPool()));
    $('#resultCount').textContent = list.length + '件';
    grid.innerHTML = '';
    $('#emptyMsg').hidden = true;

    if (!list.length) {
      showEmpty(
        state.view === 'fav' ? 'お気に入りはまだありません。' :
        state.view === 'cand' ? '仕入れ候補はまだありません。' :
        state.view === 'hidden' ? '非表示にした商品はありません。' :
        '条件に合う商品がありません。絞り込みを見直してください。'
      );
      return;
    }
    var frag = document.createDocumentFragment();
    list.forEach(function (item) { frag.appendChild(card(item)); });
    grid.appendChild(frag);
  }

  function renderUpdated() {
    var t = state.fetchedAt ? '最終更新 ' + timeLabel(state.fetchedAt) : '';
    $('#updatedAt').textContent = t;
  }

  function renderCounts() {
    var counts = {
      fav: Object.keys(favorites).length,
      cand: Object.keys(candidates).length,
      hidden: Object.keys(hidden).length
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-count]'), function (el) {
      var n = counts[el.dataset.count];
      el.textContent = n ? n : '';
    });
  }

  function renderNotices() {
    var box = $('#notices');
    box.innerHTML = '';
    if (state.view !== 'all') return;
    state.sources.forEach(function (s) {
      if (s.ok) return;
      var div = document.createElement('div');
      div.className = 'notice';
      div.innerHTML = '<span>' + esc(s.name) + '：' + esc(s.error || '取得できませんでした') + '</span>' +
        '<a href="' + esc(s.searchUrl) + '" target="_blank" rel="noopener">サイトで見る →</a>';
      box.appendChild(div);
    });
  }

  function renderSiteFilter() {
    var box = $('#siteFilter');
    if (box.dataset.brand === state.brandId && box.childNodes.length) return;
    box.dataset.brand = state.brandId;
    box.innerHTML = '';
    var sites = state.sources.length ? state.sources : [
      { id: '2ndstreet', short: 'セカスト' }, { id: 'brandear', short: 'ブランディア' }, { id: 'trefac', short: 'トレファク' }
    ];
    sites.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state.filters.sites[s.id] ? ' is-on' : '');
      b.textContent = s.short;
      b.addEventListener('click', function () {
        state.filters.sites[s.id] = !state.filters.sites[s.id];
        b.classList.toggle('is-on');
        render();
      });
      box.appendChild(b);
    });
  }

  function resetSizeFilter() { $('#sizeFilter').dataset.sig = ''; }

  function renderSizeFilter() {
    var box = $('#sizeFilter');
    var pool = currentPool();
    var counts = {};
    pool.forEach(function (it) {
      var s = it.size ? String(it.size) : '__none__';
      counts[s] = (counts[s] || 0) + 1;
    });
    var keys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 14);
    var sig = keys.join('|');
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.innerHTML = '';
    keys.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state.filters.sizes[s] ? ' is-on' : '');
      b.textContent = (s === '__none__' ? 'サイズなし' : s) + ' (' + counts[s] + ')';
      b.addEventListener('click', function () {
        state.filters.sizes[s] = !state.filters.sizes[s];
        b.classList.toggle('is-on');
        render();
      });
      box.appendChild(b);
    });
  }

  function card(item) {
    var el = document.createElement('article');
    el.className = 'card';
    el.dataset.uid = item.uid;

    var badges = '<span class="badge" style="background:' + esc(item.siteColor || '#444') + '">' + esc(item.siteShort || '') + '</span>';
    if (state.newIds[item.uid]) badges += '<span class="badge badge--new">NEW</span>';

    var meta = [];
    if (item.size) meta.push('サイズ ' + esc(item.size));
    if (item.condition) meta.push(esc(item.condition));

    el.innerHTML =
      '<a class="card__link" href="' + esc(item.url) + '" target="_blank" rel="noopener">' +
        '<div class="card__imgWrap">' +
          (item.image ? '<img class="card__img" src="' + esc(item.image) + '" alt="" loading="lazy" decoding="async">' : '') +
          '<div class="card__badges">' + badges + '</div>' +
        '</div>' +
        '<div class="card__body">' +
          '<p class="card__brand">' + esc(item.brand || '') + '</p>' +
          '<p class="card__name">' + esc(item.name || '') + '</p>' +
          '<p class="card__price">' + yen(item.price) + '<span>税込</span></p>' +
          '<p class="card__meta">' + meta.join(' ・ ') + '</p>' +
        '</div>' +
      '</a>' +
      '<div class="card__actions">' +
        '<button class="actBtn' + (favorites[item.uid] ? ' is-on' : '') + '" data-act="fav" type="button"><span class="actBtn__i">☆</span><span class="actBtn__t">お気に入り</span></button>' +
        '<button class="actBtn' + (candidates[item.uid] ? ' is-on' : '') + '" data-act="cand" type="button"><span class="actBtn__i">◎</span><span class="actBtn__t">仕入れ候補</span></button>' +
        '<button class="actBtn' + (hidden[item.uid] ? ' is-on' : '') + '" data-act="hide" type="button"><span class="actBtn__i">' + (hidden[item.uid] ? '↩' : '×') + '</span><span class="actBtn__t">' + (hidden[item.uid] ? '戻す' : '興味なし') + '</span></button>' +
      '</div>';

    if (candidates[item.uid]) el.appendChild(candBlock(item));

    el.querySelector('[data-act="fav"]').addEventListener('click', function () { toggleFav(item); });
    el.querySelector('[data-act="cand"]').addEventListener('click', function () { toggleCand(item); });
    el.querySelector('[data-act="hide"]').addEventListener('click', function () { toggleHide(item); });
    return el;
  }

  function candBlock(item) {
    var data = candidates[item.uid] || {};
    var box = document.createElement('div');
    box.className = 'cand';
    box.innerHTML =
      '<div class="cand__row"><label>予想販売価格</label>' +
      '<input class="input" type="number" inputmode="numeric" min="0" placeholder="例 12000" value="' + (data.sell != null ? esc(data.sell) : '') + '"></div>' +
      '<div class="profit"></div>' +
      '<textarea placeholder="メモ（任意）">' + esc(data.memo || '') + '</textarea>';

    var input = box.querySelector('input');
    var memo = box.querySelector('textarea');
    var profitEl = box.querySelector('.profit');

    function paint() {
      var sell = Number(input.value);
      if (!sell) { profitEl.textContent = ''; profitEl.className = 'profit'; return; }
      var fee = Math.round(sell * settings.feeRate);
      var profit = sell - item.price - fee - Number(settings.shipping || 0);
      profitEl.className = 'profit ' + (profit >= 0 ? 'profit--plus' : 'profit--minus');
      profitEl.innerHTML = '予想利益 ' + yen(profit) +
        '<small>' + yen(sell) + ' − 仕入 ' + yen(item.price) + ' − 手数料 ' + yen(fee) + ' − 送料 ' + yen(settings.shipping) + '</small>';
    }
    function persist() {
      candidates[item.uid] = { sell: input.value === '' ? null : Number(input.value), memo: memo.value };
      save(K.cand, candidates);
      remember(item);
    }
    input.addEventListener('input', function () { paint(); persist(); });
    memo.addEventListener('input', persist);
    paint();
    return box;
  }

  function toggleFav(item) {
    if (favorites[item.uid]) { delete favorites[item.uid]; toast('お気に入りから外しました'); }
    else { favorites[item.uid] = true; remember(item); toast('お気に入りに追加'); }
    save(K.fav, favorites);
    render();
  }

  function toggleCand(item) {
    if (candidates[item.uid]) { delete candidates[item.uid]; toast('仕入れ候補から外しました'); }
    else { candidates[item.uid] = { sell: null, memo: '' }; remember(item); toast('仕入れ候補に追加'); }
    save(K.cand, candidates);
    render();
  }

  function toggleHide(item) {
    if (hidden[item.uid]) { delete hidden[item.uid]; toast('表示に戻しました'); }
    else { hidden[item.uid] = true; remember(item); toast('非表示にしました'); }
    save(K.hide, hidden);
    render();
  }

  /* ---------------- UIのイベント ---------------- */
  function bindUi() {
    $('#refreshBtn').addEventListener('click', function () {
      if (state.loading) return;
      selectBrand(state.brandId, true);
    });

    Array.prototype.forEach.call(document.querySelectorAll('.viewBtn'), function (btn) {
      btn.addEventListener('click', function () {
        state.view = btn.dataset.view;
        Array.prototype.forEach.call(document.querySelectorAll('.viewBtn'), function (b) {
          b.classList.toggle('is-active', b === btn);
        });
        $('#settingsPanel').hidden = state.view !== 'cand';
        $('#brandBar').hidden = state.view !== 'all';
        resetSizeFilter();
        render();
      });
    });

    $('#sortSelect').addEventListener('change', function (e) { state.sort = e.target.value; render(); });

    $('#newOnlyBtn').addEventListener('click', function () {
      state.newOnly = !state.newOnly;
      $('#newOnlyBtn').classList.toggle('is-on', state.newOnly);
      render();
    });

    $('#filterBtn').addEventListener('click', function () {
      var p = $('#filterPanel');
      p.hidden = !p.hidden;
      $('#filterBtn').classList.toggle('is-on', !p.hidden);
    });

    ['priceMin', 'priceMax'].forEach(function (id) {
      $('#' + id).addEventListener('input', function (e) {
        state.filters[id === 'priceMin' ? 'min' : 'max'] = e.target.value;
        render();
      });
    });

    var kwTimer;
    $('#keywordInput').addEventListener('input', function (e) {
      clearTimeout(kwTimer);
      var v = e.target.value;
      kwTimer = setTimeout(function () { state.filters.keyword = v; render(); }, 200);
    });

    $('#clearFilters').addEventListener('click', function () {
      state.filters = { sites: {}, min: '', max: '', sizes: {}, keyword: '' };
      state.newOnly = false;
      $('#newOnlyBtn').classList.remove('is-on');
      $('#priceMin').value = ''; $('#priceMax').value = ''; $('#keywordInput').value = '';
      $('#siteFilter').dataset.brand = ''; resetSizeFilter();
      render();
    });

    $('#shippingInput').addEventListener('input', function (e) {
      settings.shipping = Number(e.target.value || 0);
      save(K.conf, settings);
      render();
    });
    $('#feeInput').addEventListener('input', function (e) {
      settings.feeRate = Number(e.target.value || 0) / 100;
      save(K.conf, settings);
      render();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
