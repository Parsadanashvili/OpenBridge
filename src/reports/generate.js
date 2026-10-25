// Reports are generated purely from the stored run (latest-run.json). No AI needed.
const rb = require('../spec/rulebook');
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const SEV = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function banner(run) {
  return run.summary.simulated
    ? '> **SIMULATED INSTITUTIONS.** These results come from synthetic bank simulators. They demonstrate the tool; they are NOT evidence of compliance or performance of any real bank.\n'
    : '> Mixed/real sandbox run — see per-bank labels.\n';
}

function incompatibilityMd(run, explain = {}, evidence = []) {
  const fs = [...run.findings].sort((a, b) => SEV[a.severity] - SEV[b.severity]);
  let o = `# OpenBridge Incompatibility Report\n\nRun \`${run.runId}\` · ${run.startedAt} → ${run.finishedAt}\nReference: **${run.spec.id}** (${run.spec.upstream}) — *${run.spec.status}*\n\n${banner(run)}\n`;
  if ((run.notRun || []).length) o += `## Banks configured but NOT run\n\n${run.notRun.map((b) => `- **${b.name}** — ${b.reason}`).join('\n')}\n\nNo compliance or performance claim is made for these institutions.\n\n`;
  if ((run.observations || []).length) o += `## Documented variations & observations (not defects)\n\n${run.observations.map((x) => `- ${x.bank}: ${x.kind} = ${x.value}`).join('\n')}\n\n`;
  o += `## Summary\n\n- Banks: ${run.summary.banks} · Tests/checks: ${run.summary.testsRun} · Findings: ${run.summary.findings}\n- By severity: ${Object.entries(run.summary.bySeverity).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}\n\n## Cross-bank matrix\n\n| Rule | ${run.banks.map((b) => b.id).join(' | ')} |\n|---|${run.banks.map(() => '---').join('|')}|\n`;
  for (const rid of [...new Set(run.findings.map((f) => f.ruleId))]) o += `| ${rid} | ${run.banks.map((b) => run.findings.filter((f) => f.bank === b.id && f.ruleId === rid).length || '✓').join(' | ')} |\n`;
  o += '\n## Findings\n\n';
  for (const f of fs) {
    const e = explain[f.id];
    o += `### ${f.id} — ${f.title} (${f.severity.toUpperCase()}) — ${f.bankName}\n\n- Test: \`${f.testId}\` · Rule: \`${f.ruleId}\` · Spec ref: ${f.specRef}${f.specRefVerified ? '' : ' *(page ref unverified)*'}\n- Operation: ${f.operation}${f.jsonPath ? ` · JSON path: \`${f.jsonPath}\`` : ''}${f.occurrences > 1 ? ` · ${f.occurrences} occurrences` : ''}\n- **Expected:** ${f.expected}\n- **Actual:** ${f.actual}\n- Impact: ${f.impact}\n- Recommended fix: ${f.recommendedFix}\n`;
    if (f.evidence) o += `- Evidence: ${f.evidence.request.method} ${f.evidence.request.path} → HTTP ${f.evidence.response.status} in ${f.evidence.response.latencyMs} ms @ ${f.evidence.at}\n`;
    if (e) o += `- Explanation (${e.source}): ${e.whatWentWrong} Fix: ${e.recommendedFix}\n`;
    o += '\n';
  }
  if (run.ruleCoverage) {
    o += `## Standards rulebook coverage\n\n${run.summary.rulesEvaluated} of ${run.summary.rulesTotal} rulebook rules were evaluated in this run; the rest are planned or need certificates/human evidence (see docs/RULEBOOK.md).\n\n| Rule | Level | ${run.banks.map((b) => b.id).join(' | ')} | Source |\n|---|---|${run.banks.map(() => '---').join('|')}|---|\n`;
    for (const r of run.ruleCoverage.filter((x) => Object.values(x.banks).some((c) => c.pass + c.fail > 0))) o += `| \`${r.id}\` ${esc(r.title)} | ${r.level.replace('_', ' ')} | ${run.banks.map((b) => { const c = r.banks[b.id] || { pass: 0, fail: 0 }; return c.fail ? `✗ ${c.fail}` : c.pass ? '✓' : '–'; }).join(' | ')} | ${esc(((rb.byId[r.id] || {}).source || {}).doc)} ${esc(((rb.byId[r.id] || {}).source || {}).section)} p.${esc(((rb.byId[r.id] || {}).source || {}).pages)} |\n`;
    o += '\n';
  }
  if (evidence.length) {
    const ids = Object.keys(evidence[0].banks);
    o += `## Manual evidence checklist (NBG review)\n\nRules that software cannot verify alone (certificates, human SCA, organiser evidence). Status as recorded by NBG reviewers.\n\n| Rule | ${ids.join(' | ')} | Source |\n|---|${ids.map(() => '---').join('|')}|---|\n`;
    for (const e of evidence) o += `| \`${e.id}\` ${esc(e.title)} | ${ids.map((b) => { const x = e.banks[b]; return `${x.status.toUpperCase()}${x.note ? ` - ${esc(x.note)}` : ''}${x.at ? ` (${x.by}, ${x.at.slice(0, 10)})` : ''}`; }).join(' | ')} | ${esc(e.source.doc)} ${esc(e.source.section)} p.${esc(e.source.pages)} |\n`;
    o += '\n';
  }
  o += '## Security checks\n\n| Bank | Check | Status | Expected | Actual |\n|---|---|---|---|---|\n';
  for (const s of run.security) o += `| ${s.bank} | ${s.testId} | ${s.status.toUpperCase().replace('_', ' ')} | ${esc(s.expected)} | ${esc(s.actual)} |\n`;
  return o;
}

function qualityRows(run) {
  return run.performance.map((s) => ({ bank: s.bank, endpoint: s.endpoint, requests: s.requests, success: s.success, failed: s.failed, timeouts: s.timeouts, successRatePct: s.successRatePct, medianMs: s.medianMs, p95Ms: s.p95Ms, minMs: s.minMs, maxMs: s.maxMs, statusCodes: JSON.stringify(s.statusCodes), reconciles: s.reconciles }));
}
function qualityCsv(run) {
  const rows = qualityRows(run); const cols = Object.keys(rows[0] || {});
  return [cols.join(','), ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
}
function qualityMd(run) {
  let o = `# OpenBridge API Quality Report\n\nRun \`${run.runId}\` · ${run.startedAt}\nConfig: ${run.config.samples} requests/endpoint, ${run.config.intervalMs} ms spacing, ${run.config.timeoutMs} ms timeout.\n\n${banner(run)}\n*Success rates are observed results of a short controlled run, not long-term uptime.*\n\n| Bank | Endpoint | Req | OK | Fail | Timeouts | Success % | Median ms | p95 ms | Max ms |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const s of qualityRows(run)) o += `| ${s.bank} | ${s.endpoint} | ${s.requests} | ${s.success} | ${s.failed} | ${s.timeouts} | ${s.successRatePct} | ${s.medianMs} | ${s.p95Ms} | ${s.maxMs} |\n`;
  return o;
}

module.exports = { incompatibilityMd, qualityMd, qualityCsv, qualityRows };
