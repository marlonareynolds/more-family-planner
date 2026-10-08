"use client";

import type { ReachSettings } from "@/server/queries/reach";
import { CalendarOutSettings, type CalendarOutState } from "./calendar-out";
import { HelpersSettings } from "./helpers-settings";
import { ReachSettingsPanel } from "./reach-settings";
import { useState } from "react";
import type { WeekView } from "@/server/queries/week";
import { useApp } from "./app-context";
import { fmtDateTime } from "./format";
import { Badge, Button, Card, Checkbox, Dialog, ErrorNote, Field, SectionTitle, inputClass } from "./ui";
import { useCommand } from "./use-command";
import { CalendarSettings, type CalendarConnect } from "./calendar-settings";
import { FamilyScreens, TownSettings, type ScreenLink } from "./family-screens";

type Child = WeekView["children"][number];
const AGE_BANDS = ["0-4", "5-7", "8-11", "12-15", "16+"] as const;

/** A fixed list so server and browser render the same options. */
const COMMON_ZONES = [
  "Europe/London", "Europe/Dublin", "Europe/Lisbon", "Europe/Paris", "Europe/Madrid", "Europe/Berlin", "Europe/Amsterdam", "Europe/Rome",
  "Europe/Athens", "Africa/Johannesburg", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Hong_Kong", "Asia/Tokyo", "Australia/Perth",
  "Australia/Sydney", "Pacific/Auckland", "America/St_Johns", "America/Halifax", "America/New_York", "America/Toronto", "America/Chicago",
  "America/Denver", "America/Los_Angeles", "UTC",
];

function zones(current: string): string[] {
  return COMMON_ZONES.includes(current) ? COMMON_ZONES : [current, ...COMMON_ZONES];
}

export function TimeZoneSelect({ id, value, onChange, describedBy }: { id: string; value: string; onChange: (v: string) => void; describedBy?: string }) {
  return (
    <select id={id} aria-describedby={describedBy} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
      {zones(value).map((z) => <option key={z} value={z}>{z.replaceAll("_", " ")}</option>)}
    </select>
  );
}

export function SettingsPanel({
  household,
  openInvite,
  kids,
  profile,
  analyticsOptOut,
  calendars,
  calendarConnect,
  reach,
  helpers,
  calendarOut,
  screens,
  placeName,
}: {
  household: WeekView["household"];
  openInvite: WeekView["openInvite"];
  kids: Child[];
  profile: { displayName: string; timeZone: string };
  analyticsOptOut: boolean;
  calendars: WeekView["calendars"];
  calendarConnect: CalendarConnect;
  reach: ReachSettings;
  helpers: WeekView["helpers"];
  calendarOut: CalendarOutState | null;
  screens: ScreenLink[];
  placeName: string | null;
}) {
  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-3xl">Settings</h1>
      <Profile profile={profile} />
      <ReachSettingsPanel settings={reach} />
      <HouseholdDetails household={household} />
      <EveningsAndSpending household={household} />
      <TownSettings placeName={placeName} />
      <Adults openInvite={openInvite} />
      <Children kids={kids} />
      <HelpersSettings helpers={helpers} />
      <FamilyScreens links={screens} />
      <CalendarSettings calendars={calendars} connect={calendarConnect} />
      <CalendarOutSettings state={calendarOut} />
      <YourData analyticsOptOut={analyticsOptOut} />
      <section>
        <SectionTitle>Help</SectionTitle>
        <Card>
          <p className="text-sm text-ink-2">
            Something not working, or a question about your data? <a className="font-medium text-brand underline" href="/support">Ask for help</a>. A person reads every message.
          </p>
        </Card>
      </section>
      <Leaving household={household} />
    </div>
  );
}

