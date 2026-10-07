import { describe, expect, it } from "vitest";
import { createPgliteDb } from "@/db/pglite";
import { restoreBackup, takeBackup, verifyRestore, type Backup } from "@/server/ops/backup";
import { decodeBackup, encodeBackup } from "@/server/ops/backup-file";
import { newWorld, timed } from "./harness";

/** A household with private time, an agreed date, recurring work and money. */
async function seeded() {
  const w = await newWorld();
  const people = [w.alex.accountId, w.sam.accountId];
  await w.run(w.alex, "AddEvent", { title: "Therapy session", notes: "Room 4", visibility: "busy_only", span: timed("2030-10-08", "10:00", "11:00"), adultIds: [w.alex.accountId] });
  await w.run(w.sam, "AddEvent", { title: "Work", span: timed("2030-10-07", "09:00", "17:00"), adultIds: [w.sam.accountId], rule: { freq: "WEEKLY", byDay: ["MO", "TU"] } });
  await w.run(w.alex, "CreateMoment", { kind: "me", title: "Pottery class", span: timed("2030-10-09", "18:00", "20:00"), participantIds: [w.alex.accountId] });
  const m = await w.run(w.alex, "CreateMoment", { kind: "us", title: "Dinner", span: timed("2030-10-11", "19:00", "21:00"), participantIds: people, budgetMinor: 6000 });
  await w.run(w.alex, "ShareMoment", { momentId: m.momentId, version: m.version });
  await w.run(w.sam, "RespondToMoment", { momentId: m.momentId, materialVersion: 1, decision: "accepted" });
  const { expenseId } = await w.run(w.alex, "AddExpense", { label: "Babysitter", committedMinor: 8000, activityDate: "2030-10-11" });
  await w.run(w.alex, "RecordTransaction", { expenseId, kind: "payment", amountMinor: 8000 });
  await w.run(w.alex, "RecordTransaction", { expenseId, kind: "refund", amountMinor: 3000 });
  return w;
}

describe("backup and restore rehearsal", () => {
  it("restores every row into an empty database and passes every check", async () => {
    const w = await seeded();
    const backup = await takeBackup(w.db);
    expect(backup.tables.reservations.length).toBe(2);
    expect(backup.tables.reservations[0]).not.toHaveProperty("during");

    const file = encodeBackup(backup, "correct horse");
    expect(file.includes(Buffer.from("Therapy"))).toBe(false);
    expect(() => decodeBackup(file, "wrong")).toThrow();
    const restored = await createPgliteDb();
    await restoreBackup(restored, decodeBackup(file, "correct horse"));
    const checks = await verifyRestore(restored, backup);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.find((c) => c.name === "Money totals")?.detail).toContain("net paid 5000");
    expect(checks.find((c) => c.name === "Partner privacy")?.detail).toMatch(/[1-9]\d* partner week views/);
  });

  it("fails when restored data is missing or wrong", async () => {
    const w = await seeded();
    const backup = await takeBackup(w.db);
    const restored = await createPgliteDb();
    // Drop a payment and an account's membership from what gets restored.
    const damaged: Backup = { ...backup, tables: { ...backup.tables, payment_transactions: backup.tables.payment_transactions.slice(1), households: [] } };
    await restoreBackup(restored, damaged);
    const failed = (await verifyRestore(restored, backup)).filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toEqual(expect.arrayContaining(["Row counts", "References", "Money totals"]));
  });
});
