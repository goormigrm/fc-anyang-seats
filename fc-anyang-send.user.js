// ==UserScript==
// @name         FC안양 예매현황 보내기
// @namespace    https://goormigrm.github.io/fc-anyang-seats/
// @version      3
// @description  티켓링크 좌석 선택 화면에 보이는 잔여석 글자를 열려 있는 현황판 탭으로 보냄. 읽기만 하고 클릭, 새로고침, 요청은 하지 않음
// @match        https://www.ticketlink.co.kr/*
// @match        https://m.ticketlink.co.kr/*
// @match        https://goormigrm.github.io/fc-anyang-seats/*
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// ==/UserScript==
if (location.hostname.endsWith('ticketlink.co.kr')) {
  // 사람이 등급을 누를 때마다 좌석 줄이 바뀌면 0.8초 뒤 한 번 보냄. 안양종합운동장 경기의 좌석 선택 화면('등급 선택', "N석")에서만
  // 보내는 글자는 경기 정보와 등급, 구역, 숫자 줄만 (로그인 이름 같은 다른 글자, 초 단위로 바뀌는 표시는 빼고)
  const pick = () => document.body.innerText.split('\n').map(l => l.trim()).filter(l => /석|구역|안양|등급|\d{4}\.\d{2}\.\d{2}|^\d+$/.test(l)).join('\n');
  let last = '', timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const s = pick();
      if (s !== last && /안양종합운동장/.test(s) && /등급\s*선택/.test(s) && /\d\s*석/.test(s)) { last = s; GM_setValue('text', { s, at: Date.now() }); }
    }, 800);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
} else {
  GM_addValueChangeListener('text', (key, old, v, remote) => { if (remote) unsafeWindow.fcIngest?.(v.s); });
}
