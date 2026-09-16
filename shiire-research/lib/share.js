/* 端末をまたいで「取り込んだ商品」を共有するための保存場所。

   保存するのは商品情報だけです（商品名・画像・価格・サイズ・状態・URL・サイト名）。
   Cookie・ログイン情報・認証情報のたぐいは一切扱いません。

   保存先は Vercel の設定（環境変数）から自動で見つけます。
     ・Upstash Redis / Vercel KV … KV_REST_API_URL + KV_REST_API_TOKEN
     ・Vercel Blob            … BLOB_READ_WRITE_TOKEN
   どちらも無い場合は「共有オフ」として動き、アプリは今までどおり端末の中だけで動きます。 */

import { gzipSync, gunzipSync } from 'node:zlib';

const MAX_KEYWORDS = 8;      // 1サイトあたりの検索ワード数
const MAX_ITEMS = 200;       // 1検索ワードあたりの商品数
const EXPIRE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 900 * 1024; // 保存前のJSONの上限

export function codeIsValid(code) {
  return typeof code === 'string' && /^[A-Za-z0-9]{6,32}$/.test(code);
}

/* ---------- どの保存先を使うか ---------- */

export function storeKind() {
  const env = process.env;
  if (env.SHARE_STORE === 'memory') return 'memory';
  if (env.KV_REST_API_URL && env.KV_REST_API_TOKEN) return 'kv';
  if (env.BLOB_READ_WRITE_TOKEN) return 'blob';
  return null;
}

export function shareEnabled() {
  return storeKind() !== null;
}

/* ---------- 保存先ごとの読み書き ---------- */

const memory = new Map(); // テスト用

async function kvGet(key) {
  const res = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
    headers: { authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`保存先から読み取れませんでした (${res.status})`);
  const body = await res.json();
  return body && body.result ? String(body.result) : null;
}

async function kvSet(key, value) {
  const res = await fetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}?EX=2592000`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'content-type': 'text/plain',
    },
    body: value,
  });
  if (!res.ok) throw new Error(`保存できませんでした (${res.status})`);
}

function blobUrl(key) {
  return `https://blob.vercel-storage.com/${encodeURIComponent(key)}`;
}

async function blobGet(key) {
  const head = await fetch(blobUrl(key), {
    method: 'HEAD',
    headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`, 'x-api-version': '7' },
  });
  if (head.status === 404) return null;
  const res = await fetch(blobUrl(key), {
    headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`, 'x-api-version': '7' },
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`保存先から読み取れませんでした (${res.status})`);
  return res.text();
}

async function blobSet(key, value) {
  const res = await fetch(blobUrl(key), {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
      'x-api-version': '7',
      'x-add-random-suffix': '0',
      'content-type': 'text/plain',
    },
    body: value,
  });
  if (!res.ok) throw new Error(`保存できませんでした (${res.status})`);
}

async function rawGet(key) {
  const kind = storeKind();
  if (kind === 'memory') return memory.get(key) || null;
  if (kind === 'kv') return kvGet(key);
  if (kind === 'blob') return blobGet(key);
  return null;
}

async function rawSet(key, value) {
  const kind = storeKind();
  if (kind === 'memory') { memory.set(key, value); return; }
  if (kind === 'kv') return kvSet(key, value);
  if (kind === 'blob') return blobSet(key, value);
}

export function resetMemoryStore() {
  memory.clear();
}

/* ---------- 中身の詰め方（小さくして保存する） ---------- */

function pack(data) {
  return gzipSync(Buffer.from(JSON.stringify(data), 'utf8')).toString('base64');
}

function unpack(text) {
  if (!text) return null;
  try {
    return JSON.parse(gunzipSync(Buffer.from(text, 'base64')).toString('utf8'));
  } catch (e) {
    return null;
  }
}

/* ---------- 受け取った中身を点検する ---------- */

