// Account information services: list, details, balances (consent-scoped).
const { OPERATIONS } = require('../../spec/profile');
const { schemaCheck } = require('./schema');
const { errorCode } = require('./common');

const hasKey = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

async function accounts(ctx) {
  const { bank, B, rb, call } = ctx;
  const { full, owner, avail } = ctx.consents;
  const H = (c) => ({ 'Consent-ID': c.id });
  const T = ctx.token;

  // ---- list (full consent, withBalance=true)
  const list = await call({ path: `${B}/accounts?withBalance=true`, headers: H(full), token: T });
  schemaCheck(ctx, 'accounts-list', OPERATIONS.accountList, list);
  const accs = (list.json && list.json.accounts) || [];
  ctx.accounts = accs;
  const R = (id, ok, d) => rb(id, ok, { testId: d.testId || id, res: list, ...d });

  R('GE-API-REQID-ECHO', !list.responseHeaders || list.responseHeaders['x-request-id'] === list.sentRequestId, { expected: 'X-Request-ID echoed in the response', actual: `got ${list.responseHeaders && list.responseHeaders['x-request-id'] || 'header absent'}` });
  const noRid = await call({ path: `${B}/accounts`, headers: H(full), token: T, omitHeaders: ['X-Request-ID'] });
  rb('GE-API-REQID', noRid.status === 400, { testId: 'request-id-required', res: noRid, expected: 'HTTP 400 without X-Request-ID', actual: `HTTP ${noRid.status}` });

  // identifiers
  const leaks = accs.filter((a) => a.resourceId && a.iban && (a.resourceId === a.iban || a.resourceId.includes(a.iban.slice(-12)) || a.resourceId.replace(/\D/g, '').includes(a.iban.replace(/\D/g, '').slice(-10))));
  R('GE-ACC-RESID-TOKEN', leaks.length === 0, { testId: 'resource-id-token', jsonPath: '$.accounts[].resourceId', expected: 'one-way token (UUID recommended); no account number in the identifier', actual: leaks.map((a) => `resourceId ${a.resourceId} reveals the account number`).join('; ') });
  const ids = accs.map((a) => a.resourceId);
  const list2 = await call({ path: `${B}/accounts`, headers: H(full), token: T });
  const ids2 = ((list2.json && list2.json.accounts) || []).map((a) => a.resourceId);
  R('GE-ACC-RESID-UNIQUE', new Set(ids).size === ids.length && JSON.stringify(ids) === JSON.stringify(ids2), { testId: 'resource-id-unique', jsonPath: '$.accounts[].resourceId', expected: 'unique and unchanged between calls', actual: new Set(ids).size !== ids.length ? 'duplicate resourceId values' : 'resourceId values changed between two calls' });
  // field-level rules over list + details later
  const forbid = (a, mode) => ['bban', 'linkedAccounts'].filter((k) => hasKey(a, k)).map((k) => `${mode}.${k}`);
  const bad = accs.flatMap((a) => forbid(a, 'list'));
  const noName = accs.filter((a) => !(a.displayName || a.name));
  R('GE-ACC-NAME', noName.length === 0, { testId: 'account-name', jsonPath: '$.accounts[].name', expected: 'name (or displayName) present', actual: `${noName.length} account(s) without name or displayName` });
  const types = accs.filter((a) => a.cashAccountType && !['CACC', 'CARD'].includes(a.cashAccountType));
  R('GE-ACC-CATYPE', types.length === 0, { testId: 'account-cashtype', jsonPath: '$.accounts[].cashAccountType', expected: 'CACC or CARD', actual: [...new Set(types.map((a) => a.cashAccountType))].join(', ') });
  const st = accs.filter((a) => a.status && !['enabled', 'blocked', 'deleted'].includes(a.status));
  R('GE-ACC-STATUS', st.length === 0, { testId: 'account-status', jsonPath: '$.accounts[].status', expected: 'enabled | blocked | deleted', actual: [...new Set(st.map((a) => a.status))].join(', ') });
  const us = accs.filter((a) => a.usage && !['PRIV', 'ORGA'].includes(a.usage));
  R('GE-ACC-USAGE', us.length === 0, { testId: 'account-usage', jsonPath: '$.accounts[].usage', expected: 'PRIV | ORGA', actual: [...new Set(us.map((a) => a.usage))].join(', ') });
  const det = accs.filter((a) => hasKey(a, 'details') && a.status !== 'blocked');
  R('GE-ACC-DETAILS-FIELD', det.length === 0, { testId: 'account-details-field', jsonPath: '$.accounts[].details', expected: 'details only when status = blocked', actual: `${det.length} item(s) carry details without blocked status` });
  R('GE-ACC-BBAN-NEVER', bad.length === 0, { testId: 'bban-never', jsonPath: '$.accounts[].bban', expected: 'bban/linkedAccounts never returned', actual: bad.slice(0, 3).join(', ') });
  // balances flag
  const noBal = await call({ path: `${B}/accounts`, headers: H(full), token: T });
  const noBalList = (noBal.json && noBal.json.accounts) || [];
  const flagOk = noBalList.length > 0 && noBalList.every((a) => !hasKey(a, 'balances')) && accs.length > 0 && accs.every((a) => hasKey(a, 'balances'));
  rb('GE-ACC-BAL-FLAG', flagOk, { testId: 'balances-flag', res: noBal, jsonPath: '$.accounts[].balances', expected: 'balances only with withBalance=true; present when withBalance=true and consented', actual: noBalList.some((a) => hasKey(a, 'balances')) ? 'balances returned although withBalance was not true' : 'balances missing although withBalance=true and consent covers balances' });
  const lb = accs.filter((a) => a.balances && !a.balances.some((b) => /^interim/.test(b.balanceType)));
  R('GE-ACC-BAL-LIST', accs.some((a) => a.balances) ? lb.length === 0 : null, { testId: 'list-balance-types', jsonPath: '$.accounts[].balances', expected: 'at least one interim balance (interimAvailable preferred)', actual: `${lb.length} item(s) without an interim balance`, note: 'no balances returned' });

  // multicurrency
  const xxx = accs.filter((a) => a.currency === 'XXX');
  if (xxx.length) {
    const mb = await call({ path: `${B}/accounts/${xxx[0].resourceId}/balances`, headers: H(full), token: T });
    const curs = new Set(((mb.json && mb.json.balances) || []).map((b) => b.balanceAmount && b.balanceAmount.currency));
    rb('GE-ACC-CUR-XXX', mb.status === 200 && curs.size >= 2 && new Set(ids).size === ids.length, { testId: 'multicurrency', res: mb, expected: 'XXX account with balances per currency and distinct resourceId values', actual: `HTTP ${mb.status}; currencies ${[...curs].join(',') || 'none'}` });
  } else rb('GE-ACC-CUR-XXX', null, { note: 'no multicurrency account in the test customer' });

  // owner name (GE-ACC-OWNER)
  const ownerIn = (l) => (l || []).some((a) => hasKey(a, 'ownerName') || hasKey(a, 'ownerIdentification'));
  const lo = await call({ path: `${B}/accounts`, headers: H(owner), token: T });
  const ownerLeak = ownerIn(accs) || ownerIn(noBalList);
  const ownerMissing = !ownerIn((lo.json && lo.json.accounts) || []);
  rb('GE-ACC-OWNER', !ownerLeak && !ownerMissing, { testId: 'owner-name', res: ownerLeak ? list : lo, jsonPath: '$.accounts[].ownerName', expected: 'ownerName only with an explicit owner-name consent (and returned when consented)', actual: ownerLeak ? 'ownerName returned although the consent does not cover it' : 'ownerName missing although consented' });

  // consent scope: list-only consent
  if (avail && avail.id) {
    const al = await call({ path: `${B}/accounts`, headers: H(avail), token: T });
    const items = (al.json && al.json.accounts) || [];
    const over = items.filter((a) => hasKey(a, 'balances') || hasKey(a, 'ownerName') || (a._links && (a._links.balances || a._links.transactions)));
    rb('GE-ACC-LINKS-SCOPE', over.every((a) => !(a._links && (a._links.balances || a._links.transactions))) && (accs.length === 0 || accs.every((a) => a._links && a._links.balances && a._links.transactions)), { testId: 'links-scope', res: al, jsonPath: '$.accounts[]._links', expected: 'balances/transactions links only when consented (and present when consented)', actual: 'links returned for a consent that does not cover them, or missing for one that does' });
    const sw = await call({ path: `${B}/accounts?withBalance=true`, headers: H(avail), token: T });
    rb('GE-ERR-INSUFFICIENT-SCOPE', sw.status === 401 && errorCode(sw.json) === 'CONSENT_INVALID', { testId: 'insufficient-scope', res: sw, expected: 'HTTP 401 CONSENT_INVALID (not a reduced document)', actual: `HTTP ${sw.status} ${errorCode(sw.json) || ''}` });
    const firstId = (accs.find((a) => a.currency !== 'XXX') || accs[0] || {}).resourceId;
    const sameAccs = items.length ? items : accs; const aid = (sameAccs.find((a) => a.currency !== 'XXX') || sameAccs[0] || {}).resourceId || firstId;
    const stx = aid ? await call({ path: `${B}/accounts/${aid}/transactions?bookingStatus=booked`, headers: H(avail), token: T }) : null;
    const leakedTx = stx && stx.status === 200;
    rb('GE-ACC-NO-OVERSHARE', !over.length && !leakedTx && sw.status !== 200, { testId: 'no-overshare', res: leakedTx ? stx : (over.length ? al : sw), expected: 'nothing beyond the consent: no balances, owner name or transactions for an available-accounts consent', actual: leakedTx ? 'transactions returned for an available-accounts consent' : over.length ? 'balances/owner/links returned for an available-accounts consent' : 'withBalance=true was served without balance consent' });
  } else { rb('GE-ACC-LINKS-SCOPE', null, { note: 'no list-only consent' }); rb('GE-ERR-INSUFFICIENT-SCOPE', null, { note: 'no list-only consent' }); rb('GE-ACC-NO-OVERSHARE', null, { note: 'no list-only consent' }); }

  // ---- details (first non-XXX account)
  const acc = accs.find((a) => a.currency !== 'XXX') || accs[0];
  if (!acc || !acc.resourceId) { ctx.noData = true; return; }
  ctx.accountId = acc.resourceId;
  const d = await call({ path: `${B}/accounts/${acc.resourceId}?withBalance=true`, headers: H(full), token: T });
  schemaCheck(ctx, 'account-details', OPERATIONS.accountDetails, d);
  const da = d.json && d.json.account;
  if (da) {
    const fb = forbid(da, 'details'); if (fb.length) rb('GE-ACC-BBAN-NEVER', false, { testId: 'bban-never', res: d, jsonPath: '$.account.bban', expected: 'bban/linkedAccounts never returned', actual: fb.join(', ') });
    const types2 = (da.balances || []).map((b) => b.balanceType);
    rb('GE-ACC-BAL-DETAILS', da.balances ? ['interimAvailable', 'interimBooked'].every((t) => types2.includes(t)) : false, { testId: 'details-balance-types', res: d, jsonPath: '$.account.balances', expected: 'interimAvailable and interimBooked', actual: `types present: ${types2.join(', ') || 'none'}` });
  } else rb('GE-ACC-BAL-DETAILS', null, { note: 'details response unusable' });

  // ---- balances endpoint
  const b = await call({ path: `${B}/accounts/${acc.resourceId}/balances`, headers: H(full), token: T });
  schemaCheck(ctx, 'account-balances', OPERATIONS.balances, b);
  const bl = (b.json && b.json.balances) || [];
  const noDate = bl.filter((x) => (/Booked$/.test(x.balanceType) && !x.referenceDate) || (/^interim/.test(x.balanceType) && !x.lastChangeDateTime));
  rb('GE-BAL-DATES', bl.length ? noDate.length === 0 : null, { testId: 'balance-dates', res: b, jsonPath: '$.balances[]', expected: 'referenceDate on *Booked, lastChangeDateTime on Interim*', actual: `${noDate.length} balance(s) missing the date attribute`, note: 'no balances' });
  rb('GE-ACC-SUPPORTED', list.status === 200 && d.status === 200 && b.status === 200, { testId: 'accounts-supported', res: [list, d, b].find((x) => x.status !== 200) || list, expected: 'list, details and balances return 200', actual: `list ${list.status}, details ${d.status}, balances ${b.status}` });
}
module.exports = accounts;
