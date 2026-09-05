import { createRequire } from 'node:module';
import { loadBrand, findBrand } from './aggregate.js';
import { mockBrand } from './mock.js';

// config.json は静的に読み込む（デプロイ時に必ず同梱させるため）
const require = createRequire(import.meta.url);
const CONFIG = require('../config.json');

export function loadConfig() {
  return Promise.resolve(CONFIG);
}

export async function getConfigPayload() {
  const config = await loadConfig();
  return {
    brands: config.brands.map((b) => ({
      id: b.id,
      label: b.label,
      keywords: b.keywords,
      category: b.category || null,
      minSize: b.minSize || null,
    })),
    settings: {
      shippingCost: config.settings.shippingCost,
      feeRate: config.settings.feeRate,
      cacheMinutes: config.settings.cacheMinutes,
    },
    categories: Object.fromEntries(
      Object.entries(config.categories || {}).map(([k, v]) => [k, v.label || k])
    ),
  };
}

export async function getProducts(brandId, refresh) {
  const config = await loadConfig();
  if (process.env.MOCK === '1') {
    const brand = findBrand(config, brandId);
    if (!brand) throw Object.assign(new Error('未登録のブランドです'), { status: 404 });
    return mockBrand(brand);
  }
  return loadBrand(config, brandId, { refresh });
}
