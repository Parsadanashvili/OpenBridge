// Shared helpers for the rulebook-driven checks.
const { byId } = require('../../spec/rulebook');
const { RULES } = require('../rules');
const { evidenceOf } = require('../http');

// BG 14.11 message code -> permitted HTTP statuses
const CODE_STATUS = {
  FORMAT_ERROR: [400], PARAMETER_NOT_CONSISTENT: [400], PARAMETER_NOT_SUPPORTED: [400], PERIOD_INVALID: [400], SERVICE_INVALID: [400, 405], SERVICE_BLOCKED: [403],
  CONSENT_UNKNOWN: [400, 403], CONSENT_INVALID: [401], CONSENT_EXPIRED: [401], TOKEN_UNKNOWN: [401], TOKEN_INVALID: [401], TOKEN_EXPIRED: [401],
  SIGNATURE_MISSING: [401], SIGNATURE_INVALID: [401], CERTIFICATE_INVALID: [401], CERTIFICATE_EXPIRED: [401], CERTIFICATE_BLOCKED: [401], CERTIFICATE_REVOKED: [401], CERTIFICATE_MISSING: [401],
  ROLE_INVALID: [401], PSU_CREDENTIALS_INVALID: [401], CORPORATE_ID_INVALID: [401], RESOURCE_UNKNOWN: [400, 403, 404], RESOURCE_EXPIRED: [400, 403], RESOURCE_BLOCKED: [400],
  TIMESTAMP_INVALID: [400], SCA_METHOD_UNKNOWN: [400], SCA_INVALID: [400], STATUS_INVALID: [409], ACCESS_EXCEEDED: [429],
};
// token errors: TOKEN_MISSING is not in BG's table but is what simulators and some banks emit for "no bearer"; treat as TOKEN_* family
CODE_STATUS.TOKEN_MISSING = [401];

function errorCode(j) {
  if (!j) return null;
  if (Array.isArray(j.tppMessages) && j.tppMessages[0]) return j.tppMessages[0].code || null;
  if (typeof j.code === 'string') return j.code;
  if (typeof j.error === 'string') return j.error;
  return null;
}
function errorStyle(j) {
  if (j && Array.isArray(j.tppMessages) && j.tppMessages.length && j.tppMessages.every((m) => m.category && m.code)) return 'tppMessages';
  if (j && typeof j.code === 'string' && (j.type || j.title)) return 'problem+json';
  return null;
}

function ruleMeta(id) {
  const r = byId[id];
  if (r) return { title: r.title, severity: r.severity || (r.level === 'SHOULD' ? 'low' : 'medium'), impact: `Departs from ${r.source.doc} ${r.source.section} (p.${r.source.pages}): ${r.requirement}`, fix: `Comply with: ${r.requirement}`, specRef: `${r.source.doc} ${r.source.section}, p.${r.source.pages}`, verified: true, level: r.level };
  const l = RULES[id]; if (!l) throw new Error(`unknown rule ${id}`);
  return { title: l.title, severity: l.sev, impact: l.impact, fix: l.fix, specRef: 'OpenBridge catalogue', verified: false, level: 'MUST' };
}

let seq = 0;
const resetSeq = () => { seq = 0; };

// Context factory: one per bank run. rb() is the single place where a rulebook rule is evaluated.
function makeCtx(bank, cfg, token, retryCall) {
  const ctx = { bank, cfg, token, B: bank.basePath || '/0.8/v1', findings: [], tests: [], cov: {}, seen: [], obs: [], notes: [], retries: 0 };
  const seenKeys = new Map();
  ctx.call = async (o) => {
    const call = retryCall;
    let r = await call(bank, { timeoutMs: cfg.timeoutMs, ...o });
    for (let i = 0; i < 2 && (r.status >= 500 || r.timedOut); i++) { ctx.retries++; r = await call(bank, { timeoutMs: cfg.timeoutMs, ...o }); }
    ctx.seen.push(r);
    return r;
  };
  const cov = (id) => (ctx.cov[id] = ctx.cov[id] || { pass: 0, fail: 0, na: 0, notes: [] });
  // outcome: true = pass, false = fail, null = not applicable / not assessed (reason in d.note)
  ctx.rb = (ruleId, outcome, d = {}) => {
    const m = ruleMeta(ruleId), c = cov(ruleId);
    const testId = d.testId || ruleId, operation = d.operation || (d.res ? `${d.res.method} ${d.res.url}` : '-');
    if (outcome === null) { c.na++; if (d.note) c.notes.push(d.note); ctx.tests.push({ bank: bank.id, testId, ruleId, operation, passed: null, status: 'not_run', note: d.note }); return; }
    if (outcome) { c.pass++; ctx.tests.push({ bank: bank.id, testId, ruleId, operation, passed: true, status: 'pass' }); return; }
    c.fail++;
    ctx.tests.push({ bank: bank.id, testId, ruleId, operation, passed: false, status: 'fail', note: d.actual });
    if (d.noFinding) return;
    const key = `${ruleId}|${d.key ?? d.jsonPath ?? ''}`;
    if (seenKeys.has(key)) { seenKeys.get(key).occurrences++; return; }
    const f = { id: `F-${bank.id}-${String(++seq).padStart(3, '0')}`, bank: bank.id, bankName: bank.name, simulated: !!bank.simulated, testId, ruleId, title: m.title, severity: d.severity || m.severity, impact: m.impact, recommendedFix: m.fix,
      operation, specRef: m.specRef, specRefVerified: m.verified, level: m.level, jsonPath: d.jsonPath, expected: d.expected || 'rule satisfied', actual: d.actual || 'rule not satisfied', evidence: d.res ? evidenceOf(d.res) : undefined, occurrences: 1 };
    seenKeys.set(key, f); ctx.findings.push(f);
  };
  ctx.fail = (ruleId, d) => ctx.rb(ruleId, false, d);
  return ctx;
}

const plusDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const isoDate = (s) => (/^\d{2}\.\d{2}\.\d{4}$/.test(s) ? s.split('.').reverse().join('-') : s);

module.exports = { CODE_STATUS, errorCode, errorStyle, ruleMeta, makeCtx, resetSeq, plusDays, isoDate };
