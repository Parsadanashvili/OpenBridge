// Grounded explanation layer. Input = a finding already decided by deterministic tests.
// The model may EXPLAIN and recommend; it never changes status/severity. If no API key / any failure,
// we fall back to the deterministic template, so the product works with AI unavailable.
const MODEL = process.env.OPENBRIDGE_MODEL || 'claude-sonnet-5-5';

function templateExplain(f) {
  return {
    source: 'template',
    whatWentWrong: `${f.title} at ${f.jsonPath || f.operation}: expected ${f.expected}, observed ${f.actual}.`,
    rule: `${f.ruleId} - ${f.specRef}${f.specRefVerified ? '' : ' (reference page not yet verified)'}`,
    whyItMatters: f.impact,
    recommendedFix: f.recommendedFix,
    evidenceRefs: [`${f.id}: ${f.evidence?.request?.method} ${f.evidence?.request?.path} -> HTTP ${f.evidence?.response?.status} @ ${f.evidence?.at}`],
  };
}

async function aiExplain(f) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return templateExplain(f);
  const grounded = { id: f.id, bank: f.bankName, simulated: f.simulated, ruleId: f.ruleId, specRef: f.specRef, operation: f.operation, jsonPath: f.jsonPath, expected: f.expected, actual: f.actual, evidence: f.evidence };
  const prompt = `You explain API conformance findings for bank engineers. Use ONLY the JSON below. Do not invent values, endpoints or rules, and do not change the verdict.\nReturn strict JSON with keys: whatWentWrong, rule, whyItMatters, recommendedFix (concrete, ideally a corrected JSON snippet), evidenceRefs (array of strings quoting the evidence).\n\n${JSON.stringify(grounded)}`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 700, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = (await res.json()).content?.[0]?.text || '';
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    return { source: 'ai', model: MODEL, ...parsed };
  } catch (e) {
    return { ...templateExplain(f), aiError: String(e.message) };
  }
}

const cache = new Map();
async function explainFinding(f) {
  if (!cache.has(f.id + f.evidence?.at)) cache.set(f.id + f.evidence?.at, await aiExplain(f));
  return cache.get(f.id + f.evidence?.at);
}

module.exports = { explainFinding, templateExplain };
