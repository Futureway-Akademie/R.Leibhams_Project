import type { Service } from '@fw-booking/shared';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { isApiError } from '../../api/client.js';
import { usePageTitle } from '../../layout/usePageTitle.js';
import { serviceSummary } from '../../services/format.js';
import { moveService } from '../../services/order.js';
import type { MoveDirection } from '../../services/order.js';
import { useReorderServices, useServices, useUpdateService } from '../../services/queries.js';
import { mutationErrorMessage } from '../../services/messages.js';

type StatusFilter = 'alle' | 'aktiv' | 'inaktiv';

const FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: 'alle', label: 'Alle' },
  { value: 'aktiv', label: 'Aktiv' },
  { value: 'inaktiv', label: 'Inaktiv' },
];

function parseFilter(value: string | null): StatusFilter {
  return value === 'aktiv' || value === 'inaktiv' ? value : 'alle';
}

function matches(service: Service, filter: StatusFilter): boolean {
  if (filter === 'aktiv') return service.active;
  if (filter === 'inaktiv') return !service.active;
  return true;
}

/** Hinweis nach dem Speichern, übergeben über den Navigationszustand. */
export interface ServiceListState {
  notice: string;
}

function readNotice(state: unknown): string | null {
  return typeof state === 'object' && state !== null && 'notice' in state
    ? typeof state.notice === 'string'
      ? state.notice
      : null
    : null;
}

export function ServiceListPage(): ReactNode {
  usePageTitle('Angebote');
  const services = useServices();
  const update = useUpdateService();
  const reorder = useReorderServices();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = parseFilter(searchParams.get('status'));
  const [notice] = useState(() => readNotice(location.state));
  const [actionError, setActionError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  // Hinweis nur einmal zeigen: Navigationszustand entfernen, damit er beim Neuladen fehlt.
  useEffect(() => {
    if (readNotice(location.state) !== null) {
      void navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    }
  }, [location.state, location.pathname, location.search, navigate]);

  const all = services.data ?? [];
  const visible = all.filter((service) => matches(service, filter));

  function move(service: Service, direction: MoveDirection): void {
    const order = moveService(
      all.map((s) => s.id),
      visible.map((s) => s.id),
      service.id,
      direction,
    );
    if (!order) return;
    setActionError(null);
    reorder.mutate(order, {
      onError: (error) => {
        setActionError(
          isApiError(error, 400)
            ? 'Die Reihenfolge wurde nicht gespeichert, weil sich die Angebote inzwischen geändert haben. Die Liste wurde neu geladen.'
            : `Die Reihenfolge wurde nicht gespeichert. ${mutationErrorMessage(error)}`,
        );
      },
    });
    // Fokus bleibt auf dem verschobenen Angebot, auch wenn der Knopf am Rand deaktiviert wird.
    requestAnimationFrame(() => {
      const item = listRef.current?.querySelector<HTMLElement>(
        `[data-service-id="${service.id}"] button[data-direction="${direction}"]:not(:disabled)`,
      );
      (
        item ?? listRef.current?.querySelector<HTMLElement>(`[data-service-id="${service.id}"] a`)
      )?.focus();
    });
  }

  function toggleActive(service: Service): void {
    setActionError(null);
    update.mutate(
      { id: service.id, patch: { type: service.type, active: !service.active } },
      {
        onError: (error) => {
          setActionError(
            `„${service.title}“ wurde nicht ${service.active ? 'deaktiviert' : 'aktiviert'}. ${mutationErrorMessage(error)}`,
          );
        },
      },
    );
  }

  return (
    <section>
      <div className="page-header">
        <h1>Angebote</h1>
        <Link className="button button-primary" to="/angebote/neu">
          Neues Angebot
        </Link>
      </div>

      {notice && (
        <p className="alert alert-success" role="status">
          {notice}
        </p>
      )}
      {actionError && (
        <p className="alert alert-error" role="alert">
          {actionError}
        </p>
      )}

      {services.isPending && <p role="status">Angebote werden geladen …</p>}

      {services.isError && (
        <div className="alert alert-error" role="alert">
          <p>Die Angebote konnten nicht geladen werden.</p>
          <button type="button" className="button" onClick={() => void services.refetch()}>
            Erneut versuchen
          </button>
        </div>
      )}

      {services.isSuccess && all.length === 0 && (
        <div className="empty">
          <p>Noch keine Angebote angelegt.</p>
          <p className="muted">
            Lege Einzeltermine (z. B. Haarschnitt) oder Gruppenkurse (z. B. Yoga) an, die Kunden
            über das Widget buchen können.
          </p>
        </div>
      )}

      {services.isSuccess && all.length > 0 && (
        <>
          <fieldset className="segmented">
            <legend className="visually-hidden">Angebote filtern</legend>
            {FILTERS.map((option) => (
              <label key={option.value}>
                <input
                  type="radio"
                  name="status"
                  value={option.value}
                  checked={filter === option.value}
                  onChange={() => {
                    setSearchParams(option.value === 'alle' ? {} : { status: option.value }, {
                      replace: true,
                    });
                  }}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </fieldset>

          {visible.length === 0 ? (
            <p className="muted">
              {filter === 'aktiv' ? 'Keine aktiven Angebote.' : 'Keine inaktiven Angebote.'}
            </p>
          ) : (
            <ol ref={listRef} className="item-list" aria-label="Angebote in Anzeigereihenfolge">
              {visible.map((service, index) => (
                <li
                  key={service.id}
                  data-service-id={service.id}
                  className={service.active ? 'item' : 'item item-inactive'}
                >
                  <div className="item-main">
                    <Link className="item-title" to={`/angebote/${service.id}`}>
                      {service.title}
                    </Link>
                    <span className="item-meta">
                      {serviceSummary(service)}
                      {!service.active && <span className="badge">Inaktiv</span>}
                    </span>
                  </div>
                  <div className="item-actions">
                    <button
                      type="button"
                      className="button button-icon"
                      data-direction="up"
                      aria-label={`„${service.title}“ nach oben verschieben`}
                      disabled={index === 0 || reorder.isPending}
                      onClick={() => {
                        move(service, 'up');
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="button button-icon"
                      data-direction="down"
                      aria-label={`„${service.title}“ nach unten verschieben`}
                      disabled={index === visible.length - 1 || reorder.isPending}
                      onClick={() => {
                        move(service, 'down');
                      }}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={update.isPending && update.variables.id === service.id}
                      aria-label={`„${service.title}“ ${service.active ? 'deaktivieren' : 'aktivieren'}`}
                      onClick={() => {
                        toggleActive(service);
                      }}
                    >
                      {service.active ? 'Deaktivieren' : 'Aktivieren'}
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
