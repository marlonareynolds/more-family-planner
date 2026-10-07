/**
 * For Us ideas are private to each partner (Marlon, 7 October 2026: "the
 * couples shouldn't see each other's suggestions"). Every idea belongs to
 * exactly one adult of the household, so nothing one partner sends can be
 * recognised as the app's suggestion to the other.
 *
 * The policy (review R07, BR-12):
 * - Ideas in More's own lists have a fixed seat: their position among ideas
 *   of the same kind (or in the course list). Lists only ever grow at the
 *   end (tests/domain/catalogue-order.test.ts guards this), and seats are
 *   dealt alternately from a household-specific start, so each adult gets
 *   half of every list and a new idea never moves an existing one.
 * - The household's own places have no fixed list: each is placed by a hash
 *   of the household, the place and each adult (highest wins), so adding or
 *   removing a place never moves another.
 * - An idea an adult has already used (made into a plan) stays theirs for
 *   good, whoever joins or leaves (`claimed`).
 * - While someone is the only adult, every idea is theirs to see. When a
 *   partner joins, the split starts: used ideas stay with whoever used them,
 *   ideas only looked at may land on either shelf. When a partner changes,
 *   only unused ideas can move.
 */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export interface Shelf {
  householdId: string;
  /** The viewer. */
  accountId: string;
  /** Every current adult of the household, the viewer included. */
  adultIds: readonly string[];
  /** Ideas already used, by idea key: whose they are for good. */
  claimed?: Readonly<Record<string, string>>;
}

/** Whose shelf an idea is on. `seat` is its fixed position in an append-only list, if it has one. */
export function ownerOf(key: string, shelf: Omit<Shelf, "accountId">, seat?: number): string | null {
  const adults = [...new Set(shelf.adultIds)].sort();
  if (!adults.length) return null;
  const claimedBy = shelf.claimed?.[key];
  if (claimedBy && adults.includes(claimedBy)) return claimedBy;
  if (seat !== undefined) return adults[(seat + (hash(shelf.householdId) % adults.length)) % adults.length];
  let best = adults[0];
  let top = -1;
  for (const a of adults) {
    const score = hash(`${shelf.householdId}:${key}:${a}`);
    if (score > top) [best, top] = [a, score];
  }
  return best;
}

/** The viewer's share of `items`, in their original order. */
export function myShare<T>(items: readonly T[], keyOf: (item: T) => string, shelf: Shelf, seatOf?: (item: T) => number | undefined): T[] {
  const adults = new Set(shelf.adultIds);
  if (adults.size < 2 || !adults.has(shelf.accountId)) return [...items];
  return items.filter((item) => ownerOf(keyOf(item), shelf, seatOf?.(item)) === shelf.accountId);
}
