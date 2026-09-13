/* 拡張機能の裏方。やることは3つだけです。
   1. アイコンに取り込み件数を出す
   2. 仕入れリサーチの画面から頼まれたら、検索ページを「1つだけ」裏のタブで開く
   3. そのページの取り込みが終わったら、タブを閉じて画面に知らせる
   何ページ開くか・次をいつ開くかは、仕入れリサーチの画面側が決めます。
   （まとめて一気に開かないので、サイトへの負担を抑えられます） */

var KEY = 'openJobs'; // { タブID: { appTabId, id } }

function getJobs(cb) {
  chrome.storage.session.get({ openJobs: {} }, function (o) { cb(o.openJobs || {}); });
}

function setJobs(jobs, cb) {
  chrome.storage.session.set({ openJobs: jobs }, function () { if (cb) cb(); });
}

function tellApp(appTabId, msg) {
  if (!appTabId) return;
  try { chrome.tabs.sendMessage(appTabId, msg, function () { void chrome.runtime.lastError; }); } catch (e) {}
}

function finish(tabId, info) {
  getJobs(function (jobs) {
    var job = jobs[tabId];
    if (!job) return;
    delete jobs[tabId];
    setJobs(jobs);
    try { chrome.tabs.remove(tabId, function () { void chrome.runtime.lastError; }); } catch (e) {}
    tellApp(job.appTabId, {
      source: 'shiire-ext',
      type: 'done',
      id: job.id,
      n: info && info.n ? info.n : 0,
      reason: (info && info.reason) || 'collected'
    });
  });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg) return;

  if (msg.type === 'count') {
    chrome.action.setBadgeText({ text: msg.n ? String(msg.n) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#e8622a' });
    return;
  }

  // 検索ページの取り込みが終わった（0件でも届きます）
  if (msg.type === 'collected') {
    if (sender.tab && sender.tab.id != null) finish(sender.tab.id, { n: msg.n || 0, reason: 'collected' });
    return;
  }

  // 画面から「このページを1つ開いて」と頼まれた
  if (msg.type === 'open' && msg.url) {
    var appTabId = sender.tab && sender.tab.id;
    chrome.tabs.create({ url: msg.url, active: false }, function (tab) {
      if (chrome.runtime.lastError || !tab) { sendResponse({ ok: false }); return; }
      getJobs(function (jobs) {
        jobs[tab.id] = { appTabId: appTabId, id: msg.id };
        setJobs(jobs, function () { sendResponse({ ok: true, tabId: tab.id }); });
      });
    });
    return true; // 非同期で返事をする
  }

  // 画面から「時間切れなので閉じて」と頼まれた
  if (msg.type === 'cancel') {
    getJobs(function (jobs) {
      Object.keys(jobs).forEach(function (tabId) {
        if (jobs[tabId].id === msg.id) finish(Number(tabId), { n: 0, reason: 'timeout' });
      });
      sendResponse({ ok: true });
    });
    return true;
  }
});

// 途中でタブが手で閉じられた場合も、待ちっぱなしにしない
chrome.tabs.onRemoved.addListener(function (tabId) {
  getJobs(function (jobs) {
    var job = jobs[tabId];
    if (!job) return;
    delete jobs[tabId];
    setJobs(jobs);
    tellApp(job.appTabId, { source: 'shiire-ext', type: 'done', id: job.id, n: 0, reason: 'closed' });
  });
});
