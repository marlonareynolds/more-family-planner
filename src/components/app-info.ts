import type { WeekView } from "@/server/queries/week";

export interface AppInfo {
  householdId: string;
  householdName: string;
  timeZone: string;
  membershipRevision: number;
  me: { id: string; displayName: string };
  adults: { id: string; displayName: string }[];
  children: { id: string; preferredName: string; ageBand: string; needs: string; version: number }[];
  helpers: { id: string; name: string; phone: string }[];
}

export function infoFrom(w: WeekView): AppInfo {
  return {
    householdId: w.household.id,
    householdName: w.household.name,
    timeZone: w.household.timeZone,
    membershipRevision: w.household.membershipRevision,
    me: w.me,
    adults: w.adults,
    children: w.children,
    helpers: w.helpers.map((h) => ({ id: h.id, name: h.name, phone: h.phone })),
  };
}

