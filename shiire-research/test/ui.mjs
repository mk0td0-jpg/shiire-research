import { chromium } from 'playwright';
const B='http://localhost:3100';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true, userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' });
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message)); p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
const R=[]; const ok=(l,c)=>R.push((c?'✓':'✗')+' '+l);

await p.goto(B, {waitUntil:'networkidle'});
await p.waitForSelector('.card', {timeout:10000});

ok('タイトル表示', (await p.textContent('.topbar__title'))==='仕入れリサーチ');
ok('ブランドボタン5つ', (await p.$$('.brandBtn')).length===5);
ok('最終更新の表示', /最終更新 \d+時\d+分/.test(await p.textContent('#updatedAt')));
ok('カードが並ぶ', (await p.$$('.card')).length>0);

// 横スクロールなし
const hs = await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1);
ok('横スクロールが発生しない', hs);
// 2列
const cols = await p.evaluate(()=>{const g=document.querySelector('.grid');return getComputedStyle(g).gridTemplateColumns.split(' ').length});
ok('スマホ幅で2列', cols===2);
// 画像が正方形
const sq = await p.evaluate(()=>{const b=document.querySelector('.card__imgWrap').getBoundingClientRect();return Math.abs(b.width-b.height)<2});
ok('画像が正方形', sq);
// タップ領域
const tap = await p.evaluate(()=>[...document.querySelectorAll('.actBtn')].every(b=>b.getBoundingClientRect().height>=40));
ok('ボタンが押しやすいサイズ(>=40px)', tap);

// エラー通知（トレファク失敗）
ok('サイト単位のエラー表示', (await p.textContent('#notices')).includes('トレファク'));
ok('他サイトは表示継続', (await p.$$('.card')).length>=28);

// 商品リンク
const href = await p.getAttribute('.card .card__link','href');
const target = await p.getAttribute('.card .card__link','target');
ok('商品リンクが新しいタブ', target==='_blank' && /^https?:/.test(href));

// 並び替え
const prices = async()=> p.$$eval('.card__price', els=>els.map(e=>Number(e.textContent.replace(/[^0-9]/g,''))));
await p.selectOption('#sortSelect','priceAsc'); await p.waitForTimeout(200);
let ps = await prices(); ok('価格が安い順', ps.every((v,i)=>i===0||ps[i-1]<=v));
await p.selectOption('#sortSelect','priceDesc'); await p.waitForTimeout(200);
ps = await prices(); ok('価格が高い順', ps.every((v,i)=>i===0||ps[i-1]>=v));
await p.selectOption('#sortSelect','new'); await p.waitForTimeout(200);

// 絞り込み: サイト
await p.click('#filterBtn');
await p.waitForSelector('#siteFilter .chip');
await p.click('#siteFilter .chip:nth-child(1)');
await p.waitForTimeout(200);
const badges = await p.$$eval('.card .badge:not(.badge--new)', e=>[...new Set(e.map(x=>x.textContent))]);
ok('販売サイトで絞り込み', badges.length===1 && badges[0]==='セカスト');
await p.click('#siteFilter .chip:nth-child(1)'); await p.waitForTimeout(150);

// 価格絞り込み
await p.fill('#priceMin','20000'); await p.waitForTimeout(250);
ps = await prices(); ok('価格で絞り込み', ps.length>0 && ps.every(v=>v>=20000));
await p.fill('#priceMin',''); await p.waitForTimeout(250);

// キーワード
await p.fill('#keywordInput','トートバッグ'); await p.waitForTimeout(400);
const names = await p.$$eval('.card__name', e=>e.map(x=>x.textContent));
ok('キーワードで絞り込み', names.length>0 && names.every(n=>n.includes('トート')));
await p.fill('#keywordInput',''); await p.waitForTimeout(400);

// サイズ絞り込み
const sizeChip = await p.$('#sizeFilter .chip');
await sizeChip.click(); await p.waitForTimeout(250);
ok('サイズで絞り込み', (await p.$$('.card')).length>0);
await sizeChip.click(); await p.waitForTimeout(250);
await p.click('#filterBtn');

// 興味なし
const before = (await p.$$('.card')).length;
await p.click('.card [data-act="hide"]'); await p.waitForTimeout(250);
ok('興味なしで一覧から消える', (await p.$$('.card')).length===before-1);
await p.click('.viewBtn[data-view="hidden"]'); await p.waitForTimeout(250);
ok('非表示商品の画面に出る', (await p.$$('.card')).length===1);
await p.click('.card [data-act="hide"]'); await p.waitForTimeout(250);
ok('非表示を戻せる', (await p.$$('.card')).length===0);
await p.click('.viewBtn[data-view="all"]'); await p.waitForTimeout(250);
ok('一覧に戻る', (await p.$$('.card')).length===before);

// お気に入り
await p.click('.card [data-act="fav"]'); await p.waitForTimeout(250);
await p.click('.viewBtn[data-view="fav"]'); await p.waitForTimeout(250);
ok('お気に入り画面に1件', (await p.$$('.card')).length===1);
await p.click('.viewBtn[data-view="all"]'); await p.waitForTimeout(200);

// 仕入れ候補 + 利益計算
await p.click('.card [data-act="cand"]'); await p.waitForTimeout(250);
await p.click('.viewBtn[data-view="cand"]'); await p.waitForTimeout(250);
ok('仕入れ候補画面に1件', (await p.$$('.card')).length===1);
ok('送料設定が出る', await p.isVisible('#shippingInput'));
const buy = Number((await p.textContent('.card__price')).replace(/[^0-9]/g,''));
await p.fill('.cand input','30000'); await p.waitForTimeout(300);
const ptext = await p.textContent('.profit');
const expect = 30000 - buy - Math.round(30000*0.1) - 850;
ok('予想利益の自動計算 ('+ptext.split('¥')[1]?.split('¥')[0]+')', ptext.includes(expect.toLocaleString('ja-JP')));
await p.fill('#shippingInput','1200'); await p.waitForTimeout(300);
const expect2 = 30000 - buy - Math.round(30000*0.1) - 1200;
ok('送料を変更すると再計算', (await p.textContent('.profit')).includes(expect2.toLocaleString('ja-JP')));
await p.fill('.cand textarea','テストメモ'); await p.waitForTimeout(200);

// 保存（リロードしても維持）
await p.reload({waitUntil:'networkidle'});
await p.waitForSelector('.card');
await p.click('.viewBtn[data-view="cand"]'); await p.waitForTimeout(400);
ok('リロード後も仕入れ候補が残る', (await p.$$('.card')).length===1);
ok('メモが残る', (await p.inputValue('.cand textarea'))==='テストメモ');
ok('送料設定が残る', (await p.inputValue('#shippingInput'))==='1200');
await p.click('.viewBtn[data-view="all"]'); await p.waitForTimeout(300);

// NEW表示（2回目の読み込みでは新着なし＝バッジ0） → ブランド切替
await p.click('.brandBtn[data-brand="wackomaria"]'); await p.waitForTimeout(800);
await p.waitForSelector('.card');
ok('ブランド切替ができる', (await p.$$('.card')).length>0);
ok('切替後もサイトバッジ表示', (await p.$$('.badge')).length>0);

await p.screenshot({path:'/tmp/shot-mobile.png', fullPage:false});
await p.click('.viewBtn[data-view="cand"]'); await p.waitForTimeout(300);
await p.screenshot({path:'/tmp/shot-cand.png'});

console.log(R.join('\n'));
console.log('\nJSエラー:', errs.length? errs.join('\n'):'なし');
console.log('失敗:', R.filter(r=>r.startsWith('✗')).length);
await browser.close();
