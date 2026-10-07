"use client";

import { Check, FileText, Inbox, Lock, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { childrenIn, readLetter, type Proposal, type ProposalKind, type ProposalRole } from "@/lib/desk-read";
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
  open: boolean;
  role: ProposalRole;
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

function draftOf(p: Proposal, meId: string, hasChildren: boolean): Draft {
  // A school break needs children to look after; without any yet, it goes in as an all-day diary entry.
  const kind: ProposalKind = p.kind === "holiday" && !hasChildren ? "event" : p.kind;
  return {
    key: p.key,
    // Optional extras (a donations drop-off, an early finish before a break) are shown but not ticked.
    on: !p.past && p.role !== "optional",
    open: false,
    role: p.role,
    kind,
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
export function DeskBoard({ ai = false }: { ai?: boolean }) {
  const app = useApp();
  const router = useRouter();
  const { run, pending, error } = useCommand(app.householdId);
  const [text, setText] = useState("");
  const [file, setFile] = useState<{ name: string; mediaType: string; data: string } | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);

  async function read() {
    const today = todayIn(app.timeZone);
    const ctx = { today, children: app.children };
    setReadNote(null);
    if (!ai) {
      setDrafts(readLetter(text, ctx).map((p) => draftOf(p, app.me.id, app.children.length > 0)));
      return;
    }
    setReading(true);
    try {
      const res = await fetch("/api/v1/desk/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ householdId: app.householdId, today, timeZone: app.timeZone, text, file: file ? { mediaType: file.mediaType, data: file.data } : null }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? "The AI reader couldn't be reached, so this letter was read the simpler way.");
      setDrafts((body.items as AiItem[]).map((i, n) => draftOf(fromAi(i, n, ctx), app.me.id, app.children.length > 0)));
    } catch (err) {
      setReadNote(file && !text.trim() ? `${(err as Error).message.replace(/, so this letter was read the simpler way\.$/, ".")} Try again, or paste the letter's text instead.` : (err as Error).message);
      setDrafts(text.trim() ? readLetter(text, ctx).map((p) => draftOf(p, app.me.id, app.children.length > 0)) : null);
    } finally {
      setReading(false);
    }
  }

  async function pick(f: File | undefined) {
    setFileNote(null);
    if (!f) return setFile(null);
    try {
      setFile(await prepareFile(f));
    } catch (err) {
      setFile(null);
      setFileNote((err as Error).message);
    }
  }
  const patch = (key: string, change: Partial<Draft>) => setDrafts((ds) => ds?.map((d) => (d.key === key ? { ...d, ...change } : d)) ?? null);
  const chosen = drafts?.filter((d) => d.on && d.state !== "added") ?? [];
  const main = drafts?.filter((d) => d.role !== "optional") ?? [];
  const extras = drafts?.filter((d) => d.role === "optional") ?? [];

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
    setFile(null);
    setFileNote(null);
    setReadNote(null);
    setDrafts(null);
  }

  return (
    <div>
      <h1 className="font-display text-3xl">Household desk</h1>
      <p className="mt-1 max-w-prose text-ink-2">
        {ai ? "Paste a school letter, a booking or an invitation, or add a photo or PDF of one." : "Paste a school letter, a booking confirmation or an invitation."} More picks out the dates and suggests what to add. You check each one; nothing goes in the diary until you tap Add.
      </p>
      <p className="mt-2 flex max-w-prose items-start gap-2 text-sm text-ink-3">
        <Lock aria-hidden size={16} className="mt-0.5 shrink-0" />
        {ai ? (
          <span>
            The letter is read by Claude, Anthropic&apos;s AI, and isn&apos;t used to train it. More doesn&apos;t keep the letter, and {app.partner ? `${app.partner.displayName} only sees` : "anyone you share with only sees"} what you add.
          </span>
        ) : (
          <span>The letter is read here on your phone. It isn&apos;t sent anywhere or saved, and {app.partner ? `${app.partner.displayName} only sees` : "anyone you share with only sees"} what you add.</span>
        )}
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
      {ai && (
        <div className="mt-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink hover:bg-surface-2">
            <FileText aria-hidden size={16} />
            <span>{file ? `Change photo or PDF` : "Add a photo or PDF"}</span>
            <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          {file && (
            <span className="ml-3 text-sm text-ink-2">
              {file.name} <button type="button" className="underline" onClick={() => setFile(null)}>Remove</button>
            </span>
          )}
          {fileNote && <p className="mt-1 text-sm text-warn">{fileNote}</p>}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" disabled={reading || (!text.trim() && !file)} onClick={read}>
          {reading ? "Reading…" : "Read it"}
        </Button>
        {drafts && <Button onClick={clear}>Start again</Button>}
      </div>

      {reading && (
        <p className="mt-6 flex items-center gap-2 text-ink-2" aria-live="polite">
          <Sparkles aria-hidden size={16} /> Reading the whole letter. This takes a few seconds.
        </p>
      )}
      {readNote && <p className="mt-6 text-sm text-warn">{readNote}</p>}
      {drafts && !reading && (
        <section aria-live="polite">
          <SectionTitle hint={drafts.length ? "Untick what you don't want, change anything that's not right, then add." : undefined}>
            {main.length ? `Found ${main.length === 1 ? "1 thing" : `${main.length} things`}` : drafts.length ? "Nothing for the diary" : "Nothing to add"}
          </SectionTitle>
          {drafts.length === 0 ? (
            <EmptyState icon={<Inbox />} title="No dates found.">
              More looks for dates like &ldquo;Friday 17 October&rdquo; or &ldquo;17/10&rdquo;. If the letter has them in a picture or an attachment, type the key lines in instead.
            </EmptyState>
          ) : (
            <>
              <ErrorNote message={error?.message} />
              <ul className="flex flex-col gap-3">
                {main.map((d) => (
                  <li key={d.key}>
                    <DraftCard d={d} onChange={(change) => patch(d.key, change)} />
                  </li>
                ))}
              </ul>
              {extras.length > 0 && (
                <>
                  <h3 className="mt-6 text-sm font-medium text-ink-2">Also mentioned</h3>
                  <p className="mb-2 text-sm text-ink-3">Probably not worth a diary entry, so these aren&apos;t ticked. Tick one if you want it.</p>
                  <ul className="flex flex-col gap-2">
                    {extras.map((d) => (
                      <li key={d.key}>
                        <DraftCard d={d} onChange={(change) => patch(d.key, change)} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
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

interface AiItem {
  kind: ProposalKind;
  role: ProposalRole;
  title: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  quote: string;
}

/** An item from the AI reader, shaped like one from the reader on the phone. */
function fromAi(i: AiItem, n: number, ctx: { today: string; children: { id: string; preferredName: string }[] }): Proposal {
  const named = childrenIn(`${i.title} ${i.quote}`, ctx.children);
  return {
    key: `a${n}`,
    kind: i.kind,
    role: i.role,
    title: i.title,
    startDate: i.startDate,
    endDate: i.endDate,
    startTime: i.startTime,
    endTime: i.startTime ? (i.endTime ?? plusMinutes(i.startTime, i.role === "event" ? 60 : 15)) : null,
    childIds: named.length || i.kind !== "holiday" ? named : ctx.children.map((c) => c.id),
    source: i.quote,
    past: i.endDate < ctx.today,
  };
}

function plusMinutes(time: string, minutes: number): string {
  const total = Math.min(+time.slice(0, 2) * 60 + +time.slice(3) + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Photos are shrunk to a sharp, readable size before sending; PDFs go as they are. */
async function prepareFile(f: File): Promise<{ name: string; mediaType: string; data: string }> {
  if (f.type === "application/pdf") {
    if (f.size > 3_000_000) throw new Error("That PDF is over 3MB. Try a photo of the page instead.");
    return { name: f.name, mediaType: f.type, data: await base64Of(f) };
  }
  if (!f.type.startsWith("image/")) throw new Error("Choose a photo or a PDF.");
  const bitmap = await createImageBitmap(f);
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("That photo couldn't be opened."))), "image/jpeg", 0.85));
  return { name: f.name, mediaType: "image/jpeg", data: await base64Of(blob) };
}

async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
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
    <Card className={cx("flex flex-col gap-2", !d.on && "opacity-70")} tone={d.kind === "holiday" ? "care" : d.kind === "trip" ? "family" : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cx("text-ink", d.role === "event" ? "font-display text-xl leading-snug" : "font-medium")}>{d.title || "Untitled"}</p>
          <p className="text-sm text-ink-2">{whenOf(d)}</p>
        </div>
        <Badge tone={badgeTone(d)}>{badgeOf(d)}</Badge>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Checkbox checked={d.on} onChange={(on) => onChange({ on, open: on && d.open })} label={d.on ? "Add this" : "Leave this out"} hint={d.past ? "This date has passed." : undefined} />
        {d.on && (
          <Button variant="ghost" size="sm" aria-expanded={d.open} onClick={() => onChange({ open: !d.open })}>
            {d.open ? "Done" : "Change details"}
          </Button>
        )}
      </div>
      {d.state === "failed" && <p className="text-sm text-bad">This one wasn&apos;t added. Check the details and try again.</p>}
      {d.on && (d.open || d.state === "failed" || !valid(d)) && (
        <>
          <blockquote className="border-l-2 border-line pl-3 text-sm italic text-ink-3">&ldquo;{d.source}&rdquo;</blockquote>
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

function badgeOf(d: Draft): string {
  if (d.kind === "holiday") return "School break";
  if (d.kind === "trip") return KIND_LABEL.trip;
  if (d.role === "deadline") return "Deadline";
  if (d.role === "optional") return "Maybe";
  return "Event";
}

function badgeTone(d: Draft): "neutral" | "warn" | "care" | "family" | "us" {
  if (d.kind === "holiday") return "care";
  if (d.kind === "trip") return "family";
  if (d.role === "deadline") return "warn";
  if (d.role === "optional") return "neutral";
  return "us";
}

/** "Mon 26 Oct to Fri 30 Oct, all day", "Reminder on Mon 12 Oct at 12:00". */
function whenOf(d: Draft): string {
  const days = d.endDate > d.startDate ? `${fmtDate(d.startDate)} to ${fmtDate(d.endDate)}` : fmtDate(d.startDate);
  if (d.kind === "holiday") return `${days}, all day`;
  if (d.role === "deadline") return d.allDay ? `Reminder on ${days}` : `Reminder on ${days} at ${d.startTime}`;
  if (d.kind === "trip") return `${fmtDate(d.startDate)} ${d.startTime} to ${fmtDate(d.endDate)} ${d.endTime}`;
  if (d.allDay) return `${days}, all day`;
  return d.endDate > d.startDate ? `${fmtDate(d.startDate)} ${d.startTime} to ${fmtDate(d.endDate)} ${d.endTime}` : `${days}, ${d.startTime} to ${d.endTime}`;
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
