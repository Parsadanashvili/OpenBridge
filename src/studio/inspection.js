// Bounded, detached previews for the editor. Never used as execution inputs,
// never persisted with flows, and never captured for public endpoint requests.
const LIMITS = { items: 50, keys: 100, depth: 12, string: 2000, bytes: 64 * 1024 };
const SECRETS = new Set(['authorization', 'proxyauthorization', 'cookie', 'setcookie', 'token', 'accesstoken', 'refreshtoken', 'idtoken', 'apikey', 'clientsecret', 'password', 'privatekey', 'signingkey', 'clientkey', 'xjwssignature', 'tppsignaturecertificate']);
const secretKey = (key) => SECRETS.has(String(key).replace(/[-_\s]/g, '').toLowerCase());

function snapshot(value, budget = { remaining: 1024 * 1024 }) {
  let remaining = Math.min(LIMITS.bytes, budget.remaining);
  const starting = remaining, seen = new WeakSet();
  let truncated = false, redacted = false;
  const spend = (bytes) => { if (bytes > remaining) { truncated = true; return false; } remaining -= bytes; return true; };
  function copy(input, depth = 0, key = '') {
    if (secretKey(key)) { redacted = true; spend(14); return '[REDACTED]'; }
    if (depth > LIMITS.depth || remaining < 32) { truncated = true; return null; }
    if (input == null || typeof input === 'boolean' || typeof input === 'number') { spend(24); return input ?? null; }
    if (typeof input === 'string') {
      let text = input;
      if (/-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----/.test(text) || /^Bearer\s+\S+/i.test(text)) { redacted = true; text = '[REDACTED]'; }
      if (text.length > LIMITS.string) { text = text.slice(0, LIMITS.string) + '…'; truncated = true; }
      return spend(Buffer.byteLength(JSON.stringify(text))) ? text : null;
    }
    if (typeof input !== 'object') return null;
    if (seen.has(input)) { truncated = true; return '[Circular]'; }
    seen.add(input);
    let result;
    if (Array.isArray(input)) {
      result = [];
      if (input.length > LIMITS.items) truncated = true;
      for (const item of input.slice(0, LIMITS.items)) {
        if (remaining < 32) { truncated = true; break; }
        spend(2); result.push(copy(item, depth + 1));
      }
    } else {
      result = Object.create(null);
      const entries = Object.entries(input);
      if (entries.length > LIMITS.keys) truncated = true;
      for (const [name, item] of entries.slice(0, LIMITS.keys)) {
        if (!spend(Buffer.byteLength(JSON.stringify(name)) + 4)) break;
        result[name] = copy(item, depth + 1, name);
      }
    }
    seen.delete(input);
    return result;
  }
  if (remaining < 32) return { value: null, truncated: true, redacted: false, omitted: true };
  const result = copy(value);
  budget.remaining = Math.max(0, budget.remaining - (starting - remaining));
  return { value: result, truncated, redacted };
}

function payload(result, type, response) {
  if (type === 'respond' && response !== undefined) return { kind: 'response', value: response };
  if (type === 'trigger') return { kind: 'data', value: result?.data ?? null };
  if (Array.isArray(result?.items)) return { kind: 'items', value: result.items };
  return { kind: 'data', value: result?.data ?? null };
}

function itemCount(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') {
    const collection = Object.values(value).find(Array.isArray);
    if (collection) return collection.length;
    if (value.transactions) return itemCount(value.transactions);
    return Object.keys(value).length ? 1 : 0;
  }
  return value == null ? 0 : 1;
}

function outputPreview(result, type, response, budget) {
  const { kind, value } = payload(result, type, response);
  return { kind, count: itemCount(value), preview: snapshot(value, budget) };
}

module.exports = { snapshot, outputPreview, LIMITS };
