import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Canonical store (spec section 11). Every household-owned table carries
 * household_id as its tenant boundary. Private records (journal, check-ins,
 * feedback, preferences) are owned by an account, not a household, so they
 * survive household exit and deletion (AT-14).
 */

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const created = () => ts("created_at").notNull().defaultNow();
const version = () => integer("version").notNull().default(1);
const money = (name: string) => bigint(name, { mode: "number" });

// ── Identity and households ────────────────────────────────────────────────

export const accounts = pgTable("accounts", {
  id: id(),
  identitySubject: text("identity_subject").notNull().unique(),
  displayName: text("display_name").notNull(),
  timeZone: text("time_zone").notNull().default("Europe/London"),
  createdAt: created(),
  closedAt: ts("closed_at"),
  /** Product analytics opt-out (spec 21.1). Operational audit is unaffected. */
  analyticsOptOut: boolean("analytics_opt_out").notNull().default(false),
  /** From the identity provider; used only for the weekly email. */
  email: text("email"),
  pushEnabled: boolean("push_enabled").notNull().default(true),
  weeklyEmail: boolean("weekly_email").notNull().default(true),
  /** Local times between which nothing is pushed (spec 13.2). */
  quietStart: text("quiet_start").notNull().default("21:00"),
  quietEnd: text("quiet_end").notNull().default("07:00"),
  /** Private heads-up about birthdays and anniversaries. Off unless this adult asks. */
  dateHints: boolean("date_hints").notNull().default(false),
  version: version(),
});

