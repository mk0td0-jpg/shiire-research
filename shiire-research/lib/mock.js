// ネットにつながらない環境で画面を確認するためのダミーデータ（MOCK=1 のときだけ使用）
const SITES = [
  { id: '2ndstreet', name: 'セカンドストリート', short: 'セカスト', color: '#e8622a', mode: 'link' },
  { id: 'brandear', name: 'ブランディア', short: 'ブランディア', color: '#c9a227', mode: 'link' },
  { id: 'trefac', name: 'トレファクファッション', short: 'トレファク', color: '#2f7d5c', mode: 'fetch' },
  { id: 'okoku', name: '買取王国', short: '買取王国', color: '#2563a8', mode: 'fetch' },
  { id: 'offmall', name: 'オフモール', short: 'オフモール', color: '#e2761b', mode: 'fetch' },
];
const SIZES = ['S', 'M', 'L', 'XL', 'XXL', '38', '40', 'F', ''];
const CONDS = ['未使用', '美品', '中古A', 'Bランク(中古)', '中古C'];
const KINDS = ['ショルダーバッグ', 'トートバッグ', 'ニット・セーター', 'ジャケット', 'シャツ', 'パンツ', 'ワンピース'];

function mockImage(site, n) {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="' +
    site.color +
    '22"/><text x="200" y="190" font-size="34" text-anchor="middle" fill="#555">' +
    site.short +
    '</text><text x="200" y="240" font-size="30" text-anchor="middle" fill="#888">' +
    n +
    '</text></svg>';
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function buildItems(brand, site, base) {
  const items = [];
  for (let i = 0; i < 14; i++) {
    const n = base + i;
    items.push({
      uid: site.id + '_mock' + n,
      id: 'mock' + n,
      siteId: site.id,
      siteName: site.name,
      siteShort: site.short,
      siteColor: site.color,
      url: 'https://example.com/' + site.id + '/item/' + n,
      image: mockImage(site, n),
      brand: brand.label,
      name: KINDS[n % KINDS.length] + '/' + brand.keywords[0] + '/No.' + n,
      size: SIZES[n % SIZES.length],
      condition: CONDS[n % CONDS.length],
      price: 2000 + ((n * 1370) % 48000),
      sizeRank: null,
      rank: i,
      inStock: n % 11 !== 0,
      fetchedAt: new Date().toISOString(),
    });
  }
  return items;
}

function sourceFor(site, count, extra) {
  return {
    id: site.id,
    name: site.name,
    short: site.short,
    color: site.color,
    status: site.mode === 'link' ? 'link' : extra && extra.error ? 'error' : 'ok',
    count: site.mode === 'link' ? 0 : count,
    error:
      site.mode === 'link'
        ? 'サイト側のアクセス制限（Akamai）により、サーバーからは取得できません'
        : (extra && extra.error) || null,
    note: null,
    searchUrl: 'https://example.com/' + site.id + '/search',
    fetchedAt: new Date().toISOString(),
  };
}

function pub(brand) {
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

export function mockBrandSite(brand, siteId) {
  const site = SITES.find((s) => s.id === siteId) || SITES[2];
  const idx = SITES.indexOf(site);
  const isErr = site.id === 'offmall';
  const items = site.mode === 'link' || isErr ? [] : buildItems(brand, site, idx * 100);
  return {
    brand: pub(brand),
    source: sourceFor(site, items.length, isErr ? { error: '取得できませんでした（時間切れ）' } : null),
    items,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}

export function mockBrand(brand) {
  const items = [];
  const sources = [];
  SITES.forEach((site, i) => {
    const isErr = site.id === 'offmall';
    const list = site.mode === 'link' || isErr ? [] : buildItems(brand, site, i * 100);
    items.push(...list);
    sources.push(sourceFor(site, list.length, isErr ? { error: '取得できませんでした（時間切れ）' } : null));
  });
  items.sort((a, b) => a.rank - b.rank || a.siteId.localeCompare(b.siteId));
  return { brand: pub(brand), items, sources, fetchedAt: new Date().toISOString(), cached: false };
}
