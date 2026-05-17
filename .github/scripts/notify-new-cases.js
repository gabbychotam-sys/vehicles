// notify-new-cases.js  (v2 — batched digest)
// Polls Firebase Realtime DB for cases that haven't been notified yet and
// sends ONE batched email with all of them to Gabi+Moran via Gmail SMTP.
// Marks every case included in the batch with _notifiedAt so it isn't sent
// again next run.
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

// Web mirror of the management software (so the email's CTA actually opens
// something useful — both Gabi and Moran can click and edit the case there).
const MANAGEMENT_URL = 'https://gabbychotam-sys.github.io/vehicles/%D7%AA%D7%95%D7%9B%D7%A0%D7%AA-%D7%A0%D7%99%D7%94%D7%95%D7%9C-%D7%A8%D7%9B%D7%91%D7%99%D7%9D-%D7%A0%D7%98%D7%95%D7%A9%D7%99%D7%9D.html';

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

// ─── rendering ───────────────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderCaseCard(c) {
  const plate     = esc(c.plate     || '—');
  const location  = esc(c.location  || '—');
  const inspector = esc(c.inspector || '—');
  // Pick gradient + status label based on status. Energetic warm-color palette.
  let bgGradient, plateColor, subColor, statusLabel;
  if (c.status === 'red') {
    bgGradient  = 'linear-gradient(135deg,#fee2e2,#fecaca)';
    plateColor  = '#991b1b';
    subColor    = '#7f1d1d';
    statusLabel = '🔴 מדבקה אדומה';
  } else if (c.status === 'orange') {
    bgGradient  = 'linear-gradient(135deg,#fed7aa,#fdba74)';
    plateColor  = '#9a3412';
    subColor    = '#7c2d12';
    statusLabel = '🚛 רכב נגרר לאחסנה';
  } else if (c.status === 'green') {
    bgGradient  = 'linear-gradient(135deg,#d1fae5,#a7f3d0)';
    plateColor  = '#065f46';
    subColor    = '#064e3b';
    statusLabel = '✅ תיק נסגר';
  } else {
    bgGradient  = 'linear-gradient(135deg,#fef3c7,#fde68a)';
    plateColor  = '#92400e';
    subColor    = '#78350f';
    statusLabel = '🟡 מדבקה צהובה';
  }
  // Inspector first name only — feels friendlier in the one-liner
  const inspectorShort = inspector.split(' ')[0] || inspector;

  return `
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${bgGradient};border-radius:14px;margin-bottom:12px;">
    <tr><td style="padding:14px 16px;">
      <div style="font-size:24px;font-weight:900;color:${plateColor};direction:ltr;text-align:right;letter-spacing:1px;font-family:Heebo,Arial,sans-serif;">${plate}</div>
      <div style="font-size:14px;color:${subColor};margin-top:4px;">${statusLabel} · 📍 ${location} · 👷 ${esc(inspectorShort)}</div>
    </td></tr>
  </table>`;
}

