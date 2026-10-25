const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('../src/auditor/http');
const connections = require('../src/studio/connections');
let calls = 0;
http.call = async () => { calls++; return { status: 200, json: { accounts: [{ resourceId: 'one', name: 'Fallback', amount: -12.5, date: '25.10.2026', balances: [{ balanceType: 'closingBooked', balanceAmount: { amount: 14.1 } }] }] } }; };
connections.bankCfg = (id) => ({ id });
connections.ensure = async () => ({ token: 'unused' });
const { previewMap, execute } = require('../src/studio/engine');
const config = { path: 'accounts', fields: [
  { to: 'id', fmt: '${@bank}:${resourceId}' },
  { to: 'nested.label', from: 'displayName|name', fn: 'upper' },
  { to: 'amount', from: 'amount', fn: 'abs' },
  { to: 'balance', from: 'balances[?balanceType=closingBooked].balanceAmount.amount', fn: 'decimal' },
  { to: 'date', from: 'date', fn: 'isoDate' },
  { to: 'constant', from: '={{params.label}}' },
  { to: 'missing', from: 'doesNotExist' },
] };

test('visual preview matches real execution for metadata, nested targets, fallbacks, predicates and transforms', async () => {
  const flow = { nodes: [{ id: 'trigger', type: 'trigger', config: { params: { label: 'constant' } } }, { id: 'bank', type: 'bank', config: { bank: 'alpha', op: 'accounts' } }, { id: 'map', type: 'map', config }, { id: 'respond', type: 'respond', config: {} }], edges: [{ from: 'trigger', to: 'bank' }, { from: 'bank', to: 'map' }, { from: 'map', to: 'respond' }] };
  const result = await execute(flow, { tenant: 'test', captureData: true });
  const mapping = result.trace.find((t) => t.node === 'map').inspection;
  assert.equal(mapping.input.sources[0].bank, 'alpha');
  const count = calls;
  const preview = previewMap(config, mapping.input.sources, { label: 'constant' });
  assert.equal(calls, count, 'preview must never make bank calls');
  assert.equal(JSON.stringify(preview.output.value), JSON.stringify(mapping.output.preview.value));
  assert.equal(preview.output.value[0].id, 'alpha:one');
  assert.equal(preview.output.value[0].nested.label, 'FALLBACK');
  assert.equal(preview.output.value[0].amount, '12.50');
  assert.equal(preview.output.value[0].balance, '14.10');
  assert.equal(preview.output.value[0].date, '2026-10-25');
  assert.equal(preview.output.value[0].constant, 'constant');
  assert.equal(preview.output.value[0].missing, null);
  assert.equal(preview.missing[0].field, 'missing');
});

test('previews accept mapped item streams, bound collections and redact output credentials', () => {
  const source = { node: 'upstream', kind: 'items', preview: { value: Array.from({ length: 80 }, (_, i) => ({ name: `Item ${i}`, _meta: { bank: 'beta' } })) } };
  const preview = previewMap({ fields: [{ to: 'name', from: 'name' }, { to: 'bank', from: '@bank' }, { to: 'token', from: '=secret' }] }, [source]);
  assert.equal(preview.count, 50);
  assert.equal(preview.output.value[0].bank, 'beta');
  assert.equal(preview.output.value[0].token, '[REDACTED]');
  assert.equal(preview.output.redacted, true);
  assert.equal(source.preview.value.length, 80);
});

test('unsafe target paths cannot mutate object prototypes, in preview or workflow execution', async () => {
  const sources = [{ kind: 'items', preview: { value: [{ value: 'bad' }] } }];
  for (const to of ['__proto__.mappingPolluted', 'constructor.prototype.mappingPolluted', 'nested.__proto__.mappingPolluted', '']) {
    assert.throws(() => previewMap({ fields: [{ to, from: 'value' }] }, sources), /invalid output field path/);
  }
  const result = await execute({ nodes: [{ id: 'bank', type: 'bank', config: { bank: 'alpha', op: 'accounts' } }, { id: 'map', type: 'map', config: { path: 'accounts', fields: [{ to: '__proto__.mappingPolluted', from: '=bad' }] } }], edges: [{ from: 'bank', to: 'map' }] }, { tenant: 'test' });
  assert.equal(result.trace[1].ok, false);
  assert.equal(({}).mappingPolluted, undefined);
  const safe = previewMap({ fields: [{ to: 'toString.mappingPolluted', from: '=owned' }] }, sources);
  assert.equal(safe.output.value[0].toString.mappingPolluted, 'owned');
  assert.equal(Object.prototype.toString.mappingPolluted, undefined);
});
