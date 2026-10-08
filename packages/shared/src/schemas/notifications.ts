// Benachrichtigungen (Outbox-Aufträge) aus Sicht des Owners: Typen, Fehlerkategorien mit
// deutschen Texten und die Antwort der Owner-API für fehlgeschlagene Benachrichtigungen.
import { z } from 'zod';
import { bookingStatusSchema } from '../enums.js';
import { localDateSchema, objectIdSchema, utcDateTimeSchema } from '../primitives.js';

/** Jobtypen der Outbox; je Typ versendet der Worker eine Mail. */
export const notificationTypeSchema = z.enum([
  'booking_confirmation',
  'booking_reminder',
  'booking_cancellation',
  'booking_rebooked',
  'owner_cancellation',
]);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  booking_confirmation: 'Buchungsbestätigung',
  booking_reminder: 'Erinnerung',
  booking_cancellation: 'Stornobestätigung',
  booking_rebooked: 'Umbuchungsbestätigung',
  owner_cancellation: 'Terminabsage',
};

/**
 * Fehlerkategorien des Workers. Die API gibt nur diese Werte aus; unbekannte Kategorien
 * erscheinen als `unknown`, nie als Rohwert.
 */
export const notificationErrorCategorySchema = z.enum([
  'booking_missing',
  'service_missing',
  'recipient_rejected',
  'message_rejected',
  'smtp_auth',
  'smtp_deferred',
  'smtp_unavailable',
  'smtp_error',
  'timeout',
  'unexpected',
  'lease_expired',
  'unknown',
]);
export type NotificationErrorCategory = z.infer<typeof notificationErrorCategorySchema>;

export interface NotificationErrorInfo {
  label: string;
  /** Ob ein erneuter Versuch ohne weitere Änderung Aussicht auf Erfolg hat. */
  retryUseful: boolean;
}

export const NOTIFICATION_ERROR_INFO: Record<NotificationErrorCategory, NotificationErrorInfo> = {
  booking_missing: { label: 'Die Buchung existiert nicht mehr.', retryUseful: false },
  service_missing: { label: 'Das Angebot der Buchung existiert nicht mehr.', retryUseful: false },
  recipient_rejected: {
    label: 'Der Mailserver des Empfängers hat die Adresse abgelehnt (z. B. Tippfehler).',
    retryUseful: false,
  },
  message_rejected: {
    label: 'Der Mailserver hat die Nachricht abgelehnt (z. B. Spamfilter).',
    retryUseful: false,
  },
  smtp_auth: {
    label: 'Anmeldung am Mailserver fehlgeschlagen; Zugangsdaten prüfen.',
    retryUseful: true,
  },
  smtp_deferred: {
    label: 'Der Mailserver hat die Annahme vorläufig verweigert.',
    retryUseful: true,
  },
  smtp_unavailable: { label: 'Der Mailserver war nicht erreichbar.', retryUseful: true },
  smtp_error: { label: 'Unbekannter Fehler beim Mailversand.', retryUseful: true },
  timeout: { label: 'Der Versand hat zu lange gedauert.', retryUseful: true },
  unexpected: { label: 'Unerwarteter Fehler bei der Verarbeitung.', retryUseful: true },
  lease_expired: {
    label: 'Die Verarbeitung wurde mehrfach unterbrochen (z. B. Neustarts).',
    retryUseful: true,
  },
  unknown: { label: 'Unbekannte Fehlerursache.', retryUseful: true },
};

/** Kategorie aus der Datenbank in einen bekannten Wert übersetzen. */
export function toNotificationErrorCategory(value: unknown): NotificationErrorCategory {
  const parsed = notificationErrorCategorySchema.safeParse(value);
  return parsed.success ? parsed.data : 'unknown';
}

/** Fehlgeschlagene Benachrichtigung mit Kurzübersicht der Buchung (nur für Owner). */
export const failedNotificationSchema = z.strictObject({
  id: objectIdSchema,
  type: notificationTypeSchema,
  category: notificationErrorCategorySchema,
  failedAt: utcDateTimeSchema,
  attempts: z.int().nonnegative(),
  /** `null`, wenn die Buchung nicht mehr existiert. */
  booking: z
    .strictObject({
      id: objectIdSchema,
      serviceTitle: z.string(),
      startsAt: utcDateTimeSchema,
      status: bookingStatusSchema,
      // Gespeicherte Werte wurden bei der Buchung geprüft; hier nur die Form festlegen.
      participant: z.strictObject({ name: z.string(), email: z.string(), phone: z.string() }),
    })
    .nullable(),
});
export type FailedNotification = z.infer<typeof failedNotificationSchema>;

/** Höchstzahl der gelieferten Einträge (neueste zuerst). */
export const MAX_FAILED_NOTIFICATIONS = 200;

export const failedNotificationsResponseSchema = z.strictObject({
  notifications: z.array(failedNotificationSchema).max(MAX_FAILED_NOTIFICATIONS),
  /** Anzahl passender, nicht ausgeblendeter Einträge insgesamt (auch über der Höchstzahl). */
  total: z.int().nonnegative(),
  /** Aufträge, die gerade wegen eines vorübergehenden Fehlers wiederholt werden. */
  retryingCount: z.int().nonnegative(),
});
export type FailedNotificationsResponse = z.infer<typeof failedNotificationsResponseSchema>;

export const failedNotificationsQuerySchema = z
  .object({
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    type: notificationTypeSchema.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'to muss am oder nach from liegen',
    path: ['to'],
  });
export type FailedNotificationsQuery = z.infer<typeof failedNotificationsQuerySchema>;

export const notificationActionResultSchema = z.strictObject({
  id: objectIdSchema,
  status: z.enum(['pending', 'failed']),
  /** Die Aktion war bereits ausgeführt (z. B. zweites Ausblenden). */
  alreadyDone: z.boolean(),
});
export type NotificationActionResult = z.infer<typeof notificationActionResultSchema>;
