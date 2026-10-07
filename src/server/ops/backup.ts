import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { Actor } from "@/server/auth";
import { getWeek } from "@/server/queries/week";
import { weekKeyFor } from "@/domain/time";

/**
 * Logical backup and restore rehearsal (spec section 15: "A backup existing
 * is not a successful restoration"). A backup is every row of every public
 * table as JSON. A rehearsal restores it into an isolated empty database
 * with the same migrations and checks row counts, references, tenant
 * ownership, membership state, money totals and privacy behaviour.
 */

export const BACKUP_FORMAT = "more-backup/1";

export interface Backup {
  format: typeof BACKUP_FORMAT;
  takenAt: string;
  /** Migrations applied at the source, oldest first, when the source records them. */
  migrations: string[] | null;
  tables: Record<string, Record<string, unknown>[]>;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

type Row = Record<string, unknown>;

/** drizzle's execute returns `{ rows }` on PGlite and an array on postgres-js. */
async function query<T = Row>(db: Db, q: SQL): Promise<T[]> {
  const r = (await db.execute(q)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(r) ? r : (r.rows ?? []);
}

async function tableNames(db: Db): Promise<string[]> {
  const rows = await query<{ name: string }>(
    db,
    sql`select table_name as name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
  );
  return rows.map((r) => r.name);
}

/** Columns that can be written: generated columns are recomputed on restore. */
async function writableColumns(db: Db, table: string): Promise<string[]> {
  const rows = await query<{ name: string }>(
    db,
    sql`select column_name as name from information_schema.columns
        where table_schema = 'public' and table_name = ${table} and is_generated = 'NEVER'
        order by ordinal_position`,
  );
  return rows.map((r) => r.name);
}

async function appliedMigrations(db: Db): Promise<string[] | null> {
  try {
    const rows = await query<{ hash: string }>(db, sql`select hash from drizzle.__drizzle_migrations order by created_at, id`);
    return rows.map((r) => r.hash);
  } catch {
    return null;
  }
}

const ident = (name: string) => sql.raw(`"${name.replaceAll('"', '""')}"`);

/**
 * Every table is read inside one repeatable-read, read-only transaction, so
 * the backup is a single moment: a row written mid-backup is either wholly
 * in it (with everything it points at) or wholly not.
 */
export async function takeBackup(db: Db, now = new Date()): Promise<Backup> {
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    await tx.execute(sql`set transaction isolation level repeatable read, read only`);
    const tables: Backup["tables"] = {};
    for (const table of await tableNames(tx)) {
      const cols = await writableColumns(tx, table);
      const list = sql.join(cols.map(ident), sql`, `);
      const rows = await query<{ data: Row }>(tx, sql`select to_jsonb(r) as data from (select ${list} from ${ident(table)}) r`);
      tables[table] = rows.map((r) => (typeof r.data === "string" ? JSON.parse(r.data) : r.data));
    }
    return { format: BACKUP_FORMAT, takenAt: now.toISOString(), migrations: await appliedMigrations(tx), tables };
  });
}

/**
 * Load a backup into an empty database that already has the schema. Foreign
 * key triggers are paused during the load (tables arrive in any order) and
 * checked explicitly afterwards; unique and exclusion constraints still apply.
 */
export async function restoreBackup(db: Db, backup: Backup, opts: { relink?: boolean } = {}): Promise<void> {
  if (backup.format !== BACKUP_FORMAT) throw new Error(`Unknown backup format ${String(backup.format)}`);
  const known = new Set(await tableNames(db));
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    for (const [table, rows] of Object.entries(backup.tables)) {
      if (!known.has(table)) throw new Error(`Backup has table ${table}, which this schema doesn't`);
      if (rows.length === 0) continue;
      const target = new Set(await writableColumns(tx as unknown as Db, table));
      const cols = Object.keys(rows[0]).filter((c) => target.has(c));
      const list = sql.join(cols.map(ident), sql`, `);
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = JSON.stringify(rows.slice(i, i + 500));
        await tx.execute(
          sql`insert into ${ident(table)} (${list}) select ${list} from jsonb_populate_recordset(null::${ident(table)}, ${chunk}::jsonb)`,
        );
      }
    }
    // A new sign-in service gives everyone new ids. Mark each open account
    // so its owner's first sign-in with the same verified email adopts it.
    if (opts.relink) {
      await tx.execute(sql`update accounts set identity_subject = 'relink:' || identity_subject where closed_at is null and identity_subject not like 'relink:%'`);
    }
  });
}

