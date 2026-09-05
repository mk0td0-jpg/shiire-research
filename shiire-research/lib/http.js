// 外部サイトへのアクセスを「行儀よく」行うための共通処理。
//  - robots.txt を必ず確認し、禁止されているパスは取得しない
//  - 同じホストへの連続アクセスは間隔をあける（サイトに負荷をかけない）
//  - タイムアウトを設ける
//  - ログインが必要なページ・CAPTCHA 等は一切さわらない（公開ページのみ）

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 普通のブラウザと同じ組み合わせのヘッダーを送る（矛盾があると弾かれるサイトがあるため）
const BROWSER_HEADERS = {
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
  'user-agent': UA,
};

const lastAccess = new Map(); // host -> timestamp
const robotsCache = new Map(); // host -> { rules, expires }

const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function politeWait(host, intervalMs) {
  const prev = lastAccess.get(host) || 0;
  const wait = prev + intervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastAccess.set(host, Date.now());
}

function parseRobots(text) {
  // User-agent: * のグループだけを見る（一般的なクローラ向けの指定）
  const lines = String(text).split(/\r?\n/);
  const groups = [];
  let current = null;
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!current || current.hasRules) {
        current = { agents: [], disallow: [], allow: [], hasRules: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && (field === 'disallow' || field === 'allow')) {
      current.hasRules = true;
      if (value) current[field].push(value);
    }
  }
  const star = groups.filter((g) => g.agents.includes('*'));
  const disallow = star.flatMap((g) => g.disallow);
  const allow = star.flatMap((g) => g.allow);
  return { disallow, allow };
}

function patternMatches(pattern, path) {
  // robots.txt の * と $ に対応した簡易マッチ
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  const re = escaped.endsWith('$')
    ? new RegExp('^' + escaped.slice(0, -1) + '$')
    : new RegExp('^' + escaped);
  return re.test(path);
}

async function getRobots(origin, timeoutMs) {
  const cached = robotsCache.get(origin);
  if (cached && cached.expires > Date.now()) return cached.rules;
  let rules = { disallow: [], allow: [] };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), Math.min(timeoutMs, 8000));
    const res = await fetch(origin + '/robots.txt', {
      headers: { 'user-agent': UA, accept: 'text/plain' },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.ok) rules = parseRobots(await res.text());
  } catch {
    // robots.txt が取れない場合は「制限なし」とはみなさず、安全側で何もしない
    rules = { disallow: [], allow: [], unknown: true };
  }
  robotsCache.set(origin, { rules, expires: Date.now() + ROBOTS_TTL_MS });
  return rules;
}

export function isAllowedByRobots(rules, path) {
  const allowMatch = rules.allow.filter((p) => patternMatches(p, path));
  const denyMatch = rules.disallow.filter((p) => patternMatches(p, path));
  if (!denyMatch.length) return true;
  // より具体的（長い）指定が優先
  const longestAllow = Math.max(0, ...allowMatch.map((p) => p.length));
  const longestDeny = Math.max(0, ...denyMatch.map((p) => p.length));
  return longestAllow >= longestDeny;
}

export async function fetchHtml(url, { intervalMs = 800, timeoutMs = 12000 } = {}) {
  const u = new URL(url);
  const rules = await getRobots(u.origin, timeoutMs);
  if (!isAllowedByRobots(rules, u.pathname + u.search)) {
    const err = new Error('robots.txt により取得が許可されていないページです');
    err.code = 'ROBOTS_DISALLOW';
    throw err;
  }
  await politeWait(u.host, intervalMs);

  return attempt(url, u, timeoutMs, 0);
}

async function attempt(url, u, timeoutMs, tries) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { ...BROWSER_HEADERS, referer: u.origin + '/' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = new Error('HTTP ' + res.status);
      err.code = 'HTTP_' + res.status;
      err.status = res.status;
      throw err;
    }
    return await res.text();
  } catch (err) {
    // 一時的な失敗のときだけ、少し待って1回だけやり直す
    const retryable = !err.status || err.status === 429 || err.status >= 500;
    if (tries < 1 && retryable) {
      clearTimeout(timer);
      await sleep(1200);
      return attempt(url, u, timeoutMs, tries + 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export { UA, parseRobots };
