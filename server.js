// אתר אלבומים של זמרים - ללא תלויות חיצוניות (Node.js בלבד)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const SECRET = process.env.SECRET || crypto.randomBytes(16).toString('hex');

// ---------- אחסון ----------
let db = { albums: [] };
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {}
const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 1));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- יוטיוב ----------
function parseYouTube(text) {
  const out = { playlist: null, videos: [] };
  for (const line of String(text || '').split(/\s+/).filter(Boolean)) {
    let m;
    if ((m = line.match(/[?&]list=([A-Za-z0-9_-]{10,})/)) && !/[?&]v=/.test(line) && !out.playlist) { out.playlist = m[1]; continue; }
    if ((m = line.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/))) { if (!out.videos.find(v => v.id === m[1])) out.videos.push({ id: m[1], title: '' }); }
    else if ((m = line.match(/[?&]list=([A-Za-z0-9_-]{10,})/)) && !out.playlist) out.playlist = m[1];
  }
  return out;
}
async function fetchTitle(id) {
  try {
    const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id), { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return '';
    return (await r.json()).title || '';
  } catch (e) { return ''; }
}

// ---------- התחברות מנהל ----------
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const makeToken = () => { const t = Date.now() + '.' + ADMIN_USER; return t + '.' + sign(t); };
function isAdmin(req) {
  const c = (req.headers.cookie || '').split(/;\s*/).find(x => x.startsWith('adm='));
  if (!c) return false;
  const v = decodeURIComponent(c.slice(4)); const i = v.lastIndexOf('.');
  const body = v.slice(0, i), sig = v.slice(i + 1);
  return sign(body) === sig && Date.now() - Number(body.split('.')[0]) < 30 * 864e5;
}
const fails = {};

