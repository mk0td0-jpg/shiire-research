import { fetchHtml } from './http.js';
import { getCache, setCache } from './cache.js';
import { matchesCategory, looksLikeBrand, sizeRank } from './normalize.js';

import twond from './sites/2ndstreet.js';
import brandear from './sites/brandear.js';
import trefac from './sites/trefac.js';
import okoku from './sites/okoku.js';
import offmall from './sites/offmall.js';

export const SITES = [twond, brandear, trefac, okoku, offmall];

export function getSite(id) {
  return SITES.find((s) => s.id === id) || null;
}

// 同じサイトに何度も断られ続けないようにするための記録
const BLOCK_MINUTES = 30;
const blockedUntil = new Map();

export function findBrand(config, brandId) {
  return config.brands.find((b) => b.id === brandId) || null;
}

export function siteMode(config, siteId) {
  const s = (config.sites && config.sites[siteId]) || {};
  return s.mode === 'link' ? 'link' : 'fetch';
}

export function siteReason(config, siteId) {
  const s = (config.sites && config.sites[siteId]) || {};
  return s.reason || 'このサイトからは自動取得できません';
}

function dedupeKey(siteId, item) {
  return siteId + ':' + (item.id || item.url);
}

// サイト1つぶんの取得。失敗しても例外は投げず、状態を返す。
async function collectFromSite(site, brand, settings) {
  const ctx = {
    fetchHtml: (url) =>
      fetchHtml(url, {
        intervalMs: settings.requestIntervalMs,
        timeoutMs: settings.requestTimeoutMs,
      }),
  };

  const collected = [];
  const seen = new Set();
  let lastError = null;
  let anySuccess = false;
  let note = null;

  const push = (list) => {
    for (const item of list || []) {
      const key = dedupeKey(site.id, item);
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(item);
      if (collected.length >= settings.maxItemsPerSource) break;
    }
  };

  if (typeof site.collect === 'function') {
    // サイト独自の取得方法（例：オフモールのブランド別一覧）
    try {
      const res = await site.collect(brand, ctx);
      anySuccess = true;
      note = res && res.note ? res.note : null;
      push(res && res.items);
    } catch (err) {
      lastError = err;
    }
  } else {
    for (const keyword of brand.keywords) {
      try {
        const html = await ctx.fetchHtml(site.fetchUrl(keyword));
        anySuccess = true;
        push(site.parse(html));
      } catch (err) {
        lastError = err;
        if (err.status === 401 || err.status === 403) {
          blockedUntil.set(site.id, Date.now() + BLOCK_MINUTES * 60 * 1000);
          break;
        }
      }
      if (collected.length >= settings.maxItemsPerSource) break;
    }
  }

  if (!anySuccess) {
    let reason = '取得できませんでした';
    let blocked = false;
    if (lastError) {
      if (lastError.code === 'ROBOTS_DISALLOW') {
        reason = 'robots.txt により取得できません';
        blocked = true;
      } else if (lastError.status === 401 || lastError.status === 403) {
        reason = 'サイト側のアクセス制限により取得できません';
        blocked = true;
      } else if (lastError.status) {
        reason = '取得できませんでした（' + lastError.status + '）';
      } else if (lastError.name === 'AbortError' || lastError.name === 'TimeoutError') {
        reason = '取得できませんでした（時間切れ）';
      } else if (lastError.message) {
        reason = '取得できませんでした（' + String(lastError.message).slice(0, 40) + '）';
      }
    }
    return { ok: false, blocked, error: reason, items: [], note };
  }
  return { ok: true, blocked: false, error: null, items: collected, note };
}

function applyBrandRules(items, brand, config) {
  const category = brand.category ? config.categories[brand.category] : null;
  const minRank = brand.minSize ? sizeRank(brand.minSize, config.sizeAliases) : null;
  const allowUnknownSize = brand.allowUnknownSize === true;

  return items.filter((item) => {
    if (!looksLikeBrand(item, brand.keywords)) return false;
    if (category && !matchesCategory(item, category)) return false;
    if (minRank !== null) {
      const rank = sizeRank(item.size, config.sizeAliases);
      if (rank === null) return allowUnknownSize;
      if (rank < minRank) return false;
    }
    return true;
  });
}

