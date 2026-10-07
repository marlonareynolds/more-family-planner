"use client";

import { NotebookPen } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import type { listJournal } from "@/server/queries/journal";
import { useApp } from "./app-context";
import { CheckinDialog } from "./checkin-dialog";
import { fmtDate, mondayOf, todayIn } from "./format";
import { Badge, Button, Card, Dialog, EmptyState, ErrorNote, Field, SectionTitle, inputClass } from "./ui";
import { useCommand } from "./use-command";

type JournalData = Awaited<ReturnType<typeof listJournal>>;
type Entry = JournalData["entries"][number];

/** Unsaved drafts live only in this tab and are wiped on sign-out. */
const DRAFT_KEY = "more:journal-draft";

interface Draft {
  entryId?: string;
  version?: number;
  entryDate: string;
  title: string;
  body: string;
  tags: string;
}

function readDraftRaw(): string | null {
  try {
    return sessionStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
}

function parseDraft(raw: string | null): Draft | null {
  try {
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

const noSubscribe = () => () => {};

function writeDraft(d: Draft | null) {
  try {
    if (d) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {}
}

export function Journal({ data, q, tag, paged, checkinDone }: { data: JournalData; q: string; tag: string; paged: boolean; checkinDone: boolean }) {
  const app = useApp();
  const router = useRouter();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [draftDismissed, setDraftDismissed] = useState(false);
  const savedDraft = useSyncExternalStore(noSubscribe, readDraftRaw, () => null);
  const pendingDraft = draftDismissed ? null : parseDraft(savedDraft);
  const [search, setSearch] = useState(q);
  const [checkin, setCheckin] = useState(false);
  const today = todayIn(app.timeZone);

  const go = (params: Record<string, string>) => {
    const u = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    router.push(`/me${u.size ? `?${u}` : ""}#journal`);
  };
  const open = (e?: Entry) =>
    setEditing(e ? { entryId: e.id, version: e.version, entryDate: e.entryDate, title: e.title, body: e.body, tags: e.tags.join(", ") } : { entryDate: today, title: "", body: "", tags: "" });

  return (
    <section id="journal" aria-labelledby="journal-title">
      <SectionTitle
        action={
          <div className="flex gap-2">
            {!checkinDone && <Button size="sm" onClick={() => setCheckin(true)}>Check in</Button>}
            <Button size="sm" variant="primary" onClick={() => open()}>+ Write</Button>
          </div>
        }
      >
        <span id="journal-title">Journal</span>
      </SectionTitle>
      <p className="-mt-2 mb-3 text-sm text-ink-3">Only you can read this. It stays yours if you leave or delete the household.</p>

      {pendingDraft && !editing && (
        <Card className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">You have an unsaved entry from {fmtDate(pendingDraft.entryDate)}.</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => { writeDraft(null); setDraftDismissed(true); }}>Discard</Button>
            <Button size="sm" variant="primary" onClick={() => { setEditing(pendingDraft); setDraftDismissed(true); }}>Carry on</Button>
          </div>
        </Card>
      )}

      <form
        role="search"
        className="mb-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          go({ q: search.trim(), tag });
        }}
      >
        <label htmlFor="journal-q" className="sr-only">Search your journal</label>
        <input id="journal-q" className={`${inputClass} max-w-xs`} placeholder="Search your journal" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button type="submit">Search</Button>
        {(q || tag) && <Button type="button" variant="ghost" onClick={() => { setSearch(""); go({}); }}>Clear</Button>}
      </form>
      {data.allTags.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5" aria-label="Filter by tag">
          {data.allTags.map((t) => (
            <button key={t} aria-pressed={tag === t} onClick={() => go({ q, tag: tag === t ? "" : t })} className={`rounded-full border px-3 py-1 text-sm ${tag === t ? "border-brand bg-brand-soft text-brand" : "border-line text-ink-2"}`}>
              #{t}
            </button>
          ))}
        </div>
      )}

      {data.entries.length === 0 ? (
        <EmptyState icon={<NotebookPen />} tone="me" title={q || tag ? "No entries match." : "Your private journal."}>{q || tag ? "Try another word or tag." : "Only you can read it. A line a day is plenty."}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.entries.map((e) => (
            <li key={e.id}>
              <button onClick={() => open(e)} className="block w-full rounded-2xl border border-line bg-surface px-4 py-3 text-left hover:bg-surface-2">
                <p className="text-sm text-ink-3">{fmtDate(e.entryDate)}</p>
                {e.title && <p className="font-medium">{e.title}</p>}
                <p className="line-clamp-3 whitespace-pre-line text-[15px] text-ink-2">{e.body}</p>
                {e.tags.length > 0 && (
                  <span className="mt-2 flex flex-wrap gap-1">
                    {e.tags.map((t) => <Badge key={t}>#{t}</Badge>)}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-3 text-sm">
        {paged && <Link className="text-brand underline" href={`/me?${new URLSearchParams(Object.entries({ q, tag }).filter(([, v]) => v))}#journal`}>Back to newest</Link>}
        {data.nextCursor && <Link className="text-brand underline" href={`/me?${new URLSearchParams(Object.entries({ q, tag, after: data.nextCursor }).filter(([, v]) => v))}#journal`}>Older entries</Link>}
      </div>

      {editing && <EntryEditor draft={editing} onClose={() => setEditing(null)} />}
      {checkin && <CheckinDialog onClose={() => setCheckin(false)} weekKey={mondayOf(today)} />}
    </section>
  );
}

function EntryEditor({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [d, setD] = useState(draft);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const update = (patch: Partial<Draft>) => {
    const next = { ...d, ...patch };
    setD(next);
    writeDraft(next.body.trim() || next.title.trim() ? next : null);
  };
  const tags = d.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);

  const save = async () => {
    const ok = await run("SaveJournalEntry", { entryId: d.entryId, version: d.version, entryDate: d.entryDate, title: d.title, body: d.body, tags });
    if (ok) {
      writeDraft(null);
      onClose();
    }
  };
  const remove = async () => {
    if (await run("DeleteJournalEntry", { entryId: d.entryId, version: d.version })) {
      writeDraft(null);
      onClose();
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={d.entryId ? "Journal entry" : "New entry"}
      footer={
        <>
          {d.entryId && !confirmDelete && <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete</Button>}
          {confirmDelete && <Button variant="danger" disabled={pending} onClick={remove}>Delete for good</Button>}
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={pending || !d.body.trim()} onClick={save}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ErrorNote message={error?.code === "CONFLICT" || error?.code === "STALE_VERSION" ? "This entry changed elsewhere. Your text is kept here and as a draft: copy it, close and reopen to see the latest." : error?.message} />
        <Field label="Date">{(id) => <input id={id} type="date" className={inputClass} value={d.entryDate} onChange={(e) => update({ entryDate: e.target.value })} />}</Field>
        <Field label="Title (optional)">{(id) => <input id={id} className={inputClass} maxLength={120} value={d.title} onChange={(e) => update({ title: e.target.value })} />}</Field>
        <Field label="Entry">
          {(id) => <textarea id={id} rows={8} className={`${inputClass} py-2`} value={d.body} onChange={(e) => update({ body: e.target.value })} />}
        </Field>
        <Field label="Tags (optional)" hint="Separate with commas, for example: sleep, work">
          {(id, hint) => <input id={id} aria-describedby={hint} className={inputClass} value={d.tags} onChange={(e) => update({ tags: e.target.value })} />}
        </Field>
        {confirmDelete && <p className="text-sm text-bad">Deleting removes the text straight away. It can&apos;t be recovered.</p>}
      </div>
    </Dialog>
  );
}
