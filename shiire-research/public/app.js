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
    imported: 'sr.imported',
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
  var imported = load(K.imported, {});   // 自分のブラウザから取り込んだ商品

  /* ---------------- 状態 ---------------- */
  var state = {
    server: null,          // /api/config の内容
    brands: [],            // 画面で使うブランド一覧
    brandId: null,
    view: 'all',
    sources: {},           // siteId -> 取得状況
    itemsBySite: {},       // siteId -> 商品配列（サーバー取得）
    importedBySite: {},    // siteId -> 商品配列（自分のブラウザから取り込み）
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
    setupImport();
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
      var pending = state.pendingImport;
      var target = pending ? brandForKeyword(pending.keyword) : null;
      if (target) {
        selectBrand(target.id);
        afterImport(pending, false);
      } else {
        var last = load(K.last, null);
        var exists = state.brands.some(function (b) { return b.id === last; });
        selectBrand(exists ? last : (state.brands[0] && state.brands[0].id));
        if (pending) afterImport(pending, false);
      }
      state.pendingImport = null;
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
    state.importedBySite = buildImported(brand);

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
        state.sources[s.id] = withImported(data.source);
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
    Object.keys(state.importedBySite).forEach(function (k) { out = out.concat(state.importedBySite[k]); });
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
      if (s.status === 'imported') {
        el = document.createElement('a');
        el.className = 'stat stat--imported';
        el.href = s.searchUrl || '#';
        el.target = '_blank';
        el.rel = 'noopener';
        el.innerHTML = '📥 ' + esc(s.short) + '<span class="stat__n">' + s.count + '</span>';
        el.title = '自分のブラウザで取り込んだ商品です。押すとサイトを開いて取り込み直せます。';
      } else if (s.status === 'link') {
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
          if (!s.count && s.note) {
            el.innerHTML = '➖ ' + esc(s.short) + '<span class="stat__n">登録なし</span>';
          } else {
            el.innerHTML = '✅ ' + esc(s.short) + '<span class="stat__n">' + s.count + '</span>';
          }
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
    var failed = sourceList().filter(function (s) {
      return s.status === 'link' || s.status === 'error' || (s.status === 'ok' && !s.count && s.note);
    });
    if (!failed.length) return;
    var label = brandLabel(state.brandId) || '';
    var lead = document.createElement('p');
    lead.className = 'siteLinks__lead';
    lead.textContent = '自動取得できないサイトも確認する';
    box.appendChild(lead);
    if (failed.some(function (s) { return s.status === 'link'; })) {
      var hint = document.createElement('p');
      hint.className = 'siteLinks__hint';
      hint.innerHTML = 'セカスト・ブランディアは、拡張機能かブックマークレットを入れると' +
        'この一覧に混ぜて表示できます。<a href="/import.html">設定のしかた →</a>';
      box.appendChild(hint);
    }
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


  /* ---------------- 自分のブラウザからの取り込み ---------------- */
  // セカスト・ブランディアはサーバーから取得できないため、
  // 拡張機能やブックマークレットが読み取った商品をここで受け取る。
  var IMPORT_EXPIRE_MS = 7 * 24 * 60 * 60 * 1000;

  function normKey(s) {
    return String(s == null ? '' : s).toUpperCase().replace(/[\s・･‐\-'’.,()（）]/g, '');
  }

  function toHalf(s) {
    return String(s == null ? '' : s)
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); })
      .replace(/　/g, ' ');
  }

  function cleanSize(t) {
    var v = toHalf(t).replace(/サイズ/g, '').replace(/[：:]/g, '').replace(/\s+/g, ' ').trim();
    if (!v || v === '-' || v === '−') return '';
    return v;
  }

  function sizeRankOf(sizeText) {
    var aliases = (state.server && state.server.sizeAliases) || {};
    var v = cleanSize(sizeText).toUpperCase();
    if (!v) return null;
    if (/^(F|FREE|ONE|ONESIZE|フリー|フリーサイズ|-|ー|なし)$/i.test(v)) return null;
    if (Object.prototype.hasOwnProperty.call(aliases, v)) return aliases[v];
    var tokens = v.match(/[A-Z]+|\d+/g) || [];
    for (var i = 0; i < tokens.length; i++) {
      if (Object.prototype.hasOwnProperty.call(aliases, tokens[i])) return aliases[tokens[i]];
    }
    return null;
  }

  function matchesBrandRules(item, brand) {
    var hay = toHalf((item.brand || '') + ' ' + (item.name || '')).toUpperCase().replace(/[\s・･‐\-]/g, '');
    var okBrand = (brand.keywords || []).some(function (k) {
      var key = toHalf(k).toUpperCase().replace(/[\s・･‐\-]/g, '');
      return key.length >= 2 && hay.indexOf(key) >= 0;
    });
    if (!okBrand) return false;

    var defs = (state.server && state.server.categoryDefs) || {};
    var cat = brand.category ? defs[brand.category] : null;
    if (cat) {
      var text = ((item.name || '') + ' ' + (item.brand || '')).toUpperCase();
      var inc = (cat.include || []).some(function (w) { return text.indexOf(String(w).toUpperCase()) >= 0; });
      if (!inc) return false;
      var exc = (cat.exclude || []).some(function (w) { return text.indexOf(String(w).toUpperCase()) >= 0; });
      if (exc) return false;
    }
    if (brand.minSize) {
      var min = sizeRankOf(brand.minSize);
      var r = sizeRankOf(item.size);
      if (r === null) return brand.allowUnknownSize === true;
      if (min !== null && r < min) return false;
    }
    return true;
  }

  function siteMeta(siteId) {
    var sites = (state.server && state.server.sites) || [];
    for (var i = 0; i < sites.length; i++) if (sites[i].id === siteId) return sites[i];
    return null;
  }

  // 保存してある取り込み商品から、いま選んでいるブランドに合うものを組み立てる
  function buildImported(brand) {
    var out = {};
    if (!brand) return out;
    var keys = (brand.keywords || []).map(normKey).filter(function (k) { return k.length >= 2; });
    Object.keys(imported).forEach(function (siteId) {
      var meta = siteMeta(siteId);
      if (!meta) return;
      if (brand.sites && brand.sites.length && brand.sites.indexOf(siteId) < 0) return;
      var entries = imported[siteId] || {};
      var picked = [];
      Object.keys(entries).forEach(function (k) {
        var e = entries[k];
        if (!e || !e.items) return;
        if (Date.now() - new Date(e.at).getTime() > IMPORT_EXPIRE_MS) return;
        var hit = keys.some(function (bk) { return k === bk || k.indexOf(bk) >= 0 || bk.indexOf(k) >= 0; });
        if (hit) picked.push(e);
      });
      if (!picked.length) return;
      var seenIds = {};
      var items = [];
      picked.sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
      picked.forEach(function (e) {
        e.items.forEach(function (it) {
          var uid = siteId + '_' + it.id;
          if (seenIds[uid]) return;
          if (!matchesBrandRules(it, brand)) return;
          seenIds[uid] = true;
          items.push({
            uid: uid, id: it.id, url: it.url, image: it.image || null,
            brand: it.brand || '', name: it.name || '', size: it.size || '',
            condition: it.condition || '', price: it.price,
            siteId: siteId, siteName: meta.name, siteShort: meta.short, siteColor: meta.color,
            rank: items.length, inStock: true, fetchedAt: e.at, imported: true
          });
        });
      });
      if (items.length) out[siteId] = items;
    });
    return out;
  }

  function withImported(source) {
    var list = state.importedBySite[source.id];
    if (!list || !list.length) return source;
    return Object.assign({}, source, {
      status: 'imported',
      count: list.length,
      fetchedAt: list[0].fetchedAt || source.fetchedAt
    });
  }

  function saveImported() {
    // 古いものを捨ててから保存する
    var now = Date.now();
    Object.keys(imported).forEach(function (siteId) {
      var site = imported[siteId];
      Object.keys(site).forEach(function (k) {
        if (!site[k] || now - new Date(site[k].at).getTime() > IMPORT_EXPIRE_MS) delete site[k];
      });
      var keys = Object.keys(site).sort(function (a, b) { return new Date(site[b].at) - new Date(site[a].at); });
      keys.slice(8).forEach(function (k) { delete site[k]; });
    });
    save(K.imported, imported);
  }

  // 取り込み1件ぶんを受け取る
  function acceptImport(siteId, keyword, at, items) {
    if (!siteId || !keyword || !items || !items.length) return 0;
    if (!imported[siteId]) imported[siteId] = {};
    imported[siteId][normKey(keyword)] = { keyword: keyword, at: at || new Date().toISOString(), items: items };
    saveImported();
    return items.length;
  }

  function decodeHashImport(hash) {
    var m = /[#&]import=([^&]+)/.exec(hash || '');
    if (!m) return null;
    var b = m[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    var bin = atob(b);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || data.v !== 1 || !Array.isArray(data.i)) return null;
    return {
      siteId: data.s,
      keyword: data.k,
      at: data.t,
      items: data.i.map(function (a) {
        return { id: a[0], url: a[1], image: a[2], brand: a[3], name: a[4], size: a[5], condition: a[6], price: a[7] };
      }).filter(function (x) { return x.url && x.price; })
    };
  }

  function refreshImported() {
    state.importedBySite = buildImported(currentBrand());
    Object.keys(state.sources).forEach(function (id) {
      state.sources[id] = withImported(state.sources[id]);
    });
    render();
  }

  // 取り込んだ検索ワードに合うブランドを探す
  function brandForKeyword(keyword) {
    var k = normKey(keyword);
    if (!k) return null;
    for (var i = 0; i < state.brands.length; i++) {
      var b = state.brands[i];
      var hit = (b.keywords || []).some(function (x) {
        var bk = normKey(x);
        return bk.length >= 2 && (bk === k || k.indexOf(bk) >= 0 || bk.indexOf(k) >= 0);
      });
      if (hit) return b;
    }
    return null;
  }

  function handleHashImport() {
    try {
      var got = decodeHashImport(location.hash);
      if (!got) return null;
      var n = acceptImport(got.siteId, got.keyword, got.at, got.items);
      history.replaceState(null, '', location.pathname + location.search);
      return n ? got : null;
    } catch (e) {
      setTimeout(function () { toast('取り込めませんでした'); }, 600);
      return null;
    }
  }

  function afterImport(got, ready) {
    var n = got.items.length;
    var target = brandForKeyword(got.keyword);
    var label = target ? target.label : got.keyword;
    if (ready && target && target.id !== state.brandId) {
      selectBrand(target.id);
    } else if (ready) {
      refreshImported();
    }
    setTimeout(function () { toast(label + 'を' + n + '件 取り込みました'); }, ready ? 200 : 800);
  }

  function setupImport() {
    // ブックマークレットからの受け取り（URLの #import=...）
    var first = handleHashImport();
    if (first) state.pendingImport = first;

    window.addEventListener('hashchange', function () {
      var got = handleHashImport();
      if (got) afterImport(got, true);
    });

    // Chrome拡張からの受け取り
    window.addEventListener('message', function (e) {
      if (e.source !== window) return;
      var d = e.data;
      if (!d || d.source !== 'shiire-ext' || d.type !== 'data' || !d.imported) return;
      var changed = 0;
      Object.keys(d.imported).forEach(function (siteId) {
        var site = d.imported[siteId] || {};
        Object.keys(site).forEach(function (k) {
          var entry = site[k];
          if (!entry || !entry.items || !entry.items.length) return;
          var cur = (imported[siteId] || {})[normKey(entry.keyword || k)];
          if (cur && cur.at === entry.at) return;
          changed += acceptImport(siteId, entry.keyword || k, entry.at, entry.items);
        });
      });
      if (changed && state.server) refreshImported();
    });
    try { window.postMessage({ source: 'shiire-page', type: 'request' }, location.origin); } catch (e) {}
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
