/**
 * For Us ideas are private to each partner (Marlon, 7 October 2026: "the
 * couples shouldn't see each other's suggestions"). Instead of recording
 * what each person was shown, every idea belongs to exactly one adult of the
 * household, for good: the two shelves never overlap, so nothing one partner
 * sends can be recognised as the app's suggestion to the other.
 *
 * The split is a stable shuffle by household, dealt alternately, so each
 * adult gets half of every list (one more, at most) and a new idea added to
 * the catalogue lands on one shelf only.
 */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface Shelf {
  householdId: string;
  /** The viewer. */
  accountId: string;
  /** Every current adult of the household, the viewer included. */
  adultIds: readonly string[];
}

/** The viewer's share of `items`, in their original order. */
export function myShare<T>(items: readonly T[], keyOf: (item: T) => string, shelf: Shelf): T[] {
  const adults = [...new Set(shelf.adultIds)].sort();
  const seat = adults.indexOf(shelf.accountId);
  if (adults.length < 2 || seat < 0) return [...items];
  const dealt = items
    .map((item, i) => ({ item, i, h: hash(`${shelf.householdId}:${keyOf(item)}`) }))
    .sort((a, b) => a.h - b.h || a.i - b.i);
  const mine = new Set(dealt.filter((_, n) => n % adults.length === seat).map((d) => d.i));
  return items.filter((_, i) => mine.has(i));
}
