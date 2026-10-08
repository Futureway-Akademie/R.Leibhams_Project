// Gespeicherte Form der Daten. Zeitpunkte sind BSON-Dates (UTC), IDs ObjectIds.
// Die API wandelt an der Schnittstelle in die Formate aus @fw-booking/shared um.
import type {
  AppointmentType,
  AvailabilityExceptionKind,
  BookingRules,
  BookingStatus,
  IsoWeekday,
  SessionStatus,
} from '@fw-booking/shared';
import type { Db, ObjectId } from 'mongodb';

export const COLLECTIONS = {
  settings: 'settings',
  owners: 'owners',
  services: 'services',
  openingHours: 'openingHours',
  availabilityExceptions: 'availabilityExceptions',
  courseRules: 'courseRules',
  sessions: 'sessions',
  bookings: 'bookings',
  resourceOccupancy: 'resourceOccupancy',
  actionTokens: 'actionTokens',
  outboxJobs: 'outboxJobs',
  auditEvents: 'auditEvents',
  authSessions: 'authSessions',
  loginAttempts: 'loginAttempts',
} as const;

/** In der ersten Version gibt es genau eine Ressource je Installation. */
export const DEFAULT_RESOURCE_ID = 'default';

export const SETTINGS_ID = 'installation';

export interface SettingsDocument {
  _id: typeof SETTINGS_ID;
  timeZone: string;
  /** Öffentliche Kalenderkennung für das Widget; kein Geheimnis. */
  publicCalendarId: string;
  defaultMinLeadMinutes: number;
  defaultHorizonDays: number;
  defaultChangeDeadlineMinutes: number;
  reminderLeadMinutes: number;
  updatedAt: Date;
}

export type OwnerStatus = 'active' | 'disabled';

export interface OwnerDocument {
  _id: ObjectId;
  /** Kleingeschrieben gespeichert; eindeutig. */
  email: string;
  passwordHash: string;
  status: OwnerStatus;
  createdAt: Date;
  updatedAt: Date;
}