export const households = pgTable("households", {
  id: id(),
  name: text("name").notNull(),
  timeZone: text("time_zone").notNull().default("Europe/London"),
  currency: text("currency").notNull().default("GBP"),
  membershipRevision: integer("membership_revision").notNull().default(1),
  scheduleRevision: integer("schedule_revision").notNull().default(1),
  createdAt: created(),
  deletedAt: ts("deleted_at"),
  /** The household's town, for the weather and "near you" links. Optional. */
  placeName: text("place_name"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  version: version(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    role: text("role", { enum: ["adult"] }).notNull().default("adult"),
    startsAt: ts("starts_at").notNull().defaultNow(),
    endsAt: ts("ends_at"),
  },
  (t) => [
    // One active household per account (spec 3.2 scope).
    uniqueIndex("memberships_one_active_per_account").on(t.accountId).where(sql`${t.endsAt} is null`),
    index("memberships_household_active").on(t.householdId).where(sql`${t.endsAt} is null`),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    tokenHash: text("token_hash").notNull().unique(),
    createdBy: uuid("created_by").notNull().references(() => accounts.id),
    createdAt: created(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    acceptedBy: uuid("accepted_by").references(() => accounts.id),
    acceptedAt: ts("accepted_at"),
  },
  (t) => [index("invitations_household").on(t.householdId)],
);

export const children = pgTable(
  "children",
  {
    id: id(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    preferredName: text("preferred_name").notNull(),
    /** Minimised: an age band, never a full birth date. */
    ageBand: text("age_band", { enum: ["0-4", "5-7", "8-11", "12-15", "16+"] }).notNull(),
    needs: text("needs").notNull().default(""),
    createdAt: created(),
    archivedAt: ts("archived_at"),
    version: version(),
  },
  (t) => [index("children_household").on(t.householdId)],
);

// ── Scheduling ─────────────────────────────────────────────────────────────

/**
 * One editor, one table: single events and recurring series share a row
 * shape. A series has `rule` and `local_start`; its occurrences are
 * expanded on read within the requested horizon.
 */
export const events = pgTable(
  "events",
  {
    id: id(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    ownerId: uuid("owner_id").notNull().references(() => accounts.id),
    title: text("title").notNull(),
    notes: text("notes").notNull().default(""),
    location: text("location").notNull().default(""),
    visibility: text("visibility", { enum: ["shared", "busy_only", "private"] }).notNull().default("shared"),
    allDay: boolean("all_day").notNull().default(false),
    timeZone: text("time_zone").notNull(),
    startAt: ts("start_at").notNull(),
    endAt: ts("end_at").notNull(),
    localStart: text("local_start").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    rule: jsonb("rule"),
    /** Exclusive upper bound of any occurrence, for indexed horizon reads; null = open-ended. */
    seriesEndAt: ts("series_end_at"),
    travelBeforeMinutes: smallint("travel_before_minutes").notNull().default(0),
    travelAfterMinutes: smallint("travel_after_minutes").notNull().default(0),
    adultIds: uuid("adult_ids").array().notNull().default(sql`'{}'::uuid[]`),
    childIds: uuid("child_ids").array().notNull().default(sql`'{}'::uuid[]`),
    /** Set when a "this and future" edit split this series from another. */
    splitFromId: uuid("split_from_id"),
    /** Imported from a calendar feed: read-only here, replaced on each sync. */
    feedId: uuid("feed_id").references((): AnyPgColumn => calendarFeeds.id),
    /** The provider's identity for this occurrence (UID plus original start). */
    externalId: text("external_id"),
    createdAt: created(),
    cancelledAt: ts("cancelled_at"),
    version: version(),
  },
  (t) => [
    index("events_household_time").on(t.householdId, t.startAt),
    index("events_household_series").on(t.householdId).where(sql`${t.rule} is not null`),
    uniqueIndex("events_feed_external").on(t.feedId, t.externalId).where(sql`${t.feedId} is not null`),
  ],
);

/**
 * A read-only calendar subscription (spec 8.11): one adult's iCalendar link,
 * imported as their own busy time. The link is a secret: it never leaves the
 * server and is never shown to the partner.
 */
export const calendarFeeds = pgTable(
  "calendar_feeds",
  {
    id: id(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    label: text("label").notNull(),
    /** For "ics", the private link; for a connected account, the calendar id. */
    url: text("url").notNull(),
    /** A pasted iCalendar link, or a connected Google or Microsoft account. */
    provider: text("provider", { enum: ["ics", "google", "microsoft"] }).notNull().default("ics"),
    /** Sealed OAuth tokens for a connected account (never sent to a browser). */
    credentials: text("credentials"),
    /** Write More's plans back to this calendar as "Busy". */
    writeBusy: boolean("write_busy").notNull().default(false),
    /** How imported items appear to the partner. */
    visibility: text("visibility", { enum: ["shared", "busy_only", "private"] }).notNull().default("busy_only"),
    lastAttemptAt: ts("last_attempt_at"),
    lastSuccessAt: ts("last_success_at"),
    /** A short code when the last sync failed, e.g. "unreachable". */
    lastError: text("last_error"),
    eventCount: integer("event_count").notNull().default(0),
    createdAt: created(),
    version: version(),
  },
  (t) => [index("calendar_feeds_owner").on(t.accountId), index("calendar_feeds_household").on(t.householdId)],
);

export const eventExceptions = pgTable(
  "event_exceptions",
  {
    eventId: uuid("event_id").notNull().references(() => events.id),
    recurrenceId: text("recurrence_id").notNull(),
    kind: text("kind", { enum: ["cancelled", "moved"] }).notNull(),
    startAt: ts("start_at"),
    endAt: ts("end_at"),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.recurrenceId] })],
);

/**
 * A reservation is time held by a valid accepted source (glossary). The
 * exclusion constraint in migration 0001 makes overlapping reservations for
 * one adult impossible, even under concurrent acceptance (AT-08, INV-04).
 * The `during` tstzrange column is added there because Drizzle has no type
 * for it; start/end mirror it for ordinary reads.
 */
export const reservations = pgTable(
  "reservations",
  {
    id: id(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    sourceType: text("source_type", { enum: ["moment", "care", "drop_off", "collect"] }).notNull(),
    sourceId: uuid("source_id").notNull(),
    startAt: ts("start_at").notNull(),
    endAt: ts("end_at").notNull(),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("reservations_source_person").on(t.sourceType, t.sourceId, t.accountId),
    index("reservations_household_time").on(t.householdId, t.startAt),
  ],
);

// ── Moments: Me, Us (dates) and Family ─────────────────────────────────────

export const moments = pgTable(
  "moments",
  {
    id: id(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    kind: text("kind", { enum: ["me", "us", "family"] }).notNull(),
    organiserId: uuid("organiser_id").notNull().references(() => accounts.id),
    title: text("title").notNull(),
    notes: text("notes").notNull().default(""),
    location: text("location").notNull().default(""),
    activityKey: text("activity_key"),
    /** Generated from a ritual: one moment per ritual date. */
    ritualId: uuid("ritual_id").references((): AnyPgColumn => rituals.id),
    ritualDate: date("ritual_date"),
    /** A family plan one child chose. */
    chosenByChildId: uuid("chosen_by_child_id").references(() => children.id),
    startAt: ts("start_at").notNull(),
    endAt: ts("end_at").notNull(),
    travelBeforeMinutes: smallint("travel_before_minutes").notNull().default(0),
    travelAfterMinutes: smallint("travel_after_minutes").notNull().default(0),
    participantIds: uuid("participant_ids").array().notNull(),
    childIds: uuid("child_ids").array().notNull().default(sql`'{}'::uuid[]`),
    needsCare: boolean("needs_care").notNull().default(false),
    budgetMinor: money("budget_minor"),
    surprise: boolean("surprise").notNull().default(false),
    lifecycle: text("lifecycle", { enum: ["draft", "planned", "completed", "cancelled"] }).notNull().default("draft"),
    sharing: text("sharing", { enum: ["private", "shared"] }).notNull().default("private"),
    materialVersion: integer("material_version").notNull().default(1),
    review: text("review", { enum: ["current", "needs_review"] }).notNull().default("current"),
    reviewReason: text("review_reason"),
    createdAt: created(),
    version: version(),
  },
  (t) => [
    index("moments_household_time").on(t.householdId, t.startAt),
    uniqueIndex("moments_ritual_date").on(t.ritualId, t.ritualDate).where(sql`${t.ritualId} is not null`),
  ],
);

/**
 * A plan that repeats (Friday pizza, a fortnightly date night). Once every
 * participant has agreed, its next few dates are generated as ordinary
 * moments, each with its own care check, and any one can be skipped.
 */
export const rituals = pgTable(
  "rituals",
  {
    id: id(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    kind: text("kind", { enum: ["me", "us", "family"] }).notNull(),
    organiserId: uuid("organiser_id").notNull().references(() => accounts.id),
    title: text("title").notNull(),
    notes: text("notes").notNull().default(""),
    activityKey: text("activity_key"),
    participantIds: uuid("participant_ids").array().notNull(),
    childIds: uuid("child_ids").array().notNull().default(sql`'{}'::uuid[]`),
    needsCare: boolean("needs_care").notNull().default(false),
    budgetMinor: money("budget_minor"),
    cadence: text("cadence", { enum: ["weekly", "fortnightly", "monthly"] }).notNull(),
    /** First date; later dates keep its weekday (monthly: the same nth weekday). */
    startsOn: date("starts_on").notNull(),
    startTime: text("start_time").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    agreedBy: uuid("agreed_by").array().notNull().default(sql`'{}'::uuid[]`),
    endedAt: ts("ended_at"),
    createdAt: created(),
    version: version(),
  },
  (t) => [index("rituals_household").on(t.householdId)],
);

/**
 * One line about a plan that happened, shared with everyone in it. Separate
 * from private reflection, which never leaves its author.
 */
export const highlights = pgTable(
  "highlights",
  {
    id: id(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    momentId: uuid("moment_id").notNull().references(() => moments.id),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    text: text("text").notNull(),
    createdAt: created(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("highlights_moment_author").on(t.momentId, t.accountId), index("highlights_household_time").on(t.householdId, t.createdAt)],
);

/** That the household sent its week plan (the Sunday ten minutes) for a week. */
export const weekPlans = pgTable(
  "week_plans",
  {
    householdId: uuid("household_id").notNull().references(() => households.id),
    weekKey: date("week_key").notNull(),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    items: integer("items").notNull().default(0),
    sentAt: created(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.weekKey, t.accountId] })],
);

/** Append-only decisions; the current one per actor and version wins. */
export const acceptances = pgTable(
  "acceptances",
  {
    id: id(),
    momentId: uuid("moment_id").notNull().references(() => moments.id),
    actorId: uuid("actor_id").notNull().references(() => accounts.id),
    materialVersion: integer("material_version").notNull(),
    membershipRevision: integer("membership_revision").notNull(),
    decision: text("decision", { enum: ["accepted", "alternative", "declined"] }).notNull(),
    createdAt: created(),
  },
  (t) => [index("acceptances_moment").on(t.momentId)],
);

export const preparationTasks = pgTable(
  "preparation_tasks",
  {
    id: id(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    momentId: uuid("moment_id").notNull().references(() => moments.id),
    title: text("title").notNull(),
    ownerId: uuid("owner_id").notNull().references(() => accounts.id),
    state: text("state", { enum: ["open", "done"] }).notNull().default("open"),
    doneAt: ts("done_at"),
    createdAt: created(),
    version: version(),
  },
  (t) => [index("tasks_moment").on(t.momentId), index("tasks_owner_state").on(t.ownerId, t.state)],
);

// ── Care and holidays ──────────────────────────────────────────────────────

export const holidayPeriods = pgTable(
  "holiday_periods",
  {
    id: id(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    name: text("name").notNull(),
    startDate: date("start_date").notNull(),
    endDateExclusive: date("end_date_exclusive").notNull(),
    /** Local times of the daily care window, e.g. 08:30 and 17:30. */
    dailyStart: text("daily_start").notNull(),
    dailyEnd: text("daily_end").notNull(),
    includeWeekends: boolean("include_weekends").notNull().default(false),
    childIds: uuid("child_ids").array().notNull(),
    createdAt: created(),
    archivedAt: ts("archived_at"),
    version: version(),
  },
  (t) => [index("holidays_household_start").on(t.householdId, t.startDate)],
);

export const careRequirements = pgTable(
  "care_requirements",
  {
    id: id(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    childId: uuid("child_id").notNull().references(() => children.id),
    startAt: ts("start_at").notNull(),
    endAt: ts("end_at").notNull(),
    reason: text("reason").notNull(),
    sourceType: text("source_type", { enum: ["holiday", "moment", "manual"] }).notNull(),
    sourceId: uuid("source_id"),
    createdAt: created(),
    version: version(),
  },
  (t) => [
    index("care_req_household_time").on(t.householdId, t.startAt),
    index("care_req_source").on(t.sourceType, t.sourceId),
  ],
);

export const careArrangements = pgTable(
  "care_arrangements",
  {
    id: id(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    kind: text("kind", { enum: ["parent", "external", "not_needed"] }).notNull(),
    responsibleAccountId: uuid("responsible_account_id").references(() => accounts.id),
    providerName: text("provider_name"),
    childIds: uuid("child_ids").array().notNull(),
    startAt: ts("start_at").notNull(),
    endAt: ts("end_at").notNull(),
    state: text("state", { enum: ["proposed", "confirmed", "declined"] }).notNull().default("proposed"),
    confirmedBy: uuid("confirmed_by").references(() => accounts.id),
    /** A saved helper from the village, for external care. */
    helperId: uuid("helper_id").references((): AnyPgColumn => helpers.id),
    confirmedAt: ts("confirmed_at"),
    createdBy: uuid("created_by").notNull().references(() => accounts.id),
    note: text("note").notNull().default(""),
    /** A partner asked to take this over from the named parent (R08); confirming it retires the original. */
    replacesId: uuid("replaces_id").references((): AnyPgColumn => careArrangements.id),
    /** Named handovers: who takes the children there and who collects them, once they've agreed. */
    dropOffBy: uuid("drop_off_by").references(() => accounts.id),
    dropOffAgreed: boolean("drop_off_agreed").notNull().default(false),
    collectBy: uuid("collect_by").references(() => accounts.id),
    collectAgreed: boolean("collect_agreed").notNull().default(false),
    /** Travel each way for a handover, reserved around the start and the end. */
    handoverMinutes: smallint("handover_minutes").notNull().default(20),
    createdAt: created(),
    version: version(),
  },
  (t) => [index("care_arr_household_time").on(t.householdId, t.startAt)],
);

/**
 * The household's village: people outside it who look after the children.
 * They have no account; a phone number is optional and only used to open a
 * text message on an adult's own phone.
 */
export const helpers = pgTable(
  "helpers",
  {
    id: id(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    name: text("name").notNull(),
    relation: text("relation").notNull().default(""),
    phone: text("phone").notNull().default(""),
    createdAt: created(),
    archivedAt: ts("archived_at"),
    version: version(),
  },
  (t) => [index("helpers_household").on(t.householdId)],
);

/**
 * A one-off ask to a helper for one care arrangement. The link token is
 * hashed; the page it opens shows only the time, the children's first names
 * and a reply.
 */
export const careAsks = pgTable(
  "care_asks",
  {
    id: id(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    helperId: uuid("helper_id").notNull().references(() => helpers.id),
    arrangementId: uuid("arrangement_id").notNull().references(() => careArrangements.id),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: ts("expires_at").notNull(),
    response: text("response", { enum: ["yes", "no"] }),
    respondedAt: ts("responded_at"),
    createdBy: uuid("created_by").notNull().references(() => accounts.id),
    createdAt: created(),
  },
  (t) => [index("care_asks_arrangement").on(t.arrangementId)],
);

// ── Money ──────────────────────────────────────────────────────────────────

export const expenses = pgTable(
  "expenses",
  {
    id: id(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    label: text("label").notNull(),
    currency: text("currency").notNull().default("GBP"),
    estimateMinor: money("estimate_minor"),
    committedMinor: money("committed_minor"),
    sourceType: text("source_type", { enum: ["moment", "care", "other"] }).notNull(),
    sourceId: uuid("source_id"),
    /** The local date the cost is reported against (activity-week basis). */
    activityDate: date("activity_date").notNull(),
    createdBy: uuid("created_by").notNull().references(() => accounts.id),
    createdAt: created(),
    version: version(),
  },
  (t) => [
    index("expenses_household_date").on(t.householdId, t.activityDate),
    uniqueIndex("expenses_one_per_source").on(t.sourceType, t.sourceId).where(sql`${t.sourceId} is not null`),
  ],
);

export const paymentTransactions = pgTable(
  "payment_transactions",
  {
    id: id(),
    expenseId: uuid("expense_id").notNull().references(() => expenses.id),
    kind: text("kind", { enum: ["payment", "refund", "adjustment"] }).notNull(),
    amountMinor: money("amount_minor").notNull(),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
    createdBy: uuid("created_by").notNull().references(() => accounts.id),
    createdAt: created(),
  },
  (t) => [index("payments_expense").on(t.expenseId)],
);

// ── Private records (account-owned) ────────────────────────────────────────

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: id(),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    entryDate: date("entry_date").notNull(),
    title: text("title").notNull().default(""),
    body: text("body").notNull(),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    createdAt: created(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
    version: version(),
  },
  (t) => [index("journal_owner_date").on(t.accountId, t.entryDate)],
);

export const checkins = pgTable(
  "checkins",
  {
    id: id(),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    weekKey: date("week_key").notNull(),
    /** 1 (low) to 5 (high); null means unknown, never "plenty". */
    energy: smallint("energy"),
    pressure: smallint("pressure"),
    wants: text("wants").array().notNull().default(sql`'{}'::text[]`),
    note: text("note").notNull().default(""),
    createdAt: created(),
    version: version(),
  },
  (t) => [uniqueIndex("checkins_owner_week").on(t.accountId, t.weekKey)],
);

export const feedback = pgTable(
  "feedback",
  {
    id: id(),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    momentId: uuid("moment_id").notNull().references(() => moments.id),
    activityKey: text("activity_key").notNull(),
    helpful: boolean("helpful"),
    enjoyed: boolean("enjoyed"),
    wantRepeat: boolean("want_repeat"),
    effortOk: boolean("effort_ok"),
    note: text("note").notNull().default(""),
    createdAt: created(),
  },
  (t) => [uniqueIndex("feedback_owner_moment").on(t.accountId, t.momentId)],
);

export const preferences = pgTable(
  "preferences",
  {
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    activityKey: text("activity_key").notNull(),
    guidance: text("guidance", { enum: ["allow", "avoid", "simplify"] }).notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.activityKey] })],
);

export const suppressions = pgTable(
  "suppressions",
  {
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    activityKey: text("activity_key").notNull(),
    evidenceIds: uuid("evidence_ids").array().notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.activityKey] })],
);

// ── Delivery, idempotency and audit ────────────────────────────────────────

export const outbox = pgTable(
  "outbox",
  {
    id: id(),
    householdId: uuid("household_id"),
    eventType: text("event_type").notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    /** References and codes only, never raw private text. */
    payload: jsonb("payload").notNull(),
    availableAt: ts("available_at").notNull().defaultNow(),
    state: text("state", { enum: ["pending", "done", "failed", "superseded"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: created(),
    processedAt: ts("processed_at"),
  },
  (t) => [index("outbox_pending").on(t.availableAt).where(sql`${t.state} = 'pending'`)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    householdId: uuid("household_id"),
    kind: text("kind").notNull(),
    /** Lock-screen-safe text: no private titles (spec 13.2). */
    text: text("text").notNull(),
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    dedupeKey: text("dedupe_key").notNull().unique(),
    createdAt: created(),
    readAt: ts("read_at"),
    /** When a push service accepted it for at least one device. Acceptance is not arrival. */
    pushedAt: ts("pushed_at"),
    /**
     * Push delivery state (R03): pending → leased → sent, or retry (bounded,
     * backing off), failed, expired (too late to be useful), superseded (no
     * longer true at send time) or skipped (push off, or no device).
     */
    pushState: text("push_state", { enum: ["pending", "leased", "sent", "retry", "failed", "expired", "superseded", "skipped"] }).notNull().default("pending"),
    pushAttempts: smallint("push_attempts").notNull().default(0),
    /** A worker's claim; a crashed worker's lease runs out and the next run takes over. */
    pushLeaseUntil: ts("push_lease_until"),
    pushNextAt: ts("push_next_at"),
    pushExpiresAt: ts("push_expires_at"),
    pushError: text("push_error"),
    /** What to re-check just before sending: the source and its version. */
    relevance: jsonb("relevance"),
  },
  (t) => [
    index("notifications_owner").on(t.accountId, t.createdAt),
    index("notifications_push_due").on(t.createdAt).where(sql`${t.pushState} in ('pending', 'leased', 'retry')`),
  ],
);

/** A browser push subscription for one device (spec 13.2). */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    label: text("label").notNull().default(""),
    createdAt: created(),
    lastSuccessAt: ts("last_success_at"),
    failures: integer("failures").notNull().default(0),
  },
  (t) => [index("push_subscriptions_owner").on(t.accountId)],
);

/** Once-per-period emails already sent, so a retry never sends twice. */
export const emailSends = pgTable(
  "email_sends",
  {
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    kind: text("kind").notNull(),
    periodKey: text("period_key").notNull(),
    sentAt: created(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.kind, t.periodKey] })],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    actorId: uuid("actor_id").notNull(),
    key: text("key").notNull(),
    command: text("command").notNull(),
    requestHash: text("request_hash").notNull(),
    response: jsonb("response").notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.actorId, t.key] })],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    householdId: uuid("household_id"),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: uuid("resource_id"),
    result: text("result").notNull(),
    createdAt: created(),
  },
  (t) => [index("audit_household_time").on(t.householdId, t.createdAt)],
);

