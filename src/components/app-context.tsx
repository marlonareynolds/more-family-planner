"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { AppInfo } from "./app-info";

export type { AppInfo };

const Ctx = createContext<AppInfo | null>(null);

export function AppProvider({ value, children }: { value: AppInfo; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppInfo & { nameOf: (id: string) => string; childName: (id: string) => string; partner: { id: string; displayName: string } | null } {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return {
    ...v,
    nameOf: (id) => (id === v.me.id ? "You" : (v.adults.find((a) => a.id === id)?.displayName ?? "Former member")),
    childName: (id) => v.children.find((c) => c.id === id)?.preferredName ?? "A child",
    partner: v.adults.find((a) => a.id !== v.me.id) ?? null,
  };
}

/** The time this view was first rendered; stable across re-renders. */
export function useNow(): number {
  const [now] = useState(() => Date.now());
  return now;
}
