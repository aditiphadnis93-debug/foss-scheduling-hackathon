// The engine's HTTP API for the judge console (web/API.md). No dependencies: Bun.serve, JSON in and out,
// CORS open, every response cached by its route and request body (the engine is deterministic: rule 2).
//   bun run src/serve.ts                  http://0.0.0.0:8791
//   PORT=8791 HOST=0.0.0.0 BENCHTIME_WORKERS=4 bun run src/serve.ts
// The judge console (bun run web-concepts/causelist/serve.ts) proxies /api/* here.

import { caseHandler } from "./api/case";
import { canonical, getEnv, HttpError, RECOMMENDED } from "./api/context";
import { evidenceHandler } from "./api/evidence";
import { healthHandler } from "./api/health";
import { metaHandler } from "./api/meta";
import { planHandler } from "./api/plan";
import { poolSize } from "./api/pool";
import { rulesPresetsHandler, rulesPreviewHandler } from "./api/rules";
import { compareHandler, simulateHandler } from "./api/simulate";

const PORT = Number(process.env.PORT ?? 8791);
const HOST = process.env.HOST ?? "0.0.0.0";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

// JSON has no NaN: a measure with nothing to measure goes out as null
const toJson = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v));

function respond(status: number, body: string, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-benchtime-source": "engine", ...CORS, ...extra } });
}

// Responses by route and body, oldest evicted past a byte budget; evidence is read from disk each time (the
// experiments may still be writing)
const cache = new Map<string, Promise<{ status: number; body: string }>>();
const sizes = new Map<string, number>();
const MAX_BYTES = 200 * 1024 * 1024;
let bytes = 0;

async function compute(fn: () => unknown | Promise<unknown>): Promise<{ status: number; body: string }> {
  try {
    return { status: 200, body: toJson(await fn()) };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: toJson({ error: e.message, ...(e.detail ? { detail: e.detail } : {}) }) };
    console.error(e);
    return { status: 500, body: toJson({ error: "the engine failed", detail: e instanceof Error ? e.message : String(e) }) };
  }
}

function cached(key: string, fn: () => unknown | Promise<unknown>): Promise<{ status: number; body: string }> {
  const hit = cache.get(key);
  if (hit) return hit;
  const p = compute(fn);
  cache.set(key, p);
  // errors are not kept: the next request tries again
  p.then((r) => {
    if (r.status >= 500) return void cache.delete(key);
    sizes.set(key, r.body.length);
    bytes += r.body.length;
    while (bytes > MAX_BYTES && cache.size > 1) {
      const old = cache.keys().next().value!;
      cache.delete(old);
      bytes -= sizes.get(old) ?? 0;
      sizes.delete(old);
    }
  });
  return p;
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};
  let b: unknown;
  try {
    b = JSON.parse(text);
  } catch {
    throw new HttpError(400, "the body is not JSON");
  }
  if (!b || typeof b !== "object" || Array.isArray(b)) throw new HttpError(400, "the body must be a JSON object");
  return b as Record<string, unknown>;
}

export async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method.toUpperCase();
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const t0 = performance.now();
  let r: { status: number; body: string };
  try {
    if (method === "GET" && path === "/api/meta") r = await cached("meta", metaHandler);
    else if (method === "GET" && path === "/api/evidence") r = await compute(evidenceHandler);
    else if (method === "GET" && path === "/api/health") {
      const date = url.searchParams.get("date");
      const policy = url.searchParams.get("policy");
      r = await cached(`health|${date}|${policy}`, () => healthHandler(date, policy));
    } else if (method === "GET" && path.startsWith("/api/case/")) {
      let id: string;
      try {
        id = decodeURIComponent(path.slice("/api/case/".length));
      } catch {
        throw new HttpError(400, "bad case id");
      }
      const date = url.searchParams.get("date");
      const policy = url.searchParams.get("policy");
      r = await cached(`case|${id}|${date}|${policy}`, () => caseHandler(id, date, policy));
    } else if (method === "POST" && (path === "/api/plan" || path === "/api/simulate" || path === "/api/compare")) {
      const body = await readBody(req);
      if (url.searchParams.get("quick") === "1") body.quick = true;
      const handler = path === "/api/plan" ? planHandler : path === "/api/simulate" ? simulateHandler : compareHandler;
      r = await cached(`${path}|${canonical(body)}`, () => handler(body));
    } else if (method === "GET" && path === "/api/rules/presets") r = await cached("rules-presets", rulesPresetsHandler);
    else if (method === "POST" && path === "/api/rules/preview") {
      const body = await readBody(req);
      r = await cached(`${path}|${canonical(body)}`, () => rulesPreviewHandler(body));
    } else if (method === "GET" && (path === "/" || path === "/api" || path === "/api/health-check")) {
      r = { status: 200, body: toJson({ ok: true, service: "benchtime engine", routes: ["GET /api/meta", "POST /api/plan", "POST /api/simulate", "POST /api/compare", "GET /api/health?date=&policy=", "GET /api/evidence", "GET /api/case/:id?date=", "GET /api/rules/presets", "POST /api/rules/preview"] }) };
    } else if (path.startsWith("/api/")) {
      r = { status: 404, body: toJson({ error: "not found", detail: `${method} ${path}` }) };
    } else r = { status: 404, body: toJson({ error: "not found", detail: path }) };
  } catch (e) {
    r = e instanceof HttpError ? { status: e.status, body: toJson({ error: e.message, ...(e.detail ? { detail: e.detail } : {}) }) } : { status: 500, body: toJson({ error: "the engine failed", detail: String(e) }) };
  }
  return respond(r.status, r.body, { "x-elapsed-ms": String(Math.round(performance.now() - t0)) });
}

/** Warm the caches the console hits first: meta, the first day's list and health, the default simulation. */
async function warm(): Promise<void> {
  const t0 = performance.now();
  const day = getEnv().days[0]!;
  const post = (path: string, body: unknown) => route(new Request(`http://local${path}`, { method: "POST", body: JSON.stringify(body) }));
  await route(new Request("http://local/api/meta"));
  await post("/api/plan", { date: day, policy: RECOMMENDED });
  await Promise.all([route(new Request(`http://local/api/health?date=${day}&policy=${RECOMMENDED}`)), post("/api/simulate", { policy: RECOMMENDED })]);
  console.log(`warm in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}

if (import.meta.main) {
  getEnv();
  Bun.serve({ port: PORT, hostname: HOST, idleTimeout: 255, fetch: route });
  console.log(`benchtime engine on http://${HOST}:${PORT} (${poolSize()} simulation workers)`);
  if (process.env.WARM !== "0") warm().catch((e) => console.error("warm-up failed:", e));
}
