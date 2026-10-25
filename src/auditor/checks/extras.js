// Rules added in the second pass: encoding, language, PartyIdentification, empty/mixed arrays, token binding, frequencyPerDay,
// redirect-URI binding, multicurrency scope, currencyExchange, transaction details/transactionId, same-day bookings,
// PARAMETER_NOT_CONSISTENT, decoupled authorisation resources and their limit.
const { errorCode, plusDays, isoDate } = require('./common');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function extras(ctx) {
  const { bank, B, rb, call } = ctx;
  const T = ctx.token, full = ctx.consents.full;
  const today = bank.simulated ? '2026-10-25' : new Date().toISOString().slice(0, 10);
  const HC = { 'Consent-ID': full.id };
  const body = (access, over = {}) => ({ access, recurringIndicator: true, validUntil: plusDays(today, 60), frequencyPerDay: 4, combinedServiceIndicator: false, ...over });
  const post = (b, headers = {}) => call({ method: 'POST', path: `${B}/consents`, body: b, headers: { 'TPP-Redirect-URI': 'https://tpp.example/callback', ...headers }, token: T });
  const authorise = async (id) => { let st; for (let i = 0; i < 5 && st !== 'valid'; i++) { const s = await call({ path: `${B}/consents/${id}/status`, token: T }); st = s.json && s.json.consentStatus; if (st !== 'valid') await sleep(20); } return st; };
  const SIM = !!bank.simulated;
  const simOnly = (rule, why) => rb(rule, null, { note: why || 'needs simulator-only fixtures (special ids / consent quota) - not run against a real bank' });

  // ---- GE-JWS-ENCODING: identity must stay acceptable; no unrequested Content-Encoding
  const enc = await call({ path: `${B}/accounts`, headers: { ...HC, 'Accept-Encoding': 'identity;q=0' }, token: T });
  const encoded = ctx.seen.filter((r) => r.responseHeaders && r.responseHeaders['content-encoding']);
  rb('GE-JWS-ENCODING', enc.status === 400 && encoded.length === 0, { testId: 'content-encoding', res: enc, expected: 'Accept-Encoding without identity refused (400); no Content-Encoding the TPP did not ask for', actual: `identity;q=0 -> HTTP ${enc.status}; ${encoded.length} response(s) with Content-Encoding` });

  // ---- GE-API-LANG
  const en = await call({ path: `${B}/accounts`, headers: { ...HC, 'Accept-Language': 'en' }, token: T });
  const def = ctx.seen.find((r) => r.status === 200 && /\/accounts/.test(r.url));
  rb('GE-API-LANG', !!(def && def.responseHeaders['content-language']) && /^en/.test(en.responseHeaders && en.responseHeaders['content-language'] || ''), { testId: 'content-language', res: en, expected: 'Content-Language returned (Georgian by default, Accept-Language honoured)', actual: `default: ${def && def.responseHeaders['content-language'] || 'none'}; Accept-Language en -> ${en.responseHeaders && en.responseHeaders['content-language'] || 'none'}` });

  // ---- GE-API-PARTYID
  const items = ctx.txItems || [];
  const ids = items.flatMap((t) => ['debtorIdentification', 'creditorIdentification'].filter((k) => k in t).map((k) => ({ k, v: t[k] })));
  const idOk = (v) => { const o = v && (v.organisationId || v.privateId); const id = o && o.others && o.others[0] && o.others[0].identification; return !!id && (v.organisationId ? /^NTRGE-\w+$/.test(id) : /^(PNO|PAS|IDC)GE-\w+$/.test(id)); };
  const badIds = ids.filter((x) => !idOk(x.v));
  rb('GE-API-PARTYID', ids.length ? badIds.length === 0 : null, { testId: 'party-identification', jsonPath: `$.transactions.booked[].${(badIds[0] || {}).k || 'debtorIdentification'}`, expected: '{organisationId|privateId:{others:[{identification:"NTRGE-…|PNOGE-…"}]}}', actual: badIds.length ? `${badIds.length} identifiers in another layout, e.g. ${JSON.stringify(badIds[0].v)}` : '', note: 'no PartyIdentification fields returned' });

  // ---- GE-CNS-EMPTYARR: [] needs SCA (no immediate valid + an authorisation link) and must not be mixed with listed accounts
  const fr = full.res && full.res.json || {};
  const linkKeys = Object.keys(fr._links || {});
  const ibanAcc = (ctx.accounts || []).find((a) => a.iban);
  const mixed = ibanAcc ? await post(body({ accounts: [{ iban: ibanAcc.iban }], balances: [] })) : null;
  const scaOk = String(fr.consentStatus || '').toLowerCase() !== 'valid' && linkKeys.some((k) => /^(scaOAuth|scaRedirect|startAuthori[sz]ation)/i.test(k));
  rb('GE-CNS-EMPTYARR', scaOk && (!mixed || (mixed.status >= 400 && mixed.status < 500)), { testId: 'consent-empty-arrays', res: !scaOk ? full.res : mixed, expected: 'empty arrays -> PSU authentication required; [] not combined with listed accounts (4xx)', actual: !scaOk ? `consentStatus ${fr.consentStatus}; links ${linkKeys.join(',')}` : `mixed arrays -> HTTP ${mixed && mixed.status}` });

  // ---- GE-CNS-REDIRECT-URI: redirect target must match the TPP certificate
  const evil = await post(body({ availableAccounts: 'allAccounts' }), { 'TPP-Redirect-URI': 'https://evil.example/cb' });
  rb('GE-CNS-REDIRECT-URI', evil.status >= 400 && evil.status < 500, { testId: 'redirect-uri-binding', res: evil, expected: 'TPP-Redirect-URI whose host is not in the TPP certificate CN/SAN is refused', actual: `HTTP ${evil.status} (accepted https://evil.example/cb)` });

  // ---- GE-CNS-HEADERS: token must be the one used when the consent was confirmed
  if (SIM && bank.tokenUrl) {
    const t2 = await call({ method: 'POST', path: new URL(bank.tokenUrl).pathname, body: { grant_type: 'client_credentials' }, unsigned: true });
    const tok2 = t2.json && t2.json.access_token;
    const other = await call({ path: `${B}/accounts`, headers: HC, token: tok2 });
    rb('GE-CNS-HEADERS', other.status === 401, { testId: 'token-binding', res: other, expected: 'a different (valid) token for the same consent is refused with 401', actual: `HTTP ${other.status}` });
  } else simOnly('GE-CNS-HEADERS', 'needs a second token for the same consent (OAuth flow) - not available for real banks yet');

  // ---- GE-CNS-FREQ: TPP-initiated calls limited per 24 h, PSU-present calls never
  if (SIM) {
    const c = await post(body({ availableAccounts: 'allAccounts' }, { frequencyPerDay: 1 })); const id = c.json && c.json.consentId;
    if (id) {
      await authorise(id);
      const a1 = await call({ path: `${B}/accounts`, headers: { 'Consent-ID': id }, token: T, psuAbsent: true });
      const a2 = await call({ path: `${B}/accounts`, headers: { 'Consent-ID': id }, token: T, psuAbsent: true });
      const a3 = await call({ path: `${B}/accounts`, headers: { 'Consent-ID': id }, token: T });
      rb('GE-CNS-FREQ', a1.status === 200 && a2.status === 429 && errorCode(a2.json) === 'ACCESS_EXCEEDED' && a3.status === 200, { testId: 'frequency-per-day', res: a2, expected: 'frequencyPerDay=1: 2nd TPP-initiated call -> 429 ACCESS_EXCEEDED; PSU-present call still 200', actual: `TPP #1 ${a1.status}, TPP #2 ${a2.status} ${errorCode(a2.json) || ''}, PSU-present ${a3.status}` });
    }
  } else simOnly('GE-CNS-FREQ', 'would consume the real consent quota; needs agreed request rates');

  // ---- GE-ACC-MULTI-SCOPE: consent on one currency of a multicurrency account must not return the XXX record
  const xxx = (ctx.accounts || []).find((a) => a.currency === 'XXX');
  if (xxx) {
    const subCur = ((ctx.accounts || []).find((a) => a.iban === xxx.iban && a.currency !== 'XXX') || {}).currency || 'GEL';
    const ref = [{ iban: xxx.iban, currency: subCur }];
    const c = await post(body({ accounts: ref, balances: ref, transactions: ref })); const id = c.json && c.json.consentId;
    if (id) {
      await authorise(id);
      const l = await call({ path: `${B}/accounts`, headers: { 'Consent-ID': id }, token: T });
      const got = (l.json && l.json.accounts) || [];
      rb('GE-ACC-MULTI-SCOPE', l.status === 200 && got.some((a) => a.currency === subCur) && !got.some((a) => a.currency === 'XXX'), { testId: 'multicurrency-scope', res: l, expected: `consent for ${subCur} only -> the ${subCur} sub-account, no aggregated XXX record`, actual: `currencies returned: ${got.map((a) => a.currency).join(', ') || 'none'} (HTTP ${l.status})` });
    } else rb('GE-ACC-MULTI-SCOPE', false, { testId: 'multicurrency-scope', res: c, expected: 'currency-level consent on a multicurrency account accepted', actual: `HTTP ${c.status}` });
  } else rb('GE-ACC-MULTI-SCOPE', null, { note: 'no multicurrency account in the test customer' });

  // ---- GE-TX-CURRENCYEXCH
  const fx = items.filter((t) => { const m = /(\d+\.\d{2}) (USD|EUR|GBP)\b/.exec(t.remittanceInformationUnstructured || ''); return m && t.transactionAmount && t.transactionAmount.currency !== m[2]; });
  const noFx = fx.filter((t) => !Array.isArray(t.currencyExchange) || !t.currencyExchange.length);
  rb('GE-TX-CURRENCYEXCH', fx.length ? noFx.length === 0 : null, { testId: 'currency-exchange', jsonPath: '$.transactions.booked[].currencyExchange', expected: 'currencyExchange on entries made in another currency', actual: `${noFx.length} of ${fx.length} foreign-currency entries without currencyExchange`, note: 'no foreign-currency entries found' });

  // ---- same-day window: GE-TX-TODAY, GE-TX-DETAILS, GE-TX-TXID
  const base = ctx.txBase;
  const td = await call({ path: `${base}?bookingStatus=booked&dateFrom=${today}`, headers: HC, token: T });
  const tdp = await call({ path: `${base}?bookingStatus=pending&dateFrom=${today}`, headers: HC, token: T });
  const tb = (td.json && td.json.transactions && td.json.transactions.booked) || [], tp = (tdp.json && tdp.json.transactions && tdp.json.transactions.pending) || [];
  const transfer = (t) => /^PMNT-(RCDT|ICDT)/.test(t.bankTransactionCode || '');
  const pendTransfersToday = tp.filter((t) => transfer(t) && isoDate(t.valueDate) === today);
  rb('GE-TX-TODAY', td.status === 200 && tdp.status === 200 && (tb.length + tp.length) ? pendTransfersToday.length === 0 : null, { testId: 'same-day-bookings', res: tdp, expected: "today's transfers that are certain to book appear in booked", actual: `${pendTransfersToday.length} same-day transfer(s) listed as pending`, note: 'no same-day entries' });
  const all = items.concat(tb, tp);
  const withId = all.filter((t) => t.transactionId);
  const truncated = all.filter((t) => (t.remittanceInformationUnstructured || '').length >= 140 && !t.remittanceInformationUnstructuredArray);
  const probe = truncated.find((t) => t.transactionId) || withId[0];
  let det = null;
  if (probe) det = await call({ path: `${base}/${encodeURIComponent(probe.transactionId)}`, headers: HC, token: T });
  const detOk = det && det.status === 200 && det.json && (det.json.transactionsDetails || det.json.transactionDetails);
  rb('GE-TX-TXID', withId.length ? !!detOk : true, { testId: 'transaction-id', res: det, expected: 'transactionId only when the details service answers for it', actual: det ? `details for transactionId ${probe.transactionId} -> HTTP ${det.status}` : '' });
  if (truncated.length) {
    const d = detOk && (det.json.transactionsDetails || det.json.transactionDetails);
    const fullText = d && (Array.isArray(d.remittanceInformationUnstructuredArray) ? d.remittanceInformationUnstructuredArray.join('') : d.remittanceInformationUnstructured || '');
    rb('GE-TX-DETAILS', !!detOk && fullText.length > 140, { testId: 'transaction-details', res: det, expected: 'list truncates the purpose at 140 chars -> details service returns the full text', actual: !probe ? 'truncated entries carry no transactionId to fetch details' : detOk ? `details text ${fullText.length} chars` : `details -> HTTP ${det && det.status}` });
  } else rb('GE-TX-DETAILS', true, { testId: 'transaction-details' }); // list complete: details service optional

  // ---- GE-TX-CONSISTENT (simulator fixtures for cancelled entries)
  if (SIM) {
    const cb = await call({ path: `${base}?bookingStatus=booked&entryReferenceFrom=cancelled-booked-ref`, headers: HC, token: T });
    const cp = await call({ path: `${base}?bookingStatus=booked&entryReferenceFrom=cancelled-pending-ref`, headers: HC, token: T });
    rb('GE-TX-CONSISTENT', cb.status === 400 && errorCode(cb.json) === 'PARAMETER_NOT_CONSISTENT' && cp.status === 200, { testId: 'cancelled-entry-ref', res: cb.status !== 400 ? cb : cp, expected: 'cancelled booked reference -> 400 PARAMETER_NOT_CONSISTENT; cancelled pending reference -> 200', actual: `booked -> HTTP ${cb.status} ${errorCode(cb.json) || ''}; pending -> HTTP ${cp.status}` });
  } else simOnly('GE-TX-CONSISTENT', 'needs a cancelled entryReference on the test account');

  // ---- decoupled authorisation + resources + limit
  if (SIM) {
    const c = await post(body({ availableAccounts: 'allAccounts' }), { 'TPP-Redirect-Preferred': 'false', 'TPP-Decoupled-Preferred': 'true' });
    const id = c.json && c.json.consentId, links = (c.json && c.json._links) || {};
    const start = Object.keys(links).find((k) => /^startAuthori[sz]ation/i.test(k));
    rb('GE-AUTH-DECOUPLED', !!start && !links.scaOAuth && !links.scaRedirect, { testId: 'decoupled-preferred', res: c, expected: 'TPP-Redirect-Preferred=false + TPP-Decoupled-Preferred=true -> decoupled authorisation (startAuthorisation link)', actual: `links: ${Object.keys(links).join(', ')}` });
    if (id) {
      const href = start ? links[start].href : `${B}/consents/${id}/authorisations`;
      const a1 = await call({ method: 'POST', path: href, body: {}, token: T });
      const aid = a1.json && a1.json.authorisationId;
      const g = aid ? await call({ path: `${B}/consents/${id}/authorisations/${aid}`, token: T }) : null;
      const put = aid ? await call({ method: 'PUT', path: `${B}/consents/${id}/authorisations/${aid}`, body: { scaAuthenticationData: '123456' }, token: T }) : null;
      const st = await call({ path: `${B}/consents/${id}/status`, token: T });
      const ok = a1.status === 201 && !!aid && g && g.status === 200 && g.json && g.json.scaStatus && put && put.status === 200 && put.json && put.json.scaStatus === 'finalised' && st.json && st.json.consentStatus === 'valid';
      rb('GE-AUTH-RESOURCES', ok, { testId: 'authorisation-resources', res: !ok ? (put || g || a1) : a1, expected: 'POST 201 {authorisationId, scaStatus}; GET scaStatus; PUT -> finalised; consent valid', actual: `POST ${a1.status}; GET ${g && g.status} ${g && g.json && g.json.scaStatus}; PUT ${put && put.status} ${put && put.json && put.json.scaStatus}; consent ${st.json && st.json.consentStatus}` });
      const a2 = await call({ method: 'POST', path: href, body: {}, token: T });
      const a3 = await call({ method: 'POST', path: href, body: {}, token: T });
      rb('GE-AUTH-MAXAUTH', a2.status === 201 && a3.status >= 400 && a3.status < 500, { testId: 'max-authorisations', res: a3, expected: 'second authorisation resource allowed; a third is refused', actual: `2nd -> HTTP ${a2.status}; 3rd -> HTTP ${a3.status}` });
    }
  } else { simOnly('GE-AUTH-DECOUPLED', 'needs a PSU to confirm in the bank app'); simOnly('GE-AUTH-RESOURCES', 'needs a PSU to finalise SCA'); simOnly('GE-AUTH-MAXAUTH', 'creates authorisation resources for a real customer'); }
}
module.exports = extras;
