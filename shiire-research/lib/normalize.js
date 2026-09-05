// 商品データの正規化（価格・サイズ・カテゴリー判定など）

export function toHalfWidth(str) {
  return String(str || '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ');
}

export function parsePrice(text) {
  const s = toHalfWidth(text).replace(/,/g, '');
  const m = s.match(/(\d{2,9})\s*円|[¥￥]\s*(\d{2,9})/);
  if (m) return Number(m[1] || m[2]);
  const n = s.match(/\d{2,9}/);
  return n ? Number(n[0]) : null;
}

const FREE_SIZE = /^(F|FREE|ONE|ONESIZE|フリー|フリーサイズ|-|ー|なし)$/i;

export function cleanSize(text) {
  let s = toHalfWidth(text)
    .replace(/サイズ/g, '')
    .replace(/[：:]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s || s === '-' || s === '−') return '';
  return s;
}

// サイズを比較可能な数値に変換する。分からない場合は null。
export function sizeRank(sizeText, aliases) {
  const s = cleanSize(sizeText).toUpperCase();
  if (!s) return null;
  if (FREE_SIZE.test(s)) return null;
  if (Object.prototype.hasOwnProperty.call(aliases, s)) return aliases[s];
  // "SIZE1" "L(2)" "40(M)" のような表記からも拾う
  const tokens = s.match(/[A-Z]+|\d+/g) || [];
  for (const t of tokens) {
    if (Object.prototype.hasOwnProperty.call(aliases, t)) return aliases[t];
  }
  return null;
}

export function matchesCategory(item, category) {
  if (!category) return true;
  const haystack = `${item.name || ''} ${item.rawTitle || ''} ${item.categoryHint || ''}`;
  const hay = haystack.toUpperCase();
  const inc = (category.include || []).some((w) => hay.includes(w.toUpperCase()));
  if (!inc) return false;
  const exc = (category.exclude || []).some((w) => hay.includes(w.toUpperCase()));
  return !exc;
}

// 表記ゆれ対策：英語/日本語/スペース有無を吸収してブランド一致を判定
export function looksLikeBrand(item, keywords) {
  const hay = toHalfWidth(
    `${item.brand || ''} ${item.name || ''} ${item.rawTitle || ''}`
  )
    .toUpperCase()
    .replace(/[\s・･‐-]/g, '');
  return keywords.some((k) => {
    const key = toHalfWidth(k).toUpperCase().replace(/[\s・･‐-]/g, '');
    return key.length >= 2 && hay.includes(key);
  });
}

const CONDITION_WORDS = [
  '新品同様', '未使用に近い', '新品', '未使用', '極美品', '美品',
  '中古A', '中古B', '中古C', '中古D', '中古S', 'Aランク', 'Bランク', 'Cランク',
  '難あり', 'ジャンク',
];

export function guessCondition(...texts) {
  const hay = texts.filter(Boolean).join(' ');
  for (const w of CONDITION_WORDS) {
    if (hay.includes(w)) return w;
  }
  return '';
}

export function absoluteUrl(href, base) {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}
