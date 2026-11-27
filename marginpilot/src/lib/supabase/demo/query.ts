/**
 * A small in-memory stand-in for the PostgREST query builder, covering the
 * patterns this codebase uses: filters (incl. on embedded tables and JSON
 * paths), or(), order, range/limit, nested selects with aliases, !inner and
 * rel(count), count/head, single/maybeSingle and insert/upsert/update/delete
 * with returning. Not a general implementation.
 */
export type Row = Record<string, unknown>;

/** Resolve on a later task, like real network I/O, so Next.js treats reads as dynamic (not prerenderable). */
export const ioTick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

export type DemoDb = {
  rows(table: string): Row[];
  fill(table: string, row: Row): Row;
  pk(table: string): string[];
  patch(table: string, patch: Row): Row;
};

type Result = { data: unknown; error: { message: string; code?: string } | null; count: number | null; status: number; statusText: string };
type Filter = { path: string; test: (v: unknown) => boolean } | { row: (r: Row) => boolean };
type Field = { kind: "col"; alias: string; path: string } | { kind: "star" } | { kind: "embed"; alias: string; rel: string; inner: boolean; fields: Field[] };

const FK: Record<string, string> = {
  organizations: "org_id",
  ebay_stores: "store_id",
  course_lessons: "lesson_id",
  course_modules: "module_id",
  bulk_jobs: "job_id",
  audit_runs: "run_id",
  directory_suppliers: "directory_supplier_id",
};
const fkOf = (table: string) => FK[table] ?? `${table.replace(/s$/, "")}_id`;

function splitTop(s: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && ch === sep) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseSelect(s: string): Field[] {
  return splitTop(s.replace(/\s+/g, " ")).map((item): Field => {
    if (item === "*") return { kind: "star" };
    const embed = item.match(/^(?:(\w+):)?(\w+)(!inner)?(?:!\w+)?\((.*)\)$/);
    if (embed) return { kind: "embed", alias: embed[1] ?? embed[2], rel: embed[2], inner: !!embed[3], fields: parseSelect(embed[4]) };
    const col = item.match(/^(?:(\w+):)?([\w>-]+?)(?:::\w+)?$/);
    if (!col) throw new Error(`demo: unsupported select item "${item}"`);
    const path = col[2];
    return { kind: "col", alias: col[1] ?? path.split(/->>?/).pop()!, path };
  });
}

export function getPath(row: Row | null | undefined, path: string): unknown {
  if (!row) return null;
  const parts = path.split(/->>?/);
  let v: unknown = row[parts[0]];
  for (const p of parts.slice(1)) v = v && typeof v === "object" ? (v as Row)[p] : null;
  if (path.includes("->>") && v != null && typeof v === "object") return JSON.stringify(v);
  if (path.includes("->>") && v != null) return String(v);
  return v === undefined ? null : v;
}

