// A tenant's connection to a bank = an authorised consent + token. Simulators are connected automatically
// (consent created and approved in the sandbox); real banks need OB_<ID>_ACCESS_TOKEN / OB_<ID>_CONSENT_ID.
const { call, getToken } = require('../auditor/http');
const { loadConfig } = require('../auditor/runner');
const store = require('./store');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bankCfg = (id) => { const b = loadConfig().banks.find((x) => x.id === id); if (!b) throw Object.assign(new Error(`unknown bank ${id}`), { status: 400 }); return b; };

async function connect(tenant, bankId) {
  const bank = bankCfg(bankId), B = bank.basePath || '/0.8/v1';
  if (!bank.simulated) {
    const token = process.env[`OB_${bankId.toUpperCase()}_ACCESS_TOKEN`], consentId = process.env[`OB_${bankId.toUpperCase()}_CONSENT_ID`];
    if (!token || !consentId) throw Object.assign(new Error(`${bank.name}: needs OB_${bankId.toUpperCase()}_ACCESS_TOKEN and _CONSENT_ID (human SCA)`), { status: 409 });
    return save(tenant, bankId, { consentId, token, simulated: false });
  }
  const tok = await getToken(bank); if (tok.skip) throw Object.assign(new Error(tok.skip), { status: 502 });
  const validUntil = new Date(Date.UTC(2026, 9, 25) + 60 * 864e5).toISOString().slice(0, 10);
  const c = await call(bank, { method: 'POST', path: `${B}/consents`, token: tok.token, headers: { 'TPP-Redirect-URI': 'https://tpp.example/callback' },
    body: { access: { accounts: [], balances: [], transactions: [] }, recurringIndicator: true, validUntil, frequencyPerDay: 4, combinedServiceIndicator: false } });
  const id = c.json && c.json.consentId; if (!id) throw Object.assign(new Error(`${bank.name}: consent failed (HTTP ${c.status})`), { status: 502 });
  let st; for (let i = 0; i < 6 && st !== 'valid'; i++) { const s = await call(bank, { path: `${B}/consents/${id}/status`, token: tok.token }); st = s.json && s.json.consentStatus; if (st !== 'valid') await sleep(30); }
  if (String(st).toLowerCase() !== 'valid') throw Object.assign(new Error(`${bank.name}: consent not authorised (${st})`), { status: 502 });
  return save(tenant, bankId, { consentId: id, token: tok.token, simulated: true });
}
function save(tenant, bankId, c) { const all = store.getConnections(tenant); all[bankId] = { ...c, connectedAt: new Date().toISOString() }; store.saveConnections(tenant, all); return all[bankId]; }
async function ensure(tenant, bankId) { const c = store.getConnections(tenant)[bankId]; return c || connect(tenant, bankId); }
const publicView = (tenant) => Object.fromEntries(Object.entries(store.getConnections(tenant)).map(([k, v]) => [k, { consentId: v.consentId, simulated: v.simulated, connectedAt: v.connectedAt }]));
module.exports = { connect, ensure, bankCfg, publicView };
