/**
 * Public holidays in England and Wales (published by GOV.UK). A marker, not
 * proof that anyone is off work (spec 8.4): work and care stay explicit.
 * Extend this list each year; Scotland and Northern Ireland differ.
 */
export const BANK_HOLIDAYS_ENGLAND_WALES: Record<string, string> = {
  "2026-01-01": "New Year's Day",
  "2026-04-03": "Good Friday",
  "2026-04-06": "Easter Monday",
  "2026-05-04": "Early May bank holiday",
  "2026-05-25": "Spring bank holiday",
  "2026-08-31": "Summer bank holiday",
  "2026-12-25": "Christmas Day",
  "2026-12-28": "Boxing Day (substitute day)",
  "2027-01-01": "New Year's Day",
  "2027-03-26": "Good Friday",
  "2027-03-29": "Easter Monday",
  "2027-05-03": "Early May bank holiday",
  "2027-05-31": "Spring bank holiday",
  "2027-08-30": "Summer bank holiday",
  "2027-12-27": "Christmas Day (substitute day)",
  "2027-12-28": "Boxing Day (substitute day)",
  "2028-01-03": "New Year's Day (substitute day)",
  "2028-04-14": "Good Friday",
  "2028-04-17": "Easter Monday",
  "2028-05-01": "Early May bank holiday",
  "2028-05-29": "Spring bank holiday",
  "2028-08-28": "Summer bank holiday",
  "2028-12-25": "Christmas Day",
  "2028-12-26": "Boxing Day",
};

export function bankHoliday(date: string, timeZone: string): string | null {
  // Only meaningful for households living by UK time.
  if (timeZone !== "Europe/London") return null;
  return BANK_HOLIDAYS_ENGLAND_WALES[date] ?? null;
}
