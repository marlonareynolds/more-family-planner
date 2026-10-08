"use client";

import { AlertTriangle, Check, FileText, Inbox, Info, Lock, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { checksFor, noteLines, plusMinutes, type CheckCode, type DeskCheck } from "@/lib/desk-checks";
import { dayTitleKey, deskKeys, diaryTimes, normTitle, type KeyFields } from "@/lib/desk-keys";
import { childrenIn, readLetter, type Proposal, type ProposalKind, type ProposalRole } from "@/lib/desk-read";
import type { DeskStatus, DeskTarget } from "@/server/desk";
import { useApp } from "./app-context";
import { fmtDate, todayIn } from "./format";
import { PeoplePicker } from "./people-picker";
import { toast } from "./toast";
import { Badge, Button, Card, Checkbox, EmptyState, ErrorNote, Field, Segmented, SectionTitle, cx, inputClass } from "./ui";
import { useCommand } from "./use-command";

const KIND_LABEL: Record<ProposalKind, string> = { event: "Diary", trip: "Time away", holiday: "School break" };

type Choice = "add" | "update" | "skip" | "undecided";

interface Draft extends Omit<Proposal, "key" | "startTime" | "endTime" | "arriveBy"> {
  key: string;
  open: boolean;
  allDay: boolean;
  startTime: string;
  endTime: string;
  arriveBy: string;
  adultIds: string[];
  justMe: boolean;
  /** Undecided until the person chooses, for anything that needs a decision. */
  choice: Choice;
  /** For a deadline, which becomes a job: who takes it on. */
  owner: "me" | "partner" | "none" | null;
  /** "I've checked it" answers. */
  confirmed: Partial<Record<CheckCode, boolean>>;
  /** For a changed pickup: who collects. Choosing the other adult asks them. */
  collect: "me" | "partner" | "none" | null;
  dup: DeskStatus | null;
  /** Shown under "needs your decision" from the start, so a card doesn't jump once answered. */
  flagged: boolean;
  state: "ready" | "added" | "updated" | "already" | "failed";
}

function draftOf(p: Proposal, meId: string, hasChildren: boolean): Draft {
  // A school break needs children to look after; without any yet, it goes in as an all-day diary entry.
  const kind: ProposalKind = p.kind === "holiday" && !hasChildren ? "event" : p.kind;
  return {
    ...p,
    kind,
    open: false,
    allDay: p.startTime === null,
    startTime: p.startTime ?? "09:00",
    // A missing end is shown as an estimate, and the card says so.
    endTime: p.endTime ?? (p.startTime ? plusMinutes(p.startTime, p.role === "deadline" ? 15 : 60) : "17:00"),
    arriveBy: p.arriveBy ?? "",
    adultIds: [meId],
    justMe: false,
    choice: "add",
    owner: null,
    confirmed: {},
    collect: null,
    dup: null,
    flagged: false,
    state: "ready",
  };
}

/** The Proposal-shaped view of a card as it stands, for the checks. */
function asProposal(d: Draft) {
  return { ...d, startTime: d.allDay ? null : d.startTime, endTime: d.allDay ? null : d.endTime };
}

/** Is this check answered? */
function answered(d: Draft, c: DeskCheck): boolean {
  if (!c.decide) return true;
  if (c.code === "payment") return d.owner !== null;
  if (c.code === "which_child") return d.childIds.length > 0;
  if (c.code === "pickup") return d.collect !== null;
  return !!d.confirmed[c.code];
}

/** The first choice a card starts with: nothing that needs a decision is pre-ticked. */
function startingChoice(d: Draft, checks: DeskCheck[]): Choice {
  if (d.past || d.dup?.status === "added") return "skip";
  if (d.dup && d.dup.status !== "new") return "undecided";
  if (checks.some((c) => c.decide)) return "undecided";
  return d.role === "optional" ? "skip" : "add";
}

const jobKind = (d: Draft) => d.role === "deadline" && d.kind === "event";

function keyFields(d: Draft): KeyFields {
  return {
    kind: jobKind(d) ? "job" : d.kind,
    title: d.title.trim(),
    startDate: d.startDate,
    endDate: d.endDate,
    allDay: d.kind === "holiday" || (d.kind === "event" && d.allDay),
    startTime: d.kind === "holiday" || (d.kind === "event" && d.allDay) ? null : d.startTime,
    endTime: d.kind === "holiday" || (d.kind === "event" && d.allDay) || jobKind(d) ? null : d.endTime,
    location: d.location,
    details: d.details,
    childIds: d.childIds,
    arriveBy: d.kind === "event" && !d.allDay && d.arriveBy ? d.arriveBy : null,
    repeat: d.kind === "event" ? d.repeat : null,
    repeatUntil: d.kind === "event" && d.repeat ? d.repeatUntil : null,
  };
}

/** The entry the card would change, if there is exactly one it can. */
function updatable(d: Draft): DeskTarget | null {
  const t = d.dup?.status === "changed" ? d.dup.current : d.dup?.status === "possible" && d.dup.candidates.length === 1 ? d.dup.candidates[0] : null;
  return t && !t.recurring && (t.targetType === "event" || t.targetType === "trip") ? t : null;
}

/**
 * The Household Desk: paste a letter, booking or invitation (or, with the AI
 * reader on, add a photo or PDF) and More proposes what to add. Every card
 * says what the letter didn't (no time, an estimated end, which child), a
 * pickup change or a payment waits for a decision, and the server says what
 * is already in the diary, so nothing goes in twice. One tap adds the lot in
 * one go, through the same commands as the hand-made versions.
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
  const [checkNote, setCheckNote] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  /** The letter as pasted, to check each card's quoted line against. */
  const [letter, setLetter] = useState<string | null>(null);
  const checkCtx = { children: app.children, letter };

  async function settle(proposals: Proposal[], pasted: string | null) {
    const ds = proposals.map((p) => draftOf(p, app.me.id, app.children.length > 0));
    // Ask the server what is already in the diary, by fingerprint only.
    let statuses: DeskStatus[] = [];
    setCheckNote(null);
    try {
      const items = await Promise.all(
        ds.map(async (d) => {
          const f = keyFields(d);
          const t = diaryTimes(f);
          return { ref: d.key, kind: f.kind, startDate: d.startDate, startTime: t.startTime, endDate: t.endDate, endTime: t.endTime, ...(await deskKeys(app.householdId, f, null)), dayTitleKey: await dayTitleKey(app.householdId, d.startDate, d.title) };
        }),
      );
      if (items.length) {
        const res = await fetch("/api/v1/desk/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ householdId: app.householdId, items }) });
        if (!res.ok) throw new Error();
        statuses = (await res.json()).statuses as DeskStatus[];
      }
    } catch {
      setCheckNote("More couldn't check what's already in the diary just now. Anything already added won't be added twice.");
    }
    setLetter(pasted);
    setDrafts(
      ds.map((d) => {
        const dup = statuses.find((s) => s.ref === d.key) ?? null;
        const withDup = { ...d, dup: dup?.status === "new" ? null : dup };
        const checks = checksFor(asProposal(withDup), { children: app.children, letter: pasted });
        const flagged = !withDup.past && (checks.some((c) => c.decide) || (!!withDup.dup && withDup.dup.status !== "added"));
        return { ...withDup, flagged, choice: startingChoice(withDup, checks) };
      }),
    );
  }

  async function read() {
    const today = todayIn(app.timeZone);
    const ctx = { today, children: app.children };
    setReadNote(null);
    if (!ai) return settle(readLetter(text, ctx), text);
    setReading(true);
    try {
      const res = await fetch("/api/v1/desk/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ householdId: app.householdId, today, timeZone: app.timeZone, text, file: file ? { mediaType: file.mediaType, data: file.data } : null }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? "The AI reader couldn't be reached, so this letter was read the simpler way.");
      await settle((body.items as AiItem[]).map((i, n) => fromAi(i, n, ctx)), text.trim() ? text : null);
      if (body.unreadable) setReadNote(body.unreadable === 1 ? "One thing in the letter couldn't be read properly (an impossible date), so it isn't shown. Check the letter for it." : `${body.unreadable} things in the letter couldn't be read properly, so they aren't shown. Check the letter for them.`);
    } catch (err) {
      setReadNote(file && !text.trim() ? `${(err as Error).message.replace(/, so this letter was read the simpler way\.$/, ".")} Try again, or paste the letter's text instead.` : (err as Error).message);
      if (text.trim()) await settle(readLetter(text, ctx), text);
      else setDrafts(null);
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
  const live = drafts?.filter((d) => d.state === "ready" || d.state === "failed") ?? [];
  const failedRef = typeof error?.details?.ref === "string" ? error.details.ref : null;
  const chosen = live.filter((d) => d.choice === "add" || d.choice === "update");
  const undecided = live.filter((d) => d.choice === "undecided");
  const blocked = chosen.filter((d) => !valid(d) || checksFor(asProposal(d), checkCtx).some((c) => !answered(d, c)));
  const needs = drafts?.filter((d) => d.flagged) ?? [];
  const main = drafts?.filter((d) => !needs.includes(d) && d.role !== "optional") ?? [];
  const extras = drafts?.filter((d) => !needs.includes(d) && d.role === "optional") ?? [];

  async function add() {
    // A deadline's job is linked to the event it is for, from the same letter.
    const forRef = (d: Draft) => {
      if (!jobKind(d)) return null;
      const target = d.forItem ? normTitle(d.forItem) : null;
      const match = drafts!.find((e) => e !== d && e.role !== "deadline" && (target ? normTitle(e.title) === target : normTitle(d.title).startsWith(normTitle(e.title)) && normTitle(e.title).length >= 6));
      return match?.key ?? null;
    };
    const refs = new Set(chosen.map(forRef).filter(Boolean));
    const items = drafts!
      .filter((d) => chosen.includes(d) || (refs.has(d.key) && (d.state === "already" || d.dup?.status === "added")))
      .map((d) => {
        const f = keyFields(d);
        const checks = checksFor(asProposal(d), checkCtx);
        const action = chosen.includes(d) ? (d.choice === "update" ? "update" : "add") : "existing";
        return {
          ref: d.key,
          ...f,
          justMe: d.justMe,
          action,
          targetId: action === "update" ? (updatable(d)?.targetId ?? null) : null,
          targetVersion: action === "update" ? (updatable(d)?.version ?? null) : null,
          adultIds: d.adultIds,
          notes: noteLines(checks),
          owner: d.owner ?? "none",
          forRef: forRef(d),
          collect: checks.some((c) => c.code === "pickup") ? d.collect : null,
          collectAt: checks.some((c) => c.code === "pickup") ? d.collectAt : null,
        };
      });
    const result = await run<{ results: { ref: string; outcome: "added" | "updated" | "already"; by?: string }[] }>("ImportDeskItems", { items }, { expected: { membershipRevision: app.membershipRevision }, refresh: false });
    // Nothing was added; the cards stay as the person left them, and the one that stopped it says so.
    if (!result) return;
    setDrafts((ds) => ds?.map((d) => {
      const r = result.results.find((x) => x.ref === d.key);
      return r ? { ...d, state: r.outcome } : d;
    }) ?? null);
    const added = result.results.filter((r) => r.outcome !== "already").length;
    const already = result.results.filter((r) => r.outcome === "already").length;
    if (added) toast(added === 1 ? "Added to the diary." : `${added} things added to the diary.`, { celebrate: true });
    if (already) toast(already === 1 ? "One was already in the diary, so it wasn't added again." : `${already} were already in the diary, so they weren't added again.`);
    router.refresh();
  }

  function clear() {
    setText("");
    setFile(null);
    setFileNote(null);
    setReadNote(null);
    setCheckNote(null);
    setDrafts(null);
    setLetter(null);
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
            The letter is sent to Anthropic for Claude, its AI, to read. Anthropic doesn&apos;t use it for training. Under its standard terms it normally deletes it within 30 days, but may keep it longer where the law requires or a safety review needs it. More itself doesn&apos;t save the letter: only the items you add are kept, for as long as they&apos;re in your diary, and {app.partner ? `${app.partner.displayName} only sees` : "anyone you share with only sees"} those.
          </span>
        ) : (
          <span>
            The letter is read here on your phone. It isn&apos;t sent anywhere or saved. To spot repeats, More compares fingerprints, never the words. {app.partner ? `${app.partner.displayName} only sees` : "Anyone you share with only sees"} what you add.
          </span>
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
          {checkNote && <p className="mt-4 text-sm text-warn">{checkNote}</p>}
          {needs.length > 0 && (
            <>
              <SectionTitle hint="These need you to choose before anything is added.">{needs.length === 1 ? "1 needs your decision" : `${needs.length} need your decision`}</SectionTitle>
              <ul className="flex flex-col gap-3">
                {needs.map((d) => (
                  <li key={d.key}>
                    <DraftCard d={d} ctx={checkCtx} failed={failedRef === d.key ? error?.message : undefined} onChange={(change) => patch(d.key, change)} />
                  </li>
                ))}
              </ul>
            </>
          )}
          <SectionTitle hint={drafts.length ? "Untick what you don't want, change anything that's not right, then add." : undefined}>
            {main.length ? `Found ${main.length === 1 ? "1 thing" : `${main.length} things`}` : drafts.length ? "Nothing else for the diary" : "Nothing to add"}
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
                    <DraftCard d={d} ctx={checkCtx} failed={failedRef === d.key ? error?.message : undefined} onChange={(change) => patch(d.key, change)} />
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
                        <DraftCard d={d} ctx={checkCtx} failed={failedRef === d.key ? error?.message : undefined} onChange={(change) => patch(d.key, change)} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button variant="primary" disabled={pending || !chosen.length || blocked.length > 0 || undecided.length > 0} onClick={add}>
                  {chosen.length ? `Add ${chosen.length === 1 ? "1 thing" : `${chosen.length} things`}` : "Nothing ticked"}
                </Button>
                {undecided.length > 0 ? (
                  <span className="text-sm text-warn">Choose for {undecided.length === 1 ? "the card" : `the ${undecided.length} cards`} that need a decision first.</span>
                ) : (
                  blocked.length > 0 && <span className="text-sm text-warn">Answer what&apos;s marked on {blocked.length === 1 ? "1 card" : `${blocked.length} cards`} first.</span>
                )}
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
  arriveBy: string | null;
  location: string | null;
  details: string | null;
  repeat: Proposal["repeat"];
  repeatUntil: string | null;
  forWhom: string | null;
  dateCertain: boolean;
  pickupChange: boolean;
  collectAt: string | null;
  forItem: string | null;
  quote: string;
}

/** An item from the AI reader, shaped like one from the reader on the phone. */
function fromAi(i: AiItem, n: number, ctx: { today: string; children: { id: string; preferredName: string }[] }): Proposal {
  const named = childrenIn(`${i.title} ${i.quote} ${i.forWhom ?? ""}`, ctx.children);
  return {
    key: `a${n}`,
    kind: i.kind,
    role: i.role,
    title: i.title,
    startDate: i.startDate,
    endDate: i.endDate,
    startTime: i.startTime,
    // No end in the letter: the card shows an estimate and says so.
    endTime: i.endTime,
    endStated: i.endTime !== null,
    arriveBy: i.arriveBy,
    location: i.location ?? "",
    details: i.details ?? "",
    repeat: i.repeat,
    repeatUntil: i.repeatUntil,
    forWhom: i.forWhom,
    dateCertain: i.dateCertain,
    pickupChange: i.pickupChange,
    collectAt: i.collectAt ?? null,
    forItem: i.forItem,
    // A break that names no child covers an only child; with more than one, the card asks which.
    childIds: named.length || i.kind !== "holiday" ? named : ctx.children.length === 1 ? [ctx.children[0].id] : [],
    source: i.quote,
    past: i.endDate < ctx.today,
  };
}


function valid(d: Draft): boolean {
  if (!d.title.trim() || !d.startDate || !d.endDate || d.endDate < d.startDate) return false;
  if (d.kind === "holiday") return d.childIds.length > 0;
  if (d.kind === "trip") return d.adultIds.length > 0;
  if (d.arriveBy && !d.allDay && d.arriveBy >= d.startTime) return false;
  return true;
}

/** "Tue 12 Nov at 09:00 to 15:00", as the diary has it now. */
function targetWhen(t: DeskTarget): string {
  const day = t.endDate > t.startDate ? `${fmtDate(t.startDate)} to ${fmtDate(t.endDate)}` : fmtDate(t.startDate);
  return t.startTime ? `${day} at ${t.startTime}${t.endTime && t.targetType !== "job" ? ` to ${t.endTime}` : ""}` : day;
}

/** What the server found already in the diary, in words. Nothing here claims more than it knows. */
function dupLine(d: Draft): string {
  const dup = d.dup;
  if (!dup) return "";
  if (dup.status === "added") return `Already in the diary: added by ${dup.by} on ${fmtDate(dup.on)}. It won't be added twice.`;
  if (dup.status === "changed") {
    const tail = dup.current.recurring ? " It repeats, so change it in the diary if you need to." : "";
    return `Added by ${dup.by} on ${fmtDate(dup.on)}, but the letter and the diary differ now. The diary has ${targetWhen(dup.current)}.${tail}`;
  }
  if (dup.status === "possible") {
    const list = dup.candidates.map(targetWhen).join("; ");
    const many = dup.candidates.length > 1 ? " To change one of those, do it in the diary." : dup.candidates[0].recurring ? " It repeats, so change it in the diary if it has moved." : "";
    return dup.sameDay
      ? `“${d.title}” is already in the diary that day (${list}). Is this another session, or has the time changed?${many}`
      : `“${d.title}” is already in the diary on ${list}. Is this a new date for it, or another one?${many}`;
  }
  if (dup.status === "similar") return `Something called “${dup.title}” is already in the diary that day.`;
  return "";
}

function choicesFor(d: Draft): { value: Choice; label: string }[] {
  const t = updatable(d);
  if (d.dup?.status === "changed") return [...(t ? [{ value: "update" as const, label: "Update the entry" }] : []), { value: "add", label: "Add as new" }, { value: "skip", label: "Leave out" }];
  if (d.dup?.status === "possible") {
    const other = d.dup.sameDay ? "Another session" : "Another one";
    return [...(t ? [{ value: "update" as const, label: d.dup.sameDay ? "Change that one" : "Move that one" }] : []), { value: "add", label: other }, { value: "skip", label: "Leave out" }];
  }
  if (d.dup?.status === "similar") return [{ value: "add", label: "Add anyway" }, { value: "skip", label: "Leave out" }];
  return [{ value: "add", label: "Add this" }, { value: "skip", label: "Leave out" }];
}

function DraftCard({ d, ctx, failed, onChange }: { d: Draft; ctx: { children: { id: string }[]; letter: string | null }; failed?: string; onChange: (change: Partial<Draft>) => void }) {
  const app = useApp();
  if (d.state === "added" || d.state === "updated" || d.state === "already") {
    const word = d.state === "added" ? "Added" : d.state === "updated" ? "Updated" : "Already in the diary";
    return (
      <Card className="flex items-center gap-2 text-ink-2">
        <Check aria-hidden size={18} className="text-good" />
        <span>
          {word}: {d.title}, {fmtDate(d.startDate)}
          {d.endDate !== d.startDate ? ` to ${fmtDate(d.endDate)}` : ""}
        </span>
      </Card>
    );
  }
  const on = d.choice === "add" || d.choice === "update";
  const checks = checksFor(asProposal(d), ctx);
  const decisions = checks.filter((c) => c.decide);
  const notes = checks.filter((c) => !c.decide);
  const plainToggle = !d.dup && decisions.length === 0;
  return (
    <Card className={cx("flex flex-col gap-2", !on && d.choice !== "undecided" && "opacity-70")} tone={d.kind === "holiday" ? "care" : d.kind === "trip" ? "family" : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cx("text-ink", d.role === "event" ? "font-display text-xl leading-snug" : "font-medium")}>{d.title || "Untitled"}</p>
          <p className="text-sm text-ink-2">{whenOf(d)}</p>
          {d.arriveBy && !d.allDay && <p className="text-sm text-ink-2">Arrive by {d.arriveBy}</p>}
          {d.location && <p className="text-sm text-ink-2">At {d.location}</p>}
          {d.details && <p className="text-sm text-ink-2">{d.details}</p>}
          {d.repeat && <p className="text-sm text-ink-2">Repeats {d.repeat}{d.repeatUntil ? ` until ${fmtDate(d.repeatUntil)}` : ""}</p>}
        </div>
        <Badge tone={badgeTone(d)}>{badgeOf(d)}</Badge>
      </div>

      {d.dup && d.dup.status !== "new" && (
        <p className="flex items-start gap-2 text-sm text-ink-2">
          <Info aria-hidden size={16} className="mt-0.5 shrink-0" /> {dupLine(d)}
        </p>
      )}
      {notes.length > 0 && (
        <ul className="flex flex-col gap-1">
          {notes.map((c) => (
            <li key={c.code} className="flex items-start gap-2 text-sm text-ink-3">
              <Info aria-hidden size={16} className="mt-0.5 shrink-0" /> {c.text}
            </li>
          ))}
        </ul>
      )}

      {d.dup?.status === "added" ? null : plainToggle ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Checkbox checked={on} onChange={(v) => onChange({ choice: v ? "add" : "skip", open: v && d.open })} label={on ? "Add this" : "Leave this out"} hint={d.past ? "This date has passed." : undefined} />
          {on && (
            <Button variant="ghost" size="sm" aria-expanded={d.open} onClick={() => onChange({ open: !d.open })}>
              {d.open ? "Done" : "Change details"}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented label={`What to do with ${d.title || "this"}`} value={d.choice} onChange={(choice) => onChange({ choice })} options={choicesFor(d)} />
          {on && (
            <Button variant="ghost" size="sm" aria-expanded={d.open} onClick={() => onChange({ open: !d.open })}>
              {d.open ? "Done" : "Change details"}
            </Button>
          )}
        </div>
      )}

      {on &&
        decisions.map((c) => (
          <div key={c.code} className={cx("flex flex-col gap-2 rounded-lg border p-3", answered(d, c) ? "border-line" : "border-warn/50")}>
            <p className="flex items-start gap-2 text-sm text-ink">
              {answered(d, c) ? <Check aria-hidden size={16} className="mt-0.5 shrink-0 text-good" /> : <AlertTriangle aria-hidden size={16} className="mt-0.5 shrink-0 text-warn" />}
              {c.text}
            </p>
            {c.code === "pickup" && (
              <>
                <Segmented
                  label="Who collects"
                  value={d.collect ?? ("" as "me")}
                  onChange={(collect) => onChange({ collect })}
                  options={[{ value: "me" as const, label: "I'll collect" }, ...(app.partner ? [{ value: "partner" as const, label: `Ask ${app.partner.displayName} to collect` }] : []), { value: "none" as const, label: "Not decided yet" }]}
                />
                {d.collect === "partner" && app.partner && (
                  <p className="text-sm text-ink-3">{app.partner.displayName} gets a request in Jobs. Until they agree, the collection shows as asked, not arranged.</p>
                )}
                {d.collect === "none" && <p className="text-sm text-ink-3">The collection goes in Jobs with nobody on it yet, so it stays in sight.</p>}
              </>
            )}
            {c.code === "payment" && (
              <Segmented
                label="Who pays"
                value={d.owner ?? ("" as "me")}
                onChange={(owner) => onChange({ owner })}
                options={[{ value: "me" as const, label: "I'll pay" }, ...(app.partner ? [{ value: "partner" as const, label: `${app.partner.displayName} pays` }] : []), { value: "none" as const, label: "Not decided yet" }]}
              />
            )}
            {c.code === "which_child" && <PeoplePicker label="Which child" showAdults={false} adultIds={[]} childIds={d.childIds} onChange={(v) => onChange({ childIds: v.childIds })} />}
            {c.code === "date_unclear" && <Checkbox checked={!!d.confirmed.date_unclear} onChange={(v) => onChange({ confirmed: { ...d.confirmed, date_unclear: v }, open: true })} label="I've checked the date" />}
            {c.code === "not_in_letter" && (
              <>
                <blockquote className="border-l-2 border-line pl-3 text-sm italic text-ink-3">&ldquo;{d.source}&rdquo;</blockquote>
                <Checkbox checked={!!d.confirmed.not_in_letter} onChange={(v) => onChange({ confirmed: { ...d.confirmed, not_in_letter: v } })} label="I've checked it against the letter" />
              </>
            )}
          </div>
        ))}

      {failed && <p className="text-sm text-bad">{failed} Nothing was added yet; change this card or leave it out, then add again.</p>}
      {on && (d.open || !!failed || !valid(d)) && (
        <>
          <blockquote className="border-l-2 border-line pl-3 text-sm italic text-ink-3">&ldquo;{d.source}&rdquo;</blockquote>
          {d.role !== "deadline" && (
            <Segmented label="Add as" value={d.kind} onChange={(kind) => onChange({ kind })} options={(Object.keys(KIND_LABEL) as ProposalKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
          )}
          <Field label="What">{(id) => <input id={id} className={inputClass} value={d.title} maxLength={80} onChange={(e) => onChange({ title: e.target.value })} />}</Field>
          {d.kind === "event" && <Checkbox checked={d.allDay} onChange={(allDay) => onChange({ allDay })} label={d.role === "deadline" ? "Any time that day" : "All day"} />}
          <div className="grid grid-cols-2 gap-3">
            <Field label={d.role === "deadline" ? "Due on" : d.kind === "event" && !d.allDay ? "Date" : "From"}>
              {(id) => <input id={id} type="date" className={inputClass} value={d.startDate} onChange={(e) => onChange({ startDate: e.target.value, endDate: d.endDate < e.target.value || d.endDate === d.startDate ? e.target.value : d.endDate })} />}
            </Field>
            {d.role !== "deadline" && (
              <Field label={d.kind === "event" && !d.allDay ? "Ends on" : "Last day"}>
                {(id) => <input id={id} type="date" className={inputClass} min={d.startDate} value={d.endDate} onChange={(e) => onChange({ endDate: e.target.value })} />}
              </Field>
            )}
            {d.role === "deadline" && !d.allDay && (
              <Field label="Due by">{(id) => <input id={id} type="time" className={inputClass} value={d.startTime} onChange={(e) => onChange({ startTime: e.target.value })} />}</Field>
            )}
            {d.role !== "deadline" && (d.kind === "trip" || (d.kind === "event" && !d.allDay)) && (
              <>
                <Field label={d.kind === "trip" ? "Leaving at" : "Starts"}>{(id) => <input id={id} type="time" className={inputClass} value={d.startTime} onChange={(e) => onChange({ startTime: e.target.value })} />}</Field>
                <Field label={d.kind === "trip" ? "Back at" : "Ends"}>{(id) => <input id={id} type="time" className={inputClass} value={d.endTime} onChange={(e) => onChange({ endTime: e.target.value, endStated: true })} />}</Field>
              </>
            )}
            {d.role !== "deadline" && d.kind === "event" && !d.allDay && (
              <Field label="Arrive by (optional)" error={d.arriveBy && d.arriveBy >= d.startTime ? "Before it starts." : null}>
                {(id) => <input id={id} type="time" className={inputClass} value={d.arriveBy} onChange={(e) => onChange({ arriveBy: e.target.value })} />}
              </Field>
            )}
          </div>
          {d.kind !== "holiday" && (
            <Field label={d.kind === "trip" ? "Where" : "Place"}>{(id) => <input id={id} className={inputClass} value={d.location} maxLength={200} onChange={(e) => onChange({ location: e.target.value })} />}</Field>
          )}
          <Field label="What to bring or pay">{(id) => <input id={id} className={inputClass} value={d.details} maxLength={300} onChange={(e) => onChange({ details: e.target.value })} />}</Field>
          {d.kind === "holiday" ? (
            <>
              <PeoplePicker label="Children off school" showAdults={false} adultIds={[]} childIds={d.childIds} onChange={(v) => onChange({ childIds: v.childIds })} />
              <p className="text-sm text-ink-3">More will show these days as needing someone with the children, 08:30 to 17:30 on weekdays. You can change that in Trips and care.</p>
            </>
          ) : d.role === "deadline" ? (
            <PeoplePicker label="Which child" showAdults={false} adultIds={[]} childIds={d.childIds} onChange={(v) => onChange({ childIds: v.childIds })} />
          ) : (
            <PeoplePicker label={d.kind === "trip" ? "Who's going" : "Who"} adultIds={d.adultIds} childIds={d.childIds} onChange={(v) => onChange({ adultIds: v.adultIds, childIds: v.childIds })} />
          )}
          {d.kind === "event" && d.role !== "deadline" && app.adults.length > 1 && (
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
  if (jobKind(d)) return "Job";
  if (d.pickupChange) return "Pickup";
  if (d.role === "optional") return "Maybe";
  return "Event";
}

function badgeTone(d: Draft): "neutral" | "warn" | "care" | "family" | "us" {
  if (d.kind === "holiday") return "care";
  if (d.kind === "trip") return "family";
  if (d.role === "deadline" || d.pickupChange) return "warn";
  if (d.role === "optional") return "neutral";
  return "us";
}

/** "Mon 26 Oct to Fri 30 Oct, all day", "Due by Mon 12 Oct at 12:00". */
function whenOf(d: Draft): string {
  const days = d.endDate > d.startDate ? `${fmtDate(d.startDate)} to ${fmtDate(d.endDate)}` : fmtDate(d.startDate);
  if (d.kind === "holiday") return `${days}, all day`;
  if (d.role === "deadline") return d.allDay ? `Due by ${fmtDate(d.startDate)}` : `Due by ${fmtDate(d.startDate)} at ${d.startTime}`;
  if (d.kind === "trip") return `${fmtDate(d.startDate)} ${d.startTime} to ${fmtDate(d.endDate)} ${d.endTime}`;
  if (d.allDay) return `${days}, all day`;
  const end = d.endStated ? d.endTime : `about ${d.endTime}`;
  return d.endDate > d.startDate ? `${fmtDate(d.startDate)} ${d.startTime} to ${fmtDate(d.endDate)} ${end}` : `${days}, ${d.startTime} to ${end}`;
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

