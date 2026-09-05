// Shared boundary for browser-submitted public forms. This prevents cross-site
// form posts and bounds every body representation Vercel can hand a function.
// Durable abuse quotas belong at the edge, across all function instances.
class PublicRequestError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function header(req, name) {
  const value = req.headers?.[name];
  return typeof value === 'string' ? value : '';
}

function allowedOrigin(value) {
  if (value === 'https://statskey.ai' || value === 'https://www.statskey.ai') return true;
  if (process.env.VERCEL_URL && value === `https://${process.env.VERCEL_URL}`) return true;
  if (process.env.VERCEL_ENV === 'production') return false;
  try {
    const url = new URL(value);
    return url.origin === value && url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function setPrivateResponseHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

export function sendPublicRequestError(res, error) {
  const known = error instanceof PublicRequestError;
  res.status(known ? error.status : 400).json({
    error: known ? error.code : 'bad_request',
  });
}

export async function readPublicJsonBody(req, maxBytes) {
  const origin = header(req, 'origin');
  if ((origin && !allowedOrigin(origin)) || header(req, 'sec-fetch-site') === 'cross-site') {
    throw new PublicRequestError(403, 'origin_not_allowed');
  }
  if (header(req, 'content-type').split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new PublicRequestError(415, 'json_required');
  }
  const declaredLength = header(req, 'content-length');
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)) {
    throw new PublicRequestError(413, 'request_too_large');
  }

  let body;
  if (req.body !== undefined) {
    const encoded = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (typeof encoded !== 'string') throw new PublicRequestError(400, 'bad_request');
    if (Buffer.byteLength(encoded, 'utf8') > maxBytes) {
      throw new PublicRequestError(413, 'request_too_large');
    }
    try { body = JSON.parse(encoded); } catch { throw new PublicRequestError(400, 'bad_request'); }
  } else {
    let size = 0;
    const chunks = [];
    for await (const part of req) {
      const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
      size += chunk.length;
      if (size > maxBytes) throw new PublicRequestError(413, 'request_too_large');
      chunks.push(chunk);
    }
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
      throw new PublicRequestError(400, 'bad_request');
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new PublicRequestError(400, 'bad_request');
  }
  return body;
}
