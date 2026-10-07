"use client";

import { Check, PartyPopper } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Small, calm confirmations ("Sent to Sam") and the occasional celebration
 * when something good happens (a plan agreed, a job done). Toasts are
 * announced to screen readers through a polite live region.
 */

interface ToastItem {
  id: number;
  text: string;
  celebrate: boolean;
}

const EVENT = "more:toast";

export function toast(text: string, opts: { celebrate?: boolean } = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { text, celebrate: !!opts.celebrate } }));
}

const COLOURS = ["var(--us)", "var(--me)", "var(--family)", "var(--care)", "var(--brand)"];

function Burst() {
  // Fixed, deterministic spread: no randomness during render.
  const bits = Array.from({ length: 18 }, (_, i) => {
    const angle = (i / 18) * Math.PI * 2;
    const dist = 70 + (i % 3) * 22;
    return { dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist - 30, r: (i * 47) % 360, c: COLOURS[i % COLOURS.length], round: i % 2 === 0 };
  });
  return (
    <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2">
      {bits.map((b, i) => (
        <span
          key={i}
          className={b.round ? "absolute size-2 rounded-full" : "absolute h-2.5 w-1.5 rounded-sm"}
          style={{ background: b.c, animation: "confetti 900ms cubic-bezier(0.2,0.8,0.2,1) forwards", ["--dx" as string]: `${b.dx}px`, ["--dy" as string]: `${b.dy}px`, ["--r" as string]: `${b.r}deg` }}
        />
      ))}
    </span>
  );
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    let n = 0;
    const onToast = (e: Event) => {
      const d = (e as CustomEvent<{ text: string; celebrate: boolean }>).detail;
      const id = ++n;
      setItems((xs) => [...xs.slice(-2), { id, ...d }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), d.celebrate ? 3600 : 2800);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 md:bottom-8">
      {items.map((t) => (
        <div key={t.id} className="shadow-lift relative flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-bg" style={{ animation: "toast-in 260ms cubic-bezier(0.2,0.8,0.2,1)" }}>
          {t.celebrate && <Burst />}
          {t.celebrate ? <PartyPopper aria-hidden size={16} /> : <Check aria-hidden size={16} />}
          {t.text}
        </div>
      ))}
    </div>
  );
}
