import {
  NOTIFICATION_ERROR_INFO,
  NOTIFICATION_TYPE_LABELS,
  formatDateTime,
  notificationTypeSchema,
} from '@fw-booking/shared';
import type { FailedNotification, NotificationType } from '@fw-booking/shared';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { requestErrorMessage } from '../../api/messages.js';
import { BOOKING_STATUS_LABELS, telHref } from '../../bookings/format.js';
import { useTimeZone } from '../../installation.js';
import {
  useDismissNotification,
  useFailedNotifications,
  useRetryNotification,
} from '../../notifications/queries.js';
import { usePageTitle } from '../../layout/usePageTitle.js';

const TYPES = notificationTypeSchema.options;

function parseType(value: string | null): NotificationType | '' {
  const parsed = notificationTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : '';
}

export function NotificationsPage(): ReactNode {
  usePageTitle('Benachrichtigungen');
  const [searchParams, setSearchParams] = useSearchParams();
  const type = parseType(searchParams.get('typ'));
  const failed = useFailedNotifications(type);
  const { timeZone } = useTimeZone();
  const [notice, setNotice] = useState<string | null>(null);

  const data = failed.data;
  return (
    <section>
      <h1>Benachrichtigungen</h1>
      <p className="muted">
        E-Mails an Teilnehmer, die auch nach mehreren automatischen Versuchen nicht zugestellt
        werden konnten.
      </p>

      {notice && (
        <p className="alert alert-success" role="status">
          {notice}
        </p>
      )}
      {data && data.retryingCount > 0 && (
        <p className="alert alert-warning">
          {data.retryingCount === 1
            ? '1 E-Mail wird gerade automatisch erneut versucht.'
            : `${String(data.retryingCount)} E-Mails werden gerade automatisch erneut versucht.`}
        </p>
      )}

      <div className="toolbar">
        <label className="inline-field">
          <span>Art</span>
          <select
            value={type}
            onChange={(event) => {
              const value = event.target.value;
              setSearchParams(value ? { typ: value } : {}, { replace: true });
            }}
          >
            <option value="">Alle Arten</option>
            {TYPES.map((option) => (
              <option key={option} value={option}>
                {NOTIFICATION_TYPE_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {failed.isPending && <p role="status">Benachrichtigungen werden geladen …</p>}
      {failed.isError && (
        <div className="alert alert-error" role="alert">
          <p>Die Benachrichtigungen konnten nicht geladen werden.</p>
          <button type="button" className="button" onClick={() => void failed.refetch()}>
            Erneut versuchen
          </button>
        </div>
      )}
      {data && data.notifications.length === 0 && (
        <div className="empty">
          <p>
            {type
              ? `Keine fehlgeschlagenen Benachrichtigungen der Art „${NOTIFICATION_TYPE_LABELS[type]}“.`
              : 'Keine offenen fehlgeschlagenen Benachrichtigungen.'}
          </p>
        </div>
      )}
      {data && data.notifications.length > 0 && (
        <>
          {data.total > data.notifications.length && (
            <p className="muted">
              Angezeigt werden die neuesten {data.notifications.length} von {data.total}.
            </p>
          )}
          <ul className="item-list" aria-label="Fehlgeschlagene Benachrichtigungen">
            {data.notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                timeZone={timeZone}
                onDone={setNotice}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function NotificationItem({
  notification,
  timeZone,
  onDone,
}: {
  notification: FailedNotification;
  timeZone: string;
  onDone: (text: string) => void;
}): ReactNode {
  const retry = useRetryNotification();
  const dismiss = useDismissNotification();
  const [confirming, setConfirming] = useState(false);
  const info = NOTIFICATION_ERROR_INFO[notification.category];
  const typeLabel = NOTIFICATION_TYPE_LABELS[notification.type];
  const { booking } = notification;
  const busy = retry.isPending || dismiss.isPending;
  const error = retry.error ?? dismiss.error;

  return (
    <li className="item notification">
      <div className="item-main">
        <span className="item-title">{typeLabel}</span>
        <span className="item-meta">
          <span>Fehlgeschlagen am {formatDateTime(notification.failedAt, timeZone)} Uhr</span>
          <span>
            {notification.attempts === 1
              ? '1 Versuch'
              : `${String(notification.attempts)} Versuche`}
          </span>
        </span>
        <p className="notification-reason">{info.label}</p>
        {booking ? (
          <p className="notification-booking">
            <Link to={`/buchungen/${booking.id}`}>{booking.participant.name}</Link> ·{' '}
            {booking.serviceTitle} am {formatDateTime(booking.startsAt, timeZone)} Uhr ·{' '}
            {BOOKING_STATUS_LABELS[booking.status]}
          </p>
        ) : (
          <p className="muted">Die zugehörige Buchung existiert nicht mehr.</p>
        )}
        {!info.retryUseful && booking && (
          <p className="field-hint">
            Ein erneuter Versand würde wieder scheitern. Bitte den Teilnehmer auf anderem Weg
            informieren, z. B. unter{' '}
            <a href={telHref(booking.participant.phone)}>{booking.participant.phone}</a>.
          </p>
        )}
        {error && (
          <p className="field-error" role="alert">
            {requestErrorMessage(error)}
          </p>
        )}
      </div>
      <div className="item-actions">
        {confirming ? (
          <>
            <span className="muted">
              Wirklich ausblenden? Die E-Mail wird dann nicht versendet.
            </span>
            <button
              type="button"
              className="button button-danger"
              disabled={busy}
              aria-label={`${typeLabel} vom ${formatDateTime(notification.failedAt, timeZone)} endgültig ausblenden`}
              onClick={() => {
                dismiss.mutate(notification.id, {
                  onSuccess: () => {
                    onDone(`${typeLabel} ausgeblendet.`);
                  },
                });
              }}
            >
              Ausblenden
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                dismiss.reset();
              }}
            >
              Abbrechen
            </button>
          </>
        ) : (
          <>
            {info.retryUseful && (
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                aria-label={`${typeLabel} vom ${formatDateTime(notification.failedAt, timeZone)} erneut senden`}
                onClick={() => {
                  retry.mutate(notification.id, {
                    onSuccess: () => {
                      onDone(`${typeLabel} wird erneut versendet.`);
                    },
                  });
                }}
              >
                {retry.isPending ? 'Wird eingereiht …' : 'Erneut senden'}
              </button>
            )}
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              aria-label={`${typeLabel} vom ${formatDateTime(notification.failedAt, timeZone)} ausblenden`}
              onClick={() => {
                setConfirming(true);
              }}
            >
              Ausblenden …
            </button>
          </>
        )}
      </div>
    </li>
  );
}
