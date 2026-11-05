// ==UserScript==
// @name         FC안양 예매현황 보내기
// @namespace    https://goormigrm.github.io/fc-anyang-seats/
// @version      2
// @description  티켓링크 좌석 선택 화면에 보이는 잔여석 글자를 열려 있는 현황판 탭으로 보냄. 읽기만 하고 클릭, 새로고침, 요청은 하지 않음
// @match        https://www.ticketlink.co.kr/*
// @match        https://m.ticketlink.co.kr/*
// @match        https://goormigrm.github.io/fc-anyang-seats/*
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// ==/UserScript==
if (location.hostname.endsWith('ticketlink.co.kr')) {
  // 사람이 등급을 누를 때마다 화면 글자가 바뀌면 0.8초 뒤 한 번 보냄. 좌석 선택 화면('등급 선택'과 "N석"이 보이는 FC안양 경기)에서만
  let last = '', timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const s = document.body.innerText;
      if (s !== last && /안양/.test(s) && /등급\s*선택/.test(s) && /\d\s*석/.test(s)) { last = s; GM_setValue('text', { s, at: Date.now() }); }
    }, 800);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
} else {
  GM_addValueChangeListener('text', (key, old, v, remote) => { if (remote) unsafeWindow.fcIngest?.(v.s); });
}
