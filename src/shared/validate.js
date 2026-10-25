// Tiny deterministic JSON-schema-ish validator (zero deps). Every issue carries an exact JSON path.
const FORMATS = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
  amount: /^-?\d{1,14}(\.\d{1,3})?$/,
  currency: /^[A-Z]{3}$/,
  iban: /^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/,
  bic: /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/,
};

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function validate(schema, data, path = '$') {
  const issues = [];
  const t = typeOf(data);
  if (schema.type) {
    const ok = schema.type === 'integer' ? Number.isInteger(data) : schema.type === t;
    if (!ok) {
      issues.push({ path, code: 'type', expected: schema.type, actual: t, value: preview(data) });
      return issues;
    }
  }
  if (schema.enum && !schema.enum.includes(data)) {
    issues.push({ path, code: 'enum', expected: `one of ${schema.enum.join('|')}`, actual: preview(data), value: preview(data) });
  }
  if (schema.format && typeof data === 'string' && !FORMATS[schema.format].test(data)) {
    issues.push({ path, code: 'format', expected: schema.format, actual: preview(data), value: preview(data) });
  }
  if (t === 'object') {
    for (const key of schema.required || []) {
      if (!(key in data) || data[key] === null || data[key] === '') {
        issues.push({ path: `${path}.${key}`, code: 'missing_required', expected: 'present', actual: 'absent' });
      }
    }
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (key in data && data[key] !== null) issues.push(...validate(sub, data[key], `${path}.${key}`));
    }
  }
  if (t === 'array' && schema.items) {
    data.forEach((item, i) => issues.push(...validate(schema.items, item, `${path}[${i}]`)));
  }
  return issues;
}

function preview(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > 60 ? s.slice(0, 57) + '...' : s;
}

function ibanChecksumOk(iban) {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const s = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => c.charCodeAt(0) - 55);
  let rem = 0; for (const ch of s) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}

module.exports = { validate, FORMATS, ibanChecksumOk };
