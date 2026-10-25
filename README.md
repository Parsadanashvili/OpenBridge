# OpenBridge AI

Open Banking interoperability & API-quality auditor (Georgian XS2A profile, Berlin Group based). Hackathon MVP.

```bash
npm install        # install backend + React frontend dependencies
npm start          # sim banks (:4101 alpha, :4102 beta) + NBG console http://localhost:4000/nbg + Flow Studio http://localhost:4000/studio?tenant=demo-tpp
npm run dev        # React / Vite development server (:5173), proxies APIs to :4000
npm run build      # production frontend -> dist/ (also runs automatically before npm start)
npm run audit      # headless audit -> out/latest-run.json + reports in out/
npm test           # 122 automated backend checks; simulator ports 4101/4102 must be free
npm run test:isolated # same backend checks, isolated ports and temporary data
npx playwright install chromium # once, to install the browser used by UI tests
npm run test:ui    # browser acceptance tests; uses disposable tenant data + separate simulators
npm run rulebook   # regenerate docs/RULEBOOK.md (115 rules from the standards, each with section + page)
npm run docaudit   # OFFLINE documentation audit of the saved BOG/TBC contracts (no bank contact)
npm run fetch-specs # re-download the public contracts into specs/ with sha256 provenance
npm run dataset    # writes generated synthetic customers to out/ and prints a sample
```
Node 20.19+ or 22.12+. The backend uses `yaml` to read BOG's OpenAPI; the frontend uses React, Vite, React Flow and Lucide icons. `npm start` builds the React app before starting the backend. For hot reload, leave that server running and open the URL printed by `npm run dev` in a second terminal. The API proxy target can be changed with `OPENBRIDGE_API_URL`.

Optional: `ANTHROPIC_API_KEY=... npm start` turns the explanation layer from deterministic templates into AI-written (still grounded) text.

## Layout
| Path | What |
|---|---|
| `src/spec/rulebook.js` | **The rulebook**: 115 requirements extracted from the Georgian XS2A / JWS / OAuth guides + Berlin Group, each with level (MUST/MUST NOT/SHOULD/MAY), section, printed page and status (implemented / planned / manual). Readable form: `docs/RULEBOOK.md` |
| `src/auditor/checks/` | Rulebook-driven checks: consent, accounts, transactions, security (JWS seal verification, error mapping, links, TLS) |
| `src/studio/` | Flow Studio: engine (DAG execution + trace), tenant store, bank connections, templates |
| `src/nbg/evidence.js` | Manual-rule evidence checklist recorded by NBG reviewers |
| `src/shared/jws.js` | Georgian JWS profile: signing + verification with per-rule violations |
| `specs/standards/` | The four standards PDFs (+ extracted text) the rules come from |
| `src/spec/profile.js` | Pinned reference rules: schemas + mandatory fields per operation (extracted teaching aid, **not** an official NBG OpenAPI) |
| `src/banks/` | Simulated banks. `profiles.js` = deliberate quirks; `datagen.js` = behaviour-driven synthetic customers (6 personas, 12 months, Georgian script, FX, pending/booked, valid IBANs) |
| `src/auditor/` | `runner.js` conformance + security + latency; `rules.js` rule catalogue; `http.js` single HTTP choke point (add mTLS/JWS here) |
| `src/ai/explain.js` | Grounded explanations; template fallback if no AI |
| `src/transform/canonical.js` | Bank B → canonical → Bank A, missing fields flagged never invented |
| `src/reports/generate.js` | Incompatibility + Quality reports from stored run |
| `src/docaudit/` | Offline documentation audit: `$ref` resolver + OpenAPI 3.0 validator, contract loader, checks, report. Snapshots live in `specs/` (BOG YAML verbatim, TBC OpenAPI extracted from portal pages, `PROVENANCE.json` with sha256) |
| `config/banks.json` | Banks under test; add a real sandbox with `simulated:false` |
| `frontend/console/` | React NBG console: overview, API auditor, findings, regulatory reports and evidence |
| `frontend/studio/` | React Flow editor, node settings, execution results, templates and graph/API adapters |
| `frontend/components/` | Shared React UI components, accessible dialogs and form fields |
| `frontend/styles.css` | Shared dark workspace theme, graph styling and responsive layouts |
| `dist/` | Generated production frontend, served by `src/server.js`; not committed |
| `tests/ui/` | Browser acceptance tests for editing, persistence, execution, publishing and the console |
| `docs/FRONTEND.md` | Frontend development, routes and workflow compatibility |
| `docs/PLAN.md` | 24h plan, ownership, demo script, open questions |
| `docs/REAL-DOCS-NOTES.md` | What BOG/TBC docs actually say, what we have/haven't read |

## Two audiences, one app
- **NBG console** (`/nbg`): audits, rulebook coverage, manual-evidence checklist, incompatibility/quality/documentation reports. Reporting is NBG-only.
- **Flow Studio** (`/studio?tenant=<slug>`): for banks/TPPs. An n8n-style canvas (trigger -> bank -> map -> merge/filter/sort/limit/aggregate -> respond) that builds ONE response shape from several banks and publishes it as `GET /t/<tenant>/<path>`. Values are normalised (decimal strings, ISO dates) or left null and listed in `meta.missing` - never invented. Each tenant has its own flows and bank connections (`data/tenants/<tenant>/`).
- Roles are a cookie switch (`/nbg` vs `/studio`), **not authentication** - deliberately out of scope for the hackathon.

Flow Studio now provides a searchable node library, drag/pan/zoom canvas, editable connections, automatic arrangement, undo/redo, structured node settings with a JSON editor, typed runtime inputs, table/JSON output, node execution logs and source issues. Workflows can be created from templates, saved and published or unpublished. The editor preserves the existing backend flow format; stored tenant flows do not need migration. Save with Cmd/Ctrl+S and execute with Cmd/Ctrl+Enter.

## Real banks (TBC, BOG)
Configured in `config/banks.json` with the sandbox hosts from the deck, `enabled:false`. They are **untested** and reported as NOT RUN until you provide certificates (mTLS + JWS signing key/cert under `certs/<id>/`) + `OB_<ID>_ACCESS_TOKEN` + `OB_<ID>_CONSENT_ID` (consent needs a human SCA approval). Request sealing (JWS profile), response-seal verification and the TLS/mTLS probe are implemented and tested against simulators and local TLS servers - never against a real bank.

## Honesty rules (baked in)
- Simulated banks are labelled everywhere and reports carry a banner.
- Untested controls are `not_assessed`, never `pass`.
- Rule references with `specRefVerified:false` still need a page check against the PDF.
- Tokens are redacted in stored evidence (selftest enforces it).