function Profile({ profile }: { profile: { displayName: string; timeZone: string } }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [name, setName] = useState(profile.displayName);
  const [tz, setTz] = useState(profile.timeZone);
  const [saved, setSaved] = useState(false);
  return (
    <section>
      <SectionTitle>You</SectionTitle>
      <Card>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaved(!!(await run("UpdateProfile", { displayName: name, timeZone: tz })));
          }}
        >
          <ErrorNote message={error?.message} />
          <Field label="Your name">{(id) => <input id={id} className={inputClass} maxLength={40} value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} />}</Field>
          <Field label="Your timezone" hint="Used when you travel. Household plans always use the household timezone.">
            {(id, hint) => <TimeZoneSelect id={id} describedBy={hint} value={tz} onChange={(v) => { setTz(v); setSaved(false); }} />}
          </Field>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={pending}>Save</Button>
            {saved && <span role="status" className="text-sm text-good">Saved</span>}
          </div>
        </form>
      </Card>
    </section>
  );
}

function HouseholdDetails({ household }: { household: WeekView["household"] }) {
  const { run, pending, error } = useCommand(household.id);
  const [name, setName] = useState(household.name);
  const [tz, setTz] = useState(household.timeZone);
  const [saved, setSaved] = useState(false);
  return (
    <section>
      <SectionTitle>Household</SectionTitle>
      <Card>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaved(!!(await run("UpdateHousehold", { version: household.version, name, timeZone: tz })));
          }}
        >
          <ErrorNote message={error?.code === "CONFLICT" ? "Someone else changed these details. Reload to see the latest." : error?.message} />
          <Field label="Household name">{(id) => <input id={id} className={inputClass} maxLength={60} value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} />}</Field>
          <Field label="Household timezone" hint="Every shared plan is shown in this timezone, whatever device you use.">
            {(id, hint) => <TimeZoneSelect id={id} describedBy={hint} value={tz} onChange={(v) => { setTz(v); setSaved(false); }} />}
          </Field>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={pending}>Save</Button>
            {saved && <span role="status" className="text-sm text-good">Saved</span>}
          </div>
        </form>
      </Card>
    </section>
  );
}

/**
 * The household's own evening and an optional spending guide. Both only
 * shape suggestions and advice; neither books time or blocks a plan.
 */
function EveningsAndSpending({ household }: { household: WeekView["household"] }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [ends, setEnds] = useState(household.eveningEnds);
  const [bedtime, setBedtime] = useState(household.bedtime ?? "");
  const [guide, setGuide] = useState(household.weeklyGuideMinor === null ? "" : String(household.weeklyGuideMinor / 100));
  const [saved, setSaved] = useState(false);
  return (
    <section>
      <SectionTitle>Evenings and spending</SectionTitle>
      <Card>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const pounds = guide.trim() === "" ? null : Math.round(Number(guide) * 100);
            const ok = (await run("SetEveningTimes", { eveningEnds: ends, bedtime: bedtime || null }, { refresh: false })) && (await run("SetSpendingGuide", { weeklyGuideMinor: pounds !== null && Number.isFinite(pounds) ? pounds : null }));
            setSaved(!!ok);
          }}
        >
          <ErrorNote message={error?.message} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Family time usually ends" hint="On a school night. Family ideas aren't suggested after it.">
              {(id, d) => <input id={id} aria-describedby={d} type="time" className={inputClass} value={ends} onChange={(e) => { setEnds(e.target.value); setSaved(false); }} />}
            </Field>
            <Field label="Children's bedtime (optional)" hint="Evenings for the two of you start after it. It never counts as someone looking after them.">
              {(id, d) => <input id={id} aria-describedby={d} type="time" className={inputClass} value={bedtime} onChange={(e) => { setBedtime(e.target.value); setSaved(false); }} />}
            </Field>
          </div>
          <Field label="Weekly guide for shared plans, £ (optional)" hint="Shown on Our Week next to the costs you've entered. It's a guide, not a limit, and private budgets are never counted in it.">
            {(id, d) => <input id={id} aria-describedby={d} inputMode="decimal" className={`${inputClass} w-36`} value={guide} onChange={(e) => { setGuide(e.target.value.replace(/[^\d.]/g, "")); setSaved(false); }} />}
          </Field>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={pending || !ends}>Save</Button>
            {saved && <span role="status" className="text-sm text-good">Saved</span>}
          </div>
        </form>
      </Card>
    </section>
  );
}

