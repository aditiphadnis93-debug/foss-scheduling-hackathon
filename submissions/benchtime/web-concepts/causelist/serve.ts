// causelist concept: static files from this folder and a proxy for the engine API.
//   bun run web-concepts/causelist/serve.ts      http://0.0.0.0:8796, /api/* proxied to http://127.0.0.1:8791
import { extname, join, normalize } from "node:path";

const ROOT = new URL(".", import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 8796);
const ENGINE = (process.env.ENGINE ?? "http://127.0.0.1:8791").replace(/\/+$/, "");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      const method = req.method.toUpperCase();
      const body = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();
      try {
        const r = await fetch(ENGINE + url.pathname + url.search, { method, headers: { "content-type": "application/json" }, body });
        return new Response(r.body, {
          status: r.status,
          headers: { "content-type": r.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
        });
      } catch {
        return Response.json(
          { error: "The list engine is not running.", detail: "Start it on port 8791, then reload this page." },
          { status: 502 },
        );
      }
    }
    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    if (path === "/rules") path = "/rules.html";
    const file = normalize(join(ROOT, decodeURIComponent(path)));
    if (!file.startsWith(ROOT) || !TYPES[extname(file)]) return new Response("Not found", { status: 404 });
    const f = Bun.file(file);
    if (!(await f.exists())) return new Response("Not found", { status: 404 });
    return new Response(f, { headers: { "content-type": TYPES[extname(file)], "cache-control": "no-store" } });
  },
});
console.log(`causelist on http://0.0.0.0:${PORT}, engine ${ENGINE}`);
