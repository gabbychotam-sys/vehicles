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

// Option B "Memo" design — Outlook/Ironscales-safe.
// No bgcolor (stripped by sanitizers), no gradients, no buttons.
// Only inline font color + table borders + emojis survive cleanly.

function renderCaseRow(c, idx, alt) {
  const plate     = esc(c.plate     || '—');
  const location  = esc(c.location  || '—');
  const inspector = esc(c.inspector || '—');
  let statusLabel, statusColor;
  if (c.status === 'red') {
    statusColor='#c62828'; statusLabel='🔴 מ.אדומה';
  } else if (c.status === 'orange') {
    statusColor='#e65100'; statusLabel='🚛 נגררה';
  } else if (c.status === 'green') {
    statusColor='#2e7d32'; statusLabel='✅ נסגר';
  } else if (c.status === 'photographed') {
    statusColor='#1565c0'; statusLabel='📷 לבירור';
  } else {
    statusColor='#f57f17'; statusLabel='🟡 מ.צהובה';
  }
  const inspectorShort = inspector.split(' ')[0] || inspector;
  const rowBg = alt ? ' bgcolor="#f5f9ff" style="background-color:#f5f9ff;"' : '';
  const bottomBorder = 'border-bottom:1px solid #ddd;';

  return `
    <tr${rowBg}>
      <td style="padding:7px 8px;font-weight:bold;${bottomBorder}width:30px;">${idx}.</td>
      <td style="padding:7px 8px;${bottomBorder}direction:ltr;text-align:right;width:90px;"><b>${plate}</b></td>
      <td style="padding:7px 8px;${bottomBorder}color:${statusColor};font-weight:bold;white-space:nowrap;">${statusLabel}</td>
      <td style="padding:7px 8px;${bottomBorder}">${location}</td>
      <td style="padding:7px 8px;${bottomBorder}color:#666;text-align:left;">${esc(inspectorShort)}</td>
    </tr>`;
}

function renderEmail(cases) {
  const dateStr = new Date().toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit', year:'numeric' });
  const timeStr = new Date().toLocaleTimeString('he-IL').slice(0,5);
  const n = cases.length;
  const headline = n === 1 ? 'תיק חדש אחד' : n + ' תיקים חדשים';
  const rows = cases.map((c, i) => renderCaseRow(c, i + 1, i % 2 === 0)).join('');

  return `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>${esc(headline)}</title></head>
<body style="margin:0;padding:20px;font-family:Arial,Helvetica,sans-serif;color:#222;direction:rtl;">

<table border="0" cellpadding="0" cellspacing="0" align="center" style="width:560px;max-width:100%;">

  <!-- כותרת -->
  <tr><td style="padding:0 0 10px 0;border-bottom:3px double #1565c0;">
    <div style="font-size:11px;color:#888;letter-spacing:2px;">פיקוח רכבים נטושים · גליל עליון</div>
    <div style="font-size:22px;font-weight:bold;color:#1565c0;margin-top:4px;">⚠ עדכון פעילות בשטח</div>
  </td></tr>

  <!-- אל / תאריך / נושא -->
  <tr><td style="padding:8px 0;font-size:13px;color:#666;">
    <b>אל:</b> גבי חותם, מורן לוז<br>
    <b>תאריך:</b> ${esc(dateStr)}, ${esc(timeStr)}<br>
    <b>נושא:</b> נוספו <span style="color:#c62828;font-weight:bold;">${esc(headline)}</span> דרך האפליקציה
  </td></tr>

  <!-- גוף ההודעה -->
  <tr><td style="padding:12px 0;border-top:1px solid #ddd;border-bottom:1px solid #ddd;">
    <div style="font-size:14px;line-height:1.6;color:#333;">
      שלום,<br>
      פקחים בשטח פתחו תיקים חדשים. רשימה מפורטת מטה.<br>
      <b>נדרשת השלמת טיפול</b> בתוכנת הניהול.
    </div>
  </td></tr>

  <!-- פירוט התיקים -->
  <tr><td style="padding:14px 0 6px 0;">
    <div style="font-size:13px;font-weight:bold;color:#1565c0;margin-bottom:8px;">▸ פירוט התיקים</div>
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="font-size:13px;border-top:1px solid #1565c0;border-bottom:1px solid #1565c0;">${rows}
    </table>
  </td></tr>

  <!-- חתימה -->
  <tr><td style="padding:14px 0 0 0;border-top:1px solid #ddd;font-size:11px;color:#888;">
    מערכת התראות אוטומטית · GalilVehicles<br>
    הודעה זו נשלחת רק כשנוספים תיקים חדשים
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
