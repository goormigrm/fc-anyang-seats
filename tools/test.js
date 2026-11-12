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
  check('원정 경기 화면은 무시 (안양종합운동장 아님)', r.v === r.before && /'안양종합운동장'가 없어 넘겼습니다/.test(r.st), JSON.stringify(r));

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

  // 지난 경기와 같은 시점 비교: 앞 경기(부천전)의 추이 점 중 경기 시작까지 남은 시간이 지금(48시간)과 같거나 더 남았던 마지막 점(52.5시간 전: 홈석 3,350, 원정석 150)
  {
    const pg = await open(b);
    r = await pg.evaluate(() => {
      newGame(); Object.assign(state, { opp: '제주SK', date: '2026-11-28T14:00', at: '2026-11-26T14:00' }); state.rows.R10.remain = 26; state.rows.원정석.remain = 1000;
      const pt = (at, booked, ab) => ({ at: at + ':00+09:00', opponent: '부천FC1995', kickoff: '2026-11-01T16:30:00+09:00', booked, cap: 11542, awayBooked: ab, awayCap: 1235, unknown: 0 });
      history = [pt('2026-10-29T10:00', 3000, 100), pt('2026-10-30T12:00', 3500, 150), pt('2026-10-31T16:00', 5000, 300)]; render();
      const out = { a: document.getElementById('trend').textContent, hid: getComputedStyle(document.getElementById('restore')).display };
      history = history.slice(2); render(); out.none = document.getElementById('trend').textContent;  // 같은 시점보다 늦은 점만 있으면 안 보임
      return out;
    });
    check('추이: 지난 경기 같은 시점 비교 (홈석 3,350 대비 +6,931, 원정석 150 대비 +85), 자료 없으면 안 보임', /부천FC1995전 같은 시점 3,350석 대비 \+6,931/.test(r.a) && /부천FC1995전 같은 시점 150석 대비 \+85/.test(r.a) && !/같은 시점/.test(r.none), r.a);
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
    check('구역 누르면 자세히: 남은 / 총 / 예매율, 정보 없음, 잔디를 누르면 닫힘', t1 === 'R10 · 남은 26 / 총 126 · 예매율 79%' && t2 === '원정석 · 남은 1,000 / 총 1,235 · 예매율 19%' && t3 === 'R15 · 정보 없음 · 총 141' && t4 === '', JSON.stringify([t1, t2, t3, t4]));
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
    r = await pg.evaluate(async () => {
      SECTIONS.forEach(s => state.rows[s.id].remain = null); Object.assign(state, { opp: '제주SK', date: '2026-11-01T16:30', at: '2026-11-04T21:08' }); syncInputs();
      [['crowd', '4464'], ['crowdAway', '555']].forEach(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')); });
      const before = [record().booked, record().available];
      await publishNow(true); const other = [document.getElementById('pubNote').textContent, state.rows.R10.remain];
      state.opp = '부천FC1995'; syncInputs(); await publishNow(true);
      return { before, other, R10: state.rows.R10.remain, gen: state.rows.일반지정석.remain, crowd: [state.crowd, state.crowdAway].join(), at: state.at, booked: record().booked };
    });
    await pg.context().close();
    check('구역 숫자 없이 발행: 예매 null, 다른 경기면 안 함, 같은 경기면 발행본 구역 숫자를 불러와 공식 관중만 바꿈',
      r.before.join() === ',' && /구역 숫자가 없어 발행하지 않았습니다/.test(r.other[0]) && r.other[1] === null && r.R10 === 0 && r.gen === 1000 && r.crowd === '4464,555' && r.at === '2026-11-01T16:30' && r.booked > 0, JSON.stringify(r));
  }
  // 추이 이미지
  r = await p.evaluate(async () => { const bl = await pngBlob('trend'), im = await createImageBitmap(bl); return [im.width, im.height, bl.size]; });
  check('추이 이미지 (1080x1920)', r[0] === 1080 && r[1] === 1920 && r[2] > 20000, r.join());
  // 토큰 잠금: 잠그고 풀기, 탭 동안 기억
  r = await p.evaluate(async () => { const v = await lockToken('ghp_test123', '0000'); localStorage.setItem(TOKEN, v); sessionStorage.removeItem(TOKEN); const no = await getToken(false); const ok = await unlockToken(v, '0000'); let bad = ''; try { await unlockToken(v, '1111'); bad = 'opened'; } catch { bad = 'refused'; } sessionStorage.setItem(TOKEN, ok); const again = await getToken(false); localStorage.removeItem(TOKEN); sessionStorage.removeItem(TOKEN); return { enc: v.startsWith('enc:') && !v.includes('ghp_test123'), no, ok, bad, again }; });
  check('토큰 잠금 (비밀번호, 틀리면 안 열림, 탭 동안 기억)', r.enc && r.no === '' && r.ok === 'ghp_test123' && r.bad === 'refused' && r.again === 'ghp_test123', JSON.stringify(r));
  r = await p.evaluate(() => { localStorage.setItem(TOKEN, 'x'); localStorage.setItem('fc-anyang-token-exp', new Date(Date.now() + 10 * 86400e3).toISOString().slice(0, 10)); tokenInfo(); const n = document.getElementById('note').innerText, h = document.getElementById('tokenHint').innerText; localStorage.removeItem(TOKEN); localStorage.removeItem('fc-anyang-token-exp'); return { n, h }; });
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
    const mid = sel => p.evaluate(sel => { const el = document.querySelector(sel); el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
    await p.mouse.click(...await mid('#stadium [data-z="R20"]')); const z2 = await st();
    await p.mouse.click(...await mid('#stadium rect[fill="url(#grass)"]')); const z3 = await st();
    check('휴대폰: 크게 본 상태에서 구역을 누르면 자세히(확대 그대로), 잔디를 누르면 원래대로', z1 === 'true|' && z2 === 'true|R20 · 정보 없음 · 총 123' && z3 === 'false|', JSON.stringify({ z1, z2, z3 }));
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
      check('보내기 스크립트: 놀티켓 좌석 화면 감지(좌석등급), 보낸 곳 놀티켓, 다른 야놀자 화면은 표시 안 함', ping?.state === 'seat' && ping?.site === '놀티켓' && /이 크롬에 현황판 입력 화면이 없어/.test(b5) && !b6 && ping6?.state === 'idle', JSON.stringify({ ping, b5, b6, ping6 }));
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
      const pg = await open(b, { url: URL + '?s=suwon#edit' });
      r = await pg.evaluate(s => { const k = fcIngest(s), t = stats(); return { k, S1: state.rows.S1.remain, fam: !!state.rows.프리미엄패밀리박스, z: [zoneId('W13'), zoneId('W13구역'), zoneId('2층 테이블석(GATE:1A)')].join(), E5: state.rows.E5.remain, date: state.date,
        max: SECTIONS.filter(x => state.rows[x.id].max).length, none: SECTIONS.filter(x => !state.rows[x.id].max).map(x => x.id).join(), m: ['E15', 'S3', 'W9', 'W5', 'E9', 'N8'].map(id => state.rows[id].max).join(), w13: state.rows.W13.max + state.rows.W13미판매구역.max, cap: t.cap, booked: t.booked }; }, sent.text.s);
      await pg.context().close();
      check('놀티켓 글자 받기(수원삼성): 경기장 이름 없어도 홈 팀 + 안양이면 받음, 숫자만 줄, 괄호 뺀 구역 이름, 오후 2시, 칸 없는 패밀리박스는 넘김, W13 = 2층 테이블', r.k?.ok && r.S1 === 12 && r.fam === false && r.z === 'W13,W13,W13' && r.E5 === 40 && r.date === '2026-11-29T14:00', JSON.stringify(r));
      // 수원삼성 총석(11/08 받은 자료, W13 772 는 2층 테이블 318 + 미판매 구역 454 로 나눔): 칸 62개 모두, 받은 잔여로 예매 수 (S1 546-12, E5 527-40)
      check('수원삼성 총석: 칸 62개 모두, W13 2층 테이블 + 미판매 구역 = 받은 W13 772 (5석 이하 차이 허용), 캡처로 센 값과 같음, 예매 수 바로 나옴', r.max === 62 && r.none === '' && Math.abs(r.w13 - 772) <= 5 && r.m === '843,637,504,276,116,940' && r.cap === 546 + 527 + 3929 && r.booked === 534 + 487 + 3929 - 1191, JSON.stringify(r));  // + 2층 E석(E15~19) 묶음: 총석 3,929 - 묶음 잔여 1,191
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
        const E = 3929, eb = 3929 - 1191;
        check('놀티켓 등급 묶음: 범위 묶음은 바로 예매 수에(≈ 추정), 범위 없는 원정석은 구역을 정해야 셈, 숫자 끝이 4 여도 그대로(S4 504, E5 14)',
          r.k.ok && r.k.n === 4 && /원정석 1,538석: 어느 구역인지 정하지 않아/.test(r.st) && r.a === [E + 637 + 527, eb + 133 + 513, 637, 133].join() && r.btn === false && /^≈69% \(묶음 추정/.test(r.cell) && r.svg >= 5, JSON.stringify({ ...r, json: 0 }));
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
        r.early === '/' && /^12\/30 보내기 스크립트가 좌석 그림을 셌습니다: N11 남은 12 \/ 전체 30 \(전체를 최대 좌석으로\)/.test(r.own) && /^12\/30 ⚠ 보내기 스크립트가 센 N11 남은 칸 25석이 잔여 12석과 달라/.test(r.diff)
        && r.byRemain === '30/44' && /어느 구역인지 몰라 넣지 않았습니다/.test(r.unknown) && r.off === '/240', JSON.stringify(r));
    }
    // 보기 화면(입력 화면 아님)은 신호도 응답도 안 함
    p = await open(b, { url: URL + '?s=gimcheon' });
    await run(p, {}, 'false');
    r = await p.evaluate(() => { __l.text('text', null, { s: '김천상무 vs FC안양\n김천종합운동장 | 2026.11.07(토) 16:30\n등급 선택\nW12구역\n196 석', at: Date.now() }, true); return { board: __set.board, ack: __set.ack }; });
    check('보내기 스크립트: 보기 화면은 입력 화면 신호, 응답 없음', !r.board && !r.ack, JSON.stringify(r));
    await p.context().close();
  }

  // 입력 화면(PC): 경기 정보, 스크린샷 인식, 구역별 잔여석, 발행, 집계 기록, 직전 집계와 비교 순서로 칸마다 가로 전체
  p = await open(b);
  r = await p.evaluate(() => {
    const boxes = [...document.querySelectorAll('.panel > .box')], pw = document.querySelector('.panel').getBoundingClientRect().width;
    return { order: boxes.map(x => x.querySelector('h2').textContent).join(','), full: boxes.every(x => Math.abs(x.getBoundingClientRect().width - pw) < 1),
      stacked: boxes.every((x, i) => !i || x.getBoundingClientRect().top >= boxes[i - 1].getBoundingClientRect().bottom), off: document.querySelectorAll('[data-a=off]').length };
  });
  check('입력 화면: 6칸 순서, 칸마다 가로 전체, 홈은 미판매 버튼 없음', r.order === '경기 정보,스크린샷 인식,구역별 잔여석,발행,집계 기록,직전 집계와 비교' && r.full && r.stacked && r.off === 0, JSON.stringify(r));
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
    return { cap: t.cap, booked: t.booked, svg1: svg.includes('예매된 좌석') && svg.includes('>265<') && svg.includes(' / 762석') && svg.includes('원정석 포함 판매 구역 전체'), rate: svg.includes('34.8<tspan'), s: svg.includes('원정석 예매') && svg.includes(' / 451석') && svg.includes('원정석 33.3% 예매'),
      zone: svg.includes('W12 36%'), diff: /% [+−]\d/.test(svg), since: svg.includes('+4'), legend: svg.includes('>예매율<') && svg.includes('0~24%'),
      trend: getComputedStyle(tr).display !== 'none' && tr.innerHTML.includes('홈석 예매 추이') && tr.innerHTML.includes('원정석 예매 추이') && tr.innerHTML.includes('>115<') && tr.innerHTML.includes('37.0%') && tr.innerHTML.includes('>150<') && tr.innerHTML.includes('33.3%'),
      away: (r => [r.awayBooked, r.awayCapacity].join())(record()),
      head: document.querySelector('thead th:last-child').textContent, cell: document.querySelector('tr[data-id="W12"]').cells[4].textContent, pub: document.getElementById('pubNote').textContent,
      sum: summaryText(), rec: (r => [r.capacity, r.booked])(record()) };
  });
  check('예매 현황: 예매된 좌석, 예매율, 원정석 예매 카드, 구역 예매율, 증감 표시 없음(구역, 카드), 추이는 홈석(115, 37.0%)/원정석(150, 33.3%) 두 그래프, 표 예매율, 요약 글, 발행 JSON, 발행 칸 알림',
    r.cap === 762 && r.booked === 265 && r.svg1 && r.rate && r.s && r.zone && !r.diff && !r.since && r.legend && r.trend && r.head === '예매율' && r.cell === '36%' && r.pub === '발행했습니다.'
    && /예매 265석 \/ 762석 \(34\.8%\), 원정석 예매 150석 \/ 451석 \(33\.3%\)/.test(r.sum) && r.rec.join() === '762,265' && r.away === '150,451', JSON.stringify(r));
  // 공식 관중을 전체, 원정으로 나눠 넣기 (월·화 발표): 홈석 그래프는 홈 관중(전체 - 원정), 원정석 그래프는 원정 관중, 머리글, 요약 글, 발행 JSON, 새로 열어도 남음
  const crowdOf = () => p.evaluate(() => {
    const tr = document.getElementById('trend').innerHTML, rec = record();
    return { tr: /홈 관중 260명 \(홈석 예매 115석 대비 \+145\)/.test(tr) && /원정 관중 140명 \(원정석 예매 150석 대비 [−-]10\)/.test(tr) && !tr.includes('전체 예매'),
      head: (h => ['>공식 관중<', '400<tspan', '>좌석 대비 관중<', '52.5<tspan', '마지막 집계 예매 265석', '>원정 관중<', '140<tspan', '원정석 집계 예매 150석', '관중은 연맹 공식 발표'].every(x => h.includes(x)))(document.getElementById('board').innerHTML),
      sum: /^[^\n]+\n공식 관중 400명 \(원정 140명, 원정석 예매 150석 대비 [−-]10\)\n마지막 집계 예매 265석/.test(summaryText()),
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
      ['jeonbuk', 94, 9, H2('전북현대', '전주월드컵경기장') + 'S원정\n500 석\nS-1C구역\n120 석\nE일반2A구역\n30 석\n1A구역\n7 석', { S1C: 120, E2A: 30 }, '1A'],
      ['pohang', 61, 7, H2('포항스틸러스', '포항스틸야드') + '청암E1구역\n100 석\nA1구역\n50 석\n데크석\n20 석', { E1: 100, A1: 50, 데크석: 20 }, ''],
      ['seoul', 69, 3, H2('FC서울', '서울월드컵경기장') + 'E-A구역\n80 석\nSC구역\n40 석', { EA: 80, SC: 40 }, ''],
      ['ulsan', 106, 11, H2('울산HD', '울산문수축구경기장') + 'N1구역\n120 석\nE13구역\n50 석\n프리미엄 테이블석\n10 석', { N1: 120, E13: 50, 프리미엄테이블석: 10 }, ''],
      ['incheon', 50, 1, H2('인천유나이티드', '인천축구전용경기장') + '원정석\n500 석\nE3구역\n90 석\nV1구역\n10 석', { 원정석: 500, E3: 90, V1: 10 }, ''],
      ['suwon', 62, 13, H2('수원삼성', '수원월드컵경기장') + 'S3구역\n20 석\nE5구역\n40 석', { S3: 20, E5: 40 }, ''],
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
  check('구장 버튼: 안양 홈, 김천(지금, 11.07), 전북, 포항, 북패(서울), 울산, 인천, 수원삼성, 수원FC, 부천, 강원, 경기별 기록', r === '안양 홈|김천11.07*|전북|포항|북패|울산|인천|수원삼성|수원FC|부천|강원|경기별 기록', r);
  await p.context().close();

  // 사이트 화면에서만 FC서울 = '북패' (저장, 공유 이미지와 요약 글은 '서울', 경기장 이름은 그대로)
  p = await open(b, { url: URL + '?s=seoul#edit' });
  r = await p.evaluate(() => {
    fcIngest('FC서울 vs FC안양\n서울월드컵경기장 | 2026.11.29(일) 14:00\n등급 선택\nSC구역\n40 석');
    const svg = document.getElementById('board').innerHTML, png = build(false), story = build(true);
    return { screen: svg.includes('북패 vs FC안양') && svg.includes('북패 쪽') && !svg.includes('FC서울') && svg.includes('서울월드컵경기장'), title: document.title,
      png: png.includes('FC서울 vs FC안양') && png.includes('서울 쪽') && !png.includes('북패'), story: story.includes('FC서울 vs FC안양') && !story.includes('북패'), sum: summaryText().startsWith('FC서울 vs FC안양') };
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
    await ctx.addInitScript(() => { if (!localStorage.getItem('fc-anyang-seat-status')) localStorage.setItem('fc-anyang-seat-status', JSON.stringify({ rows: { FS4: { remain: 20, max: 20, learned: true }, FS1: { remain: 5, max: 48 }, FS5: { remain: 9, max: 9, learned: true } } })); });
    const pg = await ctx.newPage(); await pg.goto(URL + '#edit');
    r = await pg.evaluate(() => [state.rows.FS4.max, !!state.rows.FS4.learned, state.rows.FS1.max, state.rows.FS5.max, !!state.rows.FS5.learned].join());
    await ctx.close();
    check('확인된 총석 FS4 36 은 배운 추정값(20)보다 우선, 사람이 넣은 FS1 48 과 모르는 FS5 추정값은 그대로', r === '36,false,48,9,true', r);
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
    check('요약 글: 구역 숫자가 없으면 예매 줄 없음, 사람이 넣은 최대(1500)는 잔여 1550 이 와도 그대로 두고 ⚠', !/11,542석 \/ 11,542석/.test(r.none) && /구역 숫자가 아직 없습니다/.test(r.none) && r.max === 1500 && /⚠ 잔여가 최대보다 많음: 일반지정석/.test(r.st), JSON.stringify(r));
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
      const ok = r.remain === want[0] && r.max === want[1] && (label ? !asked : asked.includes(`남은 ${want[0]}석 / 전체 ${want[1]}석`));
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
      check(`좌석 그림 남은 ${want[0]} vs 티켓링크 잔여 ${list}: ${okMax ? '맞음 -> 넣어 둔 총석 302 그대로, 다르다고 알림' : '다름 -> 넣지 않고 경고 (302 그대로)'}`, r.remain === list && (okMax ? r.max === 302 && /W23 좌석 그림 전체 336석이 표의 최대 302석과 다릅니다/.test(r.st) : r.max === 302 && /⚠ W23 좌석 그림의 남은 칸 155석이 잔여 143석과 달라/.test(r.st)), JSON.stringify(r));
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
    const x = r.rows, want = { R10: 26, R11: 1, R12: 0, R14: 52, P: 204, T4: 58, T3: 30, 일반지정석: 1426, 스탠딩석: 18 };
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
      r.W12 === 196 && r.W13 === 267 && r.W11 === 0 && r.W11max === 240 && /W11 좌석 그림 전체 242석이 표의 최대 240석과 다릅니다/.test(r.st) && r.E === '0,278,275,279,0,0,0,415,0', JSON.stringify(r));
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
    let h = raw('history.json');
    check('발행: 10분 안 발행은 점 하나 (3번 발행 -> 2점)', h?.map(x => x.at.slice(11, 16)).join() === '12:35,12:00', JSON.stringify(h));
    const paths = () => execSync(`gh api "repos/goormigrm/fc-anyang-seats/git/trees/${B}?recursive=1" --jq "[.tree[].path]|join(\\",\\")"`, { encoding: 'utf8' });
    check('발행: 그보다 앞 발행본 숫자는 prev/old/ 에 (1 = 바로 그 전)', raw('prev/latest.json')?.updatedAt.startsWith('2026-11-26T12:35') && raw('prev/old/1.json')?.updatedAt.startsWith('2026-11-26T12:30'), paths());
    const msg = await p.evaluate(([t, B]) => unpublish(t, false, B), [token, B]);
    h = raw('history.json');
    check('마지막 발행 지우기: prev/old/ 는 그대로 남고 맨 위로 옮겨지지 않음', raw('prev/old/1.json')?.updatedAt.startsWith('2026-11-26T12:30') && !/(^|,)old\//.test(paths()), paths());
    check('마지막 발행 지우기 -> 그 전 발행과 그때 추이', raw('latest.json')?.updatedAt.startsWith('2026-11-26T12:35') && h?.length === 1 && /되돌렸습니다/.test(msg), msg + JSON.stringify(h));
    await p.evaluate(([t, B]) => { fcIngest('FC안양 vs 울산HD\n안양종합운동장 | 2026.12.05(토) 14:00\n일반지정석(2층)\n3000 석'); state.at = '2026-12-04T10:00'; return publish(t, B); }, [token, B]);
    const tree = execSync(`gh api "repos/goormigrm/fc-anyang-seats/git/trees/${B}?recursive=1" --jq "[.tree[].path]|join(\\",\\")"`, { encoding: 'utf8' });
    check('경기가 바뀌면 지난 경기를 games/ 에 보관', /games\/2026-11-28_제주SK\.json/.test(tree), tree);
    const ap = await open(b, { url: URL + '?s=gimcheon#edit', live: true });
    await ap.evaluate(([t, B]) => { fcIngest('김천상무 vs FC안양\n김천종합운동장 | 2026.11.07(토) 16:30\nS11구역\n50 석'); return publish(t, B); }, [token, B]);
    check('원정 발행은 구장 폴더에, 홈 발행은 그대로', raw('gimcheon/latest.json')?.match.home === '김천상무' && raw('latest.json')?.match.opponent === '울산HD', '');
    // 링크 미리보기(og.png): 가장 늦은 집계(홈 12/04 10:00)의 그림. 그보다 이른 집계(김천 11/07)를 발행해도 그대로, 더 늦은 집계면 그 구장으로
    const sha = f => { try { return execSync(`gh api "repos/goormigrm/fc-anyang-seats/contents/${f}?ref=${B}" --jq .sha`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
    const og1 = raw('og.json'), same1 = sha('og.png') && sha('og.png') === sha('latest.png');
    await ap.evaluate(([t, B]) => { state.at = '2026-12-06T09:00'; return publish(t, B); }, [token, B]);
    const og2 = raw('og.json'), same2 = sha('og.png') === sha('gimcheon/latest.png');
    check('링크 미리보기: 가장 늦은 집계의 그림(og.png)을 가리킴, 이른 집계를 발행해도 그대로, 더 늦으면 바뀜', og1?.stadium === 'anyang' && og1.at.startsWith('2026-12-04T10:00') && same1 && og2?.stadium === 'gimcheon' && og2.at.startsWith('2026-12-06T09:00') && same2, JSON.stringify({ og1, same1, og2, same2 }));
    await ap.evaluate(([t, B]) => unpublish(t, true, B), [token, B]);
    check('원정 발행 모두 지우기는 홈 파일을 건드리지 않음', raw('gimcheon/latest.json') === null && raw('latest.json')?.match.opponent === '울산HD', '');
    await ap.context().close();
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
