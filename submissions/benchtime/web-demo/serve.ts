// Static server for the pitch demo. No dependencies.
// bun run web-demo/serve.ts   (PORT=8800, HOST=0.0.0.0, API=http://127.0.0.1:8791)
import { join, normalize } from "node:path";

const ROOT = import.meta.dir;
const PORT = Number(process.env.PORT ?? 8800);
const HOST = process.env.HOST ?? "0.0.0.0";
const API = (process.env.API ?? "http://127.0.0.1:8791").replace(/\/$/, "");

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  md: "text/plain; charset=utf-8",
  woff2: "font/woff2",
  png: "image/png",
  svg: "image/svg+xml",
};

Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        const init: RequestInit = { method: req.method, headers: req.headers };
        if (req.method !== "GET" && req.method !== "HEAD") init.body = await req.arrayBuffer();
        return await fetch(API + url.pathname + url.search, init);
      } catch {
        return new Response(JSON.stringify({ error: "engine not running" }), {
          status: 502,
          headers: { "content-type": "application/json" },
        });
      }
    }
    let path = decodeURIComponent(url.pathname);
    if (path === "/" || path === "") path = "/index.html";
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) return new Response("no", { status: 403 });
    const f = Bun.file(file);
    if (!(await f.exists())) return new Response("not found", { status: 404 });
    const ext = file.split(".").pop() ?? "";
    return new Response(f, {
      headers: { "content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": "no-store" },
    });
  },
});

console.log(`benchtime pitch demo on http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}/  (api proxy to ${API})`);
