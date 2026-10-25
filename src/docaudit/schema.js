// OpenAPI 3.0 schema tooling for the offline documentation audit: local $ref resolution, a validator that
// tracks both the data path and the schema pointer, and a flattener used for cross-bank schema diffs.
// Anything we cannot evaluate is recorded in ctx.unsupported and kept OUT of pass/fail totals.
const FMT = {
  date: (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')),
  'date-time': (s) => /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.test(s) && !isNaN(Date.parse(s)),
  uuid: (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
  uri: (s) => /^[a-z][a-z0-9+.-]*:/i.test(s),
  ipv4: (s) => /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(s),
  email: (s) => /^[^@\s]+@[^@\s]+$/.test(s),
};
const UNSUPPORTED_KEYS = ['discriminator', 'not', 'patternProperties', 'dependencies', 'if', 'then', 'else'];

function deref(node, ctx) { // follow local $ref chains
  let guard = 0, ptr = null;
  while (node && node.$ref) {
    if (!node.$ref.startsWith('#/')) { ctx.unsupported.add(`external $ref ${node.$ref}`); return { node: {}, ptr: node.$ref, broken: true }; }
    ptr = node.$ref;
    const t = node.$ref.slice(2).split('/').map((k) => k.replace(/~1/g, '/').replace(/~0/g, '~')).reduce((n, k) => (n == null ? n : n[k]), ctx.doc);
    if (t == null) { ctx.unsupported.add(`unresolved $ref ${node.$ref}`); return { node: {}, ptr, broken: true }; }
    node = t; if (++guard > 40) { ctx.unsupported.add(`$ref cycle ${ptr}`); return { node: {}, ptr, broken: true }; }
  }
  return { node, ptr };
}

function typeOf(v) { return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v; }

function validate(schema, data, ctx, dp = '$', sp = '#', depth = 0) {
  const issues = [];
  if (depth > 60) { ctx.unsupported.add('depth limit'); return issues; }
  const { node: s, ptr } = deref(schema, ctx); if (ptr) sp = ptr;
  for (const k of UNSUPPORTED_KEYS) if (k in s) ctx.unsupported.add(`keyword ${k} at ${sp}`);
  const add = (code, expected, actual, extra = {}) => issues.push({ path: dp, schemaPointer: sp, code, expected, actual, ...extra });

  if (s.allOf) for (const [i, sub] of s.allOf.entries()) issues.push(...validate(sub, data, ctx, dp, `${sp}/allOf/${i}`, depth + 1));
  if (s.oneOf) { const res = s.oneOf.map((sub, i) => validate(sub, data, ctx, dp, `${sp}/oneOf/${i}`, depth + 1)); const ok = res.filter((r) => r.length === 0).length; if (ok === 0) add('oneOf', 'exactly one branch to match', `no branch matched (${res.map((r) => r.length).join('/')} issues)`); else if (ok > 1) add('oneOf', 'exactly one branch to match', `${ok} branches matched`); }
  if (s.anyOf) { const res = s.anyOf.map((sub, i) => validate(sub, data, ctx, dp, `${sp}/anyOf/${i}`, depth + 1)); if (!res.some((r) => r.length === 0)) add('anyOf', 'at least one branch to match', 'no branch matched'); }

  if (data === null) { if (s.type && !s.nullable) add('type', `${s.type} (not nullable)`, 'null'); return issues; }
  const t = typeOf(data);
  if (s.type) {
    const ok = s.type === 'integer' ? Number.isInteger(data) : s.type === 'number' ? t === 'number' : s.type === t;
    if (!ok) { add('type', s.type, t, { value: preview(data) }); return issues; }
  }
  if (s.enum && !s.enum.includes(data)) add('enum', `one of ${s.enum.join('|')}`, preview(data), { value: preview(data) });
  if (t === 'string') {
    if (s.format && FMT[s.format] && !FMT[s.format](data)) add('format', s.format, preview(data), { value: preview(data) });
    if (s.pattern) { try { if (!new RegExp(s.pattern).test(data)) add('pattern', s.pattern, preview(data), { value: preview(data) }); } catch { ctx.unsupported.add(`pattern ${s.pattern}`); } }
    if (s.maxLength != null && data.length > s.maxLength) add('maxLength', `<= ${s.maxLength}`, `${data.length} chars`);
    if (s.minLength != null && data.length < s.minLength) add('minLength', `>= ${s.minLength}`, `${data.length} chars`);
  }
  if (t === 'number') {
    if (s.minimum != null && data < s.minimum) add('minimum', `>= ${s.minimum}`, String(data));
    if (s.maximum != null && data > s.maximum) add('maximum', `<= ${s.maximum}`, String(data));
    if (s.format === 'int32' && Number.isInteger(data) && Math.abs(data) > 2147483647) add('format', 'int32', String(data));
  }
  if (t === 'array') {
    if (s.minItems != null && data.length < s.minItems) add('minItems', `>= ${s.minItems}`, `${data.length}`);
    if (s.maxItems != null && data.length > s.maxItems) add('maxItems', `<= ${s.maxItems}`, `${data.length}`);
    if (s.items) data.forEach((it, i) => issues.push(...validate(s.items, it, ctx, `${dp}[${i}]`, `${sp}/items`, depth + 1)));
  }
  if (t === 'object') {
    const props = collectProps(s, ctx), req = collectRequired(s, ctx);
    for (const k of req) if (!(k in data)) issues.push({ path: `${dp}.${k}`, schemaPointer: `${sp}/required`, code: 'missing_required', expected: 'present', actual: 'absent' });
    for (const [k, sub] of Object.entries(props)) if (k in data) issues.push(...validate(sub, data[k], ctx, `${dp}.${k}`, `${sp}/properties/${k}`, depth + 1));
    const ap = s.additionalProperties;
    for (const k of Object.keys(data)) {
      if (k in props) continue;
      if (ctx.undeclared && ap !== false && !ap && !s.allOf) ctx.undeclared.push({ path: `${dp}.${k}`, schemaPointer: `${sp}`, key: k });
      if (ap === false && !s.allOf) issues.push({ path: `${dp}.${k}`, schemaPointer: `${sp}/additionalProperties`, code: 'additionalProperties', expected: 'property not declared & additionalProperties:false', actual: `undeclared property "${k}"` });
      else if (ap && typeof ap === 'object') issues.push(...validate(ap, data[k], ctx, `${dp}.${k}`, `${sp}/additionalProperties`, depth + 1));
    }
    if (ap === false && s.allOf) ctx.unsupported.add(`additionalProperties:false combined with allOf at ${sp}`);
  }
  return issues;
}
function collectProps(s, ctx) { let p = { ...(s.properties || {}) }; for (const sub of s.allOf || []) p = { ...p, ...collectProps(deref(sub, ctx).node, ctx) }; return p; }
function collectRequired(s, ctx) { let r = [...(s.required || [])]; for (const sub of s.allOf || []) r = r.concat(collectRequired(deref(sub, ctx).node, ctx)); return r; }
function preview(v) { const x = typeof v === 'string' ? v : JSON.stringify(v); return x && x.length > 60 ? x.slice(0, 57) + '...' : x; }

// Flatten a schema into path -> attributes, for diffing two banks' contracts.
function flatten(schema, ctx) {
  const out = new Map(), stack = [];
  (function walk(sch, path, req) {
    const { node: s, ptr } = deref(sch, ctx);
    if (ptr) { if (stack.includes(ptr)) { out.set(path, { ...(out.get(path) || {}), recursive: true }); return; } stack.push(ptr); }
    const props = collectProps(s, ctx), required = new Set(collectRequired(s, ctx));
    const type = s.type || (Object.keys(props).length ? 'object' : s.items ? 'array' : undefined);
    const attrs = { type, format: s.format, nullable: !!s.nullable, required: req, enum: s.enum ? [...s.enum].sort().join('|') : undefined, pattern: s.pattern, maxLength: s.maxLength };
    if (type === 'object') attrs.additionalProperties = s.additionalProperties === false ? 'false' : s.additionalProperties && typeof s.additionalProperties === 'object' ? 'schema' : 'permissive';
    if (s.oneOf || s.anyOf) attrs.composition = s.oneOf ? 'oneOf' : 'anyOf';
    out.set(path, attrs);
    for (const [k, sub] of Object.entries(props)) walk(sub, `${path}.${k}`, required.has(k));
    if (s.items) walk(s.items, `${path}[]`, false);
    for (const b of s.oneOf || s.anyOf || []) { const before = new Set(out.keys()); walk(b, path, false); for (const k of out.keys()) if (!before.has(k)) out.get(k).branch = true; }
    if (ptr) stack.pop();
  })(schema, '$', false);
  return out;
}

module.exports = { validate, flatten, deref };
