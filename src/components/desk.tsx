"use client";

import { Check, Inbox, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { readLetter, type Proposal, type ProposalKind } from "@/lib/desk-read";
import { useApp } from "./app-context";
import { fmtDate, todayIn } from "./format";
import { PeoplePicker } from "./people-picker";
import { toast } from "./toast";
import { Badge, Button, Card, Checkbox, EmptyState, ErrorNote, Field, Segmented, SectionTitle, cx, inputClass } from "./ui";
import { useCommand } from "./use-command";

const KIND_LABEL: Record<ProposalKind, string> = { event: "Diary", trip: "Time away", holiday: "School break" };

interface Draft {
  key: string;
  on: boolean;
  kind: ProposalKind;
  title: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  adultIds: string[];
  childIds: string[];
  justMe: boolean;
  source: string;
  past: boolean;
  state: "ready" | "added" | "failed";
}

function draftOf(p: Proposal, meId: string): Draft {
  return {
    key: p.key,
    on: !p.past,
    kind: p.kind,
    title: p.title,
    startDate: p.startDate,
    endDate: p.endDate,
    allDay: p.startTime === null,
    startTime: p.startTime ?? "09:00",
    endTime: p.endTime ?? "17:00",
    adultIds: [meId],
    childIds: p.childIds,
    justMe: false,
    source: p.source,
    past: p.past,
    state: "ready",
  };
}

/**
 * The Household Desk, step 1: paste a letter, booking or invitation and More
 * proposes what to add. The reading happens in this browser, so the text is
 * never sent or stored. Each item goes in through the same commands as the
 * hand-made version, with the same sharing and Me-time rules.
 */
export function DeskBoard() {
  const app = useApp();
  const router = useRouter();
  const { run, pending, error } = useCommand(app.householdId);
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<Draft[] | null>(null);

  const read = () => setDrafts(readLetter(text, { today: todayIn(app.timeZone), children: app.children }).map((p) => draftOf(p, app.me.id)));
  const patch = (key: string, change: Partial<Draft>) => setDrafts((ds) => ds?.map((d) => (d.key === key ? { ...d, ...change } : d)) ?? null);
  const chosen = drafts?.filter((d) => d.on && d.state !== "added") ?? [];

  async function add() {
    let added = 0;
    for (const d of chosen) {
      const ok = await run(...commandFor(d, app.me.id), { expected: { membershipRevision: app.membershipRevision }, refresh: false });
      patch(d.key, { state: ok ? "added" : "failed", on: !ok });
      if (ok) added++;
      else break;
    }
    if (added) {
      toast(added === 1 ? "Added to the diary." : `${added} things added to the diary.`, { celebrate: true });
      router.refresh();
    }
  }

  function clear() {
    setText("");
    setDrafts(null);
  }

  return (
    <div>
      <h1 className="font-display text-3xl">Household desk</h1>
      <p className="mt-1 max-w-prose text-ink-2">
        Paste a school letter, a booking confirmation or an invitation. More picks out the dates and suggests what to add. You check each one; nothing goes in the diary until you tap Add.
      </p>
      <p className="mt-2 flex max-w-prose items-start gap-2 text-sm text-ink-3">
        <Lock aria-hidden size={16} className="mt-0.5 shrink-0" />
        <span>The letter is read here on your phone. It isn&apos;t sent anywhere or saved, and {app.partner ? `${app.partner.displayName} only sees` : "anyone you share with only sees"} what you add.</span>
      </p>

      <SectionTitle>Paste it here</SectionTitle>
      <Field label="Letter, email or booking">
        {(id) => (
          <textarea
            id={id}
            className={cx(inputClass, "min-h-40 font-[inherit]")}
            value={text}
            maxLength={20_000}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Half term is from Monday 27 October to Friday 31 October.\nParents' evening: 22/10, 3.30pm to 6pm."}
          />
        )}
      </Field>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" disabled={!text.trim()} onClick={read}>Read it</Button>
        {drafts && <Button onClick={clear}>Start again</Button>}
      </div>

      {drafts && (
        <section aria-live="polite">
          <SectionTitle hint={drafts.length ? "Change anything that's not right, untick what you don't want, then add." : undefined}>
            {drafts.length ? `Found ${drafts.length === 1 ? "1 thing" : `${drafts.length} things`}` : "Nothing to add"}
          </SectionTitle>
          {drafts.length === 0 ? (
            <EmptyState icon={<Inbox />} title="No dates found.">
              More looks for dates like &ldquo;Friday 17 October&rdquo; or &ldquo;17/10&rdquo;. If the letter has them in a picture or an attachment, type the key lines in instead.
            </EmptyState>
          ) : (
            <>
              <ErrorNote message={error?.message} />
              <ul className="flex flex-col gap-3">
                {drafts.map((d) => (
                  <li key={d.key}>
                    <DraftCard d={d} onChange={(change) => patch(d.key, change)} />
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button variant="primary" disabled={pending || !chosen.length || chosen.some((d) => !valid(d))} onClick={add}>
                  {chosen.length ? `Add ${chosen.length === 1 ? "1 thing" : `${chosen.length} things`}` : "Nothing ticked"}
                </Button>
                {chosen.some((d) => !valid(d)) && <span className="text-sm text-warn">Fill in the missing details first.</span>}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function valid(d: Draft): boolean {
  if (!d.title.trim() || !d.startDate || !d.endDate || d.endDate < d.startDate) return false;
  if (d.kind === "holiday") return d.childIds.length > 0;
  if (d.kind === "trip") return d.adultIds.length > 0;
  return true;
}

function DraftCard({ d, onChange }: { d: Draft; onChange: (change: Partial<Draft>) => void }) {
  const app = useApp();
  if (d.state === "added") {
    return (
      <Card className="flex items-center gap-2 text-ink-2">
        <Check aria-hidden size={18} className="text-good" />
        <span>Added: {d.title}, {fmtDate(d.startDate)}{d.endDate !== d.startDate ? ` to ${fmtDate(d.endDate)}` : ""}</span>
      </Card>
    );
  }
  return (
    <Card className={cx("flex flex-col gap-3", !d.on && "opacity-70")} tone={d.kind === "holiday" ? "care" : d.kind === "trip" ? "family" : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Checkbox checked={d.on} onChange={(on) => onChange({ on })} label={d.on ? "Add this" : "Leave this out"} hint={d.past ? "This date has passed." : undefined} />
        <Badge tone={d.kind === "holiday" ? "care" : "neutral"}>{KIND_LABEL[d.kind]}</Badge>
      </div>
      <blockquote className="border-l-2 border-line pl-3 text-sm italic text-ink-3">&ldquo;{d.source}&rdquo;</blockquote>
      {d.state === "failed" && <p className="text-sm text-bad">This one wasn&apos;t added. Check the details and try again.</p>}
      {d.on && (
        <>
          <Segmented label="Add as" value={d.kind} onChange={(kind) => onChange({ kind })} options={(Object.keys(KIND_LABEL) as ProposalKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
          <Field label="What">{(id) => <input id={id} className={inputClass} value={d.title} maxLength={80} onChange={(e) => onChange({ title: e.target.value })} />}</Field>
          {d.kind === "event" && <Checkbox checked={d.allDay} onChange={(allDay) => onChange({ allDay })} label="All day" />}
          <div className="grid grid-cols-2 gap-3">
            <Field label={d.kind === "event" && !d.allDay ? "Date" : "From"}>
              {(id) => <input id={id} type="date" className={inputClass} value={d.startDate} onChange={(e) => onChange({ startDate: e.target.value, endDate: d.endDate < e.target.value || d.endDate === d.startDate ? e.target.value : d.endDate })} />}
            </Field>
            <Field label={d.kind === "event" && !d.allDay ? "Ends on" : "Last day"}>
              {(id) => <input id={id} type="date" className={inputClass} min={d.startDate} value={d.endDate} onChange={(e) => onChange({ endDate: e.target.value })} />}
            </Field>
            {(d.kind === "trip" || (d.kind === "event" && !d.allDay)) && (
              <>
                <Field label={d.kind === "trip" ? "Leaving at" : "Starts"}>{(id) => <input id={id} type="time" className={inputClass} value={d.startTime} onChange={(e) => onChange({ startTime: e.target.value })} />}</Field>
                <Field label={d.kind === "trip" ? "Back at" : "Ends"}>{(id) => <input id={id} type="time" className={inputClass} value={d.endTime} onChange={(e) => onChange({ endTime: e.target.value })} />}</Field>
              </>
            )}
          </div>
          {d.kind === "holiday" ? (
            <>
              <PeoplePicker label="Children off school" showAdults={false} adultIds={[]} childIds={d.childIds} onChange={(v) => onChange({ childIds: v.childIds })} />
              <p className="text-sm text-ink-3">More will show these days as needing someone with the children, 08:30 to 17:30 on weekdays. You can change that in Trips and care.</p>
            </>
          ) : (
            <PeoplePicker label={d.kind === "trip" ? "Who's going" : "Who"} adultIds={d.adultIds} childIds={d.childIds} onChange={(v) => onChange({ adultIds: v.adultIds, childIds: v.childIds })} />
          )}
          {d.kind === "event" && app.adults.length > 1 && (
            <Checkbox checked={d.justMe} onChange={(justMe) => onChange({ justMe })} label="Keep this just for me" hint="For a surprise: only you will see it." />
          )}
        </>
      )}
    </Card>
  );
}

/** The same command the hand-made version would send. */
function commandFor(d: Draft, meId: string): [string, Record<string, unknown>] {
  const title = d.title.trim();
  if (d.kind === "holiday") {
    return ["CreateHoliday", { name: title, startDate: d.startDate, endDate: d.endDate, dailyStart: "08:30", dailyEnd: "17:30", includeWeekends: false, childIds: d.childIds }];
  }
  if (d.kind === "trip") {
    return [
      "AddTrip",
      { title, destination: "", kind: d.childIds.length ? "family" : "personal", startDate: d.startDate, startTime: d.startTime, endDate: d.endDate, endTime: d.endTime, travellerIds: d.adultIds, childIds: d.childIds },
    ];
  }
  const span = d.allDay
    ? { allDay: true, startDate: d.startDate, endDate: d.endDate }
    : { allDay: false, startDate: d.startDate, startTime: d.startTime, endDate: d.endDate, endTime: d.endTime };
  return [
    "AddEvent",
    { title, visibility: d.justMe ? "private" : "shared", span, adultIds: d.justMe ? [meId] : d.adultIds, childIds: d.childIds },
  ];
}
