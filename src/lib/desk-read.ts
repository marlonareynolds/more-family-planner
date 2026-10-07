/**
 * The Household Desk's first reader (plan step 1): rule-based, no AI, and it
 * runs in the browser, so a pasted letter never leaves the parent's phone.
 * It only proposes. Nothing reaches the diary until a parent taps Add, and
 * each proposal carries the line it came from so they can check it.
 *
 * The AI reader (step 2) will return the same `Proposal` shape.
 */

export type ProposalKind = "event" | "trip" | "holiday";

export interface Proposal {
  key: string;
  kind: ProposalKind;
  title: string;
  /** Local dates; `endDate` is the last day, inclusive. */
  startDate: string;
  endDate: string;
  /** Local times, or null for an all-day item. */
  startTime: string | null;
  endTime: string | null;
  childIds: string[];
  /** The line of the letter this came from, shown on the card. */
  source: string;
  /** Before today: shown, but not ticked. */
  past: boolean;
}

export interface ReadContext {
  /** Today in the household's time zone, YYYY-MM-DD. */
  today: string;
  children: { id: string; preferredName: string }[];
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const WEEKDAY = "(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\\.?,?\\s+";
const ORD = "(?:st|nd|rd|th)?";

const DATE_PATTERNS: { re: RegExp; parts: (m: RegExpExecArray) => { d: number; m: number; y: number | null } }[] = [
  // 2026-10-17
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/gi, parts: (m) => ({ y: +m[1], m: +m[2], d: +m[3] }) },
  // Friday 17th October 2026, 17 Oct
  { re: new RegExp(`\\b(?:${WEEKDAY})?(\\d{1,2})${ORD}\\s+(?:of\\s+)?${MONTH}\\.?,?(?:\\s+(\\d{4}))?\\b`, "gi"), parts: (m) => ({ d: +m[1], m: monthOf(m[2]), y: m[3] ? +m[3] : null }) },
  // Friday, October 17th, 2026
  { re: new RegExp(`\\b(?:${WEEKDAY})?${MONTH}\\.?\\s+(\\d{1,2})${ORD},?(?:\\s+(\\d{4}))?\\b`, "gi"), parts: (m) => ({ m: monthOf(m[1]), d: +m[2], y: m[3] ? +m[3] : null }) },
  // 17/10/2026, 17/10/26, 17/10 (UK order). Dots only with a year, so 3.30 stays a time.
  { re: /\b(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\.?,?\s+)?(\d{1,2})(?:\/(\d{1,2})(?:\/(\d{2}|\d{4}))?|\.(\d{1,2})\.(\d{2}|\d{4}))\b/gi, parts: (m) => {
    const month = m[2] ?? m[4];
    const year = m[3] ?? m[5];
    return { d: +m[1], m: +month, y: year ? (year.length === 2 ? 2000 + +year : +year) : null };
  } },
];

const RANGE_GAP = /^\s*(?:-|–|—|to|until|till|through|and)\s*$/i;
// "20 - 24 October": the first day borrows the second date's month.
const SHORT_RANGE = new RegExp(`\\b(?:${WEEKDAY})?(\\d{1,2})${ORD}\\s*(?:-|–|—|to|until|till)\\s*(?=(?:${WEEKDAY})?\\d{1,2}${ORD}\\s+(?:of\\s+)?${MONTH})`, "gi");

const TIME_RE = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)|\b([01]?\d|2[0-3]):([0-5]\d)\b|\b(noon|midday)\b/gi;

const HEADER_LINE = /^\s*(?:>+\s*)?(?:from|to|cc|bcc|sent|date|reply-to)\s*:/i;
const SUBJECT_LINE = /^\s*(?:>+\s*)?subject\s*:\s*(?:(?:re|fw|fwd)\s*:\s*)*/i;
const NOISE_LINE = /^\s*(?:sent from my|get outlook for|-{2,}\s*forwarded message|begin forwarded message|on .+ wrote:$)/i;

