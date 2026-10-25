const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('../src/auditor/http');
const connections = require('../src/studio/connections');
const { snapshot } = require('../src/studio/inspection');
const accounts = Array.from({ length: 80 }, (_, i) => ({ resourceId: `account-${i}`, currency: 'GEL', token: 'secret-token' }));
http.call = async () => ({ status: 200, json: { accounts } });
connections.bankCfg = (id) => ({ id });
connections.ensure = async () => ({ token: 'connection-secret' });
const { execute } = require('../src/studio/engine');
const flow = {
  nodes: [
    { id: 'trigger', type: 'trigger', config: { inputs: [{ name: 'take', type: 'integer', default: 70 }] } },
    { id: 'bank', type: 'bank', config: { bank: 'alpha', op: 'accounts' } },
    { id: 'map', type: 'map', config: { path: 'accounts', fields: [{ to: 'id', from: 'resourceId' }] } },
    { id: 'limit', type: 'limit', config: { n: '{{params.take}}' } },
    { id: 'respond', type: 'respond', config: { wrap: 'accounts', includeSource: false } },
  ],
  edges: [{ from: 'trigger', to: 'bank' }, { from: 'bank', to: 'map' }, { from: 'map', to: 'limit' }, { from: 'limit', to: 'respond' }],
};

test('inspection captures real input, resolved parameters and output without truncating execution', async () => {
  const result = await execute(flow, { tenant: 'test', captureData: true });
  const data = (id) => result.trace.find((entry) => entry.node === id).inspection;
  assert.equal(result.data.accounts.length, 70);
  assert.equal(data('bank').output.count, 80);
  assert.equal(data('bank').output.preview.value.accounts.length, 50);
  assert.equal(data('bank').output.preview.truncated, true);
  assert.equal(data('bank').output.preview.value.accounts[0].token, '[REDACTED]');
  assert.equal(data('bank').output.preview.redacted, true);
  assert.equal(data('map').input.sources[0].node, 'bank');
  assert.equal(data('map').output.preview.value[0].id, 'account-0');
  assert.equal(data('limit').parameters.value.n, 70);
  assert.equal(flow.nodes[3].config.n, '{{params.take}}');
  assert.equal(data('trigger').output.preview.value.take, 70);
  assert.equal(data('respond').output.kind, 'response');
  assert.equal(data('respond').output.count, 70);
  assert.equal(data('respond').output.preview.value.accounts[0].id, result.data.accounts[0].id);
  assert.equal(accounts[0].token, 'secret-token');
  data('map').output.preview.value[0].id = 'changed';
  assert.equal(result.data.accounts[0].id, 'account-0');
});

test('public execution opts out of previews and errors retain their incoming data', async () => {
  const result = await execute(flow, { tenant: 'test' });
  assert.ok(result.trace.every((entry) => !('inspection' in entry)));
  const broken = structuredClone(flow);
  broken.nodes[1].config.op = 'invalid';
  const failed = await execute(broken, { tenant: 'test', captureData: true });
  const entry = failed.trace.find((item) => item.node === 'bank');
  assert.equal(entry.ok, false);
  assert.match(entry.inspection.output.preview.value.error, /unknown op/);
  assert.equal(entry.inspection.input.sources[0].preview.value.take, 70);
});

test('previews redact nested credentials, detach data and obey shared budgets', () => {
  const original = { nested: { 'api-key': 'secret', text: 'Bearer abc', key: '-----BEGIN PRIVATE KEY-----\nsecret' }, label: 'x'.repeat(3000) };
  const preview = snapshot(original);
  assert.equal(preview.value.nested['api-key'], '[REDACTED]');
  assert.equal(preview.value.nested.text, '[REDACTED]');
  assert.equal(preview.value.nested.key, '[REDACTED]');
  assert.equal(preview.truncated, true);
  assert.equal(original.nested.text, 'Bearer abc');
  const budget = { remaining: 80 };
  snapshot({ value: 'a'.repeat(50) }, budget);
  assert.equal(snapshot(original, budget).omitted, true);
});
