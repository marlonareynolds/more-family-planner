/** Formatting in the household's timezone, never the device's. */

export function localParts(ms: number, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

export function fmtTime(ms: number, timeZone: string): string {
  return localParts(ms, timeZone).time;
}

/*
 * Dates are spelled out by hand rather than with Intl: Node and browsers ship
 * different locale data ("Tue 6 Oct" vs "Tue, 6 Oct"), which breaks hydration.
 */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function fmtDate(date: string, opts: { weekday?: boolean; month?: "short" | "long"; year?: boolean } = {}): string {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = opts.weekday ?? true;
  const month = opts.month === "long" ? MONTHS[m - 1] : MONTHS[m - 1].slice(0, 3);
  const dow = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday ? `${dow} ` : ""}${d} ${month}${opts.year ? ` ${y}` : ""}`;
}

export function fmtDateTime(ms: number, timeZone: string): string {
  const p = localParts(ms, timeZone);
  return `${fmtDate(p.date)}, ${p.time}`;
}

export function fmtRange(start: number, end: number, timeZone: string, allDay = false): string {
  if (allDay) {
    const s = localParts(start, timeZone).date;
    const e = localParts(end - 1, timeZone).date;
    return s === e ? "All day" : `${fmtDate(s)} to ${fmtDate(e)}`;
  }
  const s = localParts(start, timeZone);
  const e = localParts(end, timeZone);
  return s.date === e.date ? `${s.time} to ${e.time}` : `${fmtDate(s.date)} ${s.time} to ${fmtDate(e.date)} ${e.time}`;
}

export function fmtMoney(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return "–";
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const pounds = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}£${pounds}.${String(abs % 100).padStart(2, "0")}`;
}

export function toMinor(input: string): number | null {
  const s = input.trim().replace(/^£/, "").replace(/,/g, "");
  if (!s) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return NaN;
  const [p, d = ""] = s.split(".");
  return Number(p) * 100 + Number(d.padEnd(2, "0"));
}

export function minorToInput(minor: number | null | undefined): string {
  return minor === null || minor === undefined ? "" : (minor / 100).toFixed(2);
}

export function addDaysStr(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDaysStr(date, -dow);
}

export function todayIn(timeZone: string): string {
  return localParts(Date.now(), timeZone).date;
}
