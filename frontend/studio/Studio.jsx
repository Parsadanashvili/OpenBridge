import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  ConnectionLineType,
  MiniMap,
  Handle,
  Position,
  ReactFlowProvider,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
} from "@xyflow/react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clipboard,
  Cloud,
  ExternalLink,
  GitBranch,
  Globe,
  Landmark,
  LayoutGrid,
  MoreHorizontal,
  Play,
  Plus,
  Redo2,
  Search,
  Settings2,
  ShieldCheck,
  Undo2,
  Workflow,
  X,
} from "lucide-react";
import "@xyflow/react/dist/style.css";
import { api, clone, send } from "../api";
import { LoadingIndicator } from "../components/LoadingIndicator";
import {
  Badge,
  Brand,
  Breadcrumbs,
  Button,
  Empty,
  Field,
  IconButton,
  Modal,
  Toast,
} from "../components/ui";
import {
  TYPES,
  arrange,
  inputSpec,
  nodeSummary,
  serialize,
  toEdges,
  toNodes,
  typeInfo,
  validateGraph,
} from "./model";
import Inspector from "./Inspector";
import ExecutionPanel from "./ExecutionPanel";

function WorkflowNode({ id, data, selected }) {
  const info = typeInfo(data.kind),
    Icon = info.icon;
  const status = data.execution;
  const executionState = status?.skipped
    ? "skipped"
    : status?.ok === true
      ? "success"
      : status?.ok === false
        ? "error"
        : "idle";
  const title =
    data.kind === "bank"
      ? `${data.config.bank ? data.config.bank[0].toUpperCase() + data.config.bank.slice(1) : "Bank"} Bank`
      : info.title;
  return (
    <div
      className={`workflow-node ${selected ? "selected" : ""} ${executionState === "success" ? "node-success" : executionState === "error" ? "node-error" : ""}`}
      data-execution-status={executionState}
    >
      {data.kind !== "trigger" && (
        <Handle type="target" position={Position.Left} />
      )}
      <div className="node-topline">
        <span className={`node-icon ${info.color}`}>
          <Icon size={22} strokeWidth={1.7} />
        </span>
        <span className="node-type">
          {data.kind === "bank"
            ? "BANKING"
            : info.group === "Transform"
              ? "TRANSFORM"
              : data.kind === "trigger"
                ? "TRIGGER"
                : "OUTPUT"}
        </span>
        {status && (
          <span
            className={`node-run-dot ${status.skipped ? "skipped" : status.ok ? "success" : "failed"}`}
            title={
              status.skipped ||
              status.error ||
              (status.ok ? "Execution succeeded" : "Execution failed")
            }
          >
            {status.ok ? <Check size={11} /> : <X size={11} />}
          </span>
        )}
      </div>
      <strong className="node-title">{title}</strong>
      <span className="node-summary">
        {nodeSummary(data.kind, data.config)}
      </span>
      <div className="node-bottom">
        <span>{id}</span>
        {status ? (
          <span>
            {status.count != null ? `${status.count} items` : `${status.ms} ms`}
          </span>
        ) : (
          <MoreHorizontal size={14} />
        )}
      </div>
      {data.kind !== "respond" && (
        <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
}
const nodeTypes = { workflow: WorkflowNode };

function NodeLibrary({ onAdd, onClose }) {
  const [search, setSearch] = useState("");
  const filtered = Object.entries(TYPES).filter(([kind, t]) =>
    `${kind} ${t.title} ${t.description}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <aside className="node-library" aria-label="Node library">
      <div className="panel-heading">
        <div>
          <h2>Add a node</h2>
          <p className="muted">What happens next?</p>
        </div>
        <IconButton icon={X} label="Close node library" onClick={onClose} />
      </div>
      <div className="library-search">
        <Search size={16} />
        <input
          autoFocus
          placeholder="Search nodes…"
          aria-label="Search nodes"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="library-list">
        {["Banking", "Transform", "Input & output"].map((group) => (
          <div key={group}>
            {filtered.some(([, t]) => t.group === group) && (
              <div className="section-label">{group}</div>
            )}
            {filtered
              .filter(([, t]) => t.group === group)
              .map(([kind, t]) => (
                <button
                  className="library-node"
                  key={kind}
                  onClick={() => onAdd(kind)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/openbridge-node", kind);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                >
                  <span className={`node-icon small ${t.color}`}>
                    <t.icon size={20} />
                  </span>
                  <span>
                    <strong>{t.title}</strong>
                    <small>{t.description}</small>
                  </span>
                  <Plus size={14} />
                </button>
              ))}
          </div>
        ))}
        {!filtered.length && (
          <p className="muted">No nodes match “{search}”.</p>
        )}
      </div>
      <div className="library-footer">
        Click to add, or drag onto the canvas.
      </div>
    </aside>
  );
}

function NewFlow({ templates, onClose, onCreate, existing }) {
  const [selected, setSelected] = useState(templates[0]?.id || "blank");
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [error, setError] = useState("");
  const template = templates.find((t) => t.id === selected);
  const resolvedName = name || template?.name || "Untitled workflow";
  const resolvedId =
    id ||
    resolvedName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32);
  return (
    <Modal
      title="Create a workflow"
      description="Start with a banking template or build your own."
      onClose={onClose}
      wide
    >
      <div className="template-grid">
        {[
          ...templates,
          {
            id: "blank",
            name: "Start from scratch",
            description: "A clean canvas with a trigger and response node.",
          },
        ].map((t) => (
          <button
            key={t.id}
            className={`template-card ${selected === t.id ? "selected" : ""}`}
            onClick={() => {
              setSelected(t.id);
              setError("");
            }}
          >
            <span className="template-symbol">
              {t.id === "blank" ? <Plus size={20} /> : <Workflow size={20} />}
            </span>
            <strong>{t.name}</strong>
            <small>{t.description}</small>
            {selected === t.id && (
              <CheckCircle2 size={17} className="template-check" />
            )}
          </button>
        ))}
      </div>
      <div className="modal-fields">
        <Field label="Workflow name">
          <input
            aria-label="Workflow name"
            placeholder={template?.name || "Untitled workflow"}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field
          label="Workflow ID"
          hint="2–32 lowercase letters, numbers or hyphens."
        >
          <input
            aria-label="Workflow ID"
            placeholder={resolvedId}
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
        </Field>
      </div>
      {error && <p className="inline-error">{error}</p>}
      <div className="modal-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          icon={ArrowRight}
          onClick={() => {
            if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(resolvedId))
              return setError("Enter a valid workflow ID (2–32 characters).");
            if (existing.some((f) => f.id === resolvedId))
              return setError(
                "A workflow with this ID already exists. Choose another ID.",
              );
            onCreate(
              template
                ? { ...clone(template), id: resolvedId, name: resolvedName }
                : {
                    id: resolvedId,
                    name: resolvedName,
                    nodes: [
                      {
                        id: "trigger",
                        type: "trigger",
                        x: 80,
                        y: 160,
                        config: { inputs: [] },
                      },
                      {
                        id: "respond",
                        type: "respond",
                        x: 520,
                        y: 160,
                        config: { wrap: "items" },
                      },
                    ],
                    edges: [],
                  },
            );
          }}
        >
          Create workflow
        </Button>
      </div>
    </Modal>
  );
}

function StudioWorkspace() {
  const tenant =
    new URLSearchParams(location.search).get("tenant") || "demo-tpp";
  const validTenant = /^[a-z0-9][a-z0-9-]{1,31}$/.test(tenant);
  const base = `/api/studio/${encodeURIComponent(tenant)}`;
  const [flow, setFlow] = useState(null),
    [flows, setFlows] = useState([]),
    [templates, setTemplates] = useState([]),
    [banks, setBanks] = useState([]),
    [connections, setConnections] = useState({});
  const [nodes, setNodes] = useState([]),
    [edges, setEdges] = useState([]);
  const [selected, setSelected] = useState(null),
    [library, setLibrary] = useState(false),
    [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null),
    [runError, setRunError] = useState(null),
    [params, setParams] = useState({});
  const [executionTab, setExecutionTab] = useState("output"),
    [expanded, setExpanded] = useState(false),
    [workspaceTab, setWorkspaceTab] = useState("editor");
  const [toast, setToast] = useState(null),
    [publishPath, setPublishPath] = useState(""),
    [publishing, setPublishing] = useState(false),
    [publishingError, setPublishingError] = useState("");
  const [bankBusy, setBankBusy] = useState(null),
    [sidebarOpen, setSidebarOpen] = useState(false),
    [, setHistoryVersion] = useState(0);
  const undoStack = useRef([]),
    redoStack = useRef([]),
    lastExecuted = useRef(""),
    baseline = useRef(""),
    initialized = useRef(false),
    pendingAction = useRef(null);
  const { fitView, screenToFlowPosition } = useReactFlow();
  const notify = useCallback(
    (message, error = false) => setToast({ message, error }),
    [],
  );
  const dismissToast = useCallback(() => setToast(null), []);
  const current = useMemo(
    () => (flow ? serialize(flow, nodes, edges) : null),
    [flow, nodes, edges],
  );
  const fingerprint = (f) =>
    JSON.stringify({
      id: f?.id,
      name: f?.name,
      nodes: f?.nodes,
      edges: f?.edges,
    });
  const currentFingerprint = fingerprint(current);
  const stale = result && currentFingerprint !== lastExecuted.current;

  const resetFlow = useCallback(
    (next, draft = false) => {
      setFlow(next);
      setNodes(draft ? arrange(toNodes(next), toEdges(next)) : toNodes(next));
      setEdges(toEdges(next));
      setSelected(null);
      setLibrary(false);
      setDirty(draft);
      setResult(null);
      setRunError(null);
      setParams({});
      setSidebarOpen(false);
      setPublishPath(next.published?.path || next.publishPath || next.id);
      baseline.current = draft ? "" : fingerprint(next);
      undoStack.current = [];
      redoStack.current = [];
      setHistoryVersion((n) => n + 1);
      setTimeout(
        () => fitView({ padding: 0.25, duration: 250, maxZoom: 1 }),
        60,
      );
    },
    [fitView],
  );

  const load = useCallback(
    async (signal) => {
      if (!validTenant) {
        setLoadError(
          "Invalid workspace ID. Use 2–32 lowercase letters, numbers or hyphens.",
        );
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError(null);
      try {
        const [tpls, available, list, linked] = await Promise.all([
          api("/api/studio/templates", { signal }),
          api("/api/studio/banks", { signal }),
          api(`${base}/flows`, { signal }),
          api(`${base}/connections`, { signal }),
        ]);
        if (signal?.aborted) return;
        const initial = list.length
          ? await api(`${base}/flows/${list[0].id}`, { signal })
          : tpls[0]
            ? { ...clone(tpls[0]), version: 0 }
            : null;
        setTemplates(tpls);
        setBanks(available);
        setFlows(list);
        setConnections(linked);
        if (initial) resetFlow(initial, !list.length);
        initialized.current = true;
      } catch (e) {
        if (e.name !== "AbortError") setLoadError(e.message);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [base, validTenant, resetFlow],
  );
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    if (initialized.current && current)
      setDirty(currentFingerprint !== baseline.current);
  }, [currentFingerprint]);
  useEffect(() => {
    const handler = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const remember = () => {
    if (!flow) return;
    undoStack.current.push(clone(current));
    if (undoStack.current.length > 80) undoStack.current.shift();
    redoStack.current = [];
    setHistoryVersion((n) => n + 1);
  };
  const restore = (next) => {
    // Undo graph edits without rewinding the server's saved/published metadata.
    setFlow((previous) => ({
      ...previous,
      name: next.name,
      description: next.description,
    }));
    setNodes(toNodes(next));
    setEdges(toEdges(next));
    setSelected(null);
    setHistoryVersion((n) => n + 1);
  };
  const undo = () => {
    const previous = undoStack.current.pop();
    if (previous) {
      redoStack.current.push(clone(current));
      restore(previous);
    }
  };
  const redo = () => {
    const next = redoStack.current.pop();
    if (next) {
      undoStack.current.push(clone(current));
      restore(next);
    }
  };
  const guarded = (action) => {
    if (busy || saving) return;
    if (!dirty) return action();
    pendingAction.current = action;
    setModal("discard");
  };
  const openFlow = async (id) => {
    try {
      const next = await api(`${base}/flows/${id}`);
      resetFlow(next);
    } catch (e) {
      notify(e.message, true);
    }
  };
  const refreshList = async () => {
    const list = await api(`${base}/flows`);
    setFlows(list);
  };

  const save = async (announce = true) => {
    if (!current || saving) return null;
    setSaving(true);
    try {
      const saved = await api(
        `${base}/flows/${current.id}`,
        send("PUT", current),
      );
      setFlow(saved);
      baseline.current = fingerprint(saved);
      setDirty(false);
      await refreshList();
      if (announce) notify("Workflow saved");
      return saved;
    } catch (e) {
      notify(e.message, true);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const execute = async () => {
    if (busy || saving || !current) return;
    const errors = validateGraph(current);
    if (errors.length) {
      const e = new Error(
        "Connect and configure your workflow before executing.",
      );
      e.details = errors.map((error) => ({ input: "Workflow", error }));
      setRunError(e);
      setExpanded(true);
      setExecutionTab("output");
      return;
    }
    setBusy(true);
    setResult(null);
    setRunError(null);
    setExpanded(true);
    setExecutionTab("output");
    setWorkspaceTab("editor");
    try {
      // The run endpoint expects a stored ID; saving also makes the executed version explicit.
      const saved = dirty || !flow.version ? await save(false) : current;
      if (!saved) return;
      const response = await api(
        `${base}/flows/${saved.id}/run`,
        send("POST", {
          flow: saved,
          params: Object.fromEntries(
            Object.entries(params).filter(([, value]) => value !== ""),
          ),
        }),
      );
      setResult(response);
      lastExecuted.current = fingerprint(saved);
      const failures = response.trace.filter((t) => !t.ok);
      notify(
        failures.length
          ? `Execution finished with ${failures.length} failed node(s).`
          : response.meta.partial
            ? "Execution finished with a partial response."
            : "Workflow executed successfully",
        failures.length > 0,
      );
      setConnections(await api(`${base}/connections`));
    } catch (e) {
      setRunError(e);
      notify(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const handler = (e) => {
      if (modal) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!busy) save();
      }
      if (e.key === "Enter") {
        e.preventDefault();
        execute();
      }
      if (
        e.key.toLowerCase() === "z" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          document.activeElement?.tagName,
        )
      ) {
        e.preventDefault();
        if (!busy && !saving) e.shiftKey ? redo() : undo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const addNode = (kind, position) => {
    if (!flow || busy || saving) return;
    remember();
    let id = kind,
      suffix = 2;
    while (nodes.some((n) => n.id === id)) id = `${kind}-${suffix++}`;
    const center = document
      .querySelector(".flow-canvas")
      .getBoundingClientRect();
    const pos =
      position ||
      screenToFlowPosition({
        x: center.left + center.width * 0.5,
        y: center.top + center.height * 0.45,
      });
    setNodes((list) => [
      ...list.map((n) => ({ ...n, selected: false })),
      {
        id,
        type: "workflow",
        position: pos,
        selected: true,
        data: { kind, config: clone(TYPES[kind].config) },
      },
    ]);
    setSelected(id);
    setLibrary(false);
    notify(`${TYPES[kind].title} added`);
  };
  const onNodesChange = (changes) => {
    if (busy || saving) return;
    if (changes.some((c) => c.type === "remove")) remember();
    setNodes((list) => applyNodeChanges(changes, list));
    const removed = new Set(
      changes.filter((c) => c.type === "remove").map((c) => c.id),
    );
    if (removed.size) {
      setEdges((list) =>
        list.filter((e) => !removed.has(e.source) && !removed.has(e.target)),
      );
      if (removed.has(selected)) setSelected(null);
    }
  };
  const onEdgesChange = (changes) => {
    if (busy || saving) return;
    if (changes.some((c) => c.type === "remove")) remember();
    setEdges((list) => applyEdgeChanges(changes, list));
  };
  const validConnection = ({ source, target }) => {
    if (
      !source ||
      !target ||
      source === target ||
      edges.some((e) => e.source === source && e.target === target)
    )
      return false;
    const seen = new Set();
    function reaches(id) {
      if (id === source) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return edges
        .filter((e) => e.source === id)
        .some((e) => reaches(e.target));
    }
    return !reaches(target);
  };
  const onConnect = (connection) => {
    if (busy || saving || !validConnection(connection)) return;
    remember();
    setEdges((list) => addEdge({ ...connection, type: "default" }, list));
  };
  const arrangeNodes = () => {
    remember();
    setNodes((list) => arrange(list, edges));
    setTimeout(() => fitView({ padding: 0.16, duration: 250, maxZoom: 1 }), 50);
  };
  const selectedNode = nodes.find((n) => n.id === selected);
  const detailsOpen = library || !!selectedNode;
  useEffect(() => {
    // Keep the whole graph in view when the output drawer or inspector changes
    // the canvas dimensions. Normal node edits do not reset the viewport.
    const frame = requestAnimationFrame(() => {
      fitView({ padding: 0.16, duration: 180, maxZoom: 1 });
    });
    return () => cancelAnimationFrame(frame);
  }, [expanded, workspaceTab, detailsOpen, fitView]);
  const displayNodes = nodes.map((n) => ({
    ...n,
    selected: n.id === selected,
    data: {
      ...n.data,
      execution:
        !busy && !stale ? result?.trace.find((t) => t.node === n.id) : null,
    },
  }));
  const specs = inputSpec(current);
  const endpointPath = flow?.published?.path || publishPath;
  const endpoint = endpointPath
    ? `/t/${encodeURIComponent(tenant)}/${endpointPath.replace(/\{(\w+)\}/g, (match, key) => (params[key] ? encodeURIComponent(params[key]) : match))}${Object.keys(params).some((k) => params[k] !== "" && !endpointPath.includes(`{${k}}`)) ? `?${new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([k, v]) => v !== "" && !endpointPath.includes(`{${k}}`))))}` : ""}`
    : "";
  const publish = async () => {
    const errors = validateGraph(current);
    if (errors.length) {
      setPublishingError(errors.join(" "));
      return;
    }
    setPublishing(true);
    setPublishingError("");
    try {
      const saved = await save(false);
      if (!saved) return;
      const published = await api(
        `${base}/flows/${saved.id}/publish`,
        send("POST", { path: publishPath }),
      );
      setFlow(published);
      baseline.current = fingerprint(published);
      setDirty(false);
      await refreshList();
      notify("Endpoint published");
    } catch (e) {
      setPublishingError(e.message);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className={`studio-app ${sidebarOpen ? "sidebar-open" : ""}`}>
      <aside className="workspace-sidebar">
        <Brand />
        <button
          className="workspace-switch"
          onClick={() => setModal("workspace")}
        >
          <span className="workspace-avatar">
            {tenant.slice(0, 2).toUpperCase()}
          </span>
          <span>
            <strong>{tenant}</strong>
            <small>Personal workspace</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="sidebar-section">
          <span>WORKSPACE</span>
          <button
            className="sidebar-action"
            aria-label="Create workflow"
            onClick={() => guarded(() => setModal("new"))}
            disabled={busy || saving}
          >
            <Plus size={15} />
          </button>
        </div>
        <button
          className="nav-item active"
          onClick={() => setWorkspaceTab("editor")}
        >
          <Workflow size={17} />
          Workflows<span className="nav-count">{flows.length}</span>
        </button>
        <button className="nav-item" onClick={() => setModal("connections")}>
          <Landmark size={17} />
          Bank connections
        </button>
        <a
          className="nav-item"
          href="/nbg"
          onClick={(e) => {
            if (dirty) {
              e.preventDefault();
              guarded(() => {
                location.href = "/nbg";
              });
            }
          }}
        >
          <ShieldCheck size={17} />
          Regulatory console
          <ExternalLink size={12} />
        </a>
        <div className="sidebar-section workflow-section">
          <span>YOUR WORKFLOWS</span>
          <button
            className="sidebar-action"
            aria-label="New workflow"
            onClick={() => guarded(() => setModal("new"))}
            disabled={busy || saving}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="workflow-list">
          {flows.map((f) => (
            <button
              key={f.id}
              className={`workflow-list-item ${flow?.id === f.id ? "active" : ""}`}
              onClick={() => {
                if (f.id !== flow?.id) guarded(() => openFlow(f.id));
              }}
              title={f.name}
            >
              <GitBranch size={14} />
              <span>{f.name}</span>
              {f.published && (
                <span className="published-dot" title="Published" />
              )}
            </button>
          ))}
          {!flows.length && !loading && (
            <p className="sidebar-empty">
              Save your first workflow to find it here.
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="environment-note">
            <span className="environment-dot" />
            <div>
              <strong>Sandbox environment</strong>
              <small>Simulated bank data</small>
            </div>
          </div>
          <button className="nav-item" onClick={() => setModal("help")}>
            <CircleHelp size={16} />
            Help & shortcuts
          </button>
          <div className="sidebar-profile">
            <span className="profile-avatar">OB</span>
            <div>
              <strong>Demo workspace</strong>
              <small>OpenBridge Flow Studio</small>
            </div>
            <Settings2 size={15} />
          </div>
        </div>
      </aside>
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close workspace navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <main className="studio-main">
        <header className="studio-header">
          <IconButton
            icon={LayoutGrid}
            label="Toggle workspace navigation"
            className="mobile-menu"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          />
          <Breadcrumbs items={["Workspace", "Workflows"]} />
          <span className="header-spacer" />
          <span
            className={`save-state ${dirty ? "unsaved" : ""}`}
            role={saving ? "status" : undefined}
          >
            {saving ? (
              <LoadingIndicator size={14} />
            ) : dirty ? (
              <span className="unsaved-dot" />
            ) : (
              <Cloud size={14} />
            )}
            {saving
              ? "Saving…"
              : dirty
                ? "Unsaved changes"
                : "All changes saved"}
          </span>
          <Button
            icon={Check}
            onClick={() => save()}
            disabled={!flow || !dirty || busy}
            loading={saving}
          >
            Save
          </Button>
          <Button
            icon={Globe}
            variant="light"
            disabled={!flow || busy || saving}
            onClick={() => {
              setPublishingError("");
              setModal("publish");
            }}
          >
            Publish
          </Button>
        </header>
        <div className="workflow-toolbar">
          <div className="workflow-heading">
            <Workflow size={18} />
            <input
              aria-label="Workflow title"
              value={flow?.name || ""}
              placeholder="Your workflow"
              disabled={!flow || busy || saving}
              onChange={(e) => {
                remember();
                setFlow((f) => ({ ...f, name: e.target.value }));
              }}
            />
            <Badge tone={flow?.published ? "green" : "neutral"}>
              {flow?.published ? "Published" : "Draft"}
            </Badge>
          </div>
          <div className="editor-tabs">
            <button
              className={workspaceTab === "editor" ? "active" : ""}
              onClick={() => setWorkspaceTab("editor")}
            >
              Editor
            </button>
            <button
              className={workspaceTab === "executions" ? "active" : ""}
              onClick={() => {
                setWorkspaceTab("executions");
                setExpanded(true);
                setExecutionTab("logs");
              }}
            >
              Execution
            </button>
          </div>
          <div className="toolbar-right">
            <IconButton
              icon={Undo2}
              label="Undo (⌘Z)"
              disabled={!undoStack.current.length || busy || saving}
              onClick={undo}
            />
            <IconButton
              icon={Redo2}
              label="Redo (⌘⇧Z)"
              disabled={!redoStack.current.length || busy || saving}
              onClick={redo}
            />
            <span className="toolbar-divider" />
            <Button
              icon={Play}
              variant="execute"
              loading={busy}
              disabled={!flow || saving}
              onClick={execute}
            >
              {busy ? "Executing…" : "Execute workflow"}
            </Button>
          </div>
        </div>
        <div className="editor-workspace">
          <div className="canvas-column">
            <div
              className={`flow-canvas ${workspaceTab === "executions" ? "execution-focused" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                const kind = e.dataTransfer.getData(
                  "application/openbridge-node",
                );
                if (TYPES[kind])
                  addNode(
                    kind,
                    screenToFlowPosition({ x: e.clientX, y: e.clientY }),
                  );
              }}
            >
              <ReactFlow
                colorMode="dark"
                nodes={displayNodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                isValidConnection={validConnection}
                onNodeClick={(_, n) => {
                  setSelected(n.id);
                  setLibrary(false);
                }}
                onPaneClick={() => setSelected(null)}
                onNodeDragStart={remember}
                onInit={() =>
                  setTimeout(() => fitView({ padding: 0.16, maxZoom: 1 }), 80)
                }
                nodesDraggable={!busy && !saving}
                nodesConnectable={!busy && !saving}
                deleteKeyCode={busy || saving ? null : ["Backspace", "Delete"]}
                minZoom={0.2}
                maxZoom={1.8}
                fitView
                fitViewOptions={{ padding: 0.16, maxZoom: 1 }}
                defaultEdgeOptions={{
                  type: "default",
                  style: { strokeWidth: 1.5 },
                }}
                connectionLineType={ConnectionLineType.Bezier}
                connectionLineStyle={{ stroke: "#ff7866", strokeWidth: 2 }}
                snapToGrid
                snapGrid={[16, 16]}
              >
                <Background color="#3b3e45" gap={20} size={1} />
                <Controls showInteractive={false} position="bottom-left" />
                <MiniMap
                  position="bottom-right"
                  bgColor="#262930"
                  nodeColor={(n) =>
                    ({
                      trigger: "#e88170",
                      bank: "#72a4e5",
                      map: "#a28cd1",
                      respond: "#7cae93",
                    })[n.data.kind] || "#a69772"
                  }
                  maskColor="rgba(25, 27, 31, .7)"
                  pannable
                  zoomable
                />
              </ReactFlow>
              <div className="canvas-top-left">
                <span className="canvas-label">
                  <GitBranch size={13} />
                  {flow?.id || "Workflow canvas"}
                </span>
                <span className="canvas-hint">
                  {nodes.length} nodes · {edges.length} connections
                </span>
              </div>
              <div className="canvas-actions">
                <IconButton
                  icon={Workflow}
                  label="Arrange nodes"
                  disabled={!flow || busy || saving}
                  onClick={arrangeNodes}
                />
                <Button
                  icon={Plus}
                  variant="canvas-button"
                  onClick={() => {
                    setLibrary(!library);
                    setSelected(null);
                  }}
                  disabled={!flow || busy || saving}
                >
                  Add node
                </Button>
              </div>
              <div className="canvas-footer-hint">
                <span>Drag to move</span>
                <span>Scroll to zoom</span>
                <span>Connect the dots</span>
              </div>
              {(loading || loadError || !flow) && (
                <div
                  className="canvas-overlay"
                  role={loading ? "status" : undefined}
                >
                  {loading ? (
                    <>
                      <LoadingIndicator size={32} />
                      <p>Loading your workspace…</p>
                    </>
                  ) : loadError ? (
                    <Empty
                      title="Couldn’t open this workspace"
                      action={<Button onClick={() => load()}>Try again</Button>}
                    >
                      {loadError}
                    </Empty>
                  ) : (
                    <Empty
                      icon={Workflow}
                      title="Build your first banking workflow"
                      action={
                        <Button
                          icon={Plus}
                          variant="primary"
                          onClick={() => setModal("new")}
                        >
                          Create workflow
                        </Button>
                      }
                    >
                      Connect banks, transform data and publish one unified
                      endpoint.
                    </Empty>
                  )}
                </div>
              )}
            </div>
            {stale && (
              <div className="stale-result">
                Workflow changed since the last execution. Execute again to
                refresh the output.
              </div>
            )}
            <ExecutionPanel
              result={result}
              error={runError}
              busy={busy}
              specs={specs}
              params={params}
              setParams={setParams}
              tab={executionTab}
              setTab={setExecutionTab}
              expanded={expanded || workspaceTab === "executions"}
              setExpanded={(value) => {
                setExpanded(value);
                if (!value) setWorkspaceTab("editor");
              }}
              onRun={execute}
              notify={notify}
            />
          </div>
          {library ? (
            <NodeLibrary onAdd={addNode} onClose={() => setLibrary(false)} />
          ) : (
            selectedNode && (
              <div className={busy || saving ? "inspector-lock" : ""}>
                <Inspector
                  node={selectedNode}
                  banks={banks}
                  onClose={() => setSelected(null)}
                  onChange={(config) => {
                    if (busy || saving) return;
                    remember();
                    setNodes((list) =>
                      list.map((n) =>
                        n.id === selected
                          ? { ...n, data: { ...n.data, config } }
                          : n,
                      ),
                    );
                  }}
                  onDelete={() => {
                    if (busy || saving) return;
                    remember();
                    setNodes((list) => list.filter((n) => n.id !== selected));
                    setEdges((list) =>
                      list.filter(
                        (e) => e.source !== selected && e.target !== selected,
                      ),
                    );
                    setSelected(null);
                  }}
                />
              </div>
            )
          )}
        </div>
        <footer className="workspace-statusbar">
          <span>
            <span className="environment-dot" />
            Sandbox · {
              banks.filter((b) => b.simulated && b.enabled).length
            }{" "}
            simulated banks
          </span>
          <span>
            {flow?.version ? `Version ${flow.version}` : "New workflow"}
            <span className="divider-dot">·</span>
            <kbd>⌘</kbd>
            <kbd>↵</kbd> to execute
          </span>
        </footer>
      </main>
      {modal === "new" && (
        <NewFlow
          templates={templates}
          existing={flows}
          onClose={() => setModal(null)}
          onCreate={(next) => {
            resetFlow({ ...next, version: 0 }, true);
            setModal(null);
            notify("Workflow created. Save to keep it.");
          }}
        />
      )}
      {modal === "discard" && (
        <Modal
          title="You have unsaved changes"
          description="Save your workflow first, or discard these changes to continue."
          onClose={() => {
            pendingAction.current = null;
            setModal(null);
          }}
        >
          <div className="modal-actions">
            <Button onClick={() => setModal(null)}>Keep editing</Button>
            <Button
              variant="danger"
              onClick={() => {
                const action = pendingAction.current;
                pendingAction.current = null;
                setModal(null);
                action?.();
              }}
            >
              Discard changes
            </Button>
          </div>
        </Modal>
      )}
      {modal === "publish" && (
        <Modal
          title="Publish an endpoint"
          description="Make this workflow callable through its own URL."
          onClose={() => !publishing && setModal(null)}
        >
          <Field
            label="Endpoint path"
            hint="Use lowercase segments and declared inputs, e.g. accounts/{accountId}."
          >
            <div className="path-input">
              <span>/t/{tenant}/</span>
              <input
                aria-label="Endpoint path"
                value={publishPath}
                onChange={(e) => setPublishPath(e.target.value)}
                disabled={publishing}
              />
            </div>
          </Field>
          {publishingError && (
            <p className="inline-error" role="alert">
              {publishingError}
            </p>
          )}
          {flow?.published && (
            <div className="published-endpoint">
              <Badge tone="green">Live endpoint</Badge>
              <code>{endpoint}</code>
              <div className="inline-actions">
                <Button
                  icon={Clipboard}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        `${location.origin}${endpoint}`,
                      );
                      notify("Endpoint URL copied");
                    } catch {
                      notify("Clipboard is unavailable.", true);
                    }
                  }}
                >
                  Copy URL
                </Button>
                <a href={endpoint} target="_blank" rel="noreferrer">
                  Open endpoint <ExternalLink size={13} />
                </a>
              </div>
              <p className="muted">
                Supports GET query parameters and POST JSON inputs. This demo
                endpoint has no authentication.
              </p>
            </div>
          )}
          <div className="modal-actions">
            {flow?.published && (
              <Button
                disabled={publishing}
                onClick={async () => {
                  try {
                    setPublishing(true);
                    await api(
                      `${base}/flows/${flow.id}/unpublish`,
                      send("POST", {}),
                    );
                    const next = await api(`${base}/flows/${flow.id}`);
                    setFlow((previous) => ({
                      ...previous,
                      published: undefined,
                      version: next.version,
                      updatedAt: next.updatedAt,
                    }));
                    baseline.current = fingerprint(next);
                    await refreshList();
                    notify("Endpoint unpublished");
                  } catch (e) {
                    setPublishingError(e.message);
                  } finally {
                    setPublishing(false);
                  }
                }}
              >
                Unpublish
              </Button>
            )}
            <Button
              variant="primary"
              icon={Globe}
              loading={publishing}
              onClick={publish}
            >
              {flow?.published ? "Update endpoint" : "Publish endpoint"}
            </Button>
          </div>
        </Modal>
      )}
      {modal === "connections" && (
        <Modal
          title="Bank connections"
          description="Connect a bank to use its accounts in your workflows."
          onClose={() => setModal(null)}
        >
          <div className="bank-connections">
            {banks.map((b) => (
              <div className="bank-connection" key={b.id}>
                <span className="bank-avatar">
                  {b.id.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{b.name}</strong>
                  <small>
                    {b.simulated
                      ? "Simulated · synthetic customer data"
                      : "Real bank · credentials required"}
                  </small>
                </div>
                {connections[b.id] ? (
                  <Badge tone="green">Connected</Badge>
                ) : (
                  <Button
                    disabled={!b.enabled || !!bankBusy}
                    loading={bankBusy === b.id}
                    onClick={async () => {
                      setBankBusy(b.id);
                      try {
                        setConnections(
                          await api(
                            `${base}/connections`,
                            send("POST", { bank: b.id }),
                          ),
                        );
                        notify(`${b.name} connected`);
                      } catch (e) {
                        notify(e.message, true);
                      } finally {
                        setBankBusy(null);
                      }
                    }}
                  >
                    {b.enabled ? "Connect" : "Not configured"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}
      {modal === "workspace" && (
        <Modal
          title="Your workspace"
          description="Each workspace keeps its own workflows and bank connections."
          onClose={() => setModal(null)}
        >
          <Field label="Workspace ID">
            <input readOnly value={tenant} />
          </Field>
          <p className="muted">
            Workspace selection is part of the hackathon demo. Authentication
            and workspace access controls are not enabled.
          </p>
        </Modal>
      )}
      {modal === "help" && (
        <Modal
          title="Make your first connection"
          description="A quick guide to Flow Studio."
          onClose={() => setModal(null)}
        >
          <ol className="help-steps">
            <li>
              <strong>Start with a template.</strong> Choose New workflow for a
              ready-to-run banking flow.
            </li>
            <li>
              <strong>Connect your nodes.</strong> Drag from the dot on the
              right to the dot on the next node’s left. Select a connection and
              press Delete to remove it.
            </li>
            <li>
              <strong>Configure each step.</strong> Click a node to edit its
              parameters or JSON.
            </li>
            <li>
              <strong>Execute and inspect.</strong> Set runtime values in
              Inputs, then review Output, Execution log and Issues.
            </li>
            <li>
              <strong>Publish your endpoint.</strong> Save and publish to make
              the response available at its own URL.
            </li>
          </ol>
          <div className="shortcut-list">
            <span>
              Save workflow <kbd>⌘ / Ctrl + S</kbd>
            </span>
            <span>
              Execute workflow <kbd>⌘ / Ctrl + Enter</kbd>
            </span>
            <span>
              Undo / redo <kbd>⌘ / Ctrl + Z / Shift + Z</kbd>
            </span>
            <span>
              Remove selected node or connection <kbd>Delete</kbd>
            </span>
          </div>
        </Modal>
      )}
      <Toast
        message={toast?.message}
        error={toast?.error}
        onClose={dismissToast}
      />
    </div>
  );
}

export default function Studio() {
  return (
    <ReactFlowProvider>
      <StudioWorkspace />
    </ReactFlowProvider>
  );
}