export const usageReservations = pgTable("usage_reservations", {
  id: id(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  requestId: text("request_id").notNull().unique(),
  maxCostMinor: money("max_cost_minor").notNull(),
  actualCostMinor: money("actual_cost_minor"),
  state: text("state", { enum: ["reserved", "settled", "released"] }).notNull().default("reserved"),
  createdAt: created(),
});

// ── Trial evidence (spec section 21) ───────────────────────────────────────

/**
 * Privacy-aware product events: pseudonymous ids, a type and a reason code.
 * Never private text, titles, places or children's names. No foreign keys:
 * analytics is separate from the operational record and outlives nothing
 * it refers to by content.
 */
export const productEvents = pgTable(
  "product_events",
  {
    id: id(),
    eventType: text("event_type").notNull(),
    accountId: uuid("account_id"),
    householdId: uuid("household_id"),
    /** A short non-sensitive code, e.g. the moment kind or the failing command. */
    reason: text("reason"),
    appVersion: text("app_version").notNull(),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
    /** Set for once-only events such as one active day per adult. */
    dedupeKey: text("dedupe_key").unique(),
  },
  (t) => [index("product_events_type_time").on(t.eventType, t.occurredAt), index("product_events_household").on(t.householdId, t.occurredAt)],
);

/**
 * The household trial's weekly questions (spec 21.2), answered independently
 * by each adult. Owned by the account like a check-in; a partner sees them
 * only if the author chose to share them with the trial.
 */
export const trialResponses = pgTable(
  "trial_responses",
  {
    id: id(),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    weekKey: date("week_key").notNull(),
    baseline: boolean("baseline").notNull().default(false),
    meMoments: smallint("me_moments"),
    usMoments: smallint("us_moments"),
    familyMoments: smallint("family_moments"),
    /** Minutes spent organising, inside More and outside it. */
    minutesInApp: smallint("minutes_in_app"),
    minutesOutside: smallint("minutes_outside"),
    /** 1 (not at all) to 5 (completely). */
    fairlyAgreed: smallint("fairly_agreed"),
    continueChoice: text("continue_choice", { enum: ["yes", "unsure", "no"] }),
    helped: text("helped").notNull().default(""),
    friction: text("friction").notNull().default(""),
    shareWithTrial: boolean("share_with_trial").notNull().default(false),
    createdAt: created(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    version: version(),
  },
  (t) => [uniqueIndex("trial_responses_owner_week").on(t.accountId, t.weekKey)],
);

// ── Shared load ────────────────────────────────────────────────────────────

/**
 * A recurring household job (bins, PE kit, school forms) with one agreed
 * owner. Ownership changes by proposal: the person taking a job on says yes
 * before it becomes theirs, so nobody is handed work silently.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    title: text("title").notNull(),
    notes: text("notes").notNull().default(""),
    cadence: text("cadence", { enum: ["once", "weekly", "fortnightly", "monthly", "yearly"] }).notNull(),
    /** First due date; later ones follow the cadence (monthly: the same nth weekday). */
    startsOn: date("starts_on").notNull(),
    /** Remind the evening before (bins), not the morning of. */
    remindDayBefore: boolean("remind_day_before").notNull().default(false),
    /** A rough guess at the time it takes, for the "who carries what" view. */
    minutes: smallint("minutes").notNull().default(15),
    ownerId: uuid("owner_id").references(() => accounts.id),
    proposedOwnerId: uuid("proposed_owner_id").references(() => accounts.id),
    proposedBy: uuid("proposed_by").references(() => accounts.id),
    createdBy: uuid("created_by").notNull().references(() => accounts.id),
    createdAt: created(),
    archivedAt: ts("archived_at"),
    version: version(),
  },
  (t) => [index("jobs_household").on(t.householdId)],
);

