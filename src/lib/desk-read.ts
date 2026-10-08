/**
 * The Household Desk's first reader (plan step 1): rule-based, no AI, and it
 * runs in the browser, so a pasted letter never leaves the parent's phone.
 * It only proposes. Nothing reaches the diary until a parent taps Add, and
 * each proposal carries the line it came from so they can check it.
 *
 * The AI reader (step 2) will return the same `Proposal` shape.
 */

export type ProposalKind = "event" | "trip" | "holiday";
/** An event to go to, a deadline to remember, or something mentioned that is probably not worth a diary entry. */
export type ProposalRole = "event" | "deadline" | "optional";

export interface Proposal {
  key: string;
  kind: ProposalKind;
  role: ProposalRole;
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
  /** Before today: shown, but not ticked. Optional items aren't ticked either. */
  past: boolean;
  /** Whether the letter gave the end time; if not, the end shown is an estimate. */
  endStated: boolean;
  /** "Be there by 9:30" when the event starts later. */
  arriveBy: string | null;
  location: string;
  /** What to bring, wear or pay, kept with the entry. */
  details: string;
  repeat: "weekly" | "fortnightly" | "monthly" | null;
  repeatUntil: string | null;
  /** Who it is for, in the letter's words ("Year 4"), when it names someone. */
  forWhom: string | null;
  /** False when the date had to be worked out or could mean more than one day. */
  dateCertain: boolean;
  /** Changes the usual drop-off or collection (an early finish, a late start). */
  pickupChange: boolean;
  /** For a deadline: the title of the event it belongs to. */
  forItem: string | null;
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
const REOPEN_WORDS = /\b(re-?opens?|returns?|back on|back to school|starts? again)\b/i;
const HOLIDAY_WORDS = /\b(half[- ]?term|holidays?|inset|training day|(?:school|nursery|pre-?school|club|setting|centre) (?:will be |is )?closed|closed to (?:pupils|children)|term ends|break up|bank holiday|strike)\b/i;
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
  /** Written with am or pm (or noon), so its half of the day is known. */
  meridiem?: "am" | "pm";
}

