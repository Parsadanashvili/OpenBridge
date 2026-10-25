// Detached JWS (b64:false) per the Georgian JWS Implementation Guide 0.5.RC1 (ETSI TS 119 182 HttpHeaders mechanism).
// sign(): builds header..signature.  verify(): returns a list of rule violations keyed to rulebook IDs.
const crypto = require('crypto');

const MID = 'http://uri.etsi.org/19182/HttpHeaders';
const ALLOWED_ALG = ['RS256', 'RS512', 'ES256', 'ES512', 'PS256', 'PS512'];
const b64u = (b) => Buffer.from(b).toString('base64url');
const sha = (alg, body) => `${alg === 'SHA-512' ? 'SHA-512' : 'SHA-256'}=` + crypto.createHash(alg === 'SHA-512' ? 'sha512' : 'sha256').update(body).digest('base64');
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

function algParams(alg) {
  const h = alg.endsWith('512') ? 'sha512' : 'sha256';
  if (alg.startsWith('RS')) return { hash: h };
  if (alg.startsWith('PS')) return { hash: h, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST };
  return { hash: h, dsaEncoding: 'ieee-p1363' };
}

// lines to sign: "(request-target): post /v1/x" | "(response-status): 200" | "name: value"
function headerLines(pars, { headers, method, path, status }) {
  return pars.map((p) => {
    if (p === '(request-target)') return `(request-target): ${method.toLowerCase()} ${path}`;
    if (p === '(response-status)') return `(response-status): ${status}`;
    return `${p}: ${headers[p] ?? ''}`;
  }).join('\n');
}

function sign({ keyPem, certPem, alg = 'RS256', pars, headers, method, path, status, sigT, overrides = {} }) {
  const der = new crypto.X509Certificate(certPem).raw.toString('base64');
  const header = { b64: false, x5c: [der], crit: ['sigT', 'sigD', 'b64'], sigT: sigT || nowIso(), sigD: { pars, mId: MID }, alg, ...overrides };
  for (const k of Object.keys(overrides)) if (overrides[k] === undefined) delete header[k];
  const protectedB64 = b64u(JSON.stringify(header));
  const input = Buffer.from(`${protectedB64}.${headerLines(pars, { headers, method, path, status })}`, 'utf8');
  const p = algParams(header.alg === 'none' ? 'RS256' : header.alg);
  const sig = crypto.sign(p.hash, input, { key: keyPem, ...(p.padding ? { padding: p.padding, saltLength: p.saltLength } : {}), ...(p.dsaEncoding ? { dsaEncoding: p.dsaEncoding } : {}) });
  return `${protectedB64}..${b64u(sig)}`;
}

