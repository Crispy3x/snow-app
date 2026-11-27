import "server-only";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Reads supabase/migrations/*.sql once and keeps, per table, its columns with
 * their defaults and its primary key, so the fake fills defaults like Postgres.
 */
export type Column = { name: string; def: () => unknown };
export type TableDef = { columns: Column[]; pk: string[]; identity: string | null };

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let cur = "";
  for (const ch of s) {
    if (ch === "'") quote = !quote;
    if (!quote && ch === "(") depth++;
    if (!quote && ch === ")") depth--;
    if (!quote && depth === 0 && ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseDefault(expr: string | undefined, type: string): () => unknown {
  if (!expr) return () => null;
  const e = expr.trim();
  if (/gen_random_uuid\(\)/i.test(e)) return () => crypto.randomUUID();
  if (/::date$/i.test(e) && /now\(\)/i.test(e)) return () => new Date().toISOString().slice(0, 10);
  if (/^now\(\)$/i.test(e)) return () => new Date().toISOString();
  if (/^(true|false)$/i.test(e)) return () => e.toLowerCase() === "true";
  if (/^-?\d+(\.\d+)?$/.test(e)) return () => Number(e);
  const str = e.match(/^'([\s\S]*)'(?:::(\w+))?$/);
  if (str) {
    const [, v, cast] = str;
    if (cast === "jsonb" || cast === "json") return () => JSON.parse(v);
    if (/\[\]$/.test(type)) return () => (v === "{}" ? [] : v.replace(/^\{|\}$/g, "").split(","));
    return () => v;
  }
  return () => null;
}

function parseColumn(def: string): { col?: Column; pk?: boolean; identity?: boolean } {
  const m = def.match(/^"?(\w+)"?\s+(\w+(?:\s*\([^)]*\))?(?:\[\])?)/);
  if (!m || /^(primary|unique|constraint|check|foreign|exclude)$/i.test(m[1])) return {};
  const [, name, type] = m;
  const d = def.match(/\bdefault\s+([\s\S]+?)(?=\s+(?:not\s+null|null|check|references|primary|unique|generated)\b|$)/i);
  return { col: { name, def: parseDefault(d?.[1], type) }, pk: /primary key/i.test(def), identity: /generated .* as identity/i.test(def) };
}

let cached: Map<string, TableDef> | null = null;

export function schema(): Map<string, TableDef> {
  if (cached) return cached;
  const tables = new Map<string, TableDef>();
  const dir = join(process.cwd(), "supabase", "migrations");
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n")
    .replace(/--[^\n]*/g, "");

  const add = (table: string, def: string) => {
    const t = tables.get(table);
    if (!t) return;
    const { col, pk, identity } = parseColumn(def);
    if (!col) {
      const pkm = def.match(/^primary key\s*\(([^)]+)\)/i);
      if (pkm) t.pk = pkm[1].split(",").map((s) => s.trim());
      return;
    }
    t.columns = t.columns.filter((c) => c.name !== col.name).concat(col);
    if (pk) t.pk = [col.name];
    if (identity) t.identity = col.name;
  };

  for (const m of sql.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
    tables.set(m[1], { columns: [], pk: ["id"], identity: null });
    for (const part of splitTop(m[2])) add(m[1], part);
  }
  for (const m of sql.matchAll(/alter table (?:if exists )?(?:only )?(?:public\.)?(\w+)\s+(add column[\s\S]*?);/gi)) {
    for (const part of splitTop(m[2])) add(m[1], part.replace(/^add column (?:if not exists )?/i, ""));
  }
  cached = tables;
  return tables;
}
