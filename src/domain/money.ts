import { DomainError } from "./errors";

/**
 * Money (spec 8.9, INV-09): integer minor units with a currency, never
 * binary floating point. One real cost has one identity; payments and
 * refunds are appended transactions.
 */

export type Currency = "GBP";

export function parseMinor(input: string): number {
  const s = input.trim().replace(/^£/, "").replace(/,/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) throw new DomainError("VALIDATION", "Enter an amount like 12.50.");
  const [pounds, pence = ""] = s.split(".");
  return Number(pounds) * 100 + Number(pence.padEnd(2, "0"));
}

export function formatMinor(minor: number, currency: Currency = "GBP"): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
}

/**
 * Split `total` across weights so the parts sum exactly to `total`
 * (largest remainder; ties go to earlier entries).
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  if (!Number.isInteger(total)) throw new DomainError("VALIDATION", "Amounts must be whole minor units.");
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new DomainError("VALIDATION", "Allocation weights must be positive.");
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map(Math.floor);
  let remainder = total - parts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    parts[i]++;
    remainder--;
  }
  return parts;
}

export type TransactionKind = "payment" | "refund" | "adjustment";

export interface MoneyTransaction {
  id: string;
  kind: TransactionKind;
  /** Always positive; the kind gives the direction. Adjustments may be negative. */
  amountMinor: number;
}

export interface ExpenseSummary {
  estimateMinor: number | null;
  committedMinor: number | null;
  paidMinor: number;
  refundedMinor: number;
  netPaidMinor: number;
  /** Committed cost still to pay; never negative. */
  remainingMinor: number | null;
}

export function summarise(
  expense: { estimateMinor: number | null; committedMinor: number | null },
  transactions: readonly MoneyTransaction[],
): ExpenseSummary {
  let paid = 0;
  let refunded = 0;
  let adjustment = 0;
  for (const t of transactions) {
    if (t.kind === "payment") paid += t.amountMinor;
    else if (t.kind === "refund") refunded += t.amountMinor;
    else adjustment += t.amountMinor;
  }
  const netPaid = paid - refunded + adjustment;
  const remaining = expense.committedMinor === null ? null : Math.max(0, expense.committedMinor - netPaid);
  return {
    estimateMinor: expense.estimateMinor,
    committedMinor: expense.committedMinor,
    paidMinor: paid,
    refundedMinor: refunded,
    netPaidMinor: netPaid,
    remainingMinor: remaining,
  };
}

export function assertRefundAllowed(summary: ExpenseSummary, refundMinor: number): void {
  if (refundMinor > summary.netPaidMinor) {
    throw new DomainError("VALIDATION", "A refund cannot exceed what has been paid.");
  }
}

export interface WeekSpend {
  /** Paid so far, less refunds. */
  paidMinor: number;
  /** Agreed but not yet paid. */
  toPayMinor: number;
  /** Only a guess so far: no amount agreed, nothing paid. */
  estimatedMinor: number;
  /** Everything known, each cost counted once at its firmest figure. */
  knownMinor: number;
  /** Costs entered with no amount at all: unknown, not free. */
  unknownCosts: number;
}

/**
 * The week's shared costs against a guide. Each cost counts once, at its
 * firmest figure: what's been paid and what's still owed on an agreed
 * amount, or else the estimate. A cost with no figure is unknown, which
 * is not the same as free.
 */
export function weekSpend(costs: readonly Pick<ExpenseSummary, "estimateMinor" | "committedMinor" | "netPaidMinor" | "remainingMinor">[]): WeekSpend {
  const out: WeekSpend = { paidMinor: 0, toPayMinor: 0, estimatedMinor: 0, knownMinor: 0, unknownCosts: 0 };
  for (const c of costs) {
    const paid = Math.max(0, c.netPaidMinor);
    out.paidMinor += paid;
    if (c.committedMinor !== null) out.toPayMinor += c.remainingMinor ?? Math.max(0, c.committedMinor - paid);
    else if (paid === 0 && c.estimateMinor !== null) out.estimatedMinor += c.estimateMinor;
    else if (paid === 0) out.unknownCosts += 1;
  }
  out.knownMinor = out.paidMinor + out.toPayMinor + out.estimatedMinor;
  return out;
}
