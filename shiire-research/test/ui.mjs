import { chromium } from 'playwright';
const B = process.env.BASE || 'http://localhost:3100';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true,
  userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' });
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message)); p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE: '+m.text())});
const R=[]; const ok=(l,c)=>R.push((c?'✓':'✗')+' '+l);

await p.goto(B, {waitUntil:'networkidle'});
await p.waitForSelector('.card', {timeout:15000});

ok('タイトル表示', (await p.textContent('.topbar__title'))==='仕入れリサーチ');
ok('ブランドボタン5つ', (await p.$$('.brandBtn')).length===5);
ok('横スクロールが発生しない', await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
ok('スマホ幅で2列', await p.evaluate(()=>getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length===2));
ok('画像が正方形', await p.evaluate(()=>{const b=document.querySelector('.card__imgWrap').getBoundingClientRect();return Math.abs(b.width-b.height)<2}));
ok('ボタンが押しやすい(>=40px)', await p.evaluate(()=>[...document.querySelectorAll('.actBtn')].every(b=>b.getBoundingClientRect().height>=40)));

// 取得状況バー
const stats = await p.$$eval('.stat', els=>els.map(e=>e.textContent.replace(/\s+/g,'')));
ok('取得状況バーに5サイト ('+stats.join('/')+')', stats.length===5);
ok('取得成功の表示✅', stats.some(s=>s.includes('✅')));
ok('取得失敗の表示⚠️', stats.some(s=>s.includes('⚠️')));
ok('取得不可サイトはリンク🔗', (await p.$$('.stat--link')).length===2);
ok('最終更新の表示', /最終更新/.test(await p.textContent('.statusBar__time')));

// 商品カードの必須項目
const c0 = await p.evaluate(()=>{const c=document.querySelector('.card');return {
  img:!!c.querySelector('.card__img'), brand:c.querySelector('.card__brand').textContent.trim(),
  name:c.querySelector('.card__name').textContent.trim(), price:c.querySelector('.card__price').textContent,
  meta:c.querySelector('.card__meta').textContent, badge:c.querySelector('.badge').textContent,
  time:c.querySelector('.card__time').textContent, href:c.querySelector('.card__link').href,
  target:c.querySelector('.card__link').target };});
ok('カード: 画像', c0.img);
ok('カード: ブランド名', !!c0.brand);
ok('カード: 商品名', !!c0.name);
ok('カード: 価格', /¥[\d,]+/.test(c0.price));
ok('カード: サイズ/状態', /サイズ|中古|美品|未使用|ランク/.test(c0.meta));
ok('カード: サイト名バッジ', !!c0.badge);
ok('カード: 取得日時', /取得/.test(c0.time));
ok('カード: 別タブで商品ページ', c0.target==='_blank' && /^https?:/.test(c0.href));

// 販売中のみ
const withStock = (await p.$$('.card')).length;
await p.click('#stockBtn'); await p.waitForTimeout(250);
const withAll = (await p.$$('.card')).length;
ok('販売中のみ の切替が効く', withAll > withStock);
ok('販売終了の表示', (await p.$$('.card__sold')).length>0);
await p.click('#stockBtn'); await p.waitForTimeout(250);

// 並び替え
const prices = async()=> p.$$eval('.card__price', els=>els.map(e=>Number(e.textContent.replace(/[^0-9]/g,''))));
await p.selectOption('#sortSelect','priceAsc'); await p.waitForTimeout(250);
let ps = await prices(); ok('価格が安い順', ps.every((v,i)=>i===0||ps[i-1]<=v));
await p.selectOption('#sortSelect','priceDesc'); await p.waitForTimeout(250);
ps = await prices(); ok('価格が高い順', ps.every((v,i)=>i===0||ps[i-1]>=v));
await p.selectOption('#sortSelect','new'); await p.waitForTimeout(250);

// 絞り込み
await p.click('#filterBtn'); await p.waitForSelector('#siteFilter .chip');
const chipCount = (await p.$$('#siteFilter .chip')).length;
ok('サイト絞り込みのボタンが5つ', chipCount===5);
await p.click('#siteFilter .chip:nth-child(3)'); await p.waitForTimeout(250);
const badges = await p.$$eval('.card .badge:not(.badge--new)', e=>[...new Set(e.map(x=>x.textContent))]);
ok('サイト別絞り込み ('+badges.join(',')+')', badges.length===1);
await p.click('#siteFilter .chip:nth-child(3)'); await p.waitForTimeout(200);
await p.fill('#priceMin','20000'); await p.waitForTimeout(300);
ps = await prices(); ok('価格で絞り込み', ps.length>0 && ps.every(v=>v>=20000));
await p.fill('#priceMin',''); await p.waitForTimeout(300);
const sizeChip = await p.$('#sizeFilter .chip');
await sizeChip.click(); await p.waitForTimeout(250);
ok('サイズ絞り込み', (await p.$$('.card')).length>0);
await sizeChip.click(); await p.waitForTimeout(250);
await p.fill('#keywordInput','トートバッグ'); await p.waitForTimeout(400);
ok('キーワード絞り込み', (await p.$$eval('.card__name',e=>e.map(x=>x.textContent))).every(n=>n.includes('トート')));
await p.fill('#keywordInput',''); await p.waitForTimeout(400);
await p.click('#filterBtn');

// お気に入り / 興味なし / 仕入れ候補
const before = (await p.$$('.card')).length;
await p.click('.card [data-act="hide"]'); await p.waitForTimeout(300);
ok('興味なしで消える', (await p.$$('.card')).length===before-1);
await p.click('.viewBtn[data-view="hidden"]'); await p.waitForTimeout(300);
ok('非表示タブに出る', (await p.$$('.card')).length===1);
await p.click('.card [data-act="hide"]'); await p.waitForTimeout(300);
await p.click('.viewBtn[data-view="all"]'); await p.waitForTimeout(300);
await p.click('.card [data-act="fav"]'); await p.waitForTimeout(300);
await p.click('.viewBtn[data-view="fav"]'); await p.waitForTimeout(300);
ok('お気に入りタブに1件', (await p.$$('.card')).length===1);
await p.click('.viewBtn[data-view="all"]'); await p.waitForTimeout(250);
await p.click('.card [data-act="cand"]'); await p.waitForTimeout(300);
await p.click('.viewBtn[data-view="cand"]'); await p.waitForTimeout(300);
ok('仕入れ候補タブに1件', (await p.$$('.card')).length===1);
const buy = Number((await p.textContent('.card__price')).replace(/[^0-9]/g,''));
await p.fill('.cand input','30000'); await p.waitForTimeout(300);
const expect = (30000 - buy - 3000 - 850).toLocaleString('ja-JP');
ok('予想利益の自動計算', (await p.textContent('.profit')).includes(expect));
await p.click('.viewBtn[data-view="all"]'); await p.waitForTimeout(250);

// 設定：送料・手数料
await p.click('#settingsBtn'); await p.waitForTimeout(400);
ok('設定画面が開く', await p.isVisible('#shippingInput'));
await p.fill('#shippingInput','1200'); await p.waitForTimeout(300);
await p.click('.viewBtn[data-view="cand"]'); await p.waitForTimeout(400);
const expect2 = (30000 - buy - 3000 - 1200).toLocaleString('ja-JP');
ok('送料変更で再計算', (await p.textContent('.profit')).includes(expect2));
await p.click('.viewBtn[data-view="all"]'); await p.waitForTimeout(250);

// 設定：ブランド編集
ok('ブランド編集カードが5枚', (await p.$$('.bcard')).length===5);
await p.click('#addBrandBtn'); await p.waitForTimeout(400);
ok('ブランドを追加できる', (await p.$$('.bcard')).length===6 && (await p.$$('.brandBtn')).length===6);
const newCard = (await p.$$('.bcard'))[5];
await newCard.$eval('[data-f="label"]', el=>{el.value='テストブランド'; el.dispatchEvent(new Event('change',{bubbles:true}))});
await p.waitForTimeout(400);
ok('表示名の変更が反映', (await p.$$eval('.brandBtn span', e=>e.map(x=>x.textContent))).includes('テストブランド'));
const chips = await (await p.$$('.bcard'))[5].$$('[data-f="sites"] .chip');
await chips[0].click(); await p.waitForTimeout(300);
ok('対象サイトを外せる', !(await chips[0].getAttribute('class')).includes('is-on'));
await p.click('#exportBtn'); await p.waitForTimeout(200);
const io = await p.inputValue('#settingsIO');
ok('設定を書き出せる', io.includes('テストブランド'));
await (await p.$$('.bcard'))[5].$eval('.bcard__del', el=>el.click());
await p.waitForTimeout(400);
ok('ブランドを削除できる', (await p.$$('.bcard')).length===5);
await p.click('#resetBrandsBtn'); await p.waitForTimeout(600);
ok('初期状態に戻せる', (await p.$$('.brandBtn')).length===5);
await p.click('#settingsBtn'); await p.waitForTimeout(200);

// 保存の永続化
await p.reload({waitUntil:'networkidle'});
await p.waitForSelector('.card');
await p.click('.viewBtn[data-view="cand"]'); await p.waitForTimeout(500);
ok('リロード後も仕入れ候補が残る', (await p.$$('.card')).length===1);
ok('送料設定が残る', (await p.inputValue('#shippingInput'))==='1200');
await p.click('.viewBtn[data-view="all"]'); await p.waitForTimeout(300);

// ブランド切替
await p.click('.brandBtn[data-brand="wackomaria"]'); await p.waitForTimeout(1200);
await p.waitForSelector('.card');
ok('ブランド切替', (await p.$$('.card')).length>0);
ok('切替後も状況バー', (await p.$$('.stat')).length===5);

// PWA
ok('manifestリンクあり', await p.evaluate(()=>!!document.querySelector('link[rel=manifest]')));
ok('apple-touch-iconあり', await p.evaluate(()=>!!document.querySelector('link[rel="apple-touch-icon"]')));
const man = await p.evaluate(()=>fetch('/manifest.webmanifest').then(r=>r.json()));
ok('manifestが読める', man.name==='仕入れリサーチ' && man.display==='standalone');
const swOk = await p.evaluate(()=>fetch('/sw.js').then(r=>r.ok));
ok('service workerが配信される', swOk);
const iconOk = await p.evaluate(()=>fetch('/icon-180.png').then(r=>r.ok));
ok('アイコンPNGが配信される', iconOk);

await p.screenshot({path:'/tmp/ui-top.png'});
console.log(R.join('\n'));
console.log('\nJSエラー:', errs.length? errs.join('\n'):'なし');
console.log('失敗:', R.filter(r=>r.startsWith('✗')).length, '/ 合計', R.length);
await browser.close();
