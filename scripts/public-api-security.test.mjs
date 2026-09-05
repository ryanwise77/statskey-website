import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readPublicJsonBody } from '../lib/public-api-request.js';
import glucosePlan from '../api/glucose-plan.js';
import libreHistory from '../api/libre-history.js';
import dietitianLead from '../api/dietitian-lead.js';
import careRecord from '../api/care-record.js';

const headers = { 'content-type': 'application/json', origin: 'https://statskey.ai' };

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

test('public JSON boundary accepts website form submissions and Node callers', async () => {
  assert.deepEqual(await readPublicJsonBody({ headers, body: { name: 'Test' } }, 100), { name: 'Test' });
  assert.deepEqual(await readPublicJsonBody({ headers: { 'content-type': 'application/json; charset=utf-8' }, body: '{"name":"Test"}' }, 100), { name: 'Test' });
});

test('cross-site JSON-shaped text forms cannot trigger public operations', async () => {
  for (const requestHeaders of [
    { 'content-type': 'text/plain' },
    { ...headers, origin: 'https://attacker.example' },
    { ...headers, origin: 'null' },
    { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
  ]) {
    await assert.rejects(readPublicJsonBody({ headers: requestHeaders, body: { name: 'Test' } }, 100),
      (error) => error.status === 403 || error.status === 415);
  }
});

test('pre-parsed objects, UTF-8 strings, Buffers and streams enforce byte limits', async () => {
  const oversized = JSON.stringify({ value: '💻'.repeat(32) });
  for (const body of [JSON.parse(oversized), oversized, Buffer.from(oversized)]) {
    await assert.rejects(readPublicJsonBody({ headers, body }, 100), { status: 413 });
  }
  const stream = Readable.from([oversized.slice(0, 20), oversized.slice(20)]);
  stream.headers = headers;
  await assert.rejects(readPublicJsonBody(stream, 100), { status: 413 });
});

test('declared overflow and non-object JSON fail before processing', async () => {
  await assert.rejects(readPublicJsonBody({ headers: { ...headers, 'content-length': '999999' }, body: {} }, 100), { status: 413 });
  for (const body of ['not json', 'null', '[]', '42']) {
    await assert.rejects(readPublicJsonBody({ headers, body }, 100), { status: 400 });
  }
});

test('all public endpoints reject cross-site and oversized requests before outbound calls', async () => {
  const originalFetch = globalThis.fetch;
  const priorKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'audit-placeholder';
  let outbound = 0;
  globalThis.fetch = async () => { outbound++; throw new Error('Unexpected outbound request'); };
  try {
    for (const handler of [glucosePlan, libreHistory, dietitianLead]) {
      const crossSite = response();
      await handler({ method: 'POST', headers: { ...headers, origin: 'https://attacker.example' }, body: {} }, crossSite);
      assert.equal(crossSite.statusCode, 403);
      const tooLarge = response();
      await handler({ method: 'POST', headers, body: { junk: 'x'.repeat(30 * 1024) } }, tooLarge);
      assert.equal(tooLarge.statusCode, 413);
      assert.match(tooLarge.headers['Cache-Control'], /no-store/);
    }
    assert.equal(outbound, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = priorKey;
  }
});

test('care record errors remain private and prevent content sniffing', async () => {
  const result = await careRecord(new Request('https://statskey.ai/api/care-record?record=invalid'));
  assert.equal(result.status, 404);
  assert.equal(result.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(result.headers.get('Cache-Control'), /no-store/);
});
