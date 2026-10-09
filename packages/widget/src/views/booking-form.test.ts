import { describe, expect, it, vi } from 'vitest';
import { BOOKED_EVENT } from '../app.js';
import type { BookedDetail } from '../app.js';
import {
  CAL,
  HAIRCUT,
  TZ,
  YOGA,
  PILATES,
  click,
  datesResponse,
  json,
  mount,
  service,
  session,
  sessionsResponse,
  slot,
  slotsResponse,
} from '../test-utils.js';
import type { Handler } from '../test-utils.js';

type Widget = Awaited<ReturnType<typeof mount>>;

const BOOKINGS = '/bookings';
const PRIVACY = 'https://example.de/datenschutz';

const courses = {
  '/services': () =>
    json({ timeZone: TZ, services: [service(YOGA, 'Yoga'), service(PILATES, 'Pilates')] }),
  [`/services/${YOGA}/sessions`]: () =>
    sessionsResponse([session('s1', '2026-10-12T16:00:00Z', 3, 'Studio 1')]),
};

const haircut = {
  '/services': () => json({ timeZone: TZ, services: [service(HAIRCUT, 'Haarschnitt', 'single')] }),
  [`/services/${HAIRCUT}/available-dates`]: () => datesResponse(['2026-10-14']),
  [`/services/${HAIRCUT}/slots`]: () =>
    slotsResponse([slot('2026-10-14T12:30:00Z'), slot('2026-10-14T13:00:00Z')]),
};

function confirmation(type: 'group' | 'single', title: string, startsAt: string, endsAt: string) {
  return json(
    {
      bookingId: '66f1a2b3c4d5e6f708192aff',
      status: 'confirmed',
      serviceTitle: title,
      startsAt,
      endsAt,
      timeZone: TZ,
      ...(type === 'group' ? {} : {}),
    },
    201,
  );
}

const groupBooked: Handler = () =>
  confirmation('group', 'Yoga', '2026-10-12T16:00:00Z', '2026-10-12T17:00:00Z');
const singleBooked: Handler = () =>
  confirmation('single', 'Haarschnitt', '2026-10-14T12:30:00Z', '2026-10-14T13:00:00Z');

/** Bodies der Buchungsanfragen. */
function bookingBodies(w: Widget): Record<string, unknown>[] {
  return w.calls
    .filter((c) => c.url.pathname.endsWith(BOOKINGS))
    .map((c) => JSON.parse(c.body ?? '{}') as Record<string, unknown>);
}

async function chooseCourse(w: Widget) {
  await vi.waitFor(() => {
    expect(w.$('.fw-booking-service')).not.toBeNull();
  });
  click(w.$('.fw-booking-service'));
  await vi.waitFor(() => {
    expect(w.$('.fw-booking-session')).not.toBeNull();
  });
  click(w.$('.fw-booking-session'));
}

async function chooseSlot(w: Widget) {
  await vi.waitFor(() => {
    expect(w.$$('.fw-booking-slot')).toHaveLength(2);
  });
  click(w.$('.fw-booking-slot'));
}

function fill(w: Widget, values: Partial<Record<'name' | 'email' | 'phone', string>>) {
  for (const [name, value] of Object.entries(values)) {
    const input = w.$(`input[name="${name}"]`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new w.win.Event('input', { bubbles: true }));
  }
}

function fillValid(w: Widget) {
  fill(w, { name: ' Erika Mustermann ', email: 'erika@example.de ', phone: '0170 1234567' });
  const privacy = w.$('input[name="privacy"]') as HTMLInputElement;
  privacy.checked = true;
  privacy.dispatchEvent(new w.win.Event('change', { bubbles: true }));
}

function submit(w: Widget) {
  click(w.$('.fw-booking-submit'));
}

async function openForm(w: Widget) {
  click(w.$('.fw-booking-continue'));
  await vi.waitFor(() => {
    expect(w.$('.fw-booking-form')).not.toBeNull();
  });
}

