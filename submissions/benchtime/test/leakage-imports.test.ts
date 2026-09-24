// Rule 1: nothing reachable from src/planner through the import graph may live under src/world (or src/eval,
// which imports the world). Follows static imports, re-exports, dynamic import() and require().
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const SRC = join(import.meta.dir, "..", "src");
const SPEC = /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gm;

function resolveSpec(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null; // node: builtins and packages
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, join(base, "index.ts")]) if (existsSync(c) && !c.endsWith("/")) try { if (readFileSync(c)) return c; } catch {}
  return null;
}

export function reachable(entry: string): Map<string, string> {
  const seen = new Map<string, string>([[entry, "(entry)"]]);
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    for (const m of readFileSync(f, "utf8").matchAll(SPEC)) {
      const r = resolveSpec(f, m[1] ?? m[2] ?? m[3] ?? m[4]!);
      if (r && !seen.has(r)) {
        seen.set(r, f);
        stack.push(r);
      }
    }
  }
  return seen;
}

describe("planner import closure", () => {
  const dir = join(SRC, "planner");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
    test(f, () => {
      const bad = [...reachable(join(dir, f)).entries()].filter(([p]) => p.includes("/src/world/") || p.includes("/src/eval/")).map(([p, via]) => `${p.slice(SRC.length)} via ${via.slice(SRC.length)}`);
      expect(bad).toEqual([]);
    });
  }
});
