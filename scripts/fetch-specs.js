// Fetches the public bank API contracts into specs/ with provenance (url, retrieved, sha256). Idempotent.
//   BOG : downloadable OpenAPI YAML (api.bog.ge)           -> specs/bog/*.yaml  (kept byte-for-byte)
//   TBC : OpenAPI object embedded in each operation page   -> specs/tbc/<op>.json (extracted verbatim)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', 'specs');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const BOG = { url: 'https://api.bog.ge/docs/en/redocusaurus/plugin-redoc-0.yaml', file: 'bog/plugin-redoc-0.yaml' };
const TBC = ['aisreadaccountlist', 'aisreadaccountdetails', 'aisreadaccountbalance', 'aisreadaccounttransactionlist', 'aiscreateconsent', 'aisoauthtoken'];

function extractObject(html, marker) { // brace-match the JSON object that starts at marker (string-aware)
  const start = html.indexOf(marker); if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  return null;
}

(async () => {
  const prov = { retrievedAt: new Date().toISOString(), files: [] };
  fs.mkdirSync(path.join(ROOT, 'bog'), { recursive: true }); fs.mkdirSync(path.join(ROOT, 'tbc'), { recursive: true });
  const y = Buffer.from(await (await fetch(BOG.url)).arrayBuffer());
  fs.writeFileSync(path.join(ROOT, BOG.file), y); prov.files.push({ bank: 'bog', file: BOG.file, source: BOG.url, sha256: sha(y), bytes: y.length });
  for (const op of TBC) {
    const url = `https://developers.tbcbank.ge/reference/${op}`;
    const html = await (await fetch(url)).text();
    const raw = extractObject(html, '{"openapi":"3.0.1"');
    if (!raw) { console.error('no embedded OpenAPI in', url); continue; }
    JSON.parse(raw); // validate
    const f = `tbc/${op}.json`; fs.writeFileSync(path.join(ROOT, f), raw);
    prov.files.push({ bank: 'tbc', file: f, source: url, sha256: sha(Buffer.from(raw)), bytes: raw.length });
  }
  fs.writeFileSync(path.join(ROOT, 'PROVENANCE.json'), JSON.stringify(prov, null, 2));
  console.log(prov.files.map((f) => `${f.bank} ${f.file} ${f.bytes}B ${f.sha256.slice(0, 12)}`).join('\n'));
})();
