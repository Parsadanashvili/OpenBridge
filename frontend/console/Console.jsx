import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Download,
  FileCheck2,
  Gauge,
  LayoutDashboard,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { api, send } from "../api";
import { LoadingIndicator } from "../components/LoadingIndicator";
import {
  Badge,
  Brand,
  Button,
  Empty,
  Field,
  Modal,
  Toast,
} from "../components/ui";

const tabs = [
  {
    id: "overview",
    name: "Overview",
    icon: LayoutDashboard,
    description: "Banking APIs, at a glance.",
    title: "Audit overview",
  },
  {
    id: "auditor",
    name: "API Auditor",
    icon: Activity,
    description: "Inspect conformance checks and security evidence.",
    title: "API Auditor",
  },
  {
    id: "findings",
    name: "AI Findings",
    icon: Sparkles,
    description: "Understand each finding and its recommended fix.",
    title: "Findings & explanations",
  },
  {
    id: "reports",
    name: "Regulatory reports",
    icon: FileCheck2,
    description:
      "Review standards coverage, documentation and manual evidence.",
    title: "Regulatory reports",
  },
];
const tone = (status) =>
  /^(pass|confirmed)$/.test(status)
    ? "green"
    : /^(fail|failed|high|critical)$/.test(status)
      ? "red"
      : /medium|not_|outstanding/.test(status)
        ? "amber"
        : "neutral";
const label = (status) => String(status || "unknown").replaceAll("_", " ");
const SEV = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function Card({ title, subtitle, action, children, className = "" }) {
  return (
    <section className={`report-card ${className}`}>
      <div className="report-card-header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function DataTable({ headers, rows, empty = "No records to show." }) {
  return (
    <div className="data-table">
      <table>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="empty-table muted">{empty}</p>}
    </div>
  );
}