const GREETING = /^(?:dear|hi|hello|good (?:morning|afternoon)|thanks|thank you|kind regards|best wishes|regards|yours)\b/i;
const REPLY_WORDS = /\b(rsvp|reply|respond|let (?:us|me) know|return (?:the|your) .+ by|deadline|book by|pay by|sign up by)\b/i;
const REOPEN_WORDS = /\b(re-?opens?|returns?|back on|back to school|starts? again)\b/i;
const HOLIDAY_WORDS = /\b(half[- ]?term|holidays?|inset|training day|school (?:is )?closed|closed to pupils|term ends|break up|bank holiday|strike)\b/i;
const TRIP_WORDS = /\b(flights?|depart(?:s|ure|ing)?|arriv(?:e|al|ing)|check[- ]?in|check[- ]?out|hotel|boarding|itinerary|outbound|return journey|booking (?:ref|reference|confirmation)|terminal|gate closes)\b/i;

function monthOf(word: string): number {
  return MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** A date with no year is the next one: letters are about what's coming. */
function withYear(m: number, d: number, today: string): string | null {
  const y = +today.slice(0, 4);
  for (const year of [y, y + 1]) {
    if (!validDate(year, m, d)) continue;
    const date = iso(year, m, d);
    if (daysBetween(today, date) >= -14) return date;
  }
  return null;
}

interface Found {
  start: number;
  end: number;
  date: string;
  /** Set when "20 - 24 October" gives the first day of a range. */
  rangeTo?: string;
}

function findDates(line: string, today: string): Found[] {
  const found: Found[] = [];
  for (const { re, parts } of DATE_PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      const p = parts(m);
      let date: string | null = null;
      if (p.y !== null) date = validDate(p.y, p.m, p.d) ? iso(p.y, p.m, p.d) : null;
      else date = withYear(p.m, p.d, today);
      if (!date) continue;
      const start = m.index;
      const end = m.index + m[0].length;
      // The first pattern to claim some text wins.
      if (found.some((f) => start < f.end && end > f.start)) continue;
      found.push({ start, end, date });
    }
  }
  // "20 - 24 October": give the bare first day the second date's month and year.
  SHORT_RANGE.lastIndex = 0;
  for (let m = SHORT_RANGE.exec(line); m; m = SHORT_RANGE.exec(line)) {
    const start = m.index;
    const end = m.index + m[0].length;
    const next = found.find((f) => f.start === end);
    if (!next || found.some((f) => start < f.end && end > f.start)) continue;
    const [y, mo] = next.date.split("-").map(Number);
    const d = +m[1];
    if (!validDate(y, mo, d) || iso(y, mo, d) > next.date) continue;
    found.push({ start, end: next.end, date: iso(y, mo, d), rangeTo: next.date });
    found.splice(found.indexOf(next), 1);
  }
  return found.sort((a, b) => a.start - b.start);
}

interface FoundTime {
  start: number;
  end: number;
  time: string;
}

