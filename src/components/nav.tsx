"use client";

import {
  Backpack,
  BookHeart,
  CalendarDays,
  FlaskConical,
  Heart,
  Leaf,
  ListChecks,
  LogOut,
  MapPin,
  Menu,
  Settings,
  Sparkles,
  Sun,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cx } from "./ui";

interface Place {
  href: string;
  label: string;
  icon: LucideIcon;
  hint?: string;
}

const primary: Place[] = [
  { href: "/today", label: "Today", icon: Sun },
  { href: "/week", label: "Our Week", icon: CalendarDays },
  { href: "/us", label: "For Us", icon: Heart },
  { href: "/family", label: "Family", icon: Users },
  { href: "/me", label: "Me", icon: Leaf },
];
const secondary: Place[] = [
  { href: "/plan", label: "Plan the week", icon: Sparkles, hint: "Ten minutes, once a week" },
  { href: "/jobs", label: "Jobs", icon: ListChecks, hint: "Who does what at home" },
  { href: "/places", label: "Our places", icon: MapPin, hint: "Spots you love nearby" },
  { href: "/holidays", label: "Holidays and care", icon: Backpack, hint: "School breaks, who has the children" },
  { href: "/look-back", label: "Look back", icon: BookHeart, hint: "Your month in memories" },
  { href: "/trial", label: "Trial", icon: FlaskConical, hint: "Weekly questions" },
  { href: "/settings", label: "Settings", icon: Settings, hint: "People, calendars, notifications" },
];

export function NavBar({ householdName, myName }: { householdName: string; myName: string }) {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  const [open, setOpen] = useState(false);
  const inSecondary = secondary.some((s) => active(s.href));

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>

      {/* Phone: a quiet top bar, five main places at the bottom, the rest in a menu. */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-line bg-bg/90 px-4 py-2.5 backdrop-blur md:hidden">
        <Link href="/today" className="flex items-baseline gap-2">
          <span className="font-display text-[1.7rem] italic leading-none text-brand">More<span className="text-accent">.</span></span>
          <span className="label-caps max-w-[45vw] truncate text-ink-3">{householdName}</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="more-menu"
          className={cx("flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors", inSecondary ? "border-brand/40 bg-brand-soft text-brand" : "border-line bg-surface text-ink-2")}
        >
          <Menu aria-hidden size={18} />
          Menu
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu" id="more-menu">
          <button aria-label="Close menu" className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-[20px] border-t border-line bg-surface px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3" style={{ animation: "sheet-in 260ms cubic-bezier(0.2,0.8,0.2,1)" }}>
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" aria-hidden />
            <div className="mb-2 flex items-center justify-between">
              <p className="font-display text-[1.4rem] italic">{householdName}</p>
              <button onClick={() => setOpen(false)} className="rounded-full p-2 text-ink-2 hover:bg-surface-2" aria-label="Close menu">
                <X aria-hidden size={20} />
              </button>
            </div>
            <nav aria-label="More places">
              <ul className="grid grid-cols-2 gap-2">
                {secondary.map((s, i) => (
                  <li key={s.href} className="rise" style={{ ["--i" as string]: i }}>
                    <Link
                      href={s.href}
                      onClick={() => setOpen(false)}
                      aria-current={active(s.href) ? "page" : undefined}
                      className={cx("flex h-full min-h-20 flex-col gap-1 rounded-[12px] border p-3 transition-colors", active(s.href) ? "border-brand bg-brand-soft" : "border-line bg-bg/50 hover:bg-surface-2")}
                    >
                      <s.icon aria-hidden size={20} strokeWidth={1.6} className="text-brand" />
                      <span className="font-medium leading-tight">{s.label}</span>
                      {s.hint && <span className="text-xs leading-snug text-ink-3">{s.hint}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-sm text-ink-3">
              <span>Signed in as {myName}</span>
              <SignOut />
            </div>
          </div>
        </div>
      )}

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="grid grid-cols-5">
          {primary.map((p) => {
            const on = active(p.href);
            return (
              <li key={p.href}>
                <Link href={p.href} aria-current={on ? "page" : undefined} className={cx("relative flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors", on ? "text-brand" : "text-ink-3")}>
                  <span aria-hidden className={cx("absolute top-0 h-[3px] w-8 rounded-b-full bg-accent transition-transform duration-200", on ? "scale-x-100" : "scale-x-0")} />
                  <p.icon aria-hidden size={21} strokeWidth={on ? 2 : 1.6} />
                  {p.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r border-line px-4 py-8 md:flex">
        <div className="px-3">
          <Link href="/today" className="font-display text-[2.2rem] italic leading-none text-brand">More<span className="text-accent">.</span></Link>
          <p className="label-caps mt-2 text-ink-3">{householdName}</p>
        </div>
        <nav aria-label="Main" className="flex flex-col gap-5">
          {[primary, secondary].map((group, g) => (
            <ul key={g} className="flex flex-col gap-0.5">
              {group.map((p) => (
                <li key={p.href}>
                  <Link
                    href={p.href}
                    aria-current={active(p.href) ? "page" : undefined}
                    className={cx("flex items-center gap-3 rounded-[10px] border-l-[3px] px-3 py-2 text-[15px] transition-colors", active(p.href) ? "border-accent bg-brand-soft font-medium text-brand" : "border-transparent text-ink-2 hover:bg-surface-2")}
                  >
                    <p.icon aria-hidden size={18} strokeWidth={1.7} />
                    {p.label}
                  </Link>
                </li>
              ))}
            </ul>
          ))}
        </nav>
        <div className="mt-auto px-3 text-sm text-ink-3">
          Signed in as {myName}
          <SignOut />
        </div>
      </aside>
    </>
  );
}

export function SignOut() {
  return (
    <button
      className="mt-2 inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink"
      onClick={async () => {
        await fetch("/api/auth/sign-out", { method: "POST" });
        try {
          sessionStorage.clear();
        } catch {}
        window.location.href = "/sign-in";
      }}
    >
      <LogOut aria-hidden size={15} />
      Sign out
    </button>
  );
}