/** One due date of a job marked done. */
export const jobDone = pgTable(
  "job_done",
  {
    jobId: uuid("job_id").notNull().references(() => jobs.id),
    dueOn: date("due_on").notNull(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    doneBy: uuid("done_by").notNull().references(() => accounts.id),
    doneAt: created(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.dueOn] })],
);

// ── Our places ─────────────────────────────────────────────────────────────

/**
 * Local places the household itself knows and likes. They are offered first
 * in ideas and picks, ahead of the general catalogue, which nobody has
 * checked for this area.
 */
export const places = pgTable(
  "places",
  {
    id: id(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    name: text("name").notNull(),
    area: text("area").notNull().default(""),
    kinds: text("kinds").array().notNull(),
    category: text("category").notNull(),
    setting: text("setting", { enum: ["home", "outdoors", "out-indoors"] }).notNull(),
    notes: text("notes").notNull().default(""),
    typicalCostMinor: money("typical_cost_minor").notNull().default(0),
    durationMinutes: integer("duration_minutes").notNull().default(120),
    stepFree: boolean("step_free").notNull().default(false),
    calm: boolean("calm").notNull().default(false),
    /** Where to book it (a table, tickets), https only. */
    bookingUrl: text("booking_url").notNull().default(""),
    addedBy: uuid("added_by").notNull().references(() => accounts.id),
    createdAt: created(),
    archivedAt: ts("archived_at"),
    version: version(),
  },
  (t) => [index("places_household").on(t.householdId)],
);

// ── Calendar out ───────────────────────────────────────────────────────────

/**
 * A private subscription link that puts this adult's More plans into their
 * own calendar app. Only the hash is stored; a lost link is replaced.
 */
export const calendarExports = pgTable("calendar_exports", {
  accountId: uuid("account_id").primaryKey().references(() => accounts.id),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: created(),
  lastFetchedAt: ts("last_fetched_at"),
});

// ── Trips and time away ────────────────────────────────────────────────────

/**
 * Time away from home: a work trip, a weekend with friends, or the whole
 * family's holiday. One entry does the work: travellers show as away, and
 * children left at home get care needs wherever no adult is left to cover.
 * Logistics, so shared with the household.
 */
export const trips = pgTable(
  "trips",
  {
    id: id(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    organiserId: uuid("organiser_id").notNull().references(() => accounts.id),
    kind: text("kind", { enum: ["work", "personal", "family"] }).notNull(),
    title: text("title").notNull(),
    destination: text("destination").notNull().default(""),
    startAt: ts("start_at").notNull(),
    endAt: ts("end_at").notNull(),
    travellerIds: uuid("traveller_ids").array().notNull(),
    childIds: uuid("child_ids").array().notNull().default(sql`'{}'::uuid[]`),
    createdAt: created(),
    cancelledAt: ts("cancelled_at"),
    version: version(),
  },
  (t) => [index("trips_household_time").on(t.householdId, t.startAt)],
);

/**
 * "Busy" blocks More has written into a connected calendar, one per plan,
 * so they can be moved or removed when the plan changes.
 */
export const calendarPushes = pgTable(
  "calendar_pushes",
  {
    feedId: uuid("feed_id").notNull().references(() => calendarFeeds.id),
    /** "moment:<id>" or "trip:<id>". */
    sourceKey: text("source_key").notNull(),
    externalId: text("external_id").notNull(),
    /** Start and end as last written, to skip unchanged blocks. */
    fingerprint: text("fingerprint").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.feedId, t.sourceKey] })],
);

