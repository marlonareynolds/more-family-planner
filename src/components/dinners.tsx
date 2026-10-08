"use client";

import { ShoppingBasket, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { DinnerChoice, DinnerRole } from "@/domain/meals";
import type { DinnerView, MealView, MealsView, ShoppingLine } from "@/server/queries/meals";
import { useApp } from "./app-context";
import { fmtDate } from "./format";
import { Badge, Button, Card, Checkbox, ChoiceCard, Dialog, ErrorNote, Field, SectionTitle, inputClass } from "./ui";
import { useCommand } from "./use-command";

/**
 * Dinners on Our Week: pick one evening or all seven, from your own saved
 * meals, the quick fallback, leftovers, eating elsewhere or "decide later".
 * A dinner reserves nobody's evening; cooking and clearing up are jobs,
 * asked and agreed like any other.
 */
export function DinnerPlanner({ data, days }: { data: MealsView; days: string[] }) {
  const [choosing, setChoosing] = useState<string | null>(null);
  const [meals, setMeals] = useState(false);
  const byDate = new Map(data.dinners.map((d) => [d.date, d]));
  return (
    <section id="dinners" aria-labelledby="dinners-title">
      <SectionTitle
        hint="Start with one hard evening if that's all you need. Nothing here books anyone's time."
        action={<Button size="sm" variant="ghost" onClick={() => setMeals(true)}>Our meals</Button>}
      >
        <span id="dinners-title">Dinners</span>
      </SectionTitle>
      <Card>
        <ul className="divide-y divide-line">
          {days.map((date) => {
            const d = byDate.get(date);
            return (
              <li key={date} className="py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold uppercase tracking-wide text-ink-3">{date === data.today ? "Tonight · " : ""}{fmtDate(date)}</p>
                    <p className={d && d.choice !== "later" ? "font-medium" : "text-ink-3"}>{d ? d.label : date < data.today ? "–" : "Not chosen"}</p>
                  </div>
                  {date >= data.today && (
                    <Button size="sm" variant={d ? "ghost" : "secondary"} onClick={() => setChoosing(date)} aria-label={`${d ? "Change" : "Choose"} dinner for ${date === data.today ? "tonight" : fmtDate(date)}`}>
                      {d ? "Change" : "Choose"}
                    </Button>
                  )}
                </div>
                {d && date >= data.today && <DinnerJobs dinner={d} />}
              </li>
            );
          })}
        </ul>
      </Card>
      {choosing && <DinnerDialog date={choosing} dinner={byDate.get(choosing)} meals={data.meals} days={days} taken={new Set(data.dinners.filter((d) => d.choice !== "later").map((d) => d.date))} today={data.today} onClose={() => setChoosing(null)} onMeals={() => { setChoosing(null); setMeals(true); }} />}
      {meals && <MealsDialog meals={data.meals} onClose={() => setMeals(false)} />}
    </section>
  );
}

const ROLE: Record<DinnerRole, string> = { cook: "Cooking", clear: "Clearing up" };

/** Who cooks and who clears up: each a job, so an ask stays an ask until it's answered. */
function DinnerJobs({ dinner }: { dinner: DinnerView }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const roles: DinnerRole[] = dinner.choice === "elsewhere" || dinner.choice === "later" ? [] : ["cook", "clear"];
  if (!roles.length) return null;
  const partner = app.partner;
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {roles.map((role) => {
        const j = dinner.jobs.find((x) => x.role === role);
        const who = !j
          ? "Nobody yet"
          : j.ownerId
            ? j.ownerId === app.me.id ? "You" : app.nameOf(j.ownerId)
            : j.proposedOwnerId === app.me.id
              ? "You've been asked"
              : `Asked ${app.nameOf(j.proposedOwnerId!)}, not yet agreed`;
        return (
          <div key={role} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-ink-2">{ROLE[role]}: <span className={j?.ownerId ? "text-ink" : "text-ink-3"}>{who}</span></span>
            <span className="flex flex-wrap gap-1.5">
              {!j && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("DinnerJob", { dinnerId: dinner.id, role, owner: "me" })}>I&apos;ll do it</Button>}
              {!j && partner && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("DinnerJob", { dinnerId: dinner.id, role, owner: "partner" })}>Ask {partner.displayName}</Button>}
              {j && !j.ownerId && j.proposedOwnerId === app.me.id && (
                <>
                  <Button size="sm" variant="primary" disabled={pending} onClick={() => run("AnswerJobOwner", { jobId: j.jobId, version: j.version, accept: true })}>Yes, I&apos;ll do it</Button>
                  <Button size="sm" disabled={pending} onClick={() => run("AnswerJobOwner", { jobId: j.jobId, version: j.version, accept: false })}>Not this time</Button>
                </>
              )}
              {j && !j.ownerId && !j.proposedOwnerId && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("ProposeJobOwner", { jobId: j.jobId, version: j.version, to: "me" })}>I&apos;ll do it</Button>}
            </span>
          </div>
        );
      })}
      <ErrorNote message={error?.message} />
    </div>
  );
}