function cleanItem(it) {
  if (!it || typeof it !== 'object') return null;
  const url = typeof it.url === 'string' ? it.url.slice(0, 500) : '';
  const price = Number(it.price);
  if (!/^https:\/\//.test(url) || !Number.isFinite(price) || price <= 0) return null;
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  return {
    id: str(it.id, 120) || url,
    url,
    image: /^https:\/\//.test(String(it.image || '')) ? String(it.image).slice(0, 500) : null,
    brand: str(it.brand, 80),
    name: str(it.name, 300),
    size: str(it.size, 40),
    condition: str(it.condition, 40),
    price: Math.round(price),
  };
}

// 画面から送られてきた形（siteId → 検索ワード → {keyword, at, items}）を整える
export function sanitize(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  const now = Date.now();
  Object.keys(input).slice(0, 10).forEach((siteId) => {
    if (!/^[a-z0-9_-]{1,30}$/i.test(siteId)) return;
    const site = input[siteId];
    if (!site || typeof site !== 'object') return;
    const entries = {};
    Object.keys(site).slice(0, MAX_KEYWORDS * 2).forEach((k) => {
      const e = site[k];
      if (!e || typeof e !== 'object' || !Array.isArray(e.items)) return;
      const at = Date.parse(e.at);
      if (!Number.isFinite(at) || now - at > EXPIRE_MS) return;
      const items = e.items.map(cleanItem).filter(Boolean).slice(0, MAX_ITEMS);
      if (!items.length) return;
      entries[String(k).slice(0, 80)] = {
        keyword: typeof e.keyword === 'string' ? e.keyword.slice(0, 80) : String(k).slice(0, 80),
        at: new Date(at).toISOString(),
        items,
      };
    });
    // 新しいものを優先して数を絞る
    const keys = Object.keys(entries).sort((a, b) => Date.parse(entries[b].at) - Date.parse(entries[a].at));
    const kept = {};
    keys.slice(0, MAX_KEYWORDS).forEach((k) => { kept[k] = entries[k]; });
    if (keys.length) out[siteId] = kept;
  });
  return out;
}

// 同じ検索ワードは「新しいほう」を残す
export function merge(base, incoming) {
  const out = {};
  const sites = new Set([...Object.keys(base || {}), ...Object.keys(incoming || {})]);
  sites.forEach((siteId) => {
    const a = (base && base[siteId]) || {};
    const b = (incoming && incoming[siteId]) || {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const site = {};
    keys.forEach((k) => {
      const x = a[k];
      const y = b[k];
      if (!x) { site[k] = y; return; }
      if (!y) { site[k] = x; return; }
      site[k] = Date.parse(y.at) >= Date.parse(x.at) ? y : x;
    });
    const sorted = Object.keys(site).sort((p, q) => Date.parse(site[q].at) - Date.parse(site[p].at));
    const kept = {};
    sorted.slice(0, MAX_KEYWORDS).forEach((k) => { kept[k] = site[k]; });
    if (sorted.length) out[siteId] = kept;
  });
  return out;
}

export function countItems(data) {
  let n = 0;
  Object.keys(data || {}).forEach((s) => {
    Object.keys(data[s] || {}).forEach((k) => { n += (data[s][k].items || []).length; });
  });
  return n;
}

/* ---------- 外から使う2つ ---------- */

export async function readShared(code) {
  if (!codeIsValid(code)) throw Object.assign(new Error('同期コードの形式が違います'), { status: 400 });
  if (!shareEnabled()) return { enabled: false, imported: {}, at: null, count: 0 };
  const saved = unpack(await rawGet(`shiire:${code}`));
  const imported = (saved && saved.imported) || {};
  return {
    enabled: true,
    imported,
    at: (saved && saved.at) || null,
    count: countItems(imported),
  };
}

export async function writeShared(code, incoming) {
  if (!codeIsValid(code)) throw Object.assign(new Error('同期コードの形式が違います'), { status: 400 });
  if (!shareEnabled()) return { enabled: false, imported: {}, at: null, count: 0 };

  const clean = sanitize(incoming);
  const saved = unpack(await rawGet(`shiire:${code}`));
  const merged = merge((saved && saved.imported) || {}, clean);

  const payload = { v: 1, at: new Date().toISOString(), imported: merged };
  const json = JSON.stringify(payload);
  if (Buffer.byteLength(json, 'utf8') > MAX_BYTES) {
    throw Object.assign(new Error('取り込んだ商品が多すぎます'), { status: 413 });
  }
  await rawSet(`shiire:${code}`, pack(payload));
  return { enabled: true, imported: merged, at: payload.at, count: countItems(merged) };
}
