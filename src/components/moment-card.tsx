"use client";

import { useState } from "react";
import type { ExpenseView, MomentView } from "@/server/queries/week";
import { useApp, useNow } from "./app-context";
import { fmtDateTime, fmtMoney, fmtRange, fmtTime, localParts, minorToInput, toMinor } from "./format";
import { DATE_NIGHT_KEY, menuFromNotes } from "@/lib/date-night";
import { AskHelperDialog } from "./ask-helper";
import { MenuCard } from "./date-night";
import { MomentEditor } from "./moment-editor";
import { PlaceEditor } from "./places";
import { Badge, Button, Card, Checkbox, Dialog, ErrorNote, Field, inputClass } from "./ui";
import { useCommand } from "./use-command";

const MISSING_TEXT: Record<string, string> = {
  AGREEMENT: "waiting for agreement",
  CARE: "childcare not covered",
  PREPARATION: "tasks to do",
  CONFLICT: "clashes with the diary",
};

const DECISION_TEXT = { accepted: "said yes", alternative: "asked for another time", declined: "can't make it" } as const;

export function MomentCard({ moment: m, expense, compact = false }: { moment: MomentView; expense?: ExpenseView | null; compact?: boolean }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [editing, setEditing] = useState(false);
  const [reflecting, setReflecting] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskOwner, setTaskOwner] = useState(app.me.id);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [asking, setAsking] = useState(false);
  const [savingPlace, setSavingPlace] = useState(false);
  // A good outing can become one of the household's places in one tap.
  const placeName = (m.location || m.title).split(",")[0].trim();
  const canSavePlace =
    m.lifecycle === "completed" && !m.detailsHidden && !m.activityKey?.startsWith("place:") && !!placeName &&
    !app.places.some((p) => p.name.toLowerCase() === placeName.toLowerCase());

  const now = useNow();
  // A date night invitation opens as its painted menu.
  const menu = m.activityKey === DATE_NIGHT_KEY && !m.detailsHidden ? menuFromNotes(m.notes) : null;
  const tone = m.momentKind;
  const awaitingMe = m.lifecycle === "planned" && m.sharing === "shared" && m.participantIds.includes(app.me.id) && m.myDecision !== "accepted";
  const iAmIn = m.participantIds.includes(app.me.id) || m.organiserId === app.me.id;
  const past = m.end <= now;
  const date = localParts(m.start, app.timeZone).date;
  const stageTone = m.lifecycle === "cancelled" ? "neutral" : m.stage === "Arrangements ready" || m.lifecycle === "completed" ? "good" : m.stage === "Private draft" ? "neutral" : "warn";

  return (
    <Card tone={tone} className={m.lifecycle === "cancelled" ? "opacity-60" : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-ink-3">{compact ? fmtRange(m.start, m.end, app.timeZone) : fmtDateTime(m.start, app.timeZone) + ` to ${fmtTime(m.end, app.timeZone)}`}</p>
          <h3 className="text-[17px] font-semibold leading-snug">{m.title}</h3>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge tone={tone}>{m.momentKind === "me" ? "Me" : m.momentKind === "us" ? "Us" : "Family"}</Badge>
          {m.ritualId && <Badge>Repeats</Badge>}
          {m.chosenByChildId && <Badge tone="family">{app.childName(m.chosenByChildId)}&apos;s pick</Badge>}
          <Badge tone={stageTone}>{m.stage}</Badge>
        </div>
      </div>

      {m.review === "needs_review" && m.lifecycle !== "cancelled" && (
        <p className="mt-2 rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">Needs a look: {m.reviewReason ?? "something changed"}.</p>
      )}

      {!compact && (
        <div className="mt-3 space-y-2 text-sm text-ink-2">
          {menu ? (
            <div className="-mx-1 my-1"><MenuCard compact menu={{ ...menu, location: m.location || undefined }} when={fmtDateTime(m.start, app.timeZone)} from={app.adults.find((a) => a.id === m.organiserId)?.displayName ?? "you"} /></div>
          ) : (
            <>
              {m.location && <p>📍 {m.location}</p>}
              {m.notes && <p className="whitespace-pre-line">{m.notes}</p>}
            </>
          )}
          {(m.travelBeforeMinutes > 0 || m.travelAfterMinutes > 0) && (
            <p>Travel: {m.travelBeforeMinutes} min before, {m.travelAfterMinutes} min after</p>
          )}
          {m.momentKind !== "me" && m.sharing === "shared" && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {m.participantIds.map((p) => (
                <li key={p}>
                  {app.nameOf(p)} {m.decisions[p] ? DECISION_TEXT[m.decisions[p]!] : p === app.me.id ? "haven't answered" : "hasn't answered"}
                </li>
              ))}
            </ul>
          )}
          {m.childIds.length > 0 && <p>With {m.childIds.map(app.childName).join(", ")}</p>}
          {m.needsCare && (
            <p>
              Childcare:{" "}
              <strong className={m.careState === "covered" ? "text-good" : "text-warn"}>
                {m.careState === "covered" ? "covered" : m.careState === "partly_covered" ? "partly covered" : "not arranged yet"}
              </strong>
              {m.careState !== "covered" && m.lifecycle !== "cancelled" && !past && (
                <>
                  {app.helpers.length > 0 && <button className="ml-2 text-brand underline" onClick={() => setAsking(true)}>Ask {app.helpers[0].name}{app.helpers.length > 1 ? " or others" : ""}</button>}
                  <a href={`/holidays?date=${date}`} className="ml-2 text-brand underline">Arrange</a>
                </>
              )}
            </p>
          )}
          {m.budgetMinor !== null && <p>Spending limit {fmtMoney(m.budgetMinor)}{expense ? ` · paid ${fmtMoney(expense.netPaidMinor)}` : ""}</p>}
          {m.conflicts.length > 0 && (
            <ul className="rounded-xl bg-bad/10 px-3 py-2 text-bad">
              {m.conflicts.map((c, i) => (
                <li key={i}>
                  {c.personId ? app.nameOf(c.personId) : "Someone"} {c.personId === app.me.id ? "are" : "is"} busy {fmtRange(c.start, c.end, app.timeZone)}
                  {c.title ? ` (${c.title})` : ""}
                </li>
              ))}
            </ul>
          )}
          {!m.ready && m.lifecycle === "planned" && m.missing.length > 0 && <p className="text-ink-3">Still to sort: {m.missing.map((x) => MISSING_TEXT[x]).join(", ")}.</p>}
        </div>
      )}

      {!compact && m.lifecycle !== "cancelled" && m.sharing === "shared" && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-2 text-sm font-medium text-ink-2">Preparation</p>
          <ul className="space-y-2">
            {m.tasks.map((t) => (
              <li key={t.id}>
                {t.ownerId === app.me.id ? (
                  <Checkbox checked={t.state === "done"} onChange={(done) => run("SetTaskDone", { taskId: t.id, version: t.version, done })} label={t.title} />
                ) : (
                  <p className="text-[15px]">
                    <span aria-hidden>{t.state === "done" ? "☑" : "☐"}</span> {t.title} <span className="text-ink-3">({app.nameOf(t.ownerId)})</span>
                  </p>
                )}
              </li>
            ))}
          </ul>
          {m.lifecycle === "planned" && !past && (
            <form
              className="mt-2 flex flex-wrap gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!taskTitle.trim()) return;
                if (await run("AddTask", { momentId: m.id, title: taskTitle, ownerId: taskOwner })) setTaskTitle("");
              }}
            >
              <label className="sr-only" htmlFor={`task-${m.id}`}>New task</label>
              <input id={`task-${m.id}`} className={`${inputClass} min-h-9 flex-1 text-sm`} placeholder="Add a task, like book a table" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
              <label className="sr-only" htmlFor={`owner-${m.id}`}>Who</label>
              <select id={`owner-${m.id}`} className={`${inputClass} min-h-9 w-auto text-sm`} value={taskOwner} onChange={(e) => setTaskOwner(e.target.value)}>
                {app.adults.map((a) => <option key={a.id} value={a.id}>{a.id === app.me.id ? "Me" : a.displayName}</option>)}
              </select>
              <Button size="sm" type="submit" disabled={pending}>Add</Button>
            </form>
          )}
        </div>
      )}

      {!compact && m.lifecycle === "completed" && (m.participantIds.includes(app.me.id) || m.momentKind === "family") && !m.detailsHidden && (
        <Highlights moment={m} />
      )}

      <ErrorNote message={error?.message} />

      {!compact && iAmIn && (
        <div className="mt-3 flex flex-wrap gap-2">
          {awaitingMe && (
            <>
              <Button size="sm" variant="primary" disabled={pending} onClick={() => run("RespondToMoment", { momentId: m.id, materialVersion: m.materialVersion, decision: "accepted" })}>Yes, let&apos;s do it</Button>
              <Button size="sm" disabled={pending} onClick={() => run("RespondToMoment", { momentId: m.id, materialVersion: m.materialVersion, decision: "alternative" })}>Another time</Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("RespondToMoment", { momentId: m.id, materialVersion: m.materialVersion, decision: "declined" })}>Can&apos;t make it</Button>
            </>
          )}
          {m.lifecycle === "draft" && m.organiserId === app.me.id && (
            <Button size="sm" variant="primary" disabled={pending} onClick={() => run("ShareMoment", { momentId: m.id, version: m.version })}>
              {m.momentKind === "me" ? "Protect this time" : "Invite"}
            </Button>
          )}
          {(m.lifecycle === "draft" || m.lifecycle === "planned") && !m.detailsHidden && <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>}
          {m.lifecycle === "planned" && past && <Button size="sm" variant="primary" onClick={() => run("CompleteMoment", { momentId: m.id, version: m.version })}>It happened</Button>}
          {m.lifecycle === "completed" && !m.myFeedbackSaved && <Button size="sm" variant="primary" onClick={() => setReflecting(true)}>Reflect privately</Button>}
          {canSavePlace && <Button size="sm" variant="ghost" onClick={() => setSavingPlace(true)}>Save to our places</Button>}
          {m.lifecycle !== "cancelled" && !m.detailsHidden && <Button size="sm" variant="ghost" onClick={() => setCostOpen(true)}>{expense ? "Costs" : "Add cost"}</Button>}
          {m.lifecycle === "draft" && m.organiserId === app.me.id && (
            <Button size="sm" variant="ghost" onClick={() => run("DeleteDraft", { momentId: m.id, version: m.version })}>Delete draft</Button>
          )}
          {m.lifecycle === "planned" && !past && (
            confirmCancel ? (
              <span className="flex items-center gap-2 text-sm">
                {m.ritualId ? "Skip just this date? The rest stay." : "Cancel this plan? Payments are kept."}
                <Button size="sm" variant="danger" onClick={() => run("CancelMoment", { momentId: m.id, version: m.version })}>{m.ritualId ? "Skip it" : "Cancel plan"}</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>Keep</Button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(true)}>{m.ritualId ? "Skip this date…" : "Cancel…"}</Button>
            )
          )}
        </div>
      )}

      {editing && <MomentEditor open onClose={() => setEditing(false)} moment={m} defaultDate={date} />}
      {reflecting && <ReflectDialog moment={m} onClose={() => setReflecting(false)} />}
      {savingPlace && (
        <PlaceEditor
          place={null}
          initial={{ name: placeName, area: m.location.split(",").slice(1).join(",").trim(), kinds: [m.momentKind], typicalCostMinor: m.budgetMinor ?? 0, durationMinutes: Math.min(1440, Math.max(15, Math.round((m.end - m.start) / 60_000))) }}
          onClose={() => setSavingPlace(false)}
        />
      )}
      {costOpen && <CostDialog moment={m} expense={expense ?? null} onClose={() => setCostOpen(false)} />}
      {asking && (
        <AskHelperDialog
          childIds={app.children.filter((c) => !m.childIds.includes(c.id)).map((c) => c.id)}
          start={m.start - m.travelBeforeMinutes * 60_000}
          end={m.end + m.travelAfterMinutes * 60_000}
          onClose={() => setAsking(false)}
        />
      )}
    </Card>
  );
}

