// Manual rules (status "manual" in the rulebook) cannot be tested by software alone - certificates, human SCA, organiser
// evidence. NBG records evidence per bank here; the regulatory report shows what is confirmed, failed or still outstanding.
const fs = require('fs'), path = require('path');
const { rules } = require('../spec/rulebook');
const FILE = path.join(__dirname, '..', '..', 'data', 'nbg', 'evidence.json');
const STATUSES = ['outstanding', 'confirmed', 'failed', 'not_applicable'];

const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
const save = (d) => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(d, null, 2)); };
const manualRules = () => rules.filter((r) => r.status === 'manual');

function record({ bank, ruleId, status, note = '', by = 'NBG reviewer' }) {
  if (!/^[a-z0-9-]{2,32}$/.test(bank || '')) throw new Error('invalid bank id');
  if (!manualRules().some((r) => r.id === ruleId)) throw new Error('not a manual rule');
  if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`);
  const d = load(); d[bank] = d[bank] || {};
  d[bank][ruleId] = { status, note: String(note).slice(0, 500), by: String(by).slice(0, 80), at: new Date().toISOString() };
  save(d); return d[bank][ruleId];
}
function checklist(bankIds) {
  const d = load();
  return manualRules().map((r) => ({ id: r.id, title: r.title, level: r.level, source: r.source, requirement: r.requirement, note: r.note, banks: Object.fromEntries(bankIds.map((b) => [b, (d[b] || {})[r.id] || { status: 'outstanding' }])) }));
}
module.exports = { record, checklist, STATUSES };
