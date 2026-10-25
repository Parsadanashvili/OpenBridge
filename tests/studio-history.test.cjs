const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openbridge-history-test-'));
  const target = path.join(root, 'src/studio'); fs.mkdirSync(target, { recursive: true });
  for (const file of ['history.js', 'store.js', 'inspection.js']) fs.copyFileSync(path.join(__dirname, '../src/studio', file), path.join(target, file));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { history: require(path.join(target, 'history')), root, target };
}
const flow = { id: 'example-flow', version: 2, nodes: [{ id: 'trigger', type: 'trigger', config: { token: 'secret' } }], edges: [] };
const result = (items, ok = true) => ({ data: { items }, meta: { inputs: { password: 'hidden' } }, trace: [{ node: 'trigger', type: 'trigger', ok, ms: 5, count: items.length, inspection: { output: { count: items.length, preview: { value: items } } } }] });

test('history persists bounded redacted output, respects tenant/flow scopes and survives reload', (t) => {
  const { history, target } = setup(t);
  const original = result(Array.from({ length: 80 }, (_, i) => ({ id: i, token: 'private' })));
  const saved = history.save('tenant-one', flow, original, new Date().toISOString());
  assert.equal(saved.status, 'success');
  assert.equal(saved.result.data.items.length, 50);
  assert.equal(saved.outputPreview.truncated, true);
  assert.equal(saved.result.data.items[0].token, '[REDACTED]');
  assert.equal(saved.result.meta.inputs.password, '[REDACTED]');
  assert.equal(saved.flow.nodes[0].config.token, '[REDACTED]');
  assert.equal(original.data.items[0].token, 'private');
  assert.ok(!JSON.stringify(saved).includes('private'));
  delete require.cache[require.resolve(path.join(target, 'history'))];
  const reloaded = require(path.join(target, 'history'));
  assert.equal(reloaded.list('tenant-one', flow.id)[0].id, saved.id);
  assert.equal(reloaded.get('tenant-two', flow.id, saved.id), null);
  assert.equal(reloaded.get('tenant-one', 'different-flow', saved.id), null);
  assert.equal(reloaded.get('tenant-one', flow.id, '../../secret'), null);
  assert.throws(() => reloaded.list('../escape', flow.id), /invalid history scope/);
});

test('comparison detects full response changes beyond preview and node status/count changes', (t) => {
  const { history } = setup(t);
  const items = Array.from({ length: 70 }, (_, i) => ({ id: i }));
  const before = history.save('tenant-one', flow, result(items), new Date().toISOString());
  const changed = structuredClone(items); changed[69].id = 999;
  const after = history.save('tenant-one', flow, result(changed), new Date().toISOString());
  assert.deepEqual(before.result.data, after.result.data);
  assert.equal(history.compare(after, before).outputChanged, true);
  const failed = history.save('tenant-one', flow, result([], false), new Date().toISOString());
  assert.equal(failed.status, 'failed');
  assert.equal(history.compare(failed, before).changes[0].change, 'status');
  const fewer = history.save('tenant-one', flow, result([{ id: 0 }]), new Date().toISOString());
  assert.equal(history.compare(fewer, before).changes[0].change, 'count');
  const rejected = history.save('tenant-one', flow, null, new Date().toISOString(), 'invalid input');
  assert.equal(rejected.status, 'failed'); assert.equal(rejected.error, 'invalid input');
});

test('retention removes old runs while preserving other workflows', (t) => {
  const { history, root } = setup(t);
  const other = history.save('tenant-one', { ...flow, id: 'other-flow' }, result([]), '2026-01-01T00:00:00.000Z');
  for (let i = 0; i < 23; i++) history.save('tenant-one', flow, result([{ id: i }]), new Date(Date.UTC(2026, 0, i + 1)).toISOString());
  const retained = history.list('tenant-one', flow.id);
  assert.equal(retained.length, 20);
  assert.equal(retained[0].startedAt, '2026-01-23T00:00:00.000Z');
  assert.equal(retained[19].startedAt, '2026-01-04T00:00:00.000Z');
  assert.equal(fs.readdirSync(path.join(root, 'data/tenants/tenant-one/executions', flow.id)).length, 20);
  assert.equal(history.get('tenant-one', 'other-flow', other.id).id, other.id);
});
