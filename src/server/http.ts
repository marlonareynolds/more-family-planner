import { DomainError } from "@/domain/errors";

/** Turn any error into a safe JSON response (spec 12.2): no stack, SQL or secrets. */
export function errorResponse(err: unknown): Response {
  if (err instanceof DomainError) {
    return Response.json({ error: { code: err.code, message: err.message, details: err.details ?? null } }, { status: err.status, headers: noStore });
  }
  const reference = crypto.randomUUID().slice(0, 8);
  console.error(`[${reference}]`, (err as Error)?.message ?? err);
  return Response.json(
    { error: { code: "INTERNAL", message: `Something went wrong. Reference ${reference}.`, details: null } },
    { status: 500, headers: noStore },
  );
}

export const noStore = { "Cache-Control": "no-store" };

/**
 * Cross-site request protection for state-changing routes: the request must
 * be JSON and come from this site's own origin.
 */
export function assertSameOrigin(req: Request, maxBytes = 64_000): void {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) {
    throw new DomainError("FORBIDDEN", "This request was blocked.");
  }
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) {
    throw new DomainError("VALIDATION", "Requests must be JSON.");
  }
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > maxBytes) throw new DomainError("VALIDATION", "That request is too large.");
}