const CHOICES: { value: DinnerChoice; label: string; hint: string }[] = [
  { value: "meal", label: "One of our meals", hint: "Its ingredients go on the shopping list." },
  { value: "fallback", label: "The quick fallback", hint: "For an evening with no energy left." },
  { value: "leftovers", label: "Leftovers", hint: "Someone still heats them up." },
  { value: "elsewhere", label: "Eating elsewhere", hint: "At Gran's, a party, a takeaway out." },
  { value: "later", label: "Decide later", hint: "Keep the evening open for now." },
];

function DinnerDialog({ date, dinner, meals, days, taken, today, onClose, onMeals }: { date: string; dinner?: DinnerView; meals: MealView[]; days: string[]; taken: Set<string>; today: string; onClose: () => void; onMeals: () => void }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const quick = meals.filter((m) => m.quick);
  const [choice, setChoice] = useState<DinnerChoice>(dinner?.choice ?? (meals.length ? "meal" : "later"));
  const [mealId, setMealId] = useState<string | null>(dinner?.mealId ?? null);
  const [note, setNote] = useState(dinner?.note ?? "");
  const [moveTo, setMoveTo] = useState(date);
  const chosenMeal = choice === "meal" ? mealId : choice === "fallback" ? (quick.some((m) => m.id === mealId) ? mealId : (quick[0]?.id ?? null)) : null;
  const ready = (choice !== "meal" && choice !== "fallback") || !!chosenMeal;

  async function save() {
    if (dinner && moveTo !== date) {
      if (!(await run("MoveDinner", { dinnerId: dinner.id, version: dinner.version, toDate: moveTo }))) return;
      onClose();
      return;
    }
    if (await run("SetDinner", { date, version: dinner?.version ?? null, choice, mealId: chosenMeal, note: choice === "elsewhere" ? note : "" })) onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Dinner, ${fmtDate(date)}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={pending || !ready} onClick={save}>Save</Button></>}
    >
      <div className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">What&apos;s for dinner</legend>
          {CHOICES.map((c) => (
            <ChoiceCard key={c.value} name="dinner-choice" checked={choice === c.value} onChange={() => setChoice(c.value)}>
              <span className="block font-medium">{c.label}</span>
              <span className="block text-sm text-ink-3">{c.hint}</span>
            </ChoiceCard>
          ))}
        </fieldset>
        {choice === "meal" && (
          meals.length ? (
            <Field label="Which meal">
              {(id) => (
                <select id={id} className={inputClass} value={mealId ?? ""} onChange={(e) => setMealId(e.target.value || null)}>
                  <option value="">Pick one</option>
                  {meals.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              )}
            </Field>
          ) : (
            <p className="text-sm text-ink-2">No meals saved yet. <button type="button" className="text-brand underline" onClick={onMeals}>Add your usual ones</button>.</p>
          )
        )}
        {choice === "fallback" && (
          quick.length > 1 ? (
            <Field label="Which quick meal">
              {(id) => (
                <select id={id} className={inputClass} value={chosenMeal ?? ""} onChange={(e) => setMealId(e.target.value)}>
                  {quick.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              )}
            </Field>
          ) : quick.length === 1 ? (
            <p className="text-sm text-ink-2">{quick[0].name}</p>
          ) : (
            <p className="text-sm text-ink-2">Mark one of <button type="button" className="text-brand underline" onClick={onMeals}>your meals</button> as quick to use it here.</p>
          )
        )}
        {choice === "elsewhere" && <Field label="Where (optional)">{(id) => <input id={id} maxLength={80} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="At Gran's" />}</Field>}
        {dinner && (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <Field label="Move to another day" hint="Whoever agreed to cook or clear up is asked again for the new day.">
              {(id, d) => (
                <select id={id} aria-describedby={d} className={inputClass} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                  {days.filter((x) => x === date || (!taken.has(x) && x >= today)).map((x) => <option key={x} value={x}>{fmtDate(x)}</option>)}
                </select>
              )}
            </Field>
            <Button size="sm" variant="ghost" disabled={pending} onClick={async () => { if (await run("RemoveDinner", { dinnerId: dinner.id, version: dinner.version })) onClose(); }}>Take dinner off this day</Button>
          </div>
        )}
        <ErrorNote message={error?.message} />
      </div>
    </Dialog>
  );
}

function MealsDialog({ meals, onClose }: { meals: MealView[]; onClose: () => void }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [editing, setEditing] = useState<MealView | "new" | null>(meals.length ? null : "new");
  const [name, setName] = useState("");
  const [ingredients, setIngredients] = useState("");
  const [quick, setQuick] = useState(false);

  function open(m: MealView | "new") {
    setEditing(m);
    setName(m === "new" ? "" : m.name);
    setIngredients(m === "new" ? "" : m.ingredients.join("\n"));
    setQuick(m === "new" ? false : m.quick);
  }
  async function save() {
    const list = ingredients.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
    const m = editing === "new" ? null : editing;
    if (await run("SaveMeal", { mealId: m?.id ?? null, version: m?.version ?? null, name, ingredients: list, quick })) setEditing(null);
  }

  return (
    <Dialog open onClose={onClose} title="Our meals">
      {editing ? (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <Field label="Meal">{(id) => <input id={id} required maxLength={60} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Fish pie" />}</Field>
          <Field label="What to buy for it (optional)" hint="One per line, or separated by commas. Only what you'd need to buy.">
            {(id, d) => <textarea id={id} aria-describedby={d} rows={4} className={`${inputClass} py-2`} value={ingredients} onChange={(e) => setIngredients(e.target.value)} />}
          </Field>
          <Checkbox checked={quick} onChange={setQuick} label="Quick enough for a hard evening" hint="Offered as the fallback." />
          <ErrorNote message={error?.message} />
          <div className="flex flex-wrap justify-between gap-2">
            {editing !== "new" ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={async () => { if (await run("ArchiveMeal", { mealId: editing.id, version: editing.version })) setEditing(null); }}>Remove meal</Button> : <span />}
            <span className="flex gap-2">
              {meals.length > 0 && <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Back</Button>}
              <Button type="submit" variant="primary" disabled={pending || !name.trim()}>Save meal</Button>
            </span>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="divide-y divide-line">
            {meals.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block font-medium">{m.name}{m.quick && <span className="ml-2 align-middle"><Badge>Quick</Badge></span>}</span>
                  {m.ingredients.length > 0 && <span className="block truncate text-sm text-ink-3">{m.ingredients.join(", ")}</span>}
                </span>
                <Button size="sm" variant="ghost" onClick={() => open(m)}>Edit</Button>
              </li>
            ))}
          </ul>
          <Button onClick={() => open("new")}>+ Add a meal</Button>
        </div>
      )}
    </Dialog>
  );
}

