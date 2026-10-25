// Deterministic audit runner. Orchestrates rulebook-driven checks (src/spec/rulebook.js) per bank + latency sampling. No AI in here.
const fs = require('fs');
const path = require('path');
const { SPEC } = require('../spec/profile');
const rulebook = require('../spec/rulebook');
const { call, getToken } = require('./http');
const { makeCtx, resetSeq } = require('./checks/common');
const consent = require('./checks/consent');
const accounts = require('./checks/accounts');
const transactions = require('./checks/transactions');
const security = require('./checks/security');
const extras = require('./checks/extras');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function pct(sorted, p) { if (!sorted.length) return null; const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1); return Math.round(sorted[i] * 10) / 10; }

async function performance(ctx, token) {
  const { bank, cfg, B } = ctx, id = ctx.accountId, cid = ctx.consents.full.id;
  const endpoints = [
    { name: 'GET /accounts', path: `${B}/accounts?withBalance=true` },
    { name: 'GET /accounts/{id}/balances', path: `${B}/accounts/${id}/balances` },
    { name: 'GET /accounts/{id}/transactions', path: `${B}/accounts/${id}/transactions?bookingStatus=booked` },
  ];
  const stats = [];
  for (const ep of endpoints) {
    const lat = [], codes = {}; let ok = 0, fail = 0, timeouts = 0, neterr = 0;
    for (let i = 0; i < cfg.samples; i++) {
      const r = await call(bank, { path: ep.path, headers: { 'Consent-ID': cid }, token, timeoutMs: cfg.timeoutMs }); // raw call: sampling never retries
      if (r.timedOut) { timeouts++; fail++; } else if (r.networkError) { neterr++; fail++; }
      else { lat.push(r.latencyMs); codes[r.status] = (codes[r.status] || 0) + 1; if (r.status === 200) ok++; else fail++; }
      await sleep(cfg.intervalMs);
    }
    const sorted = [...lat].sort((a, b) => a - b);
    const s = { bank: bank.id, endpoint: ep.name, requests: cfg.samples, success: ok, failed: fail, timeouts, networkErrors: neterr, statusCodes: codes,
      medianMs: pct(sorted, 50), p95Ms: cfg.samples >= 20 ? pct(sorted, 95) : null, minMs: sorted[0] && Math.round(sorted[0] * 10) / 10, maxMs: sorted.at(-1) && Math.round(sorted.at(-1) * 10) / 10,
      successRatePct: Math.round((ok / cfg.samples) * 1000) / 10, reconciles: ok + fail === cfg.samples, label: 'observed test result (short run), not long-term uptime' };
    stats.push(s);
    if (fail > 0) ctx.rb('REL-ERRORS', false, { testId: `REL-${ep.name}`, operation: ep.name, key: ep.name, expected: '0 failed requests in sample', actual: `${fail}/${cfg.samples} failed (codes ${JSON.stringify(codes)}, timeouts ${timeouts})` });
  }
  return stats;
}

async function auditBank(bank, tok, config, out, onProgress) {
  const ctx = makeCtx(bank, config, tok.token, call);
  const step = async (name, fn) => { try { await fn(ctx); } catch (e) { ctx.notes.push(`${name} aborted: ${e.message}`); out.errors.push({ bank: bank.id, step: name, message: e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e.message }); } };
  ctx.consents = {};
  await step('consent', consent); onProgress(`${bank.id}: consent rules done`);
  if (!ctx.noData) await step('accounts', accounts); onProgress(`${bank.id}: account rules done`);
  if (!ctx.noData) await step('transactions', transactions); onProgress(`${bank.id}: transaction rules done`);
  if (!ctx.noData) await step('extras', extras); onProgress(`${bank.id}: additional rules done`);
  await step('security', security); onProgress(`${bank.id}: security / seal rules done`);
  ctx.rb('GE-API-URL', /^(\/[^/]+)*\/0\.8\/v1$/.test(ctx.B), { testId: 'base-path', expected: '/{version}/v1 with version 0.8', actual: ctx.B });
  ctx.rb('GE-BAL-AMOUNT', !ctx.amountBad, { testId: 'amount-format', noFinding: true, actual: 'amount not a decimal string' });
  let perf = [];
  if (!ctx.noData && ctx.accountId) { perf = await performance(ctx, tok.token); onProgress(`${bank.id}: performance done`); }
  else ctx.notes.push('performance sampling skipped (no usable consent/account)');
  out.observations.push(...ctx.obs);
  if (ctx.retries) out.observations.push({ bank: bank.id, kind: 'transient-5xx-retries', value: ctx.retries });
  return { ctx, perf };
}

