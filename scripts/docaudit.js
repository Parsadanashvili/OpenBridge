// npm run docaudit [-- --fetch]  -> offline documentation audit of the saved BOG/TBC contracts. No network unless --fetch.
const fs = require('fs'), path = require('path');
const { run } = require('../src/docaudit/audit');
const { docAuditMd } = require('../src/docaudit/report');
const out = path.join(__dirname, '..', 'out');
fs.mkdirSync(out, { recursive: true });
const r = run();
fs.writeFileSync(path.join(out, 'doc-audit.json'), JSON.stringify(r, null, 2));
fs.writeFileSync(path.join(out, 'doc-audit-report.md'), docAuditMd(r));
console.log(JSON.stringify(r.summary, null, 2));
console.log('wrote out/doc-audit.json and out/doc-audit-report.md');
