// Authentication errors, error mapping, header hygiene, link hosts, message seal (JWS) verification, TLS probe.
const jws = require('../../shared/jws');
const { CODE_STATUS, errorCode, errorStyle } = require('./common');
const { probe } = require('../tls');

async function security(ctx) {
  const { bank, B, rb, call } = ctx;
  const T = ctx.token, cid = (ctx.consents && ctx.consents.full && ctx.consents.full.id) || 'unknown';
  const mapChecks = [];
  const mapIt = (res, expectCodes, label, expectStatus) => { mapChecks.push({ res, label, expectCodes, expectStatus }); };

  // ---- authentication negatives
  const noAuth = await call({ path: `${B}/accounts`, headers: { 'Consent-ID': cid } });
  const bad = await call({ path: `${B}/accounts`, headers: { 'Consent-ID': cid }, token: 'not-a-real-token' });
  const okNoAuth = noAuth.status === 401, okBad = bad.status === 401;
  rb('GE-AUTH-NOANON', okNoAuth && okBad, { testId: 'auth-negative', res: !okNoAuth ? noAuth : bad, expected: 'HTTP 401 for a missing and an invalid bearer token', actual: `missing -> HTTP ${noAuth.status}; invalid -> HTTP ${bad.status}` });
  mapIt(noAuth, ['TOKEN_UNKNOWN', 'TOKEN_INVALID', 'TOKEN_EXPIRED', 'TOKEN_MISSING'], 'missing token'); mapIt(bad, ['TOKEN_UNKNOWN', 'TOKEN_INVALID', 'TOKEN_EXPIRED'], 'invalid token');

  if (!ctx.noData) {
    const accOk = (ctx.accounts || []).length > 0;
    rb('GE-AUTH-OAUTH', okNoAuth && accOk, { testId: 'auth-oauth', res: noAuth, expected: 'business calls require and accept an OAuth2 bearer token', actual: 'anonymous call not rejected, or token not accepted' });
    const noC = await call({ path: `${B}/accounts`, token: T });
    mapIt(noC, ['FORMAT_ERROR'], 'missing Consent-ID');
    const unk = await call({ path: `${B}/accounts`, headers: { 'Consent-ID': '00000000-0000-4000-8000-000000000000' }, token: T });
    mapIt(unk, ['CONSENT_UNKNOWN'], 'unknown Consent-ID header');
    rb('GE-CNS-UNKNOWN', unk.status === 400 && errorCode(unk.json) === 'CONSENT_UNKNOWN', { testId: 'consent-unknown', res: unk, expected: '400 CONSENT_UNKNOWN (Consent-ID in the header)', actual: `HTTP ${unk.status} ${errorCode(unk.json) || ''}` });
    const nf = await call({ path: `${B}/accounts/does-not-exist-0000`, headers: { 'Consent-ID': cid }, token: T });
    mapIt(nf, ['RESOURCE_UNKNOWN'], 'unknown account-id');
    rb('GE-ERR-404', nf.status === 404 && errorCode(nf.json) === 'RESOURCE_UNKNOWN', { testId: 'unknown-account', res: nf, expected: '404 RESOURCE_UNKNOWN', actual: `HTTP ${nf.status} ${errorCode(nf.json) || ''}` });
    const style = errorStyle(nf.json); ctx.obs.push({ bank: bank.id, kind: 'error-format', value: style || 'non-standard' });
    rb('GE-ERR-FORMAT', !!style, { testId: 'error-style', res: nf, expected: 'tppMessages[{category,code}] or problem+json with a BG message code', actual: (nf.bodyText || '').slice(0, 80) });
    const ex = bank.simulated ? await call({ path: `${B}/accounts`, headers: { 'Consent-ID': 'expired-consent' }, token: T }) : null;
    if (ex) mapIt(ex, ['CONSENT_EXPIRED'], 'expired consent');
  }
  // aggregate BG mapping (GE-ERR-MAP / GE-API-HTTPCODES)
  const mism = mapChecks.filter((m) => { const code = errorCode(m.res.json); return !code || !CODE_STATUS[code] || !CODE_STATUS[code].includes(m.res.status) || !m.expectCodes.includes(code); });
  const worst = mism[0];
  rb('GE-ERR-MAP', mism.length === 0, { testId: 'error-map', res: worst && worst.res, expected: 'each error carries the BG message code for the situation and the status that code requires', actual: mism.map((m) => `${m.label}: HTTP ${m.res.status} code ${errorCode(m.res.json) || 'none'}`).slice(0, 4).join('; ') });
  rb('GE-API-HTTPCODES', mism.length === 0, { testId: 'http-codes', res: worst && worst.res, noFinding: true, actual: 'see GE-ERR-MAP' });

  // ---- header hygiene (non-normative best practice)
  const sample = (ctx.accounts && ctx.seen.find((r) => /\/accounts/.test(r.url) && r.status === 200)) || ctx.seen.find((r) => r.status === 200);
  if (sample) {
    const hd = sample.responseHeaders || {}, issues = [];
    if (!/no-store/i.test(hd['cache-control'] || '')) issues.push('Cache-Control: no-store missing');
    if (/\d/.test(hd['server'] || '') || hd['x-powered-by']) issues.push(`version banner exposed (${hd['server'] || hd['x-powered-by']})`);
    rb('GE-SEC-NOCACHE', issues.length === 0, { testId: 'security-headers', res: sample, expected: 'no-store and no version banner', actual: issues.join('; ') });
  }

  // ---- hyperlinks must belong to the ASPSP (GE-SEC-LINKS)
  const host = new URL(bank.baseUrl).hostname.replace(/^127\.0\.0\.1$/, 'localhost');
  const reg = (h) => h.split('.').slice(-2).join('.');
  const foreign = [];
  const walk = (o, res, path = '$') => { if (!o || typeof o !== 'object') return; for (const [k, v] of Object.entries(o)) { if (k === 'href' && typeof v === 'string' && /^https?:\/\//.test(v)) { const h = new URL(v).hostname.replace(/^127\.0\.0\.1$/, 'localhost'); if (h !== host && reg(h) !== reg(host)) foreign.push({ href: v, res }); } else walk(v, res, `${path}.${k}`); } };
  for (const r of ctx.seen) if (r.json) walk(r.json._links || r.json, r);
  rb('GE-SEC-LINKS', foreign.length === 0, { testId: 'links-host', res: foreign[0] && foreign[0].res, expected: `hyperlinks stay on ${host}`, actual: foreign.slice(0, 2).map((f) => f.href).join(', ') });

  // ---- JWS seal on responses: verify every distinct 2xx/4xx response we received
  const verified = [];
  const seenPaths = new Set();
  for (const r of ctx.seen) {
    if (!r.status || !r.responseHeaders || r.networkError || r.timedOut) continue;
    const key = `${r.method} ${r.url.split('?')[0]}|${r.status}`; if (seenPaths.has(key)) continue; seenPaths.add(key);
    const v = jws.verify(r.responseHeaders['x-jws-signature'], { headers: r.responseHeaders, status: r.status, body: r.bodyBuf, kind: 'response', now: r.recvAt });
    verified.push({ r, v });
  }
  const JWS_RULES = ['GE-JWS-HEADER', 'GE-JWS-COMPACT', 'GE-JWS-B64', 'GE-JWS-ALG', 'GE-JWS-X5C', 'GE-JWS-NOX5T', 'GE-JWS-CRIT', 'GE-JWS-SIGT', 'GE-JWS-SKEW', 'GE-JWS-MID', 'GE-JWS-PARS', 'GE-JWS-TYP', 'GE-JWS-DIGEST', 'GE-JWS-VERIFY'];
  for (const rule of JWS_RULES) {
    const hit = verified.find((x) => x.v.violations.some((y) => y.rule === rule));
    const viol = hit && hit.v.violations.find((y) => y.rule === rule);
    rb(rule, !hit, { testId: `jws:${rule}`, res: hit && hit.r, expected: viol && viol.expected, actual: viol && `${viol.actual} (e.g. ${hit.r.method} ${hit.r.url.split('?')[0]}; ${verified.filter((x) => x.v.violations.some((y) => y.rule === rule)).length}/${verified.length} responses)` });
  }
  const sealed = verified.length > 0 && verified.every((x) => x.v.verified && !x.v.violations.some((y) => ['GE-JWS-HEADER', 'GE-JWS-VERIFY', 'GE-JWS-DIGEST'].includes(y.rule)));
  const firstBad = verified.find((x) => !x.v.verified || x.v.violations.some((y) => ['GE-JWS-HEADER', 'GE-JWS-VERIFY', 'GE-JWS-DIGEST'].includes(y.rule)));
  const reqOk = !ctx.sealReq || ctx.sealReq.ok;
  rb('GE-SEC-SEAL', sealed && reqOk, { testId: 'seal', res: !reqOk ? ctx.sealReq.res : firstBad && firstBad.r, expected: 'requests AND responses carry an electronic seal that the receiver verifies', actual: !reqOk ? `ASPSP accepted an unsealed request (${ctx.sealReq.actual})` : firstBad ? `response seal: ${firstBad.v.violations.map((y) => y.rule).join(', ') || 'signature did not verify'}` : 'no responses' });
  rb('GE-JWS-SIGN', sealed, { testId: 'seal-protects', res: firstBad && firstBad.r, noFinding: true, actual: 'see GE-SEC-SEAL' });
  const skewBad = verified.some((x) => x.v.violations.some((y) => y.rule === 'GE-JWS-SKEW'));
  rb('GE-SEC-UTC', !skewBad, { testId: 'utc-skew', noFinding: true, actual: 'see GE-JWS-SKEW' });

  // ---- request ids / header redaction self-check
  const leaked = ctx.seen.some((r) => JSON.stringify(r.requestHeaders || {}).includes(T || '§'));
  ctx.tests.push({ bank: bank.id, testId: 'SEC-redaction', ruleId: 'SEC-REDACT', operation: 'evidence', passed: !leaked, status: leaked ? 'fail' : 'pass', note: leaked ? 'token present in stored evidence' : 'tokens redacted' });

  // ---- transport (https only)
  const t = await probe(bank);
  if (!t) { for (const r of ['GE-SEC-TLS12', 'GE-SEC-MTLS', 'GE-SEC-OCSP']) rb(r, null, { note: 'simulator serves plain HTTP on localhost; not claimed as a pass' }); }
  else {
    rb('GE-SEC-TLS12', t.reachable && /TLSv1\.[23]/.test(t.protocol || '') && !t.oldTlsAccepted, { testId: 'tls', expected: 'TLS 1.2+ negotiated; TLS <= 1.1 refused', actual: `negotiated ${t.protocol}; legacy TLS ${t.oldTlsAccepted ? 'ACCEPTED' : t.oldTlsInconclusive ? 'inconclusive (client cannot attempt)' : 'refused'}` });
    rb('GE-SEC-MTLS', t.reachable && t.mtlsEnforced, { testId: 'mtls', expected: 'connection without a client certificate is refused', actual: 'server answered HTTP without a client certificate' });
    rb('GE-SEC-OCSP', t.stapled, { testId: 'ocsp', severity: 'low', expected: 'OCSP stapling offered (SHOULD)', actual: 'no stapled OCSP response' });
  }
}
module.exports = security;
