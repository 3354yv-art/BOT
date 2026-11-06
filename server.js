// תוספיה - חנות תוספים. ללא תלויות חיצוניות (Node.js בלבד)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SECRET = process.env.SECRET || crypto.randomBytes(16).toString('hex');
const SITE = process.env.SITE_NAME || 'תוספיה';
const MAX_FILE = 100 * 1024 * 1024, MAX_ICON = 1024 * 1024;
const FILE_EXT = ['.zip', '.crx', '.xpi', '.js', '.apk', '.7z', '.rar'];
const ICON_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
const CATS = ['תוסף לדפדפן', 'סקריפט (Tampermonkey)', 'אפליקציה לאנדרואיד', 'אחר'];

fs.mkdirSync(path.join(DATA_DIR, 'files'), { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'data.json');
let db = { items: [] };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) {}
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const ipOf = req => req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;

// ---------- מנהל ----------
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const makeToken = () => { const t = Date.now() + '.a'; return t + '.' + sign(t); };
function isAdmin(req) {
  const c = (req.headers.cookie || '').split(/;\s*/).find(x => x.startsWith('adm='));
  if (!c) return false;
  const v = decodeURIComponent(c.slice(4)); const i = v.lastIndexOf('.');
  const body = v.slice(0, i), sig = v.slice(i + 1);
  return sig.length === 64 && crypto.timingSafeEqual(Buffer.from(sign(body)), Buffer.from(sig)) && Date.now() - Number(body.split('.')[0]) < 30 * 864e5;
}
const fails = {}, uploads = {};

// ---------- multipart ----------
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(new Error('too-big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function parseMultipart(buf, boundary) {
  const fields = {}, files = {};
  const sep = Buffer.from('--' + boundary);
  let pos = buf.indexOf(sep);
  while (pos !== -1) {
    const start = pos + sep.length;
    if (buf.slice(start, start + 2).toString() === '--') break;
    const next = buf.indexOf(sep, start);
    if (next === -1) break;
    const part = buf.slice(start + 2, next - 2); // בלי CRLF בתחילה ובסוף
    const he = part.indexOf('\r\n\r\n');
    if (he !== -1) {
      const head = part.slice(0, he).toString('utf8');
      const body = part.slice(he + 4);
      const name = (head.match(/name="([^"]*)"/) || [])[1];
      const fn = head.match(/filename="([^"]*)"/);
      if (name) { if (fn) { if (fn[1]) files[name] = { name: fn[1], data: body }; } else fields[name] = body.toString('utf8'); }
    }
    pos = next;
  }
  return { fields, files };
}
const readForm = async req => Object.fromEntries(new URLSearchParams((await readRaw(req, 2e5)).toString()));