// ctx: { headers (lowercase keys), method, path (requests) | status (responses), body (Buffer|string), kind:'request'|'response', now }
function verify(jws, ctx) {
  const v = []; // {rule, expected, actual}
  const add = (rule, expected, actual) => v.push({ rule, expected, actual });
  const h = ctx.headers, body = Buffer.from(ctx.body || '');
  if (!jws) { add('GE-JWS-HEADER', 'x-jws-signature header present', 'absent'); return { violations: v, verified: false }; }
  const parts = String(jws).split('.');
  if (parts.length !== 3 || parts[1] !== '') { add('GE-JWS-HEADER', 'detached JWS "header..signature"', `${parts.length} parts, payload ${parts[1] ? 'non-empty' : 'empty'}`); return { violations: v, verified: false }; }
  let raw, hdr;
  try { raw = Buffer.from(parts[0], 'base64url').toString('utf8'); hdr = JSON.parse(raw); } catch { add('GE-JWS-HEADER', 'protected header is base64url JSON', 'unparseable'); return { violations: v, verified: false }; }
  if (raw !== JSON.stringify(hdr)) add('GE-JWS-COMPACT', 'single-line JSON without spaces/escapes', 'header contains extra whitespace or formatting');
  if (hdr.b64 !== false) add('GE-JWS-B64', 'b64: false', `b64: ${hdr.b64}`);
  if (!ALLOWED_ALG.includes(hdr.alg)) add('GE-JWS-ALG', ALLOWED_ALG.join('|'), `alg: ${hdr.alg}`);
  if (!Array.isArray(hdr.x5c) || hdr.x5c.length !== 1) add('GE-JWS-X5C', 'x5c with exactly one certificate', Array.isArray(hdr.x5c) ? `${hdr.x5c.length} entries` : 'absent');
  const banned = [hdr.x5c && hdr['x5t#S256'] ? 'x5c together with x5t#S256' : null, hdr.jwk ? 'jwk present' : null, hdr.x5t ? 'x5t (SHA-1) present' : null].filter(Boolean);
  if (banned.length) add('GE-JWS-NOX5T', 'no x5c+x5t#S256, no jwk, no x5t', banned.join('; '));
  const crit = hdr.crit || [];
  if (!['sigT', 'sigD', 'b64'].every((c) => crit.includes(c))) add('GE-JWS-CRIT', 'crit includes sigT, sigD, b64', `crit: ${JSON.stringify(hdr.crit)}`);
  if (typeof hdr.sigT !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(hdr.sigT)) add('GE-JWS-SIGT', 'UTC YYYY-MM-DDThh:mm:ssZ, no fractional seconds', `sigT: ${hdr.sigT}`);
  else {
    const skew = (Date.parse(hdr.sigT) - (ctx.now || Date.now())) / 1000; // + means sender clock ahead
    if (skew > 2 || skew < -60) add('GE-JWS-SKEW', 'sigT within +2 s / -60 s of local UTC', `skew ${Math.round(skew)} s`);
  }
  if (!hdr.sigD || hdr.sigD.mId !== MID || !Array.isArray(hdr.sigD.pars)) add('GE-JWS-MID', `sigD.mId = ${MID} and sigD.pars[]`, JSON.stringify(hdr.sigD));
  const pars = (hdr.sigD && hdr.sigD.pars) || [];
  const need = ctx.kind === 'request' ? ['(request-target)', 'host', 'digest'] : ['(response-status)', 'digest'];
  if (h['content-type']) need.push('content-type');
  if (h['x-request-id']) need.push('x-request-id');
  for (const k of Object.keys(h)) if (k.startsWith('psu-')) need.push(k);
  const missing = need.filter((n) => !pars.includes(n)); const wrong = ctx.kind === 'request' ? pars.filter((p) => p === '(response-status)') : pars.filter((p) => p === '(request-target)');
  if (missing.length || wrong.length || pars.includes('date')) add('GE-JWS-PARS', `pars cover ${need.join(', ')}; no Date; ${ctx.kind === 'request' ? '(request-target)' : '(response-status)'} only on ${ctx.kind}s`, `missing: ${missing.join(', ') || 'none'}${wrong.length ? `; misplaced ${wrong.join(',')}` : ''}${pars.includes('date') ? '; Date protected' : ''}`);
  if ('typ' in hdr && hdr.typ !== 'JOSE') add('GE-JWS-TYP', 'typ absent or "JOSE"', `typ: ${hdr.typ}`);
  // Digest
  const dg = h.digest; const m = /^(SHA-256|SHA-512)=(.+)$/.exec(dg || '');
  if (!m) add('GE-JWS-DIGEST', 'Digest: SHA-256=<base64> (or SHA-512)', dg ? `Digest: ${dg}` : 'Digest header absent');
  else if (sha(m[1], body) !== dg) add('GE-JWS-DIGEST', `Digest equals ${m[1]} of the body`, 'Digest does not match the body');
  // signature
  let verified = false;
  try {
    const cert = new crypto.X509Certificate(Buffer.from(hdr.x5c[0], 'base64'));
    const input = Buffer.from(`${parts[0]}.${headerLines(pars, { headers: h, method: ctx.method || '', path: ctx.path || '', status: ctx.status })}`, 'utf8');
    const p = algParams(ALLOWED_ALG.includes(hdr.alg) ? hdr.alg : 'RS256');
    verified = crypto.verify(p.hash, input, { key: cert.publicKey, ...(p.padding ? { padding: p.padding, saltLength: p.saltLength } : {}), ...(p.dsaEncoding ? { dsaEncoding: p.dsaEncoding } : {}) }, Buffer.from(parts[2], 'base64url'));
  } catch (e) { verified = false; }
  if (!verified) add('GE-JWS-VERIFY', 'signature verifies with the certificate in x5c', 'signature invalid or certificate unreadable');
  return { violations: v, verified, header: hdr };
}

module.exports = { sign, verify, sha, MID, ALLOWED_ALG, nowIso };
