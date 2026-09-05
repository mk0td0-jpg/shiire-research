import { fetchHtml } from './http.js';
import { getCache, setCache } from './cache.js';
import { matchesCategory, looksLikeBrand, sizeRank } from './normalize.js';

import twond from './sites/2ndstreet.js';
import brandear from './sites/brandear.js';
import trefac from './sites/trefac.js';

export const SITES = [twond, brandear, trefac];

export function findBrand(config, brandId) {
  return config.brands.find((b) => b.id === brandId) || null;
}

function dedupeKey(siteId, item) {
  return `${siteId}:${item.id || item.url}`;
}

async function fetchSiteForBrand(site, brand, settings) {
  const collected = [];
  const seen = new Set();
  let lastError = null;
  let anySuccess = false;

  for (const keyword of brand.keywords) {
    try {
      const html = await fetchHtml(site.fetchUrl(keyword), {
        intervalMs: settings.requestIntervalMs,
        timeoutMs: settings.requestTimeoutMs,
      });
      const parsed = site.parse(html);
      anySuccess = true;
      for (const item of parsed) {
        const key = dedupeKey(site.id, item);
        if (seen.has(key)) continue;
        seen.add(key);
        collected.push(item);
        if (collected.length >= settings.maxItemsPerSource) break;
      }
    } catch (err) {
      lastError = err;
    }
    if (collected.length >= settings.maxItemsPerSource) break;
  }

  if (!anySuccess) {
    let reason = '取得できませんでした';
    if (lastError) {
      if (lastError.code === 'ROBOTS_DISALLOW') reason = 'robots.txt により取得できません';
      else if (lastError.status) reason = '取得できませんでした（' + lastError.status + '）';
      else if (lastError.name === 'AbortError' || lastError.name === 'TimeoutError')
        reason = '取得できませんでした（時間切れ）';
      else if (lastError.message)
        reason = '取得できませんでした（' + String(lastError.message).slice(0, 40) + '）';
    }
    return { ok: false, error: reason, items: [] };
  }
  return { ok: true, error: null, items: collected };
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

export async function loadBrand(config, brandId, { refresh = false } = {}) {
  const brand = findBrand(config, brandId);
  if (!brand) throw Object.assign(new Error('未登録のブランドです'), { status: 404 });

  const settings = config.settings;
  const cacheKey = `brand:${brandId}`;
  if (!refresh) {
    const cached = getCache(cacheKey);
    if (cached) return { ...cached, cached: true };
  }

  const sources = [];
  const all = [];

  // サイトごとに並行して取得する（同じサイトへの連続アクセスは間隔をあけたまま）
  const results = await Promise.all(
    SITES.map((site) =>
      fetchSiteForBrand(site, brand, settings).catch(() => ({
        ok: false,
        error: '取得できませんでした',
        items: [],
      }))
    )
  );

  SITES.forEach((site, i) => {
    const result = results[i];
    const filtered = applyBrandRules(result.items, brand, config);
    filtered.forEach((item, index) => {
      all.push({
        ...item,
        uid: `${site.id}_${item.id}`,
        siteId: site.id,
        siteName: site.name,
        siteShort: site.short,
        siteColor: site.color,
        sizeRank: sizeRank(item.size, config.sizeAliases),
        rank: index,
      });
    });
    sources.push({
      id: site.id,
      name: site.name,
      short: site.short,
      color: site.color,
      ok: result.ok,
      error: result.error,
      count: filtered.length,
      searchUrl: site.searchPageUrl(brand.keywords[0]),
    });
  });

  // 全サイトを混ぜたうえで、新着順（各サイトの並び順を交互に）に整える
  all.sort((a, b) => a.rank - b.rank || a.siteId.localeCompare(b.siteId));

  const payload = {
    brand: { id: brand.id, label: brand.label, keywords: brand.keywords, category: brand.category || null, minSize: brand.minSize || null },
    items: all,
    sources,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
  setCache(cacheKey, payload, settings.cacheMinutes * 60 * 1000);
  return payload;
}
