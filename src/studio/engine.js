// Flow engine: executes a node graph (DAG) and returns the output plus a per-node trace.
// Node types: trigger, bank, map, merge, filter, sort, limit, aggregate, respond.
// Principle (same as the transform showcase): values are mapped or normalised, NEVER invented - a missing source becomes null
// and is listed in meta.missing.
const { call } = require('../auditor/http');
const { validate } = require('../shared/validate');
const conn = require('./connections');
const { snapshot, outputPreview } = require('./inspection');

// ---- path helper: "a.b[0].c", "balances[?balanceType=interimAvailable].balanceAmount.amount", "$.accounts", "@bank", "=CONST"
function get(obj, p, meta = {}) {
  if (p == null || p === '' || p === '$') return obj;
  if (p.startsWith('=')) return p.slice(1);
  if (p.startsWith('@')) return meta[p.slice(1)];
  const toks = p.replace(/^\$\.?/, '').match(/[^.[\]]+|\[[^\]]*\]/g) || [];
  let cur = obj;
  for (const t of toks) {
    if (cur == null) return undefined;
    if (t.startsWith('[?')) { const m = /^\[\?([^=]+)=(.*)\]$/.exec(t); cur = Array.isArray(cur) ? cur.find((x) => x && String(x[m[1]]) === m[2]) : undefined; }
    else if (t.startsWith('[')) cur = cur[Number(t.slice(1, -1))];
    else cur = cur[t];
  }
  return cur;
}
const FN = {
  decimal: (v) => (v == null || v === '' ? null : typeof v === 'number' ? v.toFixed(2) : /^-?\d+(\.\d+)?$/.test(String(v)) ? Number(v).toFixed(2) : null),
  number: (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v)),
  isoDate: (v) => { if (v == null) return null; const s = String(v); if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return s.split('.').reverse().join('-'); const m = /^(\d{4}-\d{2}-\d{2})/.exec(s); return m ? m[1] : null; },
  upper: (v) => (v == null ? null : String(v).toUpperCase()), lower: (v) => (v == null ? null : String(v).toLowerCase()),
  string: (v) => (v == null ? null : String(v)), abs: (v) => (v == null || isNaN(Number(v)) ? null : Math.abs(Number(v)).toFixed(2)),
};
const setPath = (o, p, v) => { const ks = String(p || '').split('.'); if (ks.some((k) => !k || ['__proto__', 'prototype', 'constructor'].includes(k))) throw new Error('invalid output field path'); let c = o; ks.slice(0, -1).forEach((k) => { c = c[k] = Object.hasOwn(c, k) && c[k] && typeof c[k] === 'object' ? c[k] : {}; }); c[ks.at(-1)] = v; };

// ---- trigger inputs: [{ name, type: string|number|integer|boolean|date|enum, required, default, values[], description }]
// Legacy flows with config.params {k: default} are read as optional string inputs with those defaults.
function inputSpec(flow) {
  const t = (flow.nodes || []).find((n) => n.type === 'trigger'); const c = (t && t.config) || {};
  if (Array.isArray(c.inputs)) return c.inputs;
  return Object.entries(c.params || {}).map(([name, d]) => ({ name, type: 'string', required: false, default: d }));
}
function resolveInputs(spec, raw = {}) {
  const out = {}, errors = [];
  for (const s of spec) {
    let v = raw[s.name];
    if (v === undefined || v === '') v = s.default;
    if (v === undefined || v === null || v === '') { if (s.required) errors.push({ input: s.name, error: 'required' }); continue; }
    const str = String(v);
    switch (s.type || 'string') {
      case 'number': if (isNaN(Number(str))) errors.push({ input: s.name, error: 'must be a number', value: str }); else v = Number(str); break;
      case 'integer': if (!/^-?\d+$/.test(str)) errors.push({ input: s.name, error: 'must be an integer', value: str }); else { v = Number(str); if (s.min != null && v < s.min || s.max != null && v > s.max) errors.push({ input: s.name, error: `must be between ${s.min ?? '-inf'} and ${s.max ?? 'inf'}`, value: str }); } break;
      case 'boolean': if (!/^(true|false)$/i.test(str)) errors.push({ input: s.name, error: 'must be true or false', value: str }); else v = /^true$/i.test(str); break;
      case 'date': if (!/^\d{4}-\d{2}-\d{2}$/.test(str) || isNaN(Date.parse(str))) errors.push({ input: s.name, error: 'must be a date YYYY-MM-DD', value: str }); else v = str; break;
      case 'enum': if (!(s.values || []).map(String).includes(str)) errors.push({ input: s.name, error: `must be one of ${(s.values || []).join(', ')}`, value: str }); else v = str; break;
      default: v = str.slice(0, 200);
    }
    out[s.name] = v;
  }
  if (errors.length) throw Object.assign(new Error('invalid input'), { status: 400, errors });
  return out;
}
// "{{params.x}}" alone keeps the typed value; inside a longer string it is substituted as text. Unset -> null / ''.
function interpolate(v, params) {
  if (typeof v === 'string') { const whole = /^\{\{\s*params\.(\w+)\s*\}\}$/.exec(v); if (whole) return params[whole[1]] ?? null; return v.replace(/\{\{\s*params\.(\w+)\s*\}\}/g, (_, k) => (params[k] ?? '')); }
  if (Array.isArray(v)) return v.map((x) => interpolate(x, params));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'schema' ? x : interpolate(x, params)]));
  return v;
}

