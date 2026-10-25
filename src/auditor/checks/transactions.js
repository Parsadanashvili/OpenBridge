// Transaction list: fields, paging, filters, entryReferenceFrom, booking status, history, balances section.
const { OPERATIONS } = require('../../spec/profile');
const { schemaCheck } = require('./schema');
const { errorCode, plusDays, isoDate } = require('./common');
const PAGE_LIMIT = 50;

async function transactions(ctx) {
  const { bank, B, rb, call } = ctx;
  const full = ctx.consents.full, T = ctx.token, id = ctx.accountId;
  const H = { 'Consent-ID': full.id };
  const base = `${B}/accounts/${id}/transactions`;
  const today = bank.simulated ? '2026-10-25' : new Date().toISOString().slice(0, 10);

  // ---- first page + walk of the portions via _links.next
  const firstUrl = `${base}?bookingStatus=booked`;
  const t1 = await call({ path: firstUrl, headers: H, token: T });
  schemaCheck(ctx, 'transactions-first-page', OPERATIONS.transactions, t1);
  const pages = [t1]; let cur = t1, guard = 0;
  while (cur.json && cur.json.transactions && cur.json.transactions._links && cur.json.transactions._links.next && guard++ < 8) {
    cur = await call({ path: cur.json.transactions._links.next.href, headers: H, token: T }); pages.push(cur);
    if (cur.status !== 200) break;
  }
  const items = pages.flatMap((p) => (p.json && p.json.transactions && p.json.transactions.booked) || []);
  const pend = (t1.json && t1.json.transactions && t1.json.transactions.pending) || [];
  ctx.txItems = items.concat(pend); ctx.txBase = base;
  const R = (rule, ok, d) => rb(rule, ok, { res: d.res || t1, testId: d.testId || rule, ...d });

  // sizes, links semantics, repeats
  const sizes = pages.map((p) => ((p.json && p.json.transactions && p.json.transactions.booked) || []).length);
  R('GE-TX-PAGE50', Math.max(...sizes) <= PAGE_LIMIT, { testId: 'tx-page-size', expected: `at most ${PAGE_LIMIT} records per portion`, actual: `largest portion: ${Math.max(...sizes)}` });
  const norm = (u) => { const x = new URL(u, 'http://x'); x.searchParams.delete('entryReferenceFrom'); x.searchParams.delete('page'); return x.pathname + x.search; };
  const linkProblems = [];
  pages.forEach((p, i) => {
    const l = p.json && p.json.transactions && p.json.transactions._links || {};
    const last = i === pages.length - 1 && !l.next;
    if (!l.first) linkProblems.push(`portion ${i + 1}: no first link`);
    else if (norm(l.first.href) !== norm(firstUrl)) linkProblems.push(`portion ${i + 1}: first=${l.first.href} differs from the called address`);
    if (!last && !l.next) linkProblems.push(`portion ${i + 1}: next missing`);
    if (last && l.next) linkProblems.push(`last portion has next`);
  });
  R('GE-TX-LINKS', linkProblems.length === 0, { testId: 'tx-links', expected: 'first+next on first/middle portions, only first on the last; first = called address', actual: linkProblems.slice(0, 3).join('; ') });
  const refs = items.map((t) => t.entryReference);
  const dup = refs.filter((r, i) => r && refs.indexOf(r) !== i);
  R('GE-TX-ONCE', items.length > 0 && dup.length === 0, { testId: 'tx-once', expected: 'each transaction exactly once across portions', actual: items.length ? `${dup.length} repeated entryReference value(s) over ${pages.length} portions` : 'no transactions returned' });
  const missingRef = items.filter((t) => !t.entryReference).length;
  const pendRefs = pend.map((t) => t.entryReference);
  const crossDup = pendRefs.filter((r) => r && refs.includes(r));
  R('GE-TX-ENTRYREF', items.length > 0 && missingRef === 0 && crossDup.length === 0 && dup.length === 0, { testId: 'tx-entryref', jsonPath: '$.transactions.booked[].entryReference', expected: 'entryReference present on every entry and unique within the consent (booked and pending)', actual: missingRef ? `${missingRef} entries without entryReference` : `${dup.length + crossDup.length} repeated values` });

  // fields
  const noVal = items.filter((t) => !t.valueDate).length;
  R('GE-TX-VALUEDATE', items.length > 0 && noVal === 0, { testId: 'tx-valuedate', jsonPath: '$.transactions.booked[].valueDate', expected: 'valueDate on every entry', actual: `${noVal} entries without valueDate` });
  const signBad = items.filter((t) => t.transactionAmount && ((t.creditorAccount && Number(t.transactionAmount.amount) > 0) || (t.debtorAccount && Number(t.transactionAmount.amount) < 0)));
  R('GE-TX-AMOUNT', signBad.length === 0, { testId: 'tx-amount-sign', jsonPath: '$.transactions.booked[].transactionAmount.amount', expected: 'debits negative (creditorAccount present), credits positive', actual: `${signBad.length} entries with the wrong sign` });
  const cpBad = items.filter((t) => (/^PMNT-RCDT/.test(t.bankTransactionCode || '') && !t.debtorAccount) || (/^PMNT-ICDT/.test(t.bankTransactionCode || '') && !t.creditorAccount));
  R('GE-TX-COUNTERPARTY-ACCT', cpBad.length === 0, { testId: 'tx-counterparty', jsonPath: '$.transactions.booked[].debtorAccount', expected: 'debtorAccount on credit transfers, creditorAccount on debit transfers (card purchases excluded: no IBAN exists)', actual: `${cpBad.length} transfer entries without the counterparty account` });
  const mangled = items.filter((t) => /�|\?{2,}/.test(t.remittanceInformationUnstructured || ''));
  R('GE-TX-REMITTANCE', mangled.length === 0, { testId: 'tx-remittance', jsonPath: '$.transactions.booked[].remittanceInformationUnstructured', expected: 'payment purpose returned unchanged (Georgian text intact)', actual: `${mangled.length} entries with replacement characters or "??" in place of text` });
  const dates = items.map((t) => isoDate(t.bookingDate)).filter(Boolean);
  const asc = dates.every((d, i) => i === 0 || d >= dates[i - 1]), desc = dates.every((d, i) => i === 0 || d <= dates[i - 1]);
  R('GE-TX-SORT', items.length > 1 && (asc || desc), { testId: 'tx-sort', jsonPath: '$.transactions.booked[].bookingDate', expected: 'sorted ascending or descending by bookingDate', actual: 'bookingDate order is neither ascending nor descending' });

  // ---- filters
  const from = bank.simulated ? '2026-10-22' : plusDays(today, -3), to = bank.simulated ? '2026-10-24' : plusDays(today, -1);
  const tf = await call({ path: `${base}?bookingStatus=booked&dateFrom=${from}&dateTo=${to}`, headers: H, token: T });
  const fi = (tf.json && tf.json.transactions && tf.json.transactions.booked) || [];
  const outside = fi.filter((t) => { const d = isoDate(t.bookingDate); return d < from || d > to; });
  const tOpen = await call({ path: `${base}?bookingStatus=booked&dateFrom=${from}`, headers: H, token: T });
  const openItems = (tOpen.json && tOpen.json.transactions && tOpen.json.transactions.booked) || [];
  R('GE-TX-DATES', tf.status === 200 && tOpen.status === 200 && outside.length === 0, { res: tf, testId: 'tx-date-filter', jsonPath: '$.transactions.booked[].bookingDate', expected: `dateFrom/dateTo honoured (${from}..${to}); dateTo optional`, actual: `${outside.length} of ${fi.length} entries outside the range` });

  // ---- entryReferenceFrom (exclusive) - only meaningful with >= 3 entries on page 1
  const p1 = (t1.json && t1.json.transactions && t1.json.transactions.booked) || [];
  if (p1.length >= 3 && p1[1].entryReference) {
    const ref = p1[1].entryReference;
    const te = await call({ path: `${base}?bookingStatus=booked&entryReferenceFrom=${encodeURIComponent(ref)}`, headers: H, token: T });
    const ei = (te.json && te.json.transactions && te.json.transactions.booked) || [];
    const ok = te.status === 200 && ei.length > 0 && !ei.some((t) => t.entryReference === ref) && !ei.some((t) => t.entryReference === p1[0].entryReference);
    rb('GE-TX-ENTRYREFFROM', ok, { res: te, testId: 'tx-entryref-from', expected: 'only entries after the referenced one; the referenced entry itself is never returned', actual: te.status !== 200 ? `HTTP ${te.status}` : `returned ${ei.length} entries; referenced entry included: ${ei.some((t) => t.entryReference === ref)}; earlier entry included: ${ei.some((t) => t.entryReference === p1[0].entryReference)}` });
  } else rb('GE-TX-ENTRYREFFROM', null, { note: 'fewer than 3 transactions on the first portion' });

  // ---- booking status values
  const tp = await call({ path: `${base}?bookingStatus=pending`, headers: H, token: T });
  const tb = await call({ path: `${base}?bookingStatus=both`, headers: H, token: T });
  const stOk = tp.status === 200 && Array.isArray(tp.json && tp.json.transactions && tp.json.transactions.pending) && tb.status === 200 && Array.isArray(tb.json && tb.json.transactions && tb.json.transactions.booked) && Array.isArray(tb.json.transactions.pending);
  rb('GE-TX-STATUS', stOk, { res: tb.status !== 200 ? tb : tp, testId: 'tx-booking-status', expected: 'booked, pending and both supported (200 with the matching lists)', actual: `pending -> HTTP ${tp.status}; both -> HTTP ${tb.status} ${errorCode(tb.json) || ''}` });

  // ---- history is not cut at the consent date
  const old = plusDays(today, -300);
  const th = await call({ path: `${base}?bookingStatus=booked&dateFrom=${old}&dateTo=${plusDays(today, -280)}`, headers: H, token: T });
  const hi = (th.json && th.json.transactions && th.json.transactions.booked) || [];
  const hiIn = hi.filter((x) => { const d = isoDate(x.bookingDate); return d >= old && d <= plusDays(today, -280); });
  rb('GE-TX-HISTORY', th.status === 200 && hiIn.length > 0, { res: th, testId: 'tx-history', expected: 'historical transactions older than the consent are returned (law, not the consent date, limits history)', actual: th.status !== 200 ? `HTTP ${th.status}` : '0 entries for a period 280-300 days back (confirm the test account has history)' });

  // ---- balances section with transactions
  const tbal = await call({ path: `${base}?bookingStatus=booked&dateFrom=${from}`, headers: H, token: T });
  const bl = (tbal.json && tbal.json.balances) || [];
  const types = bl.map((b) => b.balanceType);
  rb('GE-TX-BALANCES', types.includes('openingBooked') && types.some((t) => /^interim/.test(t)), { res: tbal, testId: 'tx-balances', jsonPath: '$.balances', expected: 'balances section with openingBooked (start date) and an interim balance when the range includes today', actual: types.length ? `balance types: ${types.join(', ')}` : 'no balances section although the consent covers balances' });

  // ---- expired consent on the transaction service (simulators expose the special id; real banks need OB_<ID>_EXPIRED_CONSENT_ID)
  const expiredId = bank.simulated ? 'expired-consent' : process.env[`OB_${bank.id.toUpperCase()}_EXPIRED_CONSENT_ID`];
  if (expiredId) { const te = await call({ path: `${base}?bookingStatus=booked&dateFrom=${from}`, headers: { 'Consent-ID': expiredId }, token: T }); rb('GE-CNS-EXPIRED', te.status === 401 && errorCode(te.json) === 'CONSENT_EXPIRED', { res: te, testId: 'tx-expired-consent', expected: '401 CONSENT_EXPIRED and no data', actual: `HTTP ${te.status} ${errorCode(te.json) || ''}` }); }
  else rb('GE-CNS-EXPIRED', null, { note: `needs an expired consent: set OB_${bank.id.toUpperCase()}_EXPIRED_CONSENT_ID` });
  ctx.txStatus = t1.status;
  rb('GE-ACC-SUPPORTED', t1.status === 200, { res: t1, testId: 'tx-supported', expected: 'transaction list returns 200', actual: `HTTP ${t1.status}` });
}
module.exports = transactions;
