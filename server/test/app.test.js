const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TokenVerifier } = require('livekit-server-sdk');
const { createApp } = require('../src/app');

const credentials = { apiKey: 'local-test-key', apiSecret: 'test-only-secret-with-at-least-32-characters' };
const request = { roomName: 'support-room', identity: 'developer' };
async function server(t, config) {
  const listener = createApp(config).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { listener.once('listening', resolve); listener.once('error', reject); });
  t.after(() => new Promise(resolve => listener.close(resolve)));
  const url = 'http://127.0.0.1:' + listener.address().port;
  return (body, options = {}) => fetch(url + (options.path || '/token'), {
    method: options.method || 'POST', headers: { 'Content-Type': 'application/json', ...options.headers },
    body: options.method === 'GET' ? undefined : options.raw ?? JSON.stringify(body),
  });
}

test('starts without credentials and reports unavailable token issuance', async t => {
  const send = await server(t, {});
  const health = await send(null, { path: '/health', method: 'GET' });
  assert.deepEqual(await health.json(), { status: 'ok', tokenConfigured: false });
  const result = await send(request);
  assert.equal(result.status, 503); assert.deepEqual(await result.json(), { error: 'token_not_configured' });
});
test('signs and verifies a short-lived, room-scoped subscribe-only token locally', async t => {
  const logs = []; const send = await server(t, { ...credentials, log: code => logs.push(code) });
  const before = Math.floor(Date.now() / 1000);
  const result = await send({ roomName: ' support-room ', identity: ' developer ' });
  assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
  const { token } = await result.json(); const claims = await new TokenVerifier(credentials.apiKey, credentials.apiSecret).verify(token);
  assert.equal(claims.sub, 'developer');
  assert.deepEqual(claims.video, { roomJoin: true, room: 'support-room', canSubscribe: true, canPublish: false, canPublishData: false });
  assert.ok(claims.exp >= before + 300 && claims.exp <= Math.floor(Date.now() / 1000) + 300);
  assert.deepEqual(logs, ['token_issued']); assert.ok(!JSON.stringify(logs).includes(token));
});
test('publishing requires the explicit boolean microphone opt-in', async t => {
  const send = await server(t, credentials);
  const result = await send({ ...request, publishMicrophone: true });
  const { token } = await result.json(); const claims = await new TokenVerifier(credentials.apiKey, credentials.apiSecret).verify(token);
  assert.equal(claims.video.canPublish, true); assert.equal(claims.video.canPublishData, false);
});
test('accepts the exact identifier bound', async t => {
  const send = await server(t, credentials);
  assert.equal((await send({ roomName: 'x'.repeat(100), identity: 'y'.repeat(100) })).status, 200);
});
for (const [name, body] of [
  ['missing body fields', {}], ['array', []], ['null', null], ['number', { ...request, identity: 7 }],
  ['object', { ...request, roomName: {} }], ['empty', { ...request, identity: ' ' }],
  ['too long', { ...request, roomName: 'x'.repeat(101) }], ['control', { ...request, identity: 'dev\nsecret' }],
  ['wrong opt-in type', { ...request, publishMicrophone: 'true' }],
]) {
  test('rejects ' + name + ' before signing', async t => {
    let calls = 0; const send = await server(t, { ...credentials, sign: async () => { calls++; return 'fake'; } });
    const result = await send(body);
    assert.equal(result.status, 400); assert.equal(calls, 0);
    assert.match(result.headers.get('content-type'), /application\/json/);
  });
}
test('rejects oversized and malformed JSON without exposing body content', async t => {
  const send = await server(t, credentials);
  let result = await send(null, { raw: JSON.stringify({ ...request, secret: 'x'.repeat(9000) }) });
  assert.equal(result.status, 413); assert.deepEqual(await result.json(), { error: 'request_too_large' });
  result = await send(null, { raw: '{"secret":' });
  assert.equal(result.status, 400); assert.deepEqual(await result.json(), { error: 'invalid_json' });
});
test('enforces the configured browser origin and returns a finite CORS policy', async t => {
  const send = await server(t, credentials);
  const denied = await send(request, { headers: { Origin: 'https://other.example' } });
  assert.equal(denied.status, 403); assert.deepEqual(await denied.json(), { error: 'origin_not_allowed' });
  const allowed = await send(request, { headers: { Origin: 'http://127.0.0.1:5173' } });
  assert.equal(allowed.status, 200); assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173');
});
test('signing failures have a fixed JSON/log contract without credentials or JWT fragments', async t => {
  const logs = []; const send = await server(t, { ...credentials, log: code => logs.push(code), sign: async () => { throw new Error('secret JWT eyJ-example'); } });
  const result = await send(request);
  assert.equal(result.status, 500); assert.deepEqual(await result.json(), { error: 'token_issue_failed' }); assert.deepEqual(logs, ['token_issue_failed']);
});
test('unknown routes return JSON rather than an HTML error page', async t => {
  const send = await server(t, {}); const result = await send(null, { path: '/missing', method: 'GET' });
  assert.equal(result.status, 404); assert.deepEqual(await result.json(), { error: 'not_found' });
});
