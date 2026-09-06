// ネットにつながらない環境で画面を確認するためのダミーデータ（MOCK=1 のときだけ使用）
const SITES = [
  { id: '2ndstreet', name: 'セカンドストリート', short: 'セカスト', color: '#e8622a' },
  { id: 'brandear', name: 'ブランディア', short: 'ブランディア', color: '#c9a227' },
  { id: 'trefac', name: 'トレファクファッション', short: 'トレファク', color: '#2f7d5c' },
];
const SIZES = ['S', 'M', 'L', 'XL', 'XXL', '38', '40', 'F', ''];
const CONDS = ['未使用', '美品', '中古A', '中古B', '中古C'];
const KINDS = ['ショルダーバッグ', 'トートバッグ', 'ニット・セーター', 'ジャケット', 'シャツ', 'パンツ', 'ワンピース'];

function mockImage(site, n) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${site.color}22"/><text x="200" y="190" font-size="34" text-anchor="middle" fill="#555">${site.short}</text><text x="200" y="240" font-size="30" text-anchor="middle" fill="#888">${n}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

export function mockBrand(brand) {
  const items = [];
  SITES.forEach((site, s) => {
    for (let i = 0; i < 14; i++) {
      const n = s * 100 + i;
      items.push({
        uid: `${site.id}_mock${n}`,
        id: `mock${n}`,
        siteId: site.id,
        siteName: site.name,
        siteShort: site.short,
        siteColor: site.color,
        url: `https://example.com/${site.id}/item/${n}`,
        image: mockImage(site, n),
        brand: brand.label,
        name: `${KINDS[n % KINDS.length]}/${brand.keywords[0]}/No.${n}`,
        size: SIZES[n % SIZES.length],
        condition: CONDS[n % CONDS.length],
        price: 2000 + ((n * 1370) % 48000),
        sizeRank: null,
        rank: i,
      });
    }
  });
  items.sort((a, b) => a.rank - b.rank || a.siteId.localeCompare(b.siteId));
  return {
    brand: { id: brand.id, label: brand.label, keywords: brand.keywords, category: brand.category || null, minSize: brand.minSize || null },
    items,
    sources: SITES.map((s, i) => ({
      ...s,
      ok: i !== 2,
      blocked: i === 2,
      error: i === 2 ? 'このサイトは自動取得を受け付けていません' : null,
      count: i === 2 ? 0 : 14,
      searchUrl: `https://example.com/${s.id}/search`,
    })),
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}
