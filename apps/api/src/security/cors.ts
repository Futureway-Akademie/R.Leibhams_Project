// Domainfreigabe für die öffentliche API. Nur freigegebene Origins (die WordPress-Seiten des
// Kunden) erhalten CORS-Header; Anfragen mit fremdem Origin werden auch serverseitig abgewiesen,
// damit sie keine Buchungen auslösen können, selbst wenn der Browser die Antwort verwerfen würde.
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export const PUBLIC_API_PREFIX = '/api/public/';

const ALLOWED_METHODS = 'GET, POST';
const ALLOWED_HEADERS = 'Content-Type, X-Booking-Token';
const PREFLIGHT_MAX_AGE_SECONDS = '600';

export function publicCors(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith(PUBLIC_API_PREFIX)) {
      next();
      return;
    }
    // Antworten unterscheiden sich je Origin; Caches müssen das berücksichtigen.
    res.vary('Origin');
    const origin = req.headers.origin;
    // Ohne Origin-Header: kein Browser-Aufruf von fremder Seite (z. B. Server, curl, gleiche
    // Herkunft bei GET). CORS betrifft nur Browser.
    if (origin === undefined) {
      next();
      return;
    }
    if (!allowed.has(origin)) {
      res.status(403).json({
        statusCode: 403,
        message: 'Diese Website ist für die Buchung nicht freigegeben',
        code: 'origin_not_allowed',
      });
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
      res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      res.setHeader('Access-Control-Max-Age', PREFLIGHT_MAX_AGE_SECONDS);
      res.status(204).end();
      return;
    }
    next();
  };
}
