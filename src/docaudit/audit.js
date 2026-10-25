// Offline documentation audit: no bank access, no tokens. Evidence = the banks' own published contracts + examples.
// Claims are limited to what a document can show (workshop slides 28, 41-43): this finds documentation
// inconsistencies, schema-coverage gaps, applicability questions and contract differences - NOT runtime defects.
const { validate, flatten, deref } = require('./schema');
const { loadAll } = require('./contracts');
const fs = require('fs'), path = require('path');
const { OPERATIONS } = require('../spec/profile');

const CLASS = {
  documentation_inconsistency: 'Documentation inconsistency (example contradicts its own schema)',
  schema_coverage: 'Schema coverage (schema is looser than its prose/profile)',
  applicability_question: 'Applicability question (needs confirmed profile/edition)',
  contract_difference: 'Contract difference between banks (not automatically a defect)',
};
let n = 0;
const fid = () => `D-${String(++n).padStart(3, '0')}`;

function successMedia(o, direction) {
  if (direction === 'request') return o.request?.media.find((m) => /json/.test(m.contentType));
  return o.responses?.[o.op.status]?.media.find((m) => m.contentType === 'application/json');
}

function run() {
  n = 0;
  const C = loadAll(), findings = [], coverage = [], limitations = new Set();
  const F = (o) => { const f = { id: fid(), ...o }; findings.push(f); return f; };
  const buckets = new Map();
  const sevOf = { type: 'high', missing_required: 'medium', additionalProperties: 'medium', format: 'medium', enum: 'medium', pattern: 'medium' };

  for (const op of C.ops) for (const direction of op.key === 'consents' ? ['request', 'response'] : ['response']) {
    const row = { op: op.key, direction, banks: {} };
    const maps = {};
    for (const bank of ['bog', 'tbc']) {
      const o = C.byBank[bank][op.key], media = successMedia(o, direction), cell = row.banks[bank] = { schema: !!media?.schema, examples: 0, valid: 0, invalid: 0, loose: null };
      if (!media?.schema) continue;
      const ctx = o.ctx;
      maps[bank] = flatten(media.schema, ctx);

      // A. each published example against its own schema
      const seenRoot = new Map();
      for (const ex of media.examples) {
        if (ex.value === undefined) continue;
        cell.examples++;
        ctx.undeclared = [];
        const issues = validate(media.schema, ex.value, ctx);
        for (const u of ctx.undeclared) { const key = `U|${bank}|${op.key}|${direction}|${u.schemaPointer}|${u.key}`; if (seenRoot.has(key)) { seenRoot.get(key).exampleNames.push(ex.name); continue; } seenRoot.set(key, F({ bank, op: op.key, direction, classification: 'schema_coverage', ruleId: 'DOC-UNDECLARED', severity: 'low', title: 'Example contains a property the schema does not declare (permissive schema accepts it)', jsonPath: u.path, schemaPointer: u.schemaPointer, expected: `declared property (case-sensitive) - got "${u.key}"`, actual: 'accepted only because additionalProperties is not false', exampleNames: [ex.name], exampleRef: ex.ref, source: o.source, operation: `${op.method.toUpperCase()} ${op.path}`, limitation: 'A passing schema check does not prove the bank accepts or understands the property.', nextCheck: 'Runtime negative test with approved access.' })); }
        ctx.undeclared = null;
        if (!issues.length) { cell.valid++; continue; }
        cell.invalid++;
        for (const i of issues) {
          const key = `${bank}|${op.key}|${direction}|${i.code}|${i.schemaPointer}|${i.path.replace(/\[\d+\]/g, '[]')}`;
          if (seenRoot.has(key)) { const f = seenRoot.get(key); f.exampleNames.push(ex.name); continue; }
          const f = F({ bank, op: op.key, direction, classification: 'documentation_inconsistency', ruleId: 'DOC-EXAMPLE', severity: sevOf[i.code] || 'medium',
            title: `Published example violates its own schema (${i.code})`, jsonPath: i.path, schemaPointer: i.schemaPointer, expected: i.expected, actual: i.actual,
            exampleNames: [ex.name], exampleRef: ex.ref, source: o.source, operation: `${op.method.toUpperCase()} ${op.path}`,
            nextCheck: 'Ask the provider to correct the example or schema; confirm runtime behaviour only with approved sandbox access.' });
          seenRoot.set(key, f);
        }
      }

      // B. loose schema: does an empty object pass? (slide 40)
      if (direction === 'response' && media.schema) {
        const emptyOk = validate(media.schema, {}, ctx).length === 0; cell.loose = emptyOk;
        if (emptyOk) F({ bank, op: op.key, direction, classification: 'schema_coverage', ruleId: 'DOC-LOOSE', severity: 'medium', title: 'Response schema accepts an empty object {}',
          jsonPath: '$', schemaPointer: '#(root)', expected: 'wrapper/required fields enforced', actual: 'schema declares no required fields at the root', source: o.source, operation: `${op.method.toUpperCase()} ${op.path}`,
          limitation: 'Shows schema coverage only; does not show the server returns {}.', nextCheck: 'Runtime test with an approved consent.' });
      }
      for (const u of ctx.unsupported) limitations.add(`${bank}/${op.key}: ${u}`);
    }
    coverage.push(row);

    // C. Georgian profile (extracted rules) vs each bank's schema
    const prof = OPERATIONS[op.key];
    if (direction === 'response' && prof?.schema) {
      const pmap = flatten(prof.schema, { doc: {}, unsupported: new Set() });
      for (const bank of ['bog', 'tbc']) {
        const bm = maps[bank]; if (!bm) continue;
        for (const [p, a] of pmap) {
          if (!a.required || p === '$') continue;
          const b = bm.get(p);
          const o = C.byBank[bank][op.key];
          if (!b) F({ bank, op: op.key, direction, classification: 'applicability_question', ruleId: 'DOC-PROFILE', severity: 'low', title: 'Profile-mandatory field not declared in bank schema', jsonPath: p, schemaPointer: '-', expected: `declared (GE profile: mandatory) - ${prof.ref}`, actual: 'path not present in bank schema', source: o.source, operation: `${op.method.toUpperCase()} ${op.path}`, limitation: 'The GE rule catalog is an extracted teaching aid; confirm the applicable edition.', nextCheck: 'Confirm the organiser-provided baseline.' });
          else if (!b.required) F({ bank, op: op.key, direction, classification: 'applicability_question', ruleId: 'DOC-PROFILE', severity: 'medium', title: 'Profile-mandatory field is not required in bank schema', jsonPath: p, schemaPointer: '-', expected: `required (GE profile) - ${prof.ref}`, actual: `declared (${b.type || '?'}) but not in required list`, source: o.source, operation: `${op.method.toUpperCase()} ${op.path}`, limitation: 'Schema silence is not proof of runtime omission; local prose may add the requirement.', nextCheck: 'Read the bank prose conditions, then test with a consented sandbox call.' });
        }
      }
    }

    // D. cross-bank schema diff
    if (maps.bog && maps.tbc) {
      const paths = new Set([...maps.bog.keys(), ...maps.tbc.keys()]);
      const only = { bog: [], tbc: [] };
      for (const p of paths) {
        const a = maps.bog.get(p), b = maps.tbc.get(p);
        if (!a || !b) { (a ? only.bog : only.tbc).push(p); continue; }
        if (a.branch || b.branch) continue;
        for (const attr of ['type', 'format', 'nullable', 'required', 'enum', 'additionalProperties', 'pattern', 'maxLength']) {
          const x = a[attr], y = b[attr];
          if (x === y || (x === undefined && y === undefined) || (attr === 'enum' && (x === undefined || y === undefined))) continue;
          if (attr === 'nullable' && p === '$') continue;
          if (attr === 'type' && (!x || !y)) continue;
          const bk = `${op.key}|${direction}|${attr}`; if (!buckets.has(bk)) buckets.set(bk, { op, direction, attr, items: [] }); buckets.get(bk).items.push({ path: p, bog: x ?? 'unspecified', tbc: y ?? 'unspecified' });
        }
      }
      const norm = (p) => p.replace(/\._/g, '.').toLowerCase();
      const tbcNorm = new Map(only.tbc.map((p) => [norm(p), p]));
      const renamed = [];
      for (const p of only.bog) {
        const twin = tbcNorm.get(norm(p));
        if (twin) { renamed.push({ bog: p, tbc: twin }); only.tbc.splice(only.tbc.indexOf(twin), 1); only.bog.splice(only.bog.indexOf(p), 1, null); }
      }
      if (renamed.length) F({ bank: 'both', op: op.key, direction, classification: 'contract_difference', ruleId: 'DOC-DIFF', severity: 'medium', title: `Property naming differs: BOG "_links" vs TBC "links" (${renamed.length} paths)`, jsonPath: renamed.slice(0, 3).map((r) => `${r.bog} / ${r.tbc}`).join('; ') + (renamed.length > 3 ? ' ...' : ''), schemaPointer: '-', expected: 'BOG schema: _links', actual: 'TBC schema: links (TBC examples use _links)', attr: 'name', items: renamed, source: C.byBank.bog[op.key].source, source2: C.byBank.tbc[op.key].source, operation: `${op.method.toUpperCase()} ${op.path}` });
      for (const bank of ['bog', 'tbc']) { const list = only[bank].filter(Boolean).filter((p) => !/^\$\.(_?links)/.test(p)); if (list.length) F({ bank: 'both', op: op.key, direction, classification: 'contract_difference', ruleId: 'DOC-DIFF', severity: 'low', title: `${list.length} propert${list.length === 1 ? 'y' : 'ies'} declared only by ${bank.toUpperCase()}`, jsonPath: list.slice(0, 6).join(', ') + (list.length > 6 ? ` (+${list.length - 6})` : ''), schemaPointer: '-', expected: 'declared by both banks', actual: `only ${bank.toUpperCase()}`, attr: 'only-' + bank, source: C.byBank[bank][op.key].source, operation: `${op.method.toUpperCase()} ${op.path}` }); }
    }
  }

  for (const b of buckets.values()) {
    const kinds = [...new Set(b.items.map((i) => `${i.bog} -> ${i.tbc}`))].slice(0, 4).join('; ');
    F({ bank: 'both', op: b.op.key, direction: b.direction, classification: 'contract_difference', ruleId: 'DOC-DIFF', severity: ['type', 'format'].includes(b.attr) ? 'medium' : 'low', title: `Schema difference: ${b.attr} (${b.items.length} path${b.items.length > 1 ? 's' : ''})`,
      jsonPath: b.items.slice(0, 5).map((i) => i.path).join(', ') + (b.items.length > 5 ? ` (+${b.items.length - 5} more)` : ''), schemaPointer: '-', expected: `BOG vs TBC value pairs: ${kinds}`, actual: `${b.items.length} differing path(s)`, attr: b.attr, items: b.items, source: C.byBank.bog[b.op.key].source, source2: C.byBank.tbc[b.op.key].source, operation: `${b.op.method.toUpperCase()} ${b.op.path}` });
  }
  // E. parameter / header comparison + F. error contracts + G. security alternatives
  for (const op of C.ops) {
    const B = C.byBank.bog[op.key], T = C.byBank.tbc[op.key];
    const idx = (o) => Object.fromEntries((o.params || []).map((p) => [`${p.in}:${(p.name || '').toLowerCase().replace(/^x-jws-signature$/, 'signature')}`, p]));
    const bi = idx(B), ti = idx(T);
    for (const k of new Set([...Object.keys(bi), ...Object.keys(ti)])) {
      const a = bi[k], b = ti[k], nm = (a || b).name;
      if (/^header:psu-(?!ip-address)/i.test(k) || /^header:tpp-/i.test(k) && op.key !== 'consents') continue; // optional PSU-* context headers: noise
      if (!a || !b) { if (/psu-ip-address|consent-id|digest|signature|x-request-id|accept-language|bookingstatus|datefrom|dateto|withbalance/i.test(k) || (a || b).required) F({ bank: 'both', op: op.key, direction: 'input', classification: 'contract_difference', ruleId: 'DOC-PARAM', severity: (a || b).required ? 'medium' : 'low', title: `Parameter documented by ${a ? 'BOG' : 'TBC'} only`, jsonPath: `${(a || b).in}:${nm}`, schemaPointer: '-', expected: a ? 'BOG: ' + (a.required ? 'required' : 'optional') : 'TBC: ' + (b.required ? 'required' : 'optional'), actual: `${a ? 'TBC' : 'BOG'}: not documented`, source: B.source, source2: T.source, operation: `${op.method.toUpperCase()} ${op.path}` }); continue; }
      const diffs = [];
      if (a.required !== b.required) diffs.push(['required', a.required, b.required]);
      if ((a.type || '') !== (b.type || '')) diffs.push(['type', a.type, b.type]);
      if ((a.format || '') !== (b.format || '')) diffs.push(['format', a.format, b.format]);
      if (JSON.stringify(a.enum || null) !== JSON.stringify(b.enum || null)) diffs.push(['enum', (a.enum || []).join('|') || 'none', (b.enum || []).join('|') || 'none']);
      for (const [attr, x, y] of diffs) F({ bank: 'both', op: op.key, direction: 'input', classification: 'contract_difference', ruleId: 'DOC-PARAM', severity: attr === 'required' ? 'medium' : 'low', title: `Parameter ${attr} differs: ${nm}`, jsonPath: `${a.in}:${nm}`, schemaPointer: '-', expected: `BOG: ${x ?? 'unspecified'}`, actual: `TBC: ${y ?? 'unspecified'}`, attr, source: B.source, source2: T.source, operation: `${op.method.toUpperCase()} ${op.path}` });
    }
    // error documentation
    const errCodes = (o) => Object.keys(o.responses || {}).filter((c) => /^[45]/.test(c)).sort();
    const style = (o) => { const styles = new Set(); for (const c of errCodes(o)) for (const m of o.responses[c].media || []) { const mm = m.schema && flatten(m.schema, o.ctx); if (!mm) continue; if (mm.has('$.tppMessages')) styles.add('tppMessages'); if (mm.has('$.code') && (mm.has('$.type') || mm.has('$.title'))) styles.add('problem+json'); } return [...styles].sort(); };
    const sb = style(B), st = style(T);
    if (sb.join() !== st.join()) F({ bank: 'both', op: op.key, direction: 'response', classification: 'contract_difference', ruleId: 'DOC-ERROR', severity: 'medium', title: 'Documented error body styles differ', jsonPath: '4xx/5xx', schemaPointer: '-', expected: `BOG: ${sb.join(' + ') || 'none'}`, actual: `TBC: ${st.join(' + ') || 'none'}`, source: B.source, source2: T.source, operation: `${op.method.toUpperCase()} ${op.path}`, nextCheck: 'Clients must handle both styles; see runtime audit CONF-ERRFMT.' });
    const eb = errCodes(B), et = errCodes(T);
    const diff = [...eb.filter((c) => !et.includes(c)).map((c) => `BOG-only ${c}`), ...et.filter((c) => !eb.includes(c)).map((c) => `TBC-only ${c}`)];
    if (diff.length) F({ bank: 'both', op: op.key, direction: 'response', classification: 'contract_difference', ruleId: 'DOC-ERROR', severity: 'low', title: 'Documented error status codes differ', jsonPath: 'responses', schemaPointer: '-', expected: `BOG: ${eb.join(',')}`, actual: `TBC: ${et.join(',')}`, source: B.source, source2: T.source, operation: `${op.method.toUpperCase()} ${op.path}` });
    // security alternatives
    if (Array.isArray(B.security) && B.security.some((s) => Object.keys(s).length === 0)) F({ bank: 'bog', op: op.key, direction: 'security', classification: 'applicability_question', ruleId: 'DOC-SECURITY', severity: 'low', title: 'Operation security includes an empty (anonymous) alternative', jsonPath: 'security', schemaPointer: `#/paths/${op.path}/${op.method}/security`, expected: 'documented bearer/OAuth requirement', actual: 'security: [ {}, BearerAuthOAuth ]', source: B.source, operation: `${op.method.toUpperCase()} ${op.path}`, limitation: 'Does not show the operational API accepts anonymous requests (slide 23); check onboarding/security profile first.', nextCheck: 'Runtime SEC-noauth test with approved access.' });
  }

  const merged = new Map();
  for (let i = findings.length - 1; i >= 0; i--) {
    const f = findings[i]; if (!['DOC-PARAM', 'DOC-ERROR', 'DOC-SECURITY'].includes(f.ruleId)) continue;
    const key = [f.ruleId, f.bank, f.title, f.jsonPath, f.expected, f.actual].join('|');
    if (merged.has(key)) { merged.get(key).ops.unshift(f.op); findings.splice(i, 1); } else { f.ops = [f.op]; merged.set(key, f); }
  }
  for (const f of findings) { f.classificationLabel = CLASS[f.classification]; if (f.exampleNames) f.exampleNames = [...new Set(f.exampleNames)]; }
  const ex = coverage.flatMap((r) => Object.entries(r.banks).map(([bank, c]) => ({ bank, ...c })));
  const roots = new Set(findings.filter((f) => f.ruleId === 'DOC-EXAMPLE').map((f) => `${f.bank}|${f.schemaPointer}`));
  return {
    generatedAt: new Date().toISOString(), sources: C.providers.map((p) => ({ bank: p.bank, name: p.name, server: p.server })),
    provenance: (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'specs', 'PROVENANCE.json'), 'utf8')); } catch { return null; } })(),
    coverage, findings, limitations: [...limitations],
    summary: {
      examplesChecked: ex.reduce((a, c) => a + c.examples, 0), examplesValid: ex.reduce((a, c) => a + c.valid, 0), examplesInvalid: ex.reduce((a, c) => a + c.invalid, 0),
      distinctExampleRootCauses: roots.size, findings: findings.length,
      byClass: findings.reduce((a, f) => ((a[f.classification] = (a[f.classification] || 0) + 1), a), {}),
      note: 'Counts are documentation observations. Several failures can share one root cause; this is not a defect count or a bank quality score (workshop slide 43).',
    },
    classLabels: CLASS,
  };
}
module.exports = { run, CLASS };
