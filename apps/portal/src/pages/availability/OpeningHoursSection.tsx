import type { OpeningHoursResponse } from '@fw-booking/shared';
import { useId, useState } from 'react';
import type { ReactNode, SubmitEvent } from 'react';
import { requestErrorMessage } from '../../api/messages.js';
import {
  DEFAULT_WINDOW,
  copyDay,
  validateWeek,
  weekSignature,
  weekToInput,
} from '../../availability/opening-hours-form.js';
import type {
  DayInput,
  WeekErrors,
  WeekInput,
  WindowInput,
} from '../../availability/opening-hours-form.js';
import { useOpeningHours, useSaveOpeningHours } from '../../availability/queries.js';
import { ISO_WEEKDAYS, WEEKDAY_NAMES } from '../../availability/time.js';
import type { Weekday } from '../../availability/time.js';

export function OpeningHoursSection(): ReactNode {
  const openingHours = useOpeningHours();
  // Hier statt im Formular, weil das Formular nach dem Speichern neu aufgebaut wird.
  const [savedNotice, setSavedNotice] = useState(false);

  return (
    <section aria-labelledby="opening-hours-heading" className="section">
      <h2 id="opening-hours-heading">Wochenplan</h2>
      <p className="muted">
        Zu diesen Zeiten können Kunden Einzeltermine buchen. Gruppenkurse haben eigene Kurstermine.
      </p>
      {openingHours.isPending && <p role="status">Öffnungszeiten werden geladen …</p>}
      {openingHours.isError && (
        <div className="alert alert-error" role="alert">
          <p>Die Öffnungszeiten konnten nicht geladen werden.</p>
          <button type="button" className="button" onClick={() => void openingHours.refetch()}>
            Erneut versuchen
          </button>
        </div>
      )}
      {openingHours.isSuccess && (
        // Nach dem Speichern mit dem gespeicherten Stand neu aufbauen.
        <WeekForm
          key={JSON.stringify(openingHours.data.days)}
          saved={openingHours.data}
          showSaved={savedNotice}
          onSaved={() => {
            setSavedNotice(true);
          }}
          onEdit={() => {
            setSavedNotice(false);
          }}
        />
      )}
    </section>
  );
}

