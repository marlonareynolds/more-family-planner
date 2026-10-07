"use client";

import { useState } from "react";
import type { WeekView } from "@/server/queries/week";
import { useApp } from "./app-context";
import { Button, Card, Dialog, ErrorNote, Field, SectionTitle, inputClass } from "./ui";
import { useCommand } from "./use-command";

type Helper = WeekView["helpers"][number];

/** The village: grandparents, sitters, friends who help with the children. */
export function HelpersSettings({ helpers }: { helpers: Helper[] }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [editing, setEditing] = useState<Helper | "new" | null>(null);
  return (
    <section id="helpers">
      <SectionTitle action={<Button size="sm" onClick={() => setEditing("new")}>+ Add a helper</Button>}>People who help</SectionTitle>
      <Card>
        {helpers.length === 0 ? (
          <p className="text-sm text-ink-2">Save the people who look after the children, like grandparents or a sitter. Then you can ask them with one tap when a plan needs cover. They don&apos;t need an account.</p>
        ) : (
          <ul className="divide-y divide-line">
            {helpers.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-medium">{h.name}</span>
                  {h.relation && <span className="text-sm text-ink-3"> · {h.relation}</span>}
                  {!h.phone && <span className="block text-xs text-ink-3">No phone number: asks are shared as a link</span>}
                </span>
                <span className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(h)}>Edit</Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("ArchiveHelper", { helperId: h.id, version: h.version })}>Remove</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <ErrorNote message={error?.message} />
        <p className="mt-2 text-xs text-ink-3">Numbers stay in your household and are only used to open a text message on your own phone.</p>
      </Card>
      {editing && <HelperEditor helper={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function HelperEditor({ helper, onClose }: { helper: Helper | null; onClose: () => void }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [name, setName] = useState(helper?.name ?? "");
  const [relation, setRelation] = useState(helper?.relation ?? "");
  const [phone, setPhone] = useState(helper?.phone ?? "");
  async function save() {
    const ok = helper
      ? await run("UpdateHelper", { helperId: helper.id, version: helper.version, name, relation, phone })
      : await run("AddHelper", { name, relation, phone });
    if (ok) onClose();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={helper ? `Edit ${helper.name}` : "Add someone who helps"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={pending}>Save</Button></>}
    >
      <div className="flex flex-col gap-3">
        <ErrorNote message={error?.message} />
        <Field label="Name">{(id) => <input id={id} className={inputClass} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Gran" />}</Field>
        <Field label="Who they are (optional)">{(id) => <input id={id} className={inputClass} maxLength={60} value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="Grandparent, sitter, neighbour" />}</Field>
        <Field label="Mobile number (optional)" hint="Used to start a text message from your phone.">{(id, d) => <input id={id} aria-describedby={d} type="tel" className={inputClass} maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}