// ---------- עיצוב ----------
const CSS = `
:root{--bg:#f4f6fb;--card:#fff;--ink:#1c2433;--mut:#667085;--acc:#4f46e5;--acc2:#eef0ff;--line:#e4e7ee}
*{box-sizing:border-box}body{margin:0;font-family:Segoe UI,Arial,sans-serif;background:var(--bg);color:var(--ink);line-height:1.55}
a{color:var(--acc);text-decoration:none}header{background:#fff;border-bottom:1px solid var(--line);padding:12px 20px;display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.logo{font-size:24px;font-weight:800;color:var(--acc)}header form{margin-right:auto;display:flex;gap:6px}
input,textarea,select{font:inherit;padding:9px 11px;border:1px solid var(--line);border-radius:10px;background:#fff;width:100%}
header input{width:240px}button,.btn{font:inherit;background:var(--acc);color:#fff;border:0;border-radius:10px;padding:9px 18px;cursor:pointer;display:inline-block}
.btn.sec{background:var(--acc2);color:var(--acc)}.btn.red{background:#c0392b}main{max-width:1000px;margin:24px auto;padding:0 16px}
h1{margin:0 0 14px;font-size:26px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;color:var(--ink);display:block}
.card:hover{box-shadow:0 4px 14px rgba(79,70,229,.12)}.ico{width:56px;height:56px;border-radius:14px;background:var(--acc2);color:var(--acc);display:flex;align-items:center;justify-content:center;font-size:26px;overflow:hidden;flex:none}
.ico img{width:100%;height:100%;object-fit:cover}.row{display:flex;gap:12px;align-items:center}.mut{color:var(--mut);font-size:14px}
.box{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:16px}label{display:block;margin:12px 0 4px;font-weight:600}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}.chip{padding:6px 14px;border-radius:99px;background:#fff;border:1px solid var(--line);color:var(--ink);font-size:14px}
.chip.on{background:var(--acc);color:#fff;border-color:var(--acc)}.msg{background:#e8f7ee;border:1px solid #b6e3c6;padding:10px 14px;border-radius:10px;margin-bottom:14px}.err{background:#fdecec;border-color:#f3bcbc}
table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid var(--line);text-align:right;vertical-align:top}.desc{white-space:pre-wrap}
footer{text-align:center;color:var(--mut);font-size:13px;padding:24px}
`;
function page(title, body, req, q = '') {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body>
<header><a class="logo" href="/">${esc(SITE)}</a><a href="/upload">העלאת תוסף</a>${isAdmin(req) ? '<a href="/admin">ניהול</a>' : ''}
<form action="/" method="get"><input name="q" placeholder="חיפוש תוסף" value="${esc(q)}"><button>חפש</button></form></header>
<main>${body}</main><footer>${esc(SITE)} · התוספים מועלים על ידי גולשים ועוברים אישור לפני פרסום</footer></body></html>`;
}
const iconHtml = it => `<div class="ico">${it.icon ? `<img src="/icon/${it.id}" alt="" loading="lazy">` : '🧩'}</div>`;
const approved = () => db.items.filter(i => i.status === 'approved');

function home(req, q, cat, sort) {
  let list = approved();
  if (q) list = list.filter(i => (i.name + ' ' + i.short).toLowerCase().includes(q.toLowerCase()));
  if (cat) list = list.filter(i => i.cat === cat);
  list.sort((a, b) => sort === 'pop' ? b.downloads - a.downloads : b.added - a.added);
  const qs = (c, s) => '/?' + new URLSearchParams({ ...(q ? { q } : {}), ...(c ? { cat: c } : {}), ...(s ? { sort: s } : {}) });
  const chips = `<div class="chips"><a class="chip ${!cat ? 'on' : ''}" href="${esc(qs('', sort))}">הכל</a>` + CATS.map(c => `<a class="chip ${cat === c ? 'on' : ''}" href="${esc(qs(c, sort))}">${esc(c)}</a>`).join('') +
    `<a class="chip ${sort === 'pop' ? 'on' : ''}" href="${esc(qs(cat, sort === 'pop' ? '' : 'pop'))}">הכי מורדים</a></div>`;
  const cards = list.map(i => `<a class="card" href="/ext/${i.id}"><div class="row">${iconHtml(i)}<div><b>${esc(i.name)}</b><div class="mut">${esc(i.cat)} · v${esc(i.version)}</div></div></div>
<p class="mut" style="margin:10px 0 0">${esc(i.short)}</p><div class="mut" style="margin-top:8px">${i.downloads} הורדות · ${fmtSize(i.size)}</div></a>`).join('');
  const body = `<h1>${q ? 'תוצאות חיפוש' : 'כל התוספים'}</h1>${chips}` + (list.length ? `<div class="grid">${cards}</div>` : `<div class="box">אין עדיין תוספים כאן. <a href="/upload">אפשר להעלות את הראשון</a>.</div>`);
  return page(SITE, body, req, q);
}
function extPage(req, it) {
  const body = `<div class="box"><div class="row">${iconHtml(it)}<div><h1 style="margin:0">${esc(it.name)}</h1><div class="mut">${esc(it.cat)} · גרסה ${esc(it.version)} · ${fmtSize(it.size)} · ${it.downloads} הורדות</div></div></div>
<p><b>${esc(it.short)}</b></p><div class="desc">${esc(it.long)}</div>
<p style="margin-top:16px"><a class="btn" href="/dl/${it.id}">הורדה</a></p></div>
<div class="box mut">הקובץ הועלה על ידי גולש ונבדק רק לפי הצורה. מומלץ לסרוק כל קובץ לפני התקנה. נתקלת בבעיה? <a href="/report/${it.id}">דיווח על תוסף</a></div>
${isAdmin(req) ? `<form method="post" action="/admin/delete" onsubmit="return confirm('למחוק?')"><input type="hidden" name="id" value="${it.id}"><button class="btn red">מחיקה</button></form>` : ''}`;
  return page(it.name + ' - ' + SITE, body, req);
}
function uploadPage(req, msg = '', err = false, v = {}) {
  const body = `<h1>העלאת תוסף</h1>${msg ? `<div class="msg ${err ? 'err' : ''}">${msg}</div>` : ''}
<form class="box" method="post" action="/upload" enctype="multipart/form-data">
<label>שם התוסף</label><input name="name" required maxlength="80" value="${esc(v.name)}">
<label>תיאור קצר (עד 140 תווים)</label><input name="short" required maxlength="140" value="${esc(v.short)}">
<label>תיאור מלא (מה הוא עושה, איך מתקינים)</label><textarea name="long" rows="6" maxlength="4000">${esc(v.long)}</textarea>
<label>גרסה</label><input name="version" required maxlength="20" placeholder="1.0.0" value="${esc(v.version)}">
<label>קטגוריה</label><select name="cat">${CATS.map(c => `<option ${v.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
<label>קובץ התוסף (${FILE_EXT.join(' ')} עד 100MB)</label><input type="file" name="file" required>
<label>אייקון (לא חובה, png או jpg עד 1MB)</label><input type="file" name="icon" accept="image/*">
<label style="font-weight:400;margin-top:16px"><input type="checkbox" name="own" value="1" required style="width:auto"> אני מאשר שהתוסף שלי, או שיש לי רשות להפיץ אותו, ושהוא לא מכיל תוכנה זדונית.</label>
<input name="website" style="display:none" tabindex="-1" autocomplete="off">
<div style="margin-top:14px"><button>שליחה</button></div></form>
<div class="mut">התוסף יופיע בחנות רק לאחר אישור המנהל.</div>`;
  return page('העלאת תוסף', body, req);
}
function adminPage(req) {
  const row = (i, pend) => `<tr><td><b>${esc(i.name)}</b> v${esc(i.version)}<br><span class="mut">${esc(i.cat)} · ${esc(i.short)}</span>${i.reports ? `<br><span class="mut" style="color:#c0392b">דיווחים: ${i.reports}</span>` : ''}</td>
<td class="mut">${esc(i.fileName)}<br>${fmtSize(i.size)}</td><td><a href="/dl/${i.id}?admin=1">הורדה לבדיקה</a></td><td>
${pend ? `<form method="post" action="/admin/approve" style="display:inline"><input type="hidden" name="id" value="${i.id}"><button>אישור</button></form> ` : ''}
<form method="post" action="/admin/delete" style="display:inline"><input type="hidden" name="id" value="${i.id}"><button class="btn red">${pend ? 'דחייה' : 'מחיקה'}</button></form></td></tr>`;
  const pend = db.items.filter(i => i.status === 'pending'), ok = approved();
  const body = `<h1>ניהול</h1><div class="box"><b>ממתינים לאישור (${pend.length})</b>${pend.length ? `<table>${pend.map(i => row(i, 1)).join('')}</table>` : '<div class="mut">אין כרגע.</div>'}</div>
<div class="box"><b>מפורסמים (${ok.length})</b>${ok.length ? `<table>${ok.map(i => row(i, 0)).join('')}</table>` : '<div class="mut">אין עדיין.</div>'}</div><p><a href="/logout">יציאה</a></p>`;
  return page('ניהול', body, req);
}
const loginPage = (req, err) => page('כניסה', `<h1>כניסת מנהל</h1>${err ? '<div class="msg err">שם משתמש או סיסמה שגויים.</div>' : ''}<form class="box" method="post" action="/login" style="max-width:380px"><label>שם משתמש</label><input name="u" required><label>סיסמה</label><input name="p" type="password" required><div style="margin-top:14px"><button>כניסה</button></div></form>`, req);

// ---------- שרת ----------
const send = (res, code, html, h = {}) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', ...h }); res.end(html); };
const redirect = (res, to, h = {}) => { res.writeHead(302, { Location: to, ...h }); res.end(); };
const notFound = (req, res) => send(res, 404, page('לא נמצא', '<h1>לא נמצא</h1>', req));
const fileOf = id => path.join(DATA_DIR, 'files', id);

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x'); const p = url.pathname; const post = req.method === 'POST'; let m;
    if (p === '/') return send(res, 200, home(req, (url.searchParams.get('q') || '').trim(), url.searchParams.get('cat') || '', url.searchParams.get('sort') || ''));
    if ((m = p.match(/^\/ext\/(\w+)$/))) { const it = db.items.find(x => x.id === m[1]); return it && (it.status === 'approved' || isAdmin(req)) ? send(res, 200, extPage(req, it)) : notFound(req, res); }
    if ((m = p.match(/^\/icon\/(\w+)$/))) {
      const it = db.items.find(x => x.id === m[1]); if (!it || !it.icon || (it.status !== 'approved' && !isAdmin(req))) return notFound(req, res);
      res.writeHead(200, { 'Content-Type': it.iconType, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' }); return fs.createReadStream(fileOf(it.id + '.icon')).pipe(res);
    }
    if ((m = p.match(/^\/dl\/(\w+)$/))) {
      const it = db.items.find(x => x.id === m[1]); if (!it || (it.status !== 'approved' && !isAdmin(req))) return notFound(req, res);
      if (it.status === 'approved' && !url.searchParams.get('admin')) { it.downloads++; save(); }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': it.size, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(it.fileName)}`, 'X-Content-Type-Options': 'nosniff' });
      return fs.createReadStream(fileOf(it.id)).pipe(res);
    }
    if ((m = p.match(/^\/report\/(\w+)$/))) {
      const it = db.items.find(x => x.id === m[1]); if (!it) return notFound(req, res);
      if (post) { it.reports = (it.reports || 0) + 1; save(); return send(res, 200, page('תודה', '<h1>תודה</h1><div class="box">הדיווח התקבל ויבדק.</div>', req)); }
      return send(res, 200, page('דיווח', `<h1>דיווח על "${esc(it.name)}"</h1><form class="box" method="post"><p>לדווח על התוסף למנהל האתר?</p><button class="btn red">שליחת דיווח</button></form>`, req));
    }
    if (p === '/upload' && !post) return send(res, 200, uploadPage(req));
    if (p === '/upload' && post) {
      const ip = ipOf(req); uploads[ip] = (uploads[ip] || []).filter(t => Date.now() - t < 36e5);
      const ct = req.headers['content-type'] || ''; const bm = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/);
      if (!bm) return send(res, 400, uploadPage(req, 'בקשה לא תקינה.', true));
      if (uploads[ip].length >= 5) return send(res, 429, uploadPage(req, 'נשלחו יותר מדי תוספים מהכתובת הזאת. נסו שוב מאוחר יותר.', true));
      let parsed;
      try { parsed = parseMultipart(await readRaw(req, MAX_FILE + MAX_ICON + 4e5), bm[1] || bm[2]); }
      catch (e) { return send(res, 413, uploadPage(req, 'הקובץ גדול מדי (עד 100MB).', true)); }
      const f = parsed.fields, file = parsed.files.file, icon = parsed.files.icon;
      if (f.website) return send(res, 200, uploadPage(req, 'תודה! התוסף התקבל.')); // בוט
      const ext = file ? path.extname(file.name).toLowerCase() : '';
      const bad = !f.name?.trim() || !f.short?.trim() || !f.version?.trim() || !f.own ? 'חסרים פרטים או שלא אישרת את התנאים.' :
        !file ? 'לא נבחר קובץ.' : !FILE_EXT.includes(ext) ? 'סוג קובץ לא נתמך. מותר: ' + FILE_EXT.join(' ') : file.data.length > MAX_FILE ? 'הקובץ גדול מדי.' : file.data.length < 1 ? 'הקובץ ריק.' : '';
      if (bad) return send(res, 400, uploadPage(req, bad, true, f));
      const id = crypto.randomBytes(6).toString('hex');
      fs.writeFileSync(fileOf(id), file.data);
      let hasIcon = false, iconType = '';
      if (icon && icon.data.length <= MAX_ICON && ICON_EXT.includes(path.extname(icon.name).toLowerCase())) {
        const e = path.extname(icon.name).toLowerCase(); iconType = e === '.png' ? 'image/png' : e === '.webp' ? 'image/webp' : 'image/jpeg';
        fs.writeFileSync(fileOf(id + '.icon'), icon.data); hasIcon = true;
      }
      db.items.push({ id, name: f.name.trim().slice(0, 80), short: f.short.trim().slice(0, 140), long: (f.long || '').trim().slice(0, 4000), version: f.version.trim().slice(0, 20),
        cat: CATS.includes(f.cat) ? f.cat : CATS[3], fileName: path.basename(file.name).slice(0, 120), size: file.data.length, icon: hasIcon, iconType, downloads: 0, reports: 0, status: isAdmin(req) ? 'approved' : 'pending', added: Date.now() });
      save(); uploads[ip].push(Date.now());
      return send(res, 200, uploadPage(req, isAdmin(req) ? 'התוסף פורסם.' : 'תודה! התוסף התקבל ויפורסם לאחר אישור.'));
    }
    if (p === '/login' && !post) return send(res, 200, loginPage(req));
    if (p === '/login' && post) {
      const ip = ipOf(req); const f = await readForm(req); const fl = fails[ip] || { n: 0, t: 0 };
      if (fl.n >= 5 && Date.now() - fl.t < 9e5) return send(res, 429, loginPage(req, true));
      if (f.u === ADMIN_USER && f.p === ADMIN_PASS) { delete fails[ip]; return redirect(res, '/admin', { 'Set-Cookie': 'adm=' + encodeURIComponent(makeToken()) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000' }); }
      fails[ip] = { n: fl.n + 1, t: Date.now() }; return send(res, 401, loginPage(req, true));
    }
    if (p === '/logout') return redirect(res, '/', { 'Set-Cookie': 'adm=; Path=/; Max-Age=0' });
    if (p.startsWith('/admin')) {
      if (!isAdmin(req)) return redirect(res, '/login');
      if (p === '/admin' && !post) return send(res, 200, adminPage(req));
      if (post) {
        const f = await readForm(req); const it = db.items.find(x => x.id === f.id);
        if (it && p === '/admin/approve') it.status = 'approved';
        if (it && p === '/admin/delete') { db.items = db.items.filter(x => x !== it); for (const s of ['', '.icon']) try { fs.unlinkSync(fileOf(it.id + s)); } catch (e) {} }
        save(); return redirect(res, '/admin');
      }
    }
    notFound(req, res);
  } catch (e) { console.error(e); try { send(res, 500, 'שגיאה'); } catch (_) {} }
}).listen(PORT, HOST, () => console.log(SITE + ' פועל על ' + HOST + ':' + PORT));
