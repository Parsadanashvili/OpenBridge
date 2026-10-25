// Consent registration, validation rules, links, lifecycle, request-seal enforcement.
const { OPERATIONS } = require('../../spec/profile');
const { schemaCheck } = require('./schema');
const { errorCode, errorStyle, plusDays } = require('./common');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const START_OK = ['startauthorisation', 'startauthorisationwithpsuidentification', 'startauthorisationwithauthenticationmethodselection', 'startauthorisationwithtransactionauthorisation'];
const ENUM = ['received', 'rejected', 'valid', 'revokedByPsu', 'expired', 'terminatedByTpp', 'partiallyAuthorised'];

async function consent(ctx) {
  const { bank, B, rb, call } = ctx;
  const today = bank.simulated ? '2026-10-25' : new Date().toISOString().slice(0, 10); // simulators run on a fixed reference date
  const base = (over = {}) => ({ access: { availableAccounts: 'allAccounts' }, recurringIndicator: true, validUntil: plusDays(today, 60), frequencyPerDay: 4, combinedServiceIndicator: false, ...over });
  const H = { 'TPP-Redirect-URI': 'https://tpp.example/callback' };
  const post = (body, o = {}) => call({ method: 'POST', path: `${B}/consents`, body, headers: H, token: ctx.token, ...o });
  const env = (k) => process.env[`OB_${bank.id.toUpperCase()}_${k}`];
  ctx.consents = {};

  // ---- registration WITHOUT Authorization (GE-CNS-NOTOKEN) for three scopes
  const kinds = {
    full: { access: { accounts: [], balances: [], transactions: [] } },
    owner: { access: { accounts: [], balances: [], transactions: [], additionalInformation: { ownerName: [] } } },
    avail: { access: { availableAccounts: 'allAccounts' } },
  };
  let first = true;
  for (const [kind, over] of Object.entries(kinds)) {
    const body = base(over);
    let res = await post(body, { token: undefined });
    if (first) {
      const refused = res.status === 401 || res.status === 403;
      rb('GE-CNS-NOTOKEN', !refused, { testId: 'consent-no-token', res, expected: 'consent registration accepted without an Authorization header (201)', actual: `HTTP ${res.status}` });
      first = false;
    }
    if (res.status === 401 || res.status === 403) res = await post(body, { token: ctx.token }); // continue the audit with a token
    ctx.consents[kind] = { body, res, id: res.json && res.json.consentId };
    if (kind === 'full') {
      schemaCheck(ctx, 'consent-create', OPERATIONS.consents, res);
      const links = (res.json && res.json._links) || {}, keys = Object.keys(links);
      const hasOAuth = keys.includes('scaOAuth'), redirectOnly = keys.includes('scaRedirect') && !hasOAuth;
      rb('GE-CNS-OAUTH-REDIRECT', hasOAuth, { testId: 'consent-links', res, key: 'oauth', expected: 'scaOAuth link (redirect authorisation is OAuth2)', actual: redirectOnly ? 'scaRedirect without scaOAuth' : `links: ${keys.join(', ') || 'none'}` });
      const startBad = keys.filter((k) => /^startauthori[sz]ation/i.test(k) && !START_OK.includes(k.toLowerCase()));
      rb('GE-CNS-LINKS', startBad.length === 0, { testId: 'consent-links', res, expected: 'only the four permitted startAuthorisation* links', actual: startBad.join(', ') });
      rb('GE-AUTH-NOCONFIRM', !keys.includes('confirmation'), { testId: 'consent-links', res, expected: 'no confirmation link for OAuth2 redirect', actual: 'confirmation link returned' });
      const ofge = keys.filter((k) => k.startsWith('ofge:'));
      if (ofge.length) { const cur = (links.curies || []).find((c) => c.name === 'ofge'); rb('GE-AUTH-CURIES', !!cur && /openfinance\.ge\/relations\/\{rel\}/.test(cur.href || ''), { testId: 'consent-links', res, expected: 'curies entry ofge -> https://openfinance.ge/relations/{rel}', actual: cur ? JSON.stringify(cur) : `${ofge.join(',')} returned without a curies declaration` }); }
      else rb('GE-AUTH-CURIES', null, { note: 'no ofge:* relation returned' });
      rb('GE-CNS-NOTVALID', String(res.json && res.json.consentStatus).toLowerCase() !== 'valid', { testId: 'consent-status-initial', res, expected: 'consentStatus other than valid before PSU authentication', actual: `consentStatus=${res.json && res.json.consentStatus} with no Authorization token` });
    }
    // authorisation: poll the status service (sandbox PSU approves on the second poll)
    const sid = ctx.consents[kind].id; if (!sid) continue;
    let st = null, last = null;
    for (let i = 0; i < 5; i++) { last = await call({ path: `${B}/consents/${sid}/status`, token: ctx.token }); st = last.json && last.json.consentStatus; if (st === 'valid') break; await sleep(30); }
    ctx.consents[kind].status = st; ctx.consents[kind].statusRes = last;
    if (kind === 'full') rb('GE-CNS-STATUS', last.status === 200 && ENUM.includes(st), { testId: 'consent-status', res: last, expected: 'HTTP 200 with consentStatus from the permitted enumeration', actual: `HTTP ${last.status} consentStatus=${st}` });
  }
  const full = ctx.consents.full;
  const needHuman = !full.id || full.status !== 'valid';
  if (!bank.simulated && env('CONSENT_ID')) { ctx.consents.full = { id: env('CONSENT_ID'), status: 'valid', external: true }; ctx.consents.owner = ctx.consents.avail = ctx.consents.full; }
  else if (needHuman) { ctx.noData = true; ctx.notes.push(`consent not authorised (status ${full.status}); a human SCA approval and OB_${bank.id.toUpperCase()}_CONSENT_ID are required for data tests`); }

  // ---- consent details must echo the registered document (GE-CNS-DETAILS)
  if (full.id && !ctx.noData) {
    const d = await call({ path: `${B}/consents/${full.id}`, token: ctx.token });
    const j = d.json || {}, b = full.body;
    const diffs = []; if (JSON.stringify(j.access) !== JSON.stringify(b.access)) diffs.push('access'); for (const k of ['recurringIndicator', 'frequencyPerDay', 'combinedServiceIndicator']) if (j[k] !== b[k]) diffs.push(k);
    rb('GE-CNS-DETAILS', d.status === 200 && diffs.length === 0, { testId: 'consent-details', res: d, expected: 'registered document returned (only validUntil may differ)', actual: d.status !== 200 ? `HTTP ${d.status}` : `fields differ: ${diffs.join(', ')}` });
  }

  // ---- registration validation (GE-CNS-FIELDS / ONCE / 90D / ALLPSD2 / PSUIP)
  const a = base(); const noCSI = { ...a }; delete noCSI.combinedServiceIndicator;
  const rMissing = await post(noCSI), rStr = await post({ ...a, recurringIndicator: 'true' });
  const rej = (r) => r.status >= 400 && r.status < 500;
  rb('GE-CNS-FIELDS', rej(rMissing) && rej(rStr), { testId: 'consent-required-fields', res: !rej(rMissing) ? rMissing : rStr, expected: 'HTTP 400 for a consent missing combinedServiceIndicator and for recurringIndicator:"true" (string)', actual: `missing field -> HTTP ${rMissing.status}; string boolean -> HTTP ${rStr.status}` });
  const rOnce = await post({ ...a, recurringIndicator: false, frequencyPerDay: 4 });
  rb('GE-CNS-ONCE', rej(rOnce), { testId: 'consent-once', res: rOnce, expected: 'HTTP 4xx (one-off consent needs frequencyPerDay = 1)', actual: `HTTP ${rOnce.status} (registered)` });
  const r90 = await post({ ...a, validUntil: plusDays(today, 120) });
  const r9999 = await post({ ...a, validUntil: '9999-12-31' });
  let clampOk = false, clampActual = `HTTP ${r9999.status}`;
  if (r9999.status === 201 && r9999.json && r9999.json.consentId) { const dd = await call({ path: `${B}/consents/${r9999.json.consentId}`, token: ctx.token }); clampOk = dd.json && dd.json.validUntil <= plusDays(today, 90) && dd.json.validUntil >= today; clampActual = `registered; validUntil returned as ${dd.json && dd.json.validUntil}`; }
  const code90 = errorCode(r90.json);
  rb('GE-CNS-90D', r90.status === 400 && code90 === 'PERIOD_INVALID' && clampOk, { testId: 'consent-90-days', res: r90, expected: '120 days -> 400 PERIOD_INVALID; 9999-12-31 -> accepted and reduced to <= 90 days', actual: `120 days -> HTTP ${r90.status} ${code90 || ''}; 9999-12-31 -> ${clampActual}` });
  const rPsd2 = await post({ ...a, access: { allPsd2: 'allAccounts' } });
  rb('GE-CNS-ALLPSD2', rej(rPsd2), { testId: 'consent-allpsd2', res: rPsd2, expected: 'error for allPsd2 (global consent unsupported)', actual: `HTTP ${rPsd2.status}` });
  const rIp = await post(a, { omitHeaders: ['PSU-IP-Address'] });
  rb('GE-CNS-PSUIP', rej(rIp), { testId: 'consent-psu-ip', res: rIp, expected: 'HTTP 400 without PSU-IP-Address at consent registration', actual: `HTTP ${rIp.status}` });

  // ---- request seal enforced by the ASPSP (GE-SEC-SEAL, request side)
  if (full.id) {
    const unsigned = await call({ path: `${B}/consents/${full.id}/status`, token: ctx.token, unsigned: true });
    const requires = !!bank.requiresJws;
    ctx.sealReq = requires ? { ok: unsigned.status === 401 && errorCode(unsigned.json) === 'SIGNATURE_MISSING', res: unsigned, actual: `unsigned request -> HTTP ${unsigned.status} ${errorCode(unsigned.json) || ''}` } : null;
  }

  // ---- lifecycle: revoke a dedicated consent (GE-CNS-DELETE) - simulators only
  if (bank.simulated) {
    const c = await post(base(kinds.avail)); const id = c.json && c.json.consentId;
    if (id) {
      let st; for (let i = 0; i < 5 && st !== 'valid'; i++) { const s = await call({ path: `${B}/consents/${id}/status`, token: ctx.token }); st = s.json && s.json.consentStatus; }
      const del = await call({ method: 'DELETE', path: `${B}/consents/${id}`, token: ctx.token });
      const after = await call({ path: `${B}/accounts`, headers: { 'Consent-ID': id }, token: ctx.token });
      const s2 = await call({ path: `${B}/consents/${id}/status`, token: ctx.token });
      const ok = del.status === 204 && after.status === 401 && errorCode(after.json) === 'CONSENT_INVALID' && (s2.json && s2.json.consentStatus) === 'revokedByPsu';
      rb('GE-CNS-DELETE', ok, { testId: 'consent-revoke', res: after, expected: 'DELETE 204; then 401 CONSENT_INVALID; status revokedByPsu', actual: `DELETE HTTP ${del.status}; then HTTP ${after.status} ${errorCode(after.json) || ''}; status ${s2.json && s2.json.consentStatus}` });
    }
  } else rb('GE-CNS-DELETE', null, { note: 'skipped on real banks: would revoke a consent of a real test customer' });
}
module.exports = consent;
