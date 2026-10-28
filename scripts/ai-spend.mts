/**
 * This month's AI letter-reading spend, per household and in total. Pence
 * and counts only: household ids are shortened and no names or letters are
 * read.
 *   DATABASE_URL=… pnpm ops:ai-spend
 * The same numbers as SQL, for the Supabase SQL editor, are in docs/ops.md.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { spendByHousehold } from "@/server/desk-ai";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL.");
  process.exit(1);
}
const client = postgres(url, { max: 1, prepare: false });
try {
  const s = await spendByHousehold(drizzle(client, { schema }) as unknown as Db);
  console.log(`This month: ${s.totalPence}p of the ${s.ceilingPence}p ceiling, ${s.households.length} households.`);
  for (const h of s.households) {
    const used = h.settledPence + h.runningPence;
    console.log(`  ${h.householdId.slice(0, 8)}  ${String(h.reads).padStart(3)} reads  ${String(used).padStart(4)}p of ${h.allowancePence}p${h.runningPence ? ` (${h.runningPence}p still running)` : ""}`);
  }
} finally {
  await client.end();
}