describe('Weiter-Leiste', () => {
  it('erscheint erst mit einer Auswahl und fasst den Termin zusammen', async () => {
    const w = await mount(courses);
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-service')).not.toBeNull();
    });
    click(w.$('.fw-booking-service'));
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-session')).not.toBeNull();
    });
    expect(w.$('.fw-booking-continue-bar')?.hidden).toBe(true);
    click(w.$('.fw-booking-session'));
    expect(w.$('.fw-booking-continue-bar')?.hidden).toBe(false);
    expect(w.$('.fw-booking-chosen')?.textContent).toBe(
      'Gewählt: Yoga · Mo., 12. Okt. 2026 · 18:00–19:00',
    );
    expect(w.$('.fw-booking-continue')?.textContent).toBe('Weiter zu deinen Angaben');
  });

  it('verschwindet wieder, wenn die Auswahl durch einen Tageswechsel entfällt', async () => {
    const w = await mount({
      ...haircut,
      [`/services/${HAIRCUT}/available-dates`]: () => datesResponse(['2026-10-14', '2026-10-15']),
    });
    await chooseSlot(w);
    expect(w.$('.fw-booking-continue-bar')?.hidden).toBe(false);
    click(w.$('.fw-booking-day[data-date="2026-10-15"]'));
    expect(w.$('.fw-booking-continue-bar')?.hidden).toBe(true);
  });
});

