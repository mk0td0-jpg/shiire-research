/* 仕入れリサーチのページで動き、拡張機能に貯まった商品をページへ渡します。
   あわせて、ページからの「検索ページを1つ開いて」という依頼を裏方へ取り次ぎます。 */
(function () {
  'use strict';

  var CAPS = { open: true }; // この版は一括取り込みに対応しています

  function send() {
    try {
      chrome.storage.local.get({ imported: {} }, function (store) {
        window.postMessage({
          source: 'shiire-ext', type: 'data',
          imported: store.imported || {}, caps: CAPS
        }, location.origin);
      });
    } catch (e) {}
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window) return;
    var d = e.data;
    if (!d || d.source !== 'shiire-page') return;

    if (d.type === 'request') send();

    if (d.type === 'clear') {
      try { chrome.storage.local.set({ imported: {} }, function () { send(); }); } catch (err) {}
    }

    // 検索ページを1つだけ裏のタブで開く
    if (d.type === 'open' && d.url) {
      try {
        chrome.runtime.sendMessage({ type: 'open', url: d.url, id: d.id }, function (res) {
          void chrome.runtime.lastError;
          if (!res || !res.ok) {
            window.postMessage({ source: 'shiire-ext', type: 'done', id: d.id, n: 0, reason: 'failed' }, location.origin);
          }
        });
      } catch (err) {
        window.postMessage({ source: 'shiire-ext', type: 'done', id: d.id, n: 0, reason: 'failed' }, location.origin);
      }
    }

    if (d.type === 'cancel') {
      try { chrome.runtime.sendMessage({ type: 'cancel', id: d.id }, function () { void chrome.runtime.lastError; }); } catch (err) {}
    }
  });

  // 裏方からの「1ページぶん終わったよ」をページへ渡す
  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || msg.source !== 'shiire-ext') return;
    if (msg.type === 'done') {
      window.postMessage(msg, location.origin);
      send(); // 取り込んだ中身もいっしょに渡す
    }
  });

  send();
  window.addEventListener('focus', send);
})();
