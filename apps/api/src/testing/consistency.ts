// Prüft die Invarianten des Buchungskerns direkt in der Datenbank. Liefert eine Liste von
// Verstößen (leer = konsistent); wird von den Nebenläufigkeitstests nach jedem Szenario genutzt.
import { OCCUPANCY_UNIT_MINUTES } from '@fw-booking/shared';
import type { Db } from 'mongodb';
import { collections } from '../database/documents.js';

const UNIT_MS = OCCUPANCY_UNIT_MINUTES * 60_000;

export async function checkConsistency(db: Db): Promise<string[]> {
  const c = collections(db);
  const issues: string[] = [];

  const sessions = await c.sessions.find().toArray();
  const bookings = await c.bookings.find().toArray();
  const units = await c.resourceOccupancy.find().toArray();
  const jobs = await c.outboxJobs.find({ type: 'booking_confirmation' }).toArray();

  // 1. Kursbelegung: bookedCount = bestätigte Buchungen, nie über der Kapazität.
  for (const session of sessions) {
    const confirmed = bookings.filter(
      (b) => b.status === 'confirmed' && b.sessionId?.equals(session._id),
    ).length;
    if (session.bookedCount !== confirmed) {
      issues.push(
        `Kurstermin ${session._id.toHexString()}: bookedCount ${String(session.bookedCount)} ≠ ${String(confirmed)} bestätigte Buchungen`,
      );
    }
    if (session.bookedCount > session.capacity) {
      issues.push(`Kurstermin ${session._id.toHexString()}: überbucht`);
    }
  }

  // 2. Einzeltermine belegen genau die Einheiten ihrer Dauer.
  const unitsByRef = new Map<string, number[]>();
  for (const unit of units) {
    const key = `${unit.refType}:${unit.refId.toHexString()}`;
    unitsByRef.set(key, [...(unitsByRef.get(key) ?? []), unit.unitStart.getTime()]);
  }
  for (const booking of bookings.filter((b) => b.type === 'single' && b.status === 'confirmed')) {
    const expected: number[] = [];
    for (let t = booking.startsAt.getTime(); t < booking.endsAt.getTime(); t += UNIT_MS) {
      expected.push(t);
    }
    const actual = (unitsByRef.get(`booking:${booking._id.toHexString()}`) ?? []).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      issues.push(`Einzelbuchung ${booking._id.toHexString()}: Belegung passt nicht zur Dauer`);
    }
  }

  // 3. Keine verwaisten Belegungen; Kurstermine belegen genau ihre Dauer.
  for (const [key, starts] of unitsByRef) {
    const [refType, refId] = key.split(':');
    if (refType === 'booking') {
      const booking = bookings.find((b) => b._id.toHexString() === refId);
      if (booking?.status !== 'confirmed' || booking.type !== 'single') {
        issues.push(`Belegung ohne bestätigte Einzelbuchung: ${key}`);
      }
    } else {
      const session = sessions.find((s) => s._id.toHexString() === refId);
      if (!session || session.status === 'cancelled') {
        issues.push(`Belegung ohne aktiven Kurstermin: ${key}`);
      } else if (
        starts.length * UNIT_MS !==
        session.endsAt.getTime() - session.startsAt.getTime()
      ) {
        issues.push(`Kurstermin ${String(refId)}: Belegung passt nicht zur Dauer`);
      }
    }
  }

  // 4. Jede Buchung hat genau einen Bestätigungsauftrag.
  for (const booking of bookings) {
    const count = jobs.filter((j) => j.bookingId?.equals(booking._id)).length;
    if (count !== 1) {
      issues.push(`Buchung ${booking._id.toHexString()}: ${String(count)} Bestätigungsaufträge`);
    }
  }
  if (jobs.length !== bookings.length) {
    issues.push(
      `${String(jobs.length)} Bestätigungsaufträge für ${String(bookings.length)} Buchungen`,
    );
  }

  // 5. Bestätigte Einzeltermine überschneiden sich nicht mit anderen Belegungen (doppelte Prüfung
  //    zusätzlich zum eindeutigen Index).
  const seen = new Map<number, string>();
  for (const unit of units) {
    const time = unit.unitStart.getTime();
    const owner = `${unit.refType}:${unit.refId.toHexString()}`;
    const other = seen.get(time);
    if (other && other !== owner)
      issues.push(`Einheit ${new Date(time).toISOString()} doppelt belegt`);
    seen.set(time, owner);
  }

  return issues;
}
