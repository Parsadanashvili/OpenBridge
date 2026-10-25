import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Braces,
  Clipboard,
  Database,
  Play,
  Table2,
} from "lucide-react";
import { Badge, Button, Empty, Field, IconButton } from "../components/ui";
import { LoadingIndicator } from "../components/LoadingIndicator";

function rowsOf(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const array = Object.values(value).find(Array.isArray);
    if (array) return array;
    if (value.transactions && typeof value.transactions === "object")
      return rowsOf(value.transactions);
    if (!Object.keys(value).length) return [];
    return [value];
  }
  return value == null ? [] : [{ value }];
}

export default function NodeDataPanel({
  direction,
  execution,
  busy,
  stale,
  onRun,
  notify,
}) {
  const [format, setFormat] = useState("json");
  const [sourceId, setSourceId] = useState("");
  const inspection = execution?.inspection;
  const sources = inspection?.input?.sources || [];
  const selectedSource =
    sources.find((s) => (s.node || "endpoint-inputs") === sourceId) ||
    sources[0];
  const data = direction === "input" ? selectedSource : inspection?.output;
  const preview = data?.preview;
  const json = useMemo(
    () => JSON.stringify(preview?.value, null, 2),
    [preview],
  );
  const rows = useMemo(
    () =>
      rowsOf(preview?.value).map((row) =>
        row && typeof row === "object" && !Array.isArray(row)
          ? row
          : { value: row },
      ),
    [preview],
  );
  const allColumns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const columns = allColumns.slice(0, 20);

  if (busy)
    return (
      <div className="node-data-empty" role="status">
        <LoadingIndicator size={28} />
        <h3>Workflow is running</h3>
        <p>Node data will appear when this execution completes.</p>
      </div>
    );
  if (!execution || !inspection)
    return (
      <Empty
        icon={Database}
        title={
          execution ? "Run again to inspect this node" : "No execution data yet"
        }
        action={
          <Button icon={Play} onClick={onRun}>
            Execute workflow
          </Button>
        }
      >
        {execution
          ? "This execution does not include node data. Execute again to capture its input and output."
          : "Execute the workflow, then select a node to inspect the data passing through it."}
      </Empty>
    );

  const status = execution.skipped
    ? "Skipped"
    : execution.ok
      ? "Success"
      : "Failed";
  const cell = (value) =>
    value == null ? (
      <span className="null-value">null</span>
    ) : typeof value === "object" ? (
      JSON.stringify(value)
    ) : (
      String(value)
    );

  return (
    <div className="node-data-panel" aria-label={`Node ${direction} data`}>
      <div className="node-data-summary">
        <Badge
          tone={execution.skipped ? "neutral" : execution.ok ? "green" : "red"}
        >
          {status}
        </Badge>
        <span>{execution.ms} ms</span>
        <span>{data?.count ?? 0} items</span>
      </div>
      {stale && (
        <div className="node-data-notice">
          <AlertTriangle size={14} />
          <span>
            From the previous execution. Run again to inspect your changes.
          </span>
        </div>
      )}
      {execution.error && (
        <div className="node-data-notice error">
          <AlertTriangle size={14} />
          <span>{execution.error}</span>
        </div>
      )}
      {execution.skipped && (
        <div className="node-data-notice">
          <span>{execution.skipped}</span>
        </div>
      )}
      {direction === "input" && sources.length > 0 && (
        <Field label="Source node">
          <select
            aria-label="Input source node"
            value={selectedSource?.node || "endpoint-inputs"}
            onChange={(e) => setSourceId(e.target.value)}
          >
            {sources.map((s, i) => (
              <option
                key={`${s.node}-${i}`}
                value={s.node || "endpoint-inputs"}
              >
                {s.node ? `From ${s.node}` : "Endpoint inputs"} · {s.count}{" "}
                items
              </option>
            ))}
          </select>
        </Field>
      )}
      {direction === "input" && sources.length > 1 && (
        <p className="node-data-caption">
          {sources.length} incoming sources. Choose a source to inspect its
          data.
        </p>
      )}
      {!data ? (
        <Empty title="No incoming data">
          This node had no connected input for this execution.
        </Empty>
      ) : (
        <>
          <div className="node-data-toolbar">
            <span>
              {direction === "input"
                ? "Incoming data"
                : data.kind === "response"
                  ? "Endpoint response"
                  : "Node output"}
            </span>
            <div className="segmented">
              <button
                className={format === "table" ? "active" : ""}
                aria-label={`Table ${direction} preview`}
                onClick={() => setFormat("table")}
              >
                <Table2 size={13} />
                Table
              </button>
              <button
                className={format === "json" ? "active" : ""}
                aria-label={`JSON ${direction} preview`}
                onClick={() => setFormat("json")}
              >
                <Braces size={13} />
                JSON
              </button>
            </div>
            <IconButton
              icon={Clipboard}
              label={`Copy ${direction} JSON`}
              disabled={!preview || preview.omitted}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(json);
                  notify(
                    `${direction === "input" ? "Input" : "Output"} preview copied`,
                  );
                } catch {
                  notify("Clipboard is unavailable in this browser.", true);
                }
              }}
            />
          </div>
          {preview?.redacted && (
            <p className="node-data-caption">
              Credential fields are hidden as [REDACTED].
            </p>
          )}
          {preview?.truncated && (
            <div className="node-data-notice">
              <AlertTriangle size={14} />
              <span>
                {preview.omitted
                  ? "The execution preview limit was reached; this payload was not captured."
                  : "This is a limited preview. Large collections, long strings or deeply nested fields may be shortened. Execution used the full data."}
              </span>
            </div>
          )}
          {preview?.omitted ? null : format === "json" ? (
            <pre
              className="json-output node-json-preview"
              aria-label={`${direction === "input" ? "Input" : "Output"} JSON data`}
            >
              {json}
            </pre>
          ) : (
            <div className="data-table node-table-preview">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    {columns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>
                      <td className="muted">{i + 1}</td>
                      {columns.map((column) => (
                        <td
                          key={column}
                          title={
                            typeof row[column] === "object"
                              ? JSON.stringify(row[column])
                              : String(row[column] ?? "")
                          }
                        >
                          {cell(row[column])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rows.length && (
                <p className="empty-table muted">
                  No items in this payload. Switch to JSON to inspect its
                  structure.
                </p>
              )}
              {allColumns.length > columns.length && (
                <p className="node-data-caption">
                  The table shows the first {columns.length} fields. JSON
                  includes every captured field.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