/** How many open accounts can be reclaimed by email after a relink restore. */
export async function relinkReadiness(db: Db): Promise<Check> {
  const [r] = await query<{ ready: string | number; stranded: string | number }>(
    db,
    sql`select count(*) filter (where email is not null) as ready, count(*) filter (where email is null) as stranded
        from accounts where closed_at is null and identity_subject like 'relink:%'`,
  );
  const ready = n(r?.ready);
  const stranded = n(r?.stranded);
  return {
    name: "Sign-in recovery",
    ok: stranded === 0,
    detail: stranded ? `${stranded} accounts have no email to sign back in with` : `${ready} accounts sign back in with their email`,
  };
}

const n = (v: unknown) => Number(v ?? 0);

/** Per-household estimate, committed and net-paid totals in minor units. */
function moneyFromBackup(b: Backup): Map<string, [number, number, number]> {
  const out = new Map<string, [number, number, number]>();
  const owner = new Map<string, string>();
  for (const e of b.tables.expenses ?? []) {
    const h = String(e.household_id);
    owner.set(String(e.id), h);
    const t = out.get(h) ?? [0, 0, 0];
    t[0] += n(e.estimate_minor);
    t[1] += n(e.committed_minor);
    out.set(h, t);
  }
  for (const p of b.tables.payment_transactions ?? []) {
    const h = owner.get(String(p.expense_id));
    if (!h) continue;
    const t = out.get(h) ?? [0, 0, 0];
    t[2] += p.kind === "refund" ? -n(p.amount_minor) : n(p.amount_minor);
    out.set(h, t);
  }
  return out;
}

async function moneyFromDb(db: Db): Promise<Map<string, [number, number, number]>> {
  const rows = await query<{ h: string; est: string; com: string; net: string }>(
    db,
    sql`select e.household_id as h,
               coalesce(sum(e.estimate_minor), 0)::text as est,
               coalesce(sum(e.committed_minor), 0)::text as com,
               coalesce((select sum(case when p.kind = 'refund' then -p.amount_minor else p.amount_minor end)
                         from payment_transactions p join expenses x on x.id = p.expense_id
                         where x.household_id = e.household_id), 0)::text as net
        from expenses e group by e.household_id`,
  );
  return new Map(rows.map((r) => [r.h, [n(r.est), n(r.com), n(r.net)]]));
}

async function count(db: Db, q: SQL): Promise<number> {
  const [r] = await query<{ c: string | number }>(db, q);
  return n(r?.c);
}