function findTimes(line: string): FoundTime[] {
  const out: FoundTime[] = [];
  TIME_RE.lastIndex = 0;
  for (let m = TIME_RE.exec(line); m; m = TIME_RE.exec(line)) {
    let h: number;
    let min: number;
    let meridiem: FoundTime["meridiem"];
    if (m[6]) {
      h = 12;
      min = 0;
      meridiem = "pm";
    } else if (m[3]) {
      h = +m[1];
      min = m[2] ? +m[2] : 0;
      if (h < 1 || h > 12 || min > 59) continue;
      const pm = m[3].toLowerCase().startsWith("p");
      meridiem = pm ? "pm" : "am";
      if (pm && h !== 12) h += 12;
      if (!pm && h === 12) h = 0;
    } else {
      h = +m[4];
      min = +m[5];
    }
    out.push({ start: m.index, end: m.index + m[0].length, time: `${pad(h)}:${pad(min)}`, meridiem });
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
  out.sort((a, b) => a.start - b.start);
  // "6:00-7:15pm": a first time with minutes but no am or pm borrows the
  // second's pm, so the disco is 18:00 to 19:15, not 06:00 to 19:15.
  for (let i = 0; i + 1 < out.length; i++) {
    const [a, b] = [out[i], out[i + 1]];
    if (a.meridiem || b.meridiem !== "pm" || !/^\s*(?:-|–|—|to|until|till)\s*$/i.test(line.slice(a.end, b.start))) continue;
    const h = +a.time.slice(0, 2);
    if (h >= 1 && h < 12 && h + 12 <= +b.time.slice(0, 2)) a.time = `${pad(h + 12)}${a.time.slice(2)}`;
  }
  return out;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

export function childrenIn(text: string, children: ReadContext["children"]): string[] {
  return children
    .filter((c) => c.preferredName.trim().length >= 2 && new RegExp(`\\b${c.preferredName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text))
    .map((c) => c.id);
}

interface Sentence {
  text: string;
  section: number;
  heading: string;
}

const BULLET = /^\s*(?:[*•·▪◦‣-]|\d+[.)])\s+/;
const GENERIC_HEADING = /^(?:looking ahead|important dates|key dates|dates for (?:your|the) diary|diary dates|reminders?|a reminder|news|notices|upcoming events?|this week|next week|coming up|other news|and finally|(?:appointment |booking |order |reservation )?confirm(?:ation|ed)|update|important|information|dates)$/i;
const DEADLINE_WORDS = /\b(deadline|closing date|no later than|rsvp|must be \w+(?: \w+)? by|please\b[^.]{0,60}?\bby|(?:book|booked|pay|paid|return|returned|complete|completed|purchase|purchased|submit|submitted|sign up|register|reply|respond|order|ordered|let (?:us|me|the \w+) know|tell us)\b[^.]{0,40}?\bby|due (?:by|on|before)|(?:is|are) due)\b/i;
// "Please be there by 9:30am" is when to arrive, not a deadline.
const ARRIVE_BY = /\b(?:be (?:there|here|ready|in|on site)|arrive|arriving|get there|be at \w+)\b[^.]{0,20}?\bby\b/gi;
const LAST_DAY = /\b(?:last day|break(?:s|ing)? up|close[sd]?|closing|finish(?:es)? for)\b/i;
const SEASON = /\b(christmas|easter|summer|winter|spring|autumn|february|october|may)\b/i;
const FINISHES_AT = /\b(?:finish\w*|ends?|close[sd]?|closing|pick(?:ing)?[ -]?up|collect\w*)\s+(?:at|by|around|from)?\s*$/i;
// "every Monday until 8 December": the first date is the item; the rest describe the repeat.
const REPEATS = /\b(?:every|each)\s+(?:mon|tues|wednes|thurs|fri|satur|sun)day|\bweekly\b|\bfortnightly\b/i;
const DEADLINE_NOUNS: [RegExp, string][] = [
  [/\b(rsvp|reply|respond|let (?:us|me|the \w+) know|tell us)/i, "reply"],
  [/\bconsent/i, "consent"],
  [/\btickets?\b/i, "ticket"],
  [/\bapplications?\b|\bapply\b/i, "application"],
  [/\bbook(?:ing|ed)?\b|\bslots?\b|\bappointments?\b/i, "booking"],
  [/\bpay(?:ment|ments)?\b|\bpaid\b/i, "payment"],
  [/\bregist(?:er|ration)\b|\bsign up\b/i, "registration"],
  [/\border(?:s|ed)?\b/i, "order"],
  [/\bforms?\b/i, "form"],
];
const OPEN_ENDED = /\b(any ?time from|from\b[^.]*\bonwards|onwards from|until further notice)\b/i;
const CLOSING = /\bclos(?:e|es|ing)\b/i;
// Undated lines that only add a time to the item before them.
const START_HINT = /\b(arriv\w*|start\w*|begin\w*|doors)\b/i;
const END_HINT = /\b(finish\w*|end(?:s|ing)?|return\w*|collect\w*|pick(?:ing)? ?up|until|over by)\b/i;
const HINT_WORDS = /\b(doors|arriv\w*|collect\w*|pick(?:ing)? ?up|drop(?:ping)? ?off|finish\w*|return\w*|end(?:s|ing)?|open\w*|over by)\b/i;
// "Sibling photographs will be taken from 8:15am": the subject of a sentence.
const SUBJECT = /^(?:our |the |a |an |this |next |your )?(.{3,60}?)\s+(?:will|is|are|has been|have been|must|should|can|takes? place|start|starts|begin|begins|run|runs|kicks? off)\b/i;
const NOT_A_SUBJECT = /^(?:we|you|it|they|this|that|there|children|pupils|students|families|parents|everyone|all|please|doors)\b/i;
// "Reception–Year 2: 4:30pm–5:30pm": one session of the event above.
const SESSION = /^([^:]{2,40}):\s*(?=\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?\s*(?:-|–|—|to)\s*\d)/i;

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Text copied from an email, a web page or a chat often carries formatting
 * marks ("### Looking Ahead", "**Saturday 5 December**", <b>, [link](url)).
 * They are not part of what the letter says, so they go before reading.
 */
export function plainText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>\n]{1,200}>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .split("\n")
    .map((line) =>
      line
        // Headings and rules: "### Looking Ahead", "---".
        .replace(/^\s*#{1,6}\s+/, "")
        .replace(/\s+#+\s*$/, "")
        .replace(/^\s*(?:[-*_=]\s*){3,}$/, "")
        // Links and images: keep the words.
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        // Bold, italic, strike and code marks, but not a "* " bullet or a stray asterisk.
        .replace(/(\*\*|__|~~)(?=\S)([^\n]*?\S)\1/g, "$2")
        .replace(/(^|[\s(])([*_])(?=\S)([^*_\n]*?\S)\2(?=[\s).,;:!?]|$)/g, "$1$3")
        .replace(/`([^`]+)`/g, "$1")
        // Table pipes: "| Harvest Assembly | 19 Oct |".
        .replace(/^\s*\|(.*)\|\s*$/, (_, cells: string) => (/^[\s|:-]+$/.test(cells) ? "" : cells.split("|").map((c) => c.trim()).filter(Boolean).join(", ")))
        .replace(/[ \t]+$/, ""),
    )
    .join("\n");
}

function isHeading(line: string): boolean {
  if (line.length > 60 || GREETING.test(line) || BULLET.test(line)) return false;
  // "Half-Term:" on its own line is a heading; "Our evenings will take place on:" leads into a list.
  if (/[.?,;]$/.test(line) || (/:$/.test(line) && /\b(?:will|is|are|was|be|please|following|below|here|on|at|by|from|include)\b/i.test(line))) return false;
  return line.split(/\s+/).length <= 9;
}

/** Lines become sentences, each knowing the heading it sits under. */
function sentencesOf(text: string, today: string): Sentence[] {
  const lines = text
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((l) => l.replace(/^\s*>+\s?/, "").trim())
    .filter(Boolean);
  const greetingAt = lines.findIndex((l) => GREETING.test(l));
  const out: Sentence[] = [];
  // An email's subject is only a last resort for a title, so it doesn't start as a heading.
  let heading = "";
  let section = 0;
  lines.forEach((raw, i) => {
    if (HEADER_LINE.test(raw) || SUBJECT_LINE.test(raw) || NOISE_LINE.test(raw)) return;
    const dated = findDates(raw, today).length > 0;
    // The letter's own date ("Weekly newsletter, Friday 9 October") is not an event.
    if (dated && ((greetingAt > 0 && i < greetingAt) || /\b(newsletter|bulletin)\b/i.test(raw))) return;
    if (!dated && findTimes(raw).length === 0 && isHeading(raw)) {
      // A name above "Dear families" is the letterhead, not a section.
      if (greetingAt > 0 && i < greetingAt) return;
      heading = raw.replace(/[!:\s]+$/, "");
      // "HARVEST ASSEMBLY" reads as "Harvest Assembly".
      if (/[A-Z]{3}/.test(heading) && heading === heading.toUpperCase()) heading = heading.toLowerCase().replace(/(^|[\s(/–-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
      section++;
      return;
    }
    const line = raw.replace(BULLET, "");
    for (const text of line.split(/(?<=[.!?])\s+(?=[A-Z"“‘'(])/)) if (text.trim()) out.push({ text: text.trim(), section, heading });
  });
  return out;
}

function subjectOf(sentence: string): string | null {
  const m = SUBJECT.exec(sentence);
  if (!m || NOT_A_SUBJECT.test(m[1])) return null;
  return capital(m[1].replace(/[,;:]+$/, "").trim());
}

function deadlineTitle(sentence: string, raw: string): string {
  // "Please return the trip consent slip" reads as "Trip consent slip".
  const base =
    capital(
      raw
        .replace(/^(?:please\s+)?(?:(?:return|send(?: in)?|complete|hand in|bring(?: in)?|pay(?: for)?|book|submit|fill in)\s+)?(?:the |your |a |an )?/i, "")
        // "£12.50 for the trip" is the trip's payment; the amount stays in the details.
        .replace(/^£\d+(?:\.\d{2})?\s+(?:for\s+)?(?:the |your |a |an )?/i, "")
        .replace(/[.!,;:]+$/, ""),
    ) || raw;
  const noun = DEADLINE_NOUNS.find(([re]) => re.test(sentence))?.[1] ?? null;
  if (noun === "reply") return `Reply deadline: ${base}`;
  if (!noun || new RegExp(`\\b${noun.slice(0, 5)}`, "i").test(base)) return `${base} deadline`;
  return `${base} ${noun} deadline`;
}

/** "Thank you for booking with Seaview Holiday Park" → "Stay at Seaview Holiday Park". */
function stayAt(body: string): string | null {
  const m = /\b(?:booking|stay|staying|reservation|holiday)\s+(?:with|at)\s+((?:[A-Z][\w'’&-]*\s?){1,5})/.exec(body);
  return m ? `Stay at ${m[1].trim()}` : null;
}

function sameDayEnd(start: string, end: string | undefined, minutes: number): string {
  if (end && end > start) return end;
  const total = Math.min(+start.slice(0, 2) * 60 + +start.slice(3) + minutes, 23 * 60 + 59);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

const MONEY = /£\s?\d+(?:\.\d{2})?/g;
const KIT = /\b(?:bring|wear|packed lunch|pe kit|kit|uniform|costume|waterproof\w*|wellies|non-uniform)\b/i;
const FOR_WHOM = /\b(?:year\s?\d{1,2}(?:\s?(?:-|–|and|&)\s?(?:year\s?)?\d{1,2})?|reception|nursery|class\s\w+|ks[12])\b/i;
const EARLY = /\b(?:early|clos\w*|finish\w*)\b/i;

/** What to bring or pay, from the sentence itself: the amounts and the kit words, as the letter says them. */
function detailsOf(sentence: string): string {
  const amounts = sentence.match(MONEY) ?? [];
  if (!amounts.length && !KIT.test(sentence)) return "";
  return sentence.length > 200 ? `${sentence.slice(0, 199)}…` : sentence;
}

function repeatOf(sentence: string): Proposal["repeat"] {
  if (/\bfortnightly\b|\bevery (?:other|second)\b/i.test(sentence)) return "fortnightly";
  if (/\bmonthly\b|\bevery month\b/i.test(sentence)) return "monthly";
  return REPEATS.test(sentence) ? "weekly" : null;
}

/**
 * Read a pasted email or letter into proposed diary items. Deterministic:
 * the same text and day always give the same proposals.
 */
export function readLetter(text: string, ctx: ReadContext): Proposal[] {
  const body = plainText(text.slice(0, 20_000));
  const sentences = sentencesOf(body, ctx.today);
  const subject = body.split(/\n/).find((l) => SUBJECT_LINE.test(l))?.replace(SUBJECT_LINE, "").trim() ?? "";
  const letterChildren = childrenIn(body, ctx.children);
  const isTrip = TRIP_WORDS.test(body);
  const out: (Proposal & { section: number; explicitEnd: boolean; sessions: number })[] = [];
  const headingUsed = new Set<number>();

  type Pushed = Omit<Proposal, "key" | "childIds" | "past" | "endStated" | "arriveBy" | "location" | "details" | "repeat" | "repeatUntil" | "forWhom" | "dateCertain" | "pickupChange" | "forItem"> & {
    section: number;
    explicitEnd: boolean;
    pickupChange?: boolean;
  };
  const push = (p: Pushed, sentence: string) => {
    const lineChildren = childrenIn(sentence, ctx.children);
    out.push({
      ...p,
      endStated: p.explicitEnd,
      arriveBy: null,
      location: "",
      details: detailsOf(sentence),
      repeat: p.kind === "event" && p.role === "event" ? repeatOf(sentence) : null,
      repeatUntil: null,
      forWhom: sentence.match(FOR_WHOM)?.[0] ?? null,
      dateCertain: true,
      pickupChange: p.pickupChange ?? false,
      forItem: null,
      key: "",
      sessions: 0,
      childIds: lineChildren.length ? lineChildren : p.kind === "holiday" ? (letterChildren.length ? letterChildren : ctx.children.map((c) => c.id)) : letterChildren,
      source: sentence.length > 240 ? `${sentence.slice(0, 239)}…` : sentence,
      past: p.endDate < ctx.today,
    });
  };

  for (const s of sentences) {
    const line = s.text;
    const dates = findDates(line, ctx.today);
    const times = findTimes(line);
    const heading = s.heading && !GENERIC_HEADING.test(s.heading) ? s.heading : "";
    const last = out.at(-1);
    const sameSection = last && last.section === s.section && last.role === "event" && last.kind === "event";

    if (!dates.length) {
      if (!sameSection || !times.length) continue;
      // A session of the event above: "Years 3–6: 6:00pm–7:15pm".
      const session = SESSION.exec(line);
      if (session && times.length >= 2) {
        const parent = out.filter((p) => p.section === s.section && p.role === "event").at(0)!;
        parent.sessions++;
        push({ kind: "event", role: "event", title: `${parent.title} — ${session[1].trim()}`, startDate: parent.startDate, endDate: parent.endDate, startTime: times[0].time, endTime: times[1].time, source: line, section: s.section, explicitEnd: true }, line);
        continue;
      }
      // Another thing on the same day: "Sibling photographs will be taken from 8:15am".
      const who = subjectOf(line);
      if (who && !HINT_WORDS.test(line)) {
        push({ kind: "event", role: "event", title: who, startDate: last.startDate, endDate: last.endDate, startTime: times[0].time, endTime: sameDayEnd(times[0].time, times[1]?.time, 60), source: line, section: s.section, explicitEnd: !!times[1] && times[1].time > times[0].time }, line);
        continue;
      }
      // A time for the item above: "arrive at 8:45am and return by 3:45pm", "finish by 10:00am".
      if (!last.startTime && START_HINT.test(line)) {
        last.startTime = times[0].time;
        last.endTime = sameDayEnd(times[0].time, times[1]?.time, 60);
        last.explicitEnd = !!times[1];
        last.source = `${last.source} ${line}`;
      } else if (last.startTime && !last.explicitEnd && END_HINT.test(line)) {
        const end = times.at(-1)!.time;
        if (end > last.startTime) {
          last.endTime = end;
          last.explicitEnd = true;
          last.source = `${last.source} ${line}`;
        }
      }
      continue;
    }

    // Two dates joined by "to" or "-" are one span.
    const spans: { from: string; to: string; at: number }[] = [];
    // "Closes on Friday 19 December and reopens on Monday 5 January": the break is the days between.
    const closingSpan = (HOLIDAY_WORDS.test(line) || LAST_DAY.test(line)) && REOPEN_WORDS.test(line) && dates.length === 2 && !dates[0].rangeTo && daysBetween(dates[0].date, dates[1].date) >= 2 && daysBetween(dates[0].date, dates[1].date) <= 60;
    if (closingSpan) spans.push({ from: addDays(dates[0].date, 1), to: addDays(dates[1].date, -1), at: dates[0].start });
    for (let i = 0; i < (closingSpan ? 0 : dates.length); i++) {
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
    if (REPEATS.test(line)) spans.splice(1);
    const cut = [...dates, ...times];
    // "There's no training on 28 October" reads as "No training".
    const cleaned = titleFrom(line, cut, "").replace(/^there(?:'s|’s| is| will be)\s+/i, "");
    const named = subjectOf(cleaned) ?? subjectOf(line.slice(0, dates[0].start));
    const cause = new RegExp(`\\b(?:due to|because of|owing to|during|over)\\s+(?:the\\s+)?${HOLIDAY_WORDS.source}`, "i");
    const isBreak = (HOLIDAY_WORDS.test(line) && !cause.test(line)) || /\bno school\b/i.test(line);

    for (const span of spans) {
      const single = span.from === span.to;
      // "£12.50" has a full stop that isn't the end of the sentence.
      const deadline = single && DEADLINE_WORDS.test(line.replace(ARRIVE_BY, "").replace(/(\d)\.(\d)/g, "$1,$2"));
      // "School will close at 1:30pm on Friday 19 December for Christmas": an early finish, which changes a pickup.
      const earlyClose =
        !deadline && single && times.length === 1 && EARLY.test(line) && CLOSING.test(line) && !REOPEN_WORDS.test(line) && (HOLIDAY_WORDS.test(line) || SEASON.test(line) || /\bearly\b/i.test(line));
      // "School will close for half-term at 3:15pm on Friday 23 October" repeats the break; "any time from Monday" has no event.
      const optional = !deadline && (earlyClose || (single && OPEN_ENDED.test(line)) || (single && CLOSING.test(line) && HOLIDAY_WORDS.test(line) && times.length > 0 && !REOPEN_WORDS.test(line)));
      const kind: ProposalKind = deadline || optional ? "event" : isTrip && TRIP_WORDS.test(line) ? "trip" : isBreak || closingSpan ? "holiday" : "event";
      const role: ProposalRole = deadline ? "deadline" : optional ? "optional" : "event";

      let title: string;
      if (deadline) title = deadlineTitle(line, heading || named || cleaned || "Reply");
      else if (optional && CLOSING.test(line) && HOLIDAY_WORDS.test(line)) title = `School closes for ${(line.match(HOLIDAY_WORDS)?.[0] ?? "the break").toLowerCase()}`;
      else if (earlyClose) title = SEASON.test(line) ? `School closes for ${capital(line.match(SEASON)![1].toLowerCase())}` : "School closes early";
      else if (optional) title = named ?? (cleaned || heading || "From the letter");
      else if (kind === "holiday" && closingSpan) title = heading && !headingUsed.has(s.section) ? heading : `${capital(line.match(SEASON)?.[1]?.toLowerCase() ?? "school")} holidays`;
      else if (kind === "holiday" && !(heading && !headingUsed.has(s.section)) && named && named.split(/\s+/).length < 3) title = capital(cleaned.replace(/^(?:the|our)\s+/i, "").replace(/\s+(?:will be|is)\s+closed\b/i, " closed"));
      else if (heading && !headingUsed.has(s.section)) title = heading;
      else if (heading && !named && cleaned.length < 4) title = heading;
      else title = named ?? (cleaned || heading || subject || "From the letter");
      // "Flu vaccinations on 14 Oct and school photos on 21 Oct": each date takes the words just before it.
      if (spans.length > 1 && !REPEATS.test(line) && !deadline && !optional && kind === "event") {
        const i = spans.indexOf(span);
        const prev = i === 0 ? null : dates.find((d) => d.start === spans[i - 1].at);
        const from = prev ? prev.end : 0;
        const segment = line.slice(from, span.at).replace(/^[\s,;]*(?:and|&|then|also)?\s+/i, "");
        const own = titleFrom(segment, times.filter((t) => t.start >= from && t.end <= span.at).map((t) => ({ start: t.start - from, end: t.end - from })), "");
        if (own.length >= 3) title = own;
      }
      if (role === "event" && heading && title === heading) headingUsed.add(s.section);

      // "Last day of term, school finishes at 2pm": the time is when it ends, so the day stays whole and the title keeps it.
      const endsAt = role === "event" && times.length === 1 && FINISHES_AT.test(line.slice(0, times[0].start));
      if (endsAt && title === cleaned) title = titleFrom(line, dates, cleaned).replace(/^there(?:'s|’s| is| will be)\s+/i, "");
      const timed = kind !== "holiday" && times.length > 0 && !endsAt;
      const startTime = timed ? times[0].time : null;
      // "8pm until 1am" ends the next morning.
      const overnight = single && !!startTime && !!times[1] && times[1].time < startTime && times[1].time <= "06:00";
      const endTime = overnight ? times[1].time : startTime ? sameDayEnd(startTime, single ? times[1]?.time : (times[1]?.time ?? startTime), deadline ? 15 : 60) : null;
      const explicitEnd = !!times[1] && !!startTime && (overnight || times[1].time > startTime);
      push(
        {
          kind,
          role,
          title: titleFrom(title, [], title),
          startDate: span.from,
          endDate: overnight ? addDays(span.to, 1) : span.to,
          startTime,
          endTime,
          source: line,
          section: s.section,
          explicitEnd,
          pickupChange: earlyClose || endsAt || (optional && CLOSING.test(line) && times.length > 0),
        },
        line,
      );
    }
  }

  // An event split into sessions is the sessions, not the umbrella line.
  let result: Proposal[] = out.filter((p) => !(p.sessions > 0 && p.startTime === null));

  // A booking's outward and return legs are one trip.
  const legs = result.filter((p) => p.kind === "trip");
  if (legs.length > 1) {
    const first = legs.reduce((a, b) => (`${b.startDate}${b.startTime ?? ""}` < `${a.startDate}${a.startTime ?? ""}` ? b : a));
    const last = legs.reduce((a, b) => (`${b.endDate}${b.endTime ?? ""}` > `${a.endDate}${a.endTime ?? ""}` ? b : a));
    const trip: Proposal = {
      ...first,
      title: subject ? titleFrom(subject, [], "Trip") : (stayAt(body) ?? first.title),
      endDate: last.endDate,
      // "Check-out by 10am" is the end, not the start of an hour.
      endTime: (last as Proposal & { explicitEnd?: boolean }).explicitEnd || last === first ? last.endTime : last.startTime,
      source: legs.map((l) => l.source).join(" … "),
      past: last.endDate < ctx.today,
    };
    result = [trip, ...result.filter((p) => p.kind !== "trip")];
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
    .map((p, i) => ({
      kind: p.kind,
      role: p.role,
      title: p.title,
      startDate: p.startDate,
      endDate: p.endDate,
      startTime: p.startTime,
      endTime: p.endTime,
      childIds: p.childIds,
      source: p.source,
      past: p.past,
      endStated: (p as Proposal & { explicitEnd?: boolean }).explicitEnd ?? p.endStated,
      arriveBy: p.arriveBy,
      location: p.location,
      details: p.details,
      repeat: p.repeat,
      repeatUntil: p.repeatUntil,
      forWhom: p.forWhom,
      dateCertain: p.dateCertain,
      pickupChange: p.pickupChange,
      forItem: p.forItem,
      key: `p${i}`,
    }));
}
