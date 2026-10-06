"use client";

import Link from "next/link";
import type { Balance } from "@/server/queries/balance";
import { useApp } from "./app-context";
import { fmtDate } from "./format";
import { Card, SectionTitle } from "./ui";

const h = (n: number) => (n === 0 ? "–" : `${n % 1 === 0 ? n : n.toFixed(1)} h`);

/** Plain totals of how time and work were shared lately: no score, no ranking. */
export function BalanceCard({ balance }: { balance: Balance }) {
  const app = useApp();
  return (
    <section>
      <SectionTitle>How time has been shared</SectionTitle>
      <Card className="flex flex-col gap-3">
        <p className="text-sm text-ink-3">Agreed and completed plans since {fmtDate(balance.since, { weekday: false })}, plus Me time booked for the next two weeks.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[15px]">
            <thead>
              <tr className="text-xs text-ink-3">
                <th scope="col" className="py-1 font-normal"><span className="sr-only">Adult</span></th>
                <th scope="col" className="py-1 font-normal">Me time had</th>
                <th scope="col" className="py-1 font-normal">Me time booked</th>
                <th scope="col" className="py-1 font-normal">Childcare</th>
                <th scope="col" className="py-1 font-normal">Tasks done</th>
              </tr>
            </thead>
            <tbody>
              {balance.adults.map((a) => (
                <tr key={a.id} className="border-t border-line">
                  <th scope="row" className="py-2 font-medium">{a.id === app.me.id ? "You" : a.displayName}</th>
                  <td>{h(a.meDone)}</td>
                  <td>{h(a.mePlanned)}</td>
                  <td>{h(a.careHours)}</td>
                  <td>{a.tasksDone || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-ink-2">Together: {h(balance.usHours)} as a couple, {h(balance.familyHours)} as a family.</p>
        {balance.question && (
          <p className="rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand">
            {balance.question.text} {balance.question.forId === app.me.id && <Link className="underline" href="/me">Find a time</Link>}
          </p>
        )}
      </Card>
    </section>
  );
}
