// Test helpers: an offline stand-in for globalThis.fetch that records every request.
// (No tests in this file; node --test loads it harmlessly.)

/** JSON Response with the given status. */
export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Replace globalThis.fetch with `handler(call)`; every call is recorded as
 * { url, method, headers, body } (body JSON-parsed). The handler returns a Response or a plain
 * object (sent as 200 JSON). Call restore() when done.
 */
export function mockFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const call = {
      url: String(url),
      method: init.method || 'GET',
      headers: init.headers || {},
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    };
    calls.push(call);
    const res = await handler(call);
    return res instanceof Response ? res : json(res ?? {});
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** Route by "METHOD path" (path without the svc prefix and query string). */
export function router(svc, routes) {
  return (call) => {
    const u = new URL(call.url);
    const base = new URL(svc);
    const path = u.pathname.slice(base.pathname.replace(/\/$/, '').length);
    const key = `${call.method} ${path}`;
    if (!(key in routes)) throw new Error('unexpected request: ' + key);
    const r = routes[key];
    return typeof r === 'function' ? r(call, u) : r;
  };
}
