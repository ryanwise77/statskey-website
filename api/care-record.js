// Private clinician-record proxy (statskey.ai/clinician/record/<id>[/raw/<file>]).
//
// Serves a pre-built, read-only patient record preview that lives as
// `care-<id>-index.html` / `care-<id>-raw-<file>` objects in Firebase Storage.
// The storage download token and the allow-listed record ids exist ONLY in
// Vercel environment variables (CARE_RECORD_STORAGE_TOKEN, CARE_RECORD_IDS),
// never in this repository, so the objects stay unreachable without going
// through this route. Responses are streamed and marked private/no-store.
export const config = { runtime: 'edge' }

const STORAGE_ORIGIN = 'https://firebasestorage.googleapis.com'
const STORAGE_BUCKET = 'statskey.firebasestorage.app'
const RECORD_ID = /^[a-f0-9]{32}$/
const RAW_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/
const REQUEST_PASSTHROUGH = ['range', 'if-none-match', 'if-modified-since']
const RESPONSE_PASSTHROUGH = [
  'content-type',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
  'content-disposition',
]

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
}

function reply(status, body) {
  return new Response(body, { status, headers: PRIVATE_HEADERS })
}

function allowedRecordIds() {
  return (process.env.CARE_RECORD_IDS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

export default async function handler(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {
      status: 405,
      headers: { ...PRIVATE_HEADERS, Allow: 'GET, HEAD' },
    })
  }

  const token = process.env.CARE_RECORD_STORAGE_TOKEN || ''
  const url = new URL(request.url)
  const record = (url.searchParams.get('record') || '').toLowerCase()
  const file = url.searchParams.get('file') || ''
  if (!token || !RECORD_ID.test(record) || !allowedRecordIds().includes(record)) {
    return reply(404, 'Not found')
  }

  let objectName
  if (file === '') {
    objectName = `care-${record}-index.html`
  } else if (RAW_FILE.test(file) && !file.includes('..')) {
    objectName = `care-${record}-raw-${file}`
  } else {
    return reply(404, 'Not found')
  }

  const upstream = new URL(
    `/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(objectName)}`,
    STORAGE_ORIGIN,
  )
  upstream.searchParams.set('alt', 'media')
  upstream.searchParams.set('token', token)

  const requestHeaders = new Headers()
  for (const name of REQUEST_PASSTHROUGH) {
    const value = request.headers.get(name)
    if (value) requestHeaders.set(name, value)
  }

  let upstreamResponse
  try {
    upstreamResponse = await fetch(upstream, {
      method: request.method,
      headers: requestHeaders,
      redirect: 'follow',
    })
  } catch {
    return reply(502, 'Record storage unavailable')
  }

  const { status } = upstreamResponse
  if (status === 403 || status === 404) return reply(404, 'Not found')
  if (status !== 200 && status !== 206 && status !== 304) {
    return reply(502, 'Record storage error')
  }

  const headers = new Headers(PRIVATE_HEADERS)
  for (const name of RESPONSE_PASSTHROUGH) {
    const value = upstreamResponse.headers.get(name)
    if (value) headers.set(name, value)
  }
  // Only forward the byte length when the body is passed through unmodified.
  if (!upstreamResponse.headers.get('content-encoding')) {
    const length = upstreamResponse.headers.get('content-length')
    if (length) headers.set('content-length', length)
  }
  if (!headers.has('content-disposition')) headers.set('content-disposition', 'inline')

  const body = request.method === 'HEAD' || status === 304 ? null : upstreamResponse.body
  return new Response(body, { status, headers })
}