// 1ブランド × 1サイト。画面から並行して呼べるようにしている。
export async function loadBrandSite(config, brand, site, { refresh = false } = {}) {
  const settings = config.settings;
  const cacheKey = 'bs:' + brand.id + ':' + site.id + ':' + (brand.rev || '');
  if (!refresh) {
    const cached = getCache(cacheKey);
    if (cached) return { ...cached, cached: true };
  }

  const mode = siteMode(config, site.id);
  const searchUrl = site.searchPageUrl(brand.keywords[0]);
  const fetchedAt = new Date().toISOString();

  let source;
  let items = [];

  if (mode === 'link') {
    source = {
      id: site.id,
      name: site.name,
      short: site.short,
      color: site.color,
      status: 'link',
      count: 0,
      error: siteReason(config, site.id),
      note: null,
      searchUrl,
      fetchedAt,
    };
  } else {
    const until = blockedUntil.get(site.id) || 0;
    const result =
      until > Date.now()
        ? { ok: false, blocked: true, error: 'サイト側のアクセス制限により取得できません', items: [], note: null }
        : await collectFromSite(site, brand, settings);

    const filtered = applyBrandRules(result.items, brand, config);
    items = filtered.map((item, index) => ({
      ...item,
      uid: site.id + '_' + item.id,
      siteId: site.id,
      siteName: site.name,
      siteShort: site.short,
      siteColor: site.color,
      sizeRank: sizeRank(item.size, config.sizeAliases),
      rank: index,
      inStock: item.inStock === false ? false : true,
      fetchedAt,
    }));

    source = {
      id: site.id,
      name: site.name,
      short: site.short,
      color: site.color,
      status: result.ok ? 'ok' : result.blocked ? 'link' : 'error',
      count: items.length,
      error: result.ok ? null : result.error,
      note: result.note || null,
      searchUrl,
      fetchedAt,
    };
  }

  const payload = { brand: publicBrand(brand), source, items, fetchedAt, cached: false };
  setCache(cacheKey, payload, settings.cacheMinutes * 60 * 1000);
  return payload;
}

export function publicBrand(brand) {
  return {
    id: brand.id,
    label: brand.label,
    keywords: brand.keywords,
    category: brand.category || null,
    minSize: brand.minSize || null,
    allowUnknownSize: brand.allowUnknownSize === true,
    sites: brand.sites || null,
  };
}

export function sitesForBrand(config, brand) {
  const allow = Array.isArray(brand.sites) && brand.sites.length ? brand.sites : null;
  return SITES.filter((s) => (allow ? allow.indexOf(s.id) >= 0 : true));
}

// まとめて取得（互換用・1リクエストで全部ほしいとき）
export async function loadBrand(config, brandId, { refresh = false } = {}) {
  const brand = findBrand(config, brandId);
  if (!brand) throw Object.assign(new Error('未登録のブランドです'), { status: 404 });

  const targets = sitesForBrand(config, brand);
  const results = await Promise.allSettled(
    targets.map((site) => loadBrandSite(config, brand, site, { refresh }))
  );

  const sources = [];
  const all = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      sources.push(r.value.source);
      all.push(...r.value.items);
    } else {
      const site = targets[i];
      sources.push({
        id: site.id,
        name: site.name,
        short: site.short,
        color: site.color,
        status: 'error',
        count: 0,
        error: '取得できませんでした',
        note: null,
        searchUrl: site.searchPageUrl(brand.keywords[0]),
        fetchedAt: new Date().toISOString(),
      });
    }
  });

  all.sort((a, b) => a.rank - b.rank || String(a.siteId).localeCompare(String(b.siteId)));

  return {
    brand: publicBrand(brand),
    items: all,
    sources,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}
