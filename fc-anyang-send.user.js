// ==UserScript==
// @name         FC안양 예매현황 보내기
// @namespace    https://goormigrm.github.io/fc-anyang-seats/
// @version      5
// @description  티켓링크 좌석 선택 화면에 보이는 잔여석 글자를 열려 있는 현황판 탭으로 보냄. 읽기만 하고 클릭, 새로고침, 요청은 하지 않음
// @match        https://www.ticketlink.co.kr/*
// @match        https://m.ticketlink.co.kr/*
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
  // 화면 오른쪽 아래 작은 표시: 스크립트가 도는지, 보냈는지 (그림자 DOM 이라 화면 글자에 섞이지 않음)
  let badge;
  const show = msg => {
    if (!badge) {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483647';
      badge = host.attachShadow({ mode: 'closed' }).appendChild(document.createElement('div'));
      badge.style.cssText = 'font:12px sans-serif;background:#3e1a78;color:#fff;padding:4px 8px;border-radius:6px;opacity:.85';
      document.documentElement.appendChild(host);
    }
    badge.textContent = '현황판 보내기: ' + msg;
  };
  let last = '', timer;
  const check = () => {
    const s = pick();
    if (!/안양/.test(s) || !/등급\s*선택/.test(s) || !/\d\s*석/.test(s)) return show('대기 (FC안양 경기 등급/좌석 선택 화면이 아님)');
    if (s === last) return;
    last = s;
    GM_setValue('text', { s, at: Date.now() });
    show('보냄 ' + new Date().toTimeString().slice(0, 8) + ' (구역 ' + (s.match(/구\s*역/g) || []).length + '줄)');
  };
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(check, 800); }).observe(document.body, { childList: true, subtree: true, characterData: true });
  setTimeout(check, 1500);
} else {
  GM_addValueChangeListener('text', (key, old, v, remote) => { if (remote) unsafeWindow.fcIngest?.(v.s); });
}
