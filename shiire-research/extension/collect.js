/* セカスト／ブランディアの検索結果ページで動き、画面に出ている商品を拡張機能の中に保存します。
   保存するのは商品情報だけです（Cookie・ログイン情報は扱いません）。 */
(function () {
  'use strict';
  var MAX_KEYWORDS = 8;
  var MAX_ITEMS = 200;
  var EXPIRE_MS = 7 * 24 * 60 * 60 * 1000;

  function normKey(s) {
    return String(s || '').toUpperCase().replace(/[\s・･‐\-'’.,()（）]/g, '');
  }

  function prune(imported) {
    var now = Date.now();
    Object.keys(imported).forEach(function (siteId) {
      var site = imported[siteId];
      Object.keys(site).forEach(function (k) {
        if (!site[k] || now - new Date(site[k].at).getTime() > EXPIRE_MS) delete site[k];
      });
      var keys = Object.keys(site).sort(function (a, b) {
        return new Date(site[b].at) - new Date(site[a].at);
      });
      keys.slice(MAX_KEYWORDS).forEach(function (k) { delete site[k]; });
    });
  }

  function total(imported) {
    var n = 0;
    Object.keys(imported).forEach(function (s) {
      Object.keys(imported[s]).forEach(function (k) { n += (imported[s][k].items || []).length; });
    });
    return n;
  }

  function toast(msg) {
    try {
      var el = document.createElement('div');
      el.textContent = msg;
      el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);' +
        'background:#111418;color:#fff;padding:10px 16px;border-radius:999px;font-size:13px;' +
        'z-index:2147483647;box-shadow:0 6px 20px rgba(0,0,0,.25);font-family:sans-serif';
      document.body.appendChild(el);
      setTimeout(function () { el.remove(); }, 2600);
    } catch (e) {}
  }

  // 裏方に「このページは終わったよ」と伝える（0件でも必ず伝える）
  function reportDone(n) {
    try { chrome.runtime.sendMessage({ type: 'collected', n: n || 0 }, function () { void chrome.runtime.lastError; }); } catch (e) {}
  }

  function run() {
    var data = window.ShiireScrape && window.ShiireScrape.collect(document, location);
    if (!data || !data.items || !data.items.length || !data.keyword) { reportDone(0); return; }

    chrome.storage.local.get({ imported: {} }, function (store) {
      var imported = store.imported || {};
      if (!imported[data.siteId]) imported[data.siteId] = {};
      imported[data.siteId][normKey(data.keyword)] = {
        keyword: data.keyword,
        at: data.at,
        items: data.items.slice(0, MAX_ITEMS)
      };
      prune(imported);
      chrome.storage.local.set({ imported: imported }, function () {
        try { chrome.runtime.sendMessage({ type: 'count', n: total(imported) }); } catch (e) {}
        toast('仕入れリサーチに ' + data.items.length + '件 取り込みました');
        reportDone(data.items.length);
      });
    });
  }

  // ページの読み込みが落ち着いてから1回だけ実行する
  if (document.readyState === 'complete') setTimeout(run, 400);
  else window.addEventListener('load', function () { setTimeout(run, 400); });
})();