// ── Screens for the family ─────────────────────────────────────────────────

/**
 * A no-account link for a shared screen: the kitchen display, or one
 * child's own view. It shows only family logistics (family plans, children's
 * activities, who has the children, time away), never plans for the adults,
 * notes or money. Only the hash is stored; a link can be switched off.
 */
export const displayLinks = pgTable(
  "display_links",
  {
    id: id(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    /** Set for a child's view; null for the kitchen display. */
    childId: uuid("child_id").references(() => children.id),
    tokenHash: text("token_hash").notNull().unique(),
    createdBy: uuid("created_by").notNull().references(() => accounts.id),
    createdAt: created(),
    lastSeenAt: ts("last_seen_at"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("display_links_household").on(t.householdId)],
);

/**
 * A child's pick from their own screen when it's their turn to choose. It is
 * a wish for the adults to plan around, not a plan; one open wish per child.
 */
export const childWishes = pgTable(
  "child_wishes",
  {
    id: id(),
    householdId: uuid("household_id").notNull().references(() => households.id),
    childId: uuid("child_id").notNull().references(() => children.id),
    activityKey: text("activity_key").notNull(),
    title: text("title").notNull(),
    createdAt: created(),
    /** Planned or put aside by an adult. */
    handledAt: ts("handled_at"),
  },
  (t) => [uniqueIndex("child_wishes_open").on(t.childId).where(sql`${t.handledAt} is null`)],
);

/** The latest hourly forecast for a household's town, refreshed by the tick. */
export const weatherForecasts = pgTable("weather_forecasts", {
  householdId: uuid("household_id").primaryKey().references(() => households.id),
  fetchedAt: ts("fetched_at").notNull(),
  /** Hourly points: { t: epoch ms, rain: % chance, mm, code: WMO, temp: °C }. */
  hours: jsonb("hours").notNull(),
});

// ── Operations ─────────────────────────────────────────────────────────────

/**
 * The last run of each scheduled job: when it started, when it last fully
 * succeeded and the last error. Feeds the status page and alerts (R10).
 */
export const opsRuns = pgTable("ops_runs", {
  name: text("name").primaryKey(),
  lastStartedAt: ts("last_started_at"),
  lastOkAt: ts("last_ok_at"),
  lastErrorAt: ts("last_error_at"),
  lastError: text("last_error"),
  lastStats: jsonb("last_stats"),
});

/**
 * Messages sent through the support page. The sender's own words; only the
 * operator reads them. An account is attached only if they were signed in.
 */
export const supportRequests = pgTable(
  "support_requests",
  {
    id: id(),
    accountId: uuid("account_id").references(() => accounts.id),
    contact: text("contact").notNull().default(""),
    topic: text("topic", { enum: ["problem", "privacy", "idea", "other"] }).notNull(),
    message: text("message").notNull(),
    createdAt: created(),
    handledAt: ts("handled_at"),
  },
  (t) => [index("support_requests_open").on(t.createdAt).where(sql`${t.handledAt} is null`)],
);

/**
 * What would help (For Us): needs an adult shared privately, owned by that
 * account like the journal, never by a household. `aboutId` is the partner
 * it was about (null if they had no partner yet); it shapes only that
 * partner's small kindnesses. A change counts from the following week:
 * `since` and `until` bound when it applies, and ended rows are purged once
 * they can no longer apply. Only the server reads these, and only to deal
 * the other adult's card; nothing here is ever sent to another account.
 */
export const partnerNeeds = pgTable(
  "partner_needs",
  {
    id: id(),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    aboutId: uuid("about_id").references(() => accounts.id),
    need: text("need").notNull(),
    /** False: "just for me", kept as a private note that shapes nothing. */
    shapes: boolean("shapes").notNull().default(true),
    since: ts("since").notNull().defaultNow(),
    until: ts("until"),
  },
  (t) => [
    uniqueIndex("partner_needs_open").on(t.accountId, t.need).where(sql`${t.until} is null`),
    index("partner_needs_about").on(t.aboutId),
  ],
);

/** The line in their own words that goes with their needs: sealed, only ever shown back to them. */
export const needNotes = pgTable("need_notes", {
  accountId: uuid("account_id").primaryKey().references(() => accounts.id),
  sealed: text("sealed").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Small kindnesses an adult did or passed on, per week. Private to them. */
export const kindnessMarks = pgTable(
  "kindness_marks",
  {
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    weekKey: date("week_key").notNull(),
    kindnessKey: text("kindness_key").notNull(),
    mark: text("mark", { enum: ["done", "skip"] }).notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.weekKey, t.kindnessKey] })],
);
