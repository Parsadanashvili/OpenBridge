const http = require('http');
const fs = require('fs');
const path = require('path');
const { startAll } = require('./banks/sim');
const { runAudit, loadConfig, saveRun, loadRun } = require('./auditor/runner');
const { call, getToken } = require('./auditor/http');
const { explainFinding } = require('./ai/explain');
const { transformAccountList } = require('./transform/canonical');
const R = require('./reports/generate');
const docaudit = require('./docaudit/audit');
const rulebook = require('./spec/rulebook');
const evidence = require('./nbg/evidence');
const studio = { store: require('./studio/store'), engine: require('./studio/engine'), conn: require('./studio/connections'), templates: require('./studio/templates').TEMPLATES };
// Role separation placeholder - NOT authentication. /nbg sets role=nbg, /studio sets role=tenant. Regulatory reporting is NBG-only.
const roleOf = (req) => (/(?:^|;\s*)ob_role=(nbg|tenant)/.exec(req.headers.cookie || '') || [])[1] || 'nbg';
const NBG_ONLY = [/^\/api\/reports\//, /^\/api\/evidence/, /^\/api\/run$/, /^\/api\/latest$/, /^\/api\/findings$/, /^\/api\/rulebook$/, /^\/api\/docaudit$/];
const readBody = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => { try { r(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch { r(null); } }); });
const { docAuditMd } = require('./docaudit/report');
let docCache = null;

const PORT = process.env.PORT || 4000;
const PUB = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
let running = false, progress = [];

