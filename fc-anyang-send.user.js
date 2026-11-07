// ==UserScript==
// @name         FC안양 예매현황 보내기
// @namespace    https://goormigrm.github.io/fc-anyang-seats/
// @version      8
// @description  티켓링크 좌석 선택 화면에 보이는 잔여석 글자를 열려 있는 현황판 탭으로 보냄. 읽기만 하고 클릭, 새로고침, 요청은 하지 않음
// @match        https://ticketlink.co.kr/*
// @match        https://*.ticketlink.co.kr/*
// @match        https://goormigrm.github.io/fc-anyang-seats/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// ==/UserScript==
// Tampermonkey 저장소는 브라우저마다 따로라서 티켓링크와 현황판이 같은 브라우저(크롬끼리, 웨일끼리)에 있어야 넘어감
const ua = navigator.userAgent, browser = /Whale\//.test(ua) ? '웨일' : /Edg\//.test(ua) ? '엣지' : /Chrome\//.test(ua) ? '크롬' : /Firefox\//.test(ua) ? '파이어폭스' : '브라우저';
if (location.hostname.endsWith('ticketlink.co.kr')) {
  // 사람이 등급을 누를 때마다 좌석 줄이 바뀌면 0.8초 뒤 한 번 보냄. FC안양 경기의 좌석 선택 화면('등급 선택', "N석")에서만
  // 홈인지 어느 원정 구장인지는 받는 현황판이 경기장 이름으로 확인 (안양 홈 화면은 안양종합운동장, 김천 원정 화면은 김천종합운동장만 받음)
  // 보내는 글자는 경기 정보(경기장 이름 포함)와 등급, 구역, 숫자 줄만 (로그인 이름 같은 다른 글자, 초 단위로 바뀌는 표시는 빼고)
  const pick = () => document.body.innerText.split('\n').map(l => l.trim())
    .filter(l => /석|구역|안양|등급|운동장|경기장|스타디움|구장|\d{4}\.\d{2}\.\d{2}|^\d+$/.test(l)).join('\n');
  const look = () => {
    const s = pick(), need = [['안양', /안양/], ['등급 선택', /등급\s*선택/], ['N석', /\d\s*석/]].filter(([, re]) => !re.test(s)).map(([n]) => n);
    return { s, seat: !need.length, need, venue: (s.match(/[가-힣]+(?:운동장|경기장|스타디움|구장)/) || [''])[0], zones: (s.match(/구\s*역/g) || []).length };
  };
  const me = Math.random().toString(36).slice(2, 8);  // 탭, 틀(iframe)마다 다른 이름 (현황판이 보낸 곳을 구분)
  const hms = t => new Date(t).toTimeString().slice(0, 8);
  // 화면 오른쪽 아래 작은 표시 (그림자 DOM 이라 화면 글자에 섞이지 않음). 색: 회색 대기, 보라 보냄, 초록 현황판이 받음, 주황 안 받음, 빨강 현황판 없음
  let badge;
  const show = (msg, bg) => {
    if (!badge) {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483647';
      badge = host.attachShadow({ mode: 'closed' }).appendChild(document.createElement('div'));
      badge.style.cssText = 'font:12px sans-serif;color:#fff;padding:4px 8px;border-radius:6px;opacity:.92;max-width:420px';
      document.documentElement.appendChild(host);
    }
    badge.textContent = '현황판 보내기: ' + msg;
    badge.style.background = bg;
  };
  let last = '', sentAt = 0, acked = null, resent = false, timer;
  // 상태 신호: 바뀔 때와 5초마다 (현황판 램프가 예매 화면이 열려 있는지, 닫혔는지 알 수 있게)
  const ping = () => {
    const v = look();
    GM_setValue('ping', { id: me, state: v.seat ? 'seat' : 'idle', need: v.need, venue: v.venue, zones: v.zones, sentAt, hidden: document.hidden, at: Date.now(), where: location.host + location.pathname.slice(0, 30) });
    return v;
  };
  const send = () => { sentAt = Date.now(); acked = null; GM_setValue('text', { s: last, at: sentAt }); };
  const check = () => {
    const v = ping(), b = GM_getValue('board'), board = b && Date.now() - b.at < 90e3;  // 현황판 입력 화면이 5초마다 남기는 신호 (뒤 탭은 1분까지 늦음)
    if (!v.seat) return show(`대기 · 등급/좌석 선택 화면이 아님 (화면에 없는 글자: ${v.need.join(', ')})`, '#555');
    if (v.s !== last) { last = v.s; resent = false; send(); ping(); setTimeout(check, 3000); }
    else if (board && !acked && !resent && Date.now() - sentAt > 4000) { resent = true; send(); setTimeout(check, 3000); }  // 현황판을 나중에 열었으면 한 번 다시 보냄
    if (acked?.ok) show(`현황판이 받음 ${hms(acked.at)} (구역 ${acked.n}개)`, '#15803d');
    else if (acked) show(`현황판이 안 받음: ${acked.why}`, '#c2410c');
    else if (!board) show(`예매 화면 감지 · 이 ${browser}에 현황판 입력 화면이 없어 못 넘김 → 이 ${browser}에서 현황판 입력 화면(#edit)을 여세요`, '#b91c1c');
    else show(`예매 화면 감지 · 보냄 ${hms(sentAt)} (구역 ${v.zones}줄), 현황판 응답 기다리는 중`, '#3e1a78');
  };
  // 현황판이 받았는지: 홈, 원정 현황판이 같이 열려 있으면 둘 다 답하므로 받은 쪽을 우선
  GM_addValueChangeListener('ack', (key, old, v, remote) => { if (remote && v.at >= sentAt && (v.ok || !acked?.ok)) { acked = v; check(); } });
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(check, 800); }).observe(document.body, { childList: true, subtree: true, characterData: true });
  setTimeout(check, 1500);
  setInterval(check, 5000);  // 탭이 뒤에 있으면 브라우저가 1분에 한 번으로 늦춤 (현황판은 hidden 이면 오래 기다림)
} else {
  // 현황판 쪽: 글자와 상태를 현황판으로 넘기고, 받았는지(ack)와 입력 화면이 열려 있다는 신호(board)를 티켓링크 쪽에 돌려줌
  const editing = () => document.body.classList.contains('editing');
  GM_addValueChangeListener('text', (key, old, v, remote) => { const r = remote && editing() && unsafeWindow.fcIngest?.(v.s); if (r) GM_setValue('ack', { ...r, at: Date.now(), page: location.search }); });
  GM_addValueChangeListener('ping', (key, old, v, remote) => { if (remote) unsafeWindow.fcPing?.(v); });
  unsafeWindow.fcPing?.({ state: 'installed', version: 8, at: Date.now() });
  const beat = () => { if (editing()) GM_setValue('board', { at: Date.now(), page: location.search }); };
  beat();
  setInterval(beat, 5000);
}
