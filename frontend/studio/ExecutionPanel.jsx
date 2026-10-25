import { useState } from "react";
import {
  AlertTriangle,
  Braces,
  Check,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Clock3,
  List,
  Play,
  SlidersHorizontal,
  Table2,
} from "lucide-react";
import { Badge, Button, Empty, Field, IconButton } from "../components/ui";
import { LoadingIndicator } from "../components/LoadingIndicator";

function InputFields({ specs, params, setParams }) {
  if (!specs.length)
    return (
      <p className="muted">
        This workflow has no runtime inputs. Add inputs to the endpoint trigger.
      </p>
    );
  return (
    <div className="runtime-inputs">
      {specs.map((s) => (
        <Field
          key={s.name}
          label={
            <>
              {s.name}
              {s.required && <span className="required"> *</span>}
              <span className="input-type">{s.type || "string"}</span>
            </>
          }
          hint={s.description}
        >
          {s.type === "enum" || s.type === "boolean" ? (
            <select
              value={params[s.name] ?? ""}
              onChange={(e) =>
                setParams((p) => ({ ...p, [s.name]: e.target.value }))
              }
            >
              <option value="">
                {s.default != null
                  ? `Default: ${s.default}`
                  : s.required
                    ? "Choose a value"
                    : "Any value"}
              </option>
              {(s.type === "boolean" ? ["true", "false"] : s.values || []).map(
                (v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ),
              )}
            </select>
          ) : (
            <input
              type={
                s.type === "date"
                  ? "date"
                  : ["number", "integer"].includes(s.type)
                    ? "number"
                    : "text"
              }
              value={params[s.name] ?? ""}
              placeholder={
                s.default != null ? `Default: ${s.default}` : "Enter a value"
              }
              onChange={(e) =>
                setParams((p) => ({ ...p, [s.name]: e.target.value }))
              }
            />
          )}
        </Field>
      ))}
    </div>
  );
}

