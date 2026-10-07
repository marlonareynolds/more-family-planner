/**
 * Monthly evidence summary across households (spec 21.3), counts only.
 *   DATABASE_URL=… pnpm trial:report [days=30]
 * Outcome averages use only answers their authors shared with the trial.
 */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL.");
  process.exit(1);
}
const days = Number(process.argv[2] ?? 30);
const client = postgres(url, { max: 1, prepare: false });
const db = drizzle(client);
const q = async <T,>(s: ReturnType<typeof sql>) => (await db.execute(s)) as unknown as T[];
const since = sql`now() - make_interval(days => ${days})`;
try {
  const [h] = await q<{ households: number; both: number; active: number; both_active: number }>(sql`
    with live as (select household_id, count(*) as adults from memberships m join households h on h.id = m.household_id
                  where m.ends_at is null and h.deleted_at is null group by household_id),
         act as (select household_id, count(distinct account_id) as n from product_events where event_type = 'active_day' and occurred_at > ${since} group by household_id)
    select (select count(*) from live)::int as households, (select count(*) from live where adults = 2)::int as both,
           (select count(*) from act)::int as active, (select count(*) from act where n >= 2)::int as both_active`);
  console.log(`Last ${days} days`);
  console.log(`Households: ${h.households} (${h.both} with both adults). Active: ${h.active}; both adults active: ${h.both_active}.`);
  const ev = await q<{ t: string; n: number; hh: number }>(sql`select event_type as t, count(*)::int as n, count(distinct household_id)::int as hh
    from product_events where occurred_at > ${since} and event_type <> 'active_day' group by 1 order by 1`);
  for (const e of ev) console.log(`  ${e.t}: ${e.n} across ${e.hh} households`);
  const r = await q<{ week: string; answered: number; shared: number; worthwhile: number | null; minutes: number | null; fair: number | null; keep: number | null }>(sql`
    select week_key::text as week, count(*)::int as answered, count(*) filter (where share_with_trial)::int as shared,
      round(avg(coalesce(me_moments,0)+coalesce(us_moments,0)+coalesce(family_moments,0)) filter (where share_with_trial), 1)::float as worthwhile,
      round(avg(coalesce(minutes_in_app,0)+coalesce(minutes_outside,0)) filter (where share_with_trial))::float as minutes,
      round(avg(fairly_agreed) filter (where share_with_trial), 1)::float as fair,
      (count(*) filter (where share_with_trial and continue_choice = 'yes'))::int as keep
    from trial_responses where week_key > (now() - make_interval(days => ${days}))::date group by 1 order by 1`);
  console.log("Weekly trial answers (averages from shared answers only):");
  for (const w of r) console.log(`  ${w.week}: ${w.answered} answered, ${w.shared} shared; moments ${w.worthwhile ?? "–"}, organising ${w.minutes ?? "–"} min, fairness ${w.fair ?? "–"}/5, would continue ${w.keep}/${w.shared}`);
} finally {
  await client.end();
}
