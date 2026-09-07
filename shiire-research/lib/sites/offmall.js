import { absoluteUrl } from '../normalize.js';

const BASE = 'https://netmall.hardoff.co.jp';

// オフモールは robots.txt で検索結果ページの自動取得を認めていないため、
// 商品の取得は行わず「検索結果を開くボタン」だけを出す。
export default {
  id: 'offmall',
  name: 'オフモール',
  short: 'オフモール',
  color: '#e2761b',
  linkOnly: true,
  linkReason: 'サイトのルールにより自動取得していません',

  searchPageUrl(keyword) {
    return BASE + '/search/?q=' + encodeURIComponent(keyword);
  },

  fetchUrl(keyword) {
    return this.searchPageUrl(keyword);
  },

  parse() {
    return [];
  },
};
