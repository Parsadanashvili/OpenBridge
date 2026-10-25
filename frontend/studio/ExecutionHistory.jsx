import { useEffect, useState } from "react";
import { History, Play, RefreshCw } from "lucide-react";
import { api } from "../api";
import { Badge, Button, Empty, Field, Modal } from "../components/ui";
import { LoadingIndicator } from "../components/LoadingIndicator";
const time = (date) => new Date(date).toLocaleString();
const tone = (status) =>
  status === "success" ? "green" : status === "failed" ? "red" : "amber";

export default function ExecutionHistory({ base, flow, onClose, onOpen }) {
  const [runs, setRuns] = useState([]);
  const [selected, setSelected] = useState("");
  const [baseline, setBaseline] = useState("auto");
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const endpoint = `${base}/flows/${flow.id}/executions`;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api(endpoint, { signal: controller.signal })
      .then(({ runs }) => {
        setRuns(runs);
        setSelected((id) =>
          runs.some((run) => run.id === id) ? id : runs[0]?.id || "",
        );
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [endpoint, revision]);
  const index = runs.findIndex((run) => run.id === selected);
  const previousSuccess = runs
    .slice(index + 1)
    .find((run) => run.status === "success");
  const compareId = baseline === "auto" ? previousSuccess?.id : baseline;
  useEffect(() => {
    if (!selected) {
      setRecord(null);
      return;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    setRecord(null);
    setError("");
    const query = compareId
      ? `?compareTo=${encodeURIComponent(compareId)}`
      : "";
    api(`${endpoint}/${selected}${query}`, { signal: controller.signal })
      .then(setRecord)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [endpoint, selected, compareId, revision]);
  const comparison = record?.comparison;
  return (
    <Modal
      title="Execution history"
      description={`${flow.name} · Latest 20 Studio runs retained on this server. Public endpoint calls are not recorded.`}
      onClose={onClose}
      wide
    >
      <div className="history-actions">
        <Button
          icon={RefreshCw}
          onClick={() => setRevision((n) => n + 1)}
          disabled={loading || detailLoading}
        >
          Refresh history
        </Button>
      </div>
      {error && (
        <div className="node-data-notice error" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <div className="history-loading" role="status">
          <LoadingIndicator size={28} />
          Loading execution history…
        </div>
      ) : !runs.length ? (
        <Empty icon={History} title="No saved executions">
          Execute this workflow to start its history. Earlier runs were not
          recorded.
        </Empty>
      ) : (
        <div className="execution-history-grid">
          <nav className="history-list" aria-label="Saved executions">
            {runs.map((run) => (
              <button
                key={run.id}
                className={selected === run.id ? "active" : ""}
                aria-pressed={selected === run.id}
                onClick={() => {
                  setSelected(run.id);
                  setBaseline("auto");
                }}
              >
                <Badge tone={tone(run.status)}>{run.status}</Badge>
                <time dateTime={run.startedAt}>{time(run.startedAt)}</time>
                <span>
                  v{run.version} · {run.durationMs} ms · {run.nodes.length}{" "}
                  nodes
                </span>
              </button>
            ))}
          </nav>
          <section className="history-detail" aria-label="Execution details">
            <Field label="Compare with">
              <select
                aria-label="Comparison baseline"
                value={baseline}
                onChange={(e) => setBaseline(e.target.value)}
              >
                <option value="auto">
                  Previous successful run
                  {previousSuccess
                    ? ` · ${time(previousSuccess.startedAt)}`
                    : " · unavailable"}
                </option>
                <option value="">No comparison</option>
                {runs
                  .filter((run) => run.id !== selected)
                  .map((run) => (
                    <option key={run.id} value={run.id}>
                      {time(run.startedAt)} · {run.status} · v{run.version}
                    </option>
                  ))}
              </select>
            </Field>
            {detailLoading ? (
              <div className="history-loading" role="status">
                <LoadingIndicator size={24} />
                Loading run…
              </div>
            ) : (
              record && (
                <>
                  <div className="history-run-heading">
                    <Badge tone={tone(record.status)}>{record.status}</Badge>
                    <span>
                      {time(record.startedAt)} · v{record.version} ·{" "}
                      {record.durationMs} ms
                    </span>
                    <Button icon={Play} onClick={() => onOpen(record)}>
                      Inspect run
                    </Button>
                  </div>
                  {record.error && (
                    <div className="node-data-notice error">{record.error}</div>
                  )}
                  <p className="node-data-caption">
                    Inspect run opens its saved results and node previews. Your
                    current workflow stays in the editor.
                  </p>
                  {comparison ? (
                    <div
                      className="node-data-notice"
                      data-testid="history-comparison"
                    >
                      {comparison.outputChanged
                        ? "Endpoint response changed"
                        : "Endpoint response unchanged"}{" "}
                      ·{" "}
                      {
                        comparison.changes.filter(
                          (n) => n.change !== "unchanged",
                        ).length
                      }{" "}
                      node preview changes. Compared with{" "}
                      {time(comparison.baseline.startedAt)}.
                    </div>
                  ) : (
                    <p className="node-data-caption">
                      {baseline === "auto"
                        ? "No earlier successful run is available for comparison."
                        : "Choose another execution to compare results."}
                    </p>
                  )}
                  <div className="data-table history-node-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Node</th>
                          <th>Status</th>
                          <th>Items</th>
                          <th>Duration</th>
                          <th>Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(
                          comparison?.changes ||
                          record.nodes.map((node) => ({
                            node: node.node,
                            after: node,
                          }))
                        ).map((row) => (
                          <tr key={row.node}>
                            <td>{row.node}</td>
                            <td>
                              {row.after
                                ? row.after.skipped
                                  ? "Skipped"
                                  : row.after.ok
                                    ? "Success"
                                    : "Failed"
                                : "Removed"}
                            </td>
                            <td>
                              {row.before ? `${row.before.count} → ` : ""}
                              {row.after?.count ?? "—"}
                            </td>
                            <td>
                              {row.before ? `${row.before.ms} → ` : ""}
                              {row.after?.ms ?? "—"} ms
                            </td>
                            <td>{row.change || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <details className="history-json">
                    <summary>
                      Endpoint response{comparison ? " · before / after" : ""}
                    </summary>
                    <p className="node-data-caption">
                      Saved previews are redacted and bounded to 50 entries per
                      collection. Node changes compare captured previews;
                      endpoint change detection uses the full response hash.
                      Runtime timestamps are excluded.
                    </p>
                    {(record.outputPreview.truncated ||
                      comparison?.baselinePreview.truncated) && (
                      <div className="node-data-notice">
                        Response preview shortened. The execution used the full
                        data.
                      </div>
                    )}
                    <div className={comparison ? "history-output-pair" : ""}>
                      {comparison && (
                        <div>
                          <h3>Before</h3>
                          <pre
                            className="json-output"
                            aria-label="Previous response"
                          >
                            {JSON.stringify(comparison.baselineOutput, null, 2)}
                          </pre>
                        </div>
                      )}
                      <div>
                        <h3>{comparison ? "After" : "Response"}</h3>
                        <pre
                          className="json-output"
                          aria-label="Saved response"
                        >
                          {JSON.stringify(record.result.data, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </details>
                  <details className="history-json">
                    <summary>Execution inputs</summary>
                    <pre className="json-output">
                      {JSON.stringify(
                        record.result.meta?.inputs || {},
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </>
              )
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
