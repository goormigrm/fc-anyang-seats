// ==UserScript==
// @name         FC안양 예매현황 보내기
// @namespace    https://goormigrm.github.io/fc-anyang-seats/
// @version      7
// @description  티켓링크 좌석 선택 화면에 보이는 잔여석 글자를 열려 있는 현황판 탭으로 보냄. 읽기만 하고 클릭, 새로고침, 요청은 하지 않음
// @match        https://ticketlink.co.kr/*
// @match        https://*.ticketlink.co.kr/*
// @match        https://goormigrm.github.io/fc-anyang-seats/*
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// ==/UserScript==
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
  // 화면 오른쪽 아래 작은 표시 (그림자 DOM 이라 화면 글자에 섞이지 않음)
  let badge;
  const show = msg => {
    if (!badge) {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483647';
      badge = host.attachShadow({ mode: 'closed' }).appendChild(document.createElement('div'));
      badge.style.cssText = 'font:12px sans-serif;background:#3e1a78;color:#fff;padding:4px 8px;border-radius:6px;opacity:.9';
      document.documentElement.appendChild(host);
    }
    badge.textContent = '현황판 보내기: ' + msg;
  };
  let last = '', sentAt = 0, timer;
  // 상태 신호: 바뀔 때와 5초마다 (현황판 램프가 예매 화면이 열려 있는지, 닫혔는지 알 수 있게)
  const ping = () => {
    const v = look();
    GM_setValue('ping', { id: me, state: v.seat ? 'seat' : 'idle', need: v.need, venue: v.venue, zones: v.zones, sentAt, hidden: document.hidden, at: Date.now(), where: location.host + location.pathname.slice(0, 30) });
    return v;
  };
  const check = () => {
    const v = ping();
    if (!v.seat) return show(`대기 · 등급/좌석 선택 화면이 아님 (화면에 없는 글자: ${v.need.join(', ')})`);
    if (v.s !== last) { last = v.s; sentAt = Date.now(); GM_setValue('text', { s: v.s, at: sentAt }); ping(); }
    show(`예매 화면 감지 · 보냄 ${new Date(sentAt).toTimeString().slice(0, 8)} (구역 ${v.zones}줄)`);
  };
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(check, 800); }).observe(document.body, { childList: true, subtree: true, characterData: true });
  setTimeout(check, 1500);
  setInterval(ping, 5000);  // 탭이 뒤에 있으면 브라우저가 1분에 한 번으로 늦춤 (현황판은 hidden 이면 오래 기다림)
} else {
  // 현황판 쪽: 글자와 상태를 현황판으로 넘기고, 설치돼 있다는 것도 바로 알림
  GM_addValueChangeListener('text', (key, old, v, remote) => { if (remote) unsafeWindow.fcIngest?.(v.s); });
  GM_addValueChangeListener('ping', (key, old, v, remote) => { if (remote) unsafeWindow.fcPing?.(v); });
  unsafeWindow.fcPing?.({ state: 'installed', version: 7, at: Date.now() });
}
