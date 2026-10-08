import { Catch, NotFoundException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Unbekannte Routen: einheitliche Antwort ohne Wiederholung von Methode und Pfad. Fachliche
 * 404-Antworten (z. B. „Angebot nicht gefunden“) bleiben unverändert.
 */
@Catch(NotFoundException)
export class RouteNotFoundFilter implements ExceptionFilter {
  catch(exception: NotFoundException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = exception.getResponse();
    const message = typeof body === 'object' && 'message' in body ? body.message : '';
    if (typeof message === 'string' && /^Cannot [A-Z]+ \//.test(message)) {
      response.status(404).json({ statusCode: 404, message: 'Nicht gefunden' });
      return;
    }
    response.status(404).json(body);
  }
}
