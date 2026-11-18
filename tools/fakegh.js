// 시험용 가짜 GitHub (git data API, contents, raw 를 메모리에서 흉내): 발행, 지우기, 총석 발행을 실제 GitHub 없이 시험. 요청은 밖으로 나가지 않음
// (11/18 버그 검토에서 만든 것: 오래 열어 둔 탭의 덮어쓰기, 총석 합치기, 지운 뒤 비교 기준 등)
const crypto = require('crypto'), path = require('path'), { pathToFileURL } = require('url');
const URL0 = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
function makeStore() {
  const s = { blobs: {}, trees: {}, commits: {}, ref: null, log: [] };
  s.putBlob = buf => { const sha = crypto.createHash('sha1').update(buf).digest('hex'); s.blobs[sha] = buf; return sha; };
  s.files = () => s.ref ? s.trees[s.commits[s.ref].tree] : {};
  s.get = p => { const f = s.files()[p]; return f ? s.blobs[f] : null; };
  s.json = p => { const b = s.get(p); return b ? JSON.parse(b.toString()) : null; };
  s.set = (obj) => { // obj: {path: string|object|Buffer} -> new commit replacing branch
    const t = { ...s.files() };
    for (const [p, v] of Object.entries(obj)) { if (v === null) delete t[p]; else t[p] = s.putBlob(Buffer.isBuffer(v) ? v : Buffer.from(typeof v === 'string' ? v : JSON.stringify(v))); }
    const ts = crypto.randomBytes(20).toString('hex'); s.trees[ts] = t; const cs = crypto.randomBytes(20).toString('hex'); s.commits[cs] = { tree: ts }; s.ref = cs;
  };
  return s;
}
async function route(ctx, s, { delay = 0 } = {}) {
  await ctx.route(/githubusercontent|github\.com/, async r => {
    const req = r.request(), u = new URL(req.url()), m = req.method();
    s.log.push(m + ' ' + u.pathname);
    if (delay) await new Promise(ok => setTimeout(ok, delay));
    const json = (o, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.host === 'raw.githubusercontent.com') {
      const p = decodeURIComponent(u.pathname.replace('/goormigrm/fc-anyang-seats/data/', ''));
      const b = (s.rawOverride && p in s.rawOverride) ? s.rawOverride[p] : s.get(p);
      return b ? r.fulfill({ status: 200, body: b }) : r.fulfill({ status: 404, body: '404: Not Found' });
    }
    if (u.host !== 'api.github.com') return r.fulfill({ status: 599, body: '' });
    const P = u.pathname.replace('/repos/goormigrm/fc-anyang-seats/', '');
    if (s.apiDown) return r.fulfill({ status: 403, body: '' });
    if (P.startsWith('contents/')) { const b = s.get(decodeURIComponent(P.slice(9))); return b ? r.fulfill({ status: 200, body: b }) : r.fulfill({ status: 404, body: '{}' }); }
    if (P === 'git/ref/heads/data') return s.ref ? json({ object: { sha: s.ref } }) : json({ message: 'Not Found' }, 404);
    if (P.startsWith('git/trees/') && m === 'GET') { const sha = P.slice(10); const t = s.trees[s.commits[sha]?.tree] || s.trees[sha]; return t ? json({ tree: Object.entries(t).map(([path, sha]) => ({ path, sha, type: 'blob', mode: '100644' })) }) : json({}, 404); }
    if (P === 'git/trees' && m === 'POST') { const body = JSON.parse(req.postData()); const t = {}; for (const e of body.tree) { if (t[e.path]) return json({ message: 'dup ' + e.path }, 422); t[e.path] = e.sha || s.putBlob(Buffer.from(e.content)); } const ts = crypto.randomBytes(20).toString('hex'); s.trees[ts] = t; return json({ sha: ts }); }
    if (P === 'git/commits' && m === 'POST') { const body = JSON.parse(req.postData()); const cs = crypto.randomBytes(20).toString('hex'); s.commits[cs] = { tree: body.tree, message: body.message }; return json({ sha: cs }); }
    if (P === 'git/refs/heads/data' && m === 'PATCH') { s.ref = JSON.parse(req.postData()).sha; return json({}); }
    if (P === 'git/refs/heads/data' && m === 'DELETE') { s.ref = null; return r.fulfill({ status: 204, body: '' }); }
    if (P === 'git/refs' && m === 'POST') { s.ref = JSON.parse(req.postData()).sha; return json({}); }
    if (P === 'git/blobs' && m === 'POST') { const body = JSON.parse(req.postData()); return json({ sha: s.putBlob(Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8')) }); }
    if (P.startsWith('git/blobs/') && m === 'GET') { const b = s.blobs[P.slice(10)]; return b ? json({ content: b.toString('base64') }) : json({}, 404); }
    return json({ message: 'unmocked ' + m + ' ' + P }, 500);
  });
  await ctx.route(/cdn\.jsdelivr|tesseract/, r => r.abort());
}
async function open(browser, s, url, { ls = {}, delay, dialog } = {}) {
  const ctx = await browser.newContext({ timezoneId: 'Asia/Seoul', viewport: { width: 1280, height: 900 } });
  await route(ctx, s, { delay });
  await ctx.addInitScript(o => { if (!sessionStorage.getItem('__init')) { sessionStorage.setItem('__init', 1); for (const [k, v] of Object.entries(o)) localStorage.setItem(k, v); } }, { 'fc-anyang-gh-token': 'fake', ...ls });
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
  page.dialogs = []; page.on('dialog', d => { page.dialogs.push(d.message()); return dialog ? dialog(d) : d.accept(); });
  await page.goto(URL0 + url);
  return page;
}
module.exports = { makeStore, route, open, URL0 };
