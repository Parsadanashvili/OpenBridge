// Single HTTP choke point: timing, timeouts, redaction, mTLS, request sealing (JWS), required-header profiles.
// Uses node:http(s) (not fetch) so client certificates work for real PSD2-style sandboxes.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jws = require('../shared/jws');

const ROOT = path.join(__dirname, '..', '..');
const SECRET_HEADERS = ['authorization', 'x-jws-signature', 'cookie', 'tpp-signature-certificate'];
const redactHeaders = (h) => Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k, SECRET_HEADERS.includes(k.toLowerCase()) ? '[REDACTED]' : v]));
const readFile = (p) => { if (!p) return undefined; const f = path.isAbsolute(p) ? p : path.join(ROOT, p); return fs.existsSync(f) ? fs.readFileSync(f) : undefined; };

const agents = new Map();
function agentFor(bank, isHttps) {
  if (!isHttps) return undefined;
  if (!agents.has(bank.id)) {
    const s = bank.security || {};
    agents.set(bank.id, new https.Agent({ keepAlive: true, cert: readFile(s.clientCert), key: readFile(s.clientKey), ca: readFile(s.caCert) }));
  }
  return agents.get(bank.id);
}

// Seal the request per the Georgian JWS profile (GE-SEC-SEAL). Returns extra headers or throws {code}.
function sealRequest(bank, { method, pathWithQuery, headers, bodyBuf }) {
  const s = bank.security || {};
  const key = readFile(s.signingKey), cert = readFile(s.signingCert);
  if (!key || !cert) throw Object.assign(new Error(bank.requiresJws ? 'JWS signing key/certificate not configured' : 'no signing material'), { code: bank.requiresJws ? 'NO_SIGNING_KEY' : 'SKIP' });
  const out = { Digest: jws.sha('SHA-256', bodyBuf) };
  const lc = Object.fromEntries(Object.entries({ ...headers, ...out }).map(([k, v]) => [k.toLowerCase(), v]));
  const pars = ['(request-target)', 'host'];
  if (lc['content-type']) pars.push('content-type');
  pars.push('digest');
  if (lc['x-request-id']) pars.push('x-request-id');
  for (const k of Object.keys(lc)) if (k.startsWith('psu-')) pars.push(k);
  out['x-jws-signature'] = jws.sign({ keyPem: key, certPem: cert, pars, headers: lc, method, path: pathWithQuery });
  return out;
}

function rawRequest(bank, method, urlStr, headers, bodyBuf, timeoutMs) {
  const u = new URL(urlStr), isHttps = u.protocol === 'https:';
  return new Promise((resolve, reject) => {
    const req = (isHttps ? https : http).request({ method, hostname: u.hostname, port: u.port || (isHttps ? 443 : 80), path: u.pathname + u.search, headers, agent: agentFor(bank, isHttps), timeout: timeoutMs }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const buf = Buffer.concat(chunks); resolve({ status: res.statusCode, headers: res.headers, text: buf.toString('utf8'), buf }); });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
    req.on('error', reject);
    if (bodyBuf && bodyBuf.length) req.write(bodyBuf);
    req.end();
  });
}

// opts: method, path, headers, body, timeoutMs, token, omitHeaders[], unsigned(bool), psuAbsent(bool)
// PSU-IP-Address is sent on every call (the auditor acts for a present PSU); psuAbsent simulates a TPP-initiated call (GE 9.1.1.6).
async function call(bank, { method = 'GET', path: p, headers = {}, body, timeoutMs = 3000, token, omitHeaders = [], unsigned = false, psuAbsent = false }) {
  const bodyBuf = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  const u = new URL(bank.baseUrl + p);
  const reqHeaders = { Host: u.host, Accept: 'application/json', 'X-Request-ID': crypto.randomUUID(), ...headers };
  if (!psuAbsent && !/\/oauth\//.test(u.pathname) && !reqHeaders['PSU-IP-Address']) reqHeaders['PSU-IP-Address'] = process.env.OB_PSU_IP || '127.0.0.1';
  if (token) reqHeaders.Authorization = `Bearer ${token}`;
  if (bodyBuf.length) { reqHeaders['Content-Type'] = 'application/json'; reqHeaders['Content-Length'] = bodyBuf.length; }
  for (const h of omitHeaders) for (const k of Object.keys(reqHeaders)) if (k.toLowerCase() === h.toLowerCase()) delete reqHeaders[k];
  const out = { method, url: p, startedAt: new Date().toISOString(), status: null, timedOut: false, networkError: null, sentRequestId: reqHeaders['X-Request-ID'], sealed: false };
  const t0 = process.hrtime.bigint();
  try {
    if (!unsigned && !/\/oauth\//.test(u.pathname)) {
      try { Object.assign(reqHeaders, sealRequest(bank, { method, pathWithQuery: u.pathname + u.search, headers: reqHeaders, bodyBuf })); out.sealed = true; }
      catch (e) { if (e.code === 'NO_SIGNING_KEY') { out.networkError = e.code; out.requestHeaders = redactHeaders(reqHeaders); out.latencyMs = 0; return out; } }
    }
    out.requestHeaders = redactHeaders(reqHeaders);
    const r = await rawRequest(bank, method, bank.baseUrl + p, reqHeaders, bodyBuf, timeoutMs);
    out.latencyMs = Number(process.hrtime.bigint() - t0) / 1e6;
    out.status = r.status; out.responseHeaders = r.headers; out.bodyText = r.text; out.bodyBuf = r.buf; out.recvAt = Date.now();
    try { out.json = JSON.parse(r.text); } catch { out.json = undefined; }
  } catch (e) {
    out.requestHeaders = out.requestHeaders || redactHeaders(reqHeaders);
    out.latencyMs = Number(process.hrtime.bigint() - t0) / 1e6;
    if (e.name === 'TimeoutError') out.timedOut = true; else out.networkError = String(e.code || e.message);
  }
  return out;
}

// Returns {token} or {skip:reason}. Simulators expose a token endpoint; real banks need a token from a human-approved OAuth/SCA flow.
async function getToken(bank) {
  const env = `OB_${bank.id.toUpperCase()}_ACCESS_TOKEN`;
  if (process.env[env]) return { token: process.env[env] };
  if (bank.simulated && bank.tokenUrl) {
    const r = await call(bank, { method: 'POST', path: new URL(bank.tokenUrl).pathname, body: { grant_type: 'client_credentials' }, unsigned: true });
    return r.json?.access_token ? { token: r.json.access_token } : { skip: 'token endpoint failed' };
  }
  return { skip: `no access token: set ${env} (obtained via the bank's OAuth/SCA flow with your test certificates)` };
}

const evidenceOf = (r) => ({
  request: { method: r.method, path: r.url, headers: r.requestHeaders, sealed: r.sealed },
  response: { status: r.status, latencyMs: r.latencyMs && Math.round(r.latencyMs * 10) / 10, timedOut: r.timedOut, networkError: r.networkError, bodyExcerpt: (r.bodyText || '').slice(0, 600) },
  at: r.startedAt,
});

module.exports = { call, getToken, evidenceOf };
