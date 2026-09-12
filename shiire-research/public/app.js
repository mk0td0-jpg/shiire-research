/* 仕入れリサーチ — フロントエンド（ライブラリなしの素のJavaScript） */
(function () {
  'use strict';

  /* ---------------- 保存（ログイン不要・この端末だけ） ---------------- */
  var K = {
    fav: 'sr.favorites',
    hide: 'sr.hidden',
    cand: 'sr.candidates',
    snap: 'sr.snapshots',
    seen: 'sr.seen',
    conf: 'sr.settings',
    brands: 'sr.brands',
    last: 'sr.lastBrand'
  };

  function load(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
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
    server: null,          // /api/config の内容
    brands: [],            // 画面で使うブランド一覧
    brandId: null,
    view: 'all',
    sources: {},           // siteId -> 取得状況
    itemsBySite: {},       // siteId -> 商品配列
    newIds: {},
    loading: false,
    sort: 'new',
    newOnly: false,
    stockOnly: true,
    filters: { sites: {}, min: '', max: '', sizes: {}, keyword: '' },
    reqToken: 0
  };

  var $ = function (sel) { return document.querySelector(sel); };
  var grid = $('#grid');

  /* ---------------- 便利関数 ---------------- */
  function yen(n) { return '¥' + Number(n || 0).toLocaleString('ja-JP'); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function ago(iso) {
    if (!iso) return '';
    var sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (sec < 60) return 'たった今';
    var min = Math.round(sec / 60);
    if (min < 60) return min + '分前';
    var hr = Math.round(min / 60);
    if (hr < 24) return hr + '時間前';
    return Math.round(hr / 24) + '日前';
  }

  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 1600);
  }

  function b64url(obj) {
    var bytes = new TextEncoder().encode(JSON.stringify(obj));
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function api(path, signal) {
    return fetch(path, { headers: { accept: 'application/json' }, signal: signal }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function currentBrand() {
    for (var i = 0; i < state.brands.length; i++) if (state.brands[i].id === state.brandId) return state.brands[i];
    return null;
  }

  function brandLabel(id) {
    for (var i = 0; i < state.brands.length; i++) if (state.brands[i].id === id) return state.brands[i].label;
    return '';
  }

  function targetSites(brand) {
    var all = (state.server && state.server.sites) || [];
    if (brand && brand.sites && brand.sites.length) {
      return all.filter(function (s) { return brand.sites.indexOf(s.id) >= 0; });
    }
    return all;
  }

  /* ---------------- 初期化 ---------------- */
  function init() {
    bindUi();
    registerSW();
    api('/api/config').then(function (cfg) {
      state.server = cfg;
      if (settings.shipping == null) settings.shipping = cfg.settings.shippingCost;
      if (settings.feeRate == null) settings.feeRate = cfg.settings.feeRate;
      $('#shippingInput').value = settings.shipping;
      $('#feeInput').value = Math.round(settings.feeRate * 1000) / 10;

      var saved = load(K.brands, null);
      state.brands = (saved && saved.length) ? saved : cfg.brands.map(function (b) {
        return {
          id: b.id, label: b.label, keywords: b.keywords.slice(),
          category: b.category || '', minSize: b.minSize || '',
          allowUnknownSize: !!b.allowUnknownSize, sites: b.sites || null
        };
      });

      renderBrands();
      var last = load(K.last, null);
      var exists = state.brands.some(function (b) { return b.id === last; });
      selectBrand(exists ? last : (state.brands[0] && state.brands[0].id));
      setInterval(renderStatusBar, 30000);
    }).catch(function (e) {
      grid.innerHTML = '';
      showEmpty('設定の読み込みに失敗しました（' + e.message + '）');
    });
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    try { navigator.serviceWorker.register('/sw.js'); } catch (e) {}
  }

  function renderBrands() {
    var bar = $('#brandBar');
    bar.innerHTML = '';
    state.brands.forEach(function (b) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'brandBtn';
      btn.dataset.brand = b.id;
      var note = [];
      var catLabel = state.server && state.server.categories && state.server.categories[b.category];
      if (b.category) note.push(catLabel || b.category);
      if (b.minSize) note.push(b.minSize + '以上');
      btn.innerHTML = '<span>' + esc(b.label) + '</span>' +
        '<small>' + esc(note.length ? note.join(' / ') : '全商品') + '</small>';
      btn.addEventListener('click', function () { selectBrand(b.id); });
      bar.appendChild(btn);
    });
  }

  function selectBrand(id, refresh) {
    if (!id) return;
    state.brandId = id;
    save(K.last, id);
    Array.prototype.forEach.call(document.querySelectorAll('.brandBtn'), function (el) {
      el.classList.toggle('is-active', el.dataset.brand === id);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    fetchAllSites(refresh);
  }

  /* ---------------- サイトごとに並行して取得 ---------------- */
  function fetchAllSites(refresh) {
    var brand = currentBrand();
    if (!brand) return;
    var token = ++state.reqToken;
    state.loading = true;
    state.sources = {};
    state.itemsBySite = {};

    var sites = targetSites(brand);
    sites.forEach(function (s) {
      state.sources[s.id] = {
        id: s.id, name: s.name, short: s.short, color: s.color,
        status: 'loading', count: 0, error: null, searchUrl: null, fetchedAt: null
      };
    });
    renderSkeleton();
    renderStatusBar();

    var useSpec = brand.custom || brand.edited;
    var specParam = useSpec ? '&spec=' + encodeURIComponent(b64url({
      id: brand.id, label: brand.label, keywords: brand.keywords,
      category: brand.category || undefined, minSize: brand.minSize || undefined,
      allowUnknownSize: !!brand.allowUnknownSize, sites: brand.sites || undefined,
      rev: brand.rev || ''
    })) : '';
    var brandParam = useSpec ? 'brand=custom' : 'brand=' + encodeURIComponent(brand.id);

    sites.forEach(function (s) {
      var url = '/api/products?' + brandParam + specParam + '&site=' + encodeURIComponent(s.id) +
        (refresh ? '&refresh=1' : '');
      api(url).then(function (data) {
        if (token !== state.reqToken) return;
        state.sources[s.id] = data.source;
        state.itemsBySite[s.id] = data.items || [];
        afterSiteLoaded(token);
      }).catch(function (e) {
        if (token !== state.reqToken) return;
        state.sources[s.id] = Object.assign({}, state.sources[s.id], {
          status: 'error', error: '取得できませんでした（' + e.message + '）', fetchedAt: new Date().toISOString()
        });
        afterSiteLoaded(token);
      });
    });
  }

  function afterSiteLoaded(token) {
    if (token !== state.reqToken) return;
    var pending = Object.keys(state.sources).filter(function (k) {
      return state.sources[k].status === 'loading';
    }).length;
    state.loading = pending > 0;
    if (!state.loading) computeNew();
    render();
  }

  function allItems() {
    var out = [];
    Object.keys(state.itemsBySite).forEach(function (k) { out = out.concat(state.itemsBySite[k]); });
    return out;
  }

  function sourceList() {
    var brand = currentBrand();
    return targetSites(brand).map(function (s) { return state.sources[s.id]; }).filter(Boolean);
  }

  /* NEW判定：前回この画面で見た商品IDと比べる */
  function computeNew() {
    var key = state.brandId;
    var prev = seen[key] || [];
    var prevSet = {};
    prev.forEach(function (id) { prevSet[id] = true; });
    state.newIds = {};
    var hadHistory = prev.length > 0;
    var ids = [];
    allItems().forEach(function (it) {
      ids.push(it.uid);
      if (hadHistory && !prevSet[it.uid]) state.newIds[it.uid] = true;
    });
    seen[key] = ids.concat(prev).slice(0, 3000);
    save(K.seen, seen);
  }

  /* ---------------- 表示データ ---------------- */
  function currentPool() {
    if (state.view === 'all') {
      return allItems().filter(function (it) { return !hidden[it.uid]; });
    }
    var map = state.view === 'fav' ? favorites : state.view === 'cand' ? candidates : hidden;
    var live = {};
    allItems().forEach(function (it) { live[it.uid] = it; });
    var out = [];
    Object.keys(map).forEach(function (uid) {
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
      if (state.stockOnly && it.inStock === false) return false;
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
  function renderSkeleton() {
    grid.innerHTML = '';
    $('#emptyMsg').hidden = true;
    for (var i = 0; i < 6; i++) {
      var d = document.createElement('div');
      d.className = 'card';
      d.innerHTML = '<div class="card__imgWrap skeleton"></div><div class="card__body">' +
        '<div class="skeleton" style="height:12px"></div>' +
        '<div class="skeleton" style="height:24px;margin-top:6px"></div></div>';
      grid.appendChild(d);
    }
  }

  function showEmpty(msg) {
    var el = $('#emptyMsg');
    el.textContent = msg;
    el.hidden = false;
  }

  function render() {
    renderStatusBar();
    renderNotices();
    renderSiteFilter();
    renderSizeFilter();
    renderCounts();

    var list = sortList(applyFilters(currentPool()));
    $('#resultCount').textContent = list.length + '件' + (state.loading ? '（取得中…）' : '');
    grid.innerHTML = '';
    $('#emptyMsg').hidden = true;

    if (!list.length) {
      if (state.loading) { renderSkeleton(); return; }
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

  function renderStatusBar() {
    var bar = $('#statusBar');
    if (!bar) return;
    bar.innerHTML = '';
    var sources = sourceList();
    if (!sources.length) return;
    var newest = null;
    sources.forEach(function (s) {
      var el;
      if (s.status === 'link') {
        el = document.createElement('a');
        el.className = 'stat stat--link';
        el.href = s.searchUrl || '#';
        el.target = '_blank';
        el.rel = 'noopener';
        el.innerHTML = '🔗 ' + esc(s.short) + '<span class="stat__n">開く</span>';
        el.title = s.error || '';
      } else {
        el = document.createElement('span');
        el.className = 'stat' + (s.status === 'error' ? ' stat--error' : '');
        if (s.status === 'loading') {
          el.innerHTML = '<span class="stat__spin"></span>' + esc(s.short);
        } else if (s.status === 'ok') {
          el.innerHTML = '✅ ' + esc(s.short) + '<span class="stat__n">' + s.count + '</span>';
          if (s.note) el.title = s.note;
        } else {
          el.innerHTML = '⚠️ ' + esc(s.short);
          el.title = s.error || '';
        }
      }
      bar.appendChild(el);
      if (s.fetchedAt && (!newest || s.fetchedAt > newest)) newest = s.fetchedAt;
    });
    if (newest) {
      var t = document.createElement('span');
      t.className = 'statusBar__time';
      t.textContent = '最終更新 ' + ago(newest);
      bar.appendChild(t);
    }
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
    var failed = sourceList().filter(function (s) { return s.status === 'link' || s.status === 'error'; });
    if (!failed.length) return;
    var label = brandLabel(state.brandId) || '';
    var lead = document.createElement('p');
    lead.className = 'siteLinks__lead';
    lead.textContent = '自動取得できないサイトも確認する';
    box.appendChild(lead);
    var wrap = document.createElement('div');
    wrap.className = 'siteLinks';
    failed.forEach(function (s) {
      var a = document.createElement('a');
      a.className = 'siteLink';
      a.href = s.searchUrl || '#';
      a.target = '_blank';
      a.rel = 'noopener';
      a.innerHTML =
        '<span class="siteLink__dot" style="background:' + esc(s.color || '#444') + '"></span>' +
        '<span class="siteLink__txt"><b>' + esc(s.short) + '</b>で「' + esc(label) + '」を検索</span>' +
        '<span class="siteLink__go">開く →</span>';
      wrap.appendChild(a);
    });
    box.appendChild(wrap);
  }

  function renderSiteFilter() {
    var box = $('#siteFilter');
    var sources = sourceList();
    var sig = sources.map(function (s) { return s.id; }).join('|');
    if (box.dataset.sig === sig && box.childNodes.length) return;
    box.dataset.sig = sig;
    box.innerHTML = '';
    sources.forEach(function (s) {
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
      siteColor: item.siteColor, inStock: item.inStock, fetchedAt: item.fetchedAt,
      brandId: state.brandId
    };
    pruneSnapshots();
    save(K.snap, snapshots);
  }

  function card(item) {
    var el = document.createElement('article');
    el.className = 'card';
    el.dataset.uid = item.uid;

    var badges = '<span class="badge" style="background:' + esc(item.siteColor || '#444') + '">' +
      esc(item.siteShort || '') + '</span>';
    if (state.newIds[item.uid]) badges += '<span class="badge badge--new">NEW</span>';

    var meta = [];
    if (item.size) meta.push('サイズ ' + esc(item.size));
    if (item.condition) meta.push(esc(item.condition));

    el.innerHTML =
      '<a class="card__link" href="' + esc(item.url) + '" target="_blank" rel="noopener">' +
        '<div class="card__imgWrap">' +
          (item.image ? '<img class="card__img" src="' + esc(item.image) + '" alt="" loading="lazy" decoding="async">' : '') +
          '<div class="card__badges">' + badges + '</div>' +
          (item.inStock === false ? '<div class="card__sold">販売終了</div>' : '') +
        '</div>' +
        '<div class="card__body">' +
          '<p class="card__brand">' + esc(item.brand || '') + '</p>' +
          '<p class="card__name">' + esc(item.name || '') + '</p>' +
          '<p class="card__price">' + yen(item.price) + '<span>税込</span></p>' +
          '<p class="card__meta">' + meta.join(' ・ ') + '</p>' +
          '<p class="card__time">取得 ' + esc(ago(item.fetchedAt)) + '</p>' +
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
    save(K.fav, favorites); render();
  }
  function toggleCand(item) {
    if (candidates[item.uid]) { delete candidates[item.uid]; toast('仕入れ候補から外しました'); }
    else { candidates[item.uid] = { sell: null, memo: '' }; remember(item); toast('仕入れ候補に追加'); }
    save(K.cand, candidates); render();
  }
  function toggleHide(item) {
    if (hidden[item.uid]) { delete hidden[item.uid]; toast('表示に戻しました'); }
    else { hidden[item.uid] = true; remember(item); toast('非表示にしました'); }
    save(K.hide, hidden); render();
  }

  /* ---------------- 設定（ブランド編集） ---------------- */
  function persistBrands() {
    save(K.brands, state.brands);
    renderBrands();
    Array.prototype.forEach.call(document.querySelectorAll('.brandBtn'), function (el) {
      el.classList.toggle('is-active', el.dataset.brand === state.brandId);
    });
  }

  function renderBrandEditor() {
    var box = $('#brandEditor');
    box.innerHTML = '';
    var cats = (state.server && state.server.categories) || {};
    var sites = (state.server && state.server.sites) || [];

    state.brands.forEach(function (b, idx) {
      var c = document.createElement('div');
      c.className = 'bcard';
      var catOpts = '<option value="">指定なし（全商品）</option>' +
        Object.keys(cats).map(function (k) {
          return '<option value="' + esc(k) + '"' + (b.category === k ? ' selected' : '') + '>' + esc(cats[k]) + '</option>';
        }).join('');
      var sizes = ['', 'S', 'M', 'L', 'XL', 'XXL'];
      var sizeOpts = sizes.map(function (s) {
        return '<option value="' + s + '"' + (b.minSize === s ? ' selected' : '') + '>' + (s === '' ? '指定なし' : s + '以上') + '</option>';
      }).join('');

      c.innerHTML =
        '<div class="bcard__head"><span class="bcard__name">' + esc(b.label) + '</span>' +
        '<button class="bcard__del" type="button">削除</button></div>' +
        '<label class="bfield"><span>表示名</span><input data-f="label" type="text" value="' + esc(b.label) + '"></label>' +
        '<label class="bfield"><span>検索キーワード（カンマ区切り・英語と日本語の両方を入れると取りこぼしが減ります）</span>' +
        '<input data-f="keywords" type="text" value="' + esc(b.keywords.join(', ')) + '"></label>' +
        '<div class="bfield--row">' +
        '<label class="bfield"><span>カテゴリー</span><select data-f="category">' + catOpts + '</select></label>' +
        '<label class="bfield"><span>サイズ条件</span><select data-f="minSize">' + sizeOpts + '</select></label>' +
        '</div>' +
        '<label class="bcheck"><input data-f="allowUnknownSize" type="checkbox"' + (b.allowUnknownSize ? ' checked' : '') + '>サイズ不明の商品も表示する</label>' +
        '<div class="bfield"><span>探すサイト</span><div class="chips" data-f="sites">' +
        sites.map(function (s) {
          var on = !b.sites || !b.sites.length || b.sites.indexOf(s.id) >= 0;
          return '<button type="button" class="chip' + (on ? ' is-on' : '') + '" data-site="' + esc(s.id) + '">' + esc(s.short) + '</button>';
        }).join('') + '</div></div>';

      c.querySelector('.bcard__del').addEventListener('click', function () {
        if (state.brands.length <= 1) { toast('最後の1件は削除できません'); return; }
        state.brands.splice(idx, 1);
        if (state.brandId === b.id) state.brandId = state.brands[0].id;
        persistBrands(); renderBrandEditor(); selectBrand(state.brandId);
      });

      c.querySelectorAll('[data-f]').forEach(function (el) {
        if (el.tagName === 'DIV') return;
        el.addEventListener('change', function () {
          var f = el.dataset.f;
          if (f === 'keywords') b.keywords = el.value.split(/[,、]/).map(function (x) { return x.trim(); }).filter(Boolean);
          else if (f === 'allowUnknownSize') b.allowUnknownSize = el.checked;
          else b[f] = el.value;
          b.edited = true;
          b.rev = String(Date.now());
          persistBrands();
          if (f === 'label') renderBrandEditor();
          if (state.brandId === b.id) fetchAllSites(true);
        });
      });

      c.querySelectorAll('[data-f="sites"] .chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
          var ids = sites.map(function (s) { return s.id; });
          var cur = (b.sites && b.sites.length) ? b.sites.slice() : ids.slice();
          var id = chip.dataset.site;
          var i = cur.indexOf(id);
          if (i >= 0) { if (cur.length <= 1) { toast('1つは選んでください'); return; } cur.splice(i, 1); }
          else cur.push(id);
          b.sites = cur;
          b.edited = true;
          b.rev = String(Date.now());
          chip.classList.toggle('is-on');
          persistBrands();
          if (state.brandId === b.id) fetchAllSites(true);
        });
      });

      box.appendChild(c);
    });
  }

  function addBrand() {
    var id = 'b' + Date.now().toString(36);
    state.brands.push({
      id: id, label: '新しいブランド', keywords: [], category: '', minSize: '',
      allowUnknownSize: false, sites: null, custom: true, edited: true, rev: String(Date.now())
    });
    persistBrands();
    renderBrandEditor();
    toast('表示名と検索キーワードを入れてください');
  }

  /* ---------------- UIのイベント ---------------- */
  function bindUi() {
    $('#refreshBtn').addEventListener('click', function () {
      if (state.loading) return;
      fetchAllSites(true);
    });

    $('#settingsBtn').addEventListener('click', function () {
      var p = $('#settingsPanel');
      p.hidden = !p.hidden;
      if (!p.hidden) { renderBrandEditor(); p.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });

    Array.prototype.forEach.call(document.querySelectorAll('.viewBtn'), function (btn) {
      btn.addEventListener('click', function () {
        state.view = btn.dataset.view;
        Array.prototype.forEach.call(document.querySelectorAll('.viewBtn'), function (b) {
          b.classList.toggle('is-active', b === btn);
        });
        $('#brandBar').hidden = state.view !== 'all';
        $('#sizeFilter').dataset.sig = '';
        render();
      });
    });

    $('#sortSelect').addEventListener('change', function (e) { state.sort = e.target.value; render(); });

    $('#stockBtn').addEventListener('click', function () {
      state.stockOnly = !state.stockOnly;
      $('#stockBtn').classList.toggle('is-on', state.stockOnly);
      render();
    });

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
      $('#siteFilter').dataset.sig = ''; $('#sizeFilter').dataset.sig = '';
      render();
    });

    $('#shippingInput').addEventListener('input', function (e) {
      settings.shipping = Number(e.target.value || 0);
      save(K.conf, settings); render();
    });
    $('#feeInput').addEventListener('input', function (e) {
      settings.feeRate = Number(e.target.value || 0) / 100;
      save(K.conf, settings); render();
    });

    $('#addBrandBtn').addEventListener('click', addBrand);

    $('#exportBtn').addEventListener('click', function () {
      $('#settingsIO').value = JSON.stringify({ brands: state.brands, settings: settings });
      $('#settingsIO').select();
      toast('コピーして、もう一方の端末に貼り付けてください');
    });

    $('#importBtn').addEventListener('click', function () {
      try {
        var data = JSON.parse($('#settingsIO').value);
        if (!data || !Array.isArray(data.brands) || !data.brands.length) throw new Error('形式が違います');
        state.brands = data.brands;
        if (data.settings) { settings = Object.assign(settings, data.settings); save(K.conf, settings); }
        $('#shippingInput').value = settings.shipping;
        $('#feeInput').value = Math.round(settings.feeRate * 1000) / 10;
        persistBrands(); renderBrandEditor();
        selectBrand(state.brands[0].id);
        toast('設定を読み込みました');
      } catch (e) { toast('読み込めませんでした（' + e.message + '）'); }
    });

    $('#resetBrandsBtn').addEventListener('click', function () {
      try { localStorage.removeItem(K.brands); } catch (e) {}
      state.brands = (state.server.brands || []).map(function (b) {
        return {
          id: b.id, label: b.label, keywords: b.keywords.slice(),
          category: b.category || '', minSize: b.minSize || '',
          allowUnknownSize: !!b.allowUnknownSize, sites: b.sites || null
        };
      });
      persistBrands(); renderBrandEditor();
      selectBrand(state.brands[0] && state.brands[0].id);
      toast('初期状態に戻しました');
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
