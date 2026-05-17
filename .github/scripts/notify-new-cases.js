// notify-new-cases.js
// Polls Firebase Realtime DB for cases that haven't been notified yet, sends
// an email per case to Gabi+Moran via Gmail SMTP, and marks the case in
// Firebase so it isn't notified twice.
//
// Triggered by .github/workflows/notify-new-cases.yml every 5 minutes.
//
// Env vars (set in workflow):
//   MAIL_USERNAME, MAIL_PASSWORD, FIREBASE_URL, RECIPIENTS

const nodemailer = require('nodemailer');
const https      = require('https');
const { URL }    = require('url');

const FIREBASE_URL = process.env.FIREBASE_URL;
const RECIPIENTS   = (process.env.RECIPIENTS || '').split(',').map(s => s.trim()).filter(Boolean);
const MAIL_USER    = process.env.MAIL_USERNAME;
const MAIL_PASS    = process.env.MAIL_PASSWORD;

if (!FIREBASE_URL || !MAIL_USER || !MAIL_PASS || !RECIPIENTS.length) {
  console.error('Missing env vars. Need FIREBASE_URL, MAIL_USERNAME, MAIL_PASSWORD, RECIPIENTS');
  process.exit(1);
}

// ─── small Firebase REST helper ─────────────────────────────────────────────
function fbReq(method, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(FIREBASE_URL + path);
    const opts = {
      hostname: u.hostname,
      path:     u.pathname + (u.search || ''),
      method,
      headers:  { 'Content-Type': 'application/json' }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end',  () => {
        try { resolve(data ? JSON.parse(data) : null); }
        catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}
const fbGet   = (path)        => fbReq('GET',   path);
const fbPut   = (path, val)   => fbReq('PUT',   path, val);
const fbPatch = (path, patch) => fbReq('PATCH', path, patch);

// ─── email rendering ─────────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderHtml(c) {
  const plate     = esc(c.plate     || '—');
  const location  = esc(c.location  || '—');
  const inspector = esc(c.inspector || '—');
  const owner     = esc(c.owner     || c.ownerName || '—');
  const date      = esc(c.date      || '');
  const phone     = esc(c.phone     || '');
  return `<!DOCTYPE html><html dir="rtl" lang="he"><body style="font-family:Heebo,Arial,sans-serif;background:#f3f4f8;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;box-shadow:0 4px 16px rgba(0,0,0,0.08);overflow:hidden;">
    <div style="background:linear-gradient(135deg,#420057,#5a008a);color:#fff;padding:22px 24px;">
      <div style="font-size:22px;font-weight:800;margin-bottom:4px;">🆕 פקח פתח תיק חדש</div>
      <div style="font-size:14px;opacity:0.9;">נא לעדכן את פרטי התיק בתוכנת הניהול</div>
    </div>
    <div style="padding:20px 24px;">
      <table style="width:100%;border-collapse:collapse;font-size:15px;">
        <tr><td style="padding:8px 0;color:#888;width:140px;">מספר רכב:</td><td style="padding:8px 0;font-weight:700;color:#1a1a2e;">${plate}</td></tr>
        <tr><td style="padding:8px 0;color:#888;">יישוב:</td><td style="padding:8px 0;font-weight:600;">${location}</td></tr>
        <tr><td style="padding:8px 0;color:#888;">פקח:</td><td style="padding:8px 0;font-weight:600;">${inspector}</td></tr>
        ${owner !== '—' ? `<tr><td style="padding:8px 0;color:#888;">בעל הרכב:</td><td style="padding:8px 0;font-weight:600;">${owner}</td></tr>` : ''}
        ${phone        ? `<tr><td style="padding:8px 0;color:#888;">נייד בעלים:</td><td style="padding:8px 0;font-weight:600;" dir="ltr">${phone}</td></tr>` : ''}
        ${date         ? `<tr><td style="padding:8px 0;color:#888;">תאריך פתיחה:</td><td style="padding:8px 0;font-weight:600;">${date}</td></tr>` : ''}
      </table>
    </div>
    <div style="padding:14px;text-align:center;color:#aaa;font-size:11px;border-top:1px solid #eee;background:#fafafa;">
      🤖 התראה אוטומטית · GalilVehicles · ${new Date().toLocaleString('he-IL')}
    </div>
  </div>
</body></html>`;
}

// ─── main ────────────────────────────────────────────────────────────────────
(async () => {
  // ─── first-run protection ───
  // Without this, the very first execution after the workflow is added would
  // send an email for EVERY existing case (could be 30+ emails at once).
  // We mark all existing cases as "skipped" on first run, then only newly-
  // added cases trigger emails.
  const initialized = await fbGet('/_notificationsInitialized.json');

  // ─── load all cases ───
  const cases = (await fbGet('/cases.json')) || {};
  const ids = Object.keys(cases);

  if (!initialized) {
    console.log('[init] first run — marking ' + ids.length + ' existing cases as notified (no emails sent)');
    const now = Date.now();
    for (const id of ids) {
      try { await fbPatch('/cases/' + id + '.json', { _notifiedAt: now, _notifiedInitSkip: true }); }
      catch (e) { console.warn('[init] failed for', id, e.message); }
    }
    await fbPut('/_notificationsInitialized.json', { at: now, count: ids.length });
    console.log('[init] done. From now on, only NEW cases trigger emails.');
    return;
  }

  // ─── pick cases that haven't been notified yet ───
  const pending = [];
  for (const id of ids) {
    const c = cases[id];
    if (!c) continue;
    if (c._notifiedAt) continue;          // already notified
    if (c._deleted)   continue;           // tombstoned
    if (c.serverDeleted) continue;        // server-side delete marker
    pending.push(Object.assign({ id }, c));
  }

  if (!pending.length) {
    console.log('No new cases to notify.');
    return;
  }

  console.log('Notifying ' + pending.length + ' new case(s):',
              pending.map(c => c.plate || c.id).join(', '));

  // ─── mailer ───
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: MAIL_USER, pass: MAIL_PASS }
  });

  let ok = 0, fail = 0;
  for (const c of pending) {
    const plate    = c.plate    || c.id || '—';
    const location = c.location || '—';
    const subject  = '🆕 תיק חדש: ' + plate + (location !== '—' ? ' · ' + location : '');
    try {
      await transporter.sendMail({
        from:    '"GalilVehicles Notifications" <' + MAIL_USER + '>',
        to:      RECIPIENTS.join(', '),
        subject: subject,
        html:    renderHtml(c)
      });
      await fbPatch('/cases/' + c.id + '.json', { _notifiedAt: Date.now() });
      console.log('  ✓ sent for ' + plate);
      ok++;
    } catch (e) {
      console.error('  ✗ failed for ' + plate + ':', e.message);
      fail++;
    }
  }
  console.log('Done — sent: ' + ok + ', failed: ' + fail);
})().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
