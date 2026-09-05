import { getProducts } from '../lib/handler.js';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const brandId = url.searchParams.get('brand');
  const refresh = url.searchParams.get('refresh') === '1';
  try {
    const data = await getProducts(brandId, refresh);
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', refresh ? 'no-store' : 's-maxage=1800, stale-while-revalidate=3600');
    res.status(200).end(JSON.stringify(data));
  } catch (err) {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.status(err.status || 500).end(JSON.stringify({ error: err.message || 'error' }));
  }
}
