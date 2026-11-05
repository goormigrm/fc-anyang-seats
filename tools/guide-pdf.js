// guide/index.html -> guide/guide.pdf (가이드를 고치면 다시 실행: node tools/guide-pdf.js)
const { chromium } = require('playwright');
const path = require('path'), { pathToFileURL } = require('url');
(async () => {
  const b = await chromium.launch(), p = await b.newPage();
  await p.goto(pathToFileURL(path.join(__dirname, '..', 'guide', 'index.html')).href);
  await p.pdf({ path: path.join(__dirname, '..', 'guide', 'guide.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
  await b.close();
})();
