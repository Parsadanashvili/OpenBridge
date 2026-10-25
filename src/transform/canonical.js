// Showcase: Bank B response -> versioned canonical model -> Bank A expected format.
// Rules: deterministic mapping table only; missing values are NEVER invented; every step is logged.
const { OPERATIONS } = require('../spec/profile');
const { validate } = require('../shared/validate');

const MAPPING_VERSION = 'canonical-account/1.0+beta->alpha/1.0';
const BLOCKING = ['iban', 'currency'];            // missing => block delivery
const MANDATORY_TARGET = ['iban', 'currency', 'cashAccountType', 'bic']; // Bank A (GE profile) account-list mandatory

function toCanonical(src, log) {
  const c = { canonicalVersion: '1.0', accountId: src.resourceId, iban: src.iban, currency: src.currency, name: src.name, product: src.product, cashAccountType: src.cashAccountType, bic: src.bic, balances: [] };
  for (const k of ['resourceId', 'iban', 'currency', 'name', 'product', 'cashAccountType', 'bic']) {
    log.push({ step: 'source->canonical', sourceField: `$.${k}`, targetField: `canonical.${k === 'resourceId' ? 'accountId' : k}`, status: src[k] === undefined ? 'missing' : 'mapped' });
  }
  (src.balances || []).forEach((b, i) => {
    const raw = b.balanceAmount?.amount;
    const amount = typeof raw === 'number' ? raw.toFixed(2) : raw; // number->decimal string: lossless normalisation
    log.push({ step: 'source->canonical', sourceField: `$.balances[${i}].balanceAmount.amount`, targetField: `canonical.balances[${i}].amount`, status: typeof raw === 'number' ? 'normalised(number->string)' : 'mapped' });
    c.balances.push({ type: b.balanceType, amount, currency: b.balanceAmount?.currency, asOf: b.lastChangeDateTime });
  });
  return c;
}

function toBankA(canon, log) {
  const out = { resourceId: canon.accountId, iban: canon.iban, currency: canon.currency, name: canon.name, product: canon.product, cashAccountType: canon.cashAccountType, bic: canon.bic,
    balances: canon.balances.map((b) => ({ balanceType: b.type, balanceAmount: { currency: b.currency, amount: b.amount }, lastChangeDateTime: b.asOf })) };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k]; // never fabricate
  log.push({ step: 'canonical->bankA', mappingVersion: MAPPING_VERSION, status: 'built' });
  return out;
}

function transformAccountList(bankBResponse) {
  const log = [], deliveries = [];
  for (const [i, acc] of (bankBResponse.accounts || []).entries()) {
    const canon = toCanonical(acc, log);
    const bankA = toBankA(canon, log);
    const missing = MANDATORY_TARGET.filter((k) => bankA[k] === undefined);
    const blocked = BLOCKING.some((k) => missing.includes(k));
    const schemaIssues = validate(OPERATIONS.accountList.schema.properties.accounts.items, bankA, `$.accounts[${i}]`);
    deliveries.push({ accountId: canon.accountId, decision: blocked ? 'BLOCKED' : missing.length ? 'DELIVERED_INCOMPLETE' : 'DELIVERED', missingMandatoryFields: missing, targetSchemaIssues: schemaIssues.map((s) => `${s.path}: ${s.code}`), canonical: canon, bankAPayload: blocked ? null : bankA });
  }
  const missingAll = [...new Set(deliveries.flatMap((d) => d.missingMandatoryFields))];
  return {
    mappingVersion: MAPPING_VERSION, synthetic: true, deliveries, transformationLog: log,
    reportToBankA: missingAll.length ? `Delivered ${deliveries.length} account(s); mandatory field(s) NOT supplied by source and NOT inferred: ${missingAll.join(', ')}.` : 'Complete delivery.',
    reportToBankB: missingAll.length ? `Technical issue: account-list response omits mandatory field(s) required by GE 0.8.RC3 §9.3.3: ${missingAll.join(', ')}.` : 'No issues.',
  };
}

module.exports = { transformAccountList, MAPPING_VERSION };