// ---------- עיצוב ----------
const CSS = `
:root{--bg:#f6f3ee;--card:#fff;--ink:#1d2a3a;--mut:#6b7686;--acc:#1f5f8b;--acc2:#e8f1f8;--line:#e3ddd2}
*{box-sizing:border-box}body{margin:0;font-family:Segoe UI,Arial,sans-serif;background:var(--bg);color:var(--ink);line-height:1.5}
a{color:var(--acc);text-decoration:none}header{background:var(--ink);color:#fff;padding:14px 20px;display:flex;align-items:center;gap:18px;flex-wrap:wrap}
header a{color:#fff}header .logo{font-size:22px;font-weight:700}header form{margin-right:auto;display:flex;gap:6px}
input,textarea,select{font:inherit;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:#fff;width:100%}
header input{width:230px}button,.btn{font:inherit;background:var(--acc);color:#fff;border:0;border-radius:8px;padding:9px 16px;cursor:pointer;display:inline-block}
.btn.sec{background:var(--acc2);color:var(--acc)}.btn.red{background:#b3372f}main{max-width:1000px;margin:24px auto;padding:0 16px}
h1{margin:0 0 14px;font-size:26px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;display:block;color:var(--ink)}
.cover{aspect-ratio:1;border-radius:8px;background:linear-gradient(135deg,#1f5f8b,#16384f);display:flex;align-items:center;justify-content:center;color:#fff;font-size:42px;overflow:hidden;margin-bottom:8px}
.cover img{width:100%;height:100%;object-fit:cover}.mut{color:var(--mut);font-size:14px}.box{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px}
label{display:block;margin:12px 0 4px;font-weight:600}.tracks{list-style:none;padding:0;margin:0}.tracks li{padding:9px 12px;border-bottom:1px solid var(--line);cursor:pointer;display:flex;gap:10px}
.tracks li:hover{background:var(--acc2)}.tracks li.on{background:var(--acc2);font-weight:700}.player{aspect-ratio:16/9;width:100%;border-radius:12px;overflow:hidden;background:#000}
.msg{background:#e6f4ea;border:1px solid #b7dfc1;padding:10px 14px;border-radius:8px;margin-bottom:14px}.err{background:#fdeaea;border-color:#f0b9b9}
table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid var(--line);text-align:right;vertical-align:top}
`;
function page(title, body, req, extra = '') {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body>
<header><a class="logo" href="/">אלבומים</a><a href="/add">הוספת אלבום</a>${isAdmin(req) ? '<a href="/admin">ניהול</a>' : ''}
<form action="/" method="get"><input name="q" placeholder="חיפוש זמר או אלבום" value="${esc(req._q || '')}"><button>חפש</button></form></header>
<main>${body}</main>${extra}</body></html>`;
}
const coverHtml = a => `<div class="cover">${a.cover ? `<img src="${esc(a.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '♪'}</div>`;
const approved = () => db.albums.filter(a => a.status === 'approved');

// ---------- עמודים ----------
function home(req, q) {
  req._q = q;
  let list = approved();
  if (q) list = list.filter(a => (a.singer + ' ' + a.title).toLowerCase().includes(q.toLowerCase()));
  const singers = {};
  for (const a of list) (singers[a.singer] ||= []).push(a);
  const names = Object.keys(singers).sort((x, y) => x.localeCompare(y, 'he'));
  let body = `<h1>${q ? 'תוצאות חיפוש' : 'זמרים'}</h1>`;
  if (!names.length) body += `<div class="box">${q ? 'לא נמצאו תוצאות.' : 'עדיין אין אלבומים באתר. אפשר להיות הראשונים: <a href="/add">הוספת אלבום</a>.'}</div>`;
  body += `<div class="grid">` + names.map(n => {
    const first = singers[n].find(a => a.cover) || singers[n][0];
    return `<a class="card" href="/singer/${encodeURIComponent(n)}">${coverHtml(first)}<b>${esc(n)}</b><div class="mut">${singers[n].length} אלבומים</div></a>`;
  }).join('') + `</div>`;
  return page('אלבומים', body, req);
}
function singerPage(req, name) {
  const list = approved().filter(a => a.singer === name).sort((a, b) => (b.year || 0) - (a.year || 0));
  if (!list.length) return null;
  let body = `<h1>${esc(name)}</h1><div class="grid">` + list.map(a =>
    `<a class="card" href="/album/${a.id}">${coverHtml(a)}<b>${esc(a.title)}</b><div class="mut">${a.year ? esc(a.year) + ' · ' : ''}${a.videos.length ? a.videos.length + ' שירים' : 'רשימת השמעה'}</div></a>`).join('') + `</div>`;
  return page(name, body, req);
}
function albumPage(req, a) {
  const tracks = a.videos.map((v, i) => `<li data-i="${i}"><span class="mut">${i + 1}</span><span>${esc(v.title || 'שיר ' + (i + 1))}</span></li>`).join('');
  const body = `<h1>${esc(a.title)}</h1><div class="mut" style="margin:-8px 0 14px"><a href="/singer/${encodeURIComponent(a.singer)}">${esc(a.singer)}</a>${a.year ? ' · ' + esc(a.year) : ''}</div>
<div class="player"><div id="yt"></div></div>
${tracks ? `<div class="box" style="margin-top:14px;padding:0"><ul class="tracks" id="tracks">${tracks}</ul></div>` : ''}
${isAdmin(req) ? `<form method="post" action="/admin/delete" onsubmit="return confirm('למחוק את האלבום?')"><input type="hidden" name="id" value="${a.id}"><button class="btn red">מחיקת אלבום</button></form>` : ''}`;
  const cfg = JSON.stringify({ playlist: a.playlist || null, ids: a.videos.map(v => v.id) });
  const script = `<script>
const CFG=${cfg};let player;const lis=[...document.querySelectorAll('#tracks li')];
function mark(i){lis.forEach((l,k)=>l.classList.toggle('on',k===i))}
function onYouTubeIframeAPIReady(){
 const o={width:'100%',height:'100%',playerVars:{rel:0,playsinline:1},events:{onStateChange:e=>{if(CFG.ids.length&&e.data===1)mark(player.getPlaylistIndex())}}};
 if(CFG.ids.length){o.videoId=CFG.ids[0];o.playerVars.playlist=CFG.ids.slice(1).join(',')}
 else if(CFG.playlist){o.playerVars.listType='playlist';o.playerVars.list=CFG.playlist}
 player=new YT.Player('yt',o);}
lis.forEach((l,i)=>l.onclick=()=>{player.playVideoAt(i);mark(i)});
</script><script src="https://www.youtube.com/iframe_api"></script>`;
  return page(a.title + ' - ' + a.singer, body, req, script);
}
function addPage(req, msg = '', err = false, v = {}) {
  const body = `<h1>הוספת אלבום</h1>${msg ? `<div class="msg ${err ? 'err' : ''}">${msg}</div>` : ''}
<form class="box" method="post" action="/add">
<label>שם הזמר</label><input name="singer" required value="${esc(v.singer)}">
<label>שם האלבום</label><input name="title" required value="${esc(v.title)}">
<label>שנה (לא חובה)</label><input name="year" inputmode="numeric" value="${esc(v.year)}">
<label>קישור לתמונת עטיפה (לא חובה)</label><input name="cover" placeholder="https://..." value="${esc(v.cover)}">
<label>קישורים מיוטיוב</label><textarea name="links" rows="8" required placeholder="קישור לרשימת השמעה שלמה, או קישור לכל שיר בשורה נפרדת">${esc(v.links)}</textarea>
<div class="mut" style="margin-top:6px">האלבום יופיע באתר לאחר אישור המנהל. השירים מתנגנים דרך הנגן הרשמי של יוטיוב.</div>
<div style="margin-top:14px"><button>שליחה</button></div></form>`;
  return page('הוספת אלבום', body, req);
}
function adminPage(req) {
  const pend = db.albums.filter(a => a.status === 'pending');
  const rows = pend.map(a => `<tr><td><b>${esc(a.title)}</b><br><span class="mut">${esc(a.singer)}</span></td>
<td class="mut">${a.videos.length} שירים${a.playlist ? ' + רשימה' : ''}<br><a href="/album/${a.id}">צפייה</a></td>
<td><form method="post" action="/admin/approve" style="display:inline"><input type="hidden" name="id" value="${a.id}"><button>אישור</button></form>
<form method="post" action="/admin/delete" style="display:inline"><input type="hidden" name="id" value="${a.id}"><button class="btn red">דחייה</button></form></td></tr>`).join('');
  const body = `<h1>ניהול</h1><div class="box"><b>ממתינים לאישור (${pend.length})</b>${pend.length ? `<table>${rows}</table>` : '<div class="mut">אין כרגע.</div>'}</div>
<div class="box">סה"כ אלבומים מאושרים: ${approved().length} · <a href="/logout">יציאה</a></div>`;
  return page('ניהול', body, req);
}
function loginPage(req, err) {
  return page('כניסה', `<h1>כניסת מנהל</h1>${err ? '<div class="msg err">שם משתמש או סיסמה שגויים.</div>' : ''}
<form class="box" method="post" action="/login" style="max-width:380px"><label>שם משתמש</label><input name="u" required><label>סיסמה</label><input name="p" type="password" required>
<div style="margin-top:14px"><button>כניסה</button></div></form>`, req);
}

// ---------- שרת ----------
const readBody = req => new Promise(r => { let b = ''; req.on('data', c => { b += c; if (b.length > 2e5) req.destroy(); }); req.on('end', () => r(Object.fromEntries(new URLSearchParams(b)))); });
const send = (res, code, html, headers = {}) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', ...headers }); res.end(html); };
const redirect = (res, to, headers = {}) => { res.writeHead(302, { Location: to, ...headers }); res.end(); };
const rate = {};

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x'); const p = decodeURIComponent(url.pathname); const post = req.method === 'POST';
    if (p === '/' ) return send(res, 200, home(req, (url.searchParams.get('q') || '').trim()));
    let m;
    if ((m = p.match(/^\/singer\/(.+)$/))) { const h = singerPage(req, m[1]); return h ? send(res, 200, h) : send(res, 404, page('לא נמצא', '<h1>לא נמצא</h1>', req)); }
    if ((m = p.match(/^\/album\/(\w+)$/))) {
      const a = db.albums.find(x => x.id === m[1]);
      if (!a || (a.status !== 'approved' && !isAdmin(req))) return send(res, 404, page('לא נמצא', '<h1>לא נמצא</h1>', req));
      return send(res, 200, albumPage(req, a));
    }
    if (p === '/add' && !post) return send(res, 200, addPage(req));
    if (p === '/add' && post) {
      const ip = req.socket.remoteAddress; rate[ip] = (rate[ip] || []).filter(t => Date.now() - t < 36e5);
      const f = await readBody(req);
      if (rate[ip].length >= 10) return send(res, 429, addPage(req, 'נשלחו יותר מדי אלבומים. נסו שוב מאוחר יותר.', true, f));
      const yt = parseYouTube(f.links);
      if (!f.singer?.trim() || !f.title?.trim() || (!yt.playlist && !yt.videos.length)) return send(res, 400, addPage(req, 'חסר שם זמר, שם אלבום או קישור תקין מיוטיוב.', true, f));
      if (yt.videos.length > 80) yt.videos.length = 80;
      await Promise.all(yt.videos.map(async v => v.title = await fetchTitle(v.id)));
      const cover = /^https?:\/\//.test(f.cover || '') ? f.cover.trim() : '';
      db.albums.push({ id: crypto.randomBytes(5).toString('hex'), singer: f.singer.trim().slice(0, 80), title: f.title.trim().slice(0, 120), year: /^\d{4}$/.test(f.year || '') ? Number(f.year) : 0, cover, playlist: yt.videos.length ? null : yt.playlist, videos: yt.videos, status: isAdmin(req) ? 'approved' : 'pending', added: Date.now() });
      save(); rate[ip].push(Date.now());
      return send(res, 200, addPage(req, isAdmin(req) ? 'האלבום נוסף ופורסם.' : 'תודה! האלבום התקבל ויפורסם לאחר אישור.'));
    }
    if (p === '/login' && !post) return send(res, 200, loginPage(req));
    if (p === '/login' && post) {
      const ip = req.socket.remoteAddress; const f = await readBody(req); const fl = fails[ip] || { n: 0, t: 0 };
      if (fl.n >= 5 && Date.now() - fl.t < 9e5) return send(res, 429, loginPage(req, true));
      if (f.u === ADMIN_USER && f.p === ADMIN_PASS) { delete fails[ip]; return redirect(res, '/admin', { 'Set-Cookie': 'adm=' + encodeURIComponent(makeToken()) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000' }); }
      fails[ip] = { n: fl.n + 1, t: Date.now() }; return send(res, 401, loginPage(req, true));
    }
    if (p === '/logout') return redirect(res, '/', { 'Set-Cookie': 'adm=; Path=/; Max-Age=0' });
    if (p.startsWith('/admin')) {
      if (!isAdmin(req)) return redirect(res, '/login');
      if (p === '/admin' && !post) return send(res, 200, adminPage(req));
      if (post) {
        const f = await readBody(req); const a = db.albums.find(x => x.id === f.id);
        if (a && p === '/admin/approve') a.status = 'approved';
        if (a && p === '/admin/delete') db.albums = db.albums.filter(x => x !== a);
        save(); return redirect(res, '/admin');
      }
    }
    send(res, 404, page('לא נמצא', '<h1>לא נמצא</h1>', req));
  } catch (e) { console.error(e); send(res, 500, 'שגיאה'); }
}).listen(PORT, () => console.log('פועל על פורט ' + PORT));
