"use client";

import { useSyncExternalStore } from "react";

/**
 * "No thanks" on a gentle offer, remembered on this phone only: a viewer's
 * convenience, never shared and never needed for anything to work.
 */
const DISMISSED = "more:dismissed";
// Remembered for this visit even where the browser won't keep it.
const dismissedNow = new Set<string>();
function subscribeDismissals(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(DISMISSED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(DISMISSED, onChange);
  };
}
function readDismissal(key: string): boolean {
  if (dismissedNow.has(key)) return true;
  try {
    return localStorage.getItem(key) === "no";
  } catch {
    return false;
  }
}
export function dismiss(key: string) {
  dismissedNow.add(key);
  try {
    localStorage.setItem(key, "no");
  } catch {}
  window.dispatchEvent(new Event(DISMISSED));
}


/** Hidden on the server and until this phone's own answer has been read. */
export function useDismissed(key: string): boolean {
  return useSyncExternalStore(subscribeDismissals, () => readDismissal(key), () => true);
}