/** The shared list: dinners' ingredients plus anything added by hand. */
export function ShoppingList({ lines }: { lines: ShoppingLine[] }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [item, setItem] = useState("");
  const got = lines.filter((l) => l.got).length;
  return (
    <section id="shopping" aria-labelledby="shopping-title">
      <SectionTitle action={got > 0 ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("ClearShoppingGot", {})}>Clear ticked</Button> : undefined}>
        <span id="shopping-title">Shopping list</span>
      </SectionTitle>
      <Card>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (item.trim() && (await run("AddShoppingItem", { name: item }))) setItem("");
          }}
        >
          <label htmlFor="shopping-add" className="sr-only">Add to the list</label>
          <input id="shopping-add" maxLength={60} className={inputClass} value={item} onChange={(e) => setItem(e.target.value)} placeholder="Add something" />
          <Button type="submit" disabled={pending || !item.trim()}>Add</Button>
        </form>
        {lines.length === 0 ? (
          <p className="mt-3 text-sm text-ink-3">Nothing on the list. Ingredients appear here when you choose a dinner.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {lines.map((l) => <ShoppingRow key={`${l.itemKey}:${l.got}`} line={l} />)}
          </ul>
        )}
        <ErrorNote message={error?.message} />
      </Card>
    </section>
  );
}

