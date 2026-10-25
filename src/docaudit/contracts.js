// Loads the saved bank contracts (specs/) and exposes the same five AIS operations for each bank.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const YAML = require('yaml');
const { deref } = require('./schema');
const ROOT = path.join(__dirname, '..', '..', 'specs');

const OPS = [
  { key: 'consents', method: 'post', path: '/v1/consents', status: '201' },
  { key: 'accountList', method: 'get', path: '/v1/accounts', status: '200' },
  { key: 'accountDetails', method: 'get', path: '/v1/accounts/{account-id}', status: '200' },
  { key: 'balances', method: 'get', path: '/v1/accounts/{account-id}/balances', status: '200' },
  { key: 'transactions', method: 'get', path: '/v1/accounts/{account-id}/transactions', status: '200' },
];
const TBC_FILE = { consents: 'aiscreateconsent', accountList: 'aisreadaccountlist', accountDetails: 'aisreadaccountdetails', balances: 'aisreadaccountbalance', transactions: 'aisreadaccounttransactionlist' };

const prov = () => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'PROVENANCE.json'), 'utf8')); } catch { return { files: [] }; } };
function source(bank, file) {
  const p = prov(), f = p.files.find((x) => x.file === file);
  return { bank, file: `specs/${file}`, url: f?.source, sha256: f?.sha256, retrievedAt: p.retrievedAt };
}

function loadBog() {
  const file = 'bog/plugin-redoc-0.yaml';
  const doc = YAML.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  return { bank: 'bog', name: 'Bank of Georgia', doc: () => doc, docFor: () => doc, source: (op) => source('bog', file), server: doc.servers?.[0]?.url };
}
function loadTbc() {
  const docs = {};
  for (const [k, f] of Object.entries(TBC_FILE)) docs[k] = JSON.parse(fs.readFileSync(path.join(ROOT, `tbc/${f}.json`), 'utf8'));
  return { bank: 'tbc', name: 'TBC Bank', docFor: (k) => docs[k], source: (k) => source('tbc', `tbc/${TBC_FILE[k]}.json`), server: docs.accountList.servers?.[0]?.url, docs };
}

// normalise one operation of one bank
function operation(provider, op) {
  const doc = provider.docFor(op.key), ctx = { doc, unsupported: new Set() };
  const pathItem = doc.paths?.[op.path]; const o = pathItem?.[op.method];
  if (!o) return { bank: provider.bank, op, missing: true, ctx, source: provider.source(op.key) };
  const params = [...(pathItem.parameters || []), ...(o.parameters || [])].map((p) => { const r = deref(p, ctx).node; const sch = deref(r.schema || {}, ctx).node; return { name: r.name, in: r.in, required: !!r.required, type: sch.type, format: sch.format, enum: sch.enum, description: r.description }; });
  const media = (content) => Object.entries(content || {}).map(([ct, m]) => ({ contentType: ct, schema: m.schema, examples: examplesOf(m, ctx) }));
  const reqBody = o.requestBody ? deref(o.requestBody, ctx).node : null;
  const responses = {};
  for (const [code, r0] of Object.entries(o.responses || {})) { const r = deref(r0, ctx).node; responses[code] = { description: r.description, media: media(r.content) }; }
  return { bank: provider.bank, op, ctx, doc, source: provider.source(op.key), operationId: o.operationId, params, security: o.security, request: reqBody ? { media: media(reqBody.content) } : null, responses };
}
function examplesOf(m, ctx) {
  const out = [];
  for (const [name, e0] of Object.entries(m.examples || {})) { const e = deref(e0, ctx); out.push({ name, ref: e0.$ref || null, value: e.node.value, summary: e.node.summary }); }
  if (m.example !== undefined) out.push({ name: '(inline example)', ref: null, value: m.example });
  return out;
}

function loadAll() {
  const providers = [loadBog(), loadTbc()];
  return { providers, ops: OPS, byBank: Object.fromEntries(providers.map((p) => [p.bank, Object.fromEntries(OPS.map((op) => [op.key, operation(p, op)]))])) };
}
module.exports = { loadAll, OPS };