function cmp(a: unknown, b: unknown): number {
  if (typeof a === "number" || typeof b === "number") {
    const x = Number(a);
    const y = Number(b);
    if (!Number.isNaN(x) && !Number.isNaN(y)) return x - y;
  }
  if (typeof a === "boolean" || typeof b === "boolean") return String(a) === String(b) ? 0 : String(a) < String(b) ? -1 : 1;
  const x = String(a);
  const y = String(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

const likeRe = (p: string, flags: string) => new RegExp(`^${String(p).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, flags);
const parseList = (v: unknown): unknown[] => (Array.isArray(v) ? v : String(v).replace(/^\(|\)$/g, "").split(",").map((s) => s.trim().replace(/^"|"$/g, "")));
const literal = (v: string): unknown => (v === "null" ? null : v === "true" ? true : v === "false" ? false : v);

function predicate(op: string, value: unknown): (v: unknown) => boolean {
  switch (op) {
    case "eq": return (v) => v != null && cmp(v, value) === 0;
    case "neq": return (v) => v != null && cmp(v, value) !== 0;
    case "gt": return (v) => v != null && cmp(v, value) > 0;
    case "gte": return (v) => v != null && cmp(v, value) >= 0;
    case "lt": return (v) => v != null && cmp(v, value) < 0;
    case "lte": return (v) => v != null && cmp(v, value) <= 0;
    case "like": return (v) => v != null && likeRe(String(value), "s").test(String(v));
    case "ilike": return (v) => v != null && likeRe(String(value), "is").test(String(v));
    case "is": return (v) => (value === null || value === "null" ? v == null : v === literal(String(value)));
    case "in": { const list = parseList(value); return (v) => v != null && list.some((x) => cmp(v, x) === 0); }
    case "contains": { const list = parseList(value); return (v) => Array.isArray(v) && list.every((x) => v.includes(x)); }
    default: throw new Error(`demo: unsupported filter operator "${op}"`);
  }
}

/** PostgREST or() syntax: "a.eq.1,b.ilike.%x%,and(c.is.null,d.gte.2)". */
function orPredicate(expr: string): (r: Row) => boolean {
  const parts = splitTop(expr).map((cond): ((r: Row) => boolean) => {
    const group = cond.match(/^(and|or)\((.*)\)$/);
    if (group) {
      const subs = splitTop(group[2]).map((c) => orPredicate(c));
      return group[1] === "and" ? (r) => subs.every((f) => f(r)) : (r) => subs.some((f) => f(r));
    }
    const m = cond.match(/^([\w>-]+)\.(not\.)?(\w+)\.(.*)$/);
    if (!m) throw new Error(`demo: unsupported or() condition "${cond}"`);
    const test = predicate(m[3], m[3] === "is" ? literal(m[4]) : m[4]);
    return m[2] ? (r) => !test(getPath(r, m[1])) : (r) => test(getPath(r, m[1]));
  });
  return (r) => parts.some((f) => f(r));
}

export class DemoQuery implements PromiseLike<Result> {
  private op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private fields: Field[] = [{ kind: "star" }];
  private returning = false;
  private countMode = false;
  private head = false;
  private filters: Filter[] = [];
  private orders: { path: string; asc: boolean; nullsFirst: boolean }[] = [];
  private from = 0;
  private to: number | null = null;
  private mode: "many" | "single" | "maybe" = "many";
  private payload: Row[] = [];
  private patch: Row = {};
  private conflict: string[] | null = null;
  private ignoreDuplicates = false;

  constructor(private db: DemoDb, private table: string) {}

  select(columns = "*", opts?: { count?: string; head?: boolean }) {
    this.fields = parseSelect(columns);
    if (this.op !== "select") this.returning = true;
    if (opts?.count) this.countMode = true;
    if (opts?.head) this.head = true;
    return this;
  }
  insert(values: Row | Row[]) {
    this.op = "insert";
    this.payload = Array.isArray(values) ? values : [values];
    return this;
  }
  upsert(values: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.op = "upsert";
    this.payload = Array.isArray(values) ? values : [values];
    this.conflict = opts?.onConflict ? opts.onConflict.split(",").map((s) => s.trim()) : null;
    this.ignoreDuplicates = !!opts?.ignoreDuplicates;
    return this;
  }
  update(values: Row, opts?: { count?: string }) {
    this.op = "update";
    this.patch = values;
    if (opts?.count) this.countMode = true;
    return this;
  }
  delete(opts?: { count?: string }) {
    this.op = "delete";
    if (opts?.count) this.countMode = true;
    return this;
  }

  private where(path: string, op: string, value: unknown) {
    this.filters.push({ path, test: predicate(op, value) });
    return this;
  }
  eq(c: string, v: unknown) { return this.where(c, "eq", v); }
  neq(c: string, v: unknown) { return this.where(c, "neq", v); }
  gt(c: string, v: unknown) { return this.where(c, "gt", v); }
  gte(c: string, v: unknown) { return this.where(c, "gte", v); }
  lt(c: string, v: unknown) { return this.where(c, "lt", v); }
  lte(c: string, v: unknown) { return this.where(c, "lte", v); }
  like(c: string, v: string) { return this.where(c, "like", v); }
  ilike(c: string, v: string) { return this.where(c, "ilike", v); }
  is(c: string, v: unknown) { return this.where(c, "is", v); }
  in(c: string, v: unknown[]) { return this.where(c, "in", v); }
  contains(c: string, v: unknown[]) { return this.where(c, "contains", v); }
  filter(c: string, op: string, v: unknown) { return this.where(c, op, v); }
  match(obj: Row) {
    for (const [k, v] of Object.entries(obj)) this.eq(k, v);
    return this;
  }
  not(c: string, op: string, v: unknown) {
    const test = predicate(op, v);
    this.filters.push({ path: c, test: (x) => (op === "is" ? !test(x) : x != null && !test(x)) });
    return this;
  }
  or(expr: string) {
    this.filters.push({ row: orPredicate(expr) });
    return this;
  }
  order(path: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    const asc = opts?.ascending ?? true;
    this.orders.push({ path, asc, nullsFirst: opts?.nullsFirst ?? !asc });
    return this;
  }
  limit(n: number) {
    this.to = this.from + n - 1;
    return this;
  }
  range(from: number, to: number) {
    this.from = from;
    this.to = to;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }
  abortSignal() {
    return this;
  }
  returns() {
    return this;
  }

  // --- execution -----------------------------------------------------------

  private embed(table: string, row: Row, f: Extract<Field, { kind: "embed" }>): unknown {
    const fk = fkOf(f.rel);
    if (Object.prototype.hasOwnProperty.call(row, fk) && f.rel !== table) {
      const target = this.db.rows(f.rel).find((r) => r.id === row[fk] && row[fk] != null);
      return target ? this.withEmbeds(f.rel, target, f.fields) : null;
    }
    const children = this.db.rows(f.rel).filter((r) => r[fkOf(table)] === row.id);
    if (f.fields.length === 1 && f.fields[0].kind === "col" && f.fields[0].path === "count") return [{ count: children.length }];
    return children.map((c) => this.withEmbeds(f.rel, c, f.fields));
  }

  /** Raw row plus resolved embeds under their aliases (used for filtering, then projected). */
  private withEmbeds(table: string, row: Row, fields: Field[]): Row {
    const out: Row = { ...row };
    for (const f of fields) if (f.kind === "embed") out[f.alias] = this.embed(table, row, f);
    return Object.defineProperty(out, "__fields", { value: fields, enumerable: false });
  }

  private project(row: Row, fields: Field[]): Row {
    const out: Row = {};
    for (const f of fields) {
      if (f.kind === "star") Object.assign(out, row);
      else if (f.kind === "col") out[f.alias] = getPath(row, f.path);
      else {
        const v = row[f.alias];
        const isCount = f.fields.length === 1 && f.fields[0].kind === "col" && f.fields[0].path === "count";
        out[f.alias] = Array.isArray(v) ? (isCount ? v : v.map((c) => this.project(c as Row, f.fields))) : v ? this.project(v as Row, f.fields) : null;
      }
    }
    return out;
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => {
      if ("row" in f) return f.row(row);
      const dot = f.path.indexOf(".");
      if (dot > 0 && !f.path.includes("->")) return true; // embedded filters are applied in applyEmbeddedFilters
      return f.test(getPath(row, f.path));
    });
  }

  private applyEmbeddedFilters(row: Row): Row | null {
    const embedded = this.filters.filter((f): f is Extract<Filter, { path: string }> => "path" in f && f.path.indexOf(".") > 0 && !f.path.includes("->"));
    for (const f of embedded) {
      const [alias, col] = [f.path.slice(0, f.path.indexOf(".")), f.path.slice(f.path.indexOf(".") + 1)];
      const v = row[alias];
      if (Array.isArray(v)) row[alias] = v.filter((c) => f.test(getPath(c as Row, col)));
      else if (v && !f.test(getPath(v as Row, col))) row[alias] = null;
    }
    for (const f of this.fields) {
      if (f.kind !== "embed" || !f.inner) continue;
      const v = row[f.alias];
      if (v == null || (Array.isArray(v) && v.length === 0)) return null;
    }
    return row;
  }

  private sort(rows: Row[]): Row[] {
    if (!this.orders.length) return rows;
    return [...rows].sort((a, b) => {
      for (const o of this.orders) {
        const x = getPath(a, o.path);
        const y = getPath(b, o.path);
        if (x == null && y == null) continue;
        if (x == null) return o.nullsFirst ? -1 : 1;
        if (y == null) return o.nullsFirst ? 1 : -1;
        const c = cmp(x, y);
        if (c) return o.asc ? c : -c;
      }
      return 0;
    });
  }

  private finish(rows: Row[], count: number | null): Result {
    const ok = (data: unknown): Result => ({ data, error: null, count, status: 200, statusText: "OK" });
    if (this.head) return ok(null);
    if (this.mode === "many") return ok(rows);
    if (rows.length === 1) return ok(rows[0]);
    if (rows.length === 0 && this.mode === "maybe") return ok(null);
    return { data: null, error: { code: "PGRST116", message: `JSON object requested, ${rows.length} rows returned` }, count, status: 406, statusText: "Not Acceptable" };
  }

  private execute(): Result {
    const all = this.db.rows(this.table);
    if (this.op === "select") {
      let rows = all
        .map((r) => this.withEmbeds(this.table, r, this.fields))
        .filter((r) => this.matches(r))
        .map((r) => this.applyEmbeddedFilters(r))
        .filter((r): r is Row => r !== null);
      rows = this.sort(rows);
      const count = this.countMode ? rows.length : null;
      rows = rows.slice(this.from, this.to === null ? undefined : this.to + 1);
      return this.finish(rows.map((r) => this.project(r, this.fields)), count);
    }

    let changed: Row[] = [];
    if (this.op === "insert") {
      changed = this.payload.map((p) => this.db.fill(this.table, p));
      all.push(...changed);
    } else if (this.op === "upsert") {
      const keys = this.conflict ?? this.db.pk(this.table);
      for (const p of this.payload) {
        const existing = all.find((r) => keys.every((k) => r[k] != null && cmp(r[k], p[k]) === 0));
        if (existing) {
          if (this.ignoreDuplicates) continue;
          Object.assign(existing, this.db.patch(this.table, p));
          changed.push(existing);
        } else {
          const row = this.db.fill(this.table, p);
          all.push(row);
          changed.push(row);
        }
      }
    } else if (this.op === "update") {
      changed = all.filter((r) => this.matches(r));
      for (const r of changed) Object.assign(r, this.db.patch(this.table, this.patch));
    } else {
      changed = all.filter((r) => this.matches(r));
      const gone = new Set(changed);
      const keep = all.filter((r) => !gone.has(r));
      all.length = 0;
      all.push(...keep);
    }
    const count = this.countMode ? changed.length : null;
    if (!this.returning) return { data: null, error: null, count, status: 201, statusText: "OK" };
    return this.finish(this.sort(changed).map((r) => this.project(this.withEmbeds(this.table, r, this.fields), this.fields)), count);
  }

  then<A = Result, B = never>(onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null, onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    let result: Result;
    try {
      result = this.execute();
    } catch (e) {
      console.error(`[demo] ${this.op} ${this.table} failed:`, e);
      result = { data: null, error: { message: e instanceof Error ? e.message : String(e) }, count: null, status: 500, statusText: "Error" };
    }
    return ioTick().then(() => structuredClone(result)).then(onfulfilled, onrejected);
  }
}
