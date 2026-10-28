import { DomainError } from "@/domain/errors";
import { reportError } from "./ops/error-report";

/** Turn any error into a safe JSON response (spec 12.2): no stack, SQL or secrets. */
export function errorResponse(err: unknown): Response {
  if (err instanceof DomainError) {
    return Response.json({ error: { code: err.code, message: err.message, details: err.details ?? null } }, { status: err.status, headers: noStore });
  }
  const reference = crypto.randomUUID().slice(0, 8);
  console.error(`[${reference}]`, (err as Error)?.message ?? err);
  reportError(err, reference);
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

/** A null character anywhere in a string: Postgres text cannot hold one. */
function hasNul(value: unknown, depth = 0): boolean {
  if (typeof value === "string") return value.includes("\u0000");
  if (depth > 64 || value === null || typeof value !== "object") return false;
  for (const [k, v] of Object.entries(value)) if (k.includes("\u0000") || hasNul(v, depth + 1)) return true;
  return false;
}

/**
 * Read a JSON request body, or answer 400. A body that isn't JSON, or that
 * carries a null character (which Postgres text refuses, so it used to end
 * as a 500 deep in a query), is the caller's mistake, not the server's.
 */
export async function readJson(req: Request): Promise<unknown> {
  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    throw new DomainError("BAD_REQUEST", "That request wasn't understood.");
  }
  if (hasNul(body)) throw new DomainError("BAD_REQUEST", "That text has a character that can't be saved. Remove it and try again.");
  return body;
}