function Adults({ openInvite }: { openInvite: WeekView["openInvite"] }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const full = app.adults.length >= 2;

  const create = async () => {
    const r = await run<{ token: string }>("CreateInvite", {}, { expected: { membershipRevision: app.membershipRevision } });
    if (r) {
      setLink(`${window.location.origin}/join/${r.token}`);
      setCopied(false);
    }
  };

  return (
    <section>
      <SectionTitle>Adults</SectionTitle>
      <Card className="flex flex-col gap-3">
        <ul className="flex flex-col gap-1">
          {app.adults.map((a) => (
            <li key={a.id}>
              {a.displayName} {a.id === app.me.id && <Badge>You</Badge>}
            </li>
          ))}
        </ul>
        <ErrorNote message={error?.message} />
        {full ? (
          <p className="text-sm text-ink-3">More supports two adults per household.</p>
        ) : link ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm">Send this link to your partner yourself. It works once and expires in 7 days. More won&apos;t show it again.</p>
            <div className="flex gap-2">
              <input readOnly aria-label="Invitation link" className={inputClass} value={link} onFocus={(e) => e.currentTarget.select()} />
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    setCopied(true);
                  } catch {}
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {openInvite && (
              <p className="w-full text-sm text-ink-3">An invitation is open until {fmtDateTime(Date.parse(openInvite.expiresAt), app.timeZone)}. Making a new link stops the old one working.</p>
            )}
            <Button variant="primary" disabled={pending} onClick={create}>{openInvite ? "Make a new link" : "Invite your partner"}</Button>
            {openInvite && <Button disabled={pending} onClick={() => run("RevokeInvite", { invitationId: openInvite.id })}>Cancel invitation</Button>}
          </div>
        )}
      </Card>
    </section>
  );
}

