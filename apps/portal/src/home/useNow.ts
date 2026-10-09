import { useSyncExternalStore } from 'react';

const MINUTE_MS = 60_000;

function subscribe(onChange: () => void): () => void {
  const id = setInterval(onChange, 15_000);
  return () => {
    clearInterval(id);
  };
}

/** Auf die Minute gerundet, damit der Wert zwischen zwei Abfragen stabil bleibt. */
function currentMinute(): number {
  return Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
}

/** Aktuelle Zeit (ms, minutengenau); die Anzeige folgt ohne Neuladen („läuft gerade“, „vorbei“). */
export function useNow(): number {
  return useSyncExternalStore(subscribe, currentMinute);
}
