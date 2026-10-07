"use client";

import { MapPin } from "lucide-react";
import { useState } from "react";
import { CATEGORIES, CATEGORY_LABEL, type Category, type Setting } from "@/lib/catalogue";
import type { PlaceView } from "@/lib/places";
import { useApp } from "./app-context";
import { minorToInput, toMinor } from "./format";
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, ErrorNote, Field, Segmented, SectionTitle, inputClass } from "./ui";
import { useCommand } from "./use-command";

const KIND_LABEL = { me: "Me time", us: "The two of us", family: "Family" } as const;
const SETTING_LABEL: Record<Setting, string> = { home: "At home", outdoors: "Outdoors", "out-indoors": "Out, indoors" };

/** Our places: the local spots this family knows and likes. */
export function PlacesBoard() {
  const app = useApp();
  const [editing, setEditing] = useState<PlaceView | "new" | null>(null);
  const [filter, setFilter] = useState<"all" | "me" | "us" | "family">("all");
  const shown = app.places.filter((p) => filter === "all" || p.kinds.includes(filter));
  return (
    <div>
      <h1 className="font-display text-3xl">Our places</h1>
      <p className="mt-1 max-w-prose text-ink-2">
        The café with the good garden, the quiet swim session, the walk that ends at a pub. Places you add here come first in ideas and in each week&apos;s picks, ahead of the general ideas nobody has checked for your area.
      </p>
      <SectionTitle action={<Button size="sm" onClick={() => setEditing("new")}>+ Add a place</Button>}>Saved places</SectionTitle>
      {app.places.length > 0 && (
        <div className="mb-3">
          <Segmented label="Good for" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "us", label: "Us" }, { value: "family", label: "Family" }, { value: "me", label: "Me" }]} />
        </div>
      )}
      {shown.length === 0 ? (
        <EmptyState icon={<MapPin />} tone="family" title={app.places.length ? "None for that yet." : "Your favourite spots live here."} action={<Button variant="primary" onClick={() => setEditing("new")}>Add a place</Button>}>{app.places.length ? "Try another filter, or add one that fits." : "The café with the good highchairs, the walk that tires everyone out. Save two or three and they come first in your ideas."}</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {shown.map((p) => (
            <li key={p.id}>
              <Card className="flex h-full flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">{p.name}</h3>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Edit</Button>
                </div>
                {p.area && <p className="text-sm text-ink-3">{p.area}</p>}
                {p.notes && <p className="text-sm text-ink-2">{p.notes}</p>}
                {p.bookingUrl && <a href={p.bookingUrl} target="_blank" rel="noopener noreferrer" className="w-fit text-sm text-brand underline">Book</a>}
                <p className="mt-auto flex flex-wrap gap-1 pt-2">
                  {p.kinds.map((k) => <Badge key={k} tone={k}>{KIND_LABEL[k]}</Badge>)}
                  <Badge>{CATEGORY_LABEL[p.category]}</Badge>
                </p>
                <p className="text-xs text-ink-3">
                  {p.typicalCostMinor === 0 ? "Free" : `About £${Math.round(p.typicalCostMinor / 100)}`} · {SETTING_LABEL[p.setting].toLowerCase()}
                  {p.stepFree ? " · step-free" : ""}
                  {p.calm ? " · calm" : ""}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {editing && <PlaceEditor place={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

export function PlaceEditor({ place, initial, onClose }: { place: PlaceView | null; initial?: Partial<PlaceView>; onClose: () => void }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const seed = place ?? initial ?? {};
  const [name, setName] = useState(seed.name ?? "");
  const [area, setArea] = useState(seed.area ?? "");
  const [kinds, setKinds] = useState<PlaceView["kinds"]>(seed.kinds ?? ["us"]);
  const [category, setCategory] = useState<Category>(seed.category ?? "food");
  const [setting, setSetting] = useState<Setting>(seed.setting ?? "out-indoors");
  const [notes, setNotes] = useState(seed.notes ?? "");
  const [cost, setCost] = useState(minorToInput(seed.typicalCostMinor ?? null));
  const [hours, setHours] = useState(String((seed.durationMinutes ?? 120) / 60));
  const [stepFree, setStepFree] = useState(seed.stepFree ?? false);
  const [calm, setCalm] = useState(seed.calm ?? false);
  const [bookingUrl, setBookingUrl] = useState(seed.bookingUrl ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  const toggle = (k: PlaceView["kinds"][number]) => setKinds(kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k]);
  async function save() {
    const typicalCostMinor = cost.trim() ? toMinor(cost) : 0;
    if (Number.isNaN(typicalCostMinor) || typicalCostMinor === null) return setLocalError("Enter the cost like 20 or 12.50.");
    const durationMinutes = Math.round(Math.min(24, Math.max(0.25, Number(hours) || 2)) * 60);
    setLocalError(null);
    const fields = { name, area, kinds, category, setting, notes, typicalCostMinor, durationMinutes, stepFree, calm, bookingUrl };
    const ok = place ? await run("UpdatePlace", { placeId: place.id, version: place.version, ...fields }) : await run("AddPlace", fields);
    if (ok) onClose();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={place ? `Edit ${place.name}` : "Add a place"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={pending || !name.trim() || !kinds.length} onClick={save}>Save</Button></>}
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="Name">{(id) => <input id={id} required maxLength={80} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="The Boathouse café" />}</Field>
        <Field label="Area (optional)">{(id) => <input id={id} maxLength={60} className={inputClass} value={area} onChange={(e) => setArea(e.target.value)} placeholder="Guildford" />}</Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Good for</legend>
          <div className="flex flex-wrap gap-3">
            {(["us", "family", "me"] as const).map((k) => <Checkbox key={k} checked={kinds.includes(k)} onChange={() => toggle(k)} label={KIND_LABEL[k]} />)}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind of place">
            {(id) => (
              <select id={id} className={inputClass} value={category} onChange={(e) => setCategory(e.target.value as Category)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
            )}
          </Field>
          <Field label="Setting">
            {(id) => (
              <select id={id} className={inputClass} value={setting} onChange={(e) => setSetting(e.target.value as Setting)}>
                {(Object.keys(SETTING_LABEL) as Setting[]).map((s) => <option key={s} value={s}>{SETTING_LABEL[s]}</option>)}
              </select>
            )}
          </Field>
          <Field label="Usual cost (£)" hint="Leave empty if free.">{(id, d) => <input id={id} aria-describedby={d} inputMode="decimal" className={inputClass} value={cost} onChange={(e) => setCost(e.target.value)} />}</Field>
          <Field label="Usual length (hours)">{(id) => <input id={id} inputMode="decimal" className={inputClass} value={hours} onChange={(e) => setHours(e.target.value.replace(/[^\d.]/g, ""))} />}</Field>
        </div>
        <Field label="Why you like it (optional)">{(id) => <textarea id={id} rows={2} maxLength={300} className={`${inputClass} py-2`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Quiet before 10, good for the little one" />}</Field>
        {setting !== "home" && (
          <Field label="Booking page (optional)" hint="Where you book a table or tickets. It shows as a Book button on plans here.">
            {(id, d) => <input id={id} aria-describedby={d} type="url" inputMode="url" maxLength={500} className={inputClass} value={bookingUrl} onChange={(e) => setBookingUrl(e.target.value)} placeholder="https://…" spellCheck={false} />}
          </Field>
        )}
        <div className="flex flex-wrap gap-4">
          <Checkbox checked={stepFree} onChange={setStepFree} label="Step-free" />
          <Checkbox checked={calm} onChange={setCalm} label="Calm and quiet" />
        </div>
        {place && (
          <div className="border-t border-line pt-3">
            <Button size="sm" variant="ghost" disabled={pending} onClick={async () => { if (await run("ArchivePlace", { placeId: place.id, version: place.version })) onClose(); }}>Remove place</Button>
          </div>
        )}
        <ErrorNote message={localError ?? error?.message} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
