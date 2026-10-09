import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ruleSummary } from '../../courses/format.js';
import { useCourseRules } from '../../courses/queries.js';
import { FlashMessage, useFlash } from '../../layout/flash.js';
import { usePageTitle } from '../../layout/usePageTitle.js';
import { useServices } from '../../services/queries.js';

export function RuleListPage(): ReactNode {
  usePageTitle('Kursregeln');
  const flash = useFlash();
  const rules = useCourseRules();
  const services = useServices();
  const titles = new Map((services.data ?? []).map((s) => [s.id, s.title]));

  return (
    <section>
      <FlashMessage flash={flash} />
      <div className="toolbar">
        <p className="muted toolbar-text">
          Regeln erzeugen Kurstermine automatisch bis zum Buchungshorizont, z. B. „jeden Montag um
          18:00 Uhr“.
        </p>
        <Link className="button button-primary" to="/kurstermine/regeln/neu">
          Neue Regel
        </Link>
      </div>

      {rules.isPending && <p role="status">Regeln werden geladen …</p>}
      {rules.isError && (
        <div className="alert alert-error" role="alert">
          <p>Die Regeln konnten nicht geladen werden.</p>
          <button type="button" className="button" onClick={() => void rules.refetch()}>
            Erneut versuchen
          </button>
        </div>
      )}
      {rules.isSuccess && rules.data.length === 0 && (
        <div className="empty">
          <p>Noch keine wiederkehrenden Regeln.</p>
        </div>
      )}
      {rules.isSuccess && rules.data.length > 0 && (
        <ul className="item-list" aria-label="Kursregeln">
          {rules.data.map((rule) => (
            <li key={rule.id} className="item">
              <div className="item-main">
                <Link className="item-title" to={`/kurstermine/regeln/${rule.id}`}>
                  {titles.get(rule.serviceId) ?? 'Gruppenkurs'}
                </Link>
                <span className="item-meta">
                  {ruleSummary(rule)}
                  {rule.capacity !== null && ` · ${String(rule.capacity)} Plätze`}
                  {rule.location && ` · ${rule.location}`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
