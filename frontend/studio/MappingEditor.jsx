import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  GripVertical,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { api, clone, send } from "../api";
import {
  Badge,
  Button,
  Empty,
  Field,
  IconButton,
  Modal,
} from "../components/ui";
import { LoadingIndicator } from "../components/LoadingIndicator";

const safeTarget = (path) =>
  path &&
  path
    .split(".")
    .every(
      (part) =>
        part.trim() &&
        !["__proto__", "prototype", "constructor"].includes(part),
    );
const display = (value) =>
  value === undefined ? "missing" : JSON.stringify(value);
function fieldsOf(rows) {
  const found = new Map();
  const walk = (value, path = "", depth = 0) => {
    if (depth > 8 || found.size >= 180) return;
    if (Array.isArray(value)) {
      value
        .slice(0, 4)
        .forEach((item, i) =>
          walk(
            item,
            `${path}[${item?.balanceType && /^[\w-]+$/.test(item.balanceType) ? `?balanceType=${item.balanceType}` : i}]`,
            depth + 1,
          ),
        );
    } else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value))
        if (!/[.\[\]]/.test(key))
          walk(child, path ? `${path}.${key}` : key, depth + 1);
    } else if (path && !found.has(path)) found.set(path, value);
  };
  rows.forEach((row) => walk(row));
  return [...found].map(([path, value]) => ({ path, value }));
}
function collectionsOf(value, prefix = "", depth = 0) {
  if (!value || typeof value !== "object" || depth > 5) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return Array.isArray(child)
      ? [path]
      : collectionsOf(child, path, depth + 1);
  });
}

