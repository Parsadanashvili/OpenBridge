# React frontend

The two HTML applications have been replaced with a React application built by Vite. The CommonJS banking/auditing backend remains separate. No frontend framework runs inside the backend.

## Run locally

```bash
npm install
npm start
```

The start hook builds `frontend/` into `dist/`. The backend serves that output at port 4000, alongside its existing APIs and simulators.

For hot reload, keep the backend running and start `npm run dev` in another terminal. Open the Vite URL (normally port 5173). Requests under `/api` and `/t/` are proxied to port 4000. To use a different API server:

```bash
OPENBRIDGE_API_URL=http://127.0.0.1:4500 npm run dev
```

`npm run start:api` starts the backend without rebuilding the frontend. A production frontend must already be built to use its HTML routes.

## Routes and components

- `/`, `/index.html`, `/nbg`: regulatory console. Hash navigation selects overview, API auditor, findings or reports.
- `/studio?tenant=<slug>` and `/studio.html?tenant=<slug>`: Flow Studio. The backend keeps the existing `/studio` redirect.
- `/api/...` and `/t/<tenant>/...`: existing backend endpoints.

`frontend/main.jsx` selects and lazily loads the studio or console. Both are real React trees; there are no legacy HTML-string renderers or injected legacy scripts.

| Module | Responsibility |
| --- | --- |
| `components/ui.jsx` | Shared buttons, fields, modal focus behavior, notifications, error boundary |
| `api.js` | JSON requests and structured HTTP errors |
| `studio/Studio.jsx` | Workspace state, graph editing, persistence, connections and publishing |
| `studio/model.js` | Node catalog, graph adapters, layout and editor validation |
| `studio/Inspector.jsx` | Structured parameters and advanced JSON configuration |
| `studio/NodeDataPanel.jsx` | Per-node incoming sources, JSON/table output previews and copying |
| `studio/ExecutionPanel.jsx` | Runtime inputs, output table/JSON, traces and issues |
| `studio/ExecutionHistory.jsx` | Saved Studio runs, comparison baselines and historical inspection |
| `console/Console.jsx` | Audit progress, findings, documents, coverage, reports and manual evidence |

## Flow compatibility

React Flow's node/edge representation is an editor concern. API calls still use the existing contract:

```js
{
  id: 'my-flow',
  name: 'My flow',
  nodes: [{ id: 'alpha', type: 'bank', x: 280, y: 80, config: { bank: 'alpha', op: 'accounts' } }],
  edges: [{ from: 'trigger', to: 'alpha' }]
}
```

The `toNodes`, `toEdges` and `serialize` adapters are the boundary. Existing saved coordinates are retained. New templates are arranged from left to right; the Arrange nodes control explicitly rearranges existing graphs. Transient React Flow measurements, selection and execution badges are never stored.

Edits remain local until saved. Switching workflows or leaving the page with unsaved changes prompts the user. Execution saves the graph first so its stored version matches the requested run. Output from an older graph remains visible with a stale-result notice after edits. The client rejects disconnected graphs and cycles before execution/publishing; backend validation remains necessary for callers bypassing the editor.

Undo/redo history is local to the current editing session, capped at 80 snapshots. The execution panel shows the current run or a saved run explicitly opened from Execution history. Opening a historical result never replaces the current graph and does not provide rollback.

The Execution tab opens persistent history for the current workflow, retaining the latest 20 Studio runs (including failed nodes and input-validation failures) in `data/tenants/<tenant>/executions/<flow>/`. Public endpoint calls and runs made before this feature are not recorded. Each run includes timestamps, duration, version, node statuses/counts, redacted flow configuration and bounded result previews. Files are written atomically with owner-only file permissions. These are local JSON files under the existing demo tenant boundary, not a production access-control system.

The default baseline is the previous successful run; any other retained run can be selected. Comparison shows node additions/removals, status/count changes, preview data changes and before/after duration. Final response hashes cover the full response with object keys sorted, excluding runtime metadata such as generation time; node hashes cover captured previews. Identical previews can therefore coexist with a changed full response. The UI labels the difference and explicitly marks shortened output. Saved runs remain available after reload/restart; node previews can be opened in the existing inspector. `npm run test:history` verifies isolation, retention, persistence, redaction and comparison.

The node inspector has Input, Parameters and Output tabs. Input separates incoming connections; Output shows the actual node payload (including the final endpoint response for Respond). Parameters retains form/JSON editing and shows the resolved configuration used by the last run. Data appears when execution completes; edits mark existing previews stale and a new execution clears them.

Only Studio runs opt into `captureData`. The engine captures detached previews without changing execution inputs or final responses. `src/studio/inspection.js` caps each collection at 50 entries, each object at 100 keys, strings at 2,000 characters, nesting at 12 levels, each snapshot at approximately 64 KiB and the run at approximately 1 MiB. Truncation and omitted payloads are labelled; counts refer to full collections. Recognized credential fields, Bearer values and PEM private keys are redacted from previews. These previews are held in the current browser session, not stored with flows or attached to public endpoint responses. `npm run test:inspection` checks these guarantees.

## Browser verification

```bash
npx playwright install chromium
npm run build
npm run test:ui
```

Playwright starts `scripts/ui-test-server.js`, which copies server/config sources to a disposable directory, allocates separate simulator ports and serves the compiled frontend. Tenant files and evidence written by the browser tests remain in that disposable directory. The real development server and its tenant data are not used. Set `UI_TEST_PORT` if the default test HTTP port 4400 is occupied.

The acceptance suite covers loading/saving legacy graph data, graph movement and connections, undo/redo, node configuration, templates, runtime inputs, actual simulator execution, output/issue inspection, publish/call/unpublish, unsaved-change protection, manual evidence and small-screen navigation. Browser exceptions are checked in the main studio and console journeys.

## Design and scope

The studio uses a charcoal workspace, coral primary actions, a dotted canvas and functional node colors. Details appear in a side panel; execution data opens below the graph. Reduced-motion preferences are respected, dialogs use native focus containment, and form controls have explicit labels.

All pending states use Loading UI's `ConcentricRing`, installed with `npx shadcn@latest add @loading-ui/concentric-ring`. `components/LoadingIndicator.jsx` standardizes sizes and accessibility for buttons, audit progress, page loading and workflow execution. Scoped rules in `styles.css` supply the component's utility styles without adding Tailwind's global reset; the registry component merges caller styles with its rotation animation. With reduced motion enabled, the ring rotates gently once every two seconds so pending operations still look active; nonessential animations remain reduced. The shadcn import alias is configured in `jsconfig.json` and Vite.

This remains the existing hackathon demo: the role cookie and tenant slug are not authentication; real-bank access, token storage, rounding rules and backend security limitations have not been redesigned by this frontend migration.

Implementation references: [React Flow custom nodes](https://reactflow.dev/learn/customization/custom-nodes), [Vite backend integration](https://vite.dev/guide/backend-integration.html).
