// 자동 시험 묶음: node tools/test.js [--publish]
// 화면 없는 브라우저로 index.html 을 열어 인식, 글자 입력, 새 경기, 최대 좌석, 보기 화면, 휴대폰 확대를 확인
// --publish: 이 PC 의 gh 로그인으로 시험용 브랜치(data-test)에 실제 발행, 되돌리기, 지우기까지 (끝나면 브랜치 지움)
// 실제 캡처 인식 시험은 좌석스크린샷/시험/ 에 11/1 캡처가 있을 때만 (저장소에는 안 올림)
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path'), { execSync } = require('child_process'), { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..'), URL = pathToFileURL(path.join(ROOT, 'index.html')).href, SHOTS = path.join(ROOT, '좌석스크린샷', '시험');
const H = 'FC안양 vs 제주SK\n안양종합운동장 | 2026.11.28(토) 14:00\n등급 선택\n';
const results = [];
const check = (name, ok, info = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + info}`); };

// 발행 데이터(raw, API)는 기본으로 404, data 를 주면 그 내용으로 응답
async function open(browser, { url = URL + '#edit', data = {}, device, live } = {}) {
  const ctx = await browser.newContext({ ...(device ? devices[device] : { viewport: { width: 1280, height: 900 } }), timezoneId: 'Asia/Seoul' });
  await ctx.route(live ? /raw\.githubusercontent\.com/ : /raw\.githubusercontent\.com|api\.github\.com/, r => {  // live: 발행 시험은 실제 API
    const name = Object.keys(data).find(n => r.request().url().includes(n));
    return name ? r.fulfill({ json: data[name] }) : r.fulfill({ status: 404, body: '' });
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) page.errors.push(m.text()); if (/Assertion failed/.test(m.text())) page.errors.push(m.text()); });
  await page.goto(url);
  return page;
}
const ingest = (page, text) => page.evaluate(t => { fcIngest(t); return { status: document.getElementById('status').innerText, state: JSON.parse(JSON.stringify(state)) }; }, text);

(async () => {
  const b = await chromium.launch();
  let p = await open(b);

  check('자체 시험(parseText) 과 페이지 오류 없음', !p.errors.length, p.errors.join(' / '));

  let r = await ingest(p, H + '퍼스트 스탠딩석\n44 석\nFS1구역\n27 석\n퍼스트석\n0 석\n스탠딩석\n6 석\n일반 지정석(2층)\n1426 석\nVIP석\n20 석\n서포터즈석\n79 석\nR10구역\n26 석\nR11구역\n1 석\nR12구역\n0 석\nR14구역\n52 석');
  const rows = r.state.rows;
  check('PC 글자: 구역, 등급 숫자', rows.FS1.remain === 27 && rows.퍼스트석.remain === 0 && rows.스탠딩석.remain === 6 && rows.일반지정석.remain === 1426 && rows.R10.remain === 26, JSON.stringify(rows.FS1));
  check('빠진 구역 하나는 등급 합계로 (R13 = 79 - 나머지)', rows.R13.remain === 0 && /R13: 등급 합계로 채움/.test(r.status), r.status);
  check('모르는 등급 알림', /현황판에 없는 등급: VIP석 20석/.test(r.status), r.status);
  check('최대 좌석 배우기 (모르던 구역)', rows.일반지정석.max === 1426 && /최대 좌석을 새로 넣음/.test(r.status), r.status);
  check('경기 정보 읽기', r.state.opp === '제주SK' && r.state.date === '2026-11-28T14:00');

  r = await ingest(p, H + '원정석\n1500 석\nR6구역\n137 석');
  check('최대보다 조금 많으면 최대를 늘림, 많이 넘으면 경고', r.state.rows.R6.max === 137 && r.state.rows.원정석.max === 1235 && /⚠ 잔여가 최대보다 많음: 원정석/.test(r.status), r.status);

  r = await p.evaluate(() => { const before = state.rows.R10.remain; fcIngest('FC안양 vs 울산HD\n안양종합운동장 | 2026.12.05(토) 14:00\n예매하기\nS1구역\n6 석'); return { opp: state.opp, R10: state.rows.R10.remain, before }; });
  check('현황판 구역 숫자 없는 화면은 무시 (다른 경기 일정, S1~ 만)', r.opp === '제주SK' && r.R10 === r.before, JSON.stringify(r));
  r = await p.evaluate(() => { const before = state.rows.일반지정석.remain; fcIngest('울산HD vs FC안양\n울산문수축구경기장 | 2026.12.12(토) 14:00\n등급 선택\n지정석 S\n1200 석'); return { st: document.getElementById('status').innerText, v: state.rows.일반지정석.remain, before }; });
  check('원정 경기 화면은 무시 (안양종합운동장 아님)', r.v === r.before && /안양종합운동장 경기 화면이 아니라/.test(r.st), JSON.stringify(r));

  r = await p.evaluate(() => { state.at = '2026-11-27T09:00'; fcIngest('FC안양 vs 제주SK\n안양종합운동장 | 2026.11.28(토) 14:00\nR10구역\n20 석'); return { base: state.base?.rows?.R10, at: state.at }; });
  check('같은 경기 새 집계는 직전 숫자를 비교 기준으로', r.base === 26, JSON.stringify(r));

  r = await ingest(p, 'FC안양 vs 울산HD\n안양종합운동장 | 2026.12.05(토) 14:00\n등급 선택\nR10구역\n100 석');
  check('다른 경기는 새 경기로 (지난 숫자, 원정석 최대 되돌림, ⚠)', r.state.opp === '울산HD' && r.state.rows.일반지정석.remain === null && r.state.rows.원정석.max === 1235 && /⚠ 다른 경기라/.test(r.status), r.status);
  r = await p.evaluate(() => { window.confirm = () => true; document.getElementById('restore').click(); return { opp: state.opp, v: state.rows.일반지정석.remain, hidden: document.getElementById('restore').hidden }; });
  check('지난 경기 숫자 되살리기', r.opp === '제주SK' && r.v === 1426 && r.hidden, JSON.stringify(r));
  r = await p.evaluate(() => { document.getElementById('autoPub').checked = true; newGame(); fcIngest('FC안양 vs 제주SK\n안양종합운동장 | 2026.11.28(토) 14:00\n등급 선택\n일반 지정석(2층)\n1400 석'); return document.getElementById('note').innerText; });
  check('정보 없는 구역이 많으면 자동 발행 기다림', /자동 발행을 기다립니다/.test(r), r);
  r = await p.evaluate(() => { const b = state.rows.일반지정석; fcIngest('FC안양 vs 제주SK\n안양종합운동장 | 2026.11.28(토) 14:00\n등급 선택\n일반 지정석(2층)\n1600 석'); return { max: b.max, learned: b.learned, guess: document.querySelector('tr[data-id="일반지정석"] [data-k=max]').classList.contains('guess') }; });
  check('배운 최대 좌석은 추정 표시, 더 큰 잔여면 늘림', r.max === 1600 && r.learned && r.guess, JSON.stringify(r));
  await ingest(p, 'FC안양 vs 울산HD\n안양종합운동장 | 2026.12.05(토) 14:00\n등급 선택\nR10구역\n100 석');

  r = await p.evaluate(() => {  // 추이: 같은 경기 10분 안 점은 하나로
    history = [['2026-12-04T10:00', 3000], ['2026-12-04T12:00', 3500], ['2026-12-04T12:05', 3600]].map(([at, booked]) => ({ at: at + ':00+09:00', opponent: '울산HD', kickoff: '2026-12-05T14:00:00+09:00', booked, unknown: 0 }));
    state.at = '2026-12-04T12:08'; return trendPoints().map(t => t.at.slice(11));
  });
  check('추이: 10분 안 점은 지금 숫자 하나로', r.join() === '10:00,12:08', r.join());

  await p.context().close();

  // 보기 화면: 발행본을 그리고 이 기기 입력값은 그대로
  const pub = { app: 'fc-anyang-seats', version: 1, updatedAt: '2026-11-27T12:00:00+09:00', match: { opponent: '제주SK', kickoff: '2026-11-28T14:00:00+09:00' },
    sections: [{ id: '원정석', remain: 980, max: 1235, sold: 20 }, { id: 'R10', remain: 0, max: 126, sold: 0 }], sinceBase: { at: '2026-11-26T12:00:00+09:00', booked: 20 } };
  p = await open(b, { url: URL, data: { 'latest.json': pub, 'history.json': [] } });
  await p.waitForFunction(() => document.getElementById('board').innerHTML.includes('제주SK'));
  r = await p.evaluate(() => ({ panel: getComputedStyle(document.querySelector('.panel')).display, svg: document.getElementById('board').innerHTML, note: document.getElementById('note').innerText }));
  check('보기 화면: 발행본 그림, 입력 칸 숨김, 경과 시간', r.panel === 'none' && r.svg.includes('980/1235') && r.svg.includes('+20') && /마지막 집계/.test(r.note), r.note);
  await p.context().close();

  p = await open(b, { url: URL });
  await p.waitForFunction(() => /없습니다|못했습니다/.test(document.getElementById('note').innerText));
  check('보기 화면: 발행 없으면 안내', /아직 발행된 집계가 없습니다/.test(await p.locator('#note').innerText()));
  await p.context().close();

  // 휴대폰: 경기장만 키움
  p = await open(b, { url: URL, device: 'iPhone 13' });
  r = await p.evaluate(() => { const top = () => document.querySelector('.share').getBoundingClientRect().top + scrollY, a = top(), w = document.getElementById('stadiumWrap'); w.click(); return { a, b: top(), zoom: w.classList.contains('zoom'), wide: document.documentElement.scrollWidth <= document.documentElement.clientWidth }; });
  check('휴대폰: 경기장만 확대, 버튼 위치 그대로, 가로 넘침 없음', r.zoom && Math.abs(r.a - r.b) < 2 && r.wide, JSON.stringify(r));
  await p.context().close();

  // 실제 캡처 인식 (11/1 부천전)
  if (fs.existsSync(SHOTS)) {
    p = await open(b);
    await p.setInputFiles('#file', fs.readdirSync(SHOTS).sort().map(f => path.join(SHOTS, f)));
    await p.evaluate(() => window.ocrDone);
    r = await p.evaluate(() => JSON.parse(JSON.stringify(state)));
    const x = r.rows, want = { R10: 26, R11: 1, R12: 0, R14: 52, P: 204, T4: 58, T3: 30, 일반지정석: 1426, 스탠딩석: 18 };
    const bad = Object.entries(want).filter(([k, v]) => x[k].remain !== v).map(([k, v]) => `${k} ${x[k].remain}(기대 ${v})`);
    check('실제 캡처 5장 인식 (11/1 부천전)', !bad.length && r.opp === '부천FC1995', bad.join(', ') + ' / ' + r.opp);
    await p.context().close();
  } else console.log('SKIP  실제 캡처 인식 (좌석스크린샷/시험 없음)');

  // 실제 발행 (시험용 브랜치)
  if (process.argv.includes('--publish')) {
    const token = execSync('gh auth token', { encoding: 'utf8' }).trim(), B = 'data-test', raw = f => { try { return JSON.parse(execSync(`gh api "repos/goormigrm/fc-anyang-seats/contents/${f}?ref=${B}" -H "Accept: application/vnd.github.raw+json"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return null; } };
    p = await open(b, { live: true });
    for (const [at, v] of [['2026-11-26T12:30', 6000], ['2026-11-26T12:35', 5900], ['2026-11-27T12:00', 5000]])
      await p.evaluate(([at, v, t, B]) => { fcIngest('FC안양 vs 제주SK\n안양종합운동장 | 2026.11.28(토) 14:00\n일반지정석(2층)\n' + v + ' 석'); state.at = at; return publish(t, B); }, [at, v, token, B]);
    let h = raw('history.json');
    check('발행: 10분 안 발행은 점 하나 (3번 발행 -> 2점)', h?.map(x => x.at.slice(11, 16)).join() === '12:35,12:00', JSON.stringify(h));
    const msg = await p.evaluate(([t, B]) => unpublish(t, false, B), [token, B]);
    h = raw('history.json');
    check('마지막 발행 지우기 -> 그 전 발행과 그때 추이', raw('latest.json')?.updatedAt.startsWith('2026-11-26T12:35') && h?.length === 1 && /되돌렸습니다/.test(msg), msg + JSON.stringify(h));
    await p.evaluate(([t, B]) => { fcIngest('FC안양 vs 울산HD\n안양종합운동장 | 2026.12.05(토) 14:00\n일반지정석(2층)\n3000 석'); state.at = '2026-12-04T10:00'; return publish(t, B); }, [token, B]);
    const tree = execSync(`gh api "repos/goormigrm/fc-anyang-seats/git/trees/${B}?recursive=1" --jq "[.tree[].path]|join(\\",\\")"`, { encoding: 'utf8' });
    check('경기가 바뀌면 지난 경기를 games/ 에 보관', /games\/2026-11-28_제주SK\.json/.test(tree), tree);
    await p.evaluate(([t, B]) => unpublish(t, true, B), [token, B]);
    h = raw('history.json');
    check('발행 모두 지우기: 이번 경기만 지우고 보관과 다른 경기 추이는 남김', raw('latest.json') === null && raw('games/2026-11-28_제주SK.json')?.match.opponent === '제주SK' && h?.every(x => x.opponent === '제주SK'), JSON.stringify(h));
    try { execSync(`gh api -X DELETE repos/goormigrm/fc-anyang-seats/git/refs/heads/${B}`, { stdio: 'ignore' }); } catch {}
    await p.context().close();
  }

  await b.close();
  const fail = results.filter(x => !x).length;
  console.log(`\n${results.length - fail}/${results.length} 통과`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('시험 실행 실패:', e.message); process.exit(1); });
