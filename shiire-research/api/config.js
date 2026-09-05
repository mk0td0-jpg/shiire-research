import { getConfigPayload } from '../lib/handler.js';

export default async function handler(req, res) {
  const data = await getConfigPayload();
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 's-maxage=300');
  res.status(200).end(JSON.stringify(data));
}
