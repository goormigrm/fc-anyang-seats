// 자동 시험 묶음: node tools/test.js [--publish]
// 화면 없는 브라우저로 index.html 을 열어 인식, 글자 입력, 새 경기, 최대 좌석, 보기 화면, 휴대폰 확대를 확인
// --publish: 이 PC 의 gh 로그인으로 시험용 브랜치(data-test)에 실제 발행, 되돌리기, 지우기까지 (끝나면 브랜치 지움)
// 실제 캡처 인식 시험은 좌석스크린샷/시험/ 에 11/1 캡처가 있을 때만 (저장소에는 안 올림)
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path'), { execSync } = require('child_process'), { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..'), URL = pathToFileURL(path.join(ROOT, 'index.html')).href, SHOTS = path.join(ROOT, '좌석스크린샷', '시험');
const SV = +fs.readFileSync(path.join(ROOT, 'fc-anyang-send.user.js'), 'utf8').match(/@version\s+(\d+)/)[1];  // 보내기 스크립트 최신 판 (판을 올려도 시험을 안 고치게)
const H = 'FC안양 vs 제주SK\n안양종합운동장 | 2026.11.28(토) 14:00\n등급 선택\n';
const results = [];
let lastCheck = Date.now();
const check = (name, ok, info = '') => { lastCheck = Date.now(); results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + info}`); };
// 3분 넘게 다음 항목으로 못 넘어가면 끝냄 (11/12: 글자 인식 도구를 받다가 멈춰 푸시 전 시험이 끝나지 않은 적이 있음)
setInterval(() => { if (Date.now() - lastCheck > 180e3) { console.error('시험 실행 실패: 3분 넘게 멈춰 있어 끝냅니다. 다시 돌리세요.'); process.exit(1); } }, 10e3).unref();
// 글자 인식 도구(jsdelivr, 인식 한 번에 약 10MB)는 처음 한 번만 받아 다시 씀: 시험마다 새 브라우저 창이라 그대로 두면 한 번 돌릴 때 수백 MB 를 받고, 받다가 멈추면 시험도 멈춤
const cdn = new Map();
const cached = async r => {
  const u = r.request().url();
  if (!cdn.has(u)) cdn.set(u, r.fetch({ timeout: 60e3 }).then(async x => {
    const headers = { ...x.headers() }; ['content-encoding', 'content-length', 'transfer-encoding'].forEach(h => delete headers[h]);  // 본문은 풀린 채로 주므로
    return { status: x.status(), headers, body: await x.body() };
  }));
  try { await r.fulfill(await cdn.get(u)); } catch { cdn.delete(u); await r.abort().catch(() => {}); }
};

// 발행 데이터(raw, API)는 기본으로 404, data 를 주면 그 내용으로 응답
async function open(browser, { url = URL + '#edit', data = {}, device, live } = {}) {
  const ctx = await browser.newContext({ ...(device ? devices[device] : { viewport: { width: 1280, height: 900 } }), timezoneId: 'Asia/Seoul' });
  await ctx.route(live ? /raw\.githubusercontent\.com/ : /raw\.githubusercontent\.com|api\.github\.com/, r => {  // live: 발행 시험은 실제 API
    const name = Object.keys(data).find(n => r.request().url().includes(n));
    return name ? r.fulfill({ json: data[name] }) : r.fulfill({ status: 404, body: '' });
  });
  await ctx.route(/cdn\.jsdelivr\.net/, cached);
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

  // 총석을 모르는 구역에서 처음 본 잔여로 최대를 배움: 11/25 부터 안양 홈은 모든 구역 총석이 있어 일반지정석 총석을 지우고 시험
  await p.evaluate(() => { delete KNOWN_MAX.일반지정석; state.rows.일반지정석.max = null; });
  let r = await ingest(p, H + '퍼스트 스탠딩석\n44 석\nFS1구역\n27 석\n퍼스트석\n0 석\n스탠딩석\n6 석\n일반 지정석(2층)\n1426 석\nVIP석\n20 석\n서포터즈석\n79 석\nR10구역\n26 석\nR11구역\n1 석\nR12구역\n0 석\nR14구역\n52 석');
  const rows = r.state.rows;
  check('PC 글자: 구역, 등급 숫자', rows.FS1.remain === 27 && ['F1', 'F4', 'F7'].every(id => rows[id].remain === 0) && rows.일반지정석.remain === 1426 && rows.R10.remain === 26, JSON.stringify(rows.FS1));
  check('빠진 구역 하나는 등급 합계로 (R13 = 79 - 나머지)', rows.R13.remain === 0 && /R13: 등급 합계로 채움/.test(r.status), r.status);
  check('모르는 등급 알림', /현황판에 없는 등급: VIP석 20석/.test(r.status), r.status);
  check('최대 좌석 배우기 (모르던 구역)', rows.일반지정석.max === 1426 && /최대 좌석을 새로 넣음/.test(r.status), r.status);
  check('경기 정보 읽기', r.state.opp === '제주SK' && r.state.date === '2026-11-28T14:00');

  r = await ingest(p, H + '원정석\n1800 석\nR6구역\n137 석');
  check('최대보다 조금 많으면 최대를 늘림, 많이 넘으면 경고', r.state.rows.R6.max === 137 && r.state.rows.원정석.max === 1500 && /⚠ 잔여가 최대보다 많음: 원정석/.test(r.status), r.status);

  r = await p.evaluate(() => { const before = state.rows.R10.remain; fcIngest('FC안양 vs 울산HD\n안양종합운동장 | 2026.12.05(토) 14:00\n예매하기\nS9구역\n6 석'); return { opp: state.opp, R10: state.rows.R10.remain, before }; });
  check('현황판 구역 숫자 없는 화면은 무시 (다른 경기 일정, 현황판에 없는 S9 만)', r.opp === '제주SK' && r.R10 === r.before, JSON.stringify(r));
  r = await p.evaluate(() => { const before = state.rows.일반지정석.remain; fcIngest('울산HD vs FC안양\n울산문수축구경기장 | 2026.12.12(토) 14:00\n등급 선택\n지정석 S\n1200 석'); return { st: document.getElementById('status').innerText, v: state.rows.일반지정석.remain, before }; });
  check('원정 경기 화면은 무시 (안양종합운동장 아님)', r.v === r.before && /'안양종합운동장'가 없어 넘겼습니다/.test(r.st), JSON.stringify(r));

  // 비교 기준('○○ 이후 +N석')은 마지막으로 발행한 숫자 (11/18 사용자: 그 경기 첫 발행인데 앞 캡처 기준 '이후 N석'이 나옴)
  r = await p.evaluate(() => { const H = 'FC안양 vs 제주SK\n안양종합운동장 | 2026.11.28(토) 14:00\nR10구역\n', o = [];
    Object.assign(state, { at: '2026-11-27T08:00', base: null, pubAt: null, pubSnap: null }); fcIngest(H + '22 석'); o.push(state.base?.rows?.R10 ?? '', /이후/.test(summaryText()));
    Object.assign(state, { at: '2026-11-27T09:00', pubAt: '2026-11-27T09:00' }); state.pubSnap = snap(); fcIngest(H + '20 석'); o.push(state.base?.rows?.R10, /11\.27 09:00 이후 \+2석/.test(summaryText())); return o.join(); });
  check('같은 경기 새 집계: 발행 안 한 앞 캡처는 비교 기준이 아님, 발행한 숫자 다음 캡처는 그 숫자(22)가 기준', r === ',false,22,true', r);

  r = await ingest(p, 'FC안양 vs 울산HD\n안양종합운동장 | 2026.12.05(토) 14:00\n등급 선택\nR10구역\n100 석');
  check('다른 경기는 새 경기로 (지난 숫자, 원정석 최대 되돌림, ⚠)', r.state.opp === '울산HD' && r.state.rows.일반지정석.remain === null && r.state.rows.원정석.max === 1500 && /⚠ 다른 경기라/.test(r.status), r.status);
  r = await p.evaluate(() => { window.confirm = () => true; document.getElementById('restore').click(); return { opp: state.opp, v: state.rows.일반지정석.remain, hidden: document.getElementById('restore').hidden }; });
  check('지난 경기 숫자 되살리기', r.opp === '제주SK' && r.v === 1426 && r.hidden, JSON.stringify(r));
  r = await p.evaluate(() => { newGame(); fcIngest('FC안양 vs 제주SK\n안양종합운동장 | 2026.11.28(토) 14:00\n등급 선택\n일반 지정석(2층)\n1400 석'); return document.getElementById('pubNote').innerText + '|' + !!document.getElementById('autoPub'); });
  check('숫자가 들어와도 저절로 발행하지 않고 발행하라고 알림 (바로 발행 없음)', /발행하지 않은 숫자가 있습니다.*현황 발행/.test(r) && r.endsWith('|false'), r);
  r = await p.evaluate(() => { const b = state.rows.일반지정석; fcIngest('FC안양 vs 제주SK\n안양종합운동장 | 2026.11.28(토) 14:00\n등급 선택\n일반 지정석(2층)\n1600 석'); return { max: b.max, learned: b.learned, guess: document.querySelector('tr[data-id="일반지정석"] [data-k=max]').classList.contains('guess') }; });
  check('배운 최대 좌석은 추정 표시, 더 큰 잔여면 늘림', r.max === 1600 && r.learned && r.guess, JSON.stringify(r));
  await ingest(p, 'FC안양 vs 울산HD\n안양종합운동장 | 2026.12.05(토) 14:00\n등급 선택\nR10구역\n100 석');

  r = await p.evaluate(() => {  // 추이: 같은 경기 10분 안 점은 하나로
    history = [['2026-12-04T10:00', 3000], ['2026-12-04T12:00', 3500], ['2026-12-04T12:05', 3600]].map(([at, booked]) => ({ at: at + ':00+09:00', opponent: '울산HD', kickoff: '2026-12-05T14:00:00+09:00', booked, unknown: 0 }));
    state.at = '2026-12-04T12:08'; return trendPoints().map(t => t.at.slice(11));
  });
  check('추이: 10분 안 점은 지금 숫자 하나로', r.join() === '10:00,12:08', r.join());

  // 지난 경기와 같은 시점 비교: 앞 경기(부천전)의 추이 점 중 경기 시작까지 남은 시간이 지금(48시간)과 같거나 더 남았던 마지막 점(52.5시간 전: 홈석 3,350, 원정석 150)
  {
    const pg = await open(b);
    r = await pg.evaluate(() => {
      newGame(); Object.assign(state, { opp: '제주SK', date: '2026-11-28T14:00', at: '2026-11-26T14:00' }); state.rows.R10.remain = 26; state.rows.원정석.remain = 1000; state.rows.원정석.max = 1235;  /* 원정석 총석을 정해 둠 (평소 값 11/25 1235 -> 1500) */
      const pt = (at, booked, ab) => ({ at: at + ':00+09:00', opponent: '부천FC1995', kickoff: '2026-11-01T16:30:00+09:00', booked, cap: 11542, awayBooked: ab, awayCap: 1235, unknown: 0 });
      history = [pt('2026-10-29T10:00', 3000, 100), pt('2026-10-30T12:00', 3500, 150), pt('2026-10-31T16:00', 5000, 300)]; render();
      const out = { a: document.getElementById('trend').textContent, hid: getComputedStyle(document.getElementById('restore')).display };
      history = history.slice(2); render(); out.none = document.getElementById('trend').textContent;  // 같은 시점보다 늦은 점만 있으면 안 보임
      return out;
    });
    check('추이: 지난 경기 같은 시점 비교 (홈석 3,350 대비 +5,907, 원정석 150 대비 +85), 자료 없으면 안 보임', /부천FC1995전 같은 시점 3,350석 대비 \+5,907/.test(r.a) && /부천FC1995전 같은 시점 150석 대비 \+85/.test(r.a) && !/같은 시점/.test(r.none), r.a);
    check('숨긴 버튼(지난 경기 숫자 되살리기)은 화면에 안 보임', r.hid === 'none', r.hid);
    // 구역을 누르면 자세히, 구역이 아닌 곳을 누르면 닫힘
    // 도형 안의 한 점 (둥근 띠 모양 칸은 테두리 상자 가운데가 칸 밖일 수 있어 상자 안을 훑음)
    const at = sel => pg.evaluate(sel => { const el = document.querySelector(sel), r = el.getBoundingClientRect();
      for (const fy of [0.5, 0.3, 0.7, 0.1, 0.9]) for (const fx of [0.5, 0.3, 0.7, 0.1, 0.9]) { const x = r.x + r.width * fx, y = r.y + r.height * fy; if (document.elementsFromPoint(x, y).includes(el)) return [x, y]; } }, sel);
    const tip = () => pg.evaluate(() => document.getElementById('tip').hidden ? '' : document.getElementById('tip').textContent);
    await pg.evaluate(() => scrollTo(0, 0));
    await pg.mouse.click(...await at('#board [data-z="R10"]')); const t1 = await tip();
    await pg.mouse.click(...await at('#board [data-z="원정석"]')); const t2 = await tip();
    await pg.mouse.click(...await at('#board [data-z="R15"]')); const t3 = await tip();
    await pg.mouse.click(...await at('#board rect[fill="url(#grass)"]')); const t4 = await tip();
    check('구역 누르면 자세히: 남은 / 총 / 예매율, 정보 없음, 잔디를 누르면 닫힘', t1 === 'R10 · 잔여 26석 / 총 126석 · 예매율 79%' && t2 === '원정석 · 잔여 1,000석 / 총 1,235석 · 예매율 19%' && t3 === 'R15 · 정보 없음 · 총 141석' && t4 === '', JSON.stringify([t1, t2, t3, t4]));
    await pg.context().close();
  }
  // 공식 관중: 기록, 요약 글, 추이의 관중 점
  r = await p.evaluate(() => { history = []; document.getElementById('crowd').value = '4464'; document.getElementById('crowd').dispatchEvent(new Event('input')); return { att: record().match.attendance, sum: summaryText(), chart: document.getElementById('trend').innerHTML.includes('공식 관중') }; });
  check('공식 관중: 기록, 요약 글, 추이 점', r.att === 4464 && /공식 관중 4,464명/.test(r.sum) && r.chart, JSON.stringify(r).slice(0, 200));
  // 구역 숫자 없이 발행(다른 브라우저에서 공식 관중만 넣음): 예매는 모름(null, 만석으로 올리지 않음). 다른 경기면 발행 안 함, 같은 경기 발행본이 있으면 묻고 그 구역 숫자를 불러와 공식 관중만 바꿈
  {
    const pubHome = { app: 'fc-anyang-seats', version: 1, updatedAt: '2026-11-01T16:30:00+09:00', match: { opponent: '부천FC1995', kickoff: '2026-11-01T16:30:00+09:00', attendance: null },
      sections: [{ id: 'R10', remain: 0, max: 126 }, { id: '일반지정석', remain: 1000, max: null }] };
    const pg = await open(b, { data: { 'latest.json': pubHome } });
    pg.on('dialog', d => d.type() === 'confirm' ? d.accept() : d.dismiss());
    await pg.waitForTimeout(800);  // 입력 화면은 열 때 숫자 없는 브라우저면 발행본을 불러옴(11/18): 그 뒤에 '다른 브라우저에서 공식 관중만 넣은' 상태를 만듦
    r = await pg.evaluate(async () => {
      SECTIONS.forEach(s => state.rows[s.id].remain = null); Object.assign(state, { opp: '제주SK', date: '2026-11-01T16:30', at: '2026-11-04T21:08' }); syncInputs();
      [['crowd', '4464'], ['crowdAway', '555']].forEach(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')); });
      const before = [record().booked, record().available];
      await publishNow(); const other = [document.getElementById('pubNote').textContent, state.rows.R10.remain];
      state.opp = '부천FC1995'; syncInputs(); await publishNow();
      return { before, other, R10: state.rows.R10.remain, gen: state.rows.일반지정석.remain, crowd: [state.crowd, state.crowdAway].join(), at: state.at, booked: record().booked };
    });
    await pg.context().close();
    check('구역 숫자 없이 발행: 예매 null, 다른 경기면 안 함, 같은 경기면 발행본 구역 숫자를 불러와 공식 관중만 바꿈',
      r.before.join() === ',' && /구역 숫자가 없어 발행하지 않았습니다/.test(r.other[0]) && r.other[1] === null && r.R10 === 0 && r.gen === 1000 && r.crowd === '4464,555' && r.at === '2026-11-01T16:30' && r.booked > 0, JSON.stringify(r));
  }
  // 추이 이미지
  r = await p.evaluate(async () => { const bl = await pngBlob('trend'), im = await createImageBitmap(bl); return [im.width, im.height, bl.size]; });
  check('추이 이미지 (1080x1920)', r[0] === 1080 && r[1] === 1920 && r[2] > 20000, r.join());
  // 현황판 저장: 추이 점이 있으면 가로판 아래에 예매 추이를 붙인 한 장(2560x2724), 없으면 가로판만(2560x2124). 발행 그림은 가로판만
  // PC 에서 추이 이미지, 스토리로 공유는 공유 창 대신 파일로 (공유 창이 있어도 PC 는 저장할 곳이 없음)
  {
    const pg = await open(b);
    await pg.waitForTimeout(300);
    r = await pg.evaluate(async () => {
      const size = async k => { const im = await createImageBitmap(await pngBlob(k)); return im.width + 'x' + im.height; };
      newGame(); Object.assign(state, { opp: '제주SK', date: '2026-11-28T14:00', at: '2026-11-26T14:00' }); history = [];
      const none = await size('full'); state.rows.R10.remain = 26;  // 숫자도 기록도 없으면 추이 없음
      history = [{ at: '2026-11-25T10:00:00+09:00', opponent: '제주SK', kickoff: '2026-11-28T14:00:00+09:00', booked: 6000, cap: 11542, awayBooked: 100, awayCap: 1235, unknown: 0 }];
      window.__shared = 0; navigator.share = async () => { __shared++; }; navigator.canShare = () => true;
      return { none, full: await size('full'), board: await size(false), shareBtn: document.getElementById('share').hidden };
    });
    const dl = [];
    pg.on('download', d => dl.push(d.suggestedFilename()));
    await pg.click('#trendImg'); await pg.click('#png'); await pg.waitForTimeout(1500);
    const shared = await pg.evaluate(() => __shared);
    await pg.context().close();
    check('현황판 저장에 예매 추이도(추이 점 있으면 2560x2724, 없으면 2560x2124, 발행 그림은 2560x2124), PC 는 추이 이미지를 파일로 저장(공유 창 안 띄움), 스토리로 공유 버튼 숨김',
      r.none === '2560x2124' && r.full === '2560x2724' && r.board === '2560x2124' && r.shareBtn === true && shared === 0 && dl.some(n => n.endsWith('_추이.png')) && dl.some(n => /_집계\d+\.png$/.test(n)), JSON.stringify({ r, shared, dl }));
  }
  // 토큰 잠금: 잠그고 풀기, 탭 동안 기억
  r = await p.evaluate(async () => { const v = await lockToken('ghp_test123', '0000'); localStorage.setItem(TOKEN, v); sessionStorage.removeItem(TOKEN); const no = await getToken(false); const ok = await unlockToken(v, '0000'); let bad = ''; try { await unlockToken(v, '1111'); bad = 'opened'; } catch { bad = 'refused'; } sessionStorage.setItem(TOKEN, ok); const again = await getToken(false); localStorage.removeItem(TOKEN); sessionStorage.removeItem(TOKEN); return { enc: v.startsWith('enc:') && !v.includes('ghp_test123'), no, ok, bad, again }; });
  check('토큰 잠금 (비밀번호, 틀리면 안 열림, 탭 동안 기억)', r.enc && r.no === '' && r.ok === 'ghp_test123' && r.bad === 'refused' && r.again === 'ghp_test123', JSON.stringify(r));
  r = await p.evaluate(() => { localStorage.setItem(TOKEN, 'x'); localStorage.setItem('fc-anyang-token-exp', new Date(Date.now() + 10 * 86400e3).toISOString().slice(0, 10)); tokenInfo(); const n = document.getElementById('note').innerText, h = document.getElementById('tokenHint').textContent; localStorage.removeItem(TOKEN); localStorage.removeItem('fc-anyang-token-exp'); return { n, h }; });
  check('토큰 만료 30일 전 알림', /만료가 1?\d일 남았습니다/.test(r.n) && /만료 \d{4}-/.test(r.h), JSON.stringify(r));
  await p.context().close();

  // 다른 사이트용 화면 (?embed): 다른 페이지 안(iframe)에서는 현황판만, 링크로 바로 열면 보통 보기 화면
  const WRAP = path.join(require('os').tmpdir(), 'fc-embed-wrap.html');
  const wrap = src => { fs.writeFileSync(WRAP, `<body style="margin:0"><iframe src="${src}" style="width:390px;aspect-ratio:1280/1062;border:0"></iframe></body>`); return pathToFileURL(WRAP).href; };
  const inner = async pg => { await pg.waitForTimeout(1500); return pg.mainFrame().childFrames()[0]; };
  p = await open(b, { url: wrap(URL + '?embed') });
  r = await (await inner(p)).evaluate(() => ['.share', '.panel', '#trend', '.foot'].map(q => getComputedStyle(document.querySelector(q)).display).join() + '|' + document.body.classList.contains('editing'));
  check('다른 사이트용 화면(iframe 안): 현황판만', r === 'none,none,none,none|false', r);
  await p.context().close();
  p = await open(b, { url: URL + '?embed', device: 'iPhone 13' });
  await p.waitForTimeout(1000);
  r = await p.evaluate(() => [document.body.classList.contains('embed'), getComputedStyle(document.querySelector('.share')).display, getComputedStyle(document.getElementById('trend')).display, document.getElementById('board').getAttribute('viewBox'), getComputedStyle(document.getElementById('stadiumWrap')).display].join('|'));
  check('?embed 를 링크로 바로 열면(휴대폰 새 창) 보통 보기 화면: 세로판, 공유, 추이', r === 'false|block|block|0 140 1080 600|block', r);
  await p.context().close();

  // 경기별 기록 화면
  const game = (opp, kick, booked, crowd) => ({ app: 'fc-anyang-seats', updatedAt: kick.slice(0, 10) + 'T12:00:00+09:00', match: { opponent: opp, kickoff: kick, attendance: crowd }, capacity: 11542, booked, soldOut: ['R10'], unknown: [] });
  const sctx = await b.newContext();
  // 원정은 구장 폴더(gimcheon/latest.json), prev/ 는 되돌리기용이라 빠져야 함
  const gc = { ...game('김천상무', '2026-11-07T16:30:00+09:00', 1530, 1125), capacity: 5844, awayBooked: 423 };
  Object.assign(gc.match, { home: '김천상무', away: 'FC안양', awayAttendance: 290 });
  await sctx.route(/api\.github\.com/, r => r.fulfill({ json: { tree: ['games/2026-11-01_부천FC1995.json', 'latest.json', 'prev/latest.json', 'gimcheon/latest.json', 'gimcheon/prev/latest.json', 'gimcheon/history.json'].map(path => ({ path, type: 'blob' })) } }));
  await sctx.route(/raw\.githubusercontent\.com/, r => { const u = r.request().url();
    return r.fulfill({ json: u.includes('prev/') ? game('되돌리기용', '2026-10-01T14:00:00+09:00', 1, null) : u.includes('gimcheon/') ? gc : u.includes('games/') ? game('부천FC1995', '2026-11-01T16:30:00+09:00', 4500, 4464) : game('제주SK', '2027-11-28T14:00:00+09:00', 6931, null) }); });
  p = await sctx.newPage();
  await p.goto(pathToFileURL(path.join(ROOT, 'season.html')).href);
  await p.waitForFunction(() => document.querySelectorAll('#rows tr').length > 0);
  r = await p.evaluate(() => [...document.querySelectorAll('#rows tr')].map(tr => tr.innerText.replace(/\s+/g, ' ')).join(' / '));
  check('경기별 기록: 보관 경기 + 지금 경기 + 원정 경기(구장 폴더, 원정석 예매, 원정 관중), prev 는 뺌, 지난 경기는 (지금) 아님',
    /부천FC1995 4,500석.*4,464명.*-36/.test(r) && /제주SK 6,931석/.test(r) && /11\.07\(토\) 16:30 김천상무 \(원정\) 1,530석 \(26\.2%\) · 원정석 423 1,125명 \(원정 290\) -405/.test(r) && !/되돌리기용/.test(r) && /\(지금\) 제주SK/.test(r) && !/16:30 \(지금\)/.test(r), r);
  // 홈경기만 보기 / 원정 포함 보기 (#home), 오른쪽 위 현황판으로 버튼
  const rowsTxt = () => p.evaluate(() => [...document.querySelectorAll('#rows tr')].map(tr => tr.innerText.replace(/\s+/g, ' ')).join(' / ') + ' | ' + document.getElementById('chart').textContent);
  await p.click('#fHome'); const rh = await rowsTxt(), hash = await p.evaluate(() => location.hash);
  await p.click('#fAll'); const ra = await rowsTxt();
  const go = await p.evaluate(() => (a => a && getComputedStyle(a).marginLeft !== '0px' && a.getAttribute('href'))(document.querySelector('header .go')));
  check('경기별 기록: 홈경기만 보기(#home, 김천 원정 빠짐) / 원정 포함 보기, 오른쪽 위 현황판으로', !/김천/.test(rh) && /부천FC1995/.test(rh) && hash === '#home' && /김천상무 \(원정\)/.test(ra) && /김천상무 원정/.test(ra) && go === './', JSON.stringify({ rh, ra, hash, go }));
  // 표는 최근 경기부터, 홈 평균 관중과 평균 예매율, 예상 관중(지난 홈 3경기의 관중 합 11,500 / 예매 합 15,000 = 0.77 을 지금 예매 6,931 에 곱함)
  {
    const fx = await b.newContext(), past = [['부천FC1995', '2026-11-01T16:30:00+09:00', 4000, 3000], ['전북현대', '2026-10-24T14:00:00+09:00', 6000, 4500], ['대전하나시티즌', '2026-10-03T14:00:00+09:00', 5000, 4000]];
    await fx.route(/api\.github\.com/, r => r.fulfill({ json: { tree: [...past.map(g => `games/${g[1].slice(0, 10)}_x.json`), 'latest.json'].map(path => ({ path, type: 'blob' })) } }));
    await fx.route(/raw\.githubusercontent\.com/, r => { const g = past.find(g => r.request().url().includes('games/' + g[1].slice(0, 10))); return r.fulfill({ json: g ? game(...g) : game('제주SK', '2027-11-28T14:00:00+09:00', 6931, null) }); });
    const sp = await fx.newPage();
    await sp.goto(pathToFileURL(path.join(ROOT, 'season.html')).href);
    await sp.waitForFunction(() => document.querySelectorAll('#rows tr').length > 0);
    r = await sp.evaluate(() => ({ rows: [...document.querySelectorAll('#rows tr')].map(tr => tr.cells[1].innerText + ':' + tr.cells[3].innerText).join(' / '), avg: document.getElementById('avg').innerText, msg: document.getElementById('msg').innerText, bars: document.getElementById('chart').textContent }));
    await fx.close();
    check('경기별 기록: 최근 경기가 맨 위(그래프는 옛 경기부터), 홈 평균 관중과 예매율, 지금 경기 예상 관중', r.rows === '제주SK:예상 약 5,314명 / 부천FC1995:3,000명 / 전북현대:4,500명 / 대전하나시티즌:4,000명' && r.avg === '홈 3경기 평균 관중 3,833명 · 홈 3경기 평균 예매율 43.3%'
      && /예상 관중 = 지금 예매 × 지난 홈 3경기의 관중 \/ 예매 비율\(0\.77\)/.test(r.msg) && r.bars.indexOf('대전') < r.bars.indexOf('제주'), JSON.stringify(r));
  }
  // 목록(GitHub API)을 못 받으면 지금 경기만 보이므로 알림
  {
    const fctx = await b.newContext();
    await fctx.route(/api\.github\.com/, r => r.fulfill({ status: 403, body: '' }));
    await fctx.route(/raw\.githubusercontent\.com/, r => r.fulfill({ json: game('제주SK', '2027-11-28T14:00:00+09:00', 6931, null) }));
    const fp = await fctx.newPage(); await fp.goto(pathToFileURL(path.join(ROOT, 'season.html')).href);
    await fp.waitForFunction(() => document.querySelectorAll('#rows tr').length > 0);
    r = await fp.evaluate(() => document.getElementById('msg').textContent + ' | ' + document.querySelectorAll('#rows tr').length);
    check('경기별 기록: 목록을 못 받으면 알림 (지금 경기만)', /기록 목록을 받지 못해 지금 경기만 보입니다/.test(r) && r.endsWith('| 1'), r);
    await fctx.close();
  }
  await sctx.close();

  // 보기 화면: 발행본을 그리고 이 기기 입력값은 그대로
  const pub = { app: 'fc-anyang-seats', version: 1, updatedAt: '2026-11-27T12:00:00+09:00', match: { opponent: '제주SK', kickoff: '2026-11-28T14:00:00+09:00' },
    sections: [{ id: '원정석', remain: 980, max: 1235, sold: 20 }, { id: 'R10', remain: 0, max: 126, sold: 0 }], sinceBase: { at: '2026-11-26T12:00:00+09:00', booked: 20 } };
  p = await open(b, { url: URL, data: { 'latest.json': pub, 'history.json': [] } });
  await p.waitForFunction(() => document.getElementById('board').innerHTML.includes('제주SK'));
  r = await p.evaluate(() => ({ panel: getComputedStyle(document.querySelector('.panel')).display, svg: document.getElementById('board').innerHTML, note: document.getElementById('note').innerText }));
  check('보기 화면: 발행본 그림(구역은 예매율), 입력 칸 숨김, 경과 시간', r.panel === 'none' && r.svg.includes('>20%<') && !r.svg.includes('980/1235') && /마지막 집계/.test(r.note), r.note);
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
  // 휴대폰: 크게 본 상태에서 구역을 누르면 자세히(확대 그대로), 잔디를 누르면 원래대로
  p = await open(b, { url: URL, device: 'iPhone 13', data: { 'latest.json': pub, 'history.json': [] } });
  await p.waitForFunction(() => /마지막 집계/.test(document.getElementById('note').innerText));
  {
    const wrapAt = () => p.evaluate(() => { const r = document.getElementById('stadiumWrap').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    const st = () => p.evaluate(() => [document.getElementById('stadiumWrap').classList.contains('zoom'), document.getElementById('tip').hidden ? '' : document.getElementById('tip').textContent].join('|'));
    await p.evaluate(() => document.getElementById('stadiumWrap').scrollIntoView({ block: 'center' }));
    await p.mouse.click(...await wrapAt()); const z1 = await st();
    // 크게 보면 처음에는 잔디가 가운데: 손으로 밀듯이 R20 칸을 화면 안으로 옮긴 뒤 누름
    // 옮긴 뒤 위치가 멈출 때까지 기다렸다가 누름 (움직이는 중에 누르면 칸을 빗나가 가끔 실패하던 것, 11/25 4번에 1번)
    const mid = sel => p.evaluate(async sel => { const el = document.querySelector(sel); el.scrollIntoView({ block: 'center', inline: 'center' });
      let last = '', same = 0; for (let i = 0; i < 60 && same < 3; i++) { await new Promise(ok => requestAnimationFrame(ok)); const q = JSON.stringify(el.getBoundingClientRect()); same = q === last ? same + 1 : 0; last = q; }
      const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
    await p.mouse.click(...await mid('#stadium [data-z="R20"]')); const z2 = await st();
    await p.mouse.click(...await mid('#stadium rect[fill="url(#grass)"]')); const z3 = await st();
    check('휴대폰: 크게 본 상태에서 구역을 누르면 자세히(확대 그대로), 잔디를 누르면 원래대로', z1 === 'true|' && z2 === 'true|R20 · 정보 없음 · 총 123석' && z3 === 'false|', JSON.stringify({ z1, z2, z3 }));
  }
  await p.context().close();

  // 원정 경기 화면 (김천): 구역, 원정석 등급 카드, 다른 구장 글자 무시, 홈 입력값과 따로
  p = await open(b, { url: URL + '?s=gimcheon#edit' });
  r = await p.evaluate(() => {
    localStorage.setItem('fc-anyang-seat-status', JSON.stringify({ opp: '부천FC1995', rows: { R10: { remain: 7, max: 126 } } }));  // 홈 입력값
    fcIngest('김천상무 vs FC안양\n김천종합운동장 | 2026.11.07(토) 16:30\n등급 선택\n원정석\n650 석\nS11구역\n50 석\nE21구역\n120 석\nN1구역\n0 석');
    const st = document.getElementById('status').innerText, svg = document.getElementById('board').innerHTML;
    fcIngest('FC안양 vs 제주SK\n안양종합운동장 | 2026.11.28(토) 14:00\n등급 선택\n일반 지정석(2층)\n900 석');
    return { st, st2: document.getElementById('status').innerText, svg: svg.includes('김천상무 vs FC안양') && svg.includes('원정석 예매') && svg.includes('예매율'), opp: state.opp, S11: state.rows.S11.remain, n: SECTIONS.length,
      home: JSON.parse(localStorage.getItem('fc-anyang-seat-status')).rows.R10.remain, away: !!localStorage.getItem('fc-anyang-seat-status-gimcheon'), path: record().images.board };
  });
  check('원정(김천): 구역 47개, 원정석 등급 카드, 상대 고정', r.n === 47 && r.S11 === 50 && r.opp === '김천상무' && r.svg && /등급: 원정석 650석/.test(r.st), JSON.stringify(r));
  check('원정(김천): 안양 홈 글자는 무시, 홈 입력값과 따로, 데이터 폴더', /'김천종합운동장'가 없어 넘겼습니다/.test(r.st2) && r.home === 7 && r.away && r.path.endsWith('/data/gimcheon/latest.png'), JSON.stringify(r));
  await p.context().close();

  // 보내기 스크립트 (GM 함수는 흉내, 티켓링크에는 접속하지 않음): 같은 브라우저의 GM 저장소를 두 화면 사이에서 손으로 이어 줌
  // 현황판: 설치 표시, 입력 화면 신호(board), 받으면 ack / 티켓링크 쪽: 현황판 없음(빨강), 응답 대기, 받음(초록), 안 받음(주황), 늦게 연 현황판에 다시 보냄
  {
    const src = fs.readFileSync(path.join(ROOT, 'fc-anyang-send.user.js'), 'utf8');
    const shim = store => `window.__l = {}; window.__set = {}; window.__store = ${JSON.stringify(store)}; window.GM_addValueChangeListener = (k, f) => (__l[k] = f); window.GM_setValue = (k, v) => (__set[k] = v); window.GM_getValue = k => __store[k]; window.unsafeWindow = window;
      const o = Element.prototype.attachShadow; Element.prototype.attachShadow = function (i) { return o.call(this, { ...i, mode: 'open' }); };`;
    // tl: 'true' 면 티켓링크 쪽, 'false' 면 현황판 쪽, 그 밖은 그 주소 (놀티켓 등)
    const run = (pg, store, tl) => pg.evaluate(([shim, src, host]) => { (0, eval)(shim); (0, eval)(src.replace(/location\.hostname/g, JSON.stringify(host))); }, [shim(store), src, tl === 'true' ? 'www.ticketlink.co.kr' : tl === 'false' ? 'goormigrm.github.io' : tl]);
    const badge = pg => pg.evaluate(() => { const h = [...document.documentElement.children].find(e => e.shadowRoot)?.shadowRoot.firstChild; return h ? h.style.background + ' ' + h.textContent : ''; });
    const TK = '<div><h2>김천상무프로축구단 vs FC안양</h2><div>김천종합운동장</div><div>2026.11.07(토) 16:30</div><div>홍길동님</div><h3>등급 선택</h3><div style="display:flex"><span>W12구역</span><span>196 석</span></div><canvas width="400" height="300"></canvas>'
      + '<div>' + '<i class="seat" title="W12구역 1열 1번" style="display:inline-block;width:10px;height:10px;margin:2px;background:#0d2b45"></i>'.repeat(30) + '</div></div>';
    const tkOpen = async store => { const pg = await b.newPage(); await pg.setContent(TK); await run(pg, store, 'true'); await pg.waitForTimeout(2200); return pg; };

    p = await open(b, { url: URL + '?s=gimcheon#edit' });
    await run(p, {}, 'false');
    const t1 = await p.locator('#lamp').innerText(), beat = await p.evaluate(() => __set.board);
    const tk = await tkOpen({ board: beat }), sent = await tk.evaluate(() => __set), b1 = await badge(tk);
    r = await p.evaluate(sent => { __l.ping('ping', null, sent.ping, true); __l.text('text', null, sent.text, true); return { lamp: document.getElementById('lamp').className + ' ' + document.getElementById('lamp').innerText, W12: state.rows.W12.remain, ack: __set.ack }; }, sent);
    await tk.evaluate(ack => { __l.ack('ack', null, ack, true); __l.ack('ack', null, { why: '받은 글자에 안양종합운동장 없음', at: Date.now() }, true); }, r.ack);  // 홈 현황판의 '안 받음'이 뒤에 와도 받음 유지
    const b2 = await badge(tk);
    check('보내기 스크립트: 좌석 그림 구조 요약(캔버스, 작은 네모 요소, 속성, 색)이 램프에', /캔버스 400x300/.test(sent.ping?.shape) && /i\.seat 30개 \[class=seat title=W12구역 1열 1번\] 색 rgb\(13, 43, 69\) 30/.test(sent.ping?.shape) && /\n좌석 그림: 캔버스 400x300/.test(r.lamp), JSON.stringify({ shape: sent.ping?.shape, lamp: r.lamp }));
    check('보내기 스크립트: 현황판 켜짐 표시, 입력 화면 신호, 예매 화면 감지와 숫자, 개인 글자 뺌', /스크립트 켜짐 \(크롬\)/.test(t1) && beat?.at > 0 && /live/.test(r.lamp) && /숫자 받음/.test(r.lamp) && r.W12 === 196
      && sent.ping?.state === 'seat' && sent.ping?.id && !sent.ping.need.length && sent.ping?.venue === '김천종합운동장' && !/홍길동/.test(sent.text?.s || ''), JSON.stringify({ t1, beat, r, s: sent.text?.s, ping: sent.ping }));
    check('보내기 스크립트: 티켓링크 쪽에 응답 대기 -> 현황판이 받음(초록, 구역 수), 뒤에 온 안 받음은 무시', /응답 기다리는 중/.test(b1) && /^rgb\(21, 128, 61\).*현황판이 받음 .*구역 1개/.test(b2), JSON.stringify({ b1, b2, ack: r.ack }));
    await tk.close();

    // 이 브라우저에 현황판 입력 화면이 없을 때 -> 빨강 안내, 나중에 열면 한 번 다시 보냄, 받지 않으면 이유
    const tk2 = await tkOpen({}), b3 = await badge(tk2), at0 = await tk2.evaluate(() => __set.text?.at);
    await tk2.evaluate(() => { __store.board = { at: Date.now() }; });
    await tk2.waitForTimeout(9000);  // 5초마다 점검, 보낸 지 4초 넘으면 다시 보냄
    const at1 = await tk2.evaluate(() => __set.text?.at);
    await tk2.evaluate(() => __l.ack('ack', null, { why: '받은 글자에 구역 숫자 없음', at: Date.now() }, true));
    const b4 = await badge(tk2);
    check('보내기 스크립트: 현황판 없음은 빨강 안내(브라우저 이름), 나중에 연 현황판에 다시 보냄, 안 받음은 주황과 이유', /^rgb\(185, 28, 28\).*이 크롬에 현황판 입력 화면이 없어 못 넘김/.test(b3) && at1 > at0 && /^rgb\(194, 65, 12\).*현황판이 안 받음: 받은 글자에 구역 숫자 없음/.test(b4), JSON.stringify({ b3, at0, at1, b4 }));
    await tk2.close();
    await p.context().close();

    // 놀티켓(인터파크) 화면: '좌석등급' 표기도 예매 화면으로 감지, 보낸 곳 표시. FC안양 경기 화면이 아니면 표시 안 함
    {
      const nk = await b.newPage();
      await nk.setContent(TK.replace('<h3>등급 선택</h3>', '<h3>좌석등급</h3>'));
      await run(nk, {}, 'tickets.interpark.com'); await nk.waitForTimeout(2200);
      const ping = await nk.evaluate(() => __set.ping), b5 = await badge(nk);
      const other = await b.newPage();
      await other.setContent('<div>호텔 예약 1박 120,000원</div>');
      await run(other, {}, 'nol.yanolja.com'); await other.waitForTimeout(2200);
      const b6 = await badge(other), ping6 = await other.evaluate(() => __set.ping);
      // 놀티켓은 현황판이 받았을 때(초록)만 표시: 구역 숫자가 없는 화면에서 '보냄', '안 받음'을 오가며 깜빡였음 (11/19 사용자, 17판)
      check('보내기 스크립트: 놀티켓 좌석 화면 감지(좌석등급), 보낸 곳 놀티켓, 받기 전 표시 없음, 다른 야놀자 화면은 표시 안 함', ping?.state === 'seat' && ping?.site === '놀티켓' && !b5 && !b6 && ping6?.state === 'idle', JSON.stringify({ ping, b5, b6, ping6 }));
      await nk.close(); await other.close();
    }

    // 놀티켓 실제 형식(11/07 사용자 화면): '좌석 선택', '관람 구역을 선택해 주세요', 구역 이름 줄 다음에 숫자만(석 없음), 괄호 붙은 이름, 경기장 이름 없음, '2:00 PM'
    {
      const NOL = '<div style="display:flex"><b>좌석 선택</b><span>8:41</span></div><div>수원삼성 vs FC안양 (11.29)</div><div>2026.11.29(토) 2:00 PM</div><div>홍길동님</div><h3>관람 구역을 선택해 주세요</h3>'
        + '<div style="display:flex"><span>프리미엄 패밀리박스(4인)(GATE:PREMIUM)</span><span>0</span></div><div style="display:flex"><span>S1구역(GATE:4B)</span><span>12</span></div><div style="display:flex"><span>E5</span><span>40</span></div>'
        + '<div style="display:flex"><span>2층 E석(E15~19)(GATE:3A,3B)</span><span>1,191</span></div>';
      const nk = await b.newPage();
      await nk.setContent(NOL);
      await run(nk, {}, 'tickets.interpark.com'); await nk.waitForTimeout(2200);
      const sent = await nk.evaluate(() => __set);
      await nk.close();
      check('보내기 스크립트 12판: 놀티켓 형식 감지(관람 구역, 숫자만 줄, 쉼표 숫자), 구역 이름과 숫자, 경기 줄은 보내고 로그인 이름, 남은 시간은 뺌',
        sent.ping?.state === 'seat' && !sent.ping.need.length && /프리미엄 패밀리박스\(4인\)\(GATE:PREMIUM\)\n0\nS1구역\(GATE:4B\)\n12\nE5\n40/.test(sent.text?.s) && /수원삼성 vs FC안양/.test(sent.text.s) && /2층 E석\(E15~19\)\(GATE:3A,3B\)\n1,191/.test(sent.text.s) && !/홍길동|8:41/.test(sent.text.s), JSON.stringify(sent));
      // 16판(11/18 버그 검토): 개인 정보 줄(이름 '○○님', 전화번호, 생년월일, 긴 숫자)은 보내지 않음. 아주 짙은 회색 칸(포항 원정석)도 남은 좌석으로 세고, 칸 수에 경기장 이름을 실어 보냄
      {
        const PV = '<div><h2>김천상무프로축구단 vs FC안양</h2><div>김천종합운동장</div><div>2026.11.07(토) 16:30</div><div>김민석님</div><div>VIP 등급 회원 박지훈님</div><div>휴대폰</div><div>01012345678</div><div>1990.01.01</div><h3>등급 선택</h3><div>W석</div><div>1200 석</div>'
          + '<div style="display:flex"><span>W12구역</span><span>196 석</span></div><div>' + '<i class="seat" title="W12구역 1열 1번" style="display:inline-block;width:10px;height:10px;margin:2px;background:rgb(54,64,57)"></i>'.repeat(30) + '</div></div>';
        const pv = await b.newPage(); await pv.setContent(PV); await run(pv, {}, 'true'); await pv.waitForTimeout(4500);
        const got = await pv.evaluate(() => __set); await pv.close();
        const t = got.text?.s || '';
        check('보내기 스크립트 16판: 이름, 전화번호, 생년월일은 보내지 않고 경기, 등급, 구역 줄은 보냄', !/민석|지훈|010|1990/.test(t) && /김천상무프로축구단 vs FC안양/.test(t) && /W석\n1200 석/.test(t) && /W12구역\n196 석/.test(t), t);
        check('보내기 스크립트 16판: 아주 짙은 회색 칸도 남은 좌석, 칸 수에 경기장 이름', got.seats?.remain === 30 && got.seats.total === 30 && got.seats.venue === '김천종합운동장', JSON.stringify(got.seats));
      }
      const pg = await open(b, { url: URL + '?s=suwon#edit' });
      r = await pg.evaluate(s => { const k = fcIngest(s), t = stats(); return { k, S1: state.rows.S1.remain, fam: !!state.rows.프리미엄패밀리박스, z: [zoneId('W13'), zoneId('W13구역'), zoneId('2층 테이블석(GATE:1A)')].join(), E5: state.rows.E5.remain, date: state.date,
        max: SECTIONS.filter(x => state.rows[x.id].max).length, none: SECTIONS.filter(x => !state.rows[x.id].max).map(x => x.id).join(), m: ['E15', 'S3', 'W9', 'W5', 'E9', 'N8'].map(id => state.rows[id].max).join(), w13: state.rows.W13.max + state.rows.W13미판매구역.max, cap: t.cap, booked: t.booked }; }, sent.text.s);
      await pg.context().close();
      check('놀티켓 글자 받기(수원삼성): 경기장 이름 없어도 홈 팀 + 안양이면 받음, 숫자만 줄, 괄호 뺀 구역 이름, 오후 2시, 칸 없는 패밀리박스는 넘김, W13 = 2층 테이블', r.k?.ok && r.S1 === 12 && r.fam === false && r.z === 'W13,W13,W13' && r.E5 === 40 && r.date === '2026-11-29T14:00', JSON.stringify(r));
      // 수원삼성 총석(11/08 받은 자료, W13 772 는 2층 테이블 318 + 미판매 구역 454 로 나눔): 칸 62개 모두, 받은 잔여로 예매 수 (S1 546-12, E5 527-40)
      check('수원삼성 총석: 칸 62개 모두, W13 2층 테이블 + 미판매 구역 = 받은 W13 772 (5석 이하 차이 허용), 캡처로 센 값과 같음, 예매 수 바로 나옴', r.max === 62 && r.none === '' && Math.abs(r.w13 - 772) <= 5 && r.m === '843,637,504,276,116,940' && r.cap === 546 + 527 + 3929 - 169 && r.booked === 534 + 487 + 3929 - 169 - 1191, JSON.stringify(r));  // + 2층 E석(E15~19) 묶음: 총석 3,929 - 막힌 앞 2줄 169(E15~E17 기본값) - 묶음 잔여 1,191
      const pb = await open(b, { url: URL + '?s=bucheon#edit' });
      r = await pb.evaluate(s => [fcIngest(s).why, fcIngest('FC안양 vs 부천FC1995\n안양종합운동장 | 2026.11.28(토) 14:00\n등급 선택\nR10구역\n20 석').why].join(' | '), sent.text.s);
      await pb.context().close();
      check('다른 원정 구장(부천)은 수원삼성 글자도, 안양 홈 경기 글자도 넘김', /부천종합운동장 없음 \| .*부천종합운동장 없음/.test(r), r);
      // 놀티켓 등급 목록: 구역 범위와 합계만('2층 E석(E15~19)(GATE:3A,3B)' 1,191) -> 그 구역들의 합계로 비교 (조금 다르면 실시간 차이로 알림만, 크게 다르면 ⚠)
      const LIST = '수원삼성 vs FC안양 (11.29)\n2026.11.29(토) 2:00 PM\n좌석 선택\n관람 구역을 선택해 주세요\n2층 E석(E15~19)(GATE:3A,3B)\n1,191\n원정석(GATE:4A)\n1,538';
      const pl = await open(b, { url: URL + '?s=suwon#edit' });
      r = await pl.evaluate(s => {
        const st = () => document.getElementById('status').innerText, out = {};
        fcIngest(s); out.none = st();
        [['E15', 300], ['E16', 200], ['E17', 250], ['E18', 240], ['E19', 195]].forEach(([id, v]) => state.rows[id].remain = v);  // 합 1185
        fcIngest(s); out.close = st();
        state.rows.E19.remain = 100; fcIngest(s); out.far = st();
        return out;
      }, LIST);
      await pl.context().close();
      check('놀티켓 등급 목록 범위 합계: 구역 모르면 묶음 추정(≈), 조금 다르면 실시간 차이, 크게 다르면 ⚠', /2층 E석\(E15~19\) 1,191석: 구역 5개는 묶음 잔여를 총석 비율로 나눈 추정/.test(r.none) && /2층 E석\(E15~19\) 1191석, 구역 합 1185석 \(예매가 실시간으로/.test(r.close) && /⚠ 2층 E석\(E15~19\) 1191석인데 구역 합은 1090석/.test(r.far), JSON.stringify(r));
      // 놀티켓 등급 묶음 단위 예매율: 범위 묶음(E15~19)은 바로 셈, 범위 없는 묶음(원정석)은 사람이 구역을 정한 뒤. 구역 잔여를 모르는 칸은 묶음 잔여를 총석 비율로 나눈 추정(≈)
      {
        const pgq = await open(b, { url: URL + '?s=suwon#edit' });
        let answer = 'S5, S6';
        pgq.on('dialog', d => d.accept(answer));
        r = await pgq.evaluate(s => {
          const st = () => document.getElementById('status').innerText, T = () => { const t = stats(); return [t.cap, t.booked, t.awayCap, t.awayBooked].join(); }, out = {};
          out.k = fcIngest(s); out.st = st(); out.a = T(); out.btn = document.getElementById('groupSet').hidden; out.cell = document.querySelector('tr[data-id=E16]').cells[4].textContent;
          out.svg = (document.getElementById('board').innerHTML.match(/≈/g) || []).length;
          document.getElementById('groupSet').click(); out.over = st(); out.b = T();
          return out;
        }, LIST + '\nS4\n504\nE5\n14');
        answer = 'S4, s5, S6구역';
        Object.assign(r, await pgq.evaluate(() => {
          const T = () => { const t = stats(); return [t.cap, t.booked, t.awayCap, t.awayBooked].join(); }, out = {};
          document.getElementById('groupSet').click(); out.c = T(); out.card = document.getElementById('board').textContent.includes('원정석 19.6% 예매');
          const e = document.querySelector('tr[data-id=E15] [data-k=remain]'); e.value = 19; e.dispatchEvent(new Event('input', { bubbles: true })); out.d = T();  // 구역 하나를 좌석 그림으로 알아도 묶음 합은 그대로
          const rec = record(); out.rec = JSON.stringify(rec.groups) + '|' + JSON.stringify(rec.sections.find(x => x.id === 'E16')) + '|' + rec.booked;
          out.json = rec; newGame(); out.cleared = JSON.stringify(state.groups);
          return out;
        }));
        const view = await open(b, { url: URL + '?s=suwon', data: { 'suwon/latest.json': r.json } });
        await view.waitForFunction(() => /마지막 집계/.test(document.getElementById('note').textContent));
        const v = await view.evaluate(() => { const t = stats(); return [t.cap, t.booked, t.awayCap, t.awayBooked].join() + '|' + (document.getElementById('board').innerHTML.match(/≈/g) || []).length; });
        await view.context().close(); await pgq.context().close();
        // E 묶음 총석 3,929 - 1,191, S4 637 - 504, E5 527 - 14. 원정석 = S4, S5, S6 (1,912석) 잔여 1,538 -> S5, S6 은 (1,538 - 504) 를 나눔
        const E = 3929 - (56 + 58 + 55), eb = E - 1191;  // 2층 앞 2줄 막힌 좌석 기본값(E15 56, E16 58, E17 55, 11/18)은 총석에서 뺌
        check('놀티켓 등급 묶음: 범위 묶음은 바로 예매 수에(≈ 추정), 범위 없는 원정석은 구역을 정해야 셈, 숫자 끝이 4 여도 그대로(S4 504, E5 14)',
          r.k.ok && r.k.n === 4 && /원정석 1,538석: 어느 구역인지 정하지 않아/.test(r.st) && r.a === [E + 637 + 527, eb + 133 + 513, 637, 133].join() && r.btn === false && /^≈68% \(묶음 추정/.test(r.cell) && r.svg >= 5, JSON.stringify({ ...r, json: 0 }));
        check('묶음 구역 정하기: 총석보다 잔여가 많으면 ⚠ 하고 세지 않음, 맞게 정하면 원정석 카드와 전체 예매에 들어감, 구역 하나를 따로 알아도 묶음 합은 그대로',
          /⚠ 원정석 잔여 1,538석이 그 구역 총석 합 1,275석보다 많습니다/.test(r.over) && r.b === [E + 637 + 527, eb + 133 + 513, 0, 0].join()
          && r.c === [E + 1912 + 527, eb + 374 + 513, 1912, 374].join() && r.card && r.d === r.c, JSON.stringify({ ...r, json: 0 }));
        check('묶음: 발행 JSON(groups, remainGuess)과 보기 화면이 같은 숫자, 새 경기는 묶음을 비움', /"name":"원정석","ids":\["S4","S5","S6"\],"remain":1538/.test(r.rec) && /"remain":null,"remainGuess":\d+,"max":874/.test(r.rec) && r.rec.endsWith('|' + (eb + 374 + 513))
          && v.startsWith(r.c + '|') && +v.split('|')[1] >= 5 && r.cleared === '{}', JSON.stringify({ rec: r.rec, v, c: r.c }));
      }
    }

    // 보내기 스크립트 13판: 좌석이 화면 요소로 그려져 있으면 칸을 세어 보냄 (색 12 = 남음, 밝은 회색 18 = 팔림), 캔버스가 있으면 세지 않음
    {
      const seatsHtml = (zone, canvas) => `<div><h2>김천상무프로축구단 vs FC안양</h2><div>김천종합운동장</div><div>2026.11.07(토) 16:30</div><h3>등급 선택</h3><div style="display:flex"><span>N11구역</span><span>12 석</span></div><div style="display:flex"><span>N12구역</span><span>30 석</span></div>${canvas ? '<canvas width="400" height="300"></canvas>' : ''}<div>`
        + [...Array(12).fill('#0d2b45'), ...Array(18).fill('#e6e6e6')].map((c, i) => `<i class="seat" title="${zone} 1열 ${i + 1}번" style="display:inline-block;width:10px;height:10px;margin:2px;background:${c}"></i>`).join('') + '</div></div>';
      const sendFrom = async html => { const pg = await b.newPage(); await pg.setContent(html); await run(pg, {}, 'true'); await pg.waitForTimeout(4200); const v = await pg.evaluate(() => __set); await pg.close(); return v; };
      const s1 = await sendFrom(seatsHtml('N11구역')), s2 = await sendFrom(seatsHtml('N11구역', true));
      const bd = await open(b, { url: URL + '?s=gimcheon#edit' });
      await run(bd, {}, 'false');
      r = await bd.evaluate(s1 => {
        const st = () => document.getElementById('status').innerText, N = id => [state.rows[id].remain, state.rows[id].max].join('/'), out = {};
        __l.seats('seats', null, s1.seats, true); out.early = N('N11');  // 이 현황판이 글자를 받기 전에는 안 받음 (다른 구장 화면일 수 있음)
        __l.text('text', null, s1.text, true); __l.seats('seats', null, s1.seats, true); out.own = N('N11') + ' ' + st();
        __l.seats('seats', null, { ...s1.seats, remain: 25 }, true); out.diff = N('N11') + ' ' + st();
        __l.seats('seats', null, { own: [], names: s1.seats.names, remain: 30, total: 44 }, true); out.byRemain = N('N12');  // 이름 후보가 여럿이면 표의 잔여가 같은 구역
        __l.seats('seats', null, { own: [], names: [], remain: 7, total: 44 }, true); out.unknown = st();
        state.rows.W11.off = true; __l.seats('seats', null, { own: ['W11구역'], names: [], remain: 3, total: 99 }, true); out.off = N('W11');
        return out;
      }, s1);
      await bd.context().close();
      check('보내기 스크립트 13판: 좌석 칸 세기(남은 12 / 전체 30, 칸 속성의 구역 이름), 캔버스 화면은 안 셈', s1.seats?.remain === 12 && s1.seats.total === 30 && s1.seats.own.join() === 'N11구역' && s1.seats.names.includes('N12구역') && !s2.seats && /작은 네모 i\.seat 30개/.test(s2.ping?.shape), JSON.stringify({ s1: s1.seats, s2: s2.seats }));
      check('스크립트가 센 좌석: 글자를 받은 현황판만, 총석이 없던 구역에 넣음, 잔여가 다르면 ⚠ 안 넣음, 이름이 여럿이면 잔여가 같은 구역, 모르면 넘김, 미판매는 그대로',
        r.early === '/' && /^12\/30 보내기 스크립트가 좌석 그림을 셌습니다: N11 잔여 12 \/ 총석 30 \(총석을 최대 좌석으로\)/.test(r.own) && /^12\/30 ⚠ 보내기 스크립트가 센 N11 잔여 25석이 목록의 잔여 12석과 달라/.test(r.diff)
        && r.byRemain === '30/44' && /어느 구역인지 몰라 넣지 않았습니다/.test(r.unknown) && r.off === '/240', JSON.stringify(r));
    }
    // 보기 화면(입력 화면 아님)은 신호도 응답도 안 함
    p = await open(b, { url: URL + '?s=gimcheon' });
    await run(p, {}, 'false');
    r = await p.evaluate(() => { __l.text('text', null, { s: '김천상무 vs FC안양\n김천종합운동장 | 2026.11.07(토) 16:30\n등급 선택\nW12구역\n196 석', at: Date.now() }, true); return { board: __set.board, ack: __set.ack }; });
    check('보내기 스크립트: 보기 화면은 입력 화면 신호, 응답 없음', !r.board && !r.ack, JSON.stringify(r));
    await p.context().close();
  }

  // 입력 화면(PC): 맨 위에서 할 일을 고름(현황 집계 / 총석 집계), 고른 쪽의 안내와 발행 버튼 하나만. 드문 기능은 '그 밖의 기능'에 접혀 있음. 칸마다 가로 전체
  p = await open(b);
  r = await p.evaluate(() => {
    const vis = e => e.checkVisibility(), boxes = [...document.querySelectorAll('.panel > .box')].filter(vis), pw = document.querySelector('.panel').getBoundingClientRect().width;
    const shown = () => [...document.querySelectorAll('.panel button:not([data-a]), .panel label.btn, .panel a.btn')].filter(vis).map(x => x.textContent.replace(/보내기 스크립트.*/, '스크립트')).join(','), cols = () => [...document.querySelectorAll('.seats th')].filter(vis).map(x => x.textContent).join(',');
    const out = { full: boxes.every(x => Math.abs(x.getBoundingClientRect().width - pw) < 1), stacked: boxes.every((x, i) => !i || x.getBoundingClientRect().top >= boxes[i - 1].getBoundingClientRect().bottom), off: document.querySelectorAll('[data-a=off]').length };
    out.status = shown() + ' | ' + cols() + ' | ' + vis(document.querySelector('.box.info'));
    document.getElementById('modeMax').click();
    out.max = shown() + ' | ' + cols() + ' | ' + vis(document.querySelector('.box.info')) + ' | ' + document.getElementById('seatTitle').textContent + ' | ' + document.getElementById('status').textContent;
    const before = state.rows.R10.remain; out.ing = fcIngest('FC안양 vs 제주SK\n안양종합운동장 | 2026.11.28(토) 14:00\n등급 선택\nR10구역\n20 석')?.why + '|' + (state.rows.R10.remain === before);
    document.getElementById('modeStatus').click(); out.back = document.body.classList.contains('maxmode');
    out.more = document.querySelector('details.more').open + '|' + [...document.querySelectorAll('details.more button')].map(x => x.textContent).join(',');
    return out;
  });
  check('입력 화면: 현황 집계는 할 일이 캡처 고르기와 현황 발행뿐, 드문 기능은 접혀 있음, 칸마다 가로 전체, 홈은 미판매 버튼 없음', r.status === '현황 집계,총석 집계,보기 화면으로,작업 가이드,스크립트,캡처 고르기,현황 발행,지금 | 구역,매진,잔여,최대,예매율 | true' && r.full && r.stacked && r.off === 0
    && r.more === 'false|이 글자로 다시 채우기,진단 글 복사,새 경기: 잔여 모두 지우기,잔여를 최대로 복사,마지막 발행 지우기,발행 모두 지우기,발행 점검,토큰 설정,이번 집계 저장,저장한 집계 열기,지금 숫자를 기준으로,저장한 집계를 기준으로,비교 끄기', JSON.stringify(r));
  check('입력 화면: 총석 집계는 캡처 고르기와 총석 발행뿐, 표는 구역과 최대만, 경기 정보 숨김, 잔여 글자는 받지 않음, 현황 집계로 돌아옴', r.max.startsWith('현황 집계,총석 집계,보기 화면으로,작업 가이드,스크립트,캡처 고르기,총석 발행 | 구역,최대 | false | 구역별 총석 | 총석이 있는 구역 ') && /아직 발행한 총석이 없습니다/.test(r.max)
    && r.ing === '현황판이 총석 집계 화면이라 받지 않음|true' && r.back === false, JSON.stringify(r));
  await p.context().close();

  // 원정 미판매: 누르면 빗금 + 잔여 비움, 다시 누르면 끔, 숫자가 들어오면 판매 중, 카드, 요약 글, 발행 JSON
  p = await open(b, { url: URL + '?s=gimcheon#edit' });
  r = await p.evaluate(() => {
    const btn = id => document.querySelector(`tr[data-id="${id}"] [data-a=off]`), svg = () => document.getElementById('board').innerHTML;
    fcIngest('김천상무 vs FC안양\n김천종합운동장 | 2026.11.07(토) 16:30\n등급 선택\nS11구역\n50 석\nE31구역\n7 석');
    btn('S11').click(); btn('E31').click();
    const rec = record(), a = { head: document.getElementById('markHead').textContent, off: state.rows.S11.off, remain: state.rows.S11.remain, pressed: btn('S11').getAttribute('aria-pressed'),
      rate: document.querySelector('tr[data-id="S11"]').cells[4].textContent, hatch: svg().includes('url(#hatch)'), card: svg().includes('미판매 2개'), legend: />미판매</.test(svg()),
      sum: summaryText(), unsold: rec.unsold.join(), sec: rec.sections.find(x => x.id === 'S11').unsold, empty: rec.unknown.includes('S11') };
    btn('E31').click(); a.e31 = state.rows.E31.off;
    // 사람이 정한 미판매 우선: 티켓링크 0석(매진처럼 보임)이 와도 그대로, 잔여가 보이면 알리기만, 표에 직접 숫자를 넣으면 꺼짐
    fcIngest('김천상무 vs FC안양\n김천종합운동장 | 2026.11.07(토) 16:30\n등급 선택\nS11구역\n0 석\nW12구역\n190 석');
    Object.assign(a, { zero: state.rows.S11.off && state.rows.S11.remain === null && state.rows.W12.remain === 190, st0: document.getElementById('status').innerText });
    fcIngest('김천상무 vs FC안양\n김천종합운동장 | 2026.11.07(토) 16:30\n등급 선택\nS11구역\n48 석');
    Object.assign(a, { after: state.rows.S11.off, v: state.rows.S11.remain, st1: document.getElementById('status').innerText });
    const inp = document.querySelector('tr[data-id="S11"] [data-k=remain]'); inp.value = '48'; inp.dispatchEvent(new Event('input', { bubbles: true }));
    Object.assign(a, { typed: state.rows.S11.off === false && state.rows.S11.remain === 48, pressed2: btn('S11').getAttribute('aria-pressed') });
    return a;
  });
  check('원정 미판매: 빗금, 잔여 비움, 카드, 범례, 요약 글, 발행 JSON, 다시 누르면 끔, 자동 입력(0석, 잔여)보다 사람이 우선, 표에 숫자를 넣으면 끔', r.head === '매진 / 미판매' && r.off === true && r.remain === null && r.pressed === 'true' && r.rate === '미판매'
    && r.hatch && r.card && r.legend && /미판매: E31, S11/.test(r.sum) && r.unsold === 'E31,S11' && r.sec === true && !r.empty && r.e31 === false && r.zero && /미판매로 둔 구역은 그대로 둠: S11/.test(r.st0) && r.after === true && r.v === null
    && /받은 구역이 모두 미판매로 둔 구역이라 그대로/.test(r.st1) && /미판매로 둔 S11에 잔여 48석이 보입니다/.test(r.st1) && r.typed && r.pressed2 === 'false', JSON.stringify(r));
  await p.context().close();

  // 예매 현황 = 얼마나, 몇 % 예매: 카드(예매된 좌석, 예매율, 원정석), 구역 예매율, 구역별 증감 없음, 원정도 추이, 발행 결과는 발행 칸에도
  p = await open(b, { url: URL + '?s=gimcheon#edit' });
  r = await p.evaluate(() => {
    fcIngest('김천상무 vs FC안양\n김천종합운동장 | 2026.11.07(토) 09:00\n등급 선택\nW12구역\n196 석\nS11구역\n156 석\nS12구역\n145 석');
    state.base = { at: '2026-11-07T08:00', rows: { W12: 200 } }; render();
    const svg = document.getElementById('board').innerHTML, tr = document.getElementById('trend'), t = stats();
    note('발행했습니다.');
    return { cap: t.cap, booked: t.booked, svg1: svg.includes('예매된 좌석') && svg.includes('>265<') && svg.includes(' / 홈 115 / 762석') && svg.includes('전체 / 홈석(원정석 뺌) / 총석') && build(true).includes('홈 115 / 총 762석'), rate: svg.includes('34.8<tspan'), s: svg.includes('원정석 예매') && svg.includes(' / 451석') && svg.includes('원정석 33.3% 예매'),
      zone: svg.includes('W12 36%'), diff: /% [+−]\d/.test(svg), since: svg.includes('+4'), legend: svg.includes('>예매율<') && svg.includes('0~24%'),
      trend: getComputedStyle(tr).display !== 'none' && tr.innerHTML.includes('홈석 예매 추이') && tr.innerHTML.includes('원정석 예매 추이') && tr.innerHTML.includes('>115<') && tr.innerHTML.includes('37.0%') && tr.innerHTML.includes('>150<') && tr.innerHTML.includes('33.3%'),
      away: (r => [r.awayBooked, r.awayCapacity].join())(record()),
      head: document.querySelector('thead th:last-child').textContent, cell: document.querySelector('tr[data-id="W12"]').cells[4].textContent, pub: document.getElementById('pubNote').textContent,
      sum: summaryText(), rec: (r => [r.capacity, r.booked])(record()) };
  });
  check('예매 현황: 예매된 좌석(전체 265 / 홈 115 / 총석 762, 휴대폰은 홈 / 총 아랫줄), 예매율, 원정석 예매 카드, 구역 예매율, 증감 표시 없음(구역, 카드), 추이는 홈석(115, 37.0%)/원정석(150, 33.3%) 두 그래프, 표 예매율, 요약 글, 발행 JSON, 발행 칸 알림',
    r.cap === 762 && r.booked === 265 && r.svg1 && r.rate && r.s && r.zone && !r.diff && !r.since && r.legend && r.trend && r.head === '예매율' && r.cell === '36%' && r.pub === '발행했습니다.'
    && /예매 265석 \/ 762석 \(34\.8%\)\n원정석 예매 150석 \/ 451석 \(33\.3%\)/.test(r.sum) && r.rec.join() === '762,265' && r.away === '150,451', JSON.stringify(r));
  // 공식 관중을 전체, 원정으로 나눠 넣기 (월·화 발표): 홈석 그래프는 홈 관중(전체 - 원정), 원정석 그래프는 원정 관중, 머리글, 요약 글, 발행 JSON, 새로 열어도 남음
  const crowdOf = () => p.evaluate(() => {
    const tr = document.getElementById('trend').innerHTML, rec = record();
    return { tr: /홈 관중 260명 \(홈석 예매 115석 대비 \+145\)/.test(tr) && /원정 관중 140명 \(원정석 예매 150석 대비 [−-]10\)/.test(tr) && !tr.includes('전체 예매'),
      head: (h => ['>공식 관중<', '400<tspan', '>좌석 대비 관중<', '52.5<tspan', '집계 예매 265석', '명 / 홈 260명 / 총 762석', '명 / 총 451석', '>원정 관중<', '140<tspan', '원정석 집계 예매 150석', '관중은 연맹 공식 발표'].every(x => h.includes(x)))(document.getElementById('board').innerHTML),
      sum: /^[^\n]+\n\n공식 관중 400명 \(원정 140명, 원정석 예매 150석 대비 [−-]10\)\n마지막 집계 예매 265석/.test(summaryText()),
      rec: [rec.match.attendance, rec.match.awayAttendance].join(), input: [document.getElementById('crowd').value, document.getElementById('crowdAway').value].join() };
  });
  await p.evaluate(() => [['crowd', '400'], ['crowdAway', '140']].forEach(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')); }));
  r = await crowdOf();
  await p.reload(); await p.waitForFunction(() => typeof record === 'function');
  const r2 = await crowdOf();
  check('공식 관중 전체/원정 나눠 넣기: 홈 관중 260(홈석 115 대비 +145), 원정 관중 140(원정석 150 대비 −10), 카드는 공식 숫자(집계는 설명 줄), 요약 글 맨 위, 발행 JSON, 새로 열어도 남음',
    r.tr && r.head && r.sum && r.rec === '400,140' && r.input === '400,140' && JSON.stringify(r2) === JSON.stringify(r), JSON.stringify([r, r2]));
  await p.context().close();

  // 원정 구장 (좌석도로 그림): 칸 수, 원정석 칸, 그림 오류 없음, 티켓링크 표기가 달라도 구역 이름 맞추기
  {
    const H2 = (host, venue) => `${host} vs FC안양\n${venue} | 2026.11.29(일) 14:00\n등급 선택\n`;
    const cases = [
      ['jeonbuk', 104, 11, H2('전북현대', '전주월드컵경기장') + 'S원정\n500 석\nS-1C구역\n120 석\nE일반2A구역\n30 석\n1A구역\n7 석', { S1C: 120, E2A: 30 }, '1A'],
      ['incheon', 62, 7, H2('인천유나이티드', '인천축구전용경기장') + '원정석\n1142 석\nN1구역\n144 석\nE3구역\n90 석\nW5구역\n10 석', { N1: 144, E3: 90, W5: 10 }, ''],
      ['pohang', 63, 7, H2('포항스틸러스', '포항스틸야드') + '청암E1구역\n100 석\nA1구역\n50 석\n데크석\n20 석\n퍼스트클래스석\n12 석\n퍼스트클래스 구역\n12 석\n프레스티지 테이블(1인)\n7 석\n프레스티지 테이블(2인)\n26 석\nT2 테이블(1인)\n1 석\nT2 테이블(2인)\n60 석', { E1: 100, A1: 50, 데크석: 20, 퍼스트클래스석: 12, 프레스티지테이블: 33, T2: 61 }, ''],
      ['seoul', 69, 3, H2('FC서울', '서울월드컵경기장') + 'E-A구역\n80 석\nSC구역\n40 석', { EA: 80, SC: 40 }, ''],
      ['ulsan', 106, 11, H2('울산HD', '울산문수축구경기장') + 'N1구역\n120 석\nE13구역\n50 석\n프리미엄 테이블석\n10 석', { N1: 120, E13: 50, 프리미엄테이블석: 10 }, ''],
      ['suwon', 62, 3, H2('수원삼성', '수원월드컵경기장') + 'S3구역\n20 석\nE5구역\n40 석', { S3: 20, E5: 40 }, ''],
      ['suwonfc', 38, 13, H2('수원FC', '수원종합운동장') + 'S7구역\n30 석\nVIP석\n5 석', { S7: 30, VIP석: 5 }, ''],
      ['bucheon', 42, 8, H2('부천FC1995', '부천종합운동장') + 'SA구역\n50 석\nGE가구역\n12 석', { SA: 50, GE가: 12 }, ''],
      ['gangwon', 42, 3, H2('강원FC', '강릉종합운동장') + 'S2구역\n15 석\n자유석A구역\n100 석\n테이블석\n4 석', { S2: 15, 자유석A: 100, 테이블석: 4 }, ''],
    ];
    for (const [id, n, ours, txt, want, miss] of cases) {
      p = await open(b, { url: URL + `?s=${id}#edit` });
      r = await p.evaluate(([txt, want]) => {
        fcIngest(txt);
        const svg = document.getElementById('board').innerHTML;
        return { n: SECTIONS.length, ours: SECTIONS.filter(s => s.ours).length, nan: svg.includes('NaN'), got: Object.keys(want).map(k => `${k}=${state.rows[k]?.remain}`).join(' '),
          st: document.getElementById('status').innerText, rows: document.querySelectorAll('#rows tr').length, title: document.title };
      }, [txt, want]);
      const wantTxt = Object.entries(want).map(([k, v]) => `${k}=${v}`).join(' ');
      check(`원정 ${id}: 칸 ${n}개(원정석 ${ours}), 그림 오류 없음, 구역 이름 맞추기${miss ? ', 없는 이름 알림' : ''}`, r.n === n && r.ours === ours && !r.nan && r.rows === n && r.got === wantTxt && !p.errors.length
        && (miss ? r.st.includes(`현황판에 없는 구역 이름: ${miss}`) : !r.st.includes('현황판에 없는 구역')), JSON.stringify({ ...r, want: wantTxt, errors: p.errors }));
      await p.context().close();
    }
  }

  // 구장 버튼: 공유 버튼 아래 안양 홈, 원정 6곳, 경기별 기록. 지금 구장 표시, 마지막 집계 날짜
  p = await open(b, { url: URL + '?s=gimcheon', data: { 'gimcheon/latest.json': { updatedAt: '2026-11-07T14:06:00+09:00', match: { opponent: '김천상무' }, sections: [] } } });
  await p.waitForTimeout(1200);
  r = await p.evaluate(() => [...document.querySelectorAll('#stadiums a')].map(a => a.textContent + (a.getAttribute('aria-current') ? '*' : '')).join('|'));
  check('구장 버튼: 안양 홈, 김천(지금, 11.07), 전북, 포항, 북패(서울), 울산, 인천, 경기별 기록 (놀티켓 구장 수원삼성, 수원FC, 부천, 강원은 11/20 뺌)', r === '안양 홈|김천11.07*|전북|포항|북패|울산|인천|경기별 기록', r);
  await p.context().close();

  // 보기 화면: 발행본의 공식 관중(match.attendance, awayAttendance)과 원정석 등급 잔여를 읽음 (11/18 주석 뒤에 붙어 안 읽히던 것, 11/22 포항 4,677 이 안 보임)
  p = await open(b, { url: URL + '?s=pohang', data: { 'pohang/latest.json': { updatedAt: '2026-11-21T10:48:00+09:00', match: { opponent: '포항스틸러스', kickoff: '2026-11-21T14:00:00+09:00', attendance: 4677, awayAttendance: 330 }, awayRemain: 12, sections: [{ id: 'E1', remain: 100, max: 352 }] } } });
  await p.waitForTimeout(1200);
  r = await p.evaluate(() => [state.crowd, state.crowdAway, state.awayGrade, /4,677/.test(document.body.innerText)].join());
  await p.context().close();
  check('보기 화면: 발행본의 공식 관중 4,677(원정 330), 원정석 등급 잔여를 읽어 보여 줌', r === '4677,330,12,true', r);

  // 사이트 화면에서만 FC서울 = '북패' (저장, 공유 이미지와 요약 글은 '서울', 경기장 이름은 그대로)
  p = await open(b, { url: URL + '?s=seoul#edit' });
  r = await p.evaluate(() => {
    fcIngest('FC서울 vs FC안양\n서울월드컵경기장 | 2026.11.29(일) 14:00\n등급 선택\nSC구역\n40 석');
    const svg = document.getElementById('board').innerHTML, png = build(false), story = build(true);
    return { screen: svg.includes('북패 vs FC안양') && svg.includes('북패 홈 쪽') && !svg.includes('FC서울') && svg.includes('서울월드컵경기장'), title: document.title,
      png: png.includes('FC서울 vs FC안양') && png.includes('서울 홈 쪽') && !png.includes('북패'), story: story.includes('FC서울 vs FC안양') && !story.includes('북패'), sum: summaryText().startsWith('FC서울 vs FC안양') };
  });
  check("사이트 화면은 '북패', 저장/공유 이미지와 요약 글은 '서울'", r.screen && r.title === 'FC안양 원정 예매현황 (북패)' && r.png && r.story && r.sum, JSON.stringify(r));
  await p.context().close();
  p = await open(b);
  r = await p.evaluate(() => { const o = [...document.getElementById('opp').options].find(o => o.value === 'FC서울'); return o && o.text; });
  check("홈 상대팀 목록도 화면에는 '북패' (값은 FC서울)", r === '북패', r);
  // 승강으로 올 수 있는 팀: 이름이 겹쳐도 맞게 (서울이랜드 ≠ FC서울, 수원삼성 ≠ 수원FC), 서울이랜드는 '북패'로 안 바뀜
  r = await p.evaluate(() => ['FC안양 vs 서울이랜드FC', 'FC안양 vs 수원FC', 'FC안양 vs 수원삼성블루윙즈', 'FC안양 vs 대구FC', 'FC안양 vs FC서울'].map(h => parseText(h + '\n').opp).join('|') + '|' + nick('서울이랜드 vs FC안양'));
  check('승강 대비 상대팀: 서울이랜드, 수원FC, 수원삼성, 대구FC, FC서울 구분, 서울이랜드는 그대로', r === '서울이랜드|수원FC|수원삼성|대구FC|FC서울|서울이랜드 vs FC안양', r);
  await p.context().close();

  // 미판매는 사람이 정한 대로: 현황판 탭이 둘이어도(먼저 열어 둔 탭, 탭 맞춤을 놓친 오래된 탭이 0석을 받아도) 매진으로 덮어쓰지 않음 (11/07 사용자 보고)
  {
    const ctx = await b.newContext(), U = URL + '?s=gimcheon#edit', TXT = '김천상무 vs FC안양\n김천종합운동장 | 2026.11.07(토) 16:30\n등급 선택\nW11구역\n0 석\nW21구역\n0 석\nW12구역\n193 석';
    const A = await ctx.newPage(); await A.goto(U);
    const B = await ctx.newPage(); await B.goto(U);
    await B.evaluate(() => ['W11', 'W21'].forEach(id => document.querySelector(`tr[data-id="${id}"] [data-a=off]`).click()));
    const synced = await A.evaluate(() => state.rows.W11.off);
    await A.evaluate(t => { state.rows.W11.off = false; state.rows.W21.off = false; fcIngest(t); }, TXT);  // 맞춤을 놓친 오래된 탭처럼
    await B.reload();
    r = await B.evaluate(() => ({ W11: state.rows.W11, W21: state.rows.W21, W12: state.rows.W12.remain, list: localStorage.getItem('fc-anyang-unsold-gimcheon') }));
    await B.evaluate(() => document.querySelector('tr[data-id="W21"] [data-a=off]').click());  // 사람이 끄면 그다음 숫자를 받음
    await A.evaluate(t => fcIngest(t), TXT);
    const after = await A.evaluate(() => [state.rows.W11.off, state.rows.W21.off, state.rows.W21.remain].join());
    await ctx.close();
    check('미판매는 탭이 둘이어도, 오래된 탭이 0석을 받아도 그대로, 사람이 끄면 숫자를 받음', synced === true && r.W11.off === true && r.W11.remain === null && r.W21.off === true && r.W12 === 193 && r.list === '["W11","W21"]' && after === 'true,false,0', JSON.stringify({ synced, r, after }));
  }

  // 기본 주소(?s 없음) 보기 화면: 홈, 원정 중 가장 최근 발행으로. ?s=anyang 은 홈 그대로
  {
    const G = { updatedAt: '2026-11-07T09:16:00+09:00', match: { opponent: '김천상무', kickoff: '2026-11-07T16:30:00+09:00' }, sections: [{ id: 'W12', remain: 196 }, { id: 'S11', remain: null, unsold: true }] };
    const Hm = { updatedAt: '2026-11-05T12:00:00+09:00', match: { opponent: '제주SK', kickoff: '2026-11-28T14:00:00+09:00' }, sections: [{ id: 'R10', remain: 26 }] };
    const land = async (url, g, h) => {
      const pg = await open(b, { url, data: { 'gimcheon/latest.json': g, 'latest.json': h } });
      await pg.waitForTimeout(1500);
      const v = await pg.evaluate(() => ({ url: location.search, away: document.body.classList.contains('away'), W12: state.rows.W12?.remain, R10: state.rows.R10?.remain, S11: state.rows.S11?.off, svg: document.getElementById('board').innerHTML.includes('미판매') }));
      await pg.context().close();
      return v;
    };
    const a = await land(URL, G, Hm), h = await land(URL, { ...G, updatedAt: '2026-11-01T10:00:00+09:00' }, Hm), c = await land(URL + '?s=anyang', G, Hm);
    check('기본 주소: 가장 최근 발행(김천)으로 가고 미판매도 받음, 홈이 최근이면 홈, ?s=anyang 은 홈', a.url === '?s=gimcheon&auto=' && a.away && a.W12 === 196 && a.S11 === true && a.svg
      && h.url === '' && h.R10 === 26 && c.url === '?s=anyang' && !c.away && c.R10 === 26, JSON.stringify({ a, h, c }));
    // 따라가는 화면: 지금 보는 구장(김천) 파일만 못 받았을 때(500) 더 오래된 홈으로 넘어가지 않음
    const pf = await open(b, { url: URL, data: { 'gimcheon/latest.json': G, 'latest.json': Hm } });
    await pf.waitForURL(/s=gimcheon/);
    await pf.context().route(/gimcheon\/latest\.json/, r => r.fulfill({ status: 500, body: '' }));
    await pf.evaluate(() => follow()); await pf.waitForTimeout(500);
    const stay = await pf.evaluate(() => location.search);
    await pf.context().close();
    check('따라가는 화면: 지금 구장 파일을 못 받으면 홈으로 넘어가지 않음', stay === '?s=gimcheon&auto=', stay);

    // 퍼간 화면(?embed): 최근 구장으로, 열어 둔 사이 홈이 새로 발행되면 홈으로 (embed 유지), 좁은 iframe 도 가로판, 퍼가기 코드
    const data = { 'gimcheon/latest.json': G, 'latest.json': Hm }, pg = await open(b, { url: wrap(URL + '?embed'), data });
    let fr = await inner(pg);
    await fr.waitForURL(/s=gimcheon/); await pg.waitForTimeout(800);
    const e1 = await fr.evaluate(() => [location.search, document.body.classList.contains('embed'), document.getElementById('board').getAttribute('viewBox'), getComputedStyle(document.getElementById('stadiumWrap')).display, embedCode()].join(' | '));
    data['latest.json'] = { ...Hm, updatedAt: '2026-11-07T12:00:00+09:00' };
    await fr.evaluate(() => follow());
    await fr.waitForURL(u => !u.search.includes('s=')); await pg.waitForTimeout(800);
    fr = pg.mainFrame().childFrames()[0];
    const e2 = await fr.evaluate(() => [location.search, document.body.classList.contains('embed'), document.title, state.rows.R10.remain].join(' | '));
    await pg.context().close();
    const pc = await open(b, { url: URL + '?s=gimcheon', data }), e3 = await pc.evaluate(() => embedCode());
    await pc.context().close();
    check('퍼간 화면(iframe 390px): 최근 구장(김천)으로, 홈이 새로 발행되면 홈으로 따라감, 좁아도 가로판, 퍼가기 코드는 어느 화면에서나 따라가는 ?embed',
      /^\?embed=&s=gimcheon&auto= \| true \| 0 0 1280 1062 \| none \| <iframe src="[^"]*index\.html\?embed" title="FC안양 예매 현황" style="width:100%;aspect-ratio:1280\/1062/.test(e1)
      && e2 === '?embed= | true | FC안양 예매현황 | 26' && /index\.html\?embed"/.test(e3), JSON.stringify({ e1, e2, e3 }));
  }

  // 보내기 스크립트 업데이트 버튼: 신호 없음 -> 설치/업데이트(보라), 옛 판 -> 업데이트(11판 -> 최신), 최신 -> 판 번호만. 최신 판 번호는 스크립트 @version 과 같아야 함
  {
    const ver = +fs.readFileSync(path.join(ROOT, 'fc-anyang-send.user.js'), 'utf8').match(/@version\s+(\d+)/)[1];
    const sv = +fs.readFileSync(path.join(ROOT, 'fc-anyang-send.user.js'), 'utf8').match(/state: 'installed', version: (\d+)/)[1];
    p = await open(b, { url: URL + '?s=gimcheon#edit' });
    r = await p.evaluate(v => {
      const B = () => (document.getElementById('scriptBtn').classList.contains('main') ? '*' : '') + document.getElementById('scriptBtn').textContent + ' @' + document.getElementById('scriptBtn').getAttribute('href'), out = { latest: SCRIPT_VERSION };
      drawLamp(); out.none = B();
      fcPing({ state: 'installed', version: v - 1, at: Date.now() }); out.old = B(); out.lamp = document.getElementById('lamp').innerText;
      fcPing({ state: 'installed', at: Date.now() }); out.older = B();
      fcPing({ state: 'installed', version: v, at: Date.now() }); out.ok = B();
      return out;
    }, ver);
    check(`스크립트 업데이트 버튼(최신 ${ver}판, 스크립트 @version 과 같음): 신호 없음, 옛 판, 최신`, r.latest === ver && sv === ver && r.none === '*보내기 스크립트 설치/업데이트 @fc-anyang-send.user.js'
      && r.old === `*보내기 스크립트 업데이트 (${ver - 1}판 → ${ver}판) @fc-anyang-send.user.js` && /새 판\(\d+판\) 있음/.test(r.lamp) && r.older === `*보내기 스크립트 업데이트 (옛 판 → ${ver}판) @fc-anyang-send.user.js`
      && r.ok === `보내기 스크립트 ${ver}판 (최신) @fc-anyang-send.user.js`, JSON.stringify({ ...r, ver, sv }));
    await p.context().close();
  }

  // 확인된 총석(FS4 36)은 그 브라우저가 처음 본 잔여로 배운 추정값보다 우선, 사람이 넣은 값은 그대로
  {
    const ctx = await b.newContext();
    // (11/25 부터 안양 홈은 모든 구역 총석이 있어 '모르는 구역 추정값은 그대로'는 위 '최대 좌석 배우기'에서 봄)
    await ctx.addInitScript(() => { if (!localStorage.getItem('fc-anyang-seat-status')) localStorage.setItem('fc-anyang-seat-status', JSON.stringify({ rows: { FS4: { remain: 20, max: 20, learned: true }, FS1: { remain: 5, max: 48 } } })); });
    const pg = await ctx.newPage(); await pg.goto(URL + '#edit');
    r = await pg.evaluate(() => [state.rows.FS4.max, !!state.rows.FS4.learned, state.rows.FS1.max].join());
    await ctx.close();
    check('확인된 총석 FS4 36 은 배운 추정값(20)보다 우선, 사람이 넣은 FS1 48 은 그대로', r === '36,false,48', r);
  }

  // 수집 상태 램프: 신호 없음 / 켜짐 / 티켓링크 열림 / 예매 화면 감지 / 숫자 받음 / 다른 구장 / 신호 끊김 / 뒤 탭
  p = await open(b, { url: URL + '?s=gimcheon#edit' });
  r = await p.evaluate(() => {
    const L = () => (document.getElementById('lamp').className.replace('edit', '').trim() || 'off') + ':' + document.getElementById('lamp').innerText, now = Date.now(), out = {};
    out.none = L();
    fcPing({ state: 'installed', at: now }); out.installed = L();
    fcPing({ state: 'idle', venue: '', at: now }); out.idle = L();
    fcPing({ state: 'seat', venue: '김천종합운동장', zones: 9, at: now }); out.seat = L();
    fcIngest('김천상무 vs FC안양\n김천종합운동장 | 2026.11.07(토) 16:30\n등급 선택\nE12구역\n278 석'); out.live = L();
    fcPing({ state: 'seat', venue: '울산문수축구경기장', at: now }); out.bad = L();
    fcPing({ state: 'seat', venue: '김천종합운동장', at: now - 30e3 }); out.stale = L();
    fcPing({ state: 'seat', venue: '김천종합운동장', hidden: true, at: now - 60e3 }); out.hidden = L();
    fcIngest('울산HD vs FC안양\n울산문수축구경기장 | 2026.11.21(토) 14:00\n등급 선택\nE1구역\n10 석'); out.rejected = L();
    fcPing({ id: 'a', state: 'seat', venue: '김천종합운동장', at: Date.now() }); fcPing({ id: 'b', state: 'idle', need: ['등급 선택'], at: Date.now() }); out.two = L();  // 탭 둘: 예매 화면 쪽을 보여 줌
    lamp.pings = {}; fcPing({ id: 'b', state: 'idle', need: ['등급 선택', 'N석'], at: Date.now() }); out.need = L();
    return out;
  });
  const lampOk = /^off:.*신호 없음/.test(r.none) && /^wait:/.test(r.installed) && /^open:/.test(r.idle) && /^seat:.*예매 화면 감지됨/.test(r.seat) && /^live:.*숫자 받음.*구역 1개/.test(r.live)
    && /^bad:.*다른 구장/.test(r.bad) && /^wait:.*마지막 신호/.test(r.stale) && /^live:/.test(r.hidden) && /김천종합운동장 없음/.test(r.rejected)
    && /^live:/.test(r.two) && /^open:.*화면에 없는 글자: 등급 선택, N석/.test(r.need);
  check('수집 상태 램프 (꺼짐, 노랑, 파랑, 초록, 깜빡임, 빨강, 끊김, 뒤 탭, 거부 이유, 탭 둘, 없는 글자)', lampOk, JSON.stringify(r));
  r = await p.evaluate(() => { const v = getComputedStyle(document.getElementById('lamp')); return v.display + ' ' + v.position; });
  check('램프는 입력 화면 위에 고정', r === 'flex fixed', r);
  await p.context().close();
  p = await open(b, { url: URL + '?s=gimcheon' });
  check('램프는 보기 화면에서 안 보임', await p.evaluate(() => getComputedStyle(document.getElementById('lamp')).display) === 'none');
  await p.context().close();

  // 파서 단위 시험 (원정 구장 글자 고치기)
  p = await open(b, { url: URL + '?s=gimcheon#edit' });
  r = await p.evaluate(() => {
    const f = s => JSON.stringify(parseText(s).found);
    return { e6: f('611구역 0석\n612구역 278석'), w: f('\\/12구역 196 석\nVV13구역 267 석'), s5: f('511구역 30석'), n: f('N1구역 12석\nN11구역 40석'), g: parseText('E석(일반석) 1503 석\nE12구역 278석\nEEEEN W12구역 196 4석').grades.map(x => x.join(':')).join(), bad: f('W12구역 196 4석\nW13구역 2674') };
  });
  check('원정 글자 고치기: 611→E11, \\/12→W12, 511→S11, N1 과 N11 구분, 등급 줄만, 깨진 줄은 안 받음', r.e6 === '{"E11":0,"E12":278}' && r.w === '{"W12":196,"W13":267}' && r.s5 === '{"S11":30}' && r.n === '{"N1":12,"N11":40}' && r.g === 'E석(일반석):1503' && r.bad === '{}', JSON.stringify(r));
  await p.context().close();
  p = await open(b);
  r = await p.evaluate(() => JSON.stringify(parseText('611구역 0석\nR10구역 26석').found));
  check('홈은 611구역을 E11 로 바꾸지 않음 (E 구역 없음)', r === '{"R10":26}', r);
  await p.context().close();

  // 11/13: 진단 글 복사, 발행 점검, 램프 접기, 구역 글자가 칸 안에, 추이 가로축 두 줄
  {
    let pg = await open(b, { url: URL + '?s=gimcheon#edit' });
    await pg.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    r = await pg.evaluate(async () => {
      const L = document.getElementById('lamp'), out = {};
      fcPing({ state: 'installed', version: SCRIPT_VERSION, at: Date.now() });
      fcPing({ id: 'a', site: '티켓링크', state: 'seat', venue: '김천종합운동장', need: [], zones: 2, at: Date.now(), where: 'www.ticketlink.co.kr/reserve', shape: '캔버스 없음 · SVG 도형 0 · 작은 네모 i.seat 30개 [class=seat] 색 rgb(13, 43, 69) 12' });
      fcIngest('김천상무 vs FC안양\n김천종합운동장 | 2026.11.07(토) 16:30\n등급 선택\nN11구역\n12 석');
      fcSeats({ own: ['N11구역'], names: ['N11구역', 'N12구역'], remain: 12, total: 30 });
      out.clamp = getComputedStyle(L.querySelector('span')).webkitLineClamp + '|' + L.offsetHeight; L.click(); out.more = L.classList.contains('more') + '|' + L.offsetHeight + '|' + /스크립트 좌석 세기 .*잔여 12 \/ 총석 30/.test(L.textContent);
      out.pad = getComputedStyle(document.querySelector('main')).paddingTop;
      document.getElementById('diag').click(); await new Promise(r => setTimeout(r, 200));
      out.diag = diagText(); out.st = document.getElementById('status').innerText;
      return out;
    });
    await pg.context().close();
    check('진단 글 복사: 주소와 경기장, 스크립트 판, 램프, 예매 탭 신호와 좌석 그림 구조, 스크립트가 센 좌석과 결과, 받은 글자', /FC안양 현황판 진단 .*\?s=gimcheon#?.* 김천종합운동장/.test(r.diag) && new RegExp(`보내기 스크립트: ${SV}판 \\(최신 ${SV}판\\) · 숫자 받음: .* 구역 1개`).test(r.diag) && /예매 탭 티켓링크 www\.ticketlink\.co\.kr\/reserve .*: seat · 경기장 '김천종합운동장'/.test(r.diag)
      && /좌석 그림: 캔버스 없음 · SVG 도형 0 · 작은 네모 i\.seat 30개/.test(r.diag) && /스크립트 좌석 세기 .*잔여 12 \/ 총석 30 · 칸 속성의 이름 \["N11구역"\]/.test(r.diag) && /결과: 보내기 스크립트가 좌석 그림을 셌습니다: N11/.test(r.diag) && /N11구역\n12 석/.test(r.diag) && /진단 글을 복사했습니다|아래 글자 칸에 넣었습니다/.test(r.st), r.diag + ' / ' + r.st);
    check('수집 램프: 두 줄로 접혀 있고 누르면 펼침(스크립트 좌석 세기 줄), 입력 화면 맨 위에 램프 자리', r.clamp.startsWith('2|') && r.more.startsWith('true|') && +r.more.split('|')[1] > +r.clamp.split('|')[1] && r.more.endsWith('|true') && r.pad === '76px', JSON.stringify({ clamp: r.clamp, more: r.more, pad: r.pad }));
    // 발행 점검: 발행하지 않고 토큰(쓰기 권한), 스크립트 판, 지금 발행본을 알려 줌
    const chk = async (blob, token) => {
      const pg = await open(b, { data: { 'latest.json': { app: 'fc-anyang-seats', updatedAt: '2026-11-01T16:30:00+09:00', match: { opponent: '부천FC1995', kickoff: '2026-11-01T16:30:00+09:00' }, sections: [] } } });
      const calls = [];
      await pg.context().route(/api\.github\.com\/.*git\//, r => { calls.push(r.request().method() + ' ' + r.request().url().split('/git/')[1]); return r.fulfill({ status: blob, json: { sha: 'x' } }); });
      const v = await pg.evaluate(async token => { if (token) localStorage.setItem('fc-anyang-gh-token', token); fcPing({ state: 'installed', version: SCRIPT_VERSION - 1, at: Date.now() }); document.getElementById('pubCheck').click();
        for (let i = 0; i < 50 && !/발행 점검 \(/.test(document.getElementById('pubNote').textContent); i++) await new Promise(r => setTimeout(r, 100)); return document.getElementById('pubNote').textContent; }, token);
      await pg.context().close();
      return v + ' || ' + calls.join(',');
    };
    const ok = await chk(201, 'ghp_x'), bad = await chk(401, 'ghp_x'), none = await chk(201, '');
    check('발행 점검: 토큰 쓰기 확인(파일 조각만 올림, 브랜치는 안 건드림), 만료된 토큰, 토큰 없음, 옛 스크립트, 지금 발행본', /토큰: 발행할 수 있음/.test(ok) && ok.includes(`⚠ 보내기 스크립트: ${SV - 1}판`) && !/바로 발행/.test(ok) && /지금 발행본: 부천FC1995 11\.01 16:30 경기, 집계 11\.01 16:30/.test(ok) && ok.endsWith('|| POST blobs')
      && /⚠ 토큰: 만료됐거나 잘못됐습니다/.test(bad) && /⚠ 토큰: 없음/.test(none) && none.endsWith('|| '), JSON.stringify({ ok, bad, none }));
    // 구역 글자가 칸 밖으로 나가지 않음: 가로로 쓴 글자(이름, 예매율)의 네 귀(조금 안쪽)가 그 칸 위에 있는지. 모서리가 세모꼴인 수원삼성, 서울, 비스듬한 좁은 칸이 많은 부천
    for (const sid of ['suwon', 'seoul', 'bucheon']) {
      pg = await open(b, { url: URL + '?s=' + sid + '#edit' });
      await pg.setViewportSize({ width: 1280, height: 1300 });
      r = await pg.evaluate(() => {
        SECTIONS.forEach((s, i) => { state.rows[s.id].max ||= 500; state.rows[s.id].remain = i % 7 ? 100 + i : 0; }); document.body.classList.remove('editing'); render(); scrollTo(0, 0);
        const bad = [], zones = [...document.querySelectorAll('#board path[data-z]')];
        zones.forEach(el => { const id = el.getAttribute('data-z'); let n = 0;
          for (let t = el.nextElementSibling; t && t.tagName === 'text' && !t.hasAttribute('transform'); t = t.nextElementSibling) { const q = t.getBoundingClientRect();
            for (const fx of [0.12, 0.88]) for (const fy of [0.25, 0.75]) if (!document.elementsFromPoint(q.x + q.width * fx, q.y + q.height * fy).some(e => e.getAttribute('data-z') === id)) n++; }
          if (n) bad.push(id + ':' + n); });
        return { n: zones.length, flat: document.querySelectorAll('#board path[data-z] + text:not([transform])').length, bad };
      });
      await pg.context().close();
      check(`구역 글자가 칸 안에 (${sid}: 칸 ${r.n}개 중 가로 글자 ${r.flat}개)`, r.flat > 10 && !r.bad.length, JSON.stringify(r));
    }
    pg = await open(b);
    await pg.waitForTimeout(300);
    r = await pg.evaluate(() => {
      newGame(); Object.assign(state, { opp: '제주SK', date: '2026-11-28T14:00', at: '2026-11-26T14:00' }); state.rows.R10.remain = 26; state.rows.원정석.remain = 1000; state.rows.원정석.max = 1235;  /* 원정석 총석을 정해 둠 (평소 값 11/25 1235 -> 1500) */
      history = ['2026-11-20T11:00', '2026-11-22T20:00', '2026-11-24T09:30', '2026-11-25T18:00', '2026-11-26T09:00'].map((at, i) => ({ at: at + ':00+09:00', opponent: '제주SK', kickoff: '2026-11-28T14:00:00+09:00', booked: 6976 + i * 400, cap: 11542, awayBooked: 100 + i * 20, awayCap: 1235, unknown: 0 })); render();
      // 가로축 글자(날짜 줄)끼리 겹치지 않는지: 같은 높이의 글자 상자가 서로 닿지 않음
      const days = [...document.querySelectorAll('#trend text')].filter(t => /^\d\d\.\d\d\(.\)$/.test(t.textContent)).map(t => t.getBoundingClientRect()).filter(q => q.x < innerWidth / 2).sort((a, b) => a.x - b.x);
      return { n: days.length, overlap: days.some((q, i) => i && q.x < days[i - 1].right + 2), txt: document.getElementById('trend').textContent.includes('14:00 경기 시작') };
    });
    await pg.context().close();
    check('추이 그래프 가로축: 날짜와 시각 두 줄, 점 6개 + 예상이어도 옆 글자와 겹치지 않음', r.n === 7 && !r.overlap && r.txt, JSON.stringify(r));
    // (11/25 총석을 구역 총석 합으로 바꿔 이 상황의 홈 예매가 10,281 -> 9,257: 기록 자료도 1,024석 낮춰 늘어나는 모양을 그대로 둠)
    // 예상 점선은 줄어든 구간을 늘이지 않음(11/18 인천 vs 울산 원정석 −52석 -> 예상 −268석): 원정석 300 -> 280 -> 235 는 예상 없음, 홈석은 늘어서 예상
    pg = await open(b); await pg.waitForTimeout(300);
    r = await pg.evaluate(() => {
      newGame(); Object.assign(state, { opp: '제주SK', date: '2026-11-28T14:00', at: '2026-11-26T14:00' }); state.rows.R10.remain = 26; state.rows.원정석.remain = 1000; state.rows.원정석.max = 1235;  /* 원정석 총석을 정해 둠 (평소 값 11/25 1235 -> 1500) */
      history = ['2026-11-24T09:30', '2026-11-26T09:00'].map((at, i) => ({ at: at + ':00+09:00', opponent: '제주SK', kickoff: '2026-11-28T14:00:00+09:00', booked: 9476, cap: 11542, awayBooked: 300 - i * 20, awayCap: 1235, unknown: 0 })); render();
      return [...document.querySelectorAll('#trend text')].map(t => t.textContent).filter(t => t.startsWith('예상')).join('/'); });
    await pg.context().close();
    check('추이 예상: 줄어든 원정석은 예상 점선 없음, 늘어난 홈석만 예상', r === '예상 +26석', r);
  }
  // 원정 구장의 홈 팀 쪽은 구단 상징 색 (강원 주황, 전북 초록, 김천 빨강, 울산은 기본 파랑), 원정 응원 쪽은 보라 그대로
  {
    const out = {};
    for (const [sid, hostZone, ourZone] of [['gangwon', 'E2', 'S2'], ['jeonbuk', 'E1G', 'S1A'], ['gimcheon', 'W12', 'S12'], ['ulsan', 'E5', 'N2']]) {
      const pg = await open(b, { url: URL + '?s=' + sid + '#edit' });
      out[sid] = await pg.evaluate(([h, o]) => { [h, o].forEach(id => Object.assign(state.rows[id], { max: 100, remain: 10 })); render();
        const fill = id => document.querySelector(`#board [data-z="${id}"]`).getAttribute('fill'); return [fill(h), fill(o), (document.getElementById('board').textContent.match(/쪽 \(같은 구간, (..)\)/) || [])[1]].join(); }, [hostZone, ourZone]);
      await pg.context().close();
    }
    { const pg = await open(b, { url: URL + '?s=jeonbuk&test=seoul#edit' });
      out.test = await pg.evaluate(() => { ['E1G', 'S1A'].forEach(id => Object.assign(state.rows[id], { max: 100, remain: 10 })); render(); const fill = id => document.querySelector(`#board [data-z="${id}"]`).getAttribute('fill'), t = document.getElementById('board').textContent;
        return [fill('E1G'), fill('S1A'), /빨강 = 북패 원정석 쪽/.test(t), document.querySelectorAll('#board image, #stadium image').length].join(); });  // 사이트 화면은 서울 = 북패
      await pg.context().close(); }
    check('시험 페이지(전북 vs 서울): 원정석 쪽은 서울 구단 색 빨강, 전북 쪽은 초록, 안양 앰블럼 없음', out.test === '#145f2c,#761212,true,0', out.test);
    // 시험 페이지(인천 vs 울산): 티켓링크 머리글 '인천 유나이티드 vs 울산 HD FC', 'E3구역 132 석'을 받음. 둘 다 파랑이라 울산(원정석 쪽)은 둘째 색 노랑
    { const pg = await open(b, { url: URL + '?s=incheon&test=ulsan#edit' });
      out.ic = await pg.evaluate(() => { const k = fcIngest('인천 유나이티드 vs 울산 HD FC\n인천축구전용경기장 | 2026.11.21(토) 16:30\n등급 선택\nExciting석\n1495 석\nE3구역\n132 석\n원정석\n500 석');
        ['E4', 'N3'].forEach(id => Object.assign(state.rows[id], { max: 100, remain: 10 })); render(); const f = id => document.querySelector(`#board [data-z="${id}"]`).getAttribute('fill');
        return [k.ok, state.rows.E3.remain, document.title, f('E4'), f('N3'), /노랑 = 울산 원정석 쪽/.test(document.getElementById('board').textContent)].join(); });
      await pg.context().close(); }
    // 다른 기기에서 발행(11/18 사용자, 포항): 이 브라우저에 숫자가 없거나 발행본이 더 나중이면 입력 화면이 발행본(미판매 포함)을 불러옴, 이 브라우저가 더 나중이면 그대로
    { const PUB = { app: 'fc-anyang-seats', version: 1, updatedAt: '2026-11-17T20:12:00+09:00', match: { kickoff: '2026-11-21T14:00:00+09:00' }, sections: [{ id: 'A1', remain: 261, max: 300 }, { id: 'E7', remain: null, unsold: true }] };
      const pg = await open(b, { url: URL + '?s=pohang#edit', data: { 'pohang/latest.json': PUB } }); await pg.waitForTimeout(800);
      const f = () => [state.rows.A1.remain, state.rows.A1.max, JSON.parse(localStorage.getItem(OFFKEY)).join(), state.at, !$('restore').hidden].join();
      out.dev = [await pg.evaluate(f)];
      await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem(KEY)); Object.assign(s, { at: '2026-11-17T10:00' }); s.rows.A1 = { remain: 5, max: 38 }; localStorage.setItem(KEY, JSON.stringify(s)); localStorage.setItem(OFFKEY, '[]'); });
      await pg.reload(); await pg.waitForTimeout(800); out.dev.push(await pg.evaluate(f));
      await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem(KEY)); Object.assign(s, { at: '2026-11-18T09:00' }); s.rows.A1 = { remain: 5, max: 38 }; localStorage.setItem(KEY, JSON.stringify(s)); });
      await pg.reload(); await pg.waitForTimeout(800); out.dev.push(await pg.evaluate(() => [state.rows.A1.remain, state.rows.A1.max, state.at, /발행하지 않은 숫자/.test(document.getElementById('note').innerText)].join()));
      await pg.context().close(); }
    check('다른 기기에서 발행: 입력 화면이 발행본(A1 261/300, 미판매 E7)을 불러옴, 옛 숫자는 되살리기로 남김, 이 브라우저가 더 나중이면 그대로 두고 알림',
      out.dev.join(' / ') === '261,300,E7,2026-11-17T20:12,false / 261,300,E7,2026-11-17T20:12,true / 5,38,2026-11-18T09:00,true', out.dev.join(' / '));
    // 인천 원정석 N1~N7: N7 은 평소 미판매라 처음 열 때와 새 경기에서 미판매로 시작, 0석이 와도 그대로, 잔여가 보이면 알림, 사람이 끄면 받음
    { const pg = await open(b, { url: URL + '?s=incheon#edit' });
      out.n7 = await pg.evaluate(() => { const H = '인천 유나이티드 vs FC안양\n인천축구전용경기장 | 2026.12.05(토) 14:00\n등급 선택\n원정석\n1142 석\nN1구역\n144 석\nN6구역\n292 석\n', st = () => document.getElementById('status').innerText, o = [state.rows.N7.off];
        fcIngest(H + 'N7구역\n0 석'); o.push(state.rows.N7.off, state.rows.N7.remain, state.rows.N1.remain);
        fcIngest(H + 'N7구역\n40 석'); o.push(state.rows.N7.off, /미판매로 둔 N7에 잔여 40석이 보입니다/.test(st()));
        document.querySelector('tr[data-id="N7"] [data-a=off]').click(); fcIngest(H + 'N7구역\n40 석'); o.push(state.rows.N7.off, state.rows.N7.remain);
        newGame(); o.push(state.rows.N7.off); return o.join(); });
      await pg.context().close(); }
    // 인천 등급 목록(11/17 사용자 화면): 휠체어석(E석), (W석) 아래 E3, 하이네켄 테이블석, 라탄석1구역은 읽지 않음. V1~V3 은 골드, 클래식, 하프 아래 같은 이름이라 더함, 0석 등급은 펼치지 않아도 0
    { const pg = await open(b, { url: URL + '?s=incheon#edit' });
      out.wc = await pg.evaluate(() => { const H = '인천 유나이티드 vs FC안양\n인천축구전용경기장 | 2026.12.05(토) 14:00\n등급 선택\nExciting석\n1476 석\nE3구역\n134 석\n', st = () => document.getElementById('status').innerText, o = [];
        fcIngest(H + '프리미엄 골드\n6 석\nV1구역\n0 석\nV2구역\n1 석\nV3구역\n5 석\n프리미엄 클래식\n15 석\n프리미엄석 하프\n0 석\n하이네켄 테이블석(2인)\n0 석\n하이네켄 테이블석\n0 석\n휠체어석(E석)\n74 석\nE3구역\n16 석\n하이네켄 테이블석\n14 석\n휠체어석(W석)\n56 석\nW4구역\n16 석\n라탄석1구역\n14 석\n원정석\n1129 석\nN1구역\n144 석');
        o.push(state.rows.E3.remain, state.rows.하이네켄테이블석.remain, state.rows.W4.remain, state.rows.라탄석1.remain, state.rows.N1.remain, state.rows.V2.remain, state.rows.V3.remain, /V2: 골드 등급만 받음\. 클래식 등급도/.test(st()));
        fcIngest(H + '프리미엄 클래식\n15 석\nV1구역\n0 석\nV2구역\n3 석\nV3구역\n12 석\n프리미엄석 하프\n0 석');
        o.push(state.rows.V1.remain, state.rows.V2.remain, state.rows.V3.remain, /등급도 눌러야/.test(st())); return o.join(); });
      await pg.context().close(); }
    check('인천: 휠체어석 아래 구역은 읽지 않음(E3 134, 하이네켄 0, W4·라탄석1 모름), V1~V3 은 골드, 클래식, 하프를 더함(V2 1 -> 4, V3 5 -> 17), 못 받은 등급은 알림', out.wc === '134,0,,,144,1,5,true,0,4,17,false', out.wc);
    check('인천 원정석 N1~N7: N7 은 처음과 새 경기에서 미판매, 0석이 와도 그대로, 잔여가 보이면 알림, 사람이 끄면 숫자를 받음', out.n7 === 'true,true,,144,true,true,false,40,true', out.n7);
    check('시험 페이지(인천 vs 울산): 받음(E3 132), 인천 쪽 파랑, 울산 원정석 쪽은 둘째 색 노랑', out.ic === 'true,132,인천유나이티드 vs 울산HD 예매현황 (시험),#24508f,#7d5e00,true', out.ic);
    { const pg = await open(b, { url: URL + '?s=jeonbuk#edit' });
      out.corner = await pg.evaluate(() => [SECTIONS.find(x => x.id === '코너아').ours, SECTIONS.filter(x => x.ours).length].join());
      await pg.context().close(); }
    check("전북 코너 아(원정석 코너 테이블)는 원정석 쪽", out.corner === 'true,11', out.corner);
    { const pg = await open(b, { url: URL + '?s=jeonbuk#edit' });
      out.ink = await pg.evaluate(() => [look({}, { remain: 60, max: 100 }).ink, look({ ours: true }, { remain: 60, max: 100 }).ink, look({}, { remain: 10, max: 100 }).ink].join());
      await pg.context().close(); }
    check('칸 글자색: 연한 초록 칸(전북 25~49%)은 진한 글자, 보라(원정석 25~49%)와 진한 초록(75% 이상)은 흰 글자', out.ink === '#0f3d1e,#fff,#fff', out.ink);
    check('원정 구장 홈 팀 쪽은 구단 상징 색(90% 예매 칸): 강원 주황, 전북 초록, 김천 빨강, 울산 파랑 / 원정 응원 쪽은 보라', out.gangwon === '#9c4a08,#3e1a78,주황' && out.jeonbuk === '#145f2c,#3e1a78,초록' && out.gimcheon === '#761212,#3e1a78,빨강' && out.ulsan === '#24508f,#3e1a78,파랑', JSON.stringify(out));
  }
  // 발행한 총석(max.json)은 입력 화면을 열 때 기본 총석이 됨: 코드 기본값(R10 126)보다 우선, 모르던 구역(일반지정석)도 채움, 이 브라우저에서 사람이 고친 칸은 그대로
  {
    const pg = await open(b, { data: { 'max.json': { app: 'fc-anyang-seats', updatedAt: '2026-11-16T14:00:00+09:00', max: { R10: 128, 일반지정석: 1500, R11: 70, 없는구역: 5 } } } });
    await pg.waitForFunction(() => state.rows.R10.max === 128);
    r = await pg.evaluate(async () => {
      const out = { a: [state.rows.R10.max, state.rows.일반지정석.max, state.rows.R11.max, KNOWN_MAX.일반지정석].join() };
      const e = document.querySelector('tr[data-id=R11] [data-k=max]'); e.value = 63; e.dispatchEvent(new Event('input', { bubbles: true })); state.rows.R10.max = 126; await loadMax();
      out.b = [state.rows.R10.max, state.rows.R11.max].join(); document.getElementById('modeMax').click(); out.st = document.getElementById('status').textContent; return out;
    });
    await pg.context().close();
    check('발행한 총석을 기본 총석으로 받음 (코드 값보다 우선, 사람이 고친 칸은 그대로, 총석 집계 화면에 발행 시각)', r.a === '128,1500,70,1500' && r.b === '128,63' && /발행한 총석 3개 구역 \(11\.16 14:00\)/.test(r.st), JSON.stringify(r));
  }
  // 전북(11/17 티켓링크 화면): 구역 줄이 'W-1K 90 석'(하이픈, '구역' 글자 없음). A 테이블과 A 커플이 둘 다 구역 'W-1K'라 앞의 등급 줄로 칸을 가림. W 1층에 H 테이블 1F, A 테이블 1K, W 패밀리 1L, 커플 칸
  {
    const pg = await open(b, { url: URL + '?s=jeonbuk#edit' });
    r = await pg.evaluate(() => { const H = '전북현대 vs FC안양\n전주월드컵경기장 | 2026.12.05(토) 14:00\n등급 선택\n', f = t => JSON.stringify(parseText(H + t).found);
      return { table: f('S 중립\n3354 석\nA 테이블\n90 석\nW-1K\n90 석\nA 커플\n0 석\nW 패밀리\n8 석'), couple: f('A 테이블 90 석\nA 커플 5 석\nW-1K 5 석\nH 테이블 11 석\nW-1F 11 석\nS-1C 120 석'),
        ids: ['W1F', 'W1K', 'W1L', 'W1F커플', 'W1K커플'].every(id => state.rows[id]) + '|' + ['W-1K', 'A 커플', 'w1l'].map(zoneId).join() }; });
    await pg.context().close();
    check("전북: 'W-1K 90 석' 줄을 받음, 같은 W-1K 도 A 테이블 아래는 테이블 칸, A 커플 아래는 커플 칸, W 1층에 1F, 1K, 1L 과 커플 칸", r.table === '{"W1K":90,"W1K커플":0}' && r.couple === '{"W1K커플":5,"W1F":11,"S1C":120}' && r.ids === 'true|W1K,W1K커플,W1L', JSON.stringify(r));
  }
  // 전북 티켓링크 PC 화면(11/17 사용자 캡처): 등급을 누르면 아래에 구역 줄이 펼쳐짐('W 센터 166 석' 아래 'W-1G 36 석' ...). 이름과 숫자는 flex 칸이라 줄로 나뉘어 보냄.
  // A 테이블과 A 커플은 둘 다 구역 'W-1K'(선택한 줄은 ✓). 스크립트 14판이 'W-1K' 줄도 보내고, 현황판은 바로 앞 등급 줄로 칸을 가림. 없는 구역 코드는 알림, 'K 90석' 같은 찌꺼기 없음
  {
    const src = fs.readFileSync(path.join(ROOT, 'fc-anyang-send.user.js'), 'utf8');
    const row = (a, b, sub) => `<div style="display:flex;justify-content:space-between${sub ? ';padding-left:20px' : ''}"><span>${a}</span><span>${b}</span></div>`;
    const JB = '<div><h2>전북현대 vs FC안양</h2><div>전주월드컵경기장</div><div>2026.12.05(토) 14:00</div><div>홍길동님</div><h3>등급 선택</h3>' + row('전체', '')
      + row('W 센터', '166 석') + row('W-1G', '36 석', 1) + row('W-1H', '80 석', 1) + row('W-1J', '50 석', 1) + row('A 테이블', '90 석') + row('W-1K', '90 석', 1)
      + row('A 커플', '0 석') + row('✓ W-1K', '0 석', 1) + row('W 패밀리', '8 석') + row('W-1L', '8 석', 1) + row('H 벤치', '87 석') + row('W-1C', '40 석', 1) + row('W-1E', '5 석', 1) + '</div>';
    const tk = await b.newPage(); await tk.setContent(JB);
    await tk.evaluate(([src]) => { window.__set = {}; window.__l = {}; window.GM_setValue = (k, v) => (__set[k] = v); window.GM_getValue = () => undefined; window.GM_addValueChangeListener = (k, f) => (__l[k] = f); window.unsafeWindow = window;
      const o = Element.prototype.attachShadow; Element.prototype.attachShadow = function (i) { return o.call(this, { ...i, mode: 'open' }); }; (0, eval)(src.replace(/location\.hostname/g, '"www.ticketlink.co.kr"')); }, [src]);
    await tk.waitForTimeout(2200);
    const sent = await tk.evaluate(() => __set.text?.s || '');
    await tk.close();
    const pg = await open(b, { url: URL + '?s=jeonbuk#edit' });
    r = await pg.evaluate(s => { const k = fcIngest(s); return { k, v: ['W1G', 'W1H', 'W1J', 'W1K', 'W1K커플', 'W1L', 'W1C'].map(id => state.rows[id].remain).join(), st: document.getElementById('status').innerText }; }, sent);
    await pg.context().close();
    check('전북 실제 화면 흐름: 등급 아래 펼친 구역 줄(W-1G 등, 줄 나뉨)을 스크립트가 보내고, W-1K 는 A 테이블 / A 커플 칸으로 가려 넣음, 없는 구역(W-1E)은 알림, 등급 찌꺼기 없음',
      /W-1K\n90 석\nA 커플\n0 석\n✓ W-1K\n0 석/.test(sent) && r.k.ok && r.v === '36,80,50,90,0,8,40' && /현황판에 없는 구역 이름: W-1E/.test(r.st) && !/[^가-힣]K 90석|등급: .*\bK 90/.test(r.st), JSON.stringify({ sent, r }));
  }
  // 전북 테이블 줄(11/17): W 테이블 아래 W-2B~W-2R 8개(W2F~W2M 칸 추가). E 2B 처럼 한 구역에 앞줄 테이블석과 뒷줄 일반석이 같은 이름이면 한 칸에서 'E 테이블' 아래 숫자와 'E 일반' 아래 숫자를 더함.
  // 한쪽만 받으면 알림, 다른 쪽을 받으면 더함, 테이블만 다시 받으면 그쪽만 바뀜, 좌석 그림(블록 전체 'E2B구역 N석')이나 손으로 넣은 잔여는 블록 전체
  {
    const pg = await open(b, { url: URL + '?s=jeonbuk#edit' });
    r = await pg.evaluate(() => { const H = '전북현대 vs FC안양\n전주월드컵경기장 | 2026.12.05(토) 14:00\n등급 선택\n', st = () => document.getElementById('status').innerText, E = () => state.rows.E2B.remain, out = {};
      fcIngest(H + 'W 테이블\n187 석\nW-2B\n8 석\nW-2D\n19 석\n✓ W-2F\n40 석\nW-2H\n14 석\nW-2K\n24 석\nW-2M\n48 석\nW-2P\n19 석\nW-2R\n15 석'); out.w = ['W2F', 'W2H', 'W2K', 'W2M', 'W2B'].map(id => state.rows[id].remain).join();
      fcIngest(H + 'E 테이블\n150 석\n✓ E-2B\n13 석'); out.a = E() + '|' + /E2B: 테이블석과 일반석 중 테이블석만 받음/.test(st());
      fcIngest(H + 'E 일반\n7155 석\nE-2A\n300 석\n✓ E-2B\n40 석'); out.b = E() + '|' + state.rows.E2A.remain + '|' + /테이블석만 받음/.test(st());
      fcIngest(H + 'E 테이블\n150 석\n✓ E-2B\n10 석'); out.c = E();
      fcIngest(H + 'E2B구역\n45 석'); out.d = E() + '|' + !!state.rows.E2B.parts;
      fcIngest(H + 'E 테이블\n150 석\n✓ E-2B\n9 석'); const e = document.querySelector('tr[data-id=E2B] [data-k=remain]'); e.value = 60; e.dispatchEvent(new Event('input', { bubbles: true })); out.e = E() + '|' + !!state.rows.E2B.parts;
      return out; });
    await pg.context().close();
    check('전북 테이블 줄: W-2F~W-2M 칸, E2B 는 E 테이블(13)과 E 일반(40)을 더해 53, 한쪽만이면 알림, 테이블만 다시 받으면 50, 좌석 그림(블록 전체)과 손으로 넣은 잔여는 그대로', r.w === '40,14,24,48,8' && r.a === '13|true' && r.b === '53|300|false' && r.c === 50 && r.d === '45|false' && r.e === '60|false', JSON.stringify(r));
  }
  // 시험 페이지(?s=jeonbuk&test=seoul): 전북현대 vs FC서울 글자를 받고, 안양 전북 원정 현황판과 입력값, 발행 폴더(test/jeonbuk/)가 따로, 구장 버튼 숨김, 링크와 퍼가기 코드는 시험 주소.
  // 티켓링크 머리글의 '전주 월드컵경기장'(빈칸)도 받음. 안양 전북 원정 현황판은 전북 vs 서울 글자를 넘김. 보내기 스크립트는 시험 페이지가 알려 준 팀 이름('서울') 경기를 보냄
  {
    const JS = '전북현대모터스 vs FC서울\n전주 월드컵경기장 | 2026.11.21(토) 14:00\n등급 선택\nE 일반\n7145 석\nE-1A\n296 석\nE-2B\n59 석';
    let pg = await open(b, { url: URL + '?s=jeonbuk&test=seoul#edit' });
    r = await pg.evaluate(t => { const k = fcIngest(t), rec = record();
      return { k: k.ok, E1A: state.rows.E1A.remain, key: KEY, title: document.title, away: rec.match.away + '|' + rec.match.test, img: rec.images.board, nav: document.getElementById('stadiums').hidden, want: document.body.dataset.want, emb: embedCode(),
        anyang: fcIngest('전북현대 vs FC안양\n전주 월드컵경기장 | 2026.12.05(토) 14:00\n등급 선택\nE-1A\n10 석').why, board: document.getElementById('board').textContent.includes('전북현대 vs 북패 예매 현황') }; }, JS);
    const main = await pg.evaluate(() => localStorage.getItem('fc-anyang-seat-status-jeonbuk'));
    await pg.context().close();
    pg = await open(b, { url: URL + '?s=jeonbuk#edit' });
    const r2 = await pg.evaluate(t => [fcIngest(t).why, fcIngest('전북현대 vs FC안양\n전주 월드컵경기장 | 2026.12.05(토) 14:00\n등급 선택\nE-1A\n10 석').ok, state.rows.E1A.remain].join('|'), JS);
    await pg.context().close();
    check('시험 페이지(전북 vs 서울): 받음, 입력값과 발행 폴더 따로, 제목과 현황판 머리글, 구장 버튼 숨김, 퍼가기 코드는 시험 주소, 안양 경기 글자는 넘김', r.k && r.E1A === 296 && r.key === 'fc-anyang-seat-status-jeonbuk-test' && r.title === '전북현대 vs 북패 예매현황 (시험)' && r.away === 'FC서울|true'
      && r.img.endsWith('/data/test/jeonbuk/latest.png') && r.nav && r.want === '서울' && /\?s=jeonbuk&test=seoul&embed/.test(r.emb) && r.anyang === '받은 글자가 FC서울 경기가 아님' && r.board && main === null, JSON.stringify(r));
    check("안양 전북 원정 현황판: 전북 vs 서울 글자는 넘기고, '전주 월드컵경기장'(빈칸) 안양 경기 글자는 받음", r2 === '받은 글자가 FC안양 경기가 아님|true|10', r2);
    // 보내기 스크립트: 시험 페이지가 '서울'을 알리면 전북 vs 서울 예매 화면을 보내고, 신호가 없으면(보통) 안양 경기가 아니라 보내지 않음
    const src = fs.readFileSync(path.join(ROOT, 'fc-anyang-send.user.js'), 'utf8');
    const send = async store => { const tk = await b.newPage(); await tk.setContent('<div><h2>전북현대모터스 vs FC서울</h2><div>전주 월드컵경기장 | 2026.11.21(토) 14:00</div><h3>등급 선택</h3><div style="display:flex"><span>E-1A</span><span>296 석</span></div></div>');
      await tk.evaluate(([src, store]) => { window.__set = {}; window.GM_setValue = (k, v) => (__set[k] = v); window.GM_getValue = k => store[k]; window.GM_addValueChangeListener = () => {}; window.unsafeWindow = window;
        const o = Element.prototype.attachShadow; Element.prototype.attachShadow = function (i) { return o.call(this, { ...i, mode: 'open' }); }; (0, eval)(src.replace(/location\.hostname/g, '"www.ticketlink.co.kr"')); }, [src, store]);
      await tk.waitForTimeout(2200); const v = await tk.evaluate(() => [__set.ping?.state, !!__set.text].join()); await tk.close(); return v; };
    const withTest = await send({ board: { at: Date.now(), page: '?s=jeonbuk&test=seoul', want: '서울' } }), normal = await send({});
    check("보내기 스크립트 15판: 시험 페이지가 알린 팀('서울') 경기는 보내고, 보통은 안양 경기만", withTest === 'seat,true' && normal === 'idle,false', JSON.stringify({ withTest, normal }));
  }
  // 전북 S-2G(11/17 사용자 화면): 'S 중립' 아래 S-2G 164(위 큰 칸)와 'S 원정' 아래 S-2G 115(아래 작은 칸)는 다른 칸. 원정 쪽이 중립 쪽을 덮어쓰던 것(발행본 S2G 111 -> 37%)
  {
    const pg = await open(b, { url: URL + '?s=jeonbuk#edit' });
    r = await pg.evaluate(() => { const H = '전북현대 vs FC안양\n전주 월드컵경기장 | 2026.12.05(토) 14:00\n등급 선택\n';
      fcIngest(H + 'S 원정\n2425 석\nS-1A\n199 석\nS-2F\n78 석\nS-2G\n115 석'); fcIngest(H + 'S 중립\n3351 석\nS-1D\n609 석\n✓ S-2G\n164 석\nS-2H\n114 석');
      return [state.rows.S2G.remain, state.rows['S2G원정'].remain, !!SECTIONS.find(x => x.id === 'S2G원정').ours, !!SECTIONS.find(x => x.id === 'S2G').ours].join(); });
    await pg.context().close();
    check("전북 S-2G: 'S 중립' 아래는 S2G(164, 전북 쪽), 'S 원정' 아래는 S2G 원정(115, 원정석 쪽)", r === '164,115,true,false', r);
  }
  // 전북 코너 테이블 목록(11/17 사용자 화면): '코너 테이블' 아래 '가구역'~'사구역' -> 코너 가~사 칸
  {
    const pg = await open(b, { url: URL + '?s=jeonbuk#edit' });
    r = await pg.evaluate(() => { fcIngest('전북현대 vs FC안양\n전주월드컵경기장 | 2026.12.05(토) 14:00\n등급 선택\n코너 테이블\n368 석\n가구역\n75 석\n나구역\n21 석\n✓ 다구역\n18 석\n라구역\n35 석\n마구역\n64 석\n바구역\n72 석\n사구역\n83 석\n원정석 코너 테이블\n42 석');
      return ['가', '나', '다', '라', '마', '바', '사'].map(x => state.rows['코너' + x].remain).join() + '|' + /현황판에 없는 구역/.test(document.getElementById('status').innerText) + '|' + ['가구역', '코너 테이블 (다)', '코너 다'].map(zoneId).join(); });
    await pg.context().close();
    check("전북 코너 테이블: '가구역'~'사구역' 줄이 코너 가~사 칸으로 (합 368), 좌석 그림 제목 '코너 테이블 (다)'도", r === '75,21,18,35,64,72,83|false|코너가,코너다,코너다', r);
  }
  // 전북 코너 테이블 좌석 그림(11/17): 제목이 한글 '코너 테이블 (아)'라 영문으로 못 읽음 -> 한글 인식 글자의 줄에서 구역을 찾음. 그래도 모르면 묻는 창에 표의 이름 그대로('코너 아') 넣으면 받음, 없는 이름이면 다시 물음
  {
    const pg = await open(b, { url: URL + '?s=jeonbuk#edit' });
    const answers = ['코너 테이블', '코너 아'], asked = [];
    pg.on('dialog', d => { asked.push(d.message().split('\n')[1]); d.accept(answers.shift() ?? ''); });
    r = await pg.evaluate(async () => {
      const out = { z: ['코너 아', '코너 테이블 (아)', '코너테이블아', 'W-1K'].map(zoneId).join() };
      // 글자 인식기와 칸 세기는 흉내: 한글 인식 글자에 제목과 줄 번호(T24 등)만 있고 영문으로는 이름을 못 읽은 좌석 그림
      const c = Object.assign(document.createElement('canvas'), { width: 200, height: 150 }), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 200, 150);
      const file = new File([await new Promise(r => c.toBlob(r))], 'corner.png', { type: 'image/png' }), counted = [];
      const kor = { setParameters: async () => {}, recognize: async () => ({ data: { text: '코너 테이블 (아)\nT24\nT23\nT01 T02 T03' } }) }, eng = { setParameters: async () => {}, recognize: async () => ({ data: { text: '', words: [], lines: [] } }) };
      const keep = seatMap; seatMap = async () => ({ id: null, remain: 30, total: 88, dropped: 0, blocked: 0 });
      await readShot(file, false, kor, eng, counted); seatMap = keep; out.auto = counted.map(m => m.id).join();
      document.getElementById('modeMax').click();
      readShot = async (f, first, kor, eng, counted) => { counted.push({ id: null, remain: 30, total: 88, dropped: 0, blocked: 0 }); return ''; };
      await ocr([file]); out.asked = [state.rows['코너아'].max, document.getElementById('status').innerText.split('\n')[0]].join('|');
      return out;
    });
    await pg.context().close();
    check("전북 코너 테이블: '코너 테이블 (아)' 제목으로 구역을 찾음, 묻는 창에 '코너 아'(표의 이름) 넣으면 받음, 없는 이름은 다시 물음", r.z === '코너아,코너아,코너아,W1K' && r.auto === '코너아' && /^88\|총석을 넣었습니다 .*코너 아 88석/.test(r.asked)
      && asked.length === 2 && /'코너 테이블'은\(는\) 현황판에 없는 구역 이름입니다/.test(asked[1]), JSON.stringify({ r, asked }));
  }
  // 입력 화면을 열 때 보기 화면(발행본)보다 늦은 숫자가 있으면 알림 (전북 시험 페이지 S2G: 입력 7%, 보기 37%)
  {
    const pg = await open(b, { url: URL + '?s=jeonbuk&test=seoul#edit', data: { 'latest.json': { app: 'fc-anyang-seats', updatedAt: '2026-11-17T14:44:00+09:00', match: {}, sections: [] } } });
    await pg.evaluate(() => { state.rows.S2G.remain = 164; state.at = '2026-11-17T15:30'; save(); });
    await pg.reload(); await pg.waitForTimeout(800);
    r = await pg.evaluate(() => document.getElementById('pubNote').textContent);
    await pg.context().close();
    check('입력 화면을 열 때 발행하지 않은 숫자 알림 (이 화면 15:30 집계, 보기 화면 14:44 발행본)', /발행하지 않은 숫자가 있습니다: 이 화면은 11\.17 15:30 집계, 보기 화면은 11\.17 14:44 발행본/.test(r), r);
  }
  // 11/12 점검에서 찾은 버그
  {
    // 원정 화면은 FC안양 경기 글자만: 같은 경기장의 다른 팀 경기, 다른 경기장 글자는 넘김 (안양 원정 숫자를 지우지 않음). 'E14구역' 이 등급 'E 1석' 으로 읽히지 않음
    let pg = await open(b, { url: URL + '?s=gimcheon#edit' });
    r = await pg.evaluate(() => {
      fcIngest('김천상무 vs FC안양\n김천종합운동장 | 2026.11.07(토) 16:30\n등급 선택\nE14구역\n50 석'); const st = document.getElementById('status').innerText;
      const k = fcIngest('김천상무 vs 울산HD\n김천종합운동장 | 2026.11.21(토) 14:00\n등급 선택\nE14구역\n9 석');
      return { st, why: k.why, E14: state.rows.E14.remain, date: state.date };
    });
    await pg.context().close();
    pg = await open(b, { url: URL + '?s=seoul#edit' });
    r.seoul = await pg.evaluate(() => fcIngest('서울이랜드 vs FC안양\n목동종합운동장 | 2026.12.05(토) 14:00\n등급 선택\nEA구역\n50 석').why + '|' + state.rows.EA.remain);
    await pg.context().close();
    check("원정 화면: 다른 팀 경기(김천 vs 울산), 다른 경기장(목동) 글자는 넘김, 'E14구역' 이 등급으로 읽히지 않음", !/등급: E 1석/.test(r.st) && /1개 구역을 채웠습니다/.test(r.st) && r.why === '받은 글자가 FC안양 경기가 아님' && r.E14 === 50 && r.date === '2026-11-07T16:30'
      && r.seoul === '받은 글자에 서울월드컵경기장 없음|null', JSON.stringify(r));
    // 놀티켓: 화면을 통째로 복사해 붙여넣기(숫자만 있는 줄), 묶음 합계로 빠진 구역을 채우지 않음(묶음 추정으로), 구역 이름이 '석'으로 끝나도 받음
    pg = await open(b, { url: URL + '?s=suwon#edit' });
    r = await pg.evaluate(() => {
      const dt = new DataTransfer(); dt.setData('text', '수원삼성 vs FC안양 (11.29)\n2026.11.29(토) 2:00 PM\n관람 구역을 선택해 주세요\nS1구역(GATE:4B)\n12\n2층 E석(E15~19)(GATE:3A,3B)\n1,191\nE15\n300\nE16\n200\nE17\n250\nE18\n240');
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
      return { S1: state.rows.S1.remain, E19: state.rows.E19.remain, est: Math.round(stats().est.E19), st: document.getElementById('status').innerText };
    });
    await pg.context().close();
    pg = await open(b, { url: URL + '?s=suwonfc#edit' });
    r.vip = await pg.evaluate(() => { fcIngest('수원FC vs FC안양\n2026.12.05(토) 2:00 PM\n관람 구역을 선택해 주세요\nVIP석\n24\nW6\n30'); return [state.rows.VIP석.remain, state.rows.W6.remain].join(); });
    await pg.context().close();
    check("놀티켓: 붙여넣기(숫자만 줄)도 받음, 묶음 합계로 구역을 채우지 않음(E19 는 ≈ 추정 201), 'VIP석' 다음 줄 24 도 그대로", r.S1 === 12 && r.E19 === null && r.est === 201 && !/등급 합계로 채움/.test(r.st) && r.vip === '24,30', JSON.stringify(r));
    // 요약 글: 구역 숫자가 없으면 예매 줄을 쓰지 않음 (만석 100% 로 읽히던 것). 사람이 넣은 최대는 자동 입력이 늘리지 않고 ⚠
    pg = await open(b);
    r = await pg.evaluate(() => {
      newGame(); const none = summaryText();
      const e = document.querySelector('tr[data-id="일반지정석"] [data-k=max]'); e.value = 1500; e.dispatchEvent(new Event('input', { bubbles: true }));
      fcIngest('FC안양 vs 제주SK\n안양종합운동장 | 2026.11.28(토) 14:00\n등급 선택\n일반 지정석(2층)\n1550 석');
      return { none, max: state.rows.일반지정석.max, st: document.getElementById('status').innerText };
    });
    await pg.context().close();
    check('요약 글: 구역 숫자가 없으면 예매 줄 없음, 사람이 넣은 최대(1500)는 잔여 1550 이 와도 그대로 두고 ⚠', !/11,542석 \/ 11,542석/.test(r.none) && /구역별 잔여석 정보가 아직 없습니다/.test(r.none) && r.max === 1500 && /⚠ 잔여가 최대보다 많음: 일반지정석/.test(r.st), JSON.stringify(r));
    // 발행본의 추정 최대(maxGuess)는 불러와도 추정으로 남음
    pg = await open(b, { url: URL, data: { 'latest.json': { app: 'fc-anyang-seats', version: 1, updatedAt: '2026-11-27T12:00:00+09:00', match: { opponent: '제주SK', kickoff: '2026-11-28T14:00:00+09:00' }, sections: [{ id: '일반지정석', remain: 1000, max: 1426, maxGuess: true }, { id: 'R10', remain: 0, max: 126 }] } } });
    await pg.waitForFunction(() => /마지막 집계/.test(document.getElementById('note').innerText));
    r = await pg.evaluate(() => record().sections.filter(x => x.maxGuess).map(x => x.id).join());
    await pg.context().close();
    check('발행본을 불러와도 추정 최대(maxGuess)는 추정으로 남음', r === '일반지정석', r);
    // 캡처 묶음이 새 경기면 지난 숫자를 먼저 비운 뒤 좌석 그림을 넣음 (지난 경기 잔여 36 과 견줘 버리지 않음). 글자 인식 대신 읽은 결과를 넣어 판단 순서만 봄
    pg = await open(b, { url: URL + '?s=suwon#edit' });
    r = await pg.evaluate(async () => {
      Object.assign(state, { date: '2026-11-07T14:00' }); state.rows.S3.remain = 36;
      readShot = async (f, first, kor, eng, counted) => { if (f.name === 'map.png') { counted.push({ id: 'S3', remain: 300, total: 637, dropped: 0, blocked: 0 }); return ''; } return '수원삼성 vs FC안양\n2026.11.29(토) 2:00 PM\n관람 구역을 선택해 주세요\nE5\n40\n'; };
      await ocr([new File(['x'], 'list.png', { type: 'image/png' }), new File(['x'], 'map.png', { type: 'image/png' })]);
      return { date: state.date, S3: state.rows.S3.remain, E5: state.rows.E5.remain, st: document.getElementById('status').innerText };
    });
    await pg.context().close();
    check('캡처 묶음: 새 경기면 먼저 지난 숫자를 비우고 좌석 그림 숫자를 넣음', r.date === '2026-11-29T14:00' && r.S3 === 300 && r.E5 === 40 && /다른 경기라 지난 숫자를 지웠습니다/.test(r.st) && !/달라 넣지 않았습니다/.test(r.st), JSON.stringify(r));
  }

  // 만든 그림으로 인식 시험: 좌석 그림(색, 칸 크기, 테두리 여러 가지), 등급 목록(글자 크기 여러 가지), PC 화면 전체
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fcseat-')), maker = await b.newPage();
  const shot = async (name, html, w, h) => { await maker.setViewportSize({ width: Math.ceil(w), height: Math.ceil(h) }); await maker.setContent(`<body style="margin:0;background:#fff;font-family:'Noto Sans KR','Noto Sans CJK KR',sans-serif">${html}</body>`); const f = path.join(tmp, name + '.png'); await maker.screenshot({ path: f }); return f; };
  // 남은 칸(색) avail 개 다음에 팔린 칸(회색) sold 개, 한 줄 20칸. 티켓링크처럼 줄 앞에 옅은 줄 번호, 그림 왼쪽 끝에 잘린 옆 구역 칸 (둘 다 세면 안 됨)
  const grid = (label, avail, sold, color, size, outline, front = 0) => {  // front: 맨 앞에 회색 칸 (막힌 줄)
    const cells = [...Array(front).fill('#e6e6e6'), ...Array(avail).fill(color), ...Array(sold).fill('#e6e6e6')].map(c => `<i style="display:inline-block;width:${size}px;height:${size}px;margin:${Math.round(size / 4)}px;background:${c};vertical-align:middle"></i>`);
    const rows = []; for (let i = 0; i < cells.length; i += 20) rows.push(`<div style="white-space:nowrap"><b style="display:inline-block;width:${size * 1.4}px;color:#b4b4b4;font-size:${Math.round(size * 0.9)}px;vertical-align:middle">${rows.length + 1}</b>${cells.slice(i, i + 20).join('')}</div>`);
    return `<div style="padding:20px 30px;position:relative"><i style="position:absolute;left:-${Math.round(size / 2)}px;top:${30 + Math.max(16, size) * 1.5}px;width:${size}px;height:${size}px;background:#e6e6e6"></i>`
      + `<div style="text-align:center;color:#777;font-weight:700;font-size:${Math.max(16, size)}px;margin-bottom:10px">${label}</div>`
      + `<div style="display:inline-block;${outline ? 'outline:3px solid #e33;outline-offset:4px' : ''}">${rows.join('')}</div></div>`;
  };
  const grids = [['W12', 37, 50, '#0d2b45', 14, 0, '?s=gimcheon'], ['S11', 9, 30, '#c2185b', 22, 1, '?s=gimcheon'], ['E21', 12, 8, '#e5e500', 18, 0, '?s=gimcheon'],
    ['N12', 60, 0, '#6a40ad', 12, 0, '?s=gimcheon'], ['R10', 26, 100, '#d2143a', 26, 1, ''], ['W31', 0, 44, '#0d2b45', 16, 0, '?s=gimcheon']];
  for (const [label, avail, sold, color, size, outline, q] of grids) {
    const f = await shot('grid_' + label, grid(label, avail, sold, color, size, outline), 30 * 2 + 20 * size * 1.5 + size * 1.4 + 40, 120 + Math.ceil((avail + sold) / 20) * size * 1.5);
    p = await open(b, { url: URL + q + '#edit' });
    await p.evaluate(() => Object.values(state.rows).forEach(r => r.max = null));  // 총석을 모르는 구장처럼
    await p.setInputFiles('#file', f);
    await p.evaluate(() => window.ocrDone);
    r = await p.evaluate(id => ({ remain: state.rows[id].remain, max: state.rows[id].max, st: document.getElementById('status').innerText.split('\n')[0] }), label);
    check(`좌석 그림 세기: ${label} 남은 ${avail} / 전체 ${avail + sold} (칸 ${size}px${outline ? ', 빨간 테두리' : ''})`, r.remain === avail && r.max === avail + sold, JSON.stringify(r));
    await p.context().close();
  }
  // 막힌 줄 후보: 맨 앞 한 줄(20칸)이 통째로 회색인데 나머지는 거의 남아 있으면 묻고, 확인하면 이번 경기 총석에서 뺌 (표의 −20 으로 되돌림, 새 경기에서 지움). 취소하면 그대로
  {
    const f = await shot('grid_blocked', grid('S12', 55, 5, '#0d2b45', 14, 0, 20), 30 * 2 + 20 * 14 * 1.5 + 14 * 1.4 + 40, 120 + 4 * 14 * 1.5);
    const out = {};
    for (const ok of [true, false]) {
      p = await open(b, { url: URL + '?s=gimcheon#edit' });
      const asked = [];
      p.on('dialog', d => { if (d.type() === 'prompt') return d.accept('S12'); asked.push(d.message()); return ok ? d.accept() : d.dismiss(); });
      await p.setInputFiles('#file', f);
      await p.evaluate(() => window.ocrDone);
      out[ok] = await p.evaluate(() => { const t = stats(), tr = document.querySelector('tr[data-id=S12]'), chip = tr.querySelector('[data-a=unblock]');
        const o = { remain: state.rows.S12.remain, max: state.rows.S12.max, block: state.rows.S12.block ?? 0, cap: t.cap, booked: t.booked, chip: getComputedStyle(chip).display === 'none' ? '' : chip.textContent, rate: tr.cells[4].textContent, st: document.getElementById('status').innerText, rec: record().sections.find(x => x.id === 'S12').blocked ?? 0 };
        chip.click(); o.after = [state.rows.S12.block ?? 0, stats().cap].join(); state.rows.S12.block = 7; newGame(); o.cleared = state.rows.S12.block ?? 0; return o; });
      out[ok].asked = asked.join(' / ');
      await p.context().close();
    }
    const y = out.true, n = out.false;
    check('막힌 줄: 통째로 회색인 줄을 묻고, 확인하면 총석에서 뺌(S12 258 - 20, 예매 183, 예매율 76%, 표 −20, 발행 blocked), −20 을 누르면 되돌림, 새 경기에서 지움',
      /통째로 회색인 줄이 있습니다: S12 20석/.test(y.asked) && y.remain === 55 && y.max === 258 && y.block === 20 && y.cap === 238 && y.booked === 183 && y.chip === '−20' && y.rate === '76%' && y.rec === 20 && /막힌 줄로 보고 이번 경기 총석에서 뺌: S12 20석/.test(y.st) && y.after === '0,258' && y.cleared === 0, JSON.stringify(y));
    check('막힌 줄: 취소하면 그대로 (총석 258, 예매 203)', /통째로 회색인 줄/.test(n.asked) && n.block === 0 && n.cap === 258 && n.booked === 203 && n.chip === '' && n.rec === 0, JSON.stringify(n));
  }
  // 전북 커플석 좌석 그림(11/17): 'A1'~'A12' 칸 이름 상자(회색 바탕에 흰 글자)를 좌석으로 세지 않음(24석). 제목 '커플석A [W1K]'는 A 커플 칸, '테이블석A'면 A 테이블 칸, 한글 제목이 없으면 묻고 '이름이 같은 칸이 여럿'이라고 알림
  {
    const cells = [...Array(12)].map((_, i) => `<span style="display:inline-block;width:22px;margin:0 1px;text-align:center"><b style="display:block;background:#c8c8c8;color:#fff;font:9px sans-serif;margin-bottom:2px">A${i + 1}</b><i style="display:inline-block;width:9px;height:9px;background:#e6e6e6;margin:0 1px"></i><i style="display:inline-block;width:9px;height:9px;background:#e6e6e6;margin:0 1px"></i></span>`).join('');
    const pic = async (name, title) => shot(name, `<div style="padding:14px 20px"><div style="text-align:center;color:#666;font-weight:700;font-size:15px">${title}</div><div style="text-align:center;color:#888;font-size:10px;margin-bottom:8px">(W1K)</div>${cells}</div>`, 400, 110);
    const out = {};
    for (const [key, title] of [['couple', '커플석A'], ['table', '테이블석A'], ['none', '']]) {
      const f = await pic('w1k_' + key, title);
      p = await open(b, { url: URL + '?s=jeonbuk#edit' });
      const asked = [];
      p.on('dialog', d => { asked.push(d.message().split('\n')[1]); d.accept('A 커플'); });
      await p.evaluate(() => document.getElementById('modeMax').click());
      await p.setInputFiles('#file', f); await p.evaluate(() => window.ocrDone);
      out[key] = await p.evaluate(() => [state.rows.W1K.max, state.rows['W1K커플'].max].join('/')) + '|' + asked.join(' ');
      await p.context().close();
    }
    check('전북 커플석 좌석 그림: 칸 이름 상자는 좌석 아님(24석), 커플석 제목은 A 커플, 테이블석 제목은 A 테이블, 제목이 없으면 이름이 같은 칸이 여럿이라고 묻고 답한 칸에', out.couple === '/24|' && out.table === '24/|' && /^\/24\|이름이 같은 칸이 여럿입니다 \(W1K, A 커플\)/.test(out.none), JSON.stringify(out));
  }
  // 떨어진 묶음(한 줄 + 오른쪽 작은 묶음): 현황 집계에서 표의 잔여가 두 묶음의 남은 칸 합과 맞으면 같은 구역으로 더하고, 큰 묶음만과 맞으면 옆 구역으로 뺌 (묻지 않음)
  {
    const seatsHtml = (n, m) => `<span style="display:inline-block;width:${n * 14}px">${[...Array(n)].map((_, i) => `<i style="display:inline-block;width:9px;height:9px;margin:2.5px;background:${i >= 4 && i < 4 + m ? '#c06fb0' : '#e6e6e6'}"></i>`).join('')}</span>`;
    const pic = await shot('grid_twogroups', `<div style="padding:20px 30px;white-space:nowrap"><div style="text-align:center;color:#777;font-weight:700;font-size:16px;margin-bottom:10px">W2K</div>`
      + `<div style="display:inline-block;vertical-align:top">${seatsHtml(20, 12)}</div><div style="display:inline-block;margin-left:60px">${seatsHtml(6, 0).replace(/#e6e6e6/g, '#c06fb0')}<br>${seatsHtml(6, 0).replace(/#e6e6e6/, '#c06fb0').replace(/#e6e6e6/, '#c06fb0').replace(/#e6e6e6/, '#c06fb0').replace(/#e6e6e6/, '#c06fb0')}</div></div>`, 480, 110);
    const out = {};
    for (const known of [22, 12]) {
      p = await open(b, { url: URL + '?s=jeonbuk#edit' });
      p.on('dialog', d => d.type() === 'prompt' ? d.accept('W2K') : d.accept());
      await p.evaluate(k => { state.rows.W2K.max = null; state.rows.W2K.remain = k; }, known);
      await p.setInputFiles('#file', pic); await p.evaluate(() => window.ocrDone);
      out[known] = await p.evaluate(() => [state.rows.W2K.remain, state.rows.W2K.max].join('/') + '|' + document.getElementById('status').innerText.split('\n').filter(l => /떨어져/.test(l)).join(' '));
      await p.context().close();
    }
    check('떨어진 묶음: 표 잔여 22 = 두 묶음 남은 칸 합이면 같은 구역(전체 32), 잔여 12 = 큰 묶음과 맞으면 옆 구역으로 뺌(전체 20)', /^22\/32\|.*같은 구역으로 더했습니다/.test(out[22]) && /^12\/20\|.*떨어져 있는 칸 12개는 옆 구역으로/.test(out[12]), JSON.stringify(out));
  }
  // 총석 집계에서 이미 있는 총석과 다르게 셌으면 묻고, [확인]이면 센 값으로 바꿈 (11/17: 전북 W2K 를 20 으로 발행했는데 잔여가 24 -> 다시 찍어 고칠 때)
  {
    const f = await shot('grid_w2k', grid('W2K', 4, 20, '#c06fb0', 14, 0), 30 * 2 + 20 * 14 * 1.5 + 14 * 1.4 + 40, 120 + 2 * 14 * 1.5);
    const out = {};
    for (const ok of [true, false]) {
      p = await open(b, { url: URL + '?s=jeonbuk#edit' });
      const asked = [];
      p.on('dialog', d => { asked.push(d.message().split('\n')[1] || ''); if (d.type() === 'prompt') return d.accept('W2K'); return ok ? d.accept() : d.dismiss(); });
      await p.evaluate(() => { state.rows.W2K.max = 20; document.getElementById('modeMax').click(); });
      await p.setInputFiles('#file', f); await p.evaluate(() => window.ocrDone);
      out[ok] = await p.evaluate(() => state.rows.W2K.max) + '|' + asked.join(' / ');
      await p.context().close();
    }
    check('총석 집계: 이미 있는 총석(W2K 20)과 다르게 세면(24) 묻고, 확인하면 바꾸고 취소하면 그대로', /^24\|.*W2K: 표 20석 -> 센 24석/.test(out.true) && /^20\|/.test(out.false), JSON.stringify(out));
  }
  // 총석 집계 화면(다른 팀 경기 날 미리): 울산 E12 좌석 그림(남은 37 / 전체 87)을 넣어도 총석만 들어가고 잔여, 경기 정보, 집계 시각, 비교 기준, 발행은 그대로. 같이 찍힌 목록 잔여와 다르면 안 넣음
  {
    const f = await shot('grid_maxonly', grid('E12', 37, 50, '#0d2b45', 14, 0), 30 * 2 + 20 * 14 * 1.5 + 14 * 1.4 + 40, 120 + 5 * 14 * 1.5);
    p = await open(b, { url: URL + '?s=ulsan#edit' });
    const asked = [];
    p.on('dialog', d => { asked.push(d.message()); d.type() === 'prompt' ? d.accept('E12') : d.accept(); });
    const before = await p.evaluate(() => { Object.assign(state, { date: '2026-12-05T14:00', at: '2026-12-01T10:00' }); state.rows.E13.remain = 5; save(); document.getElementById('modeMax').click(); return JSON.stringify([state.date, state.at, state.base]); });
    await p.setInputFiles('#file', f);
    await p.evaluate(() => window.ocrDone);
    r = await p.evaluate(() => ({ E12: [state.rows.E12.remain, state.rows.E12.max].join('/'), E13: state.rows.E13.remain, keep: JSON.stringify([state.date, state.at, state.base]), st: document.getElementById('status').innerText, pub: document.getElementById('pubNote').textContent }));
    await p.context().close();
    p = await open(b, { url: URL + '?s=ulsan#edit' });
    const off = await p.evaluate(() => document.body.classList.contains('maxmode'));
    await p.close();
    check('총석 집계 화면: 캡처는 총석만 넣고(E12 87) 잔여, 경기 정보, 집계 시각, 비교 기준은 그대로, 다시 열면 현황 집계', r.E12 === '/87' && r.E13 === 5 && r.keep === before && /총석을 넣었습니다 \(확인한 뒤 "총석 발행"\): E12 87석/.test(r.st) && !asked.some(m => /회색인 줄/.test(m)) && off === false, JSON.stringify({ r, before, asked, off }));
  }
  // 표의 잔여는 같은 집계(10분 안)일 때만 견줌 (11/19 수원 S1~S3: 놀티켓 좌석 그림을 어제 집계 잔여와 견줘 버림). 같은 집계면 전처럼 다르면 안 넣음
  {
    const f = await shot('grid_stale', grid('E12', 37, 50, '#0d2b45', 14, 0), 30 * 2 + 20 * 14 * 1.5 + 14 * 1.4 + 40, 120 + 5 * 14 * 1.5);
    const out = [];
    for (const ago of [26 * 3600e3, 3 * 60e3]) {
      p = await open(b, { url: URL + '?s=ulsan#edit' });
      p.on('dialog', d => d.type() === 'prompt' ? d.accept('E12') : d.accept());
      await p.evaluate(ago => { Object.assign(state, { date: '2026-12-05T14:00', at: localISO(Date.now() - ago) }); Object.assign(state.rows.E12, { remain: 60, max: 87 }); save(); }, ago);
      await p.setInputFiles('#file', f); await p.evaluate(() => window.ocrDone);
      out.push(await p.evaluate(() => state.rows.E12.remain + (/목록의 잔여 60석과 달라/.test(document.getElementById('status').innerText) ? '!' : '')));
      await p.context().close();
    }
    check('좌석 그림: 지난 집계(26시간 전) 표 잔여와는 견주지 않고 넣음(37), 같은 집계(3분 전) 표 잔여와 다르면 안 넣음(60)', out.join() === '37,60!', out.join());
  }
  // 남은 칸이 많은 좌석 그림(실제 W23 처럼): 작은 회색 구역 이름, 양쪽 줄 번호, 칸 사이 GATE 상자, 화면 배율 100~150%
  // 통째로는 이름을 못 읽는 경우가 있어 칸 바로 위 이름 자리만 잘라 읽음. 이름이 없으면 사람에게 물음
  {
    const W23 = ['ggggggggggggggggggggggggggggggggggg..nnnn.................................nnnn.nnnn', 'ggggggggggggggggggggggggggggggggggg..nnnnnnn..nnnn...........nnnnngnnnn.nnnnnnn',
      'ggggggggggggggggggggggggggggggggggg..nnnnnnn..nnnnnnnnnnnnnnnnnnnnnnnnn.nnnnnnn', 'gggggggggggggggggggggggggggggggggggg.nnnnnnn..nnnnnnnnnnnnnnnnnnnnnnnnnn.nnnnnnn',
      'ggggggggggggggggggggggggggggggggggg..nnnnngg.ggnnnnnnnnnnnnnnnnnnnnnnnnn.nnnnnnn'];
    const cells = W23.join('').replace(/\./g, ''), want = [cells.split('n').length - 1, cells.length];  // 155 / 336
    const make = (label, lc, lf) => {
      const cell = c => `<i style="display:inline-block;width:8px;height:8px;margin:1px 1.4px;${c === '.' ? '' : 'background:' + (c === 'n' ? '#12284a' : '#efefef')}"></i>`;
      const num = (i, al) => `<b style="display:inline-block;width:22px;color:#aaa;font:8px sans-serif;text-align:${al}">${i + 1}</b>`;
      const rows = W23.map((r, i) => `<div style="white-space:nowrap;height:10px;line-height:10px">${num(i, 'left')}${[...r].map(cell).join('')}${num(i, 'right')}</div>`).join('');
      return `<div style="padding:40px 20px 30px;display:inline-block"><div style="text-align:center;color:${lc};font:700 ${lf}px sans-serif;margin:0 0 8px;height:${lf + 3}px">${label}</div>`
        + `<div style="position:relative">${rows}<span style="position:absolute;left:583px;top:0;width:95px;height:18px;background:#e8e8e8;color:#fff;font:700 12px sans-serif;text-align:center;line-height:18px">GATE19</span></div></div>`;
    };
    for (const [dsf, lc, lf, label] of [[1, '#999', 12, 'W23'], [1.25, '#888', 13, 'W23'], [1.25, '#9a9a9a', 12, 'W23'], [1.5, '#888', 13, 'W23'], [1.25, '#888', 13, '']]) {
      const mk = await b.newPage({ viewport: { width: 1000, height: 200 }, deviceScaleFactor: dsf }), f = path.join(tmp, `w23_${dsf}_${lf}_${label}.png`);
      await mk.setContent(`<body style="margin:0;background:#fff">${make(label, lc, lf)}</body>`);
      await mk.locator('body > div').screenshot({ path: f });
      await mk.close();
      p = await open(b, { url: URL + '?s=gimcheon#edit' });
      let asked = '';
      p.on('dialog', d => { asked = d.message(); d.accept('w23'); });
      await p.evaluate(() => { state.rows.W23.max = null; });  // 총석을 모를 때
      await p.setInputFiles('#file', f);
      await p.evaluate(() => window.ocrDone);
      r = await p.evaluate(() => ({ remain: state.rows.W23.remain, max: state.rows.W23.max, st: document.getElementById('status').innerText.split('\n').slice(0, 2).join(' / ') }));
      const ok = r.remain === want[0] && r.max === want[1] && (label ? !asked : asked.includes(`잔여 ${want[0]}석 / 총석 ${want[1]}석`));
      check(`좌석 그림 (남은 칸 많음, 배율 ${dsf * 100}%, 이름 ${label ? lc + ' ' + lf + 'px' : '없음 -> 물어봄'}): W23 남은 ${want[0]} / 전체 ${want[1]}`, ok, JSON.stringify({ r, asked }));
      await p.context().close();
    }
    // 이미 아는 잔여(티켓링크 글자)와 맞춰 봄: 다르면(옆 구역이 섞임) 넣지 않고 경고, 맞으면 총석만 넣고 잔여는 그대로
    for (const [list, okMax] of [[143, false], [154, true]]) {
      p = await open(b, { url: URL + '?s=gimcheon#edit' });
      await p.evaluate(v => fcIngest(`김천상무 vs FC안양\n김천종합운동장 | 2026.11.07(토) 16:30\n등급 선택\nW23구역\n${v} 석`), list);
      await p.setInputFiles('#file', path.join(tmp, 'w23_1_12_W23.png'));
      await p.evaluate(() => window.ocrDone);
      r = await p.evaluate(() => ({ remain: state.rows.W23.remain, max: state.rows.W23.max, st: document.getElementById('status').innerText, rate: document.querySelector('tr[data-id="W23"]').cells[4].textContent }));
      check(`좌석 그림 남은 ${want[0]} vs 티켓링크 잔여 ${list}: ${okMax ? '맞음 -> 넣어 둔 총석 302 그대로, 다르다고 알림' : '다름 -> 넣지 않고 경고 (302 그대로)'}`, r.remain === list && (okMax ? r.max === 302 && /W23 좌석 그림으로 센 총석 336석이 표의 최대 302석과 다릅니다/.test(r.st) : r.max === 302 && /⚠ W23 좌석 그림에서 센 잔여 155석이 목록의 잔여 143석과 달라/.test(r.st)), JSON.stringify(r));
      await p.context().close();
    }
  }
  // 놀티켓 좌석 그림: 동그란 점, 비스듬한 구역, 같은 회색으로 찍힌 옆 구역(간격의 4배 넘게 떨어짐) -> 동그란 점도 세고 옆 구역은 뺌
  {
    const rows = Array.from({ length: 18 }, (_, i) => 22 + (i % 5)), want = rows.reduce((a, b) => a + b, 0);
    const dot = '<i style="display:inline-block;width:8px;height:8px;margin:1.5px;border-radius:50%;background:#e3e5e9"></i>';
    const zone = rows.map((n, i) => `<div style="white-space:nowrap;height:11px"><b style="display:inline-block;width:16px;margin-right:8px;font:8px sans-serif;color:#999">${i + 1}</b>${dot.repeat(n)}</div>`).join('');
    const nb = Array.from({ length: 5 }, () => `<div style="white-space:nowrap;height:11px;padding-left:24px">${dot.repeat(24)}</div>`).join('');
    const mk = await b.newPage({ viewport: { width: 900, height: 900 } }), f = path.join(tmp, 'nol_dots.png');
    await mk.setContent(`<body style="margin:0;background:#fff;overflow:hidden"><div style="position:absolute;left:180px;top:300px;transform:rotate(-55deg);transform-origin:200px 120px">${zone}<div style="height:44px"></div>${nb}</div>`
      + `<div style="position:absolute;left:560px;top:560px;font:700 54px sans-serif;color:#6b6b6b">N6</div></body>`);
    await mk.screenshot({ path: f }); await mk.close();
    p = await open(b, { url: URL + '?s=suwon#edit' });
    await p.evaluate(() => { state.rows.N6.max = null; });
    p.on('dialog', d => d.accept('N6'));
    await p.setInputFiles('#file', f);
    await p.evaluate(() => window.ocrDone);
    r = await p.evaluate(() => ({ max: state.rows.N6.max, remain: state.rows.N6.remain, st: document.getElementById('status').innerText }));
    check(`놀티켓 좌석 그림(동그란 점, 옆 구역 섞임): N6 전체 ${want}, 옆 구역 120 은 뺌`, r.max === want && r.remain === 0 && /떨어져 있는 칸 1[12]\d개는 옆 구역으로 보고 뺐습니다/.test(r.st), JSON.stringify(r));
    await p.context().close();
  }
  const list = (rows, fs) => rows.map(([n, v], i) => `<div style="display:flex;justify-content:space-between;padding:${fs * 0.4}px 16px ${fs * 0.4}px ${i ? 52 : 16}px;font-size:${fs}px;color:${v ? '#222' : '#a9adb5'}">`
    + `<span>${i ? '' : '<b style="display:inline-block;width:' + fs * 0.8 + 'px;height:' + fs * 0.8 + 'px;background:#123;margin-right:8px"></b>'}${n}</span><span style="color:${v ? '#ff2a2a' : '#a9adb5'};font-weight:${v ? 700 : 400}">${v} 석</span></div>`).join('');
  const lists = [
    [16, [['W석(일반석)', 976], ['W11구역', 0], ['W12구역', 196], ['W13구역', 267], ['W14구역', 190], ['W21구역', 0], ['W22구역', 120], ['W23구역', 143], ['W24구역', 60]]],
    [21, [['S석(원정석)', 640], ['S11구역', 85], ['S12구역', 0], ['S13구역', 120], ['S14구역', 35], ['S21구역', 200], ['S22구역', 0], ['S23구역', 200]]],
    [26, [['N석(가변석)', 333], ['N1구역', 40], ['N2구역', 0], ['N3구역', 93], ['N4구역', 200], ['N11구역', 0], ['N12구역', 7]]],
  ];
  for (const [fsz, rows] of lists) {
    const f = await shot(`list_${fsz}`, list(rows, fsz), 380, Math.round(rows.length * fsz * 2.25 + 10));
    p = await open(b, { url: URL + '?s=gimcheon#edit' });
    await p.setInputFiles('#file', f);
    await p.evaluate(() => window.ocrDone);
    r = await p.evaluate(ids => ids.map(id => `${id}=${state.rows[id].remain}`).join(' '), rows.slice(1).map(x => x[0].replace('구역', '')));
    const want = rows.slice(1).map(([n, v]) => `${n.replace('구역', '')}=${v}`).join(' ');
    check(`등급 목록 캡처 ${fsz}px (${rows[1][0][0]}구역 ${rows.length - 1}개)`, r === want, `${r} (기대 ${want})`);
    await p.context().close();
  }
  {  // PC 화면 전체: 위에 경기 정보, 왼쪽 좌석 그림(옆 구역 칸 포함), 오른쪽 등급 목록 -> 목록 숫자만 쓰고 좌석 그림은 세지 않음
    const f = await shot('pc_full', `<div style="padding:16px 24px"><b style="font-size:22px">김천상무프로축구단 vs FC안양</b><div style="color:#666">김천종합운동장 | 2026.11.07(토) 16:30</div></div>`
      + `<div style="display:flex"><div style="width:720px">${grid('W12', 30, 40, '#0d2b45', 14, 0)}${grid('W13', 10, 10, '#0d2b45', 14, 0)}</div>`
      + `<div style="width:300px"><div style="padding:8px 16px;font-weight:700">등급 선택</div>${list([['W석(일반석)', 900], ['W12구역', 196], ['W13구역', 267]], 16)}</div></div>`, 1040, 640);
    p = await open(b, { url: URL + '?s=gimcheon#edit' });
    await p.setInputFiles('#file', f);
    await p.evaluate(() => window.ocrDone);
    r = await p.evaluate(() => ({ W12: state.rows.W12.remain, W13: state.rows.W13.remain, max: state.rows.W12.max, st: document.getElementById('status').innerText }));
    check('PC 화면 전체 캡처: 목록 숫자를 쓰고 좌석 그림은 세지 않음', r.W12 === 196 && r.W13 === 267 && r.max === 311 && !/좌석 그림으로 셈/.test(r.st), JSON.stringify(r));
    await p.context().close();
  }
  await maker.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  // 실제 캡처 인식 (11/1 부천전)
  if (fs.existsSync(SHOTS)) {
    p = await open(b);
    await p.setInputFiles('#file', fs.readdirSync(SHOTS).sort().map(f => path.join(SHOTS, f)));
    await p.evaluate(() => window.ocrDone);
    r = await p.evaluate(() => JSON.parse(JSON.stringify(state)));
    const x = r.rows, want = { R10: 26, R11: 1, R12: 0, R14: 52, P: 204, T4: 58, T3: 30, 일반지정석: 1426 };  // 스탠딩석 18 은 11/25 부터 S1~S3 묶음 합계 (구역 줄이 없어 구역 잔여는 모름)
    const bad = Object.entries(want).filter(([k, v]) => x[k].remain !== v).map(([k, v]) => `${k} ${x[k].remain}(기대 ${v})`);
    check('실제 캡처 5장 인식 (11/1 부천전)', !bad.length && r.opp === '부천FC1995', bad.join(', ') + ' / ' + r.opp);
    await p.context().close();
  } else console.log('SKIP  실제 캡처 인식 (좌석스크린샷/시험 없음)');
  const PC = path.join(ROOT, '좌석스크린샷', '시험_김천');
  if (fs.existsSync(PC)) {  // PC 가로 캡처 (원정 김천, 등급 목록): W 가 \/ 로 깨져도 읽는지
    p = await open(b, { url: URL + '?s=gimcheon#edit' });
    await p.setInputFiles('#file', fs.readdirSync(PC).filter(f => !/^좌석그림_S/.test(f)).map(f => path.join(PC, f)));  // 원정석 쪽 캡처(S)는 아래에서 한 장씩
    await p.evaluate(() => window.ocrDone);
    r = await p.evaluate(() => ({ W12: state.rows.W12.remain, W13: state.rows.W13.remain, W11: state.rows.W11.remain, W11max: state.rows.W11.max,
      E: ['E11', 'E12', 'E13', 'E14', 'E15', 'E21', 'E22', 'E23', 'E24'].map(id => state.rows[id].remain).join(), st: document.getElementById('status').innerText }));
    check('김천 캡처: PC 등급 목록(W), 잘라 낸 목록(E, E 를 6 으로 읽어도), 좌석 그림(W11 칸 세기)',
      r.W12 === 196 && r.W13 === 267 && r.W11 === 0 && r.W11max === 240 && /W11 좌석 그림으로 센 총석 242석이 표의 최대 240석과 다릅니다/.test(r.st) && r.E === '0,278,275,279,0,0,0,415,0', JSON.stringify(r));
    await p.context().close();
    // 같은 W11 을 다른 크기로 캡처한 것 하나씩: 줄 번호 숫자, 잘린 옆 칸을 빼고 줄별 40, 44, 49, 53, 56 = 242
    for (const f of fs.readdirSync(PC).filter(f => f.startsWith('좌석그림_W11'))) {
      p = await open(b, { url: URL + '?s=gimcheon#edit' });
      await p.evaluate(() => { state.rows.W11.max = null; });  // 총석을 모를 때 센 값이 들어가는지
      await p.setInputFiles('#file', path.join(PC, f));
      await p.evaluate(() => window.ocrDone);
      r = await p.evaluate(() => ({ remain: state.rows.W11.remain, max: state.rows.W11.max }));
      check(`김천 좌석 그림 ${f}: W11 남은 0 / 전체 242`, r.remain === 0 && r.max === 242, JSON.stringify(r));
      await p.context().close();
    }
    // 11/7 김천 원정석 쪽 캡처 7장 (작은 네모 칸, GATE 글자 칸 있음): 남은 / 전체는 픽셀을 따로 훑어 센 값. S13 은 초록 칸 옆 흐린 회색 칸 2개까지
    const GS = { S11: [156, 193], S12: [145, 258], S13: [142, 258], S14: [163, 198], S23: [23, 45], S24: [201, 210], S25: [214, 218] };
    for (const [id, [remain, total]] of Object.entries(GS)) {
      const f = path.join(PC, `좌석그림_${id}.png`);
      if (!fs.existsSync(f)) { console.log('SKIP  김천 좌석 그림 ' + id); continue; }
      p = await open(b, { url: URL + '?s=gimcheon#edit' });
      await p.evaluate(id => { state.rows[id].max = null; }, id);
      p.on('dialog', d => d.accept(id));
      await p.setInputFiles('#file', f);
      await p.evaluate(() => window.ocrDone);
      r = await p.evaluate(id => state.rows[id], id);
      check(`김천 좌석 그림 ${id}: 남은 ${remain} / 전체 ${total}`, r.remain === remain && r.max === total, JSON.stringify(r));
      await p.context().close();
    }
  }

  // 놀티켓 실제 캡처 (11/07 수원삼성 vs 용인, 동그란 점, 색 있는 점 = 남은 좌석): 남은 좌석은 사진에서 직접 센 수, 전체는 줄별로 맞춘 수
  // 전북 실제 캡처(11/17 사용자, 좌석스크린샷/시험_전북): 한 구역 안에 떨어진 묶음이 있는 그림(코너 테이블 오른쪽 기둥, W2K 오른쪽 작은 묶음)은 총석 집계에서 묻고 더함. 칸 이름 상자(T01~, A1~)는 좌석 아님
  {
    const JD = path.join(ROOT, '좌석스크린샷', '시험_전북');
    for (const [file, id, total, ask] of [['좌석그림_W1K_테이블석A.png', 'W1K', 234, ''], ['좌석그림_W2K.png', 'W2K', 32, '코너'], ['좌석그림_코너가.png', '코너가', 85, '코너 가'], ['좌석그림_코너사.png', '코너사', 85, '코너 사']]) {
      const f = path.join(JD, file);
      if (!fs.existsSync(f)) { console.log('SKIP  전북 좌석 그림 ' + file); continue; }
      p = await open(b, { url: URL + '?s=jeonbuk#edit' });
      const asked = [];
      p.on('dialog', d => { asked.push(d.message().split('\n')[0]); d.type() === 'prompt' ? d.accept(ask || id) : d.accept(); });
      await p.evaluate(() => document.getElementById('modeMax').click());
      await p.setInputFiles('#file', f); await p.evaluate(() => window.ocrDone);
      r = await p.evaluate(id => state.rows[id].max, id);
      await p.context().close();
      check(`전북 실제 좌석 그림 ${id}: 전체 ${total}` + (total !== 234 ? ' (떨어진 묶음을 묻고 더함)' : ''), r === total && (total === 234 || asked.some(m => /떨어져 있는 묶음/.test(m))), JSON.stringify({ r, asked }));
    }
  }
  // 포항 실제 캡처(11/17 사용자, 좌석스크린샷/시험_포항): 원정석 칸 색이 검정에 가까운 짙은 회색(남은 좌석). 전에는 글자로 봐서 A1 을 적게 세고 A21 은 못 읽었음
  {
    const PD = path.join(ROOT, '좌석스크린샷', '시험_포항');
    for (const [file, id, remain, total] of [['좌석그림_A1.png', 'A1', 261, 300], ['좌석그림_A21.png', 'A21', 157, 165]]) {
      const f = path.join(PD, file);
      if (!fs.existsSync(f)) { console.log('SKIP  포항 좌석 그림 ' + file); continue; }
      p = await open(b, { url: URL + '?s=pohang#edit' });
      p.on('dialog', d => d.type() === 'prompt' ? d.accept(id) : d.accept());
      await p.evaluate(() => document.getElementById('modeMax').click());
      await p.setInputFiles('#file', f); await p.evaluate(() => window.ocrDone);
      r = await p.evaluate(id => state.rows[id].max, id);
      await p.context().close();
      check(`포항 실제 좌석 그림 ${id} (짙은 회색 칸): 전체 ${total}`, r === total, JSON.stringify({ r }));
    }
  }
  // 인천 실제 캡처(11/17 사용자 총석 집계, 좌석스크린샷/incheon): 비스듬히 기운 좌석 그림(E10 1인 테이블, 피크닉 테이블, 하이네켄 테이블)도 칸을 다 셈
  // (11/18 검토: 기운 칸 일부가 빠져 E10 27 -> 24, 피크닉 80 -> 78 로 발행됨)
  {
    const ID = path.join(ROOT, '좌석스크린샷', 'incheon'), F = n => path.join(ID, `스크린샷 2026-11-17 ${n}.png`);
    if (fs.existsSync(F('171320'))) {
      p = await open(b, { url: URL + '?s=incheon#edit' });
      r = await p.evaluate(async shots => { const out = [];
        for (const b64 of shots) { const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
          const m = await seatMap(bmp, { setParameters: async () => {}, recognize: async () => ({ data: { words: [], text: '' } }) }, false); out.push([m.remain, m.total, m.extra.map(g => g.remain + '/' + g.total).join('+')].join('/')); }
        return out.join(' '); }, ['171320', '171336', '171243', '171310'].map(n => fs.readFileSync(F(n)).toString('base64')));
      await p.context().close();
      check('기운 좌석 그림: 인천 E10 27석, 피크닉 오른쪽 52석(남음 36) + 왼쪽 28석(남음 4), 하이네켄 40 + 28석, 반듯한 S1 27석', r === '0/27/ 36/52/4/28 0/40/0/28 0/27/', r);
    } else console.log('SKIP  인천 기운 좌석 그림');
  }
  // 포항 실제 캡처(11/18 사용자, 좌석스크린샷/pohang): 테이블 막대는 좌석이 아님(T5 102), 안내 글자 조각도 아님(프리미엄 테이블1 115),
  // 표시 상자가 좌석에 닿아 한 덩어리가 된 줄은 다시 나눔(W22 맨 윗줄 끝 칸 -> 216, N21 맨 윗줄 -> 307)
  // 상자 선이 3px 로 두꺼워 1, 2열이 위아래로 붙은 것도 나눔(N23 161 -> 207, S25 40 -> 60), 몇 칸만 떼고 큰 덩어리가 남은 것도 다시(N22 304 -> 332, 떨어진 묶음 포함),
  // 빨간 안내 글자 조각(18x10)은 좌석 아님(N25 64 -> 63)
  {
    const PD2 = path.join(ROOT, '좌석스크린샷', 'pohang'), F = n => path.join(PD2, `스크린샷 2026-11-18 ${n}.png`), list = [['134844', 'T5 102'], ['134758', '프리미엄 115'], ['135319', 'W22 216'], ['135209', 'N21 307'], ['135222', 'N23 207'], ['135030', 'S25 60'], ['135217', 'N22 332'], ['135232', 'N25 63']];
    if (fs.existsSync(F('134844'))) {
      p = await open(b, { url: URL + '?s=pohang#edit' });
      r = await p.evaluate(async shots => { const out = [];
        for (const b64 of shots) { const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
          const m = await seatMap(bmp, { setParameters: async () => {}, recognize: async () => ({ data: { words: [], text: '' } }) }, false); out.push(m.extra.reduce((a, g) => a + g.total, m.total)); }
        return out.join(','); }, list.map(([n]) => fs.readFileSync(F(n)).toString('base64')));
      await p.context().close();
      check(`포항 좌석 그림: 테이블 막대, 안내 글자는 좌석 아님, 표시 상자와 붙은 줄은 다시 나눔 (${list.map(x => x[1]).join(', ')})`, r === '102,115,216,307,207,60,332,63', r);
    } else console.log('SKIP  포항 좌석 그림 (11/18)');
  }
  // 여러 줄을 감싼 시야방해 상자: 상자 안 좌석도 나눠 셈 (11/25 안양 R2 1~4열 48석이 빠지던 것). 11/1 부천전 실제 캡처 R10 126, R14 123
  if (fs.existsSync(path.join(SHOTS, '1101_R14.png'))) {
    p = await open(b);
    r = await p.evaluate(async shots => { const out = [];
      for (const b64 of shots) { const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
        out.push((await seatMap(bmp, { setParameters: async () => {}, recognize: async () => ({ data: { words: [], text: '' } }) }, false)).total); }
      return out.join(','); }, ['1101_R10.png', '1101_R14.png'].map(f => fs.readFileSync(path.join(SHOTS, f)).toString('base64')));
    await p.context().close();
    check('여러 줄을 감싼 시야방해 상자 안 좌석도 셈: 안양 R10 126, R14 123', r === '126,123', r);
  } else console.log('SKIP  여러 줄 상자 (좌석스크린샷/시험 없음)');
  // 수원삼성(11/18 사용자): 원정석 쪽은 S4~S6(S1~S3 중립석은 홈 관중), 2층 맨 앞 2줄과 N8, N12 맨 뒤 10줄은 팔지 않는 줄(막힌 좌석 기본값)
  p = await open(b, { url: URL + '?s=suwon#edit' });
  const rSw = await p.evaluate(() => { const o = [SECTIONS.filter(x => x.ours).map(x => x.id).sort().join(' '), state.rows.N8.block, state.rows.E12.block, capOf(state.rows.N8), state.rows.S1.block ?? 0, state.rows.N9.block, state.rows.N10.block, state.rows.N11.block];
    // 지난 기본값(N9 72)이 저장된 브라우저는 새 기본값으로, 사람이 바꾼 값(N10 0)은 그대로
    state.rows.N9.block = 72; state.rows.N10.block = 0; delete state.blockDefaults; defaultBlock(); o.push(state.rows.N9.block, state.rows.N10.block); return o.join(','); });
  await p.context().close();
  p = await open(b, { url: URL + '?s=suwon&test=gyeongnam#edit' });
  const rName = await p.evaluate(() => { Object.assign(state, { date: '2026-11-21T14:00', at: '2026-11-18T14:15' }); const t = fileBase(); return t; });
  await p.context().close();
  p = await open(b, { url: URL + '?s=suwon#edit' });
  r = await p.evaluate(() => [['N8', 'N9', 'N10', 'E12'].map(id => blockShare(id).toFixed(2)).join('/'), document.querySelectorAll('#board path[fill="url(#hatch)"][stroke="none"]').length, state.rows.W13미판매구역.off].join(','));
  await p.context().close();
  check('수원 N8~N12: 막힌 좌석이 칸의 10% 넘으면 그만큼 빗금(N8 0.46, N9 0.88, N10 0.10, E12 는 없음), W13 미판매 구역은 기본 미판매', r === '0.46/0.88/0.10/0.00,5,true', r);
  check('시험 페이지 저장 파일 이름은 실제 원정 팀 (수원삼성_경남FC, 안양 아님)', rName === '수원삼성_경남FC_20261121_집계202611181415', rName);
  check('수원삼성: 원정석 쪽 S4~S6, 팔지 않는 줄 기본값(N8 434석 -> 판매 506석, E12 55석, N9, N11 827: 3~5열만, N10 70), 1층은 없음, 지난 기본값만 새 값으로', rSw === 'S4 S5 S6,434,55,506,0,827,70,827,827,0', rSw);
  const NOLD = path.join(ROOT, '좌석스크린샷', '시험_놀티켓');
  if (fs.existsSync(NOLD)) {
    // W13(2층 테이블석, 2인 테이블 짝)은 한 화면에 안 들어와 왼쪽, 오른쪽 두 장(가운데 블록이 겹침): 왼쪽 장의 잘린 가운데 블록은 떨어진 칸으로 빠져 122 + 196 = 318 (손으로 센 수)
    const counted = {}, shared = {};
    for (const [f, id, remain, total] of [['수원삼성_S3.png', 'S3', 36, 637], ['수원삼성_W9.png', 'W9', 0, 504], ['수원삼성_E15.png', 'E15', 19, 843], [['수원삼성_W13_왼쪽.png', '수원삼성_W13_오른쪽.png'], 'W13', 0, 318]]) {
      p = await open(b, { url: URL + '?s=suwon#edit' });
      shared[id] = await p.evaluate(id => { const m = state.rows[id].max; state.rows[id].max = null; return m; }, id);
      p.on('dialog', d => d.accept(id));  // E15 사진에는 구역 이름이 없어 물어봄, W13 두 장은 더할지 물어봄
      await p.setInputFiles('#file', [f].flat().map(x => path.join(NOLD, x)));
      await p.evaluate(() => window.ocrDone);
      r = await p.evaluate(id => state.rows[id], id);
      counted[id] = r.max;
      check(`놀티켓 실제 캡처 ${id}: 남은 ${remain} / 전체 ${total}`, r.remain === remain && r.max === total, JSON.stringify(r));
      await p.context().close();
    }
    // 코드에 넣은 총석(받은 자료, W13 은 센 값)과 좌석 그림으로 센 값: 5석 이하 차이만 허용
    check('수원삼성 총석 = 좌석 그림으로 센 값 (5석 이하 차이 허용, S3, W9, E15, W13)', Object.keys(counted).every(id => Math.abs(counted[id] - shared[id]) <= 5), JSON.stringify({ counted, shared }));
    // 한 화면에 안 들어와 나눠 찍은 경우: E15 를 13줄과 14줄 사이에서 위아래 두 장으로 잘라 넣으면 더해서 같은 수
    p = await open(b, { url: URL + '?s=suwon#edit' });
    const halves = await p.evaluate(async d => {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + d)).blob()), cut = (y0, y1) => { const c = document.createElement('canvas'); c.width = bmp.width; c.height = y1 - y0; c.getContext('2d').drawImage(bmp, 0, y0, bmp.width, y1 - y0, 0, 0, bmp.width, y1 - y0); return c.toDataURL('image/png').split(',')[1]; };
      return [cut(0, 794), cut(794, bmp.height)];
    }, fs.readFileSync(path.join(NOLD, '수원삼성_E15.png')).toString('base64'));
    const hf = halves.map((h, i) => { const f = path.join(require('os').tmpdir(), `fc_e15_part${i + 1}.png`); fs.writeFileSync(f, Buffer.from(h, 'base64')); return f; });
    await p.evaluate(() => { state.rows.E15.max = null; });
    p.on('dialog', d => d.accept('E15'));
    await p.setInputFiles('#file', hf);
    await p.evaluate(() => window.ocrDone);
    r = await p.evaluate(() => ({ ...state.rows.E15, st: document.getElementById('status').innerText }));
    check('나눠 찍은 좌석 그림 두 장(E15 위 18줄 + 아래 13줄)을 더함: 남은 19 / 전체 843', r.remain === 19 && r.max === 843 && /E15 좌석 그림 2장을 더했습니다/.test(r.st), JSON.stringify(r));
    await p.context().close();
  } else console.log('SKIP  놀티켓 실제 캡처 (좌석스크린샷/시험_놀티켓 없음)');

  // 실제 발행 (시험용 브랜치)
  if (process.argv.includes('--publish')) {
    const token = execSync('gh auth token', { encoding: 'utf8' }).trim(), B = 'data-test', raw = f => { try { return JSON.parse(execSync(`gh api "repos/goormigrm/fc-anyang-seats/contents/${f}?ref=${B}" -H "Accept: application/vnd.github.raw+json"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return null; } };
    p = await open(b, { live: true });
    for (const [at, v] of [['2026-11-26T12:30', 6000], ['2026-11-26T12:35', 5900], ['2026-11-27T12:00', 5000]])
      await p.evaluate(([at, v, t, B]) => { fcIngest('FC안양 vs 제주SK\n안양종합운동장 | 2026.11.28(토) 14:00\n일반지정석(2층)\n' + v + ' 석'); state.at = at; return publish(t, B); }, [at, v, token, B]);
    const sha = f => { try { return execSync(`gh api "repos/goormigrm/fc-anyang-seats/contents/${f}?ref=${B}" --jq .sha`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
    let h = raw('history.json'), z = raw('zones.json');
    check('발행: 구역별 잔여 기록(zones.json)도 추이 점과 같이 남김 (2점, 일반지정석 5900 -> 5000)', z?.length === 2 && z[0].r.일반지정석 === 5900 && z[1].r.일반지정석 === 5000 && z[1].opponent === '제주SK' && raw('prev/zones.json')?.length === 1, JSON.stringify(z));
    check('발행: 10분 안 발행은 점 하나 (3번 발행 -> 2점)', h?.map(x => x.at.slice(11, 16)).join() === '12:35,12:00', JSON.stringify(h));
    const paths = () => execSync(`gh api "repos/goormigrm/fc-anyang-seats/git/trees/${B}?recursive=1" --jq "[.tree[].path]|join(\\",\\")"`, { encoding: 'utf8' });
    check('발행: 그보다 앞 발행본 숫자는 prev/old/ 에 (1 = 바로 그 전)', raw('prev/latest.json')?.updatedAt.startsWith('2026-11-26T12:35') && raw('prev/old/1.json')?.updatedAt.startsWith('2026-11-26T12:30'), paths());
    const msg = await p.evaluate(([t, B]) => unpublish(t, false, B), [token, B]);
    h = raw('history.json');
    check('마지막 발행 지우기: prev/old/ 는 그대로 남고 맨 위로 옮겨지지 않음', raw('prev/old/1.json')?.updatedAt.startsWith('2026-11-26T12:30') && !/(^|,)old\//.test(paths()), paths());
    check('마지막 발행 지우기 -> 그 전 발행과 그때 추이', raw('latest.json')?.updatedAt.startsWith('2026-11-26T12:35') && h?.length === 1 && /되돌렸습니다/.test(msg), msg + JSON.stringify(h));
    check('마지막 발행 지우기: 구역별 기록과 미리보기 그림도 그 전 발행으로', raw('zones.json')?.length === 1 && raw('og.json')?.at.startsWith('2026-11-26T12:35') && sha('og.png') && sha('og.png') === sha('latest.png'), JSON.stringify([raw('zones.json')?.length, raw('og.json')]));
    await p.evaluate(([t, B]) => { fcIngest('FC안양 vs 울산HD\n안양종합운동장 | 2026.12.05(토) 14:00\n일반지정석(2층)\n3000 석'); state.at = '2026-12-04T10:00'; return publish(t, B); }, [token, B]);
    const tree = execSync(`gh api "repos/goormigrm/fc-anyang-seats/git/trees/${B}?recursive=1" --jq "[.tree[].path]|join(\\",\\")"`, { encoding: 'utf8' });
    check('경기가 바뀌면 지난 경기를 games/ 에 보관', /games\/2026-11-28_제주SK\.json/.test(tree), tree);
    const ap = await open(b, { url: URL + '?s=gimcheon#edit', live: true });
    await ap.evaluate(([t, B]) => { fcIngest('김천상무 vs FC안양\n김천종합운동장 | 2026.11.07(토) 16:30\nS11구역\n50 석'); return publish(t, B); }, [token, B]);
    const mx = await p.evaluate(([t, B]) => { state.rows.R10.max = 128; return publishMax(t, B).then(n => n + '|' + JSON.stringify(maxPub.max.R10)); }, [token, B]);
    const latestSha = sha('latest.json');
    await ap.evaluate(([t, B]) => { state.rows.S11.max = 200; return publishMax(t, B); }, [token, B]);
    check('총석 발행: 구장마다 max.json, 현황 발행본(latest.json)은 그대로', mx.endsWith('|128') && raw('max.json')?.max.R10 === 128 && raw('gimcheon/max.json')?.max.S11 === 200 && raw('gimcheon/max.json').venue === '김천종합운동장' && sha('latest.json') === latestSha && raw('latest.json')?.match.opponent === '울산HD', mx);
    {
      const tp = await open(b, { url: URL + '?s=jeonbuk&test=seoul#edit', live: true }), og0 = raw('og.json'), home0 = sha('latest.json');
      await tp.evaluate(([t, B]) => { fcIngest('전북현대모터스 vs FC서울\n전주 월드컵경기장 | 2026.11.21(토) 14:00\n등급 선택\nE-1A\n296 석'); state.at = '2026-12-31T09:00'; return publish(t, B); }, [token, B]);
      const tj = raw('test/jeonbuk/latest.json'), og1 = raw('og.json');
      await tp.evaluate(([t, B]) => unpublish(t, true, B), [token, B]);
      const gone = raw('test/jeonbuk/latest.json');
      await tp.context().close();
      check('시험 페이지 발행: test/jeonbuk/ 에만, 늦은 집계여도 링크 미리보기와 안양 발행본은 그대로, 지우면 시험 것만', tj?.match.away === 'FC서울' && tj.match.test === true && JSON.stringify(og1) === JSON.stringify(og0) && sha('latest.json') === home0 && gone === null && raw('latest.json')?.match, JSON.stringify({ tj: tj?.match, og0, og1 }));
    }
    check('원정 발행은 구장 폴더에, 홈 발행은 그대로', raw('gimcheon/latest.json')?.match.home === '김천상무' && raw('latest.json')?.match.opponent === '울산HD', '');
    // 링크 미리보기(og.png): 가장 늦은 집계(홈 12/04 10:00)의 그림. 그보다 이른 집계(김천 11/07)를 발행해도 그대로, 더 늦은 집계면 그 구장으로
    const og1 = raw('og.json'), same1 = sha('og.png') && sha('og.png') === sha('latest.png');
    await ap.evaluate(([t, B]) => { state.at = '2026-12-06T09:00'; return publish(t, B); }, [token, B]);
    const og2 = raw('og.json'), same2 = sha('og.png') === sha('gimcheon/latest.png');
    check('링크 미리보기: 가장 늦은 집계의 그림(og.png)을 가리킴, 이른 집계를 발행해도 그대로, 더 늦으면 바뀜', og1?.stadium === 'anyang' && og1.at.startsWith('2026-12-04T10:00') && same1 && og2?.stadium === 'gimcheon' && og2.at.startsWith('2026-12-06T09:00') && same2, JSON.stringify({ og1, same1, og2, same2 }));
    await ap.evaluate(([t, B]) => unpublish(t, true, B), [token, B]);
    check('원정 발행 모두 지우기는 홈 파일을 건드리지 않음, 미리보기는 남은 발행(홈 12/04)으로', raw('gimcheon/latest.json') === null && raw('latest.json')?.match.opponent === '울산HD' && raw('og.json')?.stadium === 'anyang' && raw('og.json').at.startsWith('2026-12-04T10:00') && sha('og.png') === sha('latest.png'), JSON.stringify(raw('og.json')));
    await ap.context().close();
    await p.evaluate(([t, B]) => unpublish(t, true, B), [token, B]);
    h = raw('history.json');
    check('발행 모두 지우기: 이번 경기만 지우고 보관과 다른 경기 추이, 구역별 기록은 남김, 남은 발행이 없으면 미리보기도 없음', raw('latest.json') === null && raw('games/2026-11-28_제주SK.json')?.match.opponent === '제주SK' && h?.every(x => x.opponent === '제주SK')
      && raw('zones.json')?.every(x => x.opponent === '제주SK') && raw('og.json') === null, JSON.stringify([h, raw('zones.json'), raw('og.json')]));
    check('현황 발행, 지우기를 해도 발행한 총석(max.json)은 남음', raw('max.json')?.max.R10 === 128 && raw('gimcheon/max.json')?.max.S11 === 200, JSON.stringify([raw('max.json'), raw('gimcheon/max.json')]));
    try { execSync(`gh api -X DELETE repos/goormigrm/fc-anyang-seats/git/refs/heads/${B}`, { stdio: 'ignore' }); } catch {}
    await p.context().close();
  }

  // ===== 11/18 버그 검토: 찾은 버그마다 다시 생기지 않게 =====
  {
    const AH = (host, venue) => `${host} vs FC안양\n${venue} | 2026.11.28(토) 14:00\n등급 선택\n`;
    // --- 입력 해석 ---
    let pg = await open(b, { url: URL + '?s=incheon#edit' });
    r = await pg.evaluate(H => { const o = {};
      fcIngest(H + 'Exciting석\n1476 석\nE3구역\n134 석\nE4구역\n200 석\n휠체어석(E석)\n16 석\nE3구역\n16 석\nE4구역\n0 석\nE5구역\n0 석');
      o.wc = [state.rows.E3.remain, state.rows.E4.remain, state.rows.E5.remain].join();
      newGame(); fcIngest(H + 'Exciting석\n1476\n석\nE3구역\n134\n석\n휠체어석(E석)\n74\n석\nE3구역\n16\n석'); o.nl = state.rows.E3.remain;
      newGame(); fcIngest(H + 'Exciting석\n1476 석\nE3구역\n134 석\n휠체어석(E석) 744\nE3구역\n16 석'); o.ocr4 = state.rows.E3.remain;
      newGame(); const R = n => H + `라탄 테라스 존 2인 (더블)\n0 석\n${n}\n8 석\n라탄석1구역\n8 석`;
      fcIngest(R('라탄 테라스 존 4인')); fcIngest(R('라탄 테라스존 4인')); o.sp = state.rows.라탄석1.remain;
      fcIngest(H + '라탄 테라스 존 2인 (더블)\n0 석\n라탄 테라스 존 4인\n0 석'); o.zero = state.rows.라탄석1.remain;
      o.zoneOf = zoneOf('V12');
      return o; }, AH('인천유나이티드', '인천축구전용경기장'));
    await pg.context().close();
    check('휠체어석 아래 0석 구역이 실제 구역을 덮지 않음 (E3 134, E4 200, E5 모름)', r.wc === '134,200,', r.wc);
    check("'석'이 숫자 다음 줄에 혼자 있는 글자, 인식기가 '석'을 4 로 읽은 휠체어석 줄도 휠체어석으로 봄", r.nl === 134 && r.ocr4 === 134, JSON.stringify(r));
    check('등급 이름 빈칸만 다른 같은 등급은 한 몫(8, 16 아님), 매진되어 접힌 등급(4인 0석)은 그 몫을 0 으로', r.sp === 8 && r.zero === 0, JSON.stringify(r));
    check('글자 인식 구역 이름: 두 자리 번호를 먼저 맞춤 (V12 -> W12, V1 아님)', r.zoneOf === 'W12', r.zoneOf);
    // 포항 프리미엄 테이블1, 2 는 '프리미엄테이블(1인)', '(2인)', '(4인)' 아래 같은 이름(11/18 사용자): 등급마다 더함 (마지막에 누른 등급 숫자만 남던 것)
    pg = await open(b, { url: URL + '?s=pohang#edit' });
    r = await pg.evaluate(H => { const G = (o1 = '', o2 = '', o4 = '') => H + `프리미엄테이블(1인)\n2 석\n${o1}프리미엄테이블(2인)\n60 석\n${o2}프리미엄테이블(4인)\n20 석\n${o4}T1 테이블(2인)\n54 석`;
      fcIngest(G('프리미엄 테이블1\n2 석\n✓ 프리미엄 테이블2\n0 석\n')); fcIngest(G('', '프리미엄 테이블1\n30 석\n프리미엄 테이블2\n30 석\n')); fcIngest(G('', '', '프리미엄 테이블1\n10 석\n프리미엄 테이블2\n10 석\n'));
      return [state.rows.프리미엄테이블1.remain, state.rows.프리미엄테이블2.remain].join(); }, AH('포항스틸러스', '포항스틸야드'));
    await pg.context().close();
    check('포항 프리미엄 테이블1, 2: 1인, 2인, 4인 등급 숫자를 더함 (2+30+10, 0+30+10)', r === '42,40', r);
    pg = await open(b, { url: URL + '?s=pohang#edit' });
    r = await pg.evaluate(H => { fcIngest(H + 'W1~W2\n294 석\nW1구역\n148 석\nW3~W4\n50 석\n청암E석\n1849 석\n청암E1구역\n290 석'); return [state.rows.W1.remain, state.rows.W2.remain, state.rows.W4.remain, state.rows.E1.remain].join(); }, AH('포항스틸러스', '포항스틸야드'));
    await pg.context().close();
    check("포항 구역 범위 등급('W1~W2 294 석')은 W2 구역 잔여가 아님 (W1 148, W2 W4 모름, E1 290)", r === '148,,,290', r);
    pg = await open(b, { url: URL + '?s=ulsan#edit' });
    r = await pg.evaluate(H => { fcIngest(H + '휠체어석\n0 석\n프리미엄 테이블석\n10 석\n2층 테이블석\n30 석'); return [state.rows.프리미엄테이블석.remain, state.rows['2층테이블석'].remain].join(); }, AH('울산HD', '울산문수축구경기장'));
    await pg.context().close();
    check('접힌 휠체어석(0석) 다음 등급, 숫자로 시작하는 등급(2층 테이블석)도 받음', r === '10,30', r);
    pg = await open(b, { url: URL + '?s=jeonbuk#edit' });
    r = await pg.evaluate(H => { const o = [];
      fcIngest(H + 'E 테이블\n150 석\n✓ E-2B\n13 석'); fcIngest(H + 'E 일반\n7155 석\n✓ E-2B\n40 석'); o.push(state.rows.E2B.remain);
      fcIngest(H + 'E 테이블\n0 석\nE 일반\n7155 석\n✓ E-2B\n38 석'); o.push(state.rows.E2B.remain);
      newGame(); fcIngest(H + 'E 일반\n7000 석\nE-2A\n300\n석'); o.push(state.rows.E2A.remain);
      // 등급 일부(테이블)만 받은 칸에 스크립트가 센 블록 전체(53/80)가 와도 견주지 않고 총석을 넣음
      newGame(); fcIngest(H + 'E 테이블\n150 석\n✓ E-2B\n13 석'); fcSeats({ remain: 53, total: 80, names: ['E-2B'], own: [] }); o.push(state.rows.E2B.max);
      return o.join(); }, AH('전북현대', '전주월드컵경기장'));
    await pg.context().close();
    check("전북 E2B: 매진되어 접힌 'E 테이블 0 석'은 테이블 몫을 0 으로(53 -> 38), 'E-2A\\n300\\n석', 등급 일부만 받은 칸도 스크립트 칸 수로 총석", r === '53,38,300,80', r);
    pg = await open(b);
    r = await pg.evaluate(H => { const o = [];
      newGame(); fcIngest(H + 'R5구역\n100 석\n휠체어석\n12 석\nR5구역\n2 석'); o.push(state.rows.R5.remain);
      // 발행 뒤 10분 안에 같은 화면이 다시 보내 집계 시각이 바뀌어도, 다음 새 집계의 비교 기준은 발행한 숫자
      newGame(); fcIngest(H + 'R10구역\n26 석'); state.pubAt = state.at; state.pubSnap = snap();
      fcIngest(H + 'R10구역\n24 석'); state.at = '2026-11-01T09:00'; fcIngest(H + 'R10구역\n20 석'); o.push(state.base?.rows?.R10, /이후 \+6석/.test(summaryText()));
      o.push(parseText('(좌석 그림)\nP구역 30석').found.P);
      // 다른 구장 예매 화면의 칸 수, 이 현황판에 없는 구역 이름의 칸 수는 받지 않음
      state.rows.T3.remain = 47; state.rows.T3.max = null; lamp.got = Date.now();
      fcSeats({ venue: '김천종합운동장', remain: 47, total: 193, names: [], own: [] }); fcSeats({ remain: 47, total: 193, names: ['S11구역'], own: [] }); o.push(state.rows.T3.max);
      return o.join(); }, H);
    await pg.context().close();
    check('홈: 휠체어석 아래 R5 는 R5 를 덮지 않음, 발행 뒤 다시 보내도 비교 기준은 발행한 숫자(26 -> 20, +6), 좌석 그림 P 줄, 다른 구장 칸 수는 넘김', r === '100,26,true,30,', r);
    pg = await open(b, { url: URL + '?s=suwon#edit' });
    r = await pg.evaluate(() => { fcIngest('좌석 선택\n수원삼성 vs FC안양 (11.29)\n2026.11.29(토) 2:00 PM\n관람 구역을 선택해 주세요\n원정석(S4~6)(GATE:4A)\n1500'); return JSON.stringify(state.groups); });
    await pg.context().close();
    check('놀티켓 구역 범위 등급(원정석(S4~6))은 범위 묶음 하나만 (빈 묶음이 하나 더 생기지 않음)', !/"free":true/.test(r) && /S4/.test(r), r);
    // --- 그리기, 요약 ---
    pg = await open(b);
    r = await pg.evaluate(() => { const o = {}, txt = id => document.getElementById(id).textContent, T = () => [...document.querySelectorAll('#trend text')].map(t => t.textContent);
      newGame(); Object.assign(state, { opp: '제주SK', date: '2026-11-30T14:00', at: '2026-11-25T12:00' }); state.rows.R1.remain = 100; render();
      o.home = /정보 없는 구역 \d+개는 예매로 셈/.test(txt('board')) && /는 예매로 셈/.test(summaryText());
      // 원정석 숫자가 없는 점뿐이면 홈석 그래프는 전체 예매로 (둘 다 비지 않게)
      history = [{ at: '2026-11-23T10:00:00+09:00', opponent: '제주SK', kickoff: '2026-11-30T14:00:00+09:00', booked: 9000, cap: 11542 }, { at: '2026-11-24T10:00:00+09:00', opponent: '제주SK', kickoff: '2026-11-30T14:00:00+09:00', booked: 9500, cap: 11542 }]; render();
      o.total = T().includes('예매 추이') && !T().some(t => /발행할 때마다/.test(t));
      // 예매 오픈 직후 몇 시간의 몰림은 며칠로 늘리지 않음(12시간 넘게 떨어진 점이 있어야 예상), 끝난 경기는 예상 없음, 눈금은 정수
      newGame(); Object.assign(state, { opp: '제주SK', date: '2026-11-30T14:00', at: '2026-11-25T11:05' });
      const h = (pts, ko = '2026-11-30T14:00') => { history = pts.map(([at, booked, ab]) => ({ at: at + ':00+09:00', opponent: '제주SK', kickoff: ko + ':00+09:00', booked, cap: 11542, awayBooked: ab, awayCap: 1235 })); state.date = ko; render(); return T(); };
      o.burst = !h([['2026-11-25T10:00', 0, 0], ['2026-11-25T11:05', 300, 30]]).some(t => t.startsWith('예상'));
      o.day = h([['2026-11-24T10:00', 0, 0], ['2026-11-25T11:05', 300, 30]]).some(t => t.startsWith('예상'));
      o.past = !h([['2026-11-08T10:00', 100, 10], ['2026-11-09T11:05', 300, 30]], '2026-11-10T14:00').some(t => t.startsWith('예상'));
      o.tick = !h([['2026-11-23T10:00', 1000, 500], ['2026-11-24T10:00', 1001, 501]]).some(t => /^\d[\d,]*\.\d$/.test(t));
      state.crowdAway = 300; o.away = /원정 관중 300명/.test(summaryText());
      return o; });
    await pg.context().close();
    check('홈: 정보 없는 구역은 예매로 센다고 적음(카드, 요약), 원정석 숫자가 없으면 홈 그래프는 전체 예매 추이', r.home && r.total, JSON.stringify(r));
    check('추이 예상: 오픈 직후 65분 몰림은 늘리지 않음, 하루 넘게 떨어지면 예상, 끝난 경기는 예상 없음, 눈금은 정수, 원정 관중만 넣어도 요약에', r.burst && r.day && r.past && r.tick && r.away, JSON.stringify(r));
    pg = await open(b, { url: URL + '?s=gimcheon#edit' });
    r = await pg.evaluate(() => { const o = {}, board = () => document.getElementById('board').textContent;
      newGame(); render(); o.none = !/\/ 0석/.test(board()) && /잔여석 정보 없음/.test(board());
      Object.assign(state.rows.S11, { remain: 100, max: 200 }); Object.assign(state.rows.S12, { remain: 100, max: 298 }); state.crowd = 5000; render();
      o.crowd = !/1004/.test(board()) && /관중이 많아 비율을 내지 않음/.test(board());
      state.crowd = null; SECTIONS.slice(0, 8).forEach(s => { state.rows[s.id].off = true; }); render();
      o.font = [...document.querySelectorAll('#board text[y="79"]')].every(t => +t.getAttribute('font-size') >= 10);
      return o; });
    await pg.context().close();
    check('원정: 숫자가 없으면 "- / 0석" 대신 빈칸과 "잔여석 정보 없음", 집계 구역 총석보다 관중이 많으면 비율 없음(1004% 아님), 카드 설명 글자 10px 이상', r.none && r.crowd && r.font, JSON.stringify(r));
    // --- 좌석 그림 인식 ---
    const PD = path.join(ROOT, '좌석스크린샷', '시험_포항'), A1 = path.join(PD, '좌석그림_A1.png');
    if (fs.existsSync(A1)) {
      pg = await open(b, { url: URL + '?s=pohang#edit' }); pg.on('dialog', d => d.accept());
      await pg.evaluate(() => document.getElementById('modeMax').click());
      await pg.setInputFiles('#file', A1); await pg.evaluate(() => document.getElementById('modeStatus').click());  // 인식하는 사이 현황 집계로 바꿔도
      await pg.evaluate(() => window.ocrDone);
      r = await pg.evaluate(() => [state.rows.A1.max, state.rows.A1.remain].join());
      // JPG 는 세지 않고 알림
      const jpg = path.join(require('os').tmpdir(), 'fc-anyang-A1.jpg');
      fs.writeFileSync(jpg, Buffer.from(await pg.evaluate(async b64 => { const im = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob()), c = Object.assign(document.createElement('canvas'), { width: im.width, height: im.height });
        c.getContext('2d').drawImage(im, 0, 0); return (await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.92)).then(x => x.arrayBuffer()).then(a => btoa(String.fromCharCode(...new Uint8Array(a))))); }, fs.readFileSync(A1).toString('base64')), 'base64'));
      await pg.evaluate(() => { state.rows.A21.max = null; document.getElementById('modeMax').click(); });
      await pg.setInputFiles('#file', jpg); await pg.evaluate(() => window.ocrDone);
      const st = await pg.evaluate(() => document.getElementById('status').innerText);
      await pg.context().close();
      check('좌석 그림: 인식하는 사이 현황 집계로 바꿔도 시작한 총석 집계로 (A1 총석 300, 잔여 그대로), JPG 는 세지 않고 PNG 로 넣으라고 알림', r === '300,' && /JPG, WebP 캡처는/.test(st), r + ' / ' + st);
    } else console.log('SKIP  포항 좌석 그림 (11/18 검토)');
    const NOLD2 = path.join(ROOT, '좌석스크린샷', '시험_놀티켓');
    if (fs.existsSync(path.join(NOLD2, '수원삼성_W13_왼쪽.png'))) {
      pg = await open(b, { url: URL + '?s=suwon#edit' }); pg.on('dialog', d => d.type() === 'prompt' ? d.accept('W13') : d.accept());
      await pg.evaluate(() => { state.rows.W13.max = null; document.getElementById('modeMax').click(); });
      await pg.setInputFiles('#file', ['수원삼성_W13_왼쪽.png', '수원삼성_W13_오른쪽.png'].map(x => path.join(NOLD2, x))); await pg.evaluate(() => window.ocrDone);
      r = await pg.evaluate(() => state.rows.W13.max);
      await pg.context().close();
      check('총석 집계에서 나눠 찍은 두 장(W13 왼쪽, 오른쪽)은 떨어진 묶음을 따로 더하지 않아 318 (388 아님)', r === 318, String(r));
    }
    // --- 발행 (가짜 GitHub: 실제 GitHub 에는 요청하지 않음) ---
    const G = require('./fakegh');
    const pub = (pg, at, rows, off = []) => pg.evaluate(async ([at, rows, off]) => { state.date = '2026-11-21T14:00'; state.at = at; Object.entries(rows).forEach(([id, v]) => state.rows[id].remain = v);
      off.forEach(id => { state.rows[id].off = true; state.rows[id].remain = null; }); saveOff(); save(); await publishNow(); return document.getElementById('note').textContent; }, [at, rows, off]);
    let gs = G.makeStore();
    const A = await G.open(b, gs, '?s=pohang#edit', { dialog: d => /다른 기기에서/.test(d.message()) ? d.dismiss() : d.accept() }); await A.waitForTimeout(800);
    await pub(A, '2026-11-18T10:00', { E1: 100, E2: 100, E3: 100 });
    const B2 = await G.open(b, gs, '?s=pohang#edit'); await B2.waitForTimeout(1500);
    await pub(B2, '2026-11-18T10:30', { E1: 60, E2: 60 }, ['E3']);
    const n3 = await pub(A, '2026-11-18T10:40', { E1: 55 }), L3 = gs.json('pohang/latest.json'), sec = id => L3.sections.find(x => x.id === id);
    r = await A.evaluate(() => [state.rows.E2.remain, state.rows.E3.off].join());
    check('오래 열어 둔 탭: 다른 기기의 더 나중 발행을 덮어쓰지 않고(묻고 취소) 그 발행을 불러옴', L3.updatedAt.startsWith('2026-11-18T10:30') && sec('E2').remain === 60 && sec('E3').unsold === true && /발행하지 않았습니다/.test(n3) && r === '60,true', JSON.stringify({ at: L3.updatedAt, n3, r }));
    await A.context().close(); await B2.context().close();
    gs = G.makeStore();
    const M1 = await G.open(b, gs, '?s=pohang#edit'), M2 = await G.open(b, gs, '?s=pohang#edit'); await M1.waitForTimeout(800);
    await M1.evaluate(() => { state.rows.E1.max = 211; delete state.rows.E1.learned; return publishNow(publishMax); });
    await M2.evaluate(() => { SECTIONS.forEach(x => { state.rows[x.id].max = null; }); state.rows.E3.max = 333; return publishNow(publishMax); });
    const mx = gs.json('pohang/max.json')?.max || {};
    check('총석 발행은 이미 올라간 총석에 합침 (다른 기기 총석이 지워지지 않음)', mx.E1 === 211 && mx.E3 === 333, JSON.stringify(mx));
    await M1.context().close(); await M2.context().close();
    gs = G.makeStore(); gs.set({ 'pohang/latest.json': { app: 'fc-anyang-seats', version: 1, updatedAt: '2026-11-18T10:00:00+09:00', match: { kickoff: '2026-11-21T14:00:00+09:00' }, sections: [{ id: 'E1', remain: 50, max: 150, maxGuess: true }, { id: 'E2', remain: 40, max: 120 }] },
      'pohang/max.json': { app: 'fc-anyang-seats', updatedAt: '2026-11-18T10:10:00+09:00', max: { E1: 200, E2: 130 } } });
    const N = await G.open(b, gs, '?s=pohang#edit'); await N.waitForTimeout(1500);
    r = await N.evaluate(() => [state.rows.E1.remain, state.rows.E1.max, !!state.rows.E1.learned, state.rows.E2.max].join());
    check('입력 화면을 열 때 발행본을 불러와도 그 뒤에 올린 총석(max.json)이 이김', r === '50,200,false,130', r);
    await N.context().close();
    gs = G.makeStore();
    const U = await G.open(b, gs, '?s=pohang#edit'); await U.waitForTimeout(800);
    await pub(U, '2026-11-18T10:00', { E1: 100, E2: 100 }); await pub(U, '2026-11-18T10:20', { E1: 10, E2: 10 });
    r = await U.evaluate(async () => { await unpublishNow(false); const o = [state.pubAt, state.pubSnap?.rows.E1]; newCapture({ opp: '', date: '2026-11-21T14:00' }, '2026-11-18T11:00');
      state.rows.E1.remain = 95; state.rows.E2.remain = 100; o.push(/10:00 이후 \+5석/.test(summaryText())); return o.join(); });
    check('마지막 발행 지우기 뒤 비교 기준은 되돌린 발행(10:00, 지운 10:20 아님)', r === '2026-11-18T10:00,100,true', r);
    r = await U.evaluate(async () => { state.at = '2026-11-18T12:00'; state.rows.E1.remain = 90; save(); const job = publishNow(); await new Promise(ok => setTimeout(ok, 30));
      state.at = '2026-11-18T12:01'; state.rows.E2.remain = 50; save(); await job; return [state.pubAt, state.pubSnap.rows.E2].join(); });
    check('발행하는 사이 새 숫자가 들어와도 비교 기준은 실제로 올린 집계', r === '2026-11-18T12:00,100' && gs.json('pohang/latest.json').updatedAt.startsWith('2026-11-18T12:00'), r);
    await U.context().close();
    gs = G.makeStore(); gs.rawOverride = { 'pohang/latest.json': Buffer.from(JSON.stringify({ app: 'fc-anyang-seats', updatedAt: '2026-11-18T10:00:00+09:00', match: {}, sections: [{ id: 'E1', remain: 77 }] })) };
    const F = await G.open(b, gs, '?s=pohang#edit'); await F.waitForTimeout(1200);
    r = await F.evaluate(async () => [(await fetchData('latest.json')).status, state.rows.E1.remain].join());
    check('지금 없는 파일(API 404)은 raw 의 옛 사본으로 다시 받지 않음 (방금 지운 발행이 다시 보이지 않게)', r === '404,', r);
    await F.context().close();
    gs = G.makeStore();
    const S = await G.open(b, gs, '?s=suwon#edit'); await S.waitForTimeout(800);
    r = await S.evaluate(async () => { fcIngest('좌석 선택\n수원삼성 vs FC안양 (11.29)\n2026.11.29(토) 2:00 PM\n관람 구역을 선택해 주세요\n2층 E석(E15~19)(GATE:3A,3B)\n1,191'); await publishNow(); return document.getElementById('note').textContent; });
    const og = await S.evaluate(async () => { const J = { s1: { updatedAt: '2026-11-18T10:00:00+09:00' }, s2: { updatedAt: '2026-11-18T11:00:00+09:00' } };
      const gh = async p => ({ content: btoa(unescape(encodeURIComponent(JSON.stringify(J[p.split('/').pop()])))) });
      return (await ogAfter(gh, [{ path: 'latest.json', sha: 's1' }, { path: 'latest.png', sha: 'i1' }, { path: 'prev/latest.json', sha: 's2' }, { path: 'prev/latest.png', sha: 'i2' }])).map(f => f.sha || f.content).join(' '); });
    await S.context().close();
    check('놀티켓 등급 묶음만 받은 원정 현황도 발행됨', !!gs.json('suwon/latest.json') && !/구역 숫자가 없어/.test(r), r);
    check('지운 뒤 미리보기는 되돌리기용 prev/latest 를 구장으로 보지 않음', /^i1 .*"stadium":"anyang"/.test(og), og);
  }

  await b.close();
  const fail = results.filter(x => !x).length;
  console.log(`\n${results.length - fail}/${results.length} 통과`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('시험 실행 실패:', e.message); process.exit(1); });
