const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
function docAuditMd(r) {
  const S = r.summary, srcs = (r.provenance?.files || []);
  let o = `# OpenBridge Documentation Audit (offline)\n\nGenerated ${r.generatedAt}. **No bank was contacted.** Evidence = the banks' own published contracts and examples.\n\n`;
  o += `> Scope of claims: this audit reports what the *documents* show (documentation inconsistencies, schema coverage, applicability questions, contract differences). It does not show that any bank server behaves a certain way, and the counts below are not a defect count or a quality score. Several failures share one root cause.\n\n`;
  o += `## Sources (immutable snapshots)\n\n| Bank | File | Source | SHA-256 |\n|---|---|---|---|\n${srcs.map((f) => `| ${f.bank.toUpperCase()} | \`specs/${f.file}\` | ${f.source} | \`${f.sha256.slice(0, 16)}…\` |`).join('\n')}\n\nRetrieved ${r.provenance?.retrievedAt || 'n/a'}. GE rule catalogue = extracted teaching aid (not an official NBG OpenAPI).\n\n`;
  o += `## Result\n\n- Published examples checked against their own schema: **${S.examplesChecked}** → ${S.examplesValid} pass, ${S.examplesInvalid} fail, from **${S.distinctExampleRootCauses}** distinct root causes.\n- Findings by class: ${Object.entries(S.byClass).map(([k, v]) => `${r.classLabels[k].split(' (')[0]}: ${v}`).join(' · ')}\n`;
  if (r.limitations.length) o += `- Validator limitations (excluded from totals): ${r.limitations.length}\n`;
  o += `\n### Example validation by operation\n\n| Operation | Direction | BOG valid/total | BOG empty-object passes? | TBC valid/total | TBC empty-object passes? |\n|---|---|---|---|---|---|\n`;
  for (const c of r.coverage) { const b = c.banks.bog, t = c.banks.tbc; const lo = (x) => (x.loose === null ? '-' : x.loose ? 'yes (loose)' : 'no'); o += `| ${c.op} | ${c.direction} | ${b.valid}/${b.examples} | ${lo(b)} | ${t.valid}/${t.examples} | ${lo(t)} |\n`; }
  for (const cls of Object.keys(r.classLabels)) {
    const list = r.findings.filter((f) => f.classification === cls); if (!list.length) continue;
    o += `\n## ${r.classLabels[cls]} — ${list.length}\n\n`;
    for (const f of list) {
      o += `### ${f.id} · ${f.title} · ${f.severity.toUpperCase()} · ${f.bank === 'both' ? 'BOG vs TBC' : f.bank.toUpperCase()}\n\n- Operation: ${f.ops ? f.ops.join(', ') + ' (' + f.operation + ')' : f.operation} · ${f.direction}\n- Where: \`${esc(f.jsonPath)}\`${f.schemaPointer && f.schemaPointer !== '-' ? ` · schema pointer \`${f.schemaPointer}\`` : ''}\n- Expected: ${esc(f.expected)}\n- Actual: ${esc(f.actual)}\n`;
      if (f.exampleNames) o += `- Published example(s): ${f.exampleNames.join('; ')}${f.exampleRef ? ` (${f.exampleRef})` : ''}\n`;
      o += `- Source: \`${f.source.file}\`${f.source.sha256 ? ` sha256 ${f.source.sha256.slice(0, 12)}…` : ''}${f.source2 ? ` and \`${f.source2.file}\`` : ''}\n`;
      if (f.limitation) o += `- Limitation: ${f.limitation}\n`;
      if (f.nextCheck) o += `- Next check: ${f.nextCheck}\n`;
      o += '\n';
    }
  }
  if (r.limitations.length) o += `\n## Validator limitations\n\n${r.limitations.map((l) => `- ${l}`).join('\n')}\n`;
  return o;
}
module.exports = { docAuditMd };
