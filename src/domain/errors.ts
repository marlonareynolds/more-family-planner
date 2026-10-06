/**
 * Typed domain errors. Each code maps to one HTTP status (spec 12.2) and a
 * message that is always safe to show to any household member: never a
 * private title, a partner's raw answer or internal detail.
 */
export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "STALE_VERSION"
  | "MEMBERSHIP_CHANGED"
  | "IDEMPOTENCY_CONFLICT"
  | "CONFLICT"
  | "DST_GAP"
  | "DST_AMBIGUOUS"
  | "INVITE_INVALID"
  | "FEATURE_DISABLED"
  | "ALLOWANCE_EXHAUSTED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 422,
  UNAUTHENTICATED: 401,
  // Inaccessible and missing resources answer the same way (non-enumerating).
  NOT_FOUND: 404,
  FORBIDDEN: 404,
  STALE_VERSION: 409,
  MEMBERSHIP_CHANGED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  CONFLICT: 409,
  DST_GAP: 422,
  DST_AMBIGUOUS: 422,
  INVITE_INVALID: 404,
  FEATURE_DISABLED: 503,
  ALLOWANCE_EXHAUSTED: 429,
  INTERNAL: 500,
};

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export function assert(condition: unknown, code: ErrorCode, message: string): asserts condition {
  if (!condition) throw new DomainError(code, message);
}
