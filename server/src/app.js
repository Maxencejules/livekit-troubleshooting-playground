const express = require('express');
const cors = require('cors');
const { AccessToken } = require('livekit-server-sdk');

function identifier(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 100 && !/[\u0000-\u001f\u007f]/.test(trimmed) ? trimmed : null;
}

// Local developer issuer only: credentials stay in this process, never in client code or logs.
function createApp({ apiKey, apiSecret, allowedOrigin = 'http://127.0.0.1:5173', sign, log = () => {} } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && origin !== allowedOrigin) return res.status(403).json({ error: 'origin_not_allowed' });
    next();
  });
  app.use(cors({ origin: allowedOrigin, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
  app.use(express.json({ limit: '8kb', strict: true }));
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/health', (_req, res) => res.json({ status: 'ok', tokenConfigured: Boolean(apiKey && apiSecret) }));
  app.post('/token', async (req, res) => {
    const body = req.body;
    const roomName = identifier(body?.roomName);
    const identity = identifier(body?.identity);
    if (!body || Array.isArray(body) || !roomName || !identity || (body.publishMicrophone !== undefined && typeof body.publishMicrophone !== 'boolean')) {
      return res.status(400).json({ error: 'invalid_request', message: 'roomName and identity must be 1–100 characters; publishMicrophone must be boolean.' });
    }
    if (!apiKey || !apiSecret) return res.status(503).json({ error: 'token_not_configured' });
    try {
      const token = new AccessToken(apiKey, apiSecret, { identity, ttl: 300 });
      token.addGrant({ roomJoin: true, room: roomName, canSubscribe: true, canPublish: body.publishMicrophone === true, canPublishData: false });
      const jwt = await (sign ? sign(token) : token.toJwt());
      log('token_issued');
      return res.json({ token: jwt });
    } catch {
      log('token_issue_failed');
      return res.status(500).json({ error: 'token_issue_failed' });
    }
  });
  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use((error, _req, res, _next) => {
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'request_too_large' });
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'invalid_json' });
    log('request_failed');
    return res.status(500).json({ error: 'request_failed' });
  });
  return app;
}
module.exports = { createApp };
