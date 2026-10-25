// CLI: node scripts/audit.js [--no-sim]   -> runs audit, writes out/latest-run.json + reports in out/
const fs = require('fs');
const path = require('path');
const { startAll } = require('../src/banks/sim');
const { runAudit, loadConfig, saveRun } = require('../src/auditor/runner');
const R = require('../src/reports/generate');
const { templateExplain } = require('../src/ai/explain');

(async () => {
  const servers = process.argv.includes('--no-sim') ? [] : await startAll({ quiet: true });
  const run = await runAudit(loadConfig(), { onProgress: (m) => console.log('·', m) });
  saveRun(run);
  const ex = Object.fromEntries(run.findings.map((f) => [f.id, templateExplain(f)]));
  const out = path.join(__dirname, '..', 'out');
  fs.writeFileSync(path.join(out, 'incompatibility-report.md'), R.incompatibilityMd(run, ex));
  fs.writeFileSync(path.join(out, 'quality-report.md'), R.qualityMd(run));
  fs.writeFileSync(path.join(out, 'quality-report.csv'), R.qualityCsv(run));
  console.log(JSON.stringify(run.summary, null, 2));
  console.log('reports written to out/');
  servers.forEach((s) => s.close());
})();
