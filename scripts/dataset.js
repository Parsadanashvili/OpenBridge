// npm run dataset -> writes the generated synthetic customers per bank to out/synthetic-<bank>.json and prints a sample.
const fs = require('fs'); const path = require('path');
const { PROFILES } = require('../src/banks/profiles');
const { buildBankData, summarize, money } = require('../src/banks/datagen');
fs.mkdirSync(path.join(__dirname, '..', 'out'), { recursive: true });
for (const p of Object.values(PROFILES)) {
  const data = buildBankData(p);
  fs.writeFileSync(path.join(__dirname, '..', 'out', `synthetic-${p.key}.json`), JSON.stringify(data, null, 1));
  console.log(`\n== ${p.name}: ${data.length} customers, ${data.reduce((s, c) => s + c.txnCount, 0)} transactions`);
  for (const c of data) console.log(`- ${c.name} (${c.nameKa}) [${c.personaLabel}] ${c.accounts.map((a) => `${a.currency} ${a.tx.length} tx, closing ${money(a.closingBookedT)}`).join(' | ')}`);
}
const s = buildBankData(PROFILES.alpha)[0].accounts[0].tx.slice(-6);
console.log('\nlast transactions, alpha employee:'); s.forEach((t) => console.log(' ', t.ts, t.status.padEnd(7), money(t.amountT).padStart(9), t.cp, '|', t.remit));
