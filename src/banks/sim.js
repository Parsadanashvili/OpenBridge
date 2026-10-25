// Synthetic bank server (zero deps). Deterministic: seeded PRNG + generated customers (datagen.js).
// Default behaviour follows the Georgian XS2A rules (src/spec/rulebook.js); profiles.js lists the deliberate deviations.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PROFILES } = require('./profiles');
const { buildBankData, money, mk, makeIban, TODAY } = require('./datagen');
const jws = require('../shared/jws');

const SIGN_KEY = fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'test-signing', 'key.pem'), 'utf8');
const SIGN_CERT = fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'test-signing', 'cert.pem'), 'utf8');
const CERT_DNS = String(new crypto.X509Certificate(SIGN_CERT).subjectAltName || '').split(/,\s*/).filter((x) => x.startsWith('DNS:')).map((x) => x.slice(4));
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function startBank(profile, { quiet = false } = {}) {
  const q = profile.quirks || {};
  const rnd = mulberry32(profile.port);
  const customers = buildBankData(profile);
  const consents = new Map();
  const issued = new Set(); let tokSeq = 0;
  let consentSeq = 0;
  const HOST = `127.0.0.1:${profile.port}`;

  // multicurrency: sub-accounts share ONE iban (GEL/USD/...) plus an aggregated XXX record with its own resourceId
  if (q.multicurrencyAccount) for (const c of customers) {
    const sub = c.accounts.filter((a) => ['GEL', 'USD', 'EUR'].includes(a.currency));
    if (sub.length >= 2 && !c.accounts.some((a) => a.currency === 'XXX')) {
      sub.forEach((s) => { s.iban = sub[0].iban; });
      c.accounts.push({ resourceId: sub[0].resourceId.replace(/.$/, 'x'), iban: sub[0].iban, currency: 'XXX', name: 'Multicurrency account', product: 'Multicurrency Account', cashAccountType: 'CACC', bic: sub[0].bic, ownerName: sub[0].ownerName, displayName: 'მულტივალუტური', multi: sub,
        tx: sub.flatMap((a) => a.tx).sort((x, y) => (x.ts < y.ts ? -1 : 1)), closingBookedT: 0, interimAvailableT: 0 });
    }
  }
  const rid = (a) => (q.leakIbanInResourceId && a.name !== 'Current account' && !a.multi ? a.iban : a.resourceId);

  const amt = (t) => (q.amountAsNumber ? t / 100 : money(t));
  const fmtDate = (iso) => { if (!iso) return undefined; const [y, m, d] = iso.split('-'); return q.bookingDateFormat === 'DD.MM.YYYY' ? `${d}.${m}.${y}` : iso; };

  // ------------------------------------------------------------------ response plumbing (+ JWS seal)
  const send = (res, req, status, bodyObj, extra = {}) => {
    const bodyStr = bodyObj === undefined ? '' : JSON.stringify(bodyObj);
    const headers = { ...extra };
    if (bodyObj !== undefined) headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    if (!q.noCacheControl) headers['Cache-Control'] = 'no-store';
    if (q.leakServerHeader) headers['Server'] = 'Express/4.17.1';
    if (!q.noContentLanguage) headers['Content-Language'] = /^en/i.test(req.headers['accept-language'] || '') ? 'en' : 'ka';
    if (req.headers['x-request-id'] && !q.noRequestIdEcho) headers['X-Request-ID'] = req.headers['x-request-id'];
    if (q.signResponses) {
      const d = q.jwsDefects || {};
      const body = Buffer.from(bodyStr);
      headers['Digest'] = d.wrongDigest ? jws.sha('SHA-256', Buffer.from('')) : jws.sha('SHA-256', body);
      const lc = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
      const pars = ['(response-status)']; if (lc['content-type']) pars.push('content-type'); pars.push('digest'); if (lc['x-request-id']) pars.push('x-request-id');
      headers['x-jws-signature'] = jws.sign({ keyPem: SIGN_KEY, certPem: SIGN_CERT, pars, headers: lc, status, sigT: d.fractionalSigT ? new Date().toISOString() : undefined, overrides: d.lowercaseTyp ? { typ: 'jose' } : {} });
    }
    res.writeHead(status, headers);
    res.end(bodyStr);
  };
  const err = (res, req, status, code, text) => {
    if (q.errorShape === 'flat') return send(res, req, status, { error: code, message: text });
    if (q.errorShape === 'problem') return send(res, req, status, { type: `https://sim.example/errors/${code}`, title: text.slice(0, 60), status, detail: text, instance: req.url.split('?')[0], traceId: crypto.randomUUID(), code }, { 'Content-Type': status === 404 ? 'application/json' : 'application/problem+json' });
    return send(res, req, status, { tppMessages: [{ category: 'ERROR', code, text }] });
  };

  // ------------------------------------------------------------------ consent scope (refs by iban[/currency])
  const refMatch = (ref, a) => ref.iban === a.iban && (a.currency === 'XXX' ? (!ref.currency || q.aggregatedAlways) : (!ref.currency || ref.currency === a.currency));
  const inScope = (list, a) => list === 'all' || (Array.isArray(list) && list.some((r) => refMatch(r, a)));
  function scopeOf(body) {
    const a = body.access || {};
    if (a.availableAccounts || a.availableAccountsWithBalance) {
      return { listOnly: true, accounts: 'all', balances: a.availableAccountsWithBalance ? 'all' : 'none', transactions: 'none', owner: [a.availableAccounts, a.availableAccountsWithBalance].includes('allAccountsWithOwnerName') };
    }
    const k = (x) => (Array.isArray(x) ? (x.length ? x : 'all') : 'none'); // [] = the PSU selects accounts in the bank (sandbox: all)
    return { listOnly: false, accounts: k(a.accounts), balances: k(a.balances), transactions: k(a.transactions), owner: !!(a.additionalInformation && Array.isArray(a.additionalInformation.ownerName)) };
  }
  const visible = (scope, a) => scope.listOnly || inScope(scope.accounts, a) || inScope(scope.balances, a) || inScope(scope.transactions, a);

  // ------------------------------------------------------------------ views
  const nowZ = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  function balancesFor(a, mode) {
    if (a.multi) return a.multi.flatMap((m) => balancesFor(m, mode));
    const cur = a.currency, lastTs = (a.lastBookedTs || '2026-10-24T18:00:00') + 'Z';
    const tsFix = (z) => (q.balanceTimestampNoTz ? z.replace('Z', '') : z);
    const b = (type, t, extra) => ({ balanceType: type, balanceAmount: { currency: cur, amount: amt(t) }, ...extra });
    const booked = (type) => b(type, a.closingBookedT, q.noBalanceDates ? {} : { referenceDate: TODAY });
    const interim = (type, t) => b(type, t, q.noBalanceDates ? {} : { lastChangeDateTime: tsFix(type === 'interimBooked' ? lastTs : '2026-10-25T08:30:00Z') });
    if (q.balancesOnlyClosing) return [booked('closingBooked')];
    if (mode === 'balances') return [booked('closingBooked'), interim('interimAvailable', a.interimAvailableT)];
    return [interim('interimAvailable', a.interimAvailableT), interim('interimBooked', a.closingBookedT)];
  }
  function accountView(a, mode, scope, withBalance) {
    const o = { resourceId: rid(a), iban: a.iban, currency: a.currency };
    if (!q.noName) { o.name = a.name; o.displayName = a.displayName; }
    o.product = a.product; o.cashAccountType = q.savingsCashType && a.name === 'USD savings' ? q.savingsCashType : a.cashAccountType; o.bic = a.bic;
    if (scope.owner || q.ownerAlways) o.ownerName = a.ownerName;
    const links = {};
    if (inScope(scope.balances, a) || q.overshare) links.balances = { href: `/0.8/v1/accounts/${rid(a)}/balances` };
    if (inScope(scope.transactions, a) || q.overshare) links.transactions = { href: `/0.8/v1/accounts/${rid(a)}/transactions` };
    o._links = links;
    if ((withBalance && inScope(scope.balances, a)) || q.alwaysBalances) o.balances = balancesFor(a, mode);
    if (mode === 'list' && q.listMissingBicAndType) delete o.bic;
    if (mode === 'details' && q.detailsMissingProduct) delete o.product;
    if (q.leakBban) o.bban = a.iban.slice(4);
    if (mode === 'list' && q.detailsFieldInList) o.details = 'account information';
    return o;
  }
  const partyOf = (t, out) => {
    if (!t.party) return {};
    const key = out ? 'creditorIdentification' : 'debtorIdentification';
    if (q.partyIdFlat) return { [key]: t.party.id };
    return { [key]: t.party.org ? { organisationId: { others: [{ identification: t.party.id }] } } : { privateId: { others: [{ identification: t.party.id }] } } };
  };
  const chunks = (s, n) => { const out = []; for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n)); return out; };
  const effStatus = (t) => (q.todayTransfersPending && t.status === 'booked' && t.type !== 'card' && t.valueDate === TODAY ? 'pending' : t.status);
  const txView = (t, detail = false) => {
    const out = t.amountT < 0, isTransfer = !!t.cpIban && t.type !== 'card';
    let remit = t.remit; if (q.mangleGeorgian) remit = remit.replace(/[ა-ჿ]/g, '?');
    const v = { entryReference: t.entryReference, transactionAmount: { currency: t.currency, amount: amt(t.amountT) }, valueDate: fmtDate(t.valueDate), bookingDate: fmtDate(t.bookingDate), bankTransactionCode: t.btc };
    if (detail) v.remittanceInformationUnstructuredArray = chunks(remit, 140); else v.remittanceInformationUnstructured = remit.slice(0, 140);
    v.transactionId = q.noDetailsService ? `BTX-${t.entryReference}` : t.entryReference;
    if (t.mcc) v.merchantCategoryCode = t.mcc;
    if (t.cp) { if (out) { v.creditorName = t.cp; if (isTransfer) v.creditorAccount = { iban: t.cpIban }; } else { v.debtorName = t.cp; if (isTransfer && !q.noCounterpartyAcct) v.debtorAccount = { iban: t.cpIban }; } }
    if (isTransfer) Object.assign(v, partyOf(t, out));
    if (t.fx && !q.dropFx) v.currencyExchange = [{ sourceCurrency: t.fx.from, targetCurrency: t.fx.to, exchangeRate: String(Math.round(t.fx.rate * 10000) / 10000), quotationDate: t.valueDate }];
    if (!v.bookingDate) delete v.bookingDate;
    return v;
  };
  const maxUntil = () => addDays(TODAY, 90);

  function validateConsent(b) {
    if (q.lenientConsentBody) return (!b.access || !b.validUntil) ? 'access and validUntil are required' : null;
    for (const k of ['access', 'recurringIndicator', 'validUntil', 'frequencyPerDay', 'combinedServiceIndicator']) if (b[k] === undefined) return { code: 'FORMAT_ERROR', text: `${k} is required` };
    if (typeof b.recurringIndicator !== 'boolean' || typeof b.combinedServiceIndicator !== 'boolean') return { code: 'FORMAT_ERROR', text: 'recurringIndicator/combinedServiceIndicator must be boolean' };
    if (!Number.isInteger(b.frequencyPerDay) || b.frequencyPerDay < 1 || b.frequencyPerDay > 4) return { code: 'FORMAT_ERROR', text: 'frequencyPerDay must be an integer 1..4' };
    if (b.recurringIndicator === false && b.frequencyPerDay !== 1) return { code: 'FORMAT_ERROR', text: 'one-off consent requires frequencyPerDay = 1' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.validUntil)) return { code: 'FORMAT_ERROR', text: 'validUntil must be a date' };
    if (b.access.allPsd2) return { code: 'SERVICE_INVALID', text: 'allPsd2 is not supported' };
    if (b.validUntil !== '9999-12-31' && b.validUntil > maxUntil()) return { code: 'PERIOD_INVALID', text: 'validUntil is more than 90 days ahead' };
    const arrs = ['accounts', 'balances', 'transactions'].map((k) => b.access[k]).filter(Array.isArray);
    if (!q.acceptsMixedArrays && arrs.some((x) => x.length) && arrs.some((x) => !x.length)) return { code: 'FORMAT_ERROR', text: 'an empty array must not be combined with attributes that list accounts' };
    return null;
  }

  // ------------------------------------------------------------------ server
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const delay = profile.latency[0] + rnd() * (profile.latency[1] - profile.latency[0]);
    const chunksIn = [];
    req.on('data', (c) => chunksIn.push(c));
    req.on('end', () => setTimeout(() => handle(req, res, url, Buffer.concat(chunksIn)), delay));
  });

  function handle(req, res, url, rawBuf) {
    const raw = rawBuf.toString('utf8');
    const p = url.pathname;
    if (p === '/oauth/token' && req.method === 'POST') { const t = `sim-token-${profile.key}-${++tokSeq}`; issued.add(t); return send(res, req, 200, { access_token: t, token_type: 'Bearer', expires_in: 3600 }); }
    if (p === '/oauth/.well-known/oauth-authorization-server') return send(res, req, 200, { issuer: `http://${HOST}/oauth`, authorization_endpoint: `http://${HOST}/oauth/authorize`, token_endpoint: `http://${HOST}/oauth/token` });
    if (!p.startsWith('/0.8/v1/')) return err(res, req, 404, 'RESOURCE_UNKNOWN', 'unknown path');
    const sub = p.slice('/0.8/v1'.length);

    // request seal (GE-SEC-SEAL): the compliant bank verifies it
    if (q.requireSignedRequests) {
      const lc = req.headers;
      const sig = lc['x-jws-signature'];
      if (!sig) return err(res, req, 401, 'SIGNATURE_MISSING', 'x-jws-signature header is mandatory');
      const v = jws.verify(sig, { headers: lc, method: req.method, path: req.url, body: rawBuf, kind: 'request' });
      if (v.violations.length) return err(res, req, 401, 'SIGNATURE_INVALID', `signature invalid: ${v.violations.map((x) => x.rule).join(',')}`);
    }
    if (q.enforceRequestId && !/^[0-9a-f-]{36}$/i.test(req.headers['x-request-id'] || '')) return err(res, req, 400, 'FORMAT_ERROR', 'X-Request-ID header (UUID) is mandatory');
    // GE JWS 5.2: encodings must be agreed; identity must stay acceptable (SHOULD refuse with 400)
    if (!q.ignoresEncodingRules && /(^|,)\s*(identity|\*)\s*;\s*q=0(\.0*)?\s*(,|$)/i.test(req.headers['accept-encoding'] || '')) return err(res, req, 400, 'FORMAT_ERROR', 'identity content encoding must remain acceptable');

    const auth = req.headers['authorization'] || '';
    const bearer = auth.replace(/^Bearer /, '');
    const tokenOk = auth.startsWith('Bearer ') && issued.has(bearer);
    const unauth = () => err(res, req, q.unauthStatus || 401, auth ? 'TOKEN_INVALID' : 'TOKEN_MISSING', 'access token missing or invalid');

    // ---- consent registration: Authorization is optional (GE 9.2.1)
    if (sub === '/consents' && req.method === 'POST') {
      if (q.consentNeedsToken && !tokenOk) return unauth();
      if (auth && !tokenOk) return unauth();
      if (!req.headers['psu-ip-address']) return err(res, req, 400, 'FORMAT_ERROR', 'PSU-IP-Address header is mandatory on consent registration');
      const ru = req.headers['tpp-redirect-uri'];
      if (ru && !q.acceptsAnyRedirectUri) { let h; try { h = new URL(ru).hostname; } catch { h = null; } if (!h || !CERT_DNS.includes(h)) return err(res, req, 400, 'FORMAT_ERROR', 'TPP-Redirect-URI does not match the TPP certificate (CN/SAN)'); }
      let body; try { body = JSON.parse(raw || '{}'); } catch { return err(res, req, 400, 'FORMAT_ERROR', 'invalid JSON'); }
      const bad = validateConsent(body); if (bad) return typeof bad === 'string' ? err(res, req, 400, 'FORMAT_ERROR', bad) : err(res, req, 400, bad.code, bad.text);
      const id = crypto.randomUUID();
      const validUntil = body.validUntil === '9999-12-31' ? maxUntil() : body.validUntil;
      const decoupled = !q.noDecoupled && String(req.headers['tpp-redirect-preferred']) === 'false' && String(req.headers['tpp-decoupled-preferred']) === 'true';
      const c = { customer: customers[consentSeq++ % customers.length], body, validUntil, scope: scopeOf(body), status: q.consentValidImmediately ? 'valid' : 'received', polls: 0, createdAt: TODAY, decoupled, auths: [], reqs: [], boundToken: null };
      consents.set(id, c);
      let links;
      if (decoupled) links = { startAuthorisation: { href: `/0.8/v1/consents/${id}/authorisations` }, self: { href: `/0.8/v1/consents/${id}` }, status: { href: `/0.8/v1/consents/${id}/status` } };
      else if (q.consentLinksRedirect) links = { scaRedirect: { href: `http://tracking.example.net/r/${id}` }, confirmation: { href: `/0.8/v1/consents/${id}/confirm` }, 'ofge:psuPreOAuth': { href: `http://${HOST}/oauth/.well-known/oauth-authorization-server` }, self: { href: `/0.8/v1/consents/${id}` }, status: { href: `/0.8/v1/consents/${id}/status` } };
      else links = { scaOAuth: { href: `http://${HOST}/oauth/.well-known/oauth-authorization-server` }, self: { href: `/0.8/v1/consents/${id}` }, status: { href: `/0.8/v1/consents/${id}/status` } };
      return send(res, req, 201, { consentStatus: q.consentStatusUpper ? c.status.toUpperCase() : c.status, consentId: id, _links: links }, { Location: `/0.8/v1/consents/${id}` });
    }

    const cm = sub.match(/^\/consents\/([^/]+)(\/status|\/authorisations(?:\/([^/]+))?)?$/);
    if (cm) {
      const c = consents.get(cm[1]);
      if (!c) return err(res, req, 403, 'CONSENT_UNKNOWN', 'consent unknown');
      const tail = cm[2] || '';
      if (req.method === 'DELETE' && !tail) { c.status = 'revokedByPsu'; return send(res, req, 204, undefined); }
      if (req.method === 'GET' && tail === '/status') { // sandbox: the PSU approves on the 2nd poll (not for decoupled consents)
        if (c.status === 'received' && !c.decoupled && ++c.polls >= 2) { c.status = 'valid'; if (tokenOk) c.boundToken = bearer; }
        return send(res, req, 200, { consentStatus: c.status });
      }
      if (tail.startsWith('/authorisations')) { // authorisation resources (IAA 6.4; payloads per Berlin Group 6.3)
        const aid = cm[3];
        if (req.method === 'POST' && !aid) {
          if (c.auths.length >= 2 && !q.unlimitedAuthorisations) return err(res, req, 409, 'STATUS_INVALID', 'no further authorisation resource may be created');
          const a = { id: crypto.randomUUID(), scaStatus: 'received' }; c.auths.push(a);
          return send(res, req, 201, { scaStatus: a.scaStatus, authorisationId: a.id, psuMessage: 'Confirm the operation in your internet bank', _links: { scaStatus: { href: `/0.8/v1/consents/${cm[1]}/authorisations/${a.id}` } } });
        }
        if (req.method === 'GET' && !aid) return send(res, req, 200, { authorisationIds: c.auths.map((a) => a.id) });
        const a = c.auths.find((x) => x.id === aid); if (!a) return err(res, req, 404, 'RESOURCE_UNKNOWN', 'authorisation unknown');
        if (req.method === 'GET') return send(res, req, 200, { scaStatus: a.scaStatus });
        if (req.method === 'PUT') {
          let b; try { b = JSON.parse(raw || '{}'); } catch { return err(res, req, 400, 'FORMAT_ERROR', 'invalid JSON'); }
          if (b.scaAuthenticationData !== '123456') { a.scaStatus = 'failed'; return err(res, req, 401, 'PSU_CREDENTIALS_INVALID', 'wrong authentication data'); }
          a.scaStatus = 'finalised'; c.status = 'valid'; if (tokenOk) c.boundToken = bearer;
          return send(res, req, 200, { scaStatus: a.scaStatus });
        }
      }
      if (req.method === 'GET' && !tail) {
        const b = c.body;
        const out = q.consentDetailsAltered ? { access: { availableAccounts: 'allAccounts' }, recurringIndicator: true, validUntil: c.validUntil, frequencyPerDay: 4, combinedServiceIndicator: false, lastActionDate: TODAY, consentStatus: c.status }
          : { access: b.access, recurringIndicator: b.recurringIndicator, validUntil: c.validUntil, frequencyPerDay: b.frequencyPerDay, combinedServiceIndicator: b.combinedServiceIndicator, lastActionDate: TODAY, consentStatus: c.status };
        return send(res, req, 200, out);
      }
    }

    // ---- everything below needs a token and a usable consent
    if (!tokenOk) return unauth();
    const consentId = req.headers['consent-id'];
    if (!consentId) return err(res, req, 400, 'FORMAT_ERROR', 'Consent-ID header missing');
    if (consentId === 'expired-consent') return err(res, req, 401, 'CONSENT_EXPIRED', 'consent expired');
    const c = consents.get(consentId);
    if (!c) return err(res, req, q.consentUnknown401 ? 401 : 400, 'CONSENT_UNKNOWN', 'consent unknown');
    if (c.status === 'revokedByPsu' && !q.ignoresRevocation) return err(res, req, 401, 'CONSENT_INVALID', 'consent revoked');
    if (c.status !== 'valid' && c.status !== 'revokedByPsu') return err(res, req, 401, 'CONSENT_INVALID', 'consent not yet authorised by the PSU');
    if (!q.noTokenBinding && c.boundToken && c.boundToken !== bearer) return err(res, req, 401, 'TOKEN_INVALID', 'token differs from the one used when the consent was confirmed');
    if (!q.noFrequencyLimit && !req.headers['psu-ip-address']) { // frequencyPerDay limits TPP-initiated access only (GE 9.1.1.6)
      const now = Date.now(); c.reqs = c.reqs.filter((t) => now - t < 864e5);
      if (c.reqs.length >= c.body.frequencyPerDay) return err(res, req, 429, 'ACCESS_EXCEEDED', 'frequencyPerDay exceeded for TPP-initiated requests');
      c.reqs.push(now);
    }
    const scope = c.scope, cust = c.customer;
    const withBal = url.searchParams.get('withBalance') === 'true';
    const insufficient = (what) => (!q.overshare && what ? err(res, req, 401, 'CONSENT_INVALID', 'consent does not cover this request') : null);

    if (sub === '/accounts' && req.method === 'GET') {
      if (withBal && scope.balances === 'none' && !q.overshare) return err(res, req, 401, 'CONSENT_INVALID', 'consent does not cover balances');
      return send(res, req, 200, { accounts: cust.accounts.filter((a) => visible(scope, a)).map((a) => accountView(a, 'list', scope, withBal)) });
    }
    const m = sub.match(/^\/accounts\/([^/]+)(\/balances|\/transactions(?:\/([^/]+))?)?$/);
    const acc = m && cust.accounts.find((a) => rid(a) === m[1] && (visible(scope, a) || q.overshare));
    if (!m || !acc) return err(res, req, 404, 'RESOURCE_UNKNOWN', 'account not found');
    if (profile.failRate && rnd() < profile.failRate) return err(res, req, 500, 'INTERNAL_ERROR', 'simulated server fault');
    if (!m[2]) {
      if (withBal && !inScope(scope.balances, acc) && !q.overshare) return err(res, req, 401, 'CONSENT_INVALID', 'consent does not cover balances');
      return send(res, req, 200, { account: accountView(acc, 'details', scope, withBal) });
    }
    if (m[2] === '/balances') {
      const r = insufficient(!inScope(scope.balances, acc)); if (r !== null) return r;
      const out = { balances: balancesFor(acc, 'balances') }; if (!q.noBalanceAccount) out.account = { iban: acc.iban, currency: acc.currency };
      return send(res, req, 200, out);
    }

    // ---- transactions
    { const r = insufficient(!inScope(scope.transactions, acc)); if (r !== null) return r; }
    if (m[3]) { // GE 9.3.7 transaction details
      if (q.noDetailsService) return err(res, req, 404, 'RESOURCE_UNKNOWN', 'transaction details service not available');
      const t = acc.tx.find((x) => x.entryReference === m[3]);
      if (!t) return err(res, req, 404, 'RESOURCE_UNKNOWN', 'transaction unknown');
      return send(res, req, 200, { transactionsDetails: txView(t, true) });
    }
    const status = url.searchParams.get('bookingStatus') || 'booked';
    if (!['booked', 'pending', 'both', 'information'].includes(status)) return err(res, req, 400, 'PARAMETER_NOT_SUPPORTED', 'bookingStatus value unknown');
    if (status === 'both' && q.bothUnsupported) return err(res, req, 400, 'PARAMETER_NOT_SUPPORTED', 'bookingStatus=both is not supported');
    const from = q.ignoresDateFilter ? null : url.searchParams.get('dateFrom'), to = q.ignoresDateFilter ? null : url.searchParams.get('dateTo');
    const size = profile.pageSize;
    const minDate = q.limitHistory ? addDays(TODAY, -90) : null;
    let booked = acc.tx.filter((t) => effStatus(t) === 'booked' && (!from || t.bookingDate >= from) && (!to || t.bookingDate <= to) && (!minDate || t.bookingDate >= minDate));
    const desc = !!q.sortByValueDate || profile.key === 'beta';
    booked.sort((a, b) => { const ka = q.sortByValueDate ? a.valueDate : a.bookingDate, kb = q.sortByValueDate ? b.valueDate : b.bookingDate; const cmp = ka === kb ? (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0) : ka < kb ? -1 : 1; return desc ? -cmp : cmp; });
    const ref = url.searchParams.get('entryReferenceFrom');
    if (ref === 'cancelled-booked-ref' && !q.cancelledRefIgnored) return err(res, req, 400, 'PARAMETER_NOT_CONSISTENT', 'the referenced booked entry was cancelled');
    if (ref && !q.noEntryRefFrom && ref !== 'cancelled-pending-ref') { const i = booked.findIndex((t) => t.entryReference === ref); if (i >= 0) booked = booked.slice(i + 1); }
    let page = 1, slice, hasNext;
    if (profile.key === 'beta') {
      page = Math.max(1, Number(url.searchParams.get('page') || 1));
      const start = (page - 1) * size - (q.pageOverlap && page > 1 ? 1 : 0);
      slice = booked.slice(start, start + size + (q.pageOverlap && page > 1 ? 1 : 0)); hasNext = page * size < booked.length;
    } else { slice = booked.slice(0, size); hasNext = booked.length > size; }
    const wantBooked = status !== 'pending', wantPending = status !== 'booked';
    const tx = {};
    if (wantBooked) tx.booked = status === 'information' ? [] : slice.map((t) => txView(t));
    if (wantPending) tx.pending = (page === 1 || profile.key !== 'beta') ? acc.tx.filter((t) => effStatus(t) === 'pending').map((t) => txView(t)) : [];
    const links = { account: { href: `/0.8/v1/accounts/${rid(acc)}` } };
    const strip = (u) => { const x = new URL(u, 'http://x'); x.searchParams.delete('entryReferenceFrom'); x.searchParams.delete('page'); return x.pathname + x.search; };
    if (!q.noFirstLink) links.first = { href: strip(req.url) };
    if (hasNext && wantBooked) {
      const u = new URL(req.url, 'http://x');
      if (profile.key === 'beta') u.searchParams.set('page', String(page + 1)); else u.searchParams.set('entryReferenceFrom', slice[slice.length - 1].entryReference);
      links.next = { href: u.pathname + u.search };
    }
    tx._links = links;
    const out = { account: { iban: acc.iban, currency: acc.currency }, transactions: tx };
    if (inScope(scope.balances, acc) && !q.noTxBalances && status !== 'information') {
      const bal = []; const cur = acc.currency;
      const earlier = from ? acc.tx.filter((t) => t.status === 'booked' && t.bookingDate < from).at(-1) : null;
      if (from) bal.push({ balanceType: 'openingBooked', balanceAmount: { currency: cur, amount: amt(earlier ? earlier.runT : acc.openingT) }, referenceDate: addDays(from, -1) });
      bal.push({ balanceType: 'interimBooked', balanceAmount: { currency: cur, amount: amt(acc.closingBookedT) }, lastChangeDateTime: nowZ() });
      bal.push({ balanceType: 'interimAvailable', balanceAmount: { currency: cur, amount: amt(acc.interimAvailableT) }, lastChangeDateTime: nowZ() });
      out.balances = bal;
    }
    return send(res, req, 200, out);
  }

  return new Promise((resolve) => server.listen(profile.port, '127.0.0.1', () => {
    if (!quiet) console.log(`[sim] ${profile.name} :${profile.port} · ${customers.length} synthetic customers · ${customers.reduce((s, x) => s + x.txnCount, 0)} transactions`);
    server.customers = customers;
    resolve(server);
  }));
}

async function startAll(opts) { return Promise.all(Object.values(PROFILES).map((p) => startBank(p, opts))); }

module.exports = { startBank, startAll };
if (require.main === module) startAll();