async function runAudit(config, { onProgress = () => {} } = {}) {
  resetSeq();
  const out = { runId: `run-${Date.now()}`, startedAt: new Date().toISOString(), spec: SPEC, rulebook: rulebook.summary(), config: { samples: config.samples, intervalMs: config.intervalMs, timeoutMs: config.timeoutMs }, banks: [], notRun: [], observations: [], errors: [], findings: [], tests: [], security: [], performance: [], ruleCoverage: [] };
  const perBank = {};
  for (const bank of config.banks) {
    const info = { id: bank.id, name: bank.name, simulated: !!bank.simulated, baseUrl: bank.baseUrl };
    if (bank.enabled === false) { out.notRun.push({ ...info, reason: bank.status || 'disabled in config' }); continue; }
    const tok = await getToken(bank);
    if (tok.skip) { out.notRun.push({ ...info, reason: tok.skip }); onProgress(`${bank.id}: NOT RUN - ${tok.skip}`); continue; }
    onProgress(`auditing ${bank.name}`); out.banks.push(info);
    const { ctx, perf } = await auditBank(bank, tok, config, out, onProgress);
    perBank[bank.id] = ctx;
    if (ctx.notes.length) info.notes = ctx.notes;
    out.findings.push(...ctx.findings); out.tests.push(...ctx.tests); out.performance.push(...perf);
  }
  // security view = tests whose rule is in a security-ish area
  const area = (id) => (rulebook.byId[id] || {}).area;
  out.security = out.tests.filter((t) => ['security', 'jws', 'auth'].includes(area(t.ruleId)) || t.ruleId === 'SEC-REDACT').map((t) => ({ bank: t.bank, testId: t.testId, ruleId: t.ruleId, status: t.status === 'not_run' ? 'not_assessed' : t.status, expected: (rulebook.byId[t.ruleId] || {}).title || t.testId, actual: t.note || (t.status === 'pass' ? 'ok' : '') }));
  out.ruleCoverage = rulebook.rules.map((r) => ({ id: r.id, area: r.area, level: r.level, status: r.status, title: r.title, banks: Object.fromEntries(Object.entries(perBank).map(([b, c]) => [b, c.cov[r.id] || { pass: 0, fail: 0, na: 0, notes: [] }])) }));
  out.finishedAt = new Date().toISOString();
  const evaluated = out.tests.filter((t) => t.status !== 'not_run').length;
  out.summary = {
    banks: out.banks.length, banksNotRun: out.notRun.length, testsRun: evaluated + out.performance.length,
    requestsExecuted: out.performance.reduce((a, s) => a + s.requests, 0) + Object.values(perBank).reduce((a, c) => a + c.seen.length, 0),
    findings: out.findings.length, bySeverity: out.findings.reduce((a, f) => ((a[f.severity] = (a[f.severity] || 0) + 1), a), {}),
    rulesEvaluated: out.ruleCoverage.filter((r) => Object.values(r.banks).some((c) => c.pass + c.fail > 0)).length, rulesTotal: out.ruleCoverage.length,
    simulated: out.banks.every((b) => b.simulated),
  };
  return out;
}

const ROOT = path.join(__dirname, '..', '..');
const loadConfig = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'banks.json'), 'utf8'));
const saveRun = (run) => { fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'out', 'latest-run.json'), JSON.stringify(run, null, 2)); };
const loadRun = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'out', 'latest-run.json'), 'utf8')); } catch { return null; } };

module.exports = { runAudit, loadConfig, saveRun, loadRun };
