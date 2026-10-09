// Einzeltermin-Ansicht: Monatskalender mit Tagen, an denen freie Slots existieren, und die freien
// Startzeiten des gewählten Tages nach Tageszeit gruppiert. Der erste freie Tag ist vorausgewählt.
// Jeder Tageswechsel lädt die Slots neu und bricht die vorherige Abfrage ab.
import type { PublicService, PublicSlot } from '@fw-booking/shared';
import { DEFAULT_LOCALE, differsFromDeviceTimeZone, formatTime } from '@fw-booking/shared/format';
import type { ApiClient } from '../api/client.js';
import { button, el } from '../dom.js';
import { loadErrorMessage, messages } from '../messages.js';
import {
  addDays,
  addMonths,
  localDate,
  localHour,
  monthOf,
  monthRange,
  weekdayIndex,
} from '../time.js';
import { errorMessage, infoMessage, statusMessage } from './common.js';
import { serviceHeader } from './service-header.js';

/** Wie weit der Kalender nach vorn blättert bzw. nach dem ersten freien Tag sucht. */
export const MAX_MONTHS_AHEAD = 12;

const WEEKDAYS = [
  ['Mo', 'Montag'],
  ['Di', 'Dienstag'],
  ['Mi', 'Mittwoch'],
  ['Do', 'Donnerstag'],
  ['Fr', 'Freitag'],
  ['Sa', 'Samstag'],
  ['So', 'Sonntag'],
] as const;

/** Tageszeiten nach lokaler Stunde: bis 11 Uhr, 12–17 Uhr, ab 18 Uhr. */
const DAY_PARTS = [
  { key: 'morning', title: messages.morning, from: 0, to: 12 },
  { key: 'afternoon', title: messages.afternoon, from: 12, to: 18 },
  { key: 'evening', title: messages.evening, from: 18, to: 24 },
] as const;

export interface SingleViewOptions {
  doc: Document;
  api: ApiClient;
  /** Wird abgebrochen, sobald die Ansicht verlassen oder das Widget entfernt wird. */
  signal: AbortSignal;
  service: PublicService;
  timeZone: string;
  now: () => Date;
  back: (() => void) | null;
  /** Tag, der bevorzugt gewählt wird (z. B. nach einem vergebenen Termin), sonst der erste freie. */
  preferredDay?: string | null;
  /** Gewählter Slot oder `null`, wenn die Auswahl durch einen Tageswechsel entfällt. */
  onSelect: (slot: PublicSlot | null) => void;
}

/** Kalendertag als Datum ohne Uhrzeit (für Beschriftungen, unabhängig von Zeitzonen). */
function plainDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

