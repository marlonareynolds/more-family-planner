import Link from "next/link";
import { fmtDate } from "@/components/format";
import { Card, EmptyState, SectionTitle } from "@/components/ui";
import { requireHousehold } from "@/server/page-data";
import { lookBackFor } from "@/server/queries/look-back";
import { instantToLocalDate } from "@/domain/time";

export const metadata = { title: "Look back" };

const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const KIND = { me: "Me", us: "Us", family: "Family" } as const;

/** "Your October": the moments you made, told as memories, not metrics. */
export default async function LookBackPage({ searchParams }: PageProps<"/look-back">) {
  const sp = await searchParams;
  const { actor, db, household } = await requireHousehold();
  const thisMonth = instantToLocalDate(new Date().getTime(), household.timeZone).slice(0, 7);
  const month = typeof sp.m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m) && sp.m <= thisMonth ? sp.m : thisMonth;
  const lb = await lookBackFor(db, actor, month);
  const total = lb.counts.me + lb.counts.us + lb.counts.family;
  const parts = [
    lb.counts.us && `${lb.counts.us} for the two of you`,
    lb.counts.family && `${lb.counts.family} as a family`,
    lb.counts.me && `${lb.counts.me} for yourselves`,
  ].filter(Boolean);

  return (
    <div className="max-w-2xl">
      <div className="flex items-end justify-between gap-3">
        <h1 className="font-display text-3xl">Your {lb.label.split(" ")[0]}</h1>
        <nav aria-label="Months" className="flex gap-3 text-sm">
          {(lb.hasEarlier || total > 0) && <Link className="text-brand underline" href={`/look-back?m=${shift(month, -1)}`}>Earlier</Link>}
          {month < thisMonth && <Link className="text-brand underline" href={`/look-back?m=${shift(month, 1)}`}>Later</Link>}
        </nav>
      </div>
      <p className="mt-1 text-ink-2">{lb.label}</p>

      {total === 0 ? (
        <div className="mt-6">
          <EmptyState title={month === thisMonth ? "Nothing to look back on yet this month." : "Nothing marked as happened this month."}>
            When a plan happens, tap “It happened” and add a highlight. They collect here.
          </EmptyState>
        </div>
      ) : (
        <>
          <Card className="mt-6">
            <p className="text-lg">You made time for {total} thing{total === 1 ? "" : "s"}: {parts.join(", ")}.</p>
            {lb.ritualsKept > 0 && <p className="mt-1 text-ink-2">{lb.ritualsKept} of them were rituals you kept.</p>}
            {lb.meHours.some((a) => a.hours > 0) && (
              <p className="mt-1 text-ink-2">
                Time for yourselves: {lb.meHours.map((a) => `${a.id === actor.accountId ? "you" : a.name} ${a.hours} hour${a.hours === 1 ? "" : "s"}`).join(", ")}.
              </p>
            )}
          </Card>
          <SectionTitle>Moments</SectionTitle>
          <ul className="flex flex-col gap-3">
            {lb.moments.map((m) => (
              <li key={m.id}>
                <Card tone={m.kind}>
                  <p className="text-sm text-ink-3">{fmtDate(m.date)} · {KIND[m.kind]}{m.chosenBy ? ` · ${m.chosenBy}'s pick` : ""}</p>
                  <h3 className="font-semibold">{m.title}</h3>
                  {m.highlights.map((h, i) => (
                    <p key={i} className="mt-1 text-[15px]">“{h.text}” <span className="text-sm text-ink-3">{h.author}</span></p>
                  ))}
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-6 text-xs text-ink-3">
        Private reflections never appear here. Keep a copy of everything with the household export in <Link className="underline" href="/settings">Settings</Link>.
      </p>
    </div>
  );
}
