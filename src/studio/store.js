// Tenant-scoped storage for Flow Studio (JSON files under data/tenants/<tenant>/). No authentication by design:
// the tenant slug is the boundary. Flows and bank connections of one tenant are never visible to another.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..', 'data', 'tenants');
const SLUG = /^[a-z0-9][a-z0-9-]{1,31}$/;
const ok = (s) => SLUG.test(s || '');
const dir = (tenant, ...p) => { if (!ok(tenant)) throw Object.assign(new Error('invalid tenant slug (a-z, 0-9, -, 2-32 chars)'), { status: 400 }); return path.join(ROOT, tenant, ...p); };
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };

const listTenants = () => (fs.existsSync(ROOT) ? fs.readdirSync(ROOT).filter(ok) : []);
const listFlows = (t) => { const d = dir(t, 'flows'); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(d, f))).filter(Boolean) : []; };
const getFlow = (t, id) => (ok(id) ? readJson(dir(t, 'flows', `${id}.json`), null) : null);
function saveFlow(t, flow) {
  if (!ok(flow.id)) throw Object.assign(new Error('invalid flow id'), { status: 400 });
  const prev = getFlow(t, flow.id);
  const f = { ...flow, tenant: t, version: (prev ? prev.version || 0 : 0) + 1, updatedAt: new Date().toISOString() };
  if (prev && prev.published && !('published' in flow)) f.published = prev.published;
  if (!f.published) delete f.published;
  writeJson(dir(t, 'flows', `${flow.id}.json`), f); return f;
}
const deleteFlow = (t, id) => { const f = dir(t, 'flows', `${id}.json`); if (fs.existsSync(f)) fs.unlinkSync(f); };
// Published paths may contain parameters: "accounts/{accountId}/transactions". Static segments beat parameters.
const SEG = /^(?:[a-z0-9][a-z0-9-]*|\{[A-Za-z_]\w*\})$/;
const pathParams = (pattern) => (pattern.match(/\{([A-Za-z_]\w*)\}/g) || []).map((x) => x.slice(1, -1));
const shape = (pattern) => pattern.split('/').map((s) => (s.startsWith('{') ? '{}' : s)).join('/');
function validPattern(pattern) { const segs = String(pattern || '').split('/'); return segs.length <= 8 && segs.every((s) => SEG.test(s)) && new Set(pathParams(pattern)).size === pathParams(pattern).length; }
function matchPublished(t, reqPath) {
  const segs = reqPath.replace(/^\/+|\/+$/g, '').split('/');
  let best = null;
  for (const f of listFlows(t)) {
    if (!f.published) continue;
    const pat = f.published.path.split('/'); if (pat.length !== segs.length) continue;
    const params = {}; let score = 0, ok = true;
    for (let i = 0; i < pat.length && ok; i++) {
      if (pat[i].startsWith('{')) { try { params[pat[i].slice(1, -1)] = decodeURIComponent(segs[i]); } catch { ok = false; } }
      else if (pat[i] === segs[i]) score++; else ok = false;
    }
    if (ok && (!best || score > best.score)) best = { flow: f, params, score };
  }
  return best;
}
const findPublished = (t, p) => { const m = matchPublished(t, p); return m && m.flow; };
const findByShape = (t, pattern) => listFlows(t).find((f) => f.published && shape(f.published.path) === shape(pattern));
const getConnections = (t) => readJson(dir(t, 'connections.json'), {});
const saveConnections = (t, c) => writeJson(dir(t, 'connections.json'), c);
module.exports = { ok, listTenants, listFlows, getFlow, saveFlow, deleteFlow, findPublished, matchPublished, findByShape, validPattern, pathParams, getConnections, saveConnections };