export default function ExecutionPanel({
  result,
  error,
  busy,
  specs,
  params,
  setParams,
  tab,
  setTab,
  expanded,
  setExpanded,
  onRun,
  notify,
}) {
  const [format, setFormat] = useState("table");
  const issues = result
    ? [
        ...(result.meta.warnings || []).map((text) => ({
          title: "Source warning",
          text,
        })),
        ...(result.trace || [])
          .filter((t) => !t.ok)
          .map((t) => ({ title: t.node, text: t.error || `HTTP ${t.status}` })),
        ...(result.meta.missing || []).map((m) => ({
          title: `Missing: ${m.field}`,
          text: `${m.bank || m.node} · ${m.from || "source unavailable"}`,
        })),
        ...(result.meta.schemaIssues || []).map((s) => ({
          title: s.path,
          text: `${s.code}: expected ${s.expected}, got ${s.actual}`,
        })),
      ]
    : [];
  const values = result ? Object.values(result.data || {}) : [];
  const collection =
    values.find(Array.isArray) ||
    values.filter((v) => v && typeof v === "object");
  const rows = collection.slice(0, 50);
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r || {})))].slice(
    0,
    10,
  );
  const tabs = [
    { id: "output", label: "Output", icon: Braces },
    { id: "inputs", label: "Inputs", icon: SlidersHorizontal },
    { id: "logs", label: "Execution log", icon: List },
    { id: "issues", label: "Issues", icon: AlertTriangle },
  ];
  const cell = (v) =>
    v == null ? (
      <span className="null-value">null</span>
    ) : typeof v === "object" ? (
      JSON.stringify(v)
    ) : (
      String(v)
    );
  return (
    <section
      className={`execution-panel ${expanded ? "expanded" : ""}`}
      aria-label="Workflow execution"
    >
      <div className="execution-heading">
        <div className="execution-tabs">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => {
                setTab(id);
                setExpanded(true);
              }}
            >
              <Icon size={14} />
              {label}
              {id === "issues" && issues.length > 0 && (
                <span className="count amber">{issues.length}</span>
              )}
            </button>
          ))}
        </div>
        <div className="execution-status" role={busy ? "status" : undefined}>
          {busy ? (
            <>
              <LoadingIndicator size={14} />
              Executing workflow…
            </>
          ) : result ? (
            <>
              <Check size={13} />
              <span>{result.trace.length} nodes</span>
              <span className="divider-dot">·</span>
              <Clock3 size={13} />
              <span>{result.trace.reduce((sum, t) => sum + t.ms, 0)} ms</span>
            </>
          ) : (
            <span>No execution yet</span>
          )}
          <IconButton
            icon={expanded ? ChevronDown : ChevronUp}
            label={
              expanded ? "Collapse execution panel" : "Expand execution panel"
            }
            onClick={() => setExpanded(!expanded)}
          />
        </div>
      </div>
      {expanded && (
        <div className="execution-body">
          {error && (
            <div className="execution-error" role="alert">
              <AlertTriangle size={16} />
              <div>
                <strong>{error.message}</strong>
                {error.details?.map((e, i) => (
                  <p key={i}>
                    {e.input}: {e.error}
                  </p>
                ))}
              </div>
            </div>
          )}
          {tab === "inputs" && (
            <InputFields specs={specs} params={params} setParams={setParams} />
          )}
          {tab === "output" &&
            (!result ? (
              <Empty
                icon={busy ? LoadingIndicator : Play}
                title={busy ? "Your workflow is running" : "Ready when you are"}
                action={
                  !busy && (
                    <Button icon={Play} variant="subtle" onClick={onRun}>
                      Execute workflow
                    </Button>
                  )
                }
              >
                {busy
                  ? "Bank requests and transformations are being processed."
                  : "Execute this workflow to inspect the data returned by each bank."}
              </Empty>
            ) : (
              <>
                <div className="result-toolbar">
                  <span>
                    <strong>{collection.length}</strong>{" "}
                    {collection.length === 1 ? "item" : "items"}
                    {collection.length > 50 && " · previewing first 50"}{" "}
                    <Badge
                      tone={
                        result.meta.partial || issues.length ? "amber" : "green"
                      }
                    >
                      {result.meta.partial
                        ? "Partial response"
                        : issues.length
                          ? "Review issues"
                          : "Completed"}
                    </Badge>
                  </span>
                  <div className="segmented">
                    <button
                      aria-label="Table output"
                      className={format === "table" ? "active" : ""}
                      onClick={() => setFormat("table")}
                    >
                      <Table2 size={13} />
                      Table
                    </button>
                    <button
                      aria-label="JSON output"
                      className={format === "json" ? "active" : ""}
                      onClick={() => setFormat("json")}
                    >
                      <Braces size={13} />
                      JSON
                    </button>
                  </div>
                  <IconButton
                    icon={Clipboard}
                    label="Copy output JSON"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          JSON.stringify(result.data, null, 2),
                        );
                        notify("Output copied to clipboard");
                      } catch {
                        notify(
                          "Clipboard is unavailable in this browser.",
                          true,
                        );
                      }
                    }}
                  />
                </div>
                {format === "json" ? (
                  <pre className="json-output">
                    {JSON.stringify(result.data, null, 2)}
                  </pre>
                ) : (
                  <div className="data-table">
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          {columns.map((c) => (
                            <th key={c}>{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, i) => (
                          <tr key={i}>
                            <td className="muted">{i + 1}</td>
                            {columns.map((c) => (
                              <td
                                key={c}
                                title={
                                  typeof row[c] === "object"
                                    ? JSON.stringify(row[c])
                                    : String(row[c] ?? "")
                                }
                              >
                                {cell(row[c])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!rows.length && (
                      <p className="muted empty-table">
                        The workflow returned no items.
                      </p>
                    )}
                  </div>
                )}
              </>
            ))}
          {tab === "logs" &&
            (result ? (
              <div className="data-table">
                <table>
                  <thead>
                    <tr>
                      <th>Node</th>
                      <th>Status</th>
                      <th>Items</th>
                      <th>Duration</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trace.map((t, i) => (
                      <tr key={i}>
                        <td>{t.node}</td>
                        <td>
                          <Badge
                            tone={
                              t.skipped ? "neutral" : t.ok ? "green" : "red"
                            }
                          >
                            {t.skipped
                              ? "Skipped"
                              : t.ok
                                ? "Success"
                                : "Failed"}
                          </Badge>
                        </td>
                        <td>{t.count ?? "—"}</td>
                        <td>{t.ms} ms</td>
                        <td className="muted">
                          {t.error ||
                            t.skipped ||
                            t.sources
                              ?.map(
                                (s) =>
                                  `${s.bank} HTTP ${s.status ?? "unavailable"}${s.retry ? ` (retry ${s.retry})` : ""}`,
                              )
                              .join(" · ") ||
                            "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty icon={List} title="Your execution history starts here">
                Run this workflow to see the status and duration of every node.
              </Empty>
            ))}
          {tab === "issues" &&
            (issues.length ? (
              <div className="issue-list">
                {issues.map((issue, i) => (
                  <div className="issue-row" key={i}>
                    <AlertTriangle size={15} />
                    <div>
                      <strong>{issue.title}</strong>
                      <p>{issue.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                icon={Check}
                title={result ? "No issues reported" : "Nothing to review yet"}
              >
                {result
                  ? "This execution reported no source warnings, missing fields or schema issues."
                  : "Source warnings and validation issues will appear here after execution."}
              </Empty>
            ))}
        </div>
      )}
    </section>
  );
}