function Overview({ run, findings, onRun, running }) {
  if (!run)
    return (
      <Empty
        icon={Gauge}
        title="Your first audit starts here"
        action={
          <Button
            icon={Play}
            variant="execute"
            loading={running}
            onClick={onRun}
          >
            Run interoperability audit
          </Button>
        }
      >
        Run the deterministic checks against the configured simulators to
        inspect API quality and standards coverage.
      </Empty>
    );
  const performance = run.performance || [];
  const requests = performance.reduce((sum, p) => sum + p.requests, 0),
    failures = performance.reduce((sum, p) => sum + p.failed, 0);
  const worst = performance.length
    ? Math.max(...performance.map((p) => p.p95Ms || p.medianMs || 0))
    : null;
  const high =
    (run.summary.bySeverity.high || 0) + (run.summary.bySeverity.critical || 0);
  const metrics = [
    [
      "Worst p95 latency",
      worst == null ? "—" : `${worst} ms`,
      "Demo target: under 300 ms",
      worst != null && worst > 300,
    ],
    [
      "Request failure rate",
      requests ? `${((failures / requests) * 100).toFixed(1)}%` : "—",
      `${failures} failed of ${requests} sampled requests`,
      failures > 0,
    ],
    ["High severity", high, "High and critical findings", high > 0],
    [
      "Rules evaluated",
      `${run.summary.rulesEvaluated} / ${run.summary.rulesTotal}`,
      `${run.summary.testsRun} tests and checks`,
      false,
    ],
  ];
  return (
    <>
      <div className="metric-grid">
        {metrics.map(([title, value, note, warning]) => (
          <div className="metric" key={title}>
            <span>{title}</span>
            <strong className={warning ? "warning-text" : ""}>{value}</strong>
            <small>{note}</small>
          </div>
        ))}
      </div>
      <Card
        title="Endpoint performance"
        subtitle="Observed short-run results. Demo targets are not regulatory benchmarks."
      >
        <div className="latency-chart">
          {performance.map((p, i) => (
            <div className="latency-row" key={i}>
              <div>
                <strong>{p.bank}</strong>
                <span>{p.endpoint.replace("GET ", "")}</span>
              </div>
              <div className="latency-track">
                <div
                  className={`latency-fill ${p.bank === "beta" ? "beta" : ""}`}
                  style={{
                    width: `${Math.min(100, ((p.p95Ms ?? p.medianMs ?? 0) / Math.max(worst || 1, 300)) * 100)}%`,
                  }}
                />
              </div>
              <span className="mono">{p.p95Ms ?? p.medianMs ?? "—"} ms</span>
              <Badge tone={p.failed || p.p95Ms > 300 ? "amber" : "green"}>
                {p.failed ? `${p.failed} failed` : "No failures"}
              </Badge>
            </div>
          ))}
        </div>
      </Card>
      <div className="console-columns">
        <Card title="Priority findings" subtitle="Highest severity first.">
          {[...findings]
            .sort((a, b) => SEV[a.severity] - SEV[b.severity])
            .slice(0, 4)
            .map((f) => (
              <div className="priority-finding" key={f.id}>
                <div>
                  <Badge tone={tone(f.severity)}>{f.severity}</Badge>
                  <span className="muted">{f.bankName}</span>
                </div>
                <strong>{f.title}</strong>
                <p>{f.explanation?.recommendedFix || f.recommendedFix}</p>
              </div>
            ))}
        </Card>
        <Card
          title="Bank coverage"
          subtitle="Configured institutions and their audit status."
        >
          {run.banks.map((b) => (
            <div className="bank-audit-row" key={b.id}>
              <span className="bank-avatar">{b.id[0].toUpperCase()}</span>
              <div>
                <strong>{b.name}</strong>
                <small>
                  {b.simulated ? "Synthetic simulator" : "Sandbox run"}
                </small>
              </div>
              <Badge tone="green">Audited</Badge>
            </div>
          ))}
          {run.notRun.map((b) => (
            <div className="bank-audit-row" key={b.id}>
              <span className="bank-avatar">{b.id[0].toUpperCase()}</span>
              <div>
                <strong>{b.name}</strong>
                <small>{b.reason}</small>
              </div>
              <Badge>Not run</Badge>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}

function Auditor({ run, findings }) {
  const [bank, setBank] = useState("");
  const active = run?.banks.some((b) => b.id === bank)
    ? bank
    : run?.banks[0]?.id;
  if (!run)
    return (
      <Empty title="No runtime audit yet">
        Run an audit to inspect API checks, security controls and expected
        versus actual values.
      </Empty>
    );
  const tests = run.tests.filter((t) => t.bank === active);
  return (
    <>
      <div className="filter-toolbar">
        <Field label="Institution">
          <select
            value={active || ""}
            onChange={(e) => setBank(e.target.value)}
          >
            {run.banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <span className="muted">
          {tests.filter((t) => t.status === "pass").length} passed ·{" "}
          {tests.filter((t) => t.status === "fail").length} failed ·{" "}
          {tests.filter((t) => t.status === "not_run").length} not assessed
        </span>
      </div>
      <Card title="Conformance checks">
        <DataTable
          headers={["Test / rule", "Operation", "Status", "Details"]}
          rows={tests.map((t) => [
            <>
              <code>{t.ruleId}</code>
              <small className="table-subtext">{t.testId}</small>
            </>,
            <code>{t.operation}</code>,
            <Badge tone={tone(t.status)}>{label(t.status)}</Badge>,
            t.note || "—",
          ])}
        />
      </Card>
      <Card title="Security controls">
        <DataTable
          headers={["Control", "Status", "Expected", "Observed"]}
          rows={run.security
            .filter((t) => t.bank === active)
            .map((t) => [
              t.ruleId,
              <Badge tone={tone(t.status)}>{label(t.status)}</Badge>,
              t.expected,
              t.actual || "—",
            ])}
        />
      </Card>
      <Card title="Expected vs. actual">
        <DataTable
          headers={["Severity", "Rule", "Location", "Expected", "Actual"]}
          rows={findings
            .filter((f) => f.bank === active)
            .map((f) => [
              <Badge tone={tone(f.severity)}>{f.severity}</Badge>,
              <code>{f.ruleId}</code>,
              <code>{f.jsonPath || f.operation}</code>,
              f.expected,
              f.actual,
            ])}
        />
      </Card>
    </>
  );
}

function Findings({ findings, run }) {
  const [query, setQuery] = useState(""),
    [severity, setSeverity] = useState("all");
  const filtered = findings.filter(
    (f) =>
      (severity === "all" || f.severity === severity) &&
      `${f.title} ${f.bankName} ${f.ruleId} ${f.jsonPath || ""} ${f.operation || ""} ${f.expected || ""} ${f.actual || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  if (!run)
    return (
      <Empty
        icon={Sparkles}
        title="Findings will appear after your first audit"
      >
        Explanations use the observed evidence. AI never changes a test’s
        verdict.
      </Empty>
    );
  return (
    <>
      <div className="findings-filters">
        <div className="search-box">
          <Search size={16} />
          <input
            aria-label="Search findings"
            placeholder="Search findings, rules or banks…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label="Filter findings by severity"
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
        >
          {["all", "critical", "high", "medium", "low", "info"].map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All severities" : s}
            </option>
          ))}
        </select>
        <span className="muted">{filtered.length} findings</span>
      </div>
      {filtered.map((f) => {
        const e = f.explanation || {};
        return (
          <Card
            key={f.id}
            title={f.title}
            subtitle={`${f.bankName} · ${f.ruleId} · ${f.operation}`}
            action={<Badge tone={tone(f.severity)}>{f.severity}</Badge>}
          >
            <div className="finding-content">
              <div className="finding-comparison">
                <div>
                  <span>Expected</span>
                  <p>{f.expected}</p>
                </div>
                <div>
                  <span>Observed</span>
                  <p>{f.actual}</p>
                </div>
              </div>
              <div className="explanation">
                <div className="inline-actions">
                  <strong>Explanation</strong>
                  <Badge>
                    {e.source === "ai"
                      ? `AI · ${e.model}`
                      : "Deterministic template"}
                  </Badge>
                </div>
                <p>{e.whatWentWrong}</p>
                <p>
                  <strong>Why it matters</strong>
                  <br />
                  {e.whyItMatters || f.impact}
                </p>
                <p>
                  <strong>Recommended fix</strong>
                  <br />
                  {e.recommendedFix || f.recommendedFix}
                </p>
              </div>
              <div className="finding-reference">
                <BookOpen size={13} />
                {f.specRef}
                {!f.specRefVerified && (
                  <Badge tone="amber">Page reference unverified</Badge>
                )}
              </div>
              <details className="evidence-detail">
                <summary>View request / response evidence</summary>
                <pre className="json-output">
                  {JSON.stringify(f.evidence, null, 2) ||
                    "No HTTP evidence attached."}
                </pre>
              </details>
            </div>
          </Card>
        );
      })}
      {!filtered.length && (
        <Empty icon={CheckCircle2} title="No matching findings">
          Try a different search or severity filter.
        </Empty>
      )}
    </>
  );
}

function Reports({ run, notify }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(null),
    [edit, setEdit] = useState(null),
    [note, setNote] = useState(""),
    [status, setStatus] = useState(""),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    Promise.all([
      api("/api/docaudit", { signal: c.signal }),
      api("/api/rulebook", { signal: c.signal }),
      api("/api/evidence", { signal: c.signal }),
      api("/api/transform", { signal: c.signal }).catch((e) =>
        e.name === "AbortError" ? Promise.reject(e) : { error: e.message },
      ),
    ])
      .then(([docs, rulebook, evidence, transform]) =>
        setData({ docs, rulebook, evidence, transform }),
      )
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [run?.runId]);
  if (error) return <Empty title="Reports are unavailable">{error}</Empty>;
  if (!data)
    return (
      <div className="section-loading" role="status">
        <LoadingIndicator size={22} />
        Loading reports…
      </div>
    );
  const { docs, rulebook, evidence, transform } = data;
  const bankIds = rulebook.banks || [];
  const result = (coverage, bank) => {
    const c = coverage.banks[bank];
    return c?.fail ? (
      <Badge tone="red">{c.fail} failed</Badge>
    ) : c?.pass ? (
      <Badge tone="green">Passed</Badge>
    ) : (
      <Badge>Not assessed</Badge>
    );
  };
  const links = [
    ["Incompatibility report", "incompatibility.md", "Markdown", true],
    ["Findings data", "incompatibility.json", "JSON", true],
    ["Quality report", "quality.md", "Markdown", true],
    ["Quality data", "quality.csv", "CSV", true],
    ["Documentation audit", "doc-audit.md", "Markdown", false],
    ["Standards rulebook", "rulebook.md", "Markdown", false],
  ];
  return (
    <>
      <div className="download-grid">
        {links.map(([name, path, format, needsRun]) =>
          needsRun && !run ? (
            <div className="download-card disabled" key={path}>
              <Download size={18} />
              <div>
                <strong>{name}</strong>
                <small>Run an audit to download</small>
              </div>
            </div>
          ) : (
            <a
              className="download-card"
              key={path}
              href={`/api/reports/${path}`}
            >
              <Download size={18} />
              <div>
                <strong>{name}</strong>
                <small>{format}</small>
              </div>
              <ChevronRight size={15} />
            </a>
          ),
        )}
      </div>
      <Card
        title="Documentation audit"
        subtitle="Offline validation of the saved BOG OpenAPI and TBC portal contracts."
        action={<Badge>Offline</Badge>}
      >
        <div className="documentation-summary">
          <strong>{docs.summary.examplesChecked}</strong>
          <span>published examples checked</span>
          <Badge tone="green">{docs.summary.examplesValid} valid</Badge>
          <Badge tone="red">{docs.summary.examplesInvalid} invalid</Badge>
          <span className="muted">
            {docs.summary.distinctExampleRootCauses} root causes · documentation
            observations, not bank scores
          </span>
        </div>
        <DataTable
          headers={["Source", "Finding", "Expected / actual"]}
          rows={docs.findings
            .filter(
              (f) =>
                f.ruleId === "DOC-EXAMPLE" ||
                (f.ruleId === "DOC-LOOSE" &&
                  f.bank === "tbc" &&
                  f.op === "accountList"),
            )
            .slice(0, 10)
            .map((f) => [
              <>
                {f.bank.toUpperCase()} · {f.op}
                <small className="table-subtext mono">{f.jsonPath}</small>
              </>,
              <>
                {f.title}
                <small className="table-subtext">{f.classificationLabel}</small>
              </>,
              <>
                {f.expected}
                <small className="table-subtext">{f.actual}</small>
              </>,
            ])}
        />
      </Card>
      <Card
        title="Standards coverage"
        subtitle={`${rulebook.summary.total} rules · ${rulebook.summary.byStatus.implemented || 0} implemented · ${rulebook.summary.byStatus.manual || 0} require manual evidence`}
      >
        <DataTable
          headers={["Rule", "Level", ...bankIds, "Source"]}
          rows={(rulebook.coverage || []).map((r) => {
            const source = rulebook.rules.find((x) => x.id === r.id)?.source;
            return [
              <>
                <code>{r.id}</code>
                <small className="table-subtext">{r.title}</small>
              </>,
              label(r.level),
              ...bankIds.map((b) => result(r, b)),
              source
                ? `${source.doc} ${source.section}, p. ${source.pages}`
                : "—",
            ];
          })}
          empty="Run an audit to see per-bank rule coverage."
        />
      </Card>
      <Card
        title="Manual evidence checklist"
        subtitle="Record the checks that software cannot verify alone."
      >
        <DataTable
          headers={["Rule", ...Object.keys(evidence.checklist[0]?.banks || {})]}
          rows={evidence.checklist.map((r) => [
            <>
              <code>{r.id}</code>
              <small className="table-subtext">
                {r.title} · {r.source.doc} {r.source.section}, p.{" "}
                {r.source.pages}
              </small>
            </>,
            ...Object.entries(r.banks).map(([bank, value]) => (
              <button
                className="evidence-status"
                onClick={() => {
                  setEdit({ bank, ruleId: r.id, title: r.title });
                  setNote(value.note || "");
                  setStatus(value.status);
                }}
              >
                <Badge tone={tone(value.status)}>{label(value.status)}</Badge>
                <small>{value.note || "Add evidence"}</small>
              </button>
            )),
          ])}
        />
      </Card>
      <Card
        title="Canonical transformation"
        subtitle="Synthetic Beta data → canonical account model → Alpha response."
      >
        {transform.result ? (
          <div className="transform-content">
            <Badge>{transform.result.mappingVersion}</Badge>
            <DataTable
              headers={["Account", "Decision", "Missing mandatory fields"]}
              rows={transform.result.deliveries.map((d) => [
                d.accountId || "—",
                <Badge tone={d.decision === "DELIVERED" ? "green" : "amber"}>
                  {label(d.decision)}
                </Badge>,
                d.missingMandatoryFields.join(", ") || "None",
              ])}
            />
            <p>{transform.result.reportToBankA}</p>
            <p>{transform.result.reportToBankB}</p>
            <details className="evidence-detail">
              <summary>View transformation log</summary>
              <pre className="json-output">
                {JSON.stringify(transform.result.transformationLog, null, 2)}
              </pre>
            </details>
          </div>
        ) : (
          <p className="muted padded">
            {transform.error || "The transformation is unavailable."}
          </p>
        )}
      </Card>
      {edit && (
        <Modal
          title="Record manual evidence"
          description={`${edit.bank.toUpperCase()} · ${edit.ruleId} · ${edit.title}`}
          onClose={() => !saving && setEdit(null)}
        >
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {evidence.statuses.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Evidence note"
            hint="Describe what was checked and include a document reference."
          >
            <textarea
              aria-label="Evidence note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={4}
            />
          </Field>
          <div className="modal-actions">
            <Button onClick={() => setEdit(null)} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await api(
                    "/api/evidence",
                    send("POST", {
                      bank: edit.bank,
                      ruleId: edit.ruleId,
                      status,
                      note,
                    }),
                  );
                  const next = await api("/api/evidence");
                  setData((d) => ({ ...d, evidence: next }));
                  setEdit(null);
                  notify("Evidence recorded");
                } catch (e) {
                  notify(e.message, true);
                } finally {
                  setSaving(false);
                }
              }}
            >
              Save evidence
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function Console() {
  const initial = location.hash.slice(1);
  const [tab, setTab] = useState(
    tabs.some((t) => t.id === initial) ? initial : "overview",
  );
  const [run, setRun] = useState(null),
    [findings, setFindings] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(null),
    [running, setRunning] = useState(false),
    [starting, setStarting] = useState(false),
    [progress, setProgress] = useState([]),
    [toast, setToast] = useState(null);
  const notify = useCallback(
    (message, error = false) => setToast({ message, error }),
    [],
  );
  const dismiss = useCallback(() => setToast(null), []);
  const refresh = useCallback(async (signal) => {
    try {
      const latest = await api("/api/latest", { signal });
      const explained = latest ? await api("/api/findings", { signal }) : [];
      if (signal?.aborted) return;
      setRun(latest);
      setFindings(explained);
      setError(null);
    } catch (e) {
      if (e.name !== "AbortError") setError(e.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const c = new AbortController();
    refresh(c.signal);
    api("/api/progress", { signal: c.signal })
      .then((p) => {
        setRunning(p.running);
        setProgress(p.progress);
      })
      .catch(() => {});
    return () => c.abort();
  }, [refresh]);
  useEffect(() => {
    if (!running) return;
    const c = new AbortController();
    let timer;
    async function poll() {
      try {
        const p = await api("/api/progress", { signal: c.signal });
        setProgress(p.progress);
        if (p.running) timer = setTimeout(poll, 700);
        else {
          const failed = p.progress.find((x) => x.m.startsWith("ERROR"));
          await refresh(c.signal);
          // Keep this effect alive until the final results have loaded. Setting
          // running=false first would abort refresh during the effect cleanup.
          if (!c.signal.aborted) {
            setRunning(false);
            notify(failed ? failed.m : "Audit completed", !!failed);
          }
        }
      } catch (e) {
        if (e.name !== "AbortError") {
          setRunning(false);
          notify(e.message, true);
        }
      }
    }
    poll();
    return () => {
      c.abort();
      clearTimeout(timer);
    };
  }, [running, refresh, notify]);
  useEffect(() => {
    const handler = () => {
      const id = location.hash.slice(1);
      if (tabs.some((t) => t.id === id)) setTab(id);
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  const startAudit = async () => {
    setStarting(true);
    try {
      await api("/api/run", send("POST", {}));
      setProgress([]);
      setRunning(true);
    } catch (e) {
      notify(e.message, true);
      if (e.status === 409) setRunning(true);
    } finally {
      setStarting(false);
    }
  };
  const active = tabs.find((t) => t.id === tab);
  return (
    <div className="console-app">
      <aside className="console-sidebar">
        <Brand />
        <div className="console-workspace">
          <span className="profile-avatar">
            <ShieldCheck size={17} />
          </span>
          <div>
            <strong>NBG console</strong>
            <small>Regulatory workspace</small>
          </div>
        </div>
        <div className="sidebar-section">
          <span>AUDIT & COMPLIANCE</span>
        </div>
        {tabs.map((t) => (
          <a
            key={t.id}
            href={`#${t.id}`}
            className={`nav-item ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            <t.icon size={17} />
            {t.name}
          </a>
        ))}
        <div className="sidebar-bottom">
          <a className="studio-switch" href="/studio?tenant=demo-tpp">
            <Workflow size={19} />
            <div>
              <strong>Flow Studio</strong>
              <small>Build banking workflows</small>
            </div>
            <ArrowRight size={16} />
          </a>
          <div className="environment-note">
            <span className="environment-dot" />
            <div>
              <strong>Simulation mode</strong>
              <small>Real banks have not been tested</small>
            </div>
          </div>
        </div>
      </aside>
      <main className="console-main">
        <header className="console-header">
          <div>
            <span>OpenBridge</span>
            <ChevronRight size={14} />
            <strong>NBG console</strong>
          </div>
          <a href="/studio?tenant=demo-tpp">
            Open Flow Studio <ArrowRight size={14} />
          </a>
        </header>
        <div className="console-content">
          <div className="console-title">
            <div>
              <span className="eyebrow">OPEN BANKING INTELLIGENCE</span>
              <h1>{active.title}</h1>
              <p>{active.description}</p>
            </div>
            <Button
              icon={Play}
              variant="execute"
              loading={running || starting}
              onClick={startAudit}
            >
              {running ? "Audit running…" : "Run audit"}
            </Button>
          </div>
          <div className="simulation-banner">
            <ShieldCheck size={16} />
            <span>
              {run && !run.summary.simulated
                ? "Sandbox run: review each bank’s simulation label and assessed controls."
                : "Simulated institutions. These results demonstrate the tool and do not establish real-bank compliance."}
            </span>
            <Badge>Sandbox</Badge>
          </div>
          {running && (
            <div className="audit-progress" role="status">
              <LoadingIndicator size={18} />
              <span>{progress.at(-1)?.m || "Starting audit…"}</span>
              <span className="muted">{progress.length} steps</span>
            </div>
          )}
          {error && (
            <div className="execution-error" role="alert">
              {error}
              <Button onClick={() => refresh()}>Retry</Button>
            </div>
          )}
          {loading ? (
            <div className="section-loading" role="status">
              <LoadingIndicator size={24} />
              Loading audit results…
            </div>
          ) : tab === "overview" ? (
            <Overview
              run={run}
              findings={findings}
              onRun={startAudit}
              running={running || starting}
            />
          ) : tab === "auditor" ? (
            <Auditor run={run} findings={findings} />
          ) : tab === "findings" ? (
            <Findings findings={findings} run={run} />
          ) : (
            <Reports run={run} notify={notify} />
          )}
          {run && (
            <footer className="console-footer">
              {run.runId} · {new Date(run.startedAt).toLocaleString()} ·{" "}
              {run.spec.id} · {run.summary.requestsExecuted} requests
            </footer>
          )}
        </div>
      </main>
      <Toast message={toast?.message} error={toast?.error} onClose={dismiss} />
    </div>
  );
}
