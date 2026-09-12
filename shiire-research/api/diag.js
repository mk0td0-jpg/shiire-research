// 取得できないサイトの原因を調べるための一時的な診断用エンドポイント。
// 対象は自分たちが登録しているサイトのみに限定する。
const ALLOWED = [
  'www.2ndstreet.jp',
  'auction.brandear.jp',
  'www.trefac.jp',
  'okoku.jp',
  'netmall.hardoff.co.jp',
];

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const STRATEGIES = {
  chromeHeaders: {
    accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
    'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
    'user-agent': CHROME_UA,
  },
  uaOnly: { 'user-agent': CHROME_UA },
  honestBot: {
    'user-agent': 'ShiireResearchBot/1.0 (personal resale research; contact via site owner)',
    accept: 'text/html',
  },
  noUa: { accept: 'text/html' },
  identityEncoding: { 'user-agent': CHROME_UA, accept: 'text/html', 'accept-encoding': 'identity' },
};

async function tryFetch(target, headers, extra) {
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(target, { headers: { ...headers, ...(extra || {}) }, redirect: 'follow', signal: ctrl.signal });
    clearTimeout(t);
    const body = await res.text();
    return {
      status: res.status,
      ms: Date.now() - started,
      len: body.length,
      server: res.headers.get('server'),
      via: res.headers.get('via'),
      setCookie: !!res.headers.get('set-cookie'),
      snippet: body.replace(/\s+/g, ' ').slice(0, 300),
    };
  } catch (err) {
    return { error: String(err && err.message).slice(0, 120), ms: Date.now() - started };
  }
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const target = url.searchParams.get('url');
  const out = { region: process.env.VERCEL_REGION || null, target, results: {} };
  try {
    if (!target) throw new Error('url パラメータが必要です');
    const u = new URL(target);
    if (ALLOWED.indexOf(u.host) < 0) throw new Error('対象外のホストです');

    for (const [name, headers] of Object.entries(STRATEGIES)) {
      out.results[name] = await tryFetch(target, headers);
    }

    // トップページを開いてからだと通るか（cookie を引き継ぐ）
    try {
      const top = await fetch(u.origin + '/', { headers: STRATEGIES.chromeHeaders });
      const cookie = (top.headers.getSetCookie ? top.headers.getSetCookie() : [])
        .map((c) => c.split(';')[0])
        .join('; ');
      out.results.afterTopPage = await tryFetch(target, STRATEGIES.chromeHeaders, {
        cookie,
        referer: u.origin + '/',
      });
      out.results.afterTopPage.topStatus = top.status;
      out.results.afterTopPage.cookieCount = cookie ? cookie.split(';').length : 0;
    } catch (e) {
      out.results.afterTopPage = { error: String(e && e.message).slice(0, 120) };
    }
  } catch (err) {
    out.error = String(err && err.message);
  }
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.status(200).end(JSON.stringify(out, null, 1));
}