// ---- bank node
const OPS = {
  accounts: { path: (B, cfg) => `${B}/accounts${cfg.withBalance ? '?withBalance=true' : ''}`, items: 'accounts' },
  details: { perAccount: true, path: (B, cfg, id) => `${B}/accounts/${id}${cfg.withBalance === false ? '' : '?withBalance=true'}`, items: 'account' },
  balances: { perAccount: true, path: (B, cfg, id) => `${B}/accounts/${id}/balances`, items: 'balances' },
  transactions: { perAccount: true, path: (B, cfg, id) => `${B}/accounts/${id}/transactions?bookingStatus=${cfg.bookingStatus || 'booked'}${cfg.dateFrom ? `&dateFrom=${cfg.dateFrom}` : ''}${cfg.dateTo ? `&dateTo=${cfg.dateTo}` : ''}`, items: 'transactions.booked' },
};
async function bankNode(node, ctx) {
  const cfg = node.config || {};
  const op = OPS[cfg.op];
  if (!op) throw new Error(`bank node: unknown op "${cfg.op}" (accounts | details | balances | transactions)`);
  const bank = conn.bankCfg(cfg.bank), B = bank.basePath || '/0.8/v1';
  const key = op.items.split('.').pop();
  // account: "<bank>:<resourceId>" (unified id) or a bare resourceId. An id owned by another bank -> this node returns nothing.
  let only = cfg.account == null || cfg.account === '' ? null : String(cfg.account);
  if (only && only.includes(':')) { const [owner, ...rest] = only.split(':'); if (owner !== bank.id) return { meta: { bank: bank.id, op: cfg.op, status: 200, skipped: `account belongs to ${owner}`, sources: [] }, data: { [key]: [] } }; only = rest.join(':'); }
  const sources = [];
  const req = async (pth, c) => { // transient 5xx / timeouts are retried twice; every attempt is listed in meta.sources
    let r;
    for (let attempt = 0; attempt < 3; attempt++) {
      r = await call(bank, { path: pth, headers: { 'Consent-ID': c.consentId, 'PSU-IP-Address': ctx.psuIp || '127.0.0.1' }, token: c.token });
      sources.push({ bank: bank.id, path: pth.split('?')[0], status: r.status, latencyMs: Math.round(r.latencyMs || 0), ...(attempt ? { retry: attempt } : {}) });
      if (!(r.status >= 500 || r.timedOut || r.networkError)) break;
    }
    if (r.status !== 200) ctx.warnings.push(`${bank.id}: ${pth.split('?')[0]} -> HTTP ${r.status || r.networkError || 'timeout'}; data from this call is missing (partial response)`);
    return r;
  };
  let c = await conn.ensure(ctx.tenant, cfg.bank);
  let first = await req(op.perAccount ? `${B}/accounts` : op.path(B, cfg), c);
  if ((first.status === 401 || first.status === 403) && bank.simulated) { c = await conn.connect(ctx.tenant, cfg.bank); // stale token/consent (e.g. simulator restarted): reconnect once
    first = await req(op.perAccount ? `${B}/accounts` : op.path(B, cfg), c); }
  if (first.status !== 200) return { meta: { bank: bank.id, op: cfg.op, status: first.status, sources }, data: { error: first.json || first.bodyText } };
  if (!op.perAccount) return { meta: { bank: bank.id, op: cfg.op, status: 200, sources }, data: only ? { ...first.json, accounts: (first.json.accounts || []).filter((a) => a.resourceId === only) } : first.json };
  // per-account operations iterate the consented accounts (optionally one currency / the first n)
  let accs = first.json.accounts || [];
  if (only) accs = accs.filter((a) => a.resourceId === only);
  else { accs = accs.filter((a) => a.currency !== 'XXX'); if (cfg.currency) accs = accs.filter((a) => a.currency === cfg.currency); accs = accs.slice(0, cfg.maxAccounts || 3); }
  const out = [];
  for (const a of accs) {
    let r = await req(op.path(B, cfg, a.resourceId), c), pages = 0;
    while (r.status === 200) { // follow the bank's own paging links (first/next) up to maxPages
      const got = get(r.json, op.items); for (const it of Array.isArray(got) ? got : got ? [got] : []) out.push({ ...it, _account: { resourceId: a.resourceId, iban: a.iban, currency: a.currency } });
      const next = r.json && r.json.transactions && r.json.transactions._links && r.json.transactions._links.next;
      if (!next || ++pages >= (cfg.maxPages || 5)) break;
      r = await req(next.href, c);
    }
  }
  return { meta: { bank: bank.id, op: cfg.op, status: 200, sources }, data: { [key]: out } };
}