function findTimes(line: string): FoundTime[] {
  const out: FoundTime[] = [];
  TIME_RE.lastIndex = 0;
  for (let m = TIME_RE.exec(line); m; m = TIME_RE.exec(line)) {
    let h: number;
    let min: number;
    if (m[6]) {
      h = 12;
      min = 0;
    } else if (m[3]) {
      h = +m[1];
      min = m[2] ? +m[2] : 0;
      if (h < 1 || h > 12 || min > 59) continue;
      const pm = m[3].toLowerCase().startsWith("p");
      if (pm && h !== 12) h += 12;
      if (!pm && h === 12) h = 0;
    } else {
      h = +m[4];
      min = +m[5];
    }
    out.push({ start: m.index, end: m.index + m[0].length, time: `${pad(h)}:${pad(min)}` });
  }
  // "3 - 5pm": the first number borrows the second's am or pm.
  const bare = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(?:-|–|to)\s*(?=\d{1,2}(?:[:.]\d{2})?\s*(am|pm))/gi;
  for (let m = bare.exec(line); m; m = bare.exec(line)) {
    const from = m.index;
    const upTo = from + m[0].length;
    const after = out.find((t) => t.start >= upTo);
    if (!after || out.some((t) => t.start <= from && t.end > from)) continue;
    let h = +m[1];
    const min = m[2] ? +m[2] : 0;
    if (h < 1 || h > 12 || min > 59) continue;
    if (m[3].toLowerCase() === "pm" && h !== 12 && h + 12 <= +after.time.slice(0, 2)) h += 12;
    out.push({ start: from, end: from + m[1].length + (m[2] ? m[2].length + 1 : 0), time: `${pad(h)}:${pad(min)}` });
  }
  return out.sort((a, b) => a.start - b.start);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function plusHour(time: string): string {
  const h = Math.min(+time.slice(0, 2) + 1, 23);
  return `${pad(h)}:${time.slice(3)}`;
}

/** What's left of the line once dates and times are taken out. */
function titleFrom(line: string, cut: { start: number; end: number }[], fallback: string): string {
  let out = "";
  let at = 0;
  for (const c of [...cut].sort((a, b) => a.start - b.start)) {
    if (c.start < at) continue;
    // Drop the little word that led into a date or time ("at", "on"), and gaps that were only "to" or "and".
    const piece = line.slice(at, c.start).replace(/\b(?:on|at|from|by|until|till|to|and|between|starting|begins?|for)\s*$/i, "");
    if (!/^[\s,;:\-–—]*$/.test(piece)) out += `${piece} `;
    at = c.end;
  }
  out += line.slice(at);
  let cleaned = out.replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ");
  // Strip connectors left dangling by the cut ("from  to ."), until nothing changes.
  for (let before = ""; before !== cleaned; ) {
    before = cleaned;
    cleaned = cleaned
      .replace(/^[\s>*•·\-–—:]+/, "")
      .replace(/\s*\b(?:on|from|at|by|until|till|to|between|and|starting|begins?|is|are|will be|runs?)\s*(?=[,.;:!]|$)/gi, "")
      .replace(/\s*[,;:\-–—]\s*(?=[,;:.!]|$)/g, "")
      .replace(/^\s*(?:on|from|at|by)\s+/i, "")
      .replace(/[\s,;:\-–—]+$/, "")
      .replace(/\s+(?=[.,;:!])/g, "")
      .replace(/^[.,;:!]+|(?<=[.,;:!])[.,;:!]+$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  // A single sentence reads better without its full stop.
  if (/^[^.!?]+\.$/.test(cleaned)) cleaned = cleaned.slice(0, -1);
  const text = cleaned.length >= 3 ? cleaned : fallback;
  if (text.length <= 80) return text.charAt(0).toUpperCase() + text.slice(1);
  const cut80 = text.slice(0, 79);
  return `${cut80.slice(0, cut80.lastIndexOf(" ") > 40 ? cut80.lastIndexOf(" ") : 79)}…`;
}

/** The title comes from the sentence the date is in, not the instructions around it. */
function sentenceTitle(line: string, cut: { start: number; end: number }[], at: number, fallback: string): string {
  let from = 0;
  let to = line.length;
  const ends = /[.!?](?=\s+[A-Z])/g;
  for (let m = ends.exec(line); m; m = ends.exec(line)) {
    if (m.index < at) from = m.index + 1;
    else {
      to = m.index + 1;
      break;
    }
  }
  const inside = cut.filter((c) => c.start >= from && c.end <= to).map((c) => ({ start: c.start - from, end: c.end - from }));
  return titleFrom(line.slice(from, to), inside, fallback);
}

function childrenIn(text: string, children: ReadContext["children"]): string[] {
  return children
    .filter((c) => c.preferredName.trim().length >= 2 && new RegExp(`\\b${c.preferredName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text))
    .map((c) => c.id);
}

function splitLines(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split(/\n+/)
    .flatMap((l) => (l.length > 160 ? l.split(/(?<=[.!?])\s+(?=[A-Z])/) : [l]))
    .map((l) => l.replace(/^\s*>+\s?/, "").trim())
    .filter(Boolean);
}

/**
 * Read a pasted email or letter into proposed diary items. Deterministic:
 * the same text and day always give the same proposals.
 */
export function readLetter(text: string, ctx: ReadContext): Proposal[] {
  const lines = splitLines(text.slice(0, 20_000));
  const subject = lines.find((l) => SUBJECT_LINE.test(l))?.replace(SUBJECT_LINE, "").trim() ?? "";
  const letterChildren = childrenIn(text, ctx.children);
  const isTrip = TRIP_WORDS.test(text);
  const out: Proposal[] = [];
  let heading = subject;

  for (const line of lines) {
    if (HEADER_LINE.test(line) || SUBJECT_LINE.test(line) || NOISE_LINE.test(line)) continue;
    const dates = findDates(line, ctx.today);
    if (!dates.length) {
      // A short undated line is likely a heading for what follows.
      if (line.length <= 80 && !GREETING.test(line)) heading = titleFrom(line, [], line);
      continue;
    }
    const times = findTimes(line);
    const cut = [...dates, ...times];
    // Two dates joined by "to" or "-" are one span.
    const spans: { from: string; to: string; at: number }[] = [];
    // "Closes on Friday 19 December and reopens on Monday 5 January": the break is the days between.
    const closing = HOLIDAY_WORDS.test(line) && REOPEN_WORDS.test(line) && dates.length === 2 && !dates[0].rangeTo && daysBetween(dates[0].date, dates[1].date) >= 2 && daysBetween(dates[0].date, dates[1].date) <= 60;
    if (closing) spans.push({ from: addDays(dates[0].date, 1), to: addDays(dates[1].date, -1), at: dates[0].start });
    for (let i = 0; i < (closing ? 0 : dates.length); i++) {
      const d = dates[i];
      if (d.rangeTo) {
        spans.push({ from: d.date, to: d.rangeTo, at: d.start });
        continue;
      }
      const next = dates[i + 1];
      if (next && !next.rangeTo && RANGE_GAP.test(line.slice(d.end, next.start)) && next.date >= d.date && daysBetween(d.date, next.date) <= 60) {
        spans.push({ from: d.date, to: next.date, at: d.start });
        i++;
      } else {
        spans.push({ from: d.date, to: d.date, at: d.start });
      }
    }
    const lineChildren = childrenIn(line, ctx.children);
    for (const s of spans) {
      const reply = REPLY_WORDS.test(line) && s.from === s.to;
      const kind: ProposalKind = reply ? "event" : isTrip && TRIP_WORDS.test(line) ? "trip" : HOLIDAY_WORDS.test(line) ? "holiday" : "event";
      const timed = kind !== "holiday" && !reply && times.length > 0;
      const startTime = timed ? times[0].time : null;
      let endTime = timed ? (times[1]?.time ?? plusHour(times[0].time)) : null;
      if (startTime && endTime && s.from === s.to && endTime <= startTime) endTime = plusHour(startTime);
      out.push({
        key: "",
        kind,
        title: reply ? titleFrom(`Reply: ${heading || sentenceTitle(line, cut, s.at, "the letter")}`, [], "Reply") : sentenceTitle(line, cut, s.at, heading || "From the letter"),
        startDate: s.from,
        endDate: s.to,
        startTime,
        endTime,
        childIds: lineChildren.length ? lineChildren : kind === "holiday" ? (letterChildren.length ? letterChildren : ctx.children.map((c) => c.id)) : letterChildren,
        source: line.length > 240 ? `${line.slice(0, 239)}…` : line,
        past: s.to < ctx.today,
      });
    }
  }

  // A booking's outward and return legs are one trip.
  const legs = out.filter((p) => p.kind === "trip");
  let result = out;
  if (legs.length > 1) {
    const first = legs.reduce((a, b) => (`${b.startDate}${b.startTime ?? ""}` < `${a.startDate}${a.startTime ?? ""}` ? b : a));
    const last = legs.reduce((a, b) => (`${b.endDate}${b.endTime ?? ""}` > `${a.endDate}${a.endTime ?? ""}` ? b : a));
    const trip: Proposal = {
      ...first,
      title: subject ? titleFrom(subject, [], "Trip") : first.title,
      endDate: last.endDate,
      endTime: last.endTime ?? last.startTime,
      source: legs.map((l) => l.source).join(" … "),
      past: last.endDate < ctx.today,
    };
    result = [trip, ...out.filter((p) => p.kind !== "trip")];
  }

  // The same thing mentioned twice is one item.
  const seen = new Set<string>();
  return result
    .filter((p) => {
      const id = `${p.kind}|${p.startDate}|${p.endDate}|${p.startTime}|${p.title.toLowerCase()}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((p, i) => ({ ...p, key: `p${i}` }));
}