const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const text = (res, type, body, name) => { res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', ...(name ? { 'Content-Disposition': `attachment; filename="${name}"` } : {}) }); res.end(body); };

async function explainAll(run) {
  const out = {};
  await Promise.all(run.findings.map(async (f) => { out[f.id] = await explainFinding(f); }));
  return out;
}

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (p === '/studio') { const t = url.searchParams.get('tenant') || 'demo-tpp'; res.writeHead(302, { Location: `/studio.html?tenant=${encodeURIComponent(t)}`, 'Set-Cookie': 'ob_role=tenant; Path=/; SameSite=Lax' }); return res.end(); }
  // ---- Flow Studio API (tenant-scoped, no auth by design)
  let sm;
  if (p === '/api/studio/templates') return json(res, 200, studio.templates);
  if (p === '/api/studio/banks') return json(res, 200, loadConfig().banks.map((b) => ({ id: b.id, name: b.name, simulated: !!b.simulated, enabled: b.enabled !== false })));
  if ((sm = p.match(/^\/api\/studio\/([^/]+)\/(flows|connections)(?:\/([^/]+))?(?:\/(run|publish|unpublish))?$/))) {
    const [, tenant, kind, id, action] = sm;
    if (!studio.store.ok(tenant)) return json(res, 400, { error: 'invalid tenant slug (a-z, 0-9, -, 2-32 chars)' });
    if (kind === 'connections') {
      if (req.method === 'POST') { const b = await readBody(req); try { await studio.conn.connect(tenant, (b || {}).bank); return json(res, 200, studio.conn.publicView(tenant)); } catch (e) { return json(res, e.status || 500, { error: e.message }); } }
      return json(res, 200, studio.conn.publicView(tenant));
    }
    if (!id) {
      if (req.method === 'POST') { const b = await readBody(req) || {}; const tpl = studio.templates.find((x) => x.id === b.template); const flow = tpl ? { ...JSON.parse(JSON.stringify(tpl)), id: b.id || tpl.id } : { id: b.id, name: b.name || b.id, nodes: [{ id: 'trigger', type: 'trigger', x: 40, y: 160, config: {} }, { id: 'respond', type: 'respond', x: 600, y: 160, config: { wrap: 'items' } }], edges: [] }; try { return json(res, 201, studio.store.saveFlow(tenant, flow)); } catch (e) { return json(res, e.status || 500, { error: e.message }); } }
      return json(res, 200, studio.store.listFlows(tenant).map((f) => ({ id: f.id, name: f.name, version: f.version, published: f.published, updatedAt: f.updatedAt })));
    }
    const flow = studio.store.getFlow(tenant, id);
    if (req.method === 'PUT' && !action) { const b = await readBody(req); if (!b) return json(res, 400, { error: 'invalid JSON' }); delete b.published; try { return json(res, 200, studio.store.saveFlow(tenant, { ...b, id })); } catch (e) { return json(res, e.status || 500, { error: e.message }); } }
    if (!flow) return json(res, 404, { error: 'flow not found' });
    if (req.method === 'DELETE') { studio.store.deleteFlow(tenant, id); return json(res, 200, { deleted: id }); }
    if (action === 'run') { const b = await readBody(req) || {}; try { return json(res, 200, await studio.engine.execute(b.flow || flow, { tenant, params: b.params || {}, psuIp: req.socket.remoteAddress })); } catch (e) { return json(res, e.status || 500, { error: e.message, ...(e.errors ? { errors: e.errors } : {}) }); } }
    if (action === 'publish') {
      const b = await readBody(req) || {}; const pth = String(b.path || flow.publishPath || flow.id).replace(/^\/+|\/+$/g, '');
      if (!studio.store.validPattern(pth)) return json(res, 400, { error: 'path: segments of a-z, 0-9, - or {param} (e.g. accounts/{accountId}/transactions)' });
      const declared = studio.engine.inputSpec(flow).map((i) => i.name), undeclared = studio.store.pathParams(pth).filter((x) => !declared.includes(x));
      if (undeclared.length) return json(res, 400, { error: `path parameter(s) ${undeclared.map((x) => `{${x}}`).join(', ')} must be declared as trigger inputs` });
      const other = studio.store.findByShape(tenant, pth); if (other && other.id !== id) return json(res, 409, { error: `path conflicts with /${other.published.path} (flow ${other.id})` });
      return json(res, 200, studio.store.saveFlow(tenant, { ...flow, published: { path: pth, params: studio.store.pathParams(pth), version: flow.version + 1, at: new Date().toISOString() } }));
    }
    if (action === 'unpublish') { studio.store.saveFlow(tenant, { ...flow, published: null }); return json(res, 200, { unpublished: id }); }
    return json(res, 200, flow);
  }
  // ---- published endpoints: GET /t/<tenant>/<path>?inputs  or  POST with a JSON body of inputs.  GET /t/<tenant> describes them.
  if ((sm = p.match(/^\/t\/([^/]+)\/?$/))) {
    const tenant = sm[1]; if (!studio.store.ok(tenant)) return json(res, 404, { error: 'unknown tenant' });
    return json(res, 200, { tenant, endpoints: studio.store.listFlows(tenant).filter((f) => f.published).map((f) => ({ method: 'GET|POST', path: `/t/${tenant}/${f.published.path}`, pathParams: studio.store.pathParams(f.published.path), flow: f.id, name: f.name, description: f.description, version: f.version, inputs: studio.engine.inputSpec(f) })) });
  }
  if ((sm = p.match(/^\/t\/([^/]+)\/(.+)$/))) {
    const [, tenant, pth] = sm;
    if (!studio.store.ok(tenant)) return json(res, 404, { error: 'unknown tenant' });
    const m = studio.store.matchPublished(tenant, pth);
    if (!m) return json(res, 404, { error: `no published endpoint /t/${tenant}/${pth}` });
    const flow = m.flow;
    if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'use GET (query inputs) or POST (JSON body inputs)' });
    const bodyIn = req.method === 'POST' ? await readBody(req) : {};
    if (bodyIn === null) return json(res, 400, { error: 'body must be JSON' });
    try { const out = await studio.engine.execute(flow, { tenant, params: { ...Object.fromEntries(url.searchParams), ...bodyIn, ...m.params }, psuIp: req.socket.remoteAddress }); const { trace, ...body } = out; return json(res, out.meta.notFound ? 404 : 200, out.meta.notFound ? { error: 'not found', ...body } : body); }
    catch (e) { return json(res, e.status || 500, { error: e.message, ...(e.errors ? { errors: e.errors, inputs: studio.engine.inputSpec(flow) } : {}) }); }
  }
  if (p === '/nbg') { res.writeHead(302, { Location: '/', 'Set-Cookie': 'ob_role=nbg; Path=/; SameSite=Lax' }); return res.end(); }
  if (p === '/' || p === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store', 'Set-Cookie': 'ob_role=nbg; Path=/; SameSite=Lax' }); return res.end(fs.readFileSync(path.join(PUB, 'index.html'))); } // the NBG console
  if (NBG_ONLY.some((re) => re.test(p)) && roleOf(req) !== 'nbg') return json(res, 403, { error: 'NBG only: regulatory reporting is available in the NBG console (/nbg)' });
  if (p === '/api/evidence' && req.method === 'GET') { const run = loadRun(); return json(res, 200, { statuses: evidence.STATUSES, checklist: evidence.checklist(run ? run.banks.map((b) => b.id) : loadConfig().banks.filter((b) => b.enabled !== false).map((b) => b.id)) }); }
  if (p === '/api/evidence' && req.method === 'POST') { const b = await readBody(req); try { return json(res, 200, evidence.record(b || {})); } catch (e) { return json(res, 400, { error: e.message }); } }
  if (p === '/api/config') return json(res, 200, loadConfig());
  if (p === '/api/run' && req.method === 'POST') {
    if (running) return json(res, 409, { error: 'audit already running' });
    running = true; progress = [];
    runAudit(loadConfig(), { onProgress: (m) => progress.push({ t: Date.now(), m }) })
      .then(saveRun).catch((e) => progress.push({ t: Date.now(), m: `ERROR ${e.message}` })).finally(() => { running = false; progress.push({ t: Date.now(), m: 'done' }); });
    return json(res, 202, { started: true });
  }
  if (p === '/api/progress') return json(res, 200, { running, progress });
  if (p === '/api/latest') return json(res, 200, loadRun());
  if (p === '/api/findings') {
    const run = loadRun(); if (!run) return json(res, 404, { error: 'no run yet' });
    const ex = await explainAll(run);
    return json(res, 200, run.findings.map((f) => ({ ...f, explanation: ex[f.id] })));
  }
  if (p === '/api/rulebook') { const run = loadRun(); return json(res, 200, { summary: rulebook.summary(), rules: rulebook.rules, coverage: run ? run.ruleCoverage : null, banks: run ? run.banks.map((b) => b.id) : [] }); }
  if (p === '/api/reports/rulebook.md') return text(res, 'text/markdown', fs.readFileSync(path.join(__dirname, '..', 'docs', 'RULEBOOK.md'), 'utf8'), 'openbridge-rulebook.md');
  if (p === '/api/docaudit') { docCache = docCache || docaudit.run(); return json(res, 200, docCache); }
  if (p === '/api/transform') {
    const bank = loadConfig().banks.find((b) => b.id === 'beta'); const { token } = await getToken(bank);
    const c = await call(bank, { method: 'POST', path: '/0.8/v1/consents', body: { access: { availableAccounts: 'allAccounts' }, recurringIndicator: true, validUntil: '2026-12-31', frequencyPerDay: 4, combinedServiceIndicator: false }, token });
    const r = await call(bank, { path: '/0.8/v1/accounts?withBalance=true', headers: { 'Consent-ID': c.json.consentId }, token });
    return json(res, 200, { source: { bank: bank.name, simulated: true, response: r.json }, result: transformAccountList(r.json) });
  }
  if (p === '/api/reports/doc-audit.md') { docCache = docCache || docaudit.run(); return text(res, 'text/markdown', docAuditMd(docCache), 'openbridge-documentation-audit.md'); }
  if (p.startsWith('/api/reports/')) {
    const run = loadRun(); if (!run) return json(res, 404, { error: 'no run yet' });
    const ex = p.includes('incompat') ? await explainAll(run) : {};
    switch (p.split('/').pop()) {
      case 'incompatibility.md': return text(res, 'text/markdown', R.incompatibilityMd(run, ex, evidence.checklist(run.banks.map((b) => b.id))), 'openbridge-incompatibility-report.md');
      case 'incompatibility.json': return text(res, 'application/json', JSON.stringify({ run: run.runId, findings: run.findings, security: run.security }, null, 2), 'openbridge-incompatibility-report.json');
      case 'quality.md': return text(res, 'text/markdown', R.qualityMd(run), 'openbridge-quality-report.md');
      case 'quality.csv': return text(res, 'text/csv', R.qualityCsv(run), 'openbridge-quality-report.csv');
    }
  }
  // static
  const file = path.join(PUB, p === '/' ? 'index.html' : p);
  if (file.startsWith(PUB) && fs.existsSync(file) && fs.statSync(file).isFile()) return text(res, MIME[path.extname(file)] || 'text/plain', fs.readFileSync(file));
  json(res, 404, { error: 'not found' });
}

(async () => {
  await startAll();
  http.createServer((req, res) => route(req, res).catch((e) => json(res, 500, { error: e.message }))).listen(PORT, () => console.log(`OpenBridge dashboard: http://localhost:${PORT}`));
})();