/** Validate a restored database against the backup it came from. */
export async function verifyRestore(db: Db, backup: Backup): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  // 1. Schema version.
  const migrations = await appliedMigrations(db);
  if (backup.migrations === null) {
    add("Schema version", true, "Source does not record migrations; restored with the current schema.");
  } else {
    const same = JSON.stringify(migrations) === JSON.stringify(backup.migrations);
    add("Schema version", same, same ? `${migrations?.length} migrations, same as source` : `source ${backup.migrations.length}, restored ${migrations?.length}`);
  }

  // 2. Row counts.
  const mismatched: string[] = [];
  let total = 0;
  for (const [table, rows] of Object.entries(backup.tables)) {
    const c = await count(db, sql`select count(*) as c from ${ident(table)}`);
    total += c;
    if (c !== rows.length) mismatched.push(`${table} ${rows.length}→${c}`);
  }
  add("Row counts", mismatched.length === 0, mismatched.length ? mismatched.join(", ") : `${total} rows in ${Object.keys(backup.tables).length} tables match`);

  // 3. Every reference resolves (foreign keys were paused during the load).
  const fks = await query<{ child: string; col: string; parent: string; pcol: string }>(
    db,
    sql`select c.conrelid::regclass::text as child, a.attname as col, c.confrelid::regclass::text as parent, pa.attname as pcol
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
        join pg_namespace ns on ns.oid = c.connamespace
        where c.contype = 'f' and ns.nspname = 'public' and array_length(c.conkey, 1) = 1`,
  );
  const orphans: string[] = [];
  for (const fk of fks) {
    const c = await count(
      db,
      sql`select count(*) as c from ${sql.raw(fk.child)} x where x.${ident(fk.col)} is not null
          and not exists (select 1 from ${sql.raw(fk.parent)} p where p.${ident(fk.pcol)} = x.${ident(fk.col)})`,
    );
    if (c) orphans.push(`${fk.child}.${fk.col}: ${c}`);
  }
  add("References", orphans.length === 0, orphans.length ? orphans.join(", ") : `${fks.length} foreign keys, no orphans`);

  // 4. Tenant ownership: people acting in a household are or were its members.
  const outsiders = await count(
    db,
    sql`select
          (select count(*) from reservations r where not exists (select 1 from memberships m where m.household_id = r.household_id and m.account_id = r.account_id))
        + (select count(*) from events e where not exists (select 1 from memberships m where m.household_id = e.household_id and m.account_id = e.owner_id))
        + (select count(*) from moments o where not exists (select 1 from memberships m where m.household_id = o.household_id and m.account_id = o.organiser_id))
        + (select count(*) from acceptances a join moments o on o.id = a.moment_id where not exists (select 1 from memberships m where m.household_id = o.household_id and m.account_id = a.actor_id))
        + (select count(*) from preparation_tasks t where not exists (select 1 from memberships m where m.household_id = t.household_id and m.account_id = t.owner_id))
        as c`,
  );
  add("Tenant ownership", outsiders === 0, outsiders ? `${outsiders} records reference someone outside their household` : "Every record's people belong to its household");

  // 5. Membership state: at most two current adults, one current household per adult.
  const crowded = await count(db, sql`select count(*) as c from (select household_id from memberships where ends_at is null group by household_id having count(*) > 2) x`);
  const doubled = await count(db, sql`select count(*) as c from (select account_id from memberships where ends_at is null group by account_id having count(*) > 1) x`);
  add("Membership state", crowded + doubled === 0, crowded + doubled ? `${crowded} households over two adults, ${doubled} adults in two households` : "Two-adult households, one household per adult");

  // 6. Money totals match the source exactly.
  const want = moneyFromBackup(backup);
  const got = await moneyFromDb(db);
  const diffs = [...new Set([...want.keys(), ...got.keys()])].filter((h) => JSON.stringify(want.get(h)) !== JSON.stringify(got.get(h)));
  const net = [...got.values()].reduce((s, t) => s + t[2], 0);
  add("Money totals", diffs.length === 0, diffs.length ? `${diffs.length} households differ` : `${got.size} households; net paid ${net} minor units matches`);

  // 7. No adult double-booked.
  const overlaps = await count(db, sql`select count(*) as c from reservations a join reservations b on a.account_id = b.account_id and a.id < b.id and a.during && b.during`);
  add("No double booking", overlaps === 0, overlaps ? `${overlaps} overlapping reservations` : "No overlapping reservations");

  // 8. Private records stay account-owned.
  const leakedCols = await count(
    db,
    sql`select count(*) as c from information_schema.columns where table_schema = 'public' and column_name = 'household_id'
        and table_name in ('journal_entries', 'checkins', 'feedback', 'preferences', 'suppressions', 'trial_responses')`,
  );
  add("Private ownership", leakedCols === 0, leakedCols ? "A private table carries a household id" : "Journal, check-ins, feedback and preferences belong to accounts only");

  // 9. Privacy behaviour: a partner's week never shows another adult's private titles.
  checks.push(await verifyPartnerPrivacy(db));
  return checks;
}

async function verifyPartnerPrivacy(db: Db): Promise<Check> {
  const name = "Partner privacy";
  const members = await query<{ household_id: string; account_id: string; display_name: string }>(
    db,
    sql`select m.household_id, m.account_id, a.display_name from memberships m join accounts a on a.id = m.account_id
        join households h on h.id = m.household_id where m.ends_at is null and h.deleted_at is null`,
  );
  const secrets = await query<{ household_id: string; owner: string; text: string; day: string }>(
    db,
    sql`select s.household_id, s.owner, s.text, (s.at at time zone h.time_zone)::date::text as day
        from (select household_id, owner_id as owner, title as text, start_at as at from events where visibility <> 'shared'
              union all select household_id, owner_id, notes, start_at from events where visibility <> 'shared' and notes <> ''
              union all select household_id, organiser_id, title, start_at from moments where kind = 'me'
              union all select household_id, organiser_id, notes, start_at from moments where kind = 'me' and notes <> '') s
        join households h on h.id = s.household_id`,
  );
  const visible = new Set(
    (await query<{ t: string }>(db, sql`select title as t from events where visibility = 'shared' union select title from moments where kind <> 'me'`)).map((r) => r.t),
  );
  let views = 0;
  const leaks: string[] = [];
  for (const viewer of members) {
    const theirs = secrets.filter((s) => s.household_id === viewer.household_id && s.owner !== viewer.account_id && s.text.length >= 3 && !visible.has(s.text));
    const weeks = [...new Set(theirs.map((s) => weekKeyFor(s.day)))].slice(-12);
    const actor: Actor = { accountId: viewer.account_id, displayName: viewer.display_name };
    for (const week of weeks) {
      const json = JSON.stringify(await getWeek(db, actor, week));
      views++;
      for (const s of theirs) if (json.includes(s.text)) leaks.push(`week ${week}`);
    }
  }
  if (leaks.length) return { name, ok: false, detail: `Private text visible to a partner in ${[...new Set(leaks)].join(", ")}` };
  return { name, ok: true, detail: views ? `${views} partner week views checked, nothing private shown` : "No partner-private records to check yet" };
}
