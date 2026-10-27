/**
 * Who runs More, as published on /privacy, /terms and the footer. Set by
 * the operator in the hosting environment (a redeploy picks a change up):
 *
 * - MORE_CONTROLLER_NAME: the person or business legally responsible,
 *   e.g. "Jane Smith, trading as More".
 * - MORE_CONTROLLER_ADDRESS: a postal address for legal correspondence.
 * - MORE_SUPPORT_EMAIL: where people write (also where /support messages go).
 * - MORE_ICO_NUMBER: the ICO data protection fee registration number.
 *
 * Anything not set reads as "not published yet", so a gap is visible
 * rather than silently filled.
 */
export type LegalIdentity = {
  controller: string;
  address: string;
  supportEmail: string | null;
  ico: string;
  /** False until a controller name and support email are both set. */
  complete: boolean;
};

const NOT_YET = "not published yet";

export function legalIdentity(env: Record<string, string | undefined> = process.env): LegalIdentity {
  const value = (key: string) => env[key]?.trim() || null;
  const controller = value("MORE_CONTROLLER_NAME");
  const supportEmail = value("MORE_SUPPORT_EMAIL");
  return {
    controller: controller ?? "the person who runs More (name not published yet)",
    address: value("MORE_CONTROLLER_ADDRESS") ?? NOT_YET,
    supportEmail,
    ico: value("MORE_ICO_NUMBER") ?? NOT_YET,
    complete: Boolean(controller && supportEmail),
  };
}

/** Fill {{placeholders}}. {{contact}} is a mailto link when an email is set, else the help page. */
export function fillLegal(text: string, who: LegalIdentity): string {
  const contact = who.supportEmail ? `[${who.supportEmail}](mailto:${who.supportEmail})` : "the [help page](/support)";
  const values: Record<string, string> = { controller: who.controller, address: who.address, ico: who.ico, contact };
  return text.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => values[key] ?? whole);
}

/** Drop "[REVIEW: ...]" notes, which are for the professional check, not for readers. */
export function stripReview(text: string): string {
  return text.replace(/ ?\[REVIEW(?::[^\]]*)?\]/g, "");
}
