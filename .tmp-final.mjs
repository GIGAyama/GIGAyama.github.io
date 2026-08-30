import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await b.newPage({ viewport: { width: 900, height: 1000 } });
await page.goto('http://127.0.0.1:4310/.tmp-preview/', { waitUntil: 'networkidle' });
const m = await page.evaluate(() => {
  const px = (e) => (e ? Math.round(parseFloat(getComputedStyle(e).fontSize) * 10) / 10 : null);
  const imgs = [...document.querySelectorAll('.prose__fig img')];
  const tall = imgs.filter((i) => i.naturalHeight > i.naturalWidth);
  return {
    本文のふりがな: px(document.querySelector('.prose p rt')),
    縦長の写真: tall.length + '/' + imgs.length,
    画面での幅: Math.round(tall[Math.floor(tall.length / 2)]?.getBoundingClientRect().width || 0),
  };
});
console.log('画面:', JSON.stringify(m));
const pdf = await page.pdf({ format: 'A4', margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' } });
console.log('刷り上がり:', (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length, 'ページ /', (pdf.length/1024/1024).toFixed(1), 'MB');
await b.close();