function Children({ kids }: { kids: Child[] }) {
  const [editing, setEditing] = useState<Child | "new" | null>(null);
  return (
    <section>
      <SectionTitle action={<Button size="sm" onClick={() => setEditing("new")}>+ Add a child</Button>}>Children</SectionTitle>
      <p className="-mt-2 mb-3 text-sm text-ink-3">Children don&apos;t have accounts. Only a name and age band are needed; anything else is optional.</p>
      {kids.length === 0 ? (
        <p className="text-sm text-ink-3">No children added.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {kids.map((c) => (
            <li key={c.id}>
              <button onClick={() => setEditing(c)} className="block w-full rounded-2xl border border-line bg-surface px-4 py-3 text-left hover:bg-surface-2">
                <span className="font-medium">{c.preferredName}</span> <span className="text-sm text-ink-3">aged {c.ageBand}</span>
                {c.needs && <span className="block text-sm text-ink-2">{c.needs}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && <ChildEditor child={editing === "new" ? null : editing} onClose={() => setEditing(null)} key={editing === "new" ? "new" : editing.id} />}
    </section>
  );
}

function ChildEditor({ child, onClose }: { child: Child | null; onClose: () => void }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [name, setName] = useState(child?.preferredName ?? "");
  const [band, setBand] = useState(child?.ageBand ?? "5-7");
  const [needs, setNeeds] = useState(child?.needs ?? "");
  const [archiving, setArchiving] = useState(false);
  const save = async () => {
    const payload = { preferredName: name, ageBand: band, needs };
    const ok = child ? await run("UpdateChild", { ...payload, childId: child.id, version: child.version }) : await run("AddChild", payload);
    if (ok) onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={child ? child.preferredName : "Add a child"}
      footer={
        <>
          {child && !archiving && <Button variant="danger" onClick={() => setArchiving(true)}>Remove</Button>}
          {child && archiving && (
            <Button variant="danger" disabled={pending} onClick={async () => { if (await run("ArchiveChild", { childId: child.id, version: child.version })) onClose(); }}>
              Remove from plans
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={pending || !name.trim()} onClick={save}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ErrorNote message={error?.message} />
        {!child && <p className="text-sm text-ink-3">Plans that already need childcare will be marked for a quick review.</p>}
        <Field label="Name they go by">{(id) => <input id={id} className={inputClass} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Age band">
          {(id) => (
            <select id={id} className={inputClass} value={band} onChange={(e) => setBand(e.target.value)}>
              {AGE_BANDS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
        </Field>
        <Field label="Anything that helps planning (optional)" hint="For example: naps after lunch, finds loud places hard. Visible to both adults.">
          {(id, hint) => <textarea id={id} aria-describedby={hint} rows={3} maxLength={500} className={`${inputClass} py-2`} value={needs} onChange={(e) => setNeeds(e.target.value)} />}
        </Field>
        {archiving && <p className="text-sm text-bad">They&apos;ll be taken out of future care and plans. Past plans keep their history.</p>}
      </div>
    </Dialog>
  );
}

function YourData({ analyticsOptOut }: { analyticsOptOut: boolean }) {
  const app = useApp();
  const { run, error } = useCommand(app.householdId);
  const [optOut, setOptOut] = useState(analyticsOptOut);
  return (
    <section>
      <SectionTitle>Your data</SectionTitle>
      <Card className="flex flex-col gap-3">
        <p className="text-sm text-ink-2">Download a copy as JSON. Your private export holds your journal, check-ins and feedback. The household export holds shared plans plus your own private records, never your partner&apos;s.</p>
        <div className="flex flex-wrap gap-2">
          <a className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-[15px] hover:bg-surface-2" href="/api/v1/exports?kind=account" download>Download my private data</a>
          <a className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-[15px] hover:bg-surface-2" href="/api/v1/exports?kind=household" download>Download household data</a>
        </div>
        <Checkbox
          checked={!optOut}
          onChange={async (on) => {
            setOptOut(!on);
            if (!(await run("SetAnalyticsOptOut", { optOut: !on }))) setOptOut(optOut);
          }}
          label="Count what I do for the household trial"
          hint="Counts like 'a plan was agreed', with no titles, notes, places or names. Untick to stop recording anything for you."
        />
        <ErrorNote message={error?.message} />
      </Card>
    </section>
  );
}

type LeaveHow = { command: "LeaveHousehold"; payload: { confirm: true } } | { command: "DeleteHousehold"; payload: { confirmName: string } };

function Leaving({ household }: { household: WeekView["household"] }) {
  const app = useApp();
  const { run, pending: running, error: commandError } = useCommand(household.id);
  const [mode, setMode] = useState<"leave" | "delete" | "close" | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [confirmClose, setConfirmClose] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  // Calendar blocks More couldn't take out, shown before moving on.
  const [leftover, setLeftover] = useState<{ text: string; then: () => void } | null>(null);
  const pending = running || leaving;
  const error = commandError ?? (leaveError ? { message: leaveError } : null);

  /** Leave or delete, taking More's Busy blocks out of connected calendars first. */
  async function leave(how: LeaveHow): Promise<string | false> {
    setLeaving(true);
    setLeaveError(null);
    try {
      const res = await fetch("/api/v1/household/leave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ householdId: household.id, how }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setLeaveError(data?.error?.message ?? "Something went wrong.");
        return false;
      }
      const left: { start: number; end: number }[] = data?.cleanup?.left ?? [];
      if (!left.length) return "";
      const when = left.slice(0, 6).map((b) => fmtDateTime(b.start, household.timeZone)).join("; ");
      return `${left.length} “Busy” ${left.length === 1 ? "block" : "blocks"} More added to your Google or Outlook calendar couldn't be removed: ${when}${left.length > 6 ? " and more" : ""}. You can delete them in that calendar.`;
    } catch {
      setLeaveError("You seem to be offline. Try again.");
      return false;
    } finally {
      setLeaving(false);
    }
  }
  const after = (note: string, then: () => void) => (note ? setLeftover({ text: note, then }) : then());
  async function closeAccount() {
    const note = await leave({ command: "LeaveHousehold", payload: { confirm: true } });
    if (note === false) return;
    if (!(await run("CloseAccount", { confirm: "close" }, { refresh: false }))) return;
    after(note, async () => {
      await fetch("/api/auth/sign-out", { method: "POST" }).catch(() => {});
      window.location.replace("/");
    });
  }
  const done = () => {
    window.location.href = "/setup";
  };
  return (
    <section>
      <SectionTitle>Leave or delete</SectionTitle>
      <Card className="flex flex-wrap gap-2">
        <Button variant="danger" onClick={() => setMode("leave")}>Leave household</Button>
        <Button variant="danger" onClick={() => setMode("delete")}>Delete household</Button>
        <Button variant="danger" onClick={() => setMode("close")}>Close my account</Button>
      </Card>
      {mode === "close" && (
        <Dialog
          open
          onClose={() => setMode(null)}
          title="Close your account?"
          footer={
            <>
              <Button onClick={() => setMode(null)}>Keep it</Button>
              <Button variant="danger" disabled={pending || confirmClose.trim().toLowerCase() !== "close"} onClick={closeAccount}>Close for good</Button>
            </>
          }
        >
          <div className="flex flex-col gap-3 text-[15px]">
            <ErrorNote message={error?.message} />
            <p>You leave the household, then everything that was only yours is erased: your journal, check-ins, feedback, what More learned about you, your trial answers and your devices. This can&apos;t be undone.</p>
            <p className="text-ink-2">Want a copy first? Use “Download my private data” above.</p>
            <Field label='Type "close" to confirm'>{(id) => <input id={id} className={inputClass} value={confirmClose} onChange={(e) => setConfirmClose(e.target.value)} autoComplete="off" />}</Field>
          </div>
        </Dialog>
      )}
      {mode === "leave" && (
        <Dialog
          open
          onClose={() => setMode(null)}
          title="Leave this household?"
          footer={
            <>
              <Button onClick={() => setMode(null)}>Stay</Button>
              <Button variant="danger" disabled={pending} onClick={async () => { const note = await leave({ command: "LeaveHousehold", payload: { confirm: true } }); if (note !== false) after(note, done); }}>Leave</Button>
            </>
          }
        >
          <div className="flex flex-col gap-2 text-[15px]">
            <ErrorNote message={error?.message} />
            <p>Here&apos;s what happens:</p>
            <ul className="list-disc pl-5 text-ink-2">
              <li>You stop seeing the household&apos;s plans straight away.</li>
              <li>You&apos;re removed from upcoming plans and any childcare you were covering; {app.partner ? `${app.partner.displayName} will see what needs a new plan` : "nobody else is in the household, so it is closed"}.</li>
              <li>Your journal, check-ins and feedback stay yours.</li>
            </ul>
          </div>
        </Dialog>
      )}
      {mode === "delete" && (
        <Dialog
          open
          onClose={() => setMode(null)}
          title="Delete this household?"
          footer={
            <>
              <Button onClick={() => setMode(null)}>Cancel</Button>
              <Button variant="danger" disabled={pending || confirmName.trim() !== household.name} onClick={async () => { const note = await leave({ command: "DeleteHousehold", payload: { confirmName } }); if (note !== false) after(note, done); }}>
                Delete for everyone
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3 text-[15px]">
            <ErrorNote message={error?.message} />
            <p>This removes the shared diary, plans, care and costs for both adults. Each adult keeps their own private journal and check-ins.</p>
            <Field label={`Type "${household.name}" to confirm`}>{(id) => <input id={id} className={inputClass} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" />}</Field>
          </div>
        </Dialog>
      )}
      {leftover && (
        <Dialog open onClose={leftover.then} title="Calendar blocks to remove" footer={<Button variant="primary" onClick={leftover.then}>OK</Button>}>
          <p className="text-[15px]">{leftover.text}</p>
        </Dialog>
      )}
    </section>
  );
}