export default function MappingEditor({
  config,
  sources,
  params,
  endpoint,
  stale,
  disabled,
  onApply,
  onClose,
}) {
  const [draft, setDraft] = useState(() => clone(config));
  const [sourceId, setSourceId] = useState(sources[0]?.node || "");
  const [selection, setSelection] = useState("");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState(null);
  const [sampleData, setSampleData] = useState(null);
  const targetList = useRef(null);
  const previousCount = useRef(config.fields?.length || 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const source = sources.find((s) => s.node === sourceId) || sources[0];
  const invalid = (draft.fields || []).some((f) => !safeTarget(f.to));
  const duplicate = (draft.fields || []).some((field, i, fields) =>
    fields.some(
      (other, j) =>
        j < i &&
        (field.to === other.to ||
          field.to?.startsWith(`${other.to}.`) ||
          other.to?.startsWith(`${field.to}.`)),
    ),
  );
  const serialized = JSON.stringify({
    config: draft,
    sources: source ? [source] : [],
    params,
  });
  useEffect(() => {
    const count = draft.fields?.length || 0;
    if (count > previousCount.current) {
      const input = targetList.current?.querySelector(
        ".visual-mapping-row:last-child input",
      );
      input?.focus();
    }
    previousCount.current = count;
  }, [draft.fields?.length]);
  useEffect(() => {
    const controller = new AbortController();
    setPreview(null);
    setError("");
    if (!source || source.preview?.omitted || invalid || duplicate) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      api(endpoint, {
        ...send("POST", JSON.parse(serialized)),
        signal: controller.signal,
      })
        .then((data) => {
          if (controller.signal.aborted) return;
          setPreview(data);
          setSampleData({
            source: source.node,
            path: draft.path,
            rows: data.samples?.[0]?.rows || [],
          });
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [serialized, endpoint, invalid, duplicate]);
  const rows =
    sampleData?.source === source?.node && sampleData?.path === draft.path
      ? sampleData.rows
      : [];
  const paths = useMemo(
    () => fieldsOf(rows),
    [sampleData, source?.node, draft.path],
  );
  const choices = [
    ...new Set([draft.path || "", ...collectionsOf(source?.preview?.value)]),
  ];
  const patchField = (index, values) =>
    setDraft((d) => ({
      ...d,
      fields: d.fields.map((f, i) => (i === index ? { ...f, ...values } : f)),
    }));
  const assign = (index, path) => {
    if (path) patchField(index, { from: path, fmt: undefined });
  };
  const add = (from = "") =>
    setDraft((d) => {
      let suffix = d.fields?.length || 0,
        to;
      do {
        to = `field${++suffix}`;
      } while (d.fields?.some((f) => f.to === to));
      return { ...d, fields: [...(d.fields || []), { to, from }] };
    });
  return (
    <Modal
      title="Visual field mapping"
      description="Select or drag a source field onto a target mapping. Preview uses captured input and the workflow engine."
      onClose={onClose}
      wide
    >
      <div className="mapping-editor">
        {(stale || source?.preview?.truncated || source?.preview?.redacted) && (
          <div className="node-data-notice">
            {stale
              ? "Using input from a previous execution. Upstream edits are not included. "
              : ""}
            {source?.preview?.truncated
              ? "Source data is a limited preview. "
              : ""}
            {source?.preview?.redacted
              ? "Credential values are redacted. "
              : ""}
            Execute the workflow after applying to verify the full result.
          </div>
        )}
        {(!source || source.preview?.omitted) && (
          <div className="node-data-notice">
            Run the workflow first to load source fields. You can still
            configure mappings here and apply them.
          </div>
        )}
        <div className="mapping-workspace">
          <section
            className="mapping-source"
            aria-label="Mapping source fields"
          >
            <h3>1. Source fields</h3>
            {sources.length > 0 && (
              <Field label="Source node">
                <select
                  aria-label="Mapping source node"
                  value={source?.node || ""}
                  onChange={(e) => {
                    setSourceId(e.target.value);
                    setSelection("");
                  }}
                >
                  {sources.map((s) => (
                    <option key={s.node} value={s.node}>
                      {s.node} · {s.count} items
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Source collection">
              <input
                aria-label="Mapping source collection"
                list="mapping-collections"
                value={draft.path || ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, path: e.target.value }))
                }
              />
              <datalist id="mapping-collections">
                {choices.map((path) => (
                  <option key={path} value={path} />
                ))}
              </datalist>
            </Field>
            <Field label="Search source fields">
              <div className="mapping-search">
                <Search size={14} />
                <input
                  aria-label="Search source fields"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="currency, amount…"
                />
              </div>
            </Field>
            <div className="mapping-source-tree">
              {source?.bank && (
                <button
                  className={selection === "@bank" ? "selected" : ""}
                  onClick={() => setSelection("@bank")}
                  draggable
                  onDragStart={(e) =>
                    e.dataTransfer.setData("text/openbridge-field", "@bank")
                  }
                >
                  <GripVertical size={12} />
                  <span>
                    <code>@bank</code>
                    <small>{source.bank}</small>
                  </span>
                </button>
              )}
              {paths
                .filter((f) =>
                  f.path.toLowerCase().includes(search.toLowerCase()),
                )
                .map((f) => (
                  <button
                    key={f.path}
                    className={selection === f.path ? "selected" : ""}
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData("text/openbridge-field", f.path)
                    }
                    onClick={() => setSelection(f.path)}
                    aria-label={`Select source ${f.path}`}
                  >
                    <GripVertical size={12} />
                    <span>
                      <code>{f.path}</code>
                      <small>{display(f.value)}</small>
                    </span>
                  </button>
                ))}
              {!paths.length && !loading && (
                <p className="node-data-caption">
                  {source
                    ? "No sample fields in this collection. Check the collection path or choose another source."
                    : "Source fields will appear after execution."}
                </p>
              )}
            </div>
            {selection && (
              <Button
                icon={Plus}
                onClick={() => add(selection)}
                disabled={disabled || draft.fields?.length >= 100}
              >
                Add selected field
              </Button>
            )}
          </section>
          <section
            className="mapping-targets"
            ref={targetList}
            aria-label="Target field mappings"
          >
            <div className="mapping-section-heading">
              <h3>2. Map to output</h3>
              <Button
                icon={Plus}
                onClick={() => add()}
                disabled={disabled || draft.fields?.length >= 100}
              >
                Add mapping
              </Button>
            </div>
            <p className="node-data-caption">
              {selection
                ? `Selected: ${selection}. Choose a target below.`
                : "Select a source on the left, or drag it onto a mapping."}
            </p>
            <fieldset disabled={disabled} className="inspector-fields">
              {(draft.fields || []).map((field, i) => (
                <div
                  className="visual-mapping-row"
                  key={i}
                  aria-label={`Mapping ${i + 1}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!disabled)
                      assign(
                        i,
                        e.dataTransfer.getData("text/openbridge-field"),
                      );
                  }}
                >
                  <div className="mapping-row-heading">
                    <span>Mapping {i + 1}</span>
                    <IconButton
                      icon={Trash2}
                      label={`Remove visual mapping ${i + 1}`}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          fields: d.fields.filter((_, j) => i !== j),
                        }))
                      }
                    />
                  </div>
                  <Field label={`Output field ${i + 1}`}>
                    <input
                      aria-invalid={!safeTarget(field.to)}
                      value={field.to || ""}
                      onChange={(e) => patchField(i, { to: e.target.value })}
                      placeholder="customer.name"
                    />
                  </Field>
                  <div className="mapping-source-assignment">
                    <ArrowRight size={14} />
                    <Button
                      onClick={() => assign(i, selection)}
                      disabled={!selection}
                      aria-label={`Use selected source for mapping ${i + 1}`}
                    >
                      Use selected source
                    </Button>
                  </div>
                  <Field label={`Value type ${i + 1}`}>
                    <select
                      value={
                        field.fmt != null
                          ? "template"
                          : field.from?.startsWith("=")
                            ? "constant"
                            : "path"
                      }
                      onChange={(e) =>
                        patchField(
                          i,
                          e.target.value === "template"
                            ? { fmt: "", from: undefined }
                            : {
                                fmt: undefined,
                                from: e.target.value === "constant" ? "=" : "",
                              },
                        )
                      }
                    >
                      <option value="path">Source path / fallback</option>
                      <option value="constant">Constant value</option>
                      <option value="template">Value template</option>
                    </select>
                  </Field>
                  <Field
                    label={`Source expression ${i + 1}`}
                    hint={
                      field.fmt != null
                        ? "Example: ${@bank}:${resourceId}"
                        : field.from?.startsWith("=")
                          ? "A fixed text value for every item."
                          : "Fallback: displayName|name. Missing values stay null."
                    }
                  >
                    <input
                      value={
                        field.fmt ??
                        (field.from?.startsWith("=")
                          ? field.from.slice(1)
                          : field.from) ??
                        ""
                      }
                      onChange={(e) =>
                        patchField(
                          i,
                          field.fmt != null
                            ? { fmt: e.target.value }
                            : {
                                from: field.from?.startsWith("=")
                                  ? `=${e.target.value}`
                                  : e.target.value,
                              },
                        )
                      }
                    />
                  </Field>
                  <Field label={`Transform ${i + 1}`}>
                    <select
                      value={field.fn || ""}
                      onChange={(e) => patchField(i, { fn: e.target.value })}
                    >
                      <option value="">Keep original</option>
                      {[
                        "decimal",
                        "number",
                        "isoDate",
                        "upper",
                        "lower",
                        "string",
                        "abs",
                      ].map((fn) => (
                        <option key={fn} value={fn}>
                          {fn}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={field.required !== false}
                      onChange={(e) =>
                        patchField(i, { required: e.target.checked })
                      }
                    />
                    Report when missing
                  </label>
                  {preview && (
                    <div
                      className="mapping-value"
                      aria-label={`Sample output ${i + 1}`}
                    >
                      <span>Sample</span>
                      <code>
                        {display(
                          field.to
                            .split(".")
                            .reduce(
                              (value, key) => value?.[key],
                              preview.output.value?.[0],
                            ),
                        )}
                      </code>
                      {preview.missing.some((m) => m.field === field.to) && (
                        <Badge tone="amber">Missing</Badge>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </fieldset>
          </section>
          <section
            className="mapping-preview"
            aria-label="Mapping output preview"
          >
            <h3>3. Output preview</h3>
            <p className="node-data-caption">
              Selected source only · captured sample · unsaved mapping
            </p>
            {loading ? (
              <div className="history-loading" role="status">
                <LoadingIndicator size={24} />
                Updating preview…
              </div>
            ) : error ? (
              <div className="node-data-notice error" role="alert">
                {error}
              </div>
            ) : preview ? (
              <>
                <Badge tone="neutral">{preview.count} sample items</Badge>
                {preview.output.truncated && (
                  <p className="node-data-caption">Output preview shortened.</p>
                )}
                <pre className="json-output" aria-label="Mapped JSON preview">
                  {JSON.stringify(preview.output.value, null, 2)}
                </pre>
                {preview.missing.length > 0 && (
                  <p className="node-data-caption">
                    {preview.missing.length} missing required values in the
                    sample. Values are shown as null.
                  </p>
                )}
              </>
            ) : (
              <Empty title="No preview yet">
                Captured source data is required to preview mappings.
              </Empty>
            )}
          </section>
        </div>
        {(invalid || duplicate) && (
          <div className="node-data-notice error" role="alert">
            {invalid
              ? "Output paths must contain nonempty field names and cannot use __proto__, prototype or constructor."
              : "Each output field must have a unique path without parent/child overlaps."}
          </div>
        )}
        <div className="modal-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            icon={Check}
            variant="primary"
            disabled={disabled || invalid || duplicate}
            onClick={() => onApply(draft)}
          >
            Apply mappings
          </Button>
        </div>
      </div>
    </Modal>
  );
}