describe('Formular', () => {
  it('zeigt Zusammenfassung, beschriftete Felder und den Link zu den Datenschutzhinweisen', async () => {
    const w = await mount(courses);
    await chooseCourse(w);
    await openForm(w);
    await Promise.resolve();
    expect(w.win.document.activeElement?.textContent).toBe('Deine Angaben');
    expect(w.$('.fw-booking-summary')?.textContent).toBe('Yoga · Mo., 12. Okt. 2026 · 18:00–19:00');
    for (const [name, type, autocomplete, label] of [
      ['name', 'text', 'name', 'Name'],
      ['email', 'email', 'email', 'E-Mail'],
      ['phone', 'tel', 'tel', 'Telefon'],
    ] as const) {
      const input = w.$(`input[name="${name}"]`) as HTMLInputElement;
      expect(input.type).toBe(type);
      expect(input.getAttribute('autocomplete')).toBe(autocomplete);
      expect(input.required).toBe(true);
      expect(w.$(`label[for="${input.id}"]`)?.textContent).toBe(label);
    }
    expect(w.$('.fw-booking-field-hint')?.textContent).toBe(
      'Nur für kurzfristige Rückfragen zum Termin.',
    );
    const privacy = w.$('input[name="privacy"]') as HTMLInputElement;
    expect(privacy.type).toBe('checkbox');
    expect(privacy.checked).toBe(false);
    expect(w.$(`label[for="${privacy.id}"]`)?.textContent).toBe(
      'Ich habe die Datenschutzhinweise gelesen.',
    );
    const link = w.$('.fw-booking-privacy-link') as HTMLAnchorElement;
    expect(link.href).toBe(PRIVACY);
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect((w.$('.fw-booking-submit') as HTMLButtonElement).type).toBe('submit');
    expect(w.$('.fw-booking-submit')?.textContent).toBe('Verbindlich buchen');
  });

  it('führt mit „Termin ändern“ ohne erneutes Laden zur Auswahl zurück', async () => {
    const w = await mount(courses);
    await chooseCourse(w);
    const requests = w.calls.length;
    await openForm(w);
    fill(w, { name: 'Erika' });
    click(w.$('.fw-booking-change'));
    expect(w.$('.fw-booking-session')?.getAttribute('aria-pressed')).toBe('true');
    expect(w.calls).toHaveLength(requests);
    // Eingaben bleiben für den nächsten Aufruf erhalten.
    await openForm(w);
    expect((w.$('input[name="name"]') as HTMLInputElement).value).toBe('Erika');
  });

  it('prüft Pflichtfelder vor dem Senden und markiert Fehler am Feld', async () => {
    const w = await mount(courses);
    await chooseCourse(w);
    await openForm(w);
    fill(w, { email: 'kein-at', phone: '12' });
    submit(w);
    expect(bookingBodies(w)).toEqual([]);
    expect(w.text('.fw-booking-field-error:not([hidden])')).toEqual([
      'Bitte gib deinen Namen an (mindestens 2 Zeichen).',
      'Bitte gib eine gültige E-Mail-Adresse an.',
      'Bitte gib eine Telefonnummer an (6–20 Zeichen: Ziffern, Leerzeichen und + - / ( )).',
      'Bitte bestätige, dass du die Datenschutzhinweise gelesen hast.',
    ]);
    const name = w.$('input[name="name"]') as HTMLInputElement;
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(name.getAttribute('aria-describedby')).toBe(`${name.id}-error`);
    expect(w.win.document.activeElement).toBe(name);
    fill(w, { name: 'Erika' });
    expect(name.hasAttribute('aria-invalid')).toBe(false);
    expect(w.$$('.fw-booking-field-error:not([hidden])')).toHaveLength(3);
  });

  it('bucht einen Kurstermin und zeigt die Bestätigung', async () => {
    const w = await mount({ ...courses, [BOOKINGS]: groupBooked });
    const booked: BookedDetail[] = [];
    w.container.addEventListener(BOOKED_EVENT, (event) => {
      booked.push((event as CustomEvent<BookedDetail>).detail);
    });
    await chooseCourse(w);
    await openForm(w);
    fillValid(w);
    submit(w);
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-confirmation')).not.toBeNull();
    });

    const [body] = bookingBodies(w);
    expect(body).toEqual({
      type: 'group',
      sessionId: 's1',
      participant: { name: 'Erika Mustermann', email: 'erika@example.de', phone: '0170 1234567' },
      privacyAccepted: true,
      idempotencyKey: expect.stringMatching(/^[0-9a-f]{32}$/) as string,
    });
    const call = w.calls.find((c) => c.url.pathname.endsWith(BOOKINGS));
    expect(call?.method).toBe('POST');

    expect(w.$('.fw-booking-confirmation-title')?.textContent).toBe('Dein Termin ist gebucht');
    expect(w.$('.fw-booking-confirmation .fw-booking-summary')?.textContent).toBe(
      'Yoga · Mo., 12. Okt. 2026 · 18:00–19:00',
    );
    expect(w.$('.fw-booking-confirmation-mail')?.textContent).toBe(
      'Du erhältst gleich eine Bestätigung per E-Mail an erika@example.de. Darin findest du auch den Link, mit dem du den Termin verwalten kannst.',
    );
    await Promise.resolve();
    expect(w.win.document.activeElement?.textContent).toBe('Dein Termin ist gebucht');

    expect(booked).toEqual([
      {
        calendarId: CAL,
        bookingId: '66f1a2b3c4d5e6f708192aff',
        type: 'group',
        serviceId: YOGA,
        serviceTitle: 'Yoga',
        startsAt: '2026-10-12T16:00:00Z',
        endsAt: '2026-10-12T17:00:00Z',
        timeZone: TZ,
      },
    ]);
    // Keine personenbezogenen Daten im Ereignis; die Auswahl ist zurückgesetzt.
    expect(JSON.stringify(booked)).not.toContain('erika@example.de');
    expect(JSON.stringify(booked)).not.toContain('0170 1234567');
    expect(w.instance.selection).toBeNull();
    expect(w.events.at(-1)).toBeNull();
  });

  it('bietet nach der Buchung einen weiteren Termin an, ohne alte Eingaben', async () => {
    const w = await mount({ ...courses, [BOOKINGS]: groupBooked });
    await chooseCourse(w);
    await openForm(w);
    fillValid(w);
    submit(w);
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-book-another')).not.toBeNull();
    });
    const servicesCalls = w.calls.filter((c) => c.url.pathname.endsWith('/services')).length;
    click(w.$('.fw-booking-book-another'));
    expect(w.text('.fw-booking-service-name')).toEqual(['Yoga', 'Pilates']);
    expect(w.calls.filter((c) => c.url.pathname.endsWith('/services'))).toHaveLength(servicesCalls);
    await chooseCourse(w);
    await openForm(w);
    expect((w.$('input[name="name"]') as HTMLInputElement).value).toBe('');
  });

  it('bucht einen Einzeltermin', async () => {
    const w = await mount({ ...haircut, [BOOKINGS]: singleBooked });
    await chooseSlot(w);
    expect(w.$('.fw-booking-chosen')?.textContent).toBe(
      'Gewählt: Haarschnitt · Mi., 14. Okt. 2026 · 14:30–15:00',
    );
    await openForm(w);
    fillValid(w);
    submit(w);
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-confirmation')).not.toBeNull();
    });
    expect(bookingBodies(w)).toEqual([
      {
        type: 'single',
        serviceId: HAIRCUT,
        startsAt: '2026-10-14T12:30:00Z',
        participant: { name: 'Erika Mustermann', email: 'erika@example.de', phone: '0170 1234567' },
        privacyAccepted: true,
        idempotencyKey: expect.stringMatching(/^[0-9a-f]{32}$/) as string,
      },
    ]);
    expect(w.$('.fw-booking-confirmation .fw-booking-summary')?.textContent).toBe(
      'Haarschnitt · Mi., 14. Okt. 2026 · 14:30–15:00',
    );
  });
});