/** One line, ticked at once on the phone; the server's answer follows. */
function ShoppingRow({ line: l }: { line: ShoppingLine }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [got, setGot] = useState(l.got);
  return (
    <li className="py-1">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            className="size-5 accent-[var(--brand)]"
            checked={got}
            onChange={async (e) => {
              const next = e.target.checked;
              setGot(next);
              if (!(await run("SetShoppingGot", { itemKey: l.itemKey, got: next }))) setGot(!next);
            }}
          />
          <span className={got ? "text-ink-3 line-through" : ""}>
            {l.name}
            {l.forDates.length > 0 && <span className="ml-2 text-xs text-ink-3">for {l.forDates.map((d) => fmtDate(d).split(" ")[0]).join(", ")}</span>}
          </span>
        </label>
        {l.byHand && !got && l.forDates.length === 0 && (
          <Button size="sm" variant="ghost" disabled={pending} aria-label={`Remove ${l.name}`} onClick={() => run("RemoveShoppingItem", { itemKey: l.itemKey })}>Remove</Button>
        )}
      </div>
      <ErrorNote message={error?.message} />
    </li>
  );
}

/** Tonight's dinner on Today, with the fallback one tap away. */
export function TonightDinner({ data }: { data: MealsView }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const d = data.dinners.find((x) => x.date === data.today);
  const quick = data.meals.find((m) => m.quick);
  const toBuy = data.shopping.filter((l) => !l.got).length;
  if (!d && !data.meals.length && !toBuy) return null;
  const undecided = !d || d.choice === "later";
  return (
    <Card className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <UtensilsCrossed aria-hidden size={20} className="shrink-0 text-ink-3" />
          <div className="min-w-0">
            <p className="font-medium">Tonight&apos;s dinner: {undecided ? "not decided" : d.label}</p>
            {!undecided && (
              <p className="text-sm text-ink-3">
                {d.jobs.find((j) => j.role === "cook")?.ownerId
                  ? `${d.choice === "leftovers" ? "Heating up" : "Cooking"}: ${d.jobs.find((j) => j.role === "cook")!.ownerId === app.me.id ? "you" : app.nameOf(d.jobs.find((j) => j.role === "cook")!.ownerId!)}`
                  : d.choice === "elsewhere" ? "Nobody needs to cook." : "Nobody has agreed to cook yet."}
              </p>
            )}
          </div>
        </div>
        <span className="flex flex-wrap gap-2">
          {undecided && quick && (
            <Button size="sm" variant="primary" disabled={pending} onClick={() => run("SetDinner", { date: data.today, version: d?.version ?? null, choice: "fallback", mealId: quick.id })}>{quick.name}</Button>
          )}
          {undecided && <Button size="sm" disabled={pending} onClick={() => run("SetDinner", { date: data.today, version: d?.version ?? null, choice: "leftovers" })}>Leftovers</Button>}
          <Link href="/week#dinners" className="inline-flex min-h-9 items-center rounded-full px-3 text-sm text-brand underline">{undecided ? "Choose" : "Change"}</Link>
        </span>
      </div>
      {toBuy > 0 && (
        <Link href="/week#shopping" className="mt-2 inline-flex items-center gap-2 text-sm text-ink-2 underline">
          <ShoppingBasket aria-hidden size={16} />
          {toBuy} thing{toBuy === 1 ? "" : "s"} on the shopping list
        </Link>
      )}
      <ErrorNote message={error?.message} />
    </Card>
  );
}
