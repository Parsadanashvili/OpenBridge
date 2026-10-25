// Contract-level checks (schema validation against the pinned profile) + coverage mapping to rulebook IDs.
const { validate } = require('../../shared/validate');
const { OPERATIONS } = require('../../spec/profile');
const CODE_TO_RULE = { missing_required: 'CONF-REQUIRED', type: 'CONF-TYPE', format: 'CONF-FORMAT', enum: 'CONF-ENUM' };
const LIST_REQ = /\.(iban|currency|cashAccountType|bic)$/, DET_REQ = /\.(resourceId|iban|currency|product|cashAccountType|bic)$/;

function schemaCheck(ctx, testId, op, res) {
  const base = { testId, operation: `${op.method} ${ctx.B}${op.path}`, res };
  if (res.status !== op.status) { ctx.rb('CONF-STATUS', false, { ...base, expected: `HTTP ${op.status}`, actual: res.status ? `HTTP ${res.status}` : (res.timedOut ? 'timeout' : res.networkError || 'no response') }); return null; }
  if (res.json === undefined) { ctx.rb('GE-API-JSON', false, { ...base, expected: 'valid JSON body', actual: 'unparseable body' }); return null; }
  ctx.rb('GE-API-JSON', true, base);
  const issues = validate(op.schema, res.json);
  for (const i of issues) ctx.rb(CODE_TO_RULE[i.code], false, { ...base, jsonPath: i.path.replace(/\[\d+\]/g, '[]'), expected: i.expected, actual: i.actual === i.expected ? i.value : `${i.actual}${i.value && i.code !== 'missing_required' ? ` (${i.value})` : ''}` });
  const req = issues.filter((i) => i.code === 'missing_required');
  if (op.id === 'accountList') ctx.rb('GE-ACC-LIST-IBAN', !req.some((i) => LIST_REQ.test(i.path)), { ...base, key: 'x', noFinding: true, actual: 'mandatory list field missing' });
  if (op.id === 'accountDetails') ctx.rb('GE-ACC-DET-FIELDS', !req.some((i) => DET_REQ.test(i.path)), { ...base, key: 'x', noFinding: true, actual: 'mandatory details field missing' });
  if (op.id === 'transactions') ctx.rb('GE-TX-BOOKINGDATE', !req.some((i) => /bookingDate$/.test(i.path)), { ...base, key: 'x', noFinding: true, actual: 'bookingDate missing on booked entry' });
  ctx.amountBad = ctx.amountBad || issues.some((i) => /\.amount$/.test(i.path) && ['type', 'format'].includes(i.code));
  if (op.requiredBalanceTypes) {
    const have = (res.json.balances || []).map((x) => x.balanceType);
    const miss = op.requiredBalanceTypes.filter((t) => !have.includes(t));
    ctx.rb('GE-BAL-TYPES', miss.length === 0, { ...base, jsonPath: '$.balances[*].balanceType', expected: `balances of types ${op.requiredBalanceTypes.join(' and ')}`, actual: `types present: ${have.join(', ') || 'none'}` });
    ctx.rb('GE-BAL-ACCOUNT', !!res.json.account, { ...base, expected: 'account attribute present (SHOULD)', actual: 'account attribute absent' });
  }
  return issues;
}
module.exports = { schemaCheck, OPERATIONS };