function renderEmail(cases) {
  const dateStr = new Date().toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit', year:'numeric' });
  const timeStr = new Date().toLocaleTimeString('he-IL').slice(0,5);
  const n = cases.length;
  const cards = cases.map(renderCaseCard).join('');
  const headline = n === 1 ? '1 תיק חדש' : n + ' תיקים חדשים';

  return `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>${esc(headline)}</title></head>
<body style="margin:0;padding:0;background:linear-gradient(135deg,#fef3c7 0%,#fce7f3 100%);font-family:Heebo,Arial,sans-serif;min-height:100vh;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:24px 12px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;background:#ffffff;border-radius:20px;box-shadow:0 10px 32px rgba(0,0,0,0.12);overflow:hidden;">

        <!-- HERO HEADER -->
        <tr><td style="background:linear-gradient(135deg,#f59e0b,#ef4444);color:#ffffff;padding:36px 28px;text-align:center;">
          <div style="font-size:64px;line-height:1;margin-bottom:8px;">🚗 🚨 🚛</div>
          <div style="font-size:26px;font-weight:900;margin-bottom:6px;">היי, חברים!</div>
          <div style="font-size:16px;opacity:0.95;font-weight:500;">פקחים עבדו מהר היום ופתחו...</div>
          <div style="font-size:42px;font-weight:900;margin-top:6px;">${esc(headline)}</div>
        </td></tr>

        <!-- GREETING -->
        <tr><td style="padding:28px 28px 8px 28px;text-align:center;">
          <div style="font-size:17px;color:#374151;line-height:1.7;font-weight:500;">
            שלום <strong style="color:#ef4444;">גבי ומורן</strong>,<br>
            הצוות בשטח ממתין לכם — הגיע הזמן להיכנס לתוכנת הניהול ולקפוץ פנימה כדי להשלים את הטיפול 💪
          </div>
        </td></tr>

        <!-- CTA BUTTON -->
        <tr><td style="padding:20px 28px 12px 28px;text-align:center;">
          <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;">
            <tr><td style="background:linear-gradient(135deg,#ef4444,#dc2626);border-radius:12px;box-shadow:0 4px 16px rgba(239,68,68,0.4);">
              <a href="${MANAGEMENT_URL}" style="display:inline-block;padding:16px 36px;color:#ffffff;text-decoration:none;font-size:17px;font-weight:800;font-family:Heebo,Arial,sans-serif;">🚀 חדש לתוכנת הניהול</a>
            </td></tr>
          </table>
        </td></tr>

        <!-- DIVIDER -->
        <tr><td style="padding:24px 28px 8px 28px;text-align:center;">
          <div style="font-size:14px;color:#9ca3af;font-weight:600;letter-spacing:2px;">━━━ התיקים שהתווספו ━━━</div>
        </td></tr>

        <!-- CASE CARDS -->
        <tr><td style="padding:8px 28px 8px 28px;">${cards}</td></tr>

        <!-- ENCOURAGEMENT -->
        <tr><td style="padding:20px 28px 24px 28px;text-align:center;">
          <div style="font-size:24px;margin-bottom:6px;">💪 🎯 ✨</div>
          <div style="font-size:15px;color:#6b7280;font-weight:600;">קדימה לטיפול!</div>
        </td></tr>

        <!-- FOOTER -->
        <tr><td style="padding:14px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
          <div style="font-size:11px;color:#9ca3af;line-height:1.6;">
            🤖 התראה אוטומטית · GalilVehicles<br>
            ${dateStr}, ${timeStr}
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}

// ─── main ────────────────────────────────────────────────────────────────────
(async () => {
  // ─── first-run protection ───
  // Without this, the very first execution after the workflow is added would
  // send an email for EVERY existing case (could be 30+ cases at once).
  // We mark all existing cases as "skipped" on first run.
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
    if (c._notifiedAt)   continue;  // already notified
    if (c._deleted)      continue;  // tombstoned
    if (c.serverDeleted) continue;  // server-side delete marker
    pending.push(Object.assign({ id }, c));
  }

  if (!pending.length) {
    console.log('No new cases to notify.');
    return;
  }

  console.log('Notifying ' + pending.length + ' new case(s) in ONE batched email:',
              pending.map(c => c.plate || c.id).join(', '));

  // ─── sort cases by lastModified (newest last) for nice chronological order ───
  pending.sort((a, b) => (a.lastModified || 0) - (b.lastModified || 0));

  // ─── mailer ───
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: MAIL_USER, pass: MAIL_PASS }
  });

  const n = pending.length;
  const subject = n === 1
    ? '🆕 תיק חדש: ' + (pending[0].plate || pending[0].id) + ' · ' + (pending[0].location || '—')
    : '🆕 ' + n + ' תיקים חדשים מהפקחים';

  try {
    await transporter.sendMail({
      from:    '"GalilVehicles Notifications" <' + MAIL_USER + '>',
      to:      RECIPIENTS.join(', '),
      subject: subject,
      html:    renderEmail(pending)
    });
    console.log('✓ batched email sent to ' + RECIPIENTS.join(', '));

    // Mark all included cases as notified
    const stamp = Date.now();
    for (const c of pending) {
      try { await fbPatch('/cases/' + c.id + '.json', { _notifiedAt: stamp }); }
      catch (e) { console.warn('  failed to mark', c.id, e.message); }
    }
    console.log('Done — ' + n + ' case(s) marked as notified');
  } catch (e) {
    console.error('✗ batched email failed:', e.message);
    process.exit(1);
  }
})().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
