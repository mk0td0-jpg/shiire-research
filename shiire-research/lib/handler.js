import { createRequire } from 'node:module';
import {
  SITES,
  getSite,
  loadBrand,
  loadBrandSite,
  findBrand,
  sitesForBrand,
  siteMode,
  siteReason,
  publicBrand,
} from './aggregate.js';
import { mockBrand, mockBrandSite } from './mock.js';

// config.json は静的に読み込む（デプロイ時に必ず同梱させるため）
const require = createRequire(import.meta.url);
const CONFIG = require('../config.json');

export function loadConfig() {
  return Promise.resolve(CONFIG);
}

export async function getConfigPayload() {
  const config = await loadConfig();
  return {
    brands: config.brands.map(publicBrand),
    sites: SITES.map((s) => ({
      id: s.id,
      name: s.name,
      short: s.short,
      color: s.color,
      mode: siteMode(config, s.id),
      reason: siteMode(config, s.id) === 'link' ? siteReason(config, s.id) : null,
    })),
    settings: {
      shippingCost: config.settings.shippingCost,
      feeRate: config.settings.feeRate,
      cacheMinutes: config.settings.cacheMinutes,
    },
    categories: Object.fromEntries(
      Object.entries(config.categories || {}).map(([k, v]) => [k, v.label || k])
    ),
    categoryDefs: config.categories || {},
  };
}

// 画面で作ったブランド（config.json に無いもの）も受け取れるようにする
function decodeSpec(spec) {
  const json = Buffer.from(String(spec).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const b = JSON.parse(json);
  if (!b || typeof b !== 'object') throw new Error('ブランド指定が不正です');
  const keywords = (Array.isArray(b.keywords) ? b.keywords : [])
    .map((k) => String(k).trim())
    .filter(Boolean)
    .slice(0, 6);
  if (!keywords.length) throw new Error('検索キーワードがありません');
  return {
    id: String(b.id || 'custom').slice(0, 40),
    label: String(b.label || keywords[0]).slice(0, 40),
    keywords,
    category: b.category ? String(b.category).slice(0, 20) : undefined,
    minSize: b.minSize ? String(b.minSize).slice(0, 6) : undefined,
    allowUnknownSize: b.allowUnknownSize === true,
    sites: Array.isArray(b.sites) ? b.sites.map(String).slice(0, 10) : undefined,
    offmallBrandId: b.offmallBrandId ? String(b.offmallBrandId).slice(0, 12) : undefined,
    rev: String(b.rev || '').slice(0, 24),
  };
}

export async function resolveBrand(config, brandId, spec) {
  if (spec) return decodeSpec(spec);
  const brand = findBrand(config, brandId);
  if (!brand) throw Object.assign(new Error('未登録のブランドです'), { status: 404 });
  return brand;
}

export async function getProducts({ brandId, siteId, refresh, spec }) {
  const config = await loadConfig();
  const brand = await resolveBrand(config, brandId, spec);

  if (process.env.MOCK === '1') {
    return siteId ? mockBrandSite(brand, siteId) : mockBrand(brand);
  }

  if (siteId) {
    const site = getSite(siteId);
    if (!site) throw Object.assign(new Error('未登録のサイトです'), { status: 404 });
    return loadBrandSite(config, brand, site, { refresh });
  }
  if (spec) {
    // 画面で作ったブランドをまとめて取得する場合
    const targets = sitesForBrand(config, brand);
    const results = await Promise.allSettled(
      targets.map((site) => loadBrandSite(config, brand, site, { refresh }))
    );
    const sources = [];
    const items = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        sources.push(r.value.source);
        items.push(...r.value.items);
      } else {
        const s = targets[i];
        sources.push({
          id: s.id, name: s.name, short: s.short, color: s.color,
          status: 'error', count: 0, error: '取得できませんでした', note: null,
          searchUrl: s.searchPageUrl(brand.keywords[0]), fetchedAt: new Date().toISOString(),
        });
      }
    });
    items.sort((a, b) => a.rank - b.rank || String(a.siteId).localeCompare(String(b.siteId)));
    return { brand: publicBrand(brand), items, sources, fetchedAt: new Date().toISOString(), cached: false };
  }
  return loadBrand(config, brand.id, { refresh });
}

export function sitesForBrandPublic(config, brand) {
  return sitesForBrand(config, brand).map((s) => s.id);
}
