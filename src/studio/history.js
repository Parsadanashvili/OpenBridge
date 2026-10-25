// Studio-only run history. Snapshots are redacted, bounded and never execution inputs.
const fs = require('fs');
const path = require('path');
const { randomUUID, createHash } = require('crypto');
const { ok } = require('./store');
const { snapshot } = require('./inspection');
const ROOT = path.join(__dirname, '../../data/tenants');
const RETAIN = 20;
const validRun = (id) => /^[0-9a-f-]{36}$/.test(id || '');
function directory(tenant, flow) {
  if (!ok(tenant) || !ok(flow)) throw Object.assign(new Error('invalid history scope'), { status: 400 });
  return path.join(ROOT, tenant, 'executions', flow);
}
const read = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
// Sorted object keys make hashes independent of key insertion order. Array order is meaningful.
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
  return value;
}
const digest = (value) => createHash('sha256').update(JSON.stringify(stable(value)) ?? 'null').digest('hex');
const summary = ({ id, startedAt, finishedAt, durationMs, status, version, nodes, outputHash, error }) => ({ id, startedAt, finishedAt, durationMs, status, version, nodes, outputHash, error });
function list(tenant, flow) {
  const dir = directory(tenant, flow);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => read(path.join(dir, f))).filter(Boolean).sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.finishedAt.localeCompare(a.finishedAt)).slice(0, RETAIN).map(summary);
}
function get(tenant, flow, id) {
  const dir = directory(tenant, flow);
  return validRun(id) ? read(path.join(dir, `${id}.json`)) : null;
}
function save(tenant, flow, result, startedAt, error) {
  const dir = directory(tenant, flow.id), id = randomUUID(), finishedAt = new Date().toISOString();
  const traceBudget = { remaining: 1024 * 1024 };
  const safeTrace = (result?.trace || []).map((entry) => {
    const captured = snapshot(entry, traceBudget);
    const safe = captured.value || { node: entry.node, type: entry.type, ok: entry.ok, ms: entry.ms };
    if (captured.truncated && safe.inspection) {
      if (safe.inspection.parameters) safe.inspection.parameters.truncated = true;
      for (const payload of [safe.inspection.output, ...(safe.inspection.input?.sources || [])]) if (payload?.preview) payload.preview.truncated = true;
    }
    return safe;
  });
  const nodes = safeTrace.map((entry, i) => ({ node: entry.node, type: entry.type, ok: entry.ok, skipped: entry.skipped, ms: entry.ms, count: result.trace[i].inspection?.output?.count ?? entry.count ?? 0, outputHash: digest(entry.inspection?.output?.preview?.value), error: entry.error }));
  const status = error || nodes.some((n) => !n.ok) ? 'failed' : result?.meta?.partial ? 'partial' : 'success';
  const output = snapshot(result?.data ?? null);
  const record = { id, startedAt, finishedAt, durationMs: Date.parse(finishedAt) - Date.parse(startedAt), status, version: flow.version || 0, nodes, outputHash: digest(result?.data ?? null), error: error ? snapshot(String(error)).value : undefined,
    flow: { id: flow.id, name: flow.name, version: flow.version, nodes: (flow.nodes || []).map((n) => ({ ...n, config: snapshot(n.config).value })), edges: flow.edges },
    result: { data: output.value, meta: snapshot(result?.meta || {}).value, trace: safeTrace },
    outputPreview: { truncated: output.truncated, redacted: output.redacted },
  };
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.json`), temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(record), { mode: 0o600 });
  fs.renameSync(temp, file);
  const keep = new Set(list(tenant, flow.id).map((r) => `${r.id}.json`));
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json') && !keep.has(f)) fs.unlinkSync(path.join(dir, f));
  return record;
}
function compare(current, baseline) {
  const before = new Map(baseline.nodes.map((n) => [n.node, n]));
  const changes = current.nodes.map((node) => {
    const prev = before.get(node.node); before.delete(node.node);
    return { node: node.node, change: !prev ? 'added' : prev.ok !== node.ok || prev.skipped !== node.skipped ? 'status' : prev.count !== node.count ? 'count' : prev.outputHash !== node.outputHash ? 'data' : 'unchanged', before: prev, after: node };
  });
  for (const node of before.values()) changes.push({ node: node.node, change: 'removed', before: node });
  return { baseline: summary(baseline), current: summary(current), outputChanged: current.outputHash !== baseline.outputHash, changes, baselineOutput: baseline.result.data, baselinePreview: baseline.outputPreview };
}
module.exports = { save, list, get, compare };
