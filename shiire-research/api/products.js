import { getProducts } from '../lib/handler.js';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const brandId = url.searchParams.get('brand');
  const siteId = url.searchParams.get('site');
  const spec = url.searchParams.get('spec');
  const refresh = url.searchParams.get('refresh') === '1';
  try {
    const data = await getProducts({ brandId, siteId, refresh, spec });
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader(
      'cache-control',
      refresh ? 'no-store' : 's-maxage=1500, stale-while-revalidate=3600'
    );
    res.status(200).end(JSON.stringify(data));
  } catch (err) {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.status(err.status || 500).end(JSON.stringify({ error: err.message || 'error' }));
  }
}
