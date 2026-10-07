"use client";

import { useEffect, useState } from "react";
import type { ReachSettings } from "@/server/queries/reach";
import { Button, Card, Checkbox, ErrorNote, Field, SectionTitle, inputClass } from "./ui";
import { useCommand } from "./use-command";

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type DeviceState = "checking" | "unsupported" | "needs-install" | "off" | "on" | "blocked";

/**
 * Notifications on this device, quiet hours and the Sunday email. Each
 * adult's own; the partner never sees them.
 */
export function ReachSettingsPanel({ settings }: { settings: ReachSettings }) {
  const { run, pending, error, setError } = useCommand();
  const [device, setDevice] = useState<DeviceState>("checking");
  const [form, setForm] = useState({ pushEnabled: settings.pushEnabled, weeklyEmail: settings.weeklyEmail, quietStart: settings.quietStart, quietEnd: settings.quietEnd });
  const [saved, setSaved] = useState(false);
  const [tested, setTested] = useState(false);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        // iPhone and iPad only allow web push from an app added to the Home Screen.
        const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
        return setDevice(ios ? "needs-install" : "unsupported");
      }
      if (Notification.permission === "denied") return setDevice("blocked");
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      setDevice(sub ? "on" : "off");
    })().catch(() => setDevice("unsupported"));
  }, []);

  async function turnOn() {
    setError(null);
    if (!settings.vapidPublicKey) return;
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return setDevice(permission === "denied" ? "blocked" : "off");
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(settings.vapidPublicKey) });
    const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    const label = /iPhone|iPad/.test(navigator.userAgent) ? "iPhone" : /Android/.test(navigator.userAgent) ? "Android phone" : "This computer";
    if (await run("SavePushSubscription", { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, label })) setDevice("on");
  }

  async function turnOff() {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await run("RemovePushSubscription", { endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
    setDevice("off");
  }

  return (
    <section id="notifications">
      <SectionTitle>Notifications and email</SectionTitle>
      <Card className="flex flex-col gap-4">
        <div>
          <h3 className="font-medium">On this device</h3>
          {!settings.pushReady && <p className="mt-1 text-sm text-ink-3">Phone notifications aren&apos;t switched on for More yet. Until they are, updates show here in the app.</p>}
          {settings.pushReady && device === "checking" && <p className="mt-1 text-sm text-ink-3">Checking this device…</p>}
          {settings.pushReady && device === "unsupported" && <p className="mt-1 text-sm text-ink-3">This browser can&apos;t receive notifications. Try Chrome, Edge, Firefox or Safari.</p>}
          {settings.pushReady && device === "needs-install" && (
            <p className="mt-1 text-sm text-ink-2">On iPhone, first add More to your Home Screen: tap Share, then “Add to Home Screen”. Open More from there and come back here.</p>
          )}
          {settings.pushReady && device === "blocked" && <p className="mt-1 text-sm text-ink-2">Notifications are blocked for More in this browser&apos;s settings. Allow them there, then reload.</p>}
          {settings.pushReady && device === "off" && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={() => turnOn().catch(() => setError({ code: "INTERNAL", message: "Notifications couldn't be turned on here.", details: null }))} disabled={pending}>Turn on notifications</Button>
              <span className="text-sm text-ink-3">Invitations, answers and reminders. Never your private notes.</span>
            </div>
          )}
          {settings.pushReady && device === "on" && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="text-sm text-good">On for this device</span>
              <Button size="sm" onClick={async () => setTested(!!(await run("SendTestNotification", {}, { refresh: false })))} disabled={pending}>Send a test</Button>
              <Button size="sm" variant="ghost" onClick={turnOff} disabled={pending}>Turn off here</Button>
              {tested && <span role="status" className="text-sm text-ink-3">Sent. It should arrive in a moment.</span>}
            </div>
          )}
          {settings.devices > 0 && <p className="mt-1 text-xs text-ink-3">Turned on for {settings.devices} device{settings.devices === 1 ? "" : "s"}.</p>}
        </div>

        <form
          className="flex flex-col gap-3 border-t border-line pt-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaved(!!(await run("UpdateReachSettings", form)));
          }}
        >
          <Checkbox checked={form.pushEnabled} onChange={(v) => { setForm({ ...form, pushEnabled: v }); setSaved(false); }} label="Send notifications to my devices" />
          <div className="flex flex-wrap gap-3">
            <Field label="Quiet from">{(id) => <input id={id} type="time" className={`${inputClass} w-32`} value={form.quietStart} onChange={(e) => { setForm({ ...form, quietStart: e.target.value }); setSaved(false); }} />}</Field>
            <Field label="Until">{(id) => <input id={id} type="time" className={`${inputClass} w-32`} value={form.quietEnd} onChange={(e) => { setForm({ ...form, quietEnd: e.target.value }); setSaved(false); }} />}</Field>
          </div>
          <p className="-mt-1 text-xs text-ink-3">Nothing is sent in quiet hours. What arrives meanwhile comes together as one message afterwards.</p>
          <Checkbox
            checked={form.weeklyEmail}
            onChange={(v) => { setForm({ ...form, weeklyEmail: v }); setSaved(false); }}
            label="Email me “your week ahead” on Sunday evenings"
            hint={settings.email ? `To ${settings.email}.${settings.emailReady ? "" : " Email isn't switched on for More yet."}` : "We don't have an email address for you yet."}
          />
          <ErrorNote message={error?.message} />
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={pending}>Save</Button>
            {saved && <span role="status" className="text-sm text-good">Saved</span>}
          </div>
        </form>
      </Card>
    </section>
  );
}