interface ServiceBaseDocument {
  _id: ObjectId;
  title: string;
  description: string | null;
  active: boolean;
  durationMinutes: number;
  bookingRules: BookingRules;
  /** Position in Portal und Widget (aufsteigend). */
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SingleServiceDocument extends ServiceBaseDocument {
  type: 'single';
}

export interface GroupServiceDocument extends ServiceBaseDocument {
  type: 'group';
  defaultCapacity: number;
}

export type ServiceDocument = SingleServiceDocument | GroupServiceDocument;

export interface OpeningHoursDocument {
  _id: ObjectId;
  weekday: IsoWeekday;
  /** Lokale Zeitfenster `HH:MM`. */
  windows: { start: string; end: string }[];
}

export interface AvailabilityExceptionDocument {
  _id: ObjectId;
  kind: AvailabilityExceptionKind;
  /** Lokale Zeitpunkte `YYYY-MM-DDTHH:MM`. */
  start: string;
  end: string;
  note: string | null;
  createdAt: Date;
}

export interface CourseRuleDocument {
  _id: ObjectId;
  serviceId: ObjectId;
  weekdays: IsoWeekday[];
  startTime: string;
  validFrom: string;
  validUntil: string | null;
  capacity: number | null;
  location: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionDocument {
  _id: ObjectId;
  serviceId: ObjectId;
  ruleId: ObjectId | null;
  /** Lokaler Beginn `YYYY-MM-DDTHH:MM`; mit ruleId eindeutig, damit Erzeugung idempotent ist. */
  localStart: string;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  capacity: number;
  bookedCount: number;
  status: SessionStatus;
  location: string | null;
  /** Optionale Begründung einer Owner-Absage; fehlt bei älteren Terminen. */
  cancellationReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BookingDocument {
  _id: ObjectId;
  serviceId: ObjectId;
  type: AppointmentType;
  sessionId: ObjectId | null;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  status: BookingStatus;
  participant: { name: string; email: string; phone: string };
  /** Kleingeschriebene E-Mail für die Eindeutigkeit je Kurstermin. */
  participantEmailKey: string;
  idempotencyKey: string;
  /** Zeitpunkt, zu dem die Datenschutzhinweise ausdrücklich bestätigt wurden. */
  privacyAcceptedAt: Date;
  rebookedToBookingId: ObjectId | null;
  /** Optionale Begründung einer Owner-Absage; fehlt bei älteren Buchungen. */
  ownerCancellationReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type OccupancyRefType = 'booking' | 'session';

/** Eine belegte 5-Minuten-Einheit der Ressource. */
export interface ResourceOccupancyDocument {
  _id: ObjectId;
  resourceId: string;
  unitStart: Date;
  refType: OccupancyRefType;
  refId: ObjectId;
}

export type ActionTokenStatus = 'active' | 'used' | 'revoked';

export interface ActionTokenDocument {
  _id: ObjectId;
  /** SHA-256 des Tokens als Hex; der Klartext wird nie gespeichert. */
  tokenHash: string;
  bookingId: ObjectId;
  status: ActionTokenStatus;
  expiresAt: Date;
  createdAt: Date;
}

export type OutboxJobType =
  | 'booking_confirmation'
  | 'booking_reminder'
  | 'booking_cancellation'
  | 'booking_rebooked'
  | 'owner_cancellation';
export type OutboxJobStatus = 'pending' | 'processing' | 'sent' | 'failed';

export interface OutboxJobDocument {
  _id: ObjectId;
  type: OutboxJobType;
  status: OutboxJobStatus;
  /** Verhindert doppelte Aufträge für denselben Anlass. */
  dedupeKey: string;
  bookingId: ObjectId | null;
  dueAt: Date;
  attempts: number;
  leaseUntil: Date | null;
  lastErrorCategory: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditEventDocument {
  _id: ObjectId;
  at: Date;
  actor: { type: 'owner' | 'participant' | 'system' | 'developer'; id: string | null };
  action: string;
  objectType: string;
  objectId: ObjectId | string;
  /** Begrenzte Änderungsinformationen ohne personenbezogene Daten oder Secrets. */
  details: Record<string, unknown>;
}

export interface AuthSessionDocument {
  /** SHA-256 des Sitzungstokens als Hex; der Klartext steht nur im Cookie. */
  _id: string;
  ownerId: ObjectId;
  csrfToken: string;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  /** Frühester der beiden Abläufe; TTL-Index räumt abgelaufene Sitzungen auf. */
  expiresAt: Date;
}

export interface LoginAttemptDocument {
  /** `email:<sha256>` oder `ip:<adresse>`; E-Mail-Adressen werden nicht im Klartext gespeichert. */
  _id: string;
  count: number;
  expiresAt: Date;
}

/** Typisierte Zugriffe auf alle Collections. */
export function collections(db: Db) {
  return {
    settings: db.collection<SettingsDocument>(COLLECTIONS.settings),
    owners: db.collection<OwnerDocument>(COLLECTIONS.owners),
    services: db.collection<ServiceDocument>(COLLECTIONS.services),
    openingHours: db.collection<OpeningHoursDocument>(COLLECTIONS.openingHours),
    availabilityExceptions: db.collection<AvailabilityExceptionDocument>(
      COLLECTIONS.availabilityExceptions,
    ),
    courseRules: db.collection<CourseRuleDocument>(COLLECTIONS.courseRules),
    sessions: db.collection<SessionDocument>(COLLECTIONS.sessions),
    bookings: db.collection<BookingDocument>(COLLECTIONS.bookings),
    resourceOccupancy: db.collection<ResourceOccupancyDocument>(COLLECTIONS.resourceOccupancy),
    actionTokens: db.collection<ActionTokenDocument>(COLLECTIONS.actionTokens),
    outboxJobs: db.collection<OutboxJobDocument>(COLLECTIONS.outboxJobs),
    auditEvents: db.collection<AuditEventDocument>(COLLECTIONS.auditEvents),
    authSessions: db.collection<AuthSessionDocument>(COLLECTIONS.authSessions),
    loginAttempts: db.collection<LoginAttemptDocument>(COLLECTIONS.loginAttempts),
  };
}
export type Collections = ReturnType<typeof collections>;
