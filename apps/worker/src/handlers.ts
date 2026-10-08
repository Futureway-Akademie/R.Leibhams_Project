// Registrierte Job-Handler. Die Mail-Handler folgen in task-3-2 (Bestätigung) und task-3-3
// (Storno, Umbuchung, Absage). Bis dahin bleiben diese Aufträge unbearbeitet in der Outbox.
import type { JobHandlers } from './worker.js';

export const handlers: JobHandlers = {};
