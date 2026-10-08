import { describe, expect, it } from 'vitest';
import { JobError } from '../errors.js';
import { cancellationMail, ownerCancellationMail, rebookedMail } from './changes.js';
import { confirmationMail } from './confirmation.js';
import type { ConfirmationData } from './confirmation.js';
import { buildIcs, escapeText, foldLine } from './ics.js';
import { escapeHtml } from './layout.js';
import { classifySmtpError } from './mailer.js';

const TOKEN = 'A'.repeat(43);

const data: ConfirmationData = {
  calendarId: '65f1a2b3c4d5e6f7a8b9c0d1',
  participantName: 'Erika Mustermann',
  serviceTitle: 'Haarschnitt',
  // 14.10.2026, 10:00–10:30 Uhr in Berlin (Sommerzeit)
  startsAt: new Date('2026-10-14T08:00:00Z'),
  endsAt: new Date('2026-10-14T08:30:00Z'),
  timeZone: 'Europe/Berlin',
  location: 'Salon, 1. OG',
  changeDeadline: new Date('2026-10-13T08:00:00Z'),
  manageUrl: `https://friseur.test/termin-verwalten#t=${TOKEN}`,
  businessName: 'Friseur Muster',
  businessPhone: '030 123456',
  replyTo: 'info@friseur.test',
  domain: 'friseur.test',
  now: new Date('2026-10-08T12:00:00Z'),
};

