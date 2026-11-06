// 캡처 묶음 -> 결과/ 에 현황판 PNG, 스토리 PNG, 집계 JSON, 요약 글을 만들고 발행
// node tools/make.js [캡처 파일...] [--no-publish]   (파일을 안 주면 좌석스크린샷/ 의 이미지 전부, 다 쓰면 결과/ 로 옮김)
// 인식, 그리기, 발행은 index.html 의 코드를 화면 없는 브라우저에서 그대로 씀
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { execSync } = require('child_process'), { pathToFileURL } = require('url');
const readline = require('readline/promises');

const ROOT = path.join(__dirname, '..'), IN = path.join(ROOT, '좌석스크린샷'), OUT = path.join(ROOT, '결과');
const args = process.argv.slice(2), noPublish = args.includes('--no-publish');
let files = args.filter(a => !a.startsWith('--')), fromIn = !files.length;
if (fromIn) files = fs.existsSync(IN) ? fs.readdirSync(IN).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).map(f => path.join(IN, f)) : [];
if (!files.length) {
  console.log('캡처가 없습니다. 좌석스크린샷 폴더에 넣거나 bat 파일 위로 끌어다 놓으세요.');
  process.exit(1);
}
files.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);  // 찍은 순서 (같은 구역이 여러 장이면 나중 장이 우선)
const win = p => { try { return execSync(`wslpath -w "${p}"`, { encoding: 'utf8' }).trim(); } catch { return p; } };

(async () => {
  // 프로필을 남겨 두어 지난 집계(비교 기준, 바꾼 최대 좌석)와 인식 데이터 캐시가 다음 실행에 이어짐
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, '.profile'), { acceptDownloads: true, timezoneId: 'Asia/Seoul' });
  const page = ctx.pages()[0] || await ctx.newPage();
  // GitHub 요청은 이 통로로 Node 에서 보내고 토큰도 여기서만 붙임 (넓은 권한의 gh 토큰이 외부 스크립트가 도는 페이지에 들어가지 않게)
  let token = '';
  await page.exposeFunction('fcFetch', async (url, { method, headers, body }) => {
    if (!url.startsWith('https://api.github.com/repos/goormigrm/fc-anyang-seats/')) throw new Error('허용되지 않은 주소: ' + url);
    const r = await fetch(url, { method, body, headers: { ...headers, Authorization: 'Bearer ' + token } });
    return { ok: r.ok, status: r.status, text: await r.text() };
  });
  page.on('pageerror', e => console.log('페이지 오류:', e.message));
  await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href + '#edit');  // 입력 화면
  console.log(`캡처 ${files.length}장 인식 중…`);
  await page.setInputFiles('#file', files);
  await page.evaluate(() => window.ocrDone);
  const status = await page.locator('#status').innerText();
  console.log(status);
  if (/못 |실패/.test(status) && !/채웠습니다/.test(status)) throw new Error('인식하지 못했습니다.');

  fs.mkdirSync(OUT, { recursive: true });
  const saved = [];
  for (const id of ['png', 'story', 'saveJson']) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#' + id)]);
    saved.push(path.join(OUT, dl.suggestedFilename()));
    await dl.saveAs(saved.at(-1));
  }
  const base = saved[2].replace(/\.json$/, ''), text = await page.evaluate(() => summaryText());
  fs.writeFileSync(base + '_요약.txt', text + '\n');
  saved.push(base + '_요약.txt');
  console.log(`\n${text}\n\n만든 파일 (${win(OUT)}):\n` + saved.map(f => '  ' + path.basename(f)).join('\n'));

  if (!noPublish) {
    let ok = !status.includes('⚠');
    if (!ok && process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      ok = /^y/i.test(await rl.question('\n경고가 있습니다. 그래도 발행할까요? (y/N) '));
      rl.close();
    }
    try { token = execSync('gh auth token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
    if (!ok) console.log('\n발행하지 않았습니다. 숫자를 고친 뒤 웹 페이지의 "최신 집계 발행"을 쓰세요.');
    else if (!token) console.log('\n발행하지 않았습니다: GitHub 로그인이 없습니다 (gh auth login).');
    else {
      await page.evaluate(() => publish(''));
      console.log('\n발행했습니다: https://raw.githubusercontent.com/goormigrm/fc-anyang-seats/data/latest.json');
    }
  }
  // 쓴 캡처는 결과/<이름>_캡처/ 로 옮김 (다음에 다시 읽지 않게). 발행이 실패해도 다시 돌릴 수 있게 맨 마지막에
  if (fromIn) {
    const dir = base + '_캡처';
    fs.mkdirSync(dir, { recursive: true });
    files.forEach(f => fs.renameSync(f, path.join(dir, path.basename(f))));
  }
  await ctx.close();
})().catch(e => { console.error('\n실패: ' + e.message); process.exit(1); });