// ---- pure nodes
function mapNode(node, inputs, missing) {
  const cfg = node.config || {}, out = [];
  for (const inp of inputs) {
    const arr = Array.isArray(inp.items) ? inp.items : get(inp.data, cfg.path) || [];
    for (const item of arr) {
      const meta = { ...(inp.meta || {}), ...(item && item._meta) };
      const o = {};
      for (const f of cfg.fields || []) {
        let v;
        if (f.fmt) { let miss = false; v = f.fmt.replace(/\$\{([^}]+)\}/g, (_, pth) => { const x = get(item, pth.trim(), meta); if (x == null) miss = true; return x ?? ''; }); if (miss) v = null; } // "${@bank}:${resourceId}"
        else for (const alt of String(f.from || '').split('|')) { v = get(item, alt.trim(), meta); if (v !== undefined && v !== null) break; }
        if (f.fn && FN[f.fn]) v = FN[f.fn](v);
        if (v === undefined || v === null) { v = null; if (f.required !== false && !String(f.from || '').startsWith('=')) missing.push({ node: node.id, bank: meta.bank, field: f.to, from: f.from || f.fmt }); }
        setPath(o, f.to, v);
      }
      o._meta = { bank: meta.bank };
      out.push(o);
    }
  }
  return out;
}
const cmp = (op, a, b) => ({ eq: a == b, ne: a != b, gt: Number(a) > Number(b), lt: Number(a) < Number(b), contains: String(a ?? '').includes(b), exists: a != null }[op]);