describe('confirmationMail', () => {
  it('enthält Angebot, Termin in Ortszeit, Ort, Frist, Link und Kontakt', () => {
    const mail = confirmationMail(data);
    expect(mail.subject).toBe('Terminbestätigung: Haarschnitt am Mi., 14. Okt. 2026');
    for (const part of [
      'Hallo Erika Mustermann,',
      'Angebot: Haarschnitt',
      'Datum: Mi., 14. Okt. 2026',
      'Uhrzeit: 10:00–10:30 Uhr (Zeitzone Europe/Berlin)',
      'Ort: Salon, 1. OG',
      'Bis Di., 13. Okt. 2026, 10:00 Uhr kannst du den Termin',
      `https://friseur.test/termin-verwalten#t=${TOKEN}`,
      'Friseur Muster',
      'Telefon: 030 123456',
      'E-Mail: info@friseur.test',
    ]) {
      expect(mail.text).toContain(part);
    }
    expect(mail.html).toContain(`href="https://friseur.test/termin-verwalten#t=${TOKEN}"`);
    expect(mail.html).toContain('Buchung verwalten');
  });

  it('weist nach Ablauf der Frist auf den direkten Kontakt hin', () => {
    const mail = confirmationMail({ ...data, now: new Date('2026-10-13T09:00:00Z') });
    expect(mail.text).toContain('nicht mehr möglich');
    expect(mail.text).not.toContain('stornieren oder einmal umbuchen');
    expect(mail.html).toContain('Buchung ansehen');
  });

  it('lässt fehlende optionale Angaben weg', () => {
    const mail = confirmationMail({ ...data, location: null, businessPhone: null, replyTo: null });
    expect(mail.text).not.toContain('Ort:');
    expect(mail.text).not.toContain('Telefon:');
    expect(mail.text).not.toContain('E-Mail:');
    expect(mail.ics).not.toContain('LOCATION');
  });

  it('maskiert Eingaben im HTML und verhindert Zeilenumbrüche im Betreff', () => {
    const mail = confirmationMail({
      ...data,
      participantName: '<script>alert(1)</script>',
      serviceTitle: 'Schnitt\r\nBcc: angriff@example.test',
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(escapeHtml(`"'&`)).toBe('&quot;&#39;&amp;');
  });

  it('legt eine Kalenderdatei ohne Verwaltungslink bei', () => {
    const { ics } = confirmationMail(data);
    expect(ics).toContain('UID:booking-65f1a2b3c4d5e6f7a8b9c0d1@friseur.test');
    expect(ics).toContain('DTSTART:20261014T080000Z');
    expect(ics).toContain('DTEND:20261014T083000Z');
    expect(ics).toContain('SUMMARY:Haarschnitt – Friseur Muster');
    expect(ics).toContain('LOCATION:Salon\\, 1. OG');
    expect(ics).not.toContain(TOKEN);
    expect(ics?.endsWith('\r\n')).toBe(true);
  });
});

describe('iCalendar', () => {
  it('maskiert Sonderzeichen', () => {
    expect(escapeText('a;b,c\\d\ne')).toBe('a\\;b\\,c\\\\d\\ne');
  });

  it('bricht lange Zeilen nach 75 Bytes um, auch mit Umlauten', () => {
    const folded = foldLine(`DESCRIPTION:${'ä'.repeat(100)}`);
    for (const line of folded.split('\r\n')) {
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    }
    expect(
      folded
        .split('\r\n')
        .slice(1)
        .every((l) => l.startsWith(' ')),
    ).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe(`DESCRIPTION:${'ä'.repeat(100)}`);
  });

  it('erzeugt einen vollständigen Kalender', () => {
    const ics = buildIcs({
      uid: 'x@y',
      start: new Date('2026-10-14T08:00:00Z'),
      end: new Date('2026-10-14T09:00:00Z'),
      summary: 'Yoga',
      location: null,
      description: 'Test',
      stamp: new Date('2026-10-08T12:00:00Z'),
    });
    expect(ics.split('\r\n').slice(0, 2)).toEqual(['BEGIN:VCALENDAR', 'VERSION:2.0']);
    expect(ics).toContain('METHOD:PUBLISH');
    expect(ics).toContain('DTSTAMP:20261008T120000Z');
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });
});

describe('classifySmtpError', () => {
  const classify = (error: object) => {
    const result = classifySmtpError(error);
    expect(result).toBeInstanceOf(JobError);
    return { category: result.category, retryable: result.retryable };
  };

  it.each([
    [{ code: 'ECONNECTION' }, 'smtp_unavailable', true],
    [{ code: 'ETIMEDOUT' }, 'smtp_unavailable', true],
    [{ code: 'EDNS' }, 'smtp_unavailable', true],
    [{ code: 'EAUTH', responseCode: 535 }, 'smtp_auth', true],
    [{ code: 'EENVELOPE', responseCode: 450, command: 'RCPT TO' }, 'smtp_deferred', true],
    [{ code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO' }, 'recipient_rejected', false],
    [{ code: 'EMESSAGE', responseCode: 554, command: 'DATA' }, 'message_rejected', false],
    [{ message: 'irgendwas' }, 'smtp_error', true],
  ])('%j → %s', (error, category, retryable) => {
    expect(classify(error)).toEqual({ category, retryable });
  });

  it('übernimmt keine Servermeldung', () => {
    const result = classifySmtpError({
      code: 'EAUTH',
      response: '535 Authentication failed for user geheim',
    });
    expect(result.message).not.toContain('geheim');
  });
});

describe('Storno-, Absage- und Umbuchungsmail', () => {
  const base = { ...data, bookingPageUrl: null, sequence: 0 };

  it('lässt den Link zum erneuten Buchen ohne BOOKING_PAGE_URL weg', () => {
    for (const mail of [cancellationMail(base), ownerCancellationMail({ ...base, reason: null })]) {
      expect(mail.text).not.toContain('neuen Termin buchen');
      expect(mail.text).not.toContain('#t=');
      expect(mail.html).not.toContain('<a ');
    }
  });

  it('übernimmt keine Zeilenumbrüche aus der Begründung', () => {
    const mail = ownerCancellationMail({ ...base, reason: 'Krank\r\n\r\nBitte überweisen Sie …' });
    expect(mail.text).toContain('Grund: Krank Bitte überweisen Sie …');
  });

  it('zählt die Kalenderversion bei Absagen hoch', () => {
    expect(cancellationMail(base).ics).toContain('SEQUENCE:1');
    expect(cancellationMail({ ...base, sequence: 1 }).ics).toContain('SEQUENCE:2');
  });

  it('kommt bei der Umbuchung ohne bisherigen Termin aus und erlaubt nur noch Storno', () => {
    const mail = rebookedMail({ ...data, previous: null });
    expect(mail.text).not.toContain('Bisheriger Termin');
    expect(mail.text).toContain('Neuer Termin:');
    expect(mail.text).toContain('über diesen Link stornieren:');
    expect(mail.text).not.toContain('umbuchen:');
    const late = rebookedMail({ ...data, previous: null, now: new Date('2026-10-13T09:00:00Z') });
    expect(late.text).toContain('nicht mehr möglich');
  });
});
