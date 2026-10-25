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
| `studio/ExecutionPanel.jsx` | Runtime inputs, output table/JSON, traces and issues |
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

Undo/redo history is local to the current editing session, capped at 80 snapshots. The execution panel shows the most recent run; it does not imply persistent execution history or rollback support.

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

This remains the existing hackathon demo: the role cookie and tenant slug are not authentication; real-bank access, token storage, rounding rules and backend security limitations have not been redesigned by this frontend migration.

Implementation references: [React Flow custom nodes](https://reactflow.dev/learn/customization/custom-nodes), [Vite backend integration](https://vite.dev/guide/backend-integration.html).
