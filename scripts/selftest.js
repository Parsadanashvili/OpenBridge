// Automated acceptance suite: auditor detection (per bank, per rulebook rule), rule coverage, JWS, TLS probe,
// synthetic-data realism, documentation audit, transformation.  Run: npm test
const assert = require('assert');
const fs = require('fs'), path = require('path'), https = require('https');
const { startAll } = require('../src/banks/sim');
const { PROFILES } = require('../src/banks/profiles');
const { buildBankData, ibanValid, TODAY, money } = require('../src/banks/datagen');
const { runAudit, loadConfig } = require('../src/auditor/runner');
const { transformAccountList } = require('../src/transform/canonical');
const docaudit = require('../src/docaudit/audit');
const rulebook = require('../src/spec/rulebook');
const jws = require('../src/shared/jws');
const { probe } = require('../src/auditor/tls');
const studioEngine = require('../src/studio/engine');
const studioStore = require('../src/studio/store');
const { TEMPLATES } = require('../src/studio/templates');
const evidence = require('../src/nbg/evidence');

const FX = path.join(__dirname, '..', 'fixtures', 'test-signing');
const KEY = fs.readFileSync(path.join(FX, 'key.pem'), 'utf8'), CERT = fs.readFileSync(path.join(FX, 'cert.pem'), 'utf8');