function WeekForm({
  saved,
  showSaved,
  onSaved,
  onEdit,
}: {
  saved: OpeningHoursResponse;
  showSaved: boolean;
  onSaved: () => void;
  onEdit: () => void;
}): ReactNode {
  const base = useId();
  const save = useSaveOpeningHours();
  const initial = weekToInput(saved.days);
  const [week, setWeek] = useState<WeekInput>(initial);
  const [errors, setErrors] = useState<WeekErrors>({});
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [copySource, setCopySource] = useState<Weekday | null>(null);
  const dirty = weekSignature(week) !== weekSignature(initial);

  const fieldId = (key: string): string => `${base}-${key.replaceAll('.', '-')}`;

  function updateDay(weekday: Weekday, change: (day: DayInput) => DayInput): void {
    setWeek((current) => ({ ...current, [weekday]: change(current[weekday]) }));
    // Meldungen dieses Tages gelten nach einer Änderung nicht mehr.
    setErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.startsWith(`${String(weekday)}.`)),
      ),
    );
    setResult(null);
    onEdit();
  }

  function updateWindow(weekday: Weekday, index: number, patch: Partial<WindowInput>): void {
    updateDay(weekday, (day) => ({
      ...day,
      windows: day.windows.map((w, i) => (i === index ? { ...w, ...patch } : w)),
    }));
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (save.isPending) return;
    const validation = validateWeek(week);
    if (!validation.ok) {
      setErrors(validation.errors);
      setResult({ ok: false, text: 'Bitte die markierten Angaben prüfen.' });
      requestAnimationFrame(() => {
        document.getElementById(fieldId(validation.firstError))?.focus();
      });
      return;
    }
    setErrors({});
    save.mutate(validation.days, {
      onSuccess: onSaved,
      onError: (error) => {
        setResult({
          ok: false,
          text: `Die Öffnungszeiten wurden nicht gespeichert. ${requestErrorMessage(error)}`,
        });
      },
    });
  }

  return (
    <form className="form form-wide" noValidate onSubmit={handleSubmit}>
      <p className="field-hint">
        Alle Zeiten gelten in der Zeitzone <strong>{saved.timeZone}</strong>.
      </p>
      {showSaved && !dirty && (
        <p className="alert alert-success" role="status">
          Öffnungszeiten gespeichert.
        </p>
      )}
      {result && !result.ok && (
        <p className="alert alert-error" role="alert">
          {result.text}
        </p>
      )}
      {errors.form && (
        <p className="alert alert-error" role="alert" id={fieldId('form')} tabIndex={-1}>
          {errors.form}
        </p>
      )}

      <ul className="week">
        {ISO_WEEKDAYS.map((weekday) => {
          const day = week[weekday];
          const name = WEEKDAY_NAMES[weekday];
          const dayError = errors[`${String(weekday)}.day`];
          return (
            <li key={weekday} className="week-day">
              <fieldset aria-describedby={dayError ? fieldId(`${String(weekday)}.day`) : undefined}>
                <legend className="visually-hidden">{name}</legend>
                <div className="week-day-header">
                  <span className="week-day-name" aria-hidden="true">
                    {name}
                  </span>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={day.open}
                      onChange={(event) => {
                        const open = event.target.checked;
                        updateDay(weekday, (current) => ({
                          open,
                          windows:
                            open && current.windows.length === 0
                              ? [{ ...DEFAULT_WINDOW }]
                              : current.windows,
                        }));
                      }}
                    />
                    <span>Geöffnet</span>
                  </label>
                  {!day.open && <span className="muted">Geschlossen – keine Einzeltermine</span>}
                </div>

                {day.open && (
                  <div className="week-windows">
                    {day.windows.map((window, index) => {
                      const key = `${String(weekday)}.${String(index)}`;
                      const startError = errors[`${key}.start`];
                      const endError = errors[`${key}.end`];
                      return (
                        <div key={index} className="time-window">
                          <div className="field">
                            <label htmlFor={fieldId(`${key}.start`)}>Von</label>
                            <input
                              id={fieldId(`${key}.start`)}
                              type="time"
                              step={300}
                              value={window.start}
                              aria-label={`${name}, Zeitfenster ${String(index + 1)}: von`}
                              aria-invalid={startError ? true : undefined}
                              aria-describedby={
                                startError ? `${fieldId(`${key}.start`)}-error` : undefined
                              }
                              onChange={(event) => {
                                updateWindow(weekday, index, { start: event.target.value });
                              }}
                            />
                            {startError && (
                              <p id={`${fieldId(`${key}.start`)}-error`} className="field-error">
                                {startError}
                              </p>
                            )}
                          </div>
                          <div className="field">
                            {window.untilMidnight ? (
                              <>
                                <span className="field-label">Bis</span>
                                <p className="field-static time-midnight">24:00</p>
                              </>
                            ) : (
                              <>
                                <label htmlFor={fieldId(`${key}.end`)}>Bis</label>
                                <input
                                  id={fieldId(`${key}.end`)}
                                  type="time"
                                  step={300}
                                  value={window.end}
                                  aria-label={`${name}, Zeitfenster ${String(index + 1)}: bis`}
                                  aria-invalid={endError ? true : undefined}
                                  aria-describedby={
                                    endError ? `${fieldId(`${key}.end`)}-error` : undefined
                                  }
                                  onChange={(event) => {
                                    updateWindow(weekday, index, { end: event.target.value });
                                  }}
                                />
                              </>
                            )}
                            {endError && (
                              <p id={`${fieldId(`${key}.end`)}-error`} className="field-error">
                                {endError}
                              </p>
                            )}
                          </div>
                          <label className="checkbox time-window-midnight">
                            <input
                              type="checkbox"
                              checked={window.untilMidnight}
                              aria-label={`${name}, Zeitfenster ${String(index + 1)}: bis Mitternacht`}
                              onChange={(event) => {
                                updateWindow(weekday, index, {
                                  untilMidnight: event.target.checked,
                                });
                              }}
                            />
                            <span aria-hidden="true">bis Mitternacht</span>
                          </label>
                          <button
                            type="button"
                            className="button button-secondary button-small"
                            aria-label={`${name}, Zeitfenster ${String(index + 1)} entfernen`}
                            onClick={() => {
                              updateDay(weekday, (current) => {
                                const windows = current.windows.filter((_, i) => i !== index);
                                return { open: windows.length > 0, windows };
                              });
                            }}
                          >
                            Entfernen
                          </button>
                        </div>
                      );
                    })}
                    {dayError && (
                      <p
                        id={fieldId(`${String(weekday)}.day`)}
                        className="field-error"
                        tabIndex={-1}
                      >
                        {dayError}
                      </p>
                    )}
                    <div className="week-day-actions">
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        aria-label={`${name}: Zeitfenster hinzufügen`}
                        onClick={() => {
                          updateDay(weekday, (current) => ({
                            ...current,
                            windows: [...current.windows, nextWindow(current.windows)],
                          }));
                        }}
                      >
                        + Zeitfenster
                      </button>
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        aria-expanded={copySource === weekday}
                        aria-label={`${name} auf andere Tage übertragen`}
                        onClick={() => {
                          setCopySource(copySource === weekday ? null : weekday);
                        }}
                      >
                        Auf andere Tage übertragen
                      </button>
                    </div>
                  </div>
                )}
                {!day.open && dayError && (
                  <p id={fieldId(`${String(weekday)}.day`)} className="field-error" tabIndex={-1}>
                    {dayError}
                  </p>
                )}
              </fieldset>
              {copySource === weekday && day.open && (
                <CopyPanel
                  source={weekday}
                  onCancel={() => {
                    setCopySource(null);
                  }}
                  onCopy={(targets) => {
                    setWeek((current) => copyDay(current, weekday, targets));
                    setCopySource(null);
                    setResult(null);
                    onEdit();
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>

      <div className="form-actions">
        <button type="submit" className="button button-primary" disabled={save.isPending || !dirty}>
          {save.isPending ? 'Wird gespeichert …' : 'Öffnungszeiten speichern'}
        </button>
        {dirty && (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setWeek(initial);
              setErrors({});
              setResult(null);
            }}
          >
            Änderungen verwerfen
          </button>
        )}
        {dirty && <span className="muted">Ungespeicherte Änderungen</span>}
      </div>
    </form>
  );
}

/** Neues Zeitfenster nach dem letzten (eine Stunde später), sonst Standard. */
function nextWindow(windows: readonly WindowInput[]): WindowInput {
  const last = windows.at(-1);
  if (!last || last.untilMidnight || !/^\d\d:\d\d$/.test(last.end)) return { ...DEFAULT_WINDOW };
  const startHour = Number(last.end.slice(0, 2)) + 1;
  if (startHour >= 23) return { ...DEFAULT_WINDOW };
  const pad = (n: number): string => String(n).padStart(2, '0');
  return {
    start: `${pad(startHour)}:${last.end.slice(3)}`,
    end: `${pad(Math.min(startHour + 4, 23))}:${last.end.slice(3)}`,
    untilMidnight: false,
  };
}

function CopyPanel({
  source,
  onCopy,
  onCancel,
}: {
  source: Weekday;
  onCopy: (targets: Weekday[]) => void;
  onCancel: () => void;
}): ReactNode {
  const [targets, setTargets] = useState<Weekday[]>([]);
  const others = ISO_WEEKDAYS.filter((weekday) => weekday !== source);
  return (
    <fieldset className="copy-panel">
      <legend>{WEEKDAY_NAMES[source]} übertragen auf</legend>
      <div className="copy-panel-days">
        {others.map((weekday) => (
          <label key={weekday} className="checkbox">
            <input
              type="checkbox"
              checked={targets.includes(weekday)}
              onChange={(event) => {
                setTargets((current) =>
                  event.target.checked
                    ? [...current, weekday]
                    : current.filter((day) => day !== weekday),
                );
              }}
            />
            <span>{WEEKDAY_NAMES[weekday]}</span>
          </label>
        ))}
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="button button-primary button-small"
          disabled={targets.length === 0}
          onClick={() => {
            onCopy(targets);
          }}
        >
          Übertragen
        </button>
        <button type="button" className="button button-secondary button-small" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </fieldset>
  );
}
