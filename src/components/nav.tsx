"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const primary = [
  { href: "/today", label: "Today", icon: "☀" },
  { href: "/week", label: "Our Week", icon: "▦" },
  { href: "/us", label: "For Us", icon: "♥" },
  { href: "/family", label: "Family", icon: "✿" },
  { href: "/me", label: "Me", icon: "◐" },
];
const secondary = [
  { href: "/holidays", label: "Holidays" },
  { href: "/trial", label: "Trial" },
  { href: "/settings", label: "Settings" },
];

export function NavBar({ householdName, myName }: { householdName: string; myName: string }) {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>
      {/* Phone: top bar for secondary places, bottom tab bar for the five main ones. */}
      <header className="flex items-center justify-between border-b border-line px-4 py-3 md:hidden">
        <Link href="/today" className="font-display text-xl text-brand">
          More
        </Link>
        <nav aria-label="More places" className="flex gap-1">
          {secondary.map((s) => (
            <Link key={s.href} href={s.href} aria-current={active(s.href) ? "page" : undefined} className={cx("rounded-full px-3 py-1.5 text-sm", active(s.href) ? "bg-brand-soft text-brand" : "text-ink-2")}>
              {s.label}
            </Link>
          ))}
        </nav>
      </header>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="grid grid-cols-5">
          {primary.map((p) => (
            <li key={p.href}>
              <Link href={p.href} aria-current={active(p.href) ? "page" : undefined} className={cx("flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px]", active(p.href) ? "text-brand" : "text-ink-3")}>
                <span aria-hidden className="text-lg leading-none">{p.icon}</span>
                {p.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <aside className="hidden w-56 shrink-0 flex-col gap-6 border-r border-line px-4 py-8 md:flex">
        <div>
          <Link href="/today" className="font-display text-2xl text-brand">More</Link>
          <p className="mt-1 text-sm text-ink-3">{householdName}</p>
        </div>
        <nav aria-label="Main">
          <ul className="flex flex-col gap-1">
            {[...primary, ...secondary].map((p) => (
              <li key={p.href}>
                <Link href={p.href} aria-current={active(p.href) ? "page" : undefined} className={cx("block rounded-xl px-3 py-2 text-[15px]", active(p.href) ? "bg-brand-soft font-medium text-brand" : "text-ink-2 hover:bg-surface-2")}>
                  {p.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-auto text-sm text-ink-3">
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
      className="mt-2 block text-sm text-ink-2 underline"
      onClick={async () => {
        await fetch("/api/auth/sign-out", { method: "POST" });
        try {
          sessionStorage.clear();
        } catch {}
        window.location.href = "/sign-in";
      }}
    >
      Sign out
    </button>
  );
}
