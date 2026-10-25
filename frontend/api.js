export async function api(path, options = {}) {
  const { signal, ...rest } = options;
  const response = await fetch(path, {
    ...rest,
    signal,
    headers: { "Content-Type": "application/json", ...rest.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(
      body?.error || `Request failed (${response.status})`,
    );
    error.status = response.status;
    error.details = body?.errors || [];
    throw error;
  }
  return body;
}

export const send = (method, body) => ({ method, body: JSON.stringify(body) });
export const clone = (value) => JSON.parse(JSON.stringify(value));
