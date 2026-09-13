// ブックマークレット1行版を作る（コメント削除 → 空白圧縮 → 非ASCIIを\uXXXXに）
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('./bookmarklet.src.js', import.meta.url), 'utf8');

// 文字列・正規表現の外側だけ空白を潰す簡易ミニファイ
function minify(code) {
  let out = '';
  let i = 0;
  const n = code.length;
  let prevSignificant = '';
  while (i < n) {
    const ch = code[i];
    // コメント
    if (ch === '/' && code[i + 1] === '/') { while (i < n && code[i] !== '\n') i++; continue; }
    if (ch === '/' && code[i + 1] === '*') { i += 2; while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i++; i += 2; continue; }
    // 文字列
    if (ch === '"' || ch === "'") {
      const quote = ch; out += ch; i++;
      while (i < n) { if (code[i] === '\\') { out += code[i] + code[i + 1]; i += 2; continue; } out += code[i]; if (code[i] === quote) { i++; break; } i++; }
      prevSignificant = quote; continue;
    }
    // 正規表現リテラル（直前が値でないときのみ）
    if (ch === '/' && !/[A-Za-z0-9_$)\]]/.test(prevSignificant)) {
      out += ch; i++; let inClass = false;
      while (i < n) {
        if (code[i] === '\\') { out += code[i] + code[i + 1]; i += 2; continue; }
        if (code[i] === '[') inClass = true;
        if (code[i] === ']') inClass = false;
        out += code[i];
        if (code[i] === '/' && !inClass) { i++; break; }
        i++;
      }
      while (i < n && /[a-z]/.test(code[i])) { out += code[i]; i++; }
      prevSignificant = '/'; continue;
    }
    // 空白
    if (/\s/.test(ch)) {
      let j = i; while (j < n && /\s/.test(code[j])) j++;
      const next = code[j];
      if (/[A-Za-z0-9_$]/.test(prevSignificant) && /[A-Za-z0-9_$]/.test(next || '')) out += ' ';
      i = j; continue;
    }
    out += ch; prevSignificant = ch; i++;
  }
  return out;
}

function escapeNonAscii(s) {
  return s.replace(/[^\x00-\x7F]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

const min = escapeNonAscii(minify(src).trim());
const bookmarklet = 'javascript:' + min;
writeFileSync(new URL('./bookmarklet.min.txt', import.meta.url), bookmarklet);
console.log('length', bookmarklet.length);
// 構文チェック
new Function(min);
console.log('syntax OK');