(async () => {
  const servers = await startAll({ quiet: true });
  const cfg = { ...loadConfig(), samples: 20, intervalMs: 20 };
  const run = await runAudit(cfg);
  const t = [];
  const check = async (name, fn) => { try { await fn(); t.push(['PASS', name]); } catch (e) { t.push(['FAIL', name + ' :: ' + e.message]); } };
  const F = (bank) => run.findings.filter((f) => f.bank === bank);
  const has = (bank, rule, p) => F(bank).some((f) => f.ruleId === rule && (!p || (f.jsonPath || '').includes(p)));

  // ---------------------------------------------------------------- run health
  await check('audit ran without internal errors', () => assert.deepStrictEqual(run.errors, []));
  await check('every rule id used by the auditor exists (no unknown rule)', () => assert(run.errors.length === 0));
  await check('planned/manual rules never produce findings', () => { const live = new Set(rulebook.rules.filter((r) => ['planned', 'manual'].includes(r.status)).map((r) => r.id)); assert(!run.findings.some((f) => live.has(f.ruleId))); });
  await check('rulebook integrity: unique ids, every rule cites document, section and pages', () => { const ids = rulebook.rules.map((r) => r.id); assert.strictEqual(new Set(ids).size, ids.length); assert(rulebook.rules.every((r) => r.source.doc && r.source.section && r.source.pages && r.requirement && r.level)); });
  await check('rule coverage: every "implemented" rule is evaluated (TLS rules via the TLS test below)', () => {
    const missing = run.ruleCoverage.filter((r) => r.status === 'implemented' && !['GE-SEC-TLS12', 'GE-SEC-MTLS', 'GE-SEC-OCSP'].includes(r.id) && !Object.values(r.banks).some((c) => c.pass + c.fail > 0)).map((r) => r.id);
    assert.deepStrictEqual(missing, []);
  });

  // ---------------------------------------------------------------- Alpha is clean except its planted defects
  await check('alpha: only the two planted defects (product missing in details; balance timestamp w/o timezone)', () => {
    const odd = F('alpha').filter((f) => !((f.ruleId === 'CONF-REQUIRED' && /product/.test(f.jsonPath)) || (f.ruleId === 'CONF-FORMAT' && /lastChangeDateTime/.test(f.jsonPath))));
    assert.deepStrictEqual(odd.map((f) => `${f.ruleId} ${f.jsonPath || f.testId}: ${f.actual}`), []);
  });
  await check('alpha: documented problem+json errors are valid; observation recorded', () => assert(run.observations.some((o) => o.bank === 'alpha' && o.value === 'problem+json')));
  await check('alpha: decoupled authorisation resources work end-to-end', () => assert(run.tests.some((x) => x.bank === 'alpha' && x.ruleId === 'GE-AUTH-RESOURCES' && x.passed === true)));
  await check('alpha: details service returns the full purpose text', () => assert(run.tests.some((x) => x.bank === 'alpha' && x.ruleId === 'GE-TX-DETAILS' && x.passed === true)));
  await check('alpha: XXX multicurrency account handled', () => assert(run.tests.some((x) => x.bank === 'alpha' && x.ruleId === 'GE-ACC-CUR-XXX' && x.passed === true)));

  // ---------------------------------------------------------------- Beta: each planted deviation is caught under the right rule
  const betaExpect = {
    'GE-CNS-NOTOKEN': 'consent registration refused without token', 'GE-CNS-NOTVALID': 'valid before authentication', 'GE-CNS-OAUTH-REDIRECT': 'scaRedirect', 'GE-AUTH-NOCONFIRM': 'confirmation link', 'GE-AUTH-CURIES': 'ofge without curies',
    'GE-CNS-DETAILS': 'altered consent details', 'GE-CNS-FIELDS': 'lenient consent body', 'GE-CNS-ONCE': 'one-off with 4/day', 'GE-CNS-90D': '120 days accepted', 'GE-CNS-ALLPSD2': 'allPsd2 accepted', 'GE-CNS-DELETE': 'revocation ignored', 'GE-CNS-UNKNOWN': '401 for unknown consent header',
    'GE-API-REQID': 'no X-Request-ID enforcement', 'GE-API-REQID-ECHO': 'no echo', 'GE-ACC-RESID-TOKEN': 'IBAN as resourceId', 'GE-ACC-NAME': 'no name', 'GE-ACC-CATYPE': 'SVGS', 'GE-ACC-DETAILS-FIELD': 'details in list', 'GE-ACC-BBAN-NEVER': 'bban', 'GE-ACC-BAL-FLAG': 'balances without flag',
    'GE-ACC-BAL-LIST': 'no interim balance', 'GE-ACC-BAL-DETAILS': 'details balance types', 'GE-ACC-OWNER': 'owner name without consent', 'GE-ACC-LINKS-SCOPE': 'links beyond consent', 'GE-ERR-INSUFFICIENT-SCOPE': 'reduced doc instead of CONSENT_INVALID', 'GE-ACC-NO-OVERSHARE': 'transactions on list-only consent',
    'GE-BAL-TYPES': 'only closingBooked', 'GE-BAL-DATES': 'no referenceDate/lastChangeDateTime', 'GE-BAL-ACCOUNT': 'no account attribute', 'GE-TX-LINKS': 'no first link', 'GE-TX-ONCE': 'page overlap duplicates', 'GE-TX-ENTRYREF': 'duplicates by entryReference', 'GE-TX-SORT': 'sorted by valueDate',
    'GE-TX-DATES': 'dateFrom ignored', 'GE-TX-ENTRYREFFROM': 'ignored', 'GE-TX-STATUS': 'both unsupported', 'GE-TX-HISTORY': '90-day window', 'GE-TX-BALANCES': 'no balances section', 'GE-TX-COUNTERPARTY-ACCT': 'no debtorAccount', 'GE-TX-REMITTANCE': 'Georgian text mangled',
    'GE-AUTH-NOANON': '403 instead of 401', 'GE-ERR-FORMAT': 'flat error body', 'GE-ERR-MAP': 'status/code mapping', 'GE-SEC-NOCACHE': 'no cache-control + banner', 'GE-SEC-LINKS': 'foreign link host', 'GE-JWS-SIGT': 'fractional seconds', 'GE-JWS-TYP': 'typ jose', 'GE-JWS-DIGEST': 'wrong digest', 'GE-SEC-SEAL': 'unsigned request accepted + bad response seal',
    'GE-JWS-ENCODING': 'identity;q=0 accepted', 'GE-API-LANG': 'no Content-Language', 'GE-API-PARTYID': 'flat identifier', 'GE-CNS-EMPTYARR': 'valid without SCA / mixed arrays', 'GE-CNS-HEADERS': 'any token accepted', 'GE-CNS-FREQ': 'no frequencyPerDay limit',
    'GE-CNS-REDIRECT-URI': 'foreign redirect host accepted', 'GE-ACC-MULTI-SCOPE': 'XXX returned for a one-currency consent', 'GE-TX-CURRENCYEXCH': 'currencyExchange dropped', 'GE-TX-TXID': 'transactionId without details service', 'GE-TX-TODAY': 'same-day transfer pending',
    'GE-TX-CONSISTENT': 'cancelled reference ignored', 'GE-AUTH-DECOUPLED': 'decoupled preference ignored', 'GE-AUTH-MAXAUTH': 'unlimited authorisations', 'GE-TX-DETAILS': 'truncated purpose, no details service',
  };
  for (const [rule, why] of Object.entries(betaExpect)) await check(`beta: ${rule} detected (${why})`, () => assert(has('beta', rule), `no ${rule} finding for beta`));
  await check('beta: legacy schema findings (bic missing, amount as number, DD.MM.YYYY, enum case)', () => { assert(has('beta', 'CONF-REQUIRED', 'bic')); assert(has('beta', 'CONF-TYPE', 'amount')); assert(has('beta', 'CONF-FORMAT', 'bookingDate')); assert(has('beta', 'CONF-ENUM', 'consentStatus')); });
  await check('findings carry rule level, spec page, expected/actual and evidence', () => assert(run.findings.every((f) => f.expected && f.actual && f.ruleId && f.operation && f.specRef && f.level)));

  // ---------------------------------------------------------------- measurements & hygiene
  await check('counts reconcile with executed requests', () => assert(run.performance.every((s) => s.reconciles && s.requests === 20)));
  await check('latency measured (beta slower than alpha)', () => { const m = (b) => run.performance.filter((s) => s.bank === b).reduce((a, s) => a + s.medianMs, 0); assert(m('beta') > m('alpha')); });
  await check('untested controls are not_assessed, never pass (TLS on plain-HTTP simulators)', () => assert(run.security.some((s) => s.ruleId === 'GE-SEC-TLS12' && s.status === 'not_assessed')));
  await check('no bearer token or signature in stored evidence', () => { const s = JSON.stringify(run); assert(!s.includes('sim-token-')); assert(!/eyJiNjQi[A-Za-z0-9_-]{20}/.test(s)); });
  await check('real banks configured but NOT RUN with reason (never a pass)', () => { const ids = run.notRun.map((b) => b.id); assert(ids.includes('tbc') && ids.includes('bog')); assert(run.notRun.every((b) => b.reason)); });

  // ---------------------------------------------------------------- JWS unit tests (Georgian JWS profile)
  const body = Buffer.from('{"a":1}\n');
  const hdr = { 'content-type': 'application/json', digest: jws.sha('SHA-256', body), 'x-request-id': 'r1', 'psu-ip-address': '1.2.3.4' };
  const pars = ['(response-status)', 'content-type', 'digest', 'x-request-id', 'psu-ip-address'];
  const good = jws.sign({ keyPem: KEY, certPem: CERT, pars, headers: hdr, status: 200 });
  const V = (sig, h = hdr, b = body) => jws.verify(sig, { headers: h, status: 200, body: b, kind: 'response' });
  await check('jws: a correct seal verifies with no violations', () => { const v = V(good); assert(v.verified); assert.deepStrictEqual(v.violations, []); });
  await check('jws: tampered body -> GE-JWS-DIGEST', () => assert(V(good, hdr, Buffer.from('{"a":2}\n')).violations.some((x) => x.rule === 'GE-JWS-DIGEST')));
  await check('jws: fractional-second sigT, old sigT, bad typ, missing protected headers each map to their rule', () => {
    const v1 = V(jws.sign({ keyPem: KEY, certPem: CERT, pars, headers: hdr, status: 200, sigT: new Date().toISOString() })).violations.map((x) => x.rule); assert(v1.includes('GE-JWS-SIGT'));
    const v2 = V(jws.sign({ keyPem: KEY, certPem: CERT, pars, headers: hdr, status: 200, sigT: '2020-01-01T00:00:00Z' })).violations.map((x) => x.rule); assert(v2.includes('GE-JWS-SKEW'));
    const v3 = V(jws.sign({ keyPem: KEY, certPem: CERT, pars, headers: hdr, status: 200, overrides: { typ: 'jose' } })).violations.map((x) => x.rule); assert(v3.includes('GE-JWS-TYP'));
    const v4 = V(jws.sign({ keyPem: KEY, certPem: CERT, pars: ['(response-status)', 'digest'], headers: hdr, status: 200 })).violations.map((x) => x.rule); assert(v4.includes('GE-JWS-PARS'));
  });
  await check('jws: alg none / b64 true / x5c+x5t#S256 / missing crit / jwk each detected', () => {
    const o = (over) => V(jws.sign({ keyPem: KEY, certPem: CERT, pars, headers: hdr, status: 200, overrides: over })).violations.map((x) => x.rule);
    assert(o({ alg: 'none' }).includes('GE-JWS-ALG')); assert(o({ b64: true }).includes('GE-JWS-B64')); assert(o({ 'x5t#S256': 'abc' }).includes('GE-JWS-NOX5T'));
    assert(o({ crit: ['sigT'] }).includes('GE-JWS-CRIT')); assert(o({ jwk: { kty: 'RSA' } }).includes('GE-JWS-NOX5T'));
  });
  await check('jws: missing header -> GE-JWS-HEADER; garbage -> GE-JWS-HEADER', () => { assert(V(undefined).violations[0].rule === 'GE-JWS-HEADER'); assert(V('not.a.jws').violations[0].rule === 'GE-JWS-HEADER'); });

  // ---------------------------------------------------------------- TLS probe against local HTTPS servers
  const tlsServer = (requestCert) => new Promise((r) => { const s = https.createServer({ key: KEY, cert: CERT, minVersion: 'TLSv1.2', requestCert, rejectUnauthorized: requestCert }, (q, res) => res.end('ok')); s.listen(0, '127.0.0.1', () => r(s)); });
  const sMtls = await tlsServer(true), sOpen = await tlsServer(false);
  const pm = await probe({ baseUrl: `https://127.0.0.1:${sMtls.address().port}` }), po = await probe({ baseUrl: `https://127.0.0.1:${sOpen.address().port}` });
  await check('tls probe: TLS1.2+ negotiated, legacy TLS not accepted', () => { assert(/TLSv1\.[23]/.test(pm.protocol)); assert(!pm.oldTlsAccepted); });
  await check('tls probe: mutual TLS enforced when the server requires a client cert, flagged when it does not', () => { assert.strictEqual(pm.mtlsEnforced, true); assert.strictEqual(po.mtlsEnforced, false); });
  await check('tls probe: reports OCSP stapling absence honestly', () => assert.strictEqual(pm.stapled, false));
  sMtls.close(); sOpen.close();

  // ---------------------------------------------------------------- synthetic data realism
  const alpha = buildBankData(PROFILES.alpha), accts = alpha.flatMap((c) => c.accounts);
  await check('IBANs valid mod-97, Georgian structure GE+22', () => assert(accts.every((a) => ibanValid(a.iban) && a.iban.length === 22)));
  await check('books never overdrawn; no future dates; pending only recent', () => { for (const a of accts) { assert(a.tx.every((x) => x.runT === undefined || x.runT >= 0)); assert(a.tx.every((x) => x.valueDate <= TODAY)); assert(a.tx.filter((x) => x.status === 'pending').every((x) => x.valueDate >= '2026-10-20')); } });
  await check('12 months of history, hundreds of tx per main account', () => { const n = alpha.map((c) => c.accounts[0].tx.length); assert(Math.min(...n) > 150 && Math.max(...n) < 1500, n.join(',')); });
  await check('salaried employee gets ~12 monthly salaries on business days', () => { const emp = alpha.find((c) => c.persona === 'employee').accounts[0].tx.filter((x) => x.type === 'in' && x.btc === 'PMNT-RCDT-SALA'); assert(emp.length >= 12 && emp.length <= 13, String(emp.length)); assert(emp.every((x) => ![0, 6].includes(new Date(x.valueDate + 'T00:00:00Z').getUTCDay()))); });
  await check('weekend restaurant spend higher per day than weekday', () => { const tx = alpha.find((c) => c.persona === 'employee').accounts[0].tx.filter((x) => x.mcc === '5812'); const isWe = (x) => [0, 6].includes(new Date(x.valueDate + 'T00:00:00Z').getUTCDay()); const we = tx.filter(isWe).length / 104, wd = tx.filter((x) => !isWe(x)).length / 261; assert(we > wd, `${we.toFixed(2)} vs ${wd.toFixed(2)}`); });
  await check('Georgian-script remittance and owner names present', () => { assert(alpha.every((c) => /[ა-ჿ]/.test(c.accounts[0].ownerName))); assert(accts.some((a) => a.tx.some((x) => /[ა-ჿ]/.test(x.remit)))); });
  await check('FX card payments carry exchange info; ids unique; amounts exact 2-dp; all CACC', () => { assert(accts.some((a) => a.tx.some((x) => x.fx && x.type === 'card'))); assert(accts.every((a) => new Set(a.tx.map((x) => x.transactionId)).size === a.tx.length && new Set(a.tx.map((x) => x.entryReference)).size === a.tx.length)); assert(accts.every((a) => a.tx.every((x) => /^-?\d+\.\d{2}$/.test(money(x.amountT))))); assert(accts.every((a) => a.cashAccountType === 'CACC')); });

  // ---------------------------------------------------------------- documentation audit
  const da = docaudit.run();
  await check('doc audit: 30 published examples, 22 pass / 8 fail (matches workshop slide 43)', () => { assert.strictEqual(da.summary.examplesChecked, 30); assert.strictEqual(da.summary.examplesValid, 22); assert.strictEqual(da.summary.examplesInvalid, 8); });
  await check('doc audit: BOG consent example string-boolean + missing combinedServiceIndicator (slide 38)', () => { const f = da.findings.filter((x) => x.ruleId === 'DOC-EXAMPLE' && x.bank === 'bog' && x.op === 'consents'); assert(f.some((x) => x.jsonPath === '$.recurringIndicator' && x.actual === 'string')); assert(f.some((x) => x.jsonPath === '$.combinedServiceIndicator')); });
  await check('doc audit: TBC undeclared _links/ownerIdentification and no-offset timestamp', () => { const f = da.findings.filter((x) => x.bank === 'tbc' && x.ruleId === 'DOC-EXAMPLE'); assert(f.some((x) => /ownerIdentification/.test(x.jsonPath))); assert(f.some((x) => /_links/.test(x.jsonPath))); assert(f.some((x) => /lastChangeDateTime/.test(x.jsonPath))); });
  await check('doc audit: {} passes TBC account-list schema, fails BOG', () => { const c = da.coverage.find((x) => x.op === 'accountList'); assert.strictEqual(c.banks.tbc.loose, true); assert.strictEqual(c.banks.bog.loose, false); });
  await check('doc audit: TBC capitalised consent keys accepted by permissive schema', () => assert(da.findings.some((x) => x.ruleId === 'DOC-UNDECLARED' && x.bank === 'tbc' && /Accounts/.test(x.jsonPath))));
  await check('doc audit: snapshots have provenance hashes', () => assert(da.provenance.files.length >= 7 && da.provenance.files.every((x) => /^[0-9a-f]{64}$/.test(x.sha256))));

  // ---------------------------------------------------------------- Flow Studio
  const tplAcc = TEMPLATES.find((x) => x.id === 'unified-accounts');
  const fr = await studioEngine.execute({ ...tplAcc, version: 1 }, { tenant: 'selftest-a', params: {} });
  await check('studio: unified-accounts returns accounts from both banks in one shape (no XXX duplicates)', () => { const a = fr.data.accounts; assert(a.some((x) => x.bank === 'alpha') && a.some((x) => x.bank === 'beta')); assert(!a.some((x) => x.currency === 'XXX')); assert(a.every((x) => Object.keys(x).join() === Object.keys(a[0]).join())); });
  await check('studio: Beta numeric amounts normalised to decimal strings', () => assert(fr.data.accounts.filter((x) => x.bank === 'beta' && x.bookedBalance != null).every((x) => /^-?\d+\.\d{2}$/.test(x.bookedBalance))));
  await check('studio: missing source values are null and listed, never invented', () => { assert(fr.data.accounts.filter((x) => x.bank === 'beta').every((x) => x.availableBalance === null)); assert(fr.meta.missing.some((m) => m.bank === 'beta' && m.field === 'availableBalance')); });
  await check('studio: response schema issues reported for nulls in required fields', () => assert(fr.meta.schemaIssues.some((i) => /availableBalance/.test(i.path))));
  const ftx = await studioEngine.execute({ ...TEMPLATES.find((x) => x.id === 'unified-transactions'), version: 1 }, { tenant: 'selftest-a', params: { dateFrom: '2026-10-01' } });
  await check('studio: unified transactions use ISO dates (Beta DD.MM.YYYY converted), sorted, limited to 20', () => { const x = ftx.data.transactions; assert(x.length === 20); assert(x.every((y) => /^\d{4}-\d{2}-\d{2}$/.test(y.date))); assert(x.every((y, i) => i === 0 || y.date <= x[i - 1].date)); });
  const tplTx = TEMPLATES.find((x) => x.id === 'unified-transactions');
  const fDef = await studioEngine.execute({ ...tplTx, version: 1 }, { tenant: 'selftest-a', params: {} });
  await check('studio inputs: defaults applied on the endpoint (dateFrom 2026-10-01, limit 20)', () => { assert.strictEqual(fDef.meta.inputs.dateFrom, '2026-10-01'); assert.strictEqual(fDef.meta.inputs.limit, 20); assert(fDef.data.transactions.length === 20 && fDef.data.transactions.every((x) => x.date >= '2026-10-01')); });
  const fUsd = await studioEngine.execute({ ...tplTx, version: 1 }, { tenant: 'selftest-a', params: { currency: 'USD', limit: '5', dateFrom: '2026-01-01' } });
  await check('studio inputs: typed values flow into nodes (currency filter, integer limit)', () => { assert(fUsd.data.transactions.length <= 5 && fUsd.data.transactions.length > 0); assert(fUsd.data.transactions.every((x) => x.currency === 'USD')); });
  await check('studio inputs: invalid / missing inputs rejected with 400 and per-input errors', async () => {
    await assert.rejects(studioEngine.execute({ ...tplTx, version: 1 }, { tenant: 'selftest-a', params: { limit: '500', currency: 'JPY', dateFrom: '2026-13-01' } }), (e) => e.status === 400 && e.errors.length === 3);
    const req = { id: 'r', nodes: [{ id: 'trigger', type: 'trigger', config: { inputs: [{ name: 'accountId', type: 'string', required: true }] } }, { id: 'respond', type: 'respond', config: {} }], edges: [{ from: 'trigger', to: 'respond' }] };
    await assert.rejects(studioEngine.execute(req, { tenant: 'selftest-a', params: {} }), (e) => e.status === 400 && e.errors[0].error === 'required');
  });
  await check('studio inputs: optional input unset -> filter skipped, not "match nothing"', () => assert(fr.data.accounts.length >= 4));
  // path parameters
  studioStore.saveFlow('selftest-a', { ...TEMPLATES.find((x) => x.id === 'account-details'), id: 'acc-one', published: { path: 'accounts/{accountId}' } });
  studioStore.saveFlow('selftest-a', { id: 'acc-static', name: 's', nodes: [], edges: [], published: { path: 'accounts/summary' } });
  await check('studio paths: {param} patterns validated; params extracted; static segment beats parameter', () => {
    assert(studioStore.validPattern('accounts/{accountId}/transactions')); assert(!studioStore.validPattern('accounts/{a}/{a}')); assert(!studioStore.validPattern('../x'));
    const m = studioStore.matchPublished('selftest-a', 'accounts/beta%3A123'); assert.strictEqual(m.flow.id, 'acc-one'); assert.strictEqual(m.params.accountId, 'beta:123');
    assert.strictEqual(studioStore.matchPublished('selftest-a', 'accounts/summary').flow.id, 'acc-static'); assert.strictEqual(studioStore.matchPublished('selftest-a', 'accounts/x/y'), null);
  });
  const accId = fr.data.accounts.find((x) => x.bank === 'beta').accountId;
  const one = await studioEngine.execute({ ...TEMPLATES.find((x) => x.id === 'account-details'), version: 1 }, { tenant: 'selftest-a', params: { accountId: accId } });
  await check('studio paths: unified id routes to the owning bank only; single object returned', () => { assert.strictEqual(one.data.account.accountId, accId); assert(one.meta.sources.every((s) => s.bank === 'beta')); assert(one.trace.some((t) => t.node === 'alpha' && /belongs to beta/.test(t.skipped || ''))); });
  const none = await studioEngine.execute({ ...TEMPLATES.find((x) => x.id === 'account-details'), version: 1 }, { tenant: 'selftest-a', params: { accountId: 'alpha:does-not-exist' } });
  await check('studio paths: unknown account -> notFound (endpoint answers 404)', () => { assert.strictEqual(none.meta.notFound, true); assert.strictEqual(none.data.account, null); });
  const atx = await studioEngine.execute({ ...TEMPLATES.find((x) => x.id === 'account-transactions'), version: 1 }, { tenant: 'selftest-a', params: { accountId: accId, limit: '5' } });
  await check('studio paths: /accounts/{accountId}/transactions returns only that account (or says partial)', () => { assert(atx.data.transactions.every((x) => x.accountId === accId)); assert(atx.data.transactions.length === 5 || atx.meta.partial); });
  await check('studio: transient bank 5xx retried; any remaining gap is flagged partial, never silent', () => { const failed = atx.meta.sources.filter((s) => s.status >= 500); assert(failed.length === 0 || failed.every((f) => atx.meta.sources.some((s) => s.path === f.path && s.status === 200)) || atx.meta.partial); });
  await check('studio: path helper (filters, alternatives, meta, constants) and functions', () => { const o = { b: [{ t: 'x', v: 1 }, { t: 'y', v: 2 }], n: null }; assert.strictEqual(studioEngine.get(o, 'b[?t=y].v'), 2); assert.strictEqual(studioEngine.get(o, '=GEL'), 'GEL'); assert.strictEqual(studioEngine.get(o, '@bank', { bank: 'alpha' }), 'alpha'); assert.strictEqual(studioEngine.FN.decimal(1250.5), '1250.50'); assert.strictEqual(studioEngine.FN.isoDate('21.10.2026'), '2026-10-21'); assert.strictEqual(studioEngine.FN.decimal('abc'), null); });
  await check('studio: cycles rejected', async () => { await assert.rejects(studioEngine.execute({ id: 'c', nodes: [{ id: 'a', type: 'merge' }, { id: 'b', type: 'merge' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }] }, { tenant: 'selftest-a' }), /cycle/); });
  await check('studio: tenants are isolated (flows and connections)', () => { studioStore.saveFlow('selftest-a', { id: 'only-a', name: 'x', nodes: [], edges: [] }); assert(studioStore.listFlows('selftest-a').some((f) => f.id === 'only-a')); assert(!studioStore.listFlows('selftest-b').some((f) => f.id === 'only-a')); assert.deepStrictEqual(studioStore.getConnections('selftest-b'), {}); assert.throws(() => studioStore.listFlows('../etc')); });
  fs.rmSync(path.join(__dirname, '..', 'data', 'tenants', 'selftest-a'), { recursive: true, force: true });

  // ---------------------------------------------------------------- NBG evidence checklist
  await check('evidence: manual rules form the checklist; only manual rules and known statuses accepted', () => { const c = evidence.checklist(['alpha']); assert(c.length === rulebook.rules.filter((r) => r.status === 'manual').length && c.length > 0); assert.throws(() => evidence.record({ bank: 'alpha', ruleId: 'GE-TX-PAGE50', status: 'confirmed' })); assert.throws(() => evidence.record({ bank: 'alpha', ruleId: c[0].id, status: 'maybe' })); });

  // ---------------------------------------------------------------- transform
  await check('transform never invents missing fields', () => { const r = transformAccountList({ accounts: [{ resourceId: 'x', iban: 'GE29NB0000000101904917', currency: 'GEL', balances: [] }] }); assert.deepStrictEqual(r.deliveries[0].missingMandatoryFields.sort(), ['bic', 'cashAccountType']); assert(!('bic' in r.deliveries[0].bankAPayload)); assert.strictEqual(r.deliveries[0].decision, 'DELIVERED_INCOMPLETE'); });
  await check('transform blocks when iban missing', () => assert.strictEqual(transformAccountList({ accounts: [{ currency: 'GEL' }] }).deliveries[0].decision, 'BLOCKED'));

  t.forEach(([s, n]) => console.log(s, n));
  console.log(`\n${t.filter((x) => x[0] === 'PASS').length}/${t.length} passed`);
  servers.forEach((s) => s.close());
  process.exit(t.some(([s]) => s === 'FAIL') ? 1 : 0);
})();
