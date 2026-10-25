// npm run rulebook -> docs/RULEBOOK.md (human-readable) + out/rulebook.json (machine-readable)
const fs = require('fs'), path = require('path');
const { rules, summary } = require('../src/spec/rulebook');
const S = summary();
const lvl = { MUST: 'MUST', MUST_NOT: 'MUST NOT', SHOULD: 'SHOULD', MAY: 'MAY' };
const areaName = { security: 'Transport & message security', jws: 'JWS signing profile', api: 'API structure', errors: 'Errors', consent: 'Consent', accounts: 'Accounts', balances: 'Balances', transactions: 'Transactions', auth: 'Authentication / OAuth2', compliance: 'Compliance schedule' };
let o = `# OpenBridge Rulebook\n\nGenerated from \`src/spec/rulebook.js\`. **${S.total} rules** extracted by reading the Georgian open-banking standards (and the Berlin Group base) - every rule cites section and printed page.\n\n`;
o += `| Status | Count | Meaning |\n|---|---|---|\n| implemented | ${S.byStatus.implemented || 0} | executed by the auditor against sandboxes/simulators |\n| planned | ${S.byStatus.planned || 0} | testable, not built yet |\n| manual | ${S.byStatus.manual || 0} | needs certificates/organiser evidence/human review |\n\n`;
o += `Levels: ${Object.entries(S.byLevel).map(([k, v]) => `${lvl[k]} ${v}`).join(' · ')}\n\n`;
o += `Sources (full PDFs saved in \`specs/standards/\`, hashes in \`specs/PROVENANCE.json\`): GE XS2A Implementation Guide 0.8.RC3 · GE JWS Guide 0.5.RC1 · GE Identification/Authentication/Authorization Guide 0.8.RC1 · Berlin Group NextGenPSD2 1.3.9.\n\n`;
o += `> The Georgian guides are written in Georgian; rules here are English paraphrases made by the team. Where wording is ambiguous the rule says so. This is a team-made catalogue, **not an official NBG artefact**.\n`;
for (const area of Object.keys(areaName)) {
  const list = rules.filter((r) => r.area === area); if (!list.length) continue;
  o += `\n## ${areaName[area]}\n\n| ID | Level | Rule | Source | Status |\n|---|---|---|---|---|\n`;
  for (const r of list) o += `| \`${r.id}\` | ${lvl[r.level]} | **${r.title}.** ${r.requirement}${r.note ? ` *(${r.note})*` : ''} | ${r.source.doc} ${r.source.section}, p.${r.source.pages} | ${r.status} |\n`;
}
fs.mkdirSync(path.join(__dirname, '..', 'docs'), { recursive: true }); fs.mkdirSync(path.join(__dirname, '..', 'out'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'RULEBOOK.md'), o);
fs.writeFileSync(path.join(__dirname, '..', 'out', 'rulebook.json'), JSON.stringify({ summary: S, rules }, null, 2));
console.log(JSON.stringify(S, null, 1));
