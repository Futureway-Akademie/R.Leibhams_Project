// JSON-Parser mit kleinem Größenlimit. Parserfehler werden ohne interne Details beantwortet
// (sonst stünde z. B. die Meldung des JSON-Parsers in der Antwort).
import express from 'express';
import type { ErrorRequestHandler, RequestHandler } from 'express';

/** Größte erlaubte Anfrage; eine Buchung umfasst deutlich unter 1 KB. */
export const MAX_BODY_SIZE = '16kb';

export function jsonBodyParser(): RequestHandler {
  return express.json({ limit: MAX_BODY_SIZE });
}

interface ParserError {
  type?: unknown;
  status?: unknown;
}

export const bodyParserErrors: ErrorRequestHandler = (error: ParserError, _req, res, next) => {
  if (typeof error.type !== 'string' || typeof error.status !== 'number') {
    next(error);
    return;
  }
  if (error.type === 'entity.too.large') {
    res.status(413).json({ statusCode: 413, message: 'Die Anfrage ist zu groß' });
    return;
  }
  // entity.parse.failed, encoding.unsupported, charset.unsupported, request.aborted …
  res.status(400).json({ statusCode: 400, message: 'Ungültige Eingabe' });
};
