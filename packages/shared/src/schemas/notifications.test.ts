import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_ERROR_INFO,
  NOTIFICATION_TYPE_LABELS,
  failedNotificationSchema,
  notificationErrorCategorySchema,
  notificationTypeSchema,
  toNotificationErrorCategory,
} from './notifications.js';

const valid = {
  id: '65f1a2b3c4d5e6f7a8b9c0d1',
  type: 'booking_confirmation',
  category: 'recipient_rejected',
  failedAt: '2026-10-08T12:00:00Z',
  attempts: 1,
  booking: {
    id: '65f1a2b3c4d5e6f7a8b9c0d2',
    serviceTitle: 'Haarschnitt',
    startsAt: '2026-10-14T08:00:00Z',
    status: 'confirmed',
    participant: { name: 'Erika', email: 'erika@example.test', phone: '030 123456' },
  },
};

describe('Benachrichtigungen', () => {
  it('beschreibt jeden Typ und jede Fehlerkategorie auf Deutsch', () => {
    for (const type of notificationTypeSchema.options) {
      expect(NOTIFICATION_TYPE_LABELS[type]).toBeTruthy();
    }
    for (const category of notificationErrorCategorySchema.options) {
      expect(NOTIFICATION_ERROR_INFO[category].label).toMatch(/\.$/);
    }
  });

  it('übersetzt unbekannte Kategorien in unknown', () => {
    expect(toNotificationErrorCategory('smtp_auth')).toBe('smtp_auth');
    expect(toNotificationErrorCategory('535 auth failed for user geheim')).toBe('unknown');
    expect(toNotificationErrorCategory(null)).toBe('unknown');
  });

  it('lässt keine zusätzlichen Felder zu', () => {
    expect(failedNotificationSchema.safeParse(valid).success).toBe(true);
    expect(failedNotificationSchema.safeParse({ ...valid, leaseToken: 'x' }).success).toBe(false);
    expect(
      failedNotificationSchema.safeParse({ ...valid, error: 'ECONNREFUSED 10.0.0.5' }).success,
    ).toBe(false);
    expect(
      failedNotificationSchema.safeParse({
        ...valid,
        booking: { ...valid.booking, participantEmailKey: 'erika@example.test' },
      }).success,
    ).toBe(false);
    expect(failedNotificationSchema.safeParse({ ...valid, booking: null }).success).toBe(true);
  });
});
