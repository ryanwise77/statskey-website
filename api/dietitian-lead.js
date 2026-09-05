import { readPublicJsonBody, sendPublicRequestError, setPrivateResponseHeaders } from '../lib/public-api-request.js';

// Serverless lead-capture endpoint for the /for-dietitians practitioner page.
// This is OPT-IN / transactional only: it records a form the person chose to
// submit and notifies the founder. It never sends cold mail, so it is within
// Resend's Acceptable Use Policy.
//
// Optional env vars (set in the Vercel project settings):
//   RESEND_API_KEY    - if set, a notification email is sent to LEAD_NOTIFY_EMAIL
//   LEAD_NOTIFY_EMAIL - where leads are emailed (default: ryanws@statskeybiometrics.com)
//   LEAD_FROM         - verified Resend sender (default: StatsKey <onboarding@resend.dev>)
// With none configured the endpoint still validates and returns ok, logging the
// lead to the Vercel function logs so nothing is lost.

const MAX_BODY_BYTES = 16 * 1024;
const NOTIFY_TO = process.env.LEAD_NOTIFY_EMAIL || 'ryanws@statskeybiometrics.com';
const NOTIFY_FROM = process.env.LEAD_FROM || 'StatsKey <onboarding@resend.dev>';

const ROLES = ['RD/RDN', 'CDCES', 'CSSD', 'Nutritionist', 'Coach', 'Other'];
const FOCUS = ['Sports/performance', 'Gut/IBS', 'Diabetes/metabolic', 'Weight/wellness', 'Other'];

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function isEmail(s) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}



async function notify(lead) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log('dietitian-lead (no RESEND_API_KEY, logged only):', JSON.stringify(lead));
    return;
  }
  const rows = Object.entries(lead)
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#888">${escapeHtml(k)}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`)
    .join('');
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px">
      <h2 style="margin:0 0 12px;font-size:18px">New practitioner request</h2>
      <table style="font-size:14px;border-collapse:collapse">${rows}</table>
    </div>`;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: NOTIFY_FROM,
        to: [NOTIFY_TO],
        reply_to: lead.email,
        subject: `Practitioner request: ${lead.name}${lead.focus ? ' (' + lead.focus + ')' : ''}`,
        html,
      }),
    });
  } catch (e) {
    console.error('dietitian-lead notify failed:', e, JSON.stringify(lead));
  }
}

export default async function handler(req, res) {
  setPrivateResponseHeaders(res);
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  let body;
  try {
    body = await readPublicJsonBody(req, MAX_BODY_BYTES);
  } catch (error) {
    sendPublicRequestError(res, error);
    return;
  }
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'bad_request' });
    return;
  }

  // Honeypot: if a bot filled the hidden field, accept silently and drop.
  if (str(body.company_url, 200)) {
    res.status(200).json({ ok: true });
    return;
  }

  const name = str(body.name, 120);
  const email = str(body.email, 200).toLowerCase();
  const consent = body.consent === true || body.consent === 'true' || body.consent === 'on';

  if (!name || !isEmail(email) || !consent) {
    res.status(400).json({ error: 'invalid' });
    return;
  }

  const role = ROLES.includes(body.role) ? body.role : 'Other';
  const focus = FOCUS.includes(body.focus) ? body.focus : 'Other';

  const lead = {
    name,
    email,
    practice: str(body.practice, 200),
    role,
    focus,
    message: str(body.message, 1500),
    submitted: new Date().toISOString(),
  };

  await notify(lead);
  res.status(200).json({ ok: true });
}