async function execute(flow, { tenant, params: rawParams = {}, psuIp, captureData = false } = {}) {
  const params = resolveInputs(inputSpec(flow), rawParams);
  const nodes = Object.fromEntries((flow.nodes || []).map((n) => [n.id, n.type === 'trigger' ? n : { ...n, config: interpolate(n.config || {}, params) }]));
  const edges = flow.edges || [];
  const indeg = Object.fromEntries(Object.keys(nodes).map((k) => [k, 0]));
  edges.forEach((e) => { if (nodes[e.from] && nodes[e.to]) indeg[e.to]++; });
  const order = [], queue = Object.keys(indeg).filter((k) => indeg[k] === 0);
  while (queue.length) { const k = queue.shift(); order.push(k); edges.filter((e) => e.from === k).forEach((e) => { if (--indeg[e.to] === 0) queue.push(e.to); }); }
  if (order.length !== Object.keys(nodes).length) throw Object.assign(new Error('flow has a cycle'), { status: 400 });
  const results = {}, trace = [], missing = [], ctx = { tenant, params, psuIp, warnings: [] };
  const previewBudget = { remaining: 1024 * 1024 };
  let notFound = false;
  let response = null;
  for (const id of order) {
    const n = nodes[id], t0 = Date.now();
    const inputs = edges.filter((e) => e.to === id).map((e) => results[e.from]).filter(Boolean);
    const inspection = captureData ? {
      input: { sources: n.type === 'trigger'
        ? [{ node: null, type: 'parameters', ...outputPreview({ data: params }, 'trigger', undefined, previewBudget) }]
        : edges.filter((e) => e.to === id && results[e.from]).map((e) => ({ node: e.from, type: nodes[e.from].type, bank: results[e.from].meta?.bank, ...outputPreview(results[e.from], nodes[e.from].type, undefined, previewBudget) })) },
      parameters: snapshot(n.config || {}, previewBudget),
    } : undefined;
    const items = () => inputs.flatMap((i) => (Array.isArray(i.items) ? i.items : []));
    let r;
    try {
      switch (n.type) {
        case 'trigger': r = { data: params, items: [] }; break;
        case 'bank': r = await bankNode(n, ctx); break;
        case 'map': r = { items: mapNode(n, inputs, missing) }; break;
        case 'merge': r = { items: items() }; break;
        case 'filter': { const c = n.config || {}; r = { items: (c.value === null && c.op !== 'exists') ? items() : items().filter((x) => cmp(c.op || 'eq', get(x, c.field), c.value)) }; break; } // optional input not given -> filter is a no-op
        case 'sort': { const c = n.config || {}; const k = (x) => get(x, c.field); r = { items: [...items()].sort((a, b) => (k(a) > k(b) ? 1 : k(a) < k(b) ? -1 : 0) * (c.dir === 'desc' ? -1 : 1)) }; break; }
        case 'limit': r = { items: items().slice(0, Number((n.config || {}).n || 10)) }; break;
        case 'aggregate': {
          const c = n.config || {}, g = {};
          for (const x of items()) { const key = String(get(x, c.groupBy)); g[key] = g[key] || { [c.groupBy]: key, count: 0, [c.as || 'total']: 0 }; g[key].count++; g[key][c.as || 'total'] += Number(get(x, c.sum)) || 0; }
          r = { items: Object.values(g).map((x) => ({ ...x, [c.as || 'total']: x[c.as || 'total'].toFixed(2) })) }; break;
        }
        case 'respond': {
          const c = n.config || {}, list = items();
          const issues = c.schema ? list.flatMap((x, i) => validate(c.schema, x, `$.${c.wrap || 'items'}[${i}]`)) : [];
          const clean = list.map(({ _meta, ...rest }) => (c.includeSource === false ? rest : { ...rest, source: _meta && _meta.bank }));
          if (c.single) { response = { [c.wrap || 'item']: clean[0] ?? null }; if (!clean.length && c.notFound !== false) notFound = true; } // one resource; none -> 404
          else response = { [c.wrap || 'items']: clean };
          r = { items: list, issues }; break;
        }
        default: throw new Error(`unknown node type ${n.type}`);
      }
      trace.push({ node: id, type: n.type, ok: !(r.meta && r.meta.status && r.meta.status !== 200), skipped: r.meta && r.meta.skipped, ms: Date.now() - t0, count: Array.isArray(r.items) ? r.items.length : undefined, status: r.meta && r.meta.status, sources: r.meta && r.meta.sources, issues: r.issues && r.issues.length });
    } catch (e) { trace.push({ node: id, type: n.type, ok: false, ms: Date.now() - t0, error: e.message }); r = { items: [] }; }
    if (inspection) {
      const entry = trace[trace.length - 1];
      inspection.output = entry.error
        ? { kind: 'error', count: 0, preview: snapshot({ error: entry.error }, previewBudget) }
        : outputPreview(r, n.type, n.type === 'respond' ? response : undefined, previewBudget);
      entry.inspection = inspection;
    }
    results[id] = r;
  }
  const respondNode = order.map((k) => nodes[k]).find((n) => n.type === 'respond');
  return {
    data: response || { items: [] },
    meta: { flow: flow.id, version: flow.version, tenant, inputs: params, ...(notFound ? { notFound: true } : {}), partial: ctx.warnings.length > 0, warnings: ctx.warnings, generatedAt: new Date().toISOString(), sources: trace.flatMap((t) => t.sources || []), missing, schemaIssues: respondNode ? (results[respondNode.id].issues || []).slice(0, 50) : [], synthetic: true },
    trace,
  };
}
function previewMap(config, sources = [], params = {}) {
  if (!Array.isArray(config?.fields) || config.fields.length > 100 || !Array.isArray(sources) || sources.length > 10) throw new Error('mapping preview supports up to 100 fields and 10 sources');
  const budget = { remaining: 256 * 1024 }, missing = [];
  const inputs = sources.map((source) => {
    const value = snapshot(source.preview?.value, budget).value;
    return { ...(source.kind === 'items' ? { items: value } : { data: value }), meta: { bank: source.bank } };
  });
  const resolved = interpolate(config, params);
  const samples = inputs.map((input, i) => ({ node: sources[i].node, rows: (Array.isArray(input.items) ? input.items : get(input.data, resolved.path) || []).slice(0, 10) }));
  const items = mapNode({ id: 'preview', config: resolved }, inputs, missing);
  return { output: snapshot(items), missing: missing.slice(0, 100), samples: snapshot(samples).value, count: items.length };
}
module.exports = { execute, get, FN, inputSpec, resolveInputs, interpolate, previewMap };
