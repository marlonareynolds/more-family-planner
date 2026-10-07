/**
 * A minimal iCalendar writer (RFC 5545) for the "plans in your own calendar"
 * feed. Times are written in UTC so no timezone database is needed, and every
 * line is folded at 75 octets as the standard requires.
 */

export interface OutEvent {
  uid: string;
  start: number;
  end: number;
  summary: string;
  description?: string;
  location?: string;
  status: "CONFIRMED" | "TENTATIVE";
  /** Bumped whenever the plan materially changes, so calendars update it. */
  sequence: number;
  /** Last change, for DTSTAMP. */
  stamp: number;
}

export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

const utc = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Fold a content line at 75 octets without splitting a UTF-8 character. */
export function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (size + n > limit) {
      out.push(cur);
      cur = "";
      size = 0;
    }
    cur += ch;
    size += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function buildCalendar(name: string, events: OutEvent[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//More//Family planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${utc(e.stamp)}`,
      `DTSTART:${utc(e.start)}`,
      `DTEND:${utc(e.end)}`,
      `SUMMARY:${escapeText(e.summary)}`,
      ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
      ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
      `STATUS:${e.status}`,
      `SEQUENCE:${e.sequence}`,
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
