# Quality Gate

Vor Abschluss eines Tasks (ab Bestehen des Monorepos durch task-1-2):

1. `pnpm lint` ohne Fehler
2. `pnpm typecheck` ohne Fehler
3. `pnpm test` grün; Buchungs-, Storno- und Umbuchungslogik zusätzlich mit Integrationstests gegen ein Replica Set
4. `pnpm format:check` ohne Abweichungen
5. Keine Secrets oder personenbezogenen Daten in Code, Logs oder öffentlichen Antworten
6. Manuelle Prüfungen (Widget, Portal, PWA, WordPress) werden im `verification.summary` des Tasks sachlich beschrieben

Für reine Dokumentations-Tasks entfallen Punkt 1–4; stattdessen wird die Vollständigkeit gegen die Definition of Done geprüft.

Das Quality Gate ergänzt den zentralen Workshop-Workflow und darf ihn nicht überschreiben.
