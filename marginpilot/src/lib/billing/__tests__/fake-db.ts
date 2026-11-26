/**
 * Tiny in-memory stand-in for the parts of the Supabase query builder the
 * billing code uses: insert, upsert, update, select + eq/is/in filters,
 * maybeSingle/single. Primary/unique keys are enforced per table so a
 * duplicate insert returns Postgres error 23505 like the real thing.
 */
type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;
type Result = { data: unknown; error: { code?: string; message: string } | null; count?: number | null };

const UNIQUE: Record<string, string[]> = {
  stripe_events: ["id"],
  subscriptions: ["id"],
  organizations: ["id", "stripe_customer_id"],
  course_purchases: ["stripe_checkout_session_id"],
};

export class FakeDb {
  tables: Record<string, Row[]> = {};
  failOn: { table: string; op: string } | null = null;

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [t, rows] of Object.entries(seed)) this.tables[t] = rows.map((r) => ({ ...r }));
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  from(table: string) {
    return new Query(this, table);
  }
}

class Query implements PromiseLike<Result> {
  private op: "select" | "insert" | "upsert" | "update" = "select";
  private payload: Row | Row[] = {};
  private filters: Filter[] = [];
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private single: "maybe" | "one" | null = null;

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select() {
    return this;
  }
  insert(v: Row | Row[]) {
    this.op = "insert";
    this.payload = v;
    return this;
  }
  upsert(v: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = "upsert";
    this.payload = v;
    this.upsertOpts = opts;
    return this;
  }
  update(v: Row) {
    this.op = "update";
    this.payload = v;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  is(col: string, val: null) {
    this.filters.push((r) => (r[col] ?? null) === val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  maybeSingle() {
    this.single = "maybe";
    return this;
  }

  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve()
      .then(() => this.run())
      .then(ok, bad);
  }

  private conflict(row: Row, ignore?: Row): string | null {
    for (const key of UNIQUE[this.table] ?? []) {
      if (row[key] == null) continue;
      if (this.db.rows(this.table).some((r) => r !== ignore && r[key] === row[key])) return key;
    }
    return null;
  }

  private run(): Result {
    if (this.db.failOn && this.db.failOn.table === this.table && this.db.failOn.op === this.op) {
      return { data: null, error: { message: `forced failure on ${this.table}.${this.op}` } };
    }
    const rows = this.db.rows(this.table);
    const match = () => rows.filter((r) => this.filters.every((f) => f(r)));

    if (this.op === "insert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      for (const row of list) {
        const key = this.conflict(row);
        if (key) return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint (${key})` } };
        rows.push({ ...row });
      }
      return { data: null, error: null };
    }
    if (this.op === "upsert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      const key = this.upsertOpts.onConflict ?? "id";
      for (const row of list) {
        const existing = rows.find((r) => r[key] === row[key]);
        if (existing) {
          if (!this.upsertOpts.ignoreDuplicates) Object.assign(existing, row);
        } else rows.push({ ...row });
      }
      return { data: null, error: null };
    }
    if (this.op === "update") {
      const hits = match();
      for (const r of hits) {
        const key = this.conflict({ ...r, ...(this.payload as Row) }, r);
        if (key) return { data: null, error: { code: "23505", message: `duplicate key (${key})` } };
        Object.assign(r, this.payload);
      }
      return { data: null, error: null };
    }
    const hits = match().map((r) => ({ ...r }));
    if (this.single === "maybe") return { data: hits[0] ?? null, error: null };
    return { data: hits, error: null, count: hits.length };
  }
}
