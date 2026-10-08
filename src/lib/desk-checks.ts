import type { Proposal } from "./desk-read";

/**
 * What a parent must see before a Desk card enters the diary (quality
 * release, priority 3). A missing time is never quietly turned into a
 * one-hour event, an unclear date is never dropped, and a pickup change or a
 * payment needs a deliberate choice rather than a default.
 *
 * `decide`: the card can't be added until the person has answered it.
 */
export type CheckCode = "time_not_stated" | "estimated_end" | "no_cut_off" | "date_unclear" | "pickup" | "payment" | "which_child" | "not_in_letter";

export interface DeskCheck {
  code: CheckCode;
  text: string;
  decide: boolean;
}

const PAYMENT = /£\s?\d|\bpay(?:ment|ing|s)?\b|\bparentpay\b|\bscopay\b|\bcheque\b|\bcash\b|\bcost(?:s)?\b/i;
const FOR_A_CHILD = /\b(?:your child|year\s?\d|reception|nursery|class\s\w+|pupils? in)\b/i;

/** Letters copied from email carry formatting; compare words only. */
function words(text: string): string {
  return text
    .toLowerCase()
    .replace(/[*_#>|`~]/g, " ")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9£'"]+/g, " ")
    .trim();
}

export function plusMinutes(time: string, minutes: number): string {
  const total = Math.min(+time.slice(0, 2) * 60 + +time.slice(3) + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function checksFor(
  p: Pick<Proposal, "kind" | "role" | "startTime" | "endTime" | "endStated" | "dateCertain" | "pickupChange" | "forWhom" | "childIds" | "source" | "title" | "details">,
  ctx: { children: { id: string }[]; letter: string | null },
): DeskCheck[] {
  const out: DeskCheck[] = [];
  if (!p.dateCertain) out.push({ code: "date_unclear", text: "The date was worked out from the letter. Check it before adding.", decide: true });
  if (p.pickupChange) out.push({ code: "pickup", text: "This changes a pickup. Choose who collects, or leave it out.", decide: true });
  if (p.role === "deadline" && PAYMENT.test(`${p.title} ${p.details} ${p.source}`)) out.push({ code: "payment", text: "A payment. Choose who will pay it.", decide: true });
  if (p.kind !== "holiday" && ctx.children.length > 1 && p.childIds.length === 0 && (p.forWhom || FOR_A_CHILD.test(p.source))) {
    out.push({ code: "which_child", text: p.forWhom ? `For ${p.forWhom}. Check which child.` : "Check which child this is for.", decide: true });
  }
  if (ctx.letter !== null && p.source && !words(ctx.letter).includes(words(p.source))) {
    out.push({ code: "not_in_letter", text: "This line isn't word for word in the letter. Check it against the letter.", decide: true });
  }
  if (p.kind === "event" && p.role !== "deadline" && !p.startTime && !p.pickupChange) out.push({ code: "time_not_stated", text: "Time not stated, so it goes in as all day.", decide: false });
  if (p.kind === "event" && p.role !== "deadline" && p.startTime && !p.endStated) out.push({ code: "estimated_end", text: `End time not stated. Shown as ${p.endTime ?? plusMinutes(p.startTime, 60)}, an estimate.`, decide: false });
  if (p.role === "deadline" && !p.startTime) out.push({ code: "no_cut_off", text: "No time given, so it's due any time that day.", decide: false });
  return out;
}

/** The lines kept in the entry's notes, so the diary remembers what the letter didn't say. */
export function noteLines(checks: DeskCheck[]): string[] {
  return checks.flatMap((c) =>
    c.code === "time_not_stated" ? ["Time not stated in the letter."] : c.code === "estimated_end" ? ["End time not stated in the letter; estimated."] : c.code === "date_unclear" ? ["Date worked out from the letter; checked when added."] : [],
  );
}
