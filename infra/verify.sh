#!/usr/bin/env bash
# Prüft die laufende lokale Infrastruktur: Replica Set, Transaktion, SMTP-Empfang in Mailpit.
set -euo pipefail
cd "$(dirname "$0")"

echo '→ Replica Set'
docker compose exec -T mongo mongosh --quiet --eval 'const s = rs.status(); if (s.set !== "rs0" || s.myState !== 1) quit(1); print("rs0 PRIMARY")'

echo '→ Transaktion'
docker compose exec -T mongo mongosh --quiet --eval '
  const db0 = db.getSiblingDB("fw_infra_check");
  db0.tx.drop(); db0.createCollection("tx");
  const s = db.getMongo().startSession();
  s.startTransaction();
  s.getDatabase("fw_infra_check").tx.insertOne({ ok: true });
  s.abortTransaction();
  if (db0.tx.countDocuments() !== 0) quit(1);
  s.startTransaction();
  s.getDatabase("fw_infra_check").tx.insertOne({ ok: true });
  s.commitTransaction();
  if (db0.tx.countDocuments() !== 1) quit(1);
  db0.dropDatabase();
  print("abort und commit korrekt")'

echo '→ Mailpit'
subject="fw-infra-check-$(date +%s)"
printf 'Subject: %s\r\n\r\nTest\r\n' "$subject" |
  curl -sS --fail smtp://127.0.0.1:1025 --mail-from check@example.test --mail-rcpt owner@example.test -T -
curl -sS --fail "http://127.0.0.1:8025/api/v1/search?query=subject:$subject" | grep -q "\"$subject\"" && echo "Testmail empfangen"
curl -sS --fail -X DELETE "http://127.0.0.1:8025/api/v1/search?query=subject:$subject" >/dev/null

echo 'Infrastruktur OK'
