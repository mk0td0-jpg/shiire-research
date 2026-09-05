// とても単純なメモリキャッシュ（サーバーが再起動すると消えます）
const store = new Map();

export function getCache(key) {
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    store.delete(key);
    return null;
  }
  return hit.value;
}

export function setCache(key, value, ttlMs) {
  store.set(key, { value, expires: Date.now() + ttlMs });
  if (store.size > 60) {
    const oldest = [...store.entries()].sort((a, b) => a[1].expires - b[1].expires)[0];
    if (oldest) store.delete(oldest[0]);
  }
  return value;
}