function YesNo({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <fieldset className="flex items-center justify-between gap-3">
      <legend className="sr-only">{label}</legend>
      <span className="text-[15px]">{label}</span>
      <span className="flex gap-1">
        {([true, false] as const).map((v) => (
          <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onChange(value === v ? null : v)} className={`min-h-9 rounded-full border px-3 text-sm ${value === v ? "border-brand bg-brand-soft text-brand" : "border-line text-ink-2"}`}>
            {v ? "Yes" : "No"}
          </button>
        ))}
      </span>
    </fieldset>
  );
}

/** Private reflection: owned by the account, never shown to the partner. */
function ReflectDialog({ moment, onClose }: { moment: MomentView; onClose: () => void }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [helpful, setHelpful] = useState<boolean | null>(null);
  const [enjoyed, setEnjoyed] = useState<boolean | null>(null);
  const [wantRepeat, setWantRepeat] = useState<boolean | null>(null);
  const [effortOk, setEffortOk] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  return (
    <Dialog
      open
      onClose={onClose}
      title="How was it?"
      footer={
        <>
          <Button onClick={onClose}>Not now</Button>
          <Button variant="primary" disabled={pending} onClick={async () => { if (await run("SaveFeedback", { momentId: moment.id, helpful, enjoyed, wantRepeat, effortOk, note })) onClose(); }}>Save privately</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-3">Only you see these answers. More uses them to suggest better plans without saying who said what.</p>
        <YesNo label="Did it help?" value={helpful} onChange={setHelpful} />
        <YesNo label="Did you enjoy it?" value={enjoyed} onChange={setEnjoyed} />
        <YesNo label="Would you do it again?" value={wantRepeat} onChange={setWantRepeat} />
        <YesNo label="Was the effort worth it?" value={effortOk} onChange={setEffortOk} />
        <Field label="Anything to remember (optional)">{(id) => <textarea id={id} rows={3} className={`${inputClass} py-2`} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <ErrorNote message={error?.message} />
      </div>
    </Dialog>
  );
}

/** One canonical cost per plan, with payments and refunds as separate entries. */
function CostDialog({ moment, expense, onClose }: { moment: MomentView; expense: ExpenseView | null; onClose: () => void }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [estimate, setEstimate] = useState(minorToInput(expense?.estimateMinor ?? moment.budgetMinor));
  const [committed, setCommitted] = useState(minorToInput(expense?.committedMinor));
  const [amount, setAmount] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  async function saveCost() {
    const e = toMinor(estimate);
    const c = toMinor(committed);
    if (Number.isNaN(e) || Number.isNaN(c)) return setLocalError("Enter amounts like 45 or 45.50.");
    setLocalError(null);
    if (expense) await run("UpdateExpense", { expenseId: expense.id, version: expense.version, label: moment.title, estimateMinor: e, committedMinor: c });
    else await run("AddExpense", { label: moment.title, estimateMinor: e, committedMinor: c, sourceType: "moment", sourceId: moment.id });
  }
  async function record(kind: "payment" | "refund") {
    const a = toMinor(amount);
    if (!a || Number.isNaN(a)) return setLocalError("Enter an amount above zero.");
    setLocalError(null);
    if (await run("RecordTransaction", { expenseId: expense!.id, kind, amountMinor: a })) setAmount("");
  }

  return (
    <Dialog open onClose={onClose} title="Costs" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Expected (£)">{(id) => <input id={id} inputMode="decimal" className={inputClass} value={estimate} onChange={(e) => setEstimate(e.target.value)} />}</Field>
          <Field label="Committed (£)" hint="Booked or owed">{(id, d) => <input id={id} aria-describedby={d} inputMode="decimal" className={inputClass} value={committed} onChange={(e) => setCommitted(e.target.value)} />}</Field>
        </div>
        <Button onClick={saveCost} disabled={pending}>{expense ? "Update" : "Save cost"}</Button>
        {expense && (
          <>
            <dl className="grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-3 text-sm">
              <dt>Paid</dt><dd className="text-right">{fmtMoney(expense.paidMinor)}</dd>
              <dt>Refunded</dt><dd className="text-right">{fmtMoney(expense.refundedMinor)}</dd>
              <dt className="font-medium">Net paid</dt><dd className="text-right font-medium">{fmtMoney(expense.netPaidMinor)}</dd>
              {expense.remainingMinor !== null && (<><dt>Still to pay</dt><dd className="text-right">{fmtMoney(expense.remainingMinor)}</dd></>)}
            </dl>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1"><Field label="Amount (£)">{(id) => <input id={id} inputMode="decimal" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field></div>
              <Button disabled={pending} onClick={() => record("payment")}>Record payment</Button>
              <Button variant="ghost" disabled={pending} onClick={() => record("refund")}>Record refund</Button>
            </div>
          </>
        )}
        <ErrorNote message={localError ?? error?.message} />
      </div>
    </Dialog>
  );
}

/** Shared one-liners about a plan that happened: everyone in it sees them. */
function Highlights({ moment: m }: { moment: MomentView }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const mine = m.highlights.find((h) => h.mine);
  const [text, setText] = useState(mine?.text ?? "");
  const [editing, setEditing] = useState(!mine);
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="mb-1 text-sm font-medium text-ink-2">Highlights</p>
      {m.highlights.length > 0 && (
        <ul className="mb-2 space-y-1">
          {m.highlights.map((h) => (
            <li key={h.authorId} className="text-[15px]">
              “{h.text}” <span className="text-sm text-ink-3">{h.mine ? "you" : h.authorName}</span>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run("SaveHighlight", { momentId: m.id, text })) setEditing(false);
          }}
        >
          <label className="sr-only" htmlFor={`hl-${m.id}`}>Your highlight</label>
          <input id={`hl-${m.id}`} className={`${inputClass} min-h-9 flex-1 text-sm`} maxLength={280} placeholder="The best bit, in a line. Everyone in the plan sees it." value={text} onChange={(e) => setText(e.target.value)} />
          <Button size="sm" type="submit" disabled={pending || (!text.trim() && !mine)}>{mine ? "Save" : "Share"}</Button>
        </form>
      ) : (
        <button className="text-sm text-brand underline" onClick={() => setEditing(true)}>Edit your highlight</button>
      )}
      <ErrorNote message={error?.message} />
    </div>
  );
}