const monthFormat = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
});
const dayFormat = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export function singleView(options: SingleViewOptions): HTMLElement {
  const { doc, api, signal, service, timeZone } = options;
  const today = localDate(options.now(), timeZone);
  const firstMonth = monthOf(today);
  const lastMonth = addMonths(firstMonth, MAX_MONTHS_AHEAD - 1);

  const title = el(doc, 'h4', { className: 'month-title', attrs: { 'aria-live': 'polite' } });
  const prev = button(doc, { className: 'month-prev', text: messages.previousMonth }, () => {
    void showMonth(addMonths(month, -1));
  });
  const next = button(doc, { className: 'month-next', text: messages.nextMonth }, () => {
    void showMonth(addMonths(month, 1));
  });
  // Echte Tabelle (eine Zeile je Woche): auch ohne Styling als Kalender lesbar.
  const grid = el(doc, 'tbody', { className: 'calendar-body' });
  const table = el(doc, 'table', { className: 'calendar-grid' }, [
    el(doc, 'thead', {}, [
      el(
        doc,
        'tr',
        {},
        WEEKDAYS.map(([short, long]) =>
          el(doc, 'th', { className: 'weekday', text: short, attrs: { scope: 'col', abbr: long } }),
        ),
      ),
    ]),
    grid,
  ]);
  const calendarStatus = el(doc, 'div', { className: 'calendar-status' });
  const slotsArea = el(doc, 'div', { className: 'slots', attrs: { 'aria-live': 'polite' } });

  const view = el(doc, 'div', { className: ['view', 'single'] }, [
    serviceHeader(doc, service, options.back),
    differsFromDeviceTimeZone(timeZone) &&
      el(doc, 'p', { className: 'hint', text: messages.timeZoneHint(timeZone) }),
    el(doc, 'div', { className: 'calendar' }, [
      el(doc, 'div', { className: 'calendar-nav' }, [prev, title, next]),
      table,
      calendarStatus,
    ]),
    slotsArea,
  ]);

  /** Freie Tage je Monat; einmal geladen, bis die Ansicht verlassen wird. */
  const freeDays = new Map<string, Set<string>>();
  let month = firstMonth;
  let selectedDay: string | null = null;
  /** Tag mit dem einzigen Tab-Stopp im Raster (roving tabindex). */
  let focusDay: string | null = null;
  let selectedSlot: string | null = null;
  let slotController: AbortController | null = null;

  async function loadMonth(target: string): Promise<Set<string>> {
    const cached = freeDays.get(target);
    if (cached) return cached;
    const { first, last } = monthRange(target);
    const from = target === firstMonth ? today : first;
    const response = await api.getAvailableDates(service.id, from, last, signal);
    const days = new Set(response.dates);
    freeDays.set(target, days);
    return days;
  }

  function renderGrid(target: string, days: Set<string>) {
    const { first, last } = monthRange(target);
    title.textContent = monthFormat.format(plainDate(first));
    prev.disabled = target <= firstMonth;
    next.disabled = target >= lastMonth;
    const cells: HTMLElement[] = [];
    for (let i = 0; i < weekdayIndex(first); i++) {
      cells.push(el(doc, 'td', { className: 'day-empty' }));
    }
    const tabbable = tabbableDay(first, last, days);
    for (let day = first; day <= last; day = addDays(day, 1)) {
      const free = days.has(day);
      const date = day;
      // Nicht verfügbare Tage bleiben fokussierbar (aria-disabled statt disabled), damit die
      // Pfeiltasten durch den ganzen Monat führen.
      const node = button(
        doc,
        {
          className: free ? ['day', 'day--free'] : ['day', 'day--unavailable'],
          text: String(Number(day.slice(8))),
          attrs: {
            'aria-label': dayFormat.format(plainDate(day)),
            'data-date': day,
            tabindex: day === tabbable ? '0' : '-1',
          },
        },
        () => {
          focusDay = date;
          if (free) selectDay(date);
        },
      );
      if (!free) node.setAttribute('aria-disabled', 'true');
      node.setAttribute('aria-pressed', String(day === selectedDay));
      if (day === selectedDay) node.classList.add('fw-booking-day--selected');
      if (day === today) node.setAttribute('aria-current', 'date');
      cells.push(el(doc, 'td', { className: 'day-cell' }, [node]));
    }
    while (cells.length % 7 !== 0) cells.push(el(doc, 'td', { className: 'day-empty' }));
    const rows: HTMLElement[] = [];
    for (let i = 0; i < cells.length; i += 7) {
      rows.push(el(doc, 'tr', { className: 'week' }, cells.slice(i, i + 7)));
    }
    grid.replaceChildren(...rows);
  }

  /** Tab-Stopp im Monat: zuletzt fokussierter, gewählter, erster freier Tag, heute oder der 1. */
  function tabbableDay(first: string, last: string, days: Set<string>): string {
    const inMonth = (day: string | null): day is string =>
      day !== null && day >= first && day <= last;
    if (inMonth(focusDay)) return focusDay;
    if (inMonth(selectedDay)) return selectedDay;
    const [firstFree] = [...days].sort();
    if (firstFree !== undefined) return firstFree;
    return inMonth(today) ? today : first;
  }

  function dayButton(day: string): HTMLButtonElement | null {
    return grid.querySelector<HTMLButtonElement>(`[data-date="${day}"]`);
  }

  /** Bewegt den Fokus auf einen Tag, wechselt bei Bedarf den Monat (innerhalb der Grenzen). */
  async function moveFocus(target: string): Promise<void> {
    const first = monthRange(firstMonth).first;
    const last = monthRange(lastMonth).last;
    const day = target < first ? first : target > last ? last : target;
    focusDay = day;
    if (monthOf(day) !== month) await showMonth(monthOf(day));
    if (monthOf(day) !== month) return;
    for (const node of grid.querySelectorAll<HTMLButtonElement>('.fw-booking-day')) {
      node.tabIndex = node.dataset['date'] === day ? 0 : -1;
    }
    dayButton(day)?.focus();
  }

  /** Gleicher Tag im Nachbarmonat, begrenzt auf dessen Länge (31.1. → 28.2.). */
  function sameDayInMonth(day: string, months: number): string {
    const target = addMonths(monthOf(day), months);
    const { last } = monthRange(target);
    const candidate = `${target}-${day.slice(8)}`;
    return candidate > last ? last : candidate;
  }

  grid.addEventListener('keydown', (event) => {
    const day = (event.target as HTMLElement).dataset['date'];
    if (day === undefined) return;
    let target: string | null = null;
    switch (event.key) {
      case 'ArrowLeft':
        target = addDays(day, -1);
        break;
      case 'ArrowRight':
        target = addDays(day, 1);
        break;
      case 'ArrowUp':
        target = addDays(day, -7);
        break;
      case 'ArrowDown':
        target = addDays(day, 7);
        break;
      case 'Home':
        target = addDays(day, -weekdayIndex(day));
        break;
      case 'End':
        target = addDays(day, 6 - weekdayIndex(day));
        break;
      case 'PageUp':
        target = sameDayInMonth(day, -1);
        break;
      case 'PageDown':
        target = sameDayInMonth(day, 1);
        break;
      default:
        return;
    }
    event.preventDefault();
    void moveFocus(target);
  });

  function renderMonth(target: string, days: Set<string>) {
    renderGrid(target, days);
    calendarStatus.replaceChildren(
      ...(days.size === 0 ? [infoMessage(doc, messages.noFreeDaysInMonth)] : []),
    );
  }

  async function showMonth(target: string): Promise<void> {
    month = target;
    // Bereits geladene Monate sofort zeigen, ohne Ladezustand.
    const cached = freeDays.get(target);
    if (cached) {
      renderMonth(target, cached);
      return;
    }
    calendarStatus.replaceChildren(statusMessage(doc, messages.loadingDays));
    prev.disabled = true;
    next.disabled = true;
    let days: Set<string>;
    try {
      days = await loadMonth(target);
    } catch (error) {
      if (signal.aborted || month !== target) return;
      prev.disabled = target <= firstMonth;
      next.disabled = target >= lastMonth;
      calendarStatus.replaceChildren(
        errorMessage(doc, loadErrorMessage(error), () => {
          void showMonth(target);
        }),
      );
      return;
    }
    if (signal.aborted || month !== target) return;
    renderMonth(target, days);
  }

  function updateDayButtons() {
    for (const node of grid.querySelectorAll<HTMLButtonElement>('.fw-booking-day')) {
      const isSelected = node.dataset['date'] === selectedDay;
      node.setAttribute('aria-pressed', String(isSelected));
      node.classList.toggle('fw-booking-day--selected', isSelected);
      node.tabIndex = node.dataset['date'] === (focusDay ?? selectedDay) ? 0 : -1;
    }
  }

  function selectDay(day: string) {
    if (day === selectedDay) return;
    selectedDay = day;
    focusDay = day;
    updateDayButtons();
    if (selectedSlot !== null) {
      selectedSlot = null;
      options.onSelect(null);
    }
    void loadSlots(day);
  }

  async function loadSlots(day: string): Promise<void> {
    slotController?.abort();
    const controller = new AbortController();
    slotController = controller;
    const abort = () => {
      controller.abort();
    };
    signal.addEventListener('abort', abort);
    slotsArea.replaceChildren(statusMessage(doc, messages.loadingSlots));
    let slots: PublicSlot[];
    try {
      slots = (await api.getSlots(service.id, day, controller.signal)).slots;
    } catch (error) {
      if (controller.signal.aborted) return;
      slotsArea.replaceChildren(
        errorMessage(doc, loadErrorMessage(error), () => {
          void loadSlots(day);
        }),
      );
      return;
    } finally {
      signal.removeEventListener('abort', abort);
    }
    if (controller.signal.aborted) return;
    renderSlots(day, slots);
  }

  function renderSlots(day: string, slots: PublicSlot[]) {
    const heading = el(doc, 'h4', {
      className: 'slots-title',
      text: dayFormat.format(plainDate(day)),
    });
    if (slots.length === 0) {
      slotsArea.replaceChildren(heading, infoMessage(doc, messages.noSlotsOnDay));
      return;
    }
    const buttons: HTMLButtonElement[] = [];
    const groups = DAY_PARTS.map((part) => {
      const inPart = slots.filter((slot) => {
        const hour = localHour(slot.startsAt, timeZone);
        return hour >= part.from && hour < part.to;
      });
      if (inPart.length === 0) return null;
      return el(doc, 'section', { className: ['slot-group', `slot-group--${part.key}`] }, [
        el(doc, 'h5', { className: 'slot-group-title', text: part.title }),
        el(
          doc,
          'ul',
          { className: 'slot-list' },
          inPart.map((slot) => {
            const start = formatTime(slot.startsAt, timeZone);
            const node = button(
              doc,
              {
                className: 'slot',
                text: start,
                attrs: {
                  'aria-label': `${start}–${formatTime(slot.endsAt, timeZone)}`,
                  'aria-pressed': 'false',
                  // Ein Tab-Stopp für alle Uhrzeiten (roving tabindex), Pfeiltasten wechseln.
                  tabindex: buttons.length === 0 ? '0' : '-1',
                },
              },
              () => {
                selectedSlot = slot.startsAt;
                for (const other of buttons) {
                  const isSelected = other === node;
                  other.setAttribute('aria-pressed', String(isSelected));
                  other.classList.toggle('fw-booking-slot--selected', isSelected);
                  other.tabIndex = isSelected ? 0 : -1;
                }
                options.onSelect(slot);
              },
            );
            buttons.push(node);
            return el(doc, 'li', { className: 'slot-item' }, [node]);
          }),
        ),
      ]);
    });
    slotsArea.replaceChildren(heading, ...groups.filter((g) => g !== null));
    slotButtons = buttons;
  }

  /** Uhrzeiten der aktuellen Anzeige in Reihenfolge (für die Pfeiltasten). */
  let slotButtons: HTMLButtonElement[] = [];

  slotsArea.addEventListener('keydown', (event) => {
    const index = slotButtons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    let target: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        target = Math.min(index + 1, slotButtons.length - 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        target = Math.max(index - 1, 0);
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = slotButtons.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    for (const [i, node] of slotButtons.entries()) node.tabIndex = i === target ? 0 : -1;
    slotButtons[target]?.focus();
  });

  /**
   * Sucht ab dem aktuellen (bzw. bevorzugten) Monat den ersten Monat mit freien Tagen und wählt
   * den bevorzugten Tag, falls er noch frei ist, sonst den ersten freien Tag.
   */
  async function start(): Promise<void> {
    calendarStatus.replaceChildren(statusMessage(doc, messages.loadingDays));
    prev.disabled = true;
    next.disabled = true;
    const preferred = options.preferredDay ?? null;
    const startMonth =
      preferred !== null && monthOf(preferred) > firstMonth && monthOf(preferred) <= lastMonth
        ? monthOf(preferred)
        : firstMonth;
    for (let target = startMonth; target <= lastMonth; target = addMonths(target, 1)) {
      let days: Set<string>;
      try {
        days = await loadMonth(target);
      } catch (error) {
        if (signal.aborted) return;
        month = target;
        calendarStatus.replaceChildren(
          errorMessage(doc, loadErrorMessage(error), () => {
            void start();
          }),
        );
        return;
      }
      if (signal.aborted) return;
      const sorted = [...days].sort();
      const choice =
        preferred !== null && days.has(preferred)
          ? preferred
          : (sorted.find((day) => preferred === null || day >= preferred) ?? sorted[0]);
      if (choice !== undefined) {
        month = target;
        renderGrid(target, days);
        calendarStatus.replaceChildren();
        selectDay(choice);
        return;
      }
    }
    // Kein freier Tag im gesamten Zeitraum: aktuellen Monat ohne wählbare Tage zeigen.
    month = firstMonth;
    renderGrid(firstMonth, freeDays.get(firstMonth) ?? new Set());
    calendarStatus.replaceChildren(infoMessage(doc, messages.noFreeDays));
    prev.disabled = true;
    next.disabled = true;
  }

  void start();
  return view;
}