describe('Doppelklick und Wiederholung', () => {
  it('sendet bei mehrfachem Absenden nur eine Anfrage und sperrt die Schaltflächen', async () => {
    let answer: (response: Response) => void = () => undefined;
    const w = await mount({
      ...courses,
      [BOOKINGS]: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    await chooseCourse(w);
    await openForm(w);
    fillValid(w);
    submit(w);
    submit(w);
    (w.$('.fw-booking-form') as HTMLFormElement).dispatchEvent(
      new w.win.Event('submit', { cancelable: true }),
    );
    expect(bookingBodies(w)).toHaveLength(1);
    const button = w.$('.fw-booking-submit') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Wird gebucht …');
    expect((w.$('.fw-booking-change') as HTMLButtonElement).disabled).toBe(true);
    expect(w.$('.fw-booking-form')?.getAttribute('aria-busy')).toBe('true');
    answer(groupBooked(new URL('https://x'), undefined) as Response);
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-confirmation')).not.toBeNull();
    });
    expect(bookingBodies(w)).toHaveLength(1);
  });

  it('verwendet nach einem Netzwerkfehler denselben Schlüssel, nach Änderungen einen neuen', async () => {
    const w = await mount({
      ...courses,
      [BOOKINGS]: [
        () => Promise.reject(new TypeError('Failed to fetch')),
        () => Promise.reject(new TypeError('Failed to fetch')),
        groupBooked,
      ],
    });
    await chooseCourse(w);
    await openForm(w);
    fillValid(w);
    submit(w);
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-form-status')?.textContent).toBe(
        'Die Buchung konnte nicht gesendet werden. Bitte prüfe deine Verbindung und versuche es erneut.',
      );
    });
    expect((w.$('.fw-booking-submit') as HTMLButtonElement).disabled).toBe(false);
    submit(w);
    await vi.waitFor(() => {
      expect(bookingBodies(w)).toHaveLength(2);
    });
    await vi.waitFor(() => {
      expect((w.$('.fw-booking-submit') as HTMLButtonElement).disabled).toBe(false);
    });
    fill(w, { phone: '0170 7654321' });
    submit(w);
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-confirmation')).not.toBeNull();
    });
    const keys = bookingBodies(w).map((b) => b['idempotencyKey']);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it('erzeugt nach idempotency_conflict einen neuen Schlüssel', async () => {
    const w = await mount({
      ...courses,
      [BOOKINGS]: [
        () => json({ statusCode: 409, message: 'x', code: 'idempotency_conflict' }, 409),
        groupBooked,
      ],
    });
    await chooseCourse(w);
    await openForm(w);
    fillValid(w);
    submit(w);
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-form-status')?.textContent).toBe(
        'Die Buchung konnte nicht eindeutig zugeordnet werden. Bitte sende sie erneut.',
      );
    });
    submit(w);
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-confirmation')).not.toBeNull();
    });
    const keys = bookingBodies(w).map((b) => b['idempotencyKey']);
    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe('Fehler bei der Buchung', () => {
  it('führt bei vergebener Uhrzeit zum selben Tag zurück und lädt die Zeiten neu', async () => {
    const w = await mount({
      ...haircut,
      [`/services/${HAIRCUT}/available-dates`]: () => datesResponse(['2026-10-13', '2026-10-14']),
      [`/services/${HAIRCUT}/slots`]: (url) =>
        slotsResponse([
          slot(`${url.searchParams.get('date') ?? ''}T12:30:00Z`),
          slot(`${url.searchParams.get('date') ?? ''}T13:00:00Z`),
        ]),
      [BOOKINGS]: () => json({ statusCode: 409, message: 'x', code: 'slot_taken' }, 409),
    });
    await chooseSlot(w);
    click(w.$('.fw-booking-day[data-date="2026-10-14"]'));
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-slots-title')?.textContent).toBe('Mittwoch, 14. Oktober 2026');
    });
    click(w.$('.fw-booking-slot'));
    await openForm(w);
    fillValid(w);
    submit(w);
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-step > .fw-booking-message--warning')?.textContent).toBe(
        'Diese Uhrzeit wurde gerade vergeben. Bitte wähle eine andere.',
      );
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-slots-title')?.textContent).toBe('Mittwoch, 14. Oktober 2026');
    });
    expect(w.instance.selection).toBeNull();
    expect(w.$('.fw-booking-continue-bar')?.hidden).toBe(true);
    const slotDates = w.calls
      .filter((c) => c.url.pathname.endsWith('/slots'))
      .map((c) => c.url.searchParams.get('date'));
    expect(slotDates).toEqual(['2026-10-13', '2026-10-14', '2026-10-14']);
    expect(w.calls.filter((c) => c.url.pathname.endsWith('/slots')).map((c) => c.cache)).toEqual([
      null,
      null,
      'reload',
    ]);
    // Eingaben bleiben für den nächsten Versuch erhalten.
    click(w.$('.fw-booking-slot'));
    await openForm(w);
    // type="email" entfernt Leerzeichen am Rand bereits im Browser.
    expect((w.$('input[name="email"]') as HTMLInputElement).value).toBe('erika@example.de');
  });

  it('führt bei ausgebuchtem Kurstermin zur Kursansicht zurück und lädt sie neu', async () => {
    const w = await mount({
      ...courses,
      [BOOKINGS]: () => json({ statusCode: 409, message: 'x', code: 'session_full' }, 409),
    });
    await chooseCourse(w);
    await openForm(w);
    fillValid(w);
    submit(w);
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-message--warning')?.textContent).toBe(
        'Dieser Kurstermin ist inzwischen ausgebucht. Bitte wähle einen anderen.',
      );
    });
    await vi.waitFor(() => {
      expect(w.calls.filter((c) => c.url.pathname.endsWith('/sessions'))).toHaveLength(2);
    });
    // Neu laden am Browser-Cache vorbei, sonst erschiene die alte Platzzahl.
    expect(w.calls.filter((c) => c.url.pathname.endsWith('/sessions')).map((c) => c.cache)).toEqual(
      [null, 'reload'],
    );
    // Mehrere Angebote: der Weg zurück zur Liste bleibt erhalten.
    expect(w.$('.fw-booking-back')).not.toBeNull();
  });

  it.each([
    ['already_booked', 409, 'Mit dieser E-Mail-Adresse ist dieser Kurstermin bereits gebucht.'],
    [
      'too_many_bookings',
      429,
      'Mit dieser E-Mail-Adresse wurden in kurzer Zeit zu viele Termine gebucht. Bitte versuche es später erneut.',
    ],
    [
      'rate_limited',
      429,
      'Zu viele Anfragen. Bitte warte einen Moment und versuche es dann erneut.',
    ],
  ])('bleibt bei %s im Formular und zeigt eine Meldung', async (code, status, message) => {
    const w = await mount({
      ...courses,
      [BOOKINGS]: () => json({ statusCode: status, message: 'x', code }, status),
    });
    await chooseCourse(w);
    await openForm(w);
    fillValid(w);
    submit(w);
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-form-status')?.textContent).toBe(message);
    });
    expect(w.$('.fw-booking-form-status')?.getAttribute('role')).toBe('alert');
    expect((w.$('input[name="name"]') as HTMLInputElement).value).toBe(' Erika Mustermann ');
  });

  it('ordnet Feldfehler der API den Feldern zu', async () => {
    const w = await mount({
      ...courses,
      [BOOKINGS]: () =>
        json(
          {
            message: 'Ungültige Eingabe',
            issues: [{ path: 'participant.email', message: 'Invalid email address' }],
          },
          400,
        ),
    });
    await chooseCourse(w);
    await openForm(w);
    fillValid(w);
    submit(w);
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-form-status')?.textContent).toBe('Bitte prüfe deine Angaben.');
    });
    expect(w.text('.fw-booking-field-error:not([hidden])')).toEqual([
      'Bitte gib eine gültige E-Mail-Adresse an.',
    ]);
    expect(w.$('input[name="email"]')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('bricht eine laufende Buchung beim Entfernen des Widgets ab', async () => {
    const w = await mount({
      ...courses,
      [BOOKINGS]: () => new Promise<Response>(() => undefined),
    });
    await chooseCourse(w);
    await openForm(w);
    fillValid(w);
    submit(w);
    w.api.unmount(w.container);
    const call = w.calls.find((c) => c.url.pathname.endsWith(BOOKINGS));
    expect(call?.signal?.aborted).toBe(true);
  });

  it('gibt Eingaben und Angebotstitel nie als HTML aus', async () => {
    const evil = '<img src=x onerror="alert(1)">';
    const w = await mount({
      '/services': () => json({ timeZone: TZ, services: [service(YOGA, evil)] }),
      [`/services/${YOGA}/sessions`]: () =>
        sessionsResponse([session('s1', '2026-10-12T16:00:00Z', 3)]),
      [BOOKINGS]: () => confirmation('group', evil, '2026-10-12T16:00:00Z', '2026-10-12T17:00:00Z'),
    });
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-session')).not.toBeNull();
    });
    click(w.$('.fw-booking-session'));
    await openForm(w);
    fillValid(w);
    fill(w, { name: evil, email: `x${evil}@example.de` });
    submit(w);
    // Name mit Sonderzeichen ist erlaubt, die E-Mail nicht.
    expect(w.text('.fw-booking-field-error:not([hidden])')).toEqual([
      'Bitte gib eine gültige E-Mail-Adresse an.',
    ]);
    fill(w, { email: 'erika@example.de' });
    submit(w);
    await vi.waitFor(() => {
      expect(w.$('.fw-booking-confirmation')).not.toBeNull();
    });
    expect(w.container.querySelector('img')).toBeNull();
    expect(w.$('.fw-booking-summary-service')?.textContent).toBe(evil);
  });
});
