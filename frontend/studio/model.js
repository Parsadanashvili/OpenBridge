import {
  ArrowDownWideNarrow,
  ArrowRightLeft,
  Braces,
  Filter,
  GitMerge,
  Landmark,
  Layers,
  ListEnd,
  Radio,
  Webhook,
} from "lucide-react";

export const TYPES = {
  trigger: {
    title: "Endpoint trigger",
    group: "Input & output",
    icon: Webhook,
    color: "coral",
    description: "Define the inputs that start your workflow.",
    config: { inputs: [] },
  },
  bank: {
    title: "Bank request",
    group: "Banking",
    icon: Landmark,
    color: "blue",
    description: "Read accounts, balances or transactions.",
    config: { bank: "alpha", op: "accounts", withBalance: true },
  },
  map: {
    title: "Map fields",
    group: "Transform",
    icon: ArrowRightLeft,
    color: "purple",
    description: "Shape bank data into a consistent response.",
    config: { path: "accounts", fields: [{ to: "iban", from: "iban" }] },
  },
  merge: {
    title: "Merge",
    group: "Transform",
    icon: GitMerge,
    color: "purple",
    description: "Combine items from multiple branches.",
    config: {},
  },
  filter: {
    title: "Filter",
    group: "Transform",
    icon: Filter,
    color: "amber",
    description: "Keep only the items you need.",
    config: { field: "currency", op: "ne", value: "XXX" },
  },
  sort: {
    title: "Sort",
    group: "Transform",
    icon: ArrowDownWideNarrow,
    color: "amber",
    description: "Order items by a field.",
    config: { field: "date", dir: "desc" },
  },
  limit: {
    title: "Limit",
    group: "Transform",
    icon: ListEnd,
    color: "amber",
    description: "Return a specific number of items.",
    config: { n: 20 },
  },
  aggregate: {
    title: "Aggregate",
    group: "Transform",
    icon: Layers,
    color: "purple",
    description: "Group items and calculate totals.",
    config: { groupBy: "currency", sum: "amount", as: "total" },
  },
  respond: {
    title: "Respond",
    group: "Input & output",
    icon: Radio,
    color: "green",
    description: "Return the result from your endpoint.",
    config: { wrap: "items" },
  },
};

export const typeInfo = (type) =>
  TYPES[type] || {
    title: type,
    icon: Braces,
    color: "neutral",
    description: "Custom node",
    config: {},
  };

export function nodeSummary(type, config = {}) {
  switch (type) {
    case "bank":
      return `${config.bank || "Select bank"} · ${config.op || "accounts"}`;
    case "trigger":
      return `${inputSpec({ nodes: [{ type: "trigger", config }] }).length} endpoint inputs`;
    case "map":
      return `${config.fields?.length || 0} fields · ${config.path || "items"}`;
    case "filter":
      return `${config.field || "field"} ${config.op || "eq"} ${config.value ?? "input"}`;
    case "sort":
      return `${config.field || "field"} · ${config.dir === "desc" ? "Descending" : "Ascending"}`;
    case "limit":
      return `First ${config.n ?? 10} items`;
    case "aggregate":
      return `Sum ${config.sum || "amount"} by ${config.groupBy || "group"}`;
    case "respond":
      return `{ ${config.wrap || "items"}: ${config.single ? "object" : "[…]"} }`;
    default:
      return "Combine incoming items";
  }
}

export function inputSpec(flow) {
  const config = flow?.nodes?.find((n) => n.type === "trigger")?.config || {};
  return (
    config.inputs ||
    Object.entries(config.params || {}).map(([name, value]) => ({
      name,
      type: "string",
      default: value,
    }))
  );
}

export const toNodes = (flow) =>
  flow.nodes.map((n) => ({
    id: n.id,
    type: "workflow",
    position: { x: n.x || 0, y: n.y || 0 },
    data: { kind: n.type, config: n.config || {} },
  }));
export const toEdges = (flow) =>
  flow.edges.map((e, i) => ({
    id: `edge-${e.from}-${e.to}-${i}`,
    source: e.from,
    target: e.to,
    type: "smoothstep",
  }));
export function serialize(flow, nodes, edges) {
  return {
    ...flow,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.kind,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      config: n.data.config,
    })),
    edges: edges.map((e) => ({ from: e.source, to: e.target })),
  };
}

// Stable left-to-right layout. Older stored flows keep their coordinates until
// the user chooses Arrange; new templates use this layout from the start.
export function arrange(nodes, edges) {
  const levels = new Map(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const edge of edges) {
      if (!levels.has(edge.source) || !levels.has(edge.target)) continue;
      const depth = Math.min(nodes.length - 1, levels.get(edge.source) + 1);
      if (depth > levels.get(edge.target)) {
        levels.set(edge.target, depth);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const groups = new Map();
  nodes.forEach((node) => {
    const level = levels.get(node.id);
    groups.set(level, [...(groups.get(level) || []), node.id]);
  });
  return nodes.map((node) => {
    const level = levels.get(node.id),
      peers = groups.get(level);
    return {
      ...node,
      position: {
        x: level * 245,
        y: (peers.indexOf(node.id) - (peers.length - 1) / 2) * 205,
      },
    };
  });
}

export function validateGraph(flow) {
  const errors = [];
  const nodes = flow.nodes || [];
  if (nodes.filter((n) => n.type === "trigger").length !== 1)
    errors.push("Add exactly one endpoint trigger.");
  if (nodes.filter((n) => n.type === "respond").length !== 1)
    errors.push("Add exactly one response node.");
  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) errors.push("Every node needs a unique ID.");
  const visited = new Set(),
    active = new Set();
  function visit(id) {
    if (active.has(id)) return false;
    if (visited.has(id)) return true;
    active.add(id);
    for (const edge of flow.edges.filter((e) => e.from === id))
      if (!ids.has(edge.to) || !visit(edge.to)) return false;
    active.delete(id);
    visited.add(id);
    return true;
  }
  if (!nodes.every((n) => visit(n.id)))
    errors.push(
      "Connections must form a graph without cycles or missing nodes.",
    );
  const trigger = nodes.find((n) => n.type === "trigger");
  if (trigger) {
    const connected = new Set();
    function walk(id) {
      if (connected.has(id)) return;
      connected.add(id);
      flow.edges.filter((e) => e.from === id).forEach((e) => walk(e.to));
    }
    walk(trigger.id);
    if (nodes.some((n) => !connected.has(n.id)))
      errors.push("Connect every node to the endpoint trigger.");
  }
  for (const node of nodes) {
    if (!TYPES[node.type]) errors.push(`Unknown node type: ${node.type}.`);
    if (node.type !== "respond" && !flow.edges.some((e) => e.from === node.id))
      errors.push(`Connect ${node.id} to the response path.`);
  }
  return [...new Set(errors)];
}
