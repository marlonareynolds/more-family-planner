import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
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
    url: text("url").notNull(),
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
    sourceType: text("source_type", { enum: ["moment", "care"] }).notNull(),
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
  (t) => [index("moments_household_time").on(t.householdId, t.startAt)],
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
    confirmedAt: ts("confirmed_at"),
    createdBy: uuid("created_by").notNull().references(() => accounts.id),
    note: text("note").notNull().default(""),
    createdAt: created(),
    version: version(),
  },
  (t) => [index("care_arr_household_time").on(t.householdId, t.startAt)],
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
  },
  (t) => [index("notifications_owner").on(t.accountId, t.createdAt)],
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
