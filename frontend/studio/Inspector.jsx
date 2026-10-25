import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Braces,
  ChevronDown,
  Plus,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { Button, Field, IconButton } from "../components/ui";
import { inputSpec, typeInfo } from "./model";
import NodeDataPanel from "./NodeDataPanel";

function Text({ label, value, onChange, hint, ...props }) {
  return (
    <Field label={label} hint={hint}>
      <input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        {...props}
      />
    </Field>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <Field label={label}>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value ?? o} value={o.value ?? o}>
            {o.label ?? o}
          </option>
        ))}
      </select>
    </Field>
  );
}

export default function Inspector({
  node,
  banks,
  onChange,
  onDelete,
  onClose,
  execution,
  stale,
  busy,
  disabled,
  onRun,
  notify,
}) {
  const [tab, setTab] = useState("parameters");
  const [editor, setEditor] = useState("form");
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");
  const info = typeInfo(node.data.kind),
    Icon = info.icon;
  const config = node.data.config;
  useEffect(() => {
    setRaw(JSON.stringify(config, null, 2));
    setError("");
  }, [node.id, config]);
  useEffect(() => {
    setTab("parameters");
    setEditor("form");
  }, [node.id]);
  const patch = (key, value) => onChange({ ...config, [key]: value });
  const checkbox = (key, title, defaultValue = false) => (
    <label className="checkbox-field">
      <input
        type="checkbox"
        checked={config[key] ?? defaultValue}
        onChange={(e) => patch(key, e.target.checked)}
      />
      <span>{title}</span>
    </label>
  );
  const field = (key, label, hint) => (
    <Text
      key={key}
      label={label}
      value={config[key]}
      onChange={(v) => patch(key, v)}
      hint={hint}
    />
  );
  const inputs = inputSpec({ nodes: [{ type: "trigger", config }] });
  const setInputs = (next) => {
    const c = { ...config, inputs: next };
    delete c.params;
    onChange(c);
  };
  const updateInput = (index, key, value) =>
    setInputs(inputs.map((s, i) => (i === index ? { ...s, [key]: value } : s)));

  return (
    <aside
      className={`inspector ${tab !== "parameters" ? "inspecting-data" : ""}`}
      aria-label="Node settings"
    >
      <div className="panel-heading">
        <span className={`node-icon small ${info.color}`}>
          <Icon size={20} />
        </span>
        <div>
          <h2>{info.title}</h2>
          <span className="muted mono">{node.id}</span>
        </div>
        <IconButton icon={X} label="Close node settings" onClick={onClose} />
      </div>
      <div className="panel-tabs">
        <button
          className={tab === "input" ? "active" : ""}
          onClick={() => setTab("input")}
        >
          <ArrowDownToLine size={14} />
          Input
        </button>
        <button
          className={tab === "parameters" ? "active" : ""}
          onClick={() => setTab("parameters")}
        >
          <Settings2 size={14} />
          Parameters
        </button>
        <button
          className={tab === "output" ? "active" : ""}
          onClick={() => setTab("output")}
        >
          <ArrowUpFromLine size={14} />
          Output
        </button>
      </div>
      <div className="inspector-content">
        {tab !== "parameters" ? (
          <NodeDataPanel
            key={`${node.id}-${tab}`}
            direction={tab}
            execution={execution}
            busy={busy}
            stale={stale}
            onRun={onRun}
            notify={notify}
          />
        ) : (
          <>
            <p className="panel-description">{info.description}</p>
            <div className="parameter-editor-tabs">
              <button
                className={editor === "form" ? "active" : ""}
                onClick={() => setEditor("form")}
              >
                <Settings2 size={13} />
                Form
              </button>
              <button
                className={editor === "json" ? "active" : ""}
                onClick={() => setEditor("json")}
              >
                <Braces size={13} />
                JSON
              </button>
            </div>
            <fieldset className="inspector-fields" disabled={disabled}>
              {editor === "json" ? (
                <>
                  <Field
                    label="Node configuration"
                    hint="Apply changes to update this node. Expressions use {{params.name}}."
                  >
                    <textarea
                      className="code-editor"
                      aria-label="Node configuration JSON"
                      value={raw}
                      onChange={(e) => setRaw(e.target.value)}
                      spellCheck={false}
                    />
                  </Field>
                  {error && (
                    <p className="inline-error" role="alert">
                      {error}
                    </p>
                  )}
                  <Button
                    variant="primary"
                    onClick={() => {
                      try {
                        const next = JSON.parse(raw);
                        if (
                          !next ||
                          Array.isArray(next) ||
                          typeof next !== "object"
                        )
                          throw new Error(
                            "Configuration must be a JSON object.",
                          );
                        onChange(next);
                        setError("");
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    Apply JSON
                  </Button>
                </>
              ) : (
                <>
                  {node.data.kind === "bank" && (
                    <>
                      <Select
                        label="Bank connection"
                        value={config.bank}
                        onChange={(v) => patch("bank", v)}
                        options={banks.map((b) => ({
                          value: b.id,
                          label: `${b.name}${b.enabled ? "" : " · unavailable"}`,
                        }))}
                      />
                      <Select
                        label="Operation"
                        value={config.op}
                        onChange={(v) => patch("op", v)}
                        options={[
                          "accounts",
                          "details",
                          "balances",
                          "transactions",
                        ]}
                      />
                      {checkbox("withBalance", "Include balances", true)}
                      {config.op !== "accounts" && (
                        <>
                          {field(
                            "account",
                            "Account ID",
                            "Leave empty to read multiple accounts. Accepts {{params.accountId}}.",
                          )}
                          {field(
                            "currency",
                            "Account currency",
                            "Optional. For example GEL or {{params.currency}}.",
                          )}
                          {field(
                            "maxAccounts",
                            "Maximum accounts",
                            "Defaults to 3 when no account ID is supplied.",
                          )}
                        </>
                      )}
                      {config.op === "transactions" && (
                        <>
                          {field(
                            "dateFrom",
                            "From date",
                            "YYYY-MM-DD or {{params.dateFrom}}",
                          )}
                          {field(
                            "dateTo",
                            "To date",
                            "Optional inclusive end date.",
                          )}
                          <Select
                            label="Booking status"
                            value={config.bookingStatus || "booked"}
                            onChange={(v) => patch("bookingStatus", v)}
                            options={[
                              "booked",
                              "pending",
                              "both",
                              "information",
                              "all",
                            ]}
                          />
                          {field(
                            "maxPages",
                            "Maximum pages",
                            "Defaults to 5 pages per account.",
                          )}
                        </>
                      )}
                    </>
                  )}
                  {node.data.kind === "trigger" && (
                    <>
                      <div className="section-label">
                        Endpoint inputs <span>{inputs.length}</span>
                      </div>
                      {inputs.map((s, i) => (
                        <div className="input-definition" key={i}>
                          <div className="definition-heading">
                            <span>Input {i + 1}</span>
                            <IconButton
                              icon={Trash2}
                              label={`Remove input ${s.name || i + 1}`}
                              onClick={() =>
                                setInputs(inputs.filter((_, j) => i !== j))
                              }
                            />
                          </div>
                          <Text
                            label="Name"
                            value={s.name}
                            onChange={(v) => updateInput(i, "name", v)}
                          />
                          <Select
                            label="Type"
                            value={s.type || "string"}
                            onChange={(v) => updateInput(i, "type", v)}
                            options={[
                              "string",
                              "number",
                              "integer",
                              "boolean",
                              "date",
                              "enum",
                            ]}
                          />
                          <Text
                            label="Default value"
                            value={s.default}
                            onChange={(v) => updateInput(i, "default", v)}
                          />
                          {s.type === "enum" && (
                            <Text
                              label="Allowed values"
                              value={(s.values || []).join(", ")}
                              onChange={(v) =>
                                updateInput(
                                  i,
                                  "values",
                                  v.split(",").map((x) => x.trim()),
                                )
                              }
                              hint="Separate values with commas."
                            />
                          )}
                          <label className="checkbox-field">
                            <input
                              type="checkbox"
                              checked={!!s.required}
                              onChange={(e) =>
                                updateInput(i, "required", e.target.checked)
                              }
                            />
                            Required input
                          </label>
                        </div>
                      ))}
                      <Button
                        icon={Plus}
                        onClick={() =>
                          setInputs([
                            ...inputs,
                            {
                              name: `input${inputs.length + 1}`,
                              type: "string",
                            },
                          ])
                        }
                      >
                        Add input
                      </Button>
                      <div className="help-note">
                        Use an input in any node with{" "}
                        <code>{"{{params.name}}"}</code>.
                      </div>
                    </>
                  )}
                  {node.data.kind === "map" && (
                    <>
                      {field(
                        "path",
                        "Source collection",
                        "For example accounts, booked, or balances.",
                      )}
                      <div className="section-label">
                        Field mappings <span>{config.fields?.length || 0}</span>
                      </div>
                      {(config.fields || []).map((f, i) => {
                        const update = (key, value) =>
                          patch(
                            "fields",
                            config.fields.map((entry, j) =>
                              j === i ? { ...entry, [key]: value } : entry,
                            ),
                          );
                        return (
                          <div className="mapping-field" key={i}>
                            <div className="definition-heading">
                              <span>Field {i + 1}</span>
                              <IconButton
                                icon={Trash2}
                                label={`Remove mapping ${i + 1}`}
                                onClick={() =>
                                  patch(
                                    "fields",
                                    config.fields.filter((_, j) => i !== j),
                                  )
                                }
                              />
                            </div>
                            <Text
                              label="Output field"
                              value={f.to}
                              onChange={(v) => update("to", v)}
                            />
                            <Text
                              label={
                                f.fmt != null ? "Value template" : "Source path"
                              }
                              value={f.fmt ?? f.from}
                              onChange={(v) =>
                                update(f.fmt != null ? "fmt" : "from", v)
                              }
                            />
                            <Select
                              label="Format"
                              value={f.fn || ""}
                              onChange={(v) => update("fn", v)}
                              options={[
                                { value: "", label: "Keep original" },
                                "decimal",
                                "number",
                                "isoDate",
                                "upper",
                                "lower",
                                "string",
                                "abs",
                              ]}
                            />
                            <label className="checkbox-field">
                              <input
                                type="checkbox"
                                checked={f.required !== false}
                                onChange={(e) =>
                                  update("required", e.target.checked)
                                }
                              />
                              Report when missing
                            </label>
                          </div>
                        );
                      })}
                      <Button
                        icon={Plus}
                        onClick={() =>
                          patch("fields", [
                            ...(config.fields || []),
                            { to: "field", from: "source" },
                          ])
                        }
                      >
                        Add mapping
                      </Button>
                      <details className="syntax-help">
                        <summary>
                          Path syntax <ChevronDown size={13} />
                        </summary>
                        <p>
                          <code>a.b[0].c</code> nested field
                          <br />
                          <code>name|displayName</code> fallback
                          <br />
                          <code>@bank</code> source bank
                          <br />
                          <code>=GEL</code> constant
                        </p>
                      </details>
                    </>
                  )}
                  {node.data.kind === "filter" && (
                    <>
                      {field("field", "Field")}
                      <Select
                        label="Condition"
                        value={config.op || "eq"}
                        onChange={(v) => patch("op", v)}
                        options={[
                          { value: "eq", label: "Equals" },
                          { value: "ne", label: "Does not equal" },
                          { value: "gt", label: "Greater than" },
                          { value: "lt", label: "Less than" },
                          { value: "contains", label: "Contains" },
                          { value: "exists", label: "Exists" },
                        ]}
                      />
                      {config.op !== "exists" &&
                        field(
                          "value",
                          "Value",
                          "Use {{params.name}} for a runtime input.",
                        )}
                    </>
                  )}
                  {node.data.kind === "sort" && (
                    <>
                      {field("field", "Sort by")}
                      <Select
                        label="Direction"
                        value={config.dir || "asc"}
                        onChange={(v) => patch("dir", v)}
                        options={[
                          { value: "asc", label: "Ascending" },
                          { value: "desc", label: "Descending" },
                        ]}
                      />
                    </>
                  )}
                  {node.data.kind === "limit" &&
                    field(
                      "n",
                      "Number of items",
                      "A number or {{params.limit}}.",
                    )}
                  {node.data.kind === "aggregate" && (
                    <>
                      {field("groupBy", "Group by")}
                      {field("sum", "Field to sum")}
                      {field("as", "Output field name")}
                    </>
                  )}
                  {node.data.kind === "respond" && (
                    <>
                      {field(
                        "wrap",
                        "Response property",
                        "The top-level key in the JSON response.",
                      )}
                      {checkbox("single", "Return a single object")}
                      {checkbox("includeSource", "Include source bank", true)}
                      {config.single &&
                        checkbox(
                          "notFound",
                          "Return 404 when no item is found",
                          true,
                        )}
                      {config.schema && (
                        <div className="help-note">
                          Response schema validation is enabled. Edit the schema
                          in the JSON tab.
                        </div>
                      )}
                    </>
                  )}
                  {node.data.kind === "merge" && (
                    <div className="help-note">
                      Connect two or more branches. Incoming items are combined
                      into one collection.
                    </div>
                  )}
                </>
              )}
            </fieldset>
            {execution?.inspection?.parameters && (
              <details className="resolved-parameters">
                <summary>
                  Parameters used in {stale ? "previous" : "last"} execution
                </summary>
                <p>
                  Runtime expressions are resolved here. The editor above keeps
                  your configured expressions.
                </p>
                <pre className="json-output">
                  {JSON.stringify(
                    execution.inspection.parameters.value,
                    null,
                    2,
                  )}
                </pre>
                {execution.inspection.parameters.truncated && (
                  <p>Parameter preview was shortened.</p>
                )}
                {execution.inspection.parameters.redacted && (
                  <p>Credential fields are hidden as [REDACTED].</p>
                )}
              </details>
            )}
          </>
        )}
      </div>
      <div className="inspector-footer">
        <Button
          icon={Trash2}
          variant="danger-ghost"
          onClick={onDelete}
          disabled={disabled}
        >
          Delete node
        </Button>
        <span className="muted">Changes are local until saved</span>
      </div>
    </aside>
  );
}
