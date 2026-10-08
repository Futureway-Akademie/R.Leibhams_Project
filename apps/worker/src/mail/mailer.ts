// SMTP-Versand. Fehler werden in Kategorien übersetzt; die Meldungen des Mailservers können
// Adressen oder Zugangsdaten enthalten und werden weder gespeichert noch geloggt.
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { WorkerConfig } from '../config.js';
import { JobError, permanentFailure, temporaryFailure } from '../errors.js';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Stabil je Job, damit eine nach einem Absturz wiederholte Mail erkennbar dieselbe ist. */
  messageId: string;
  attachments?: { filename: string; content: string; contentType: string }[];
}

export interface Mailer {
  send(mail: OutgoingMail): Promise<void>;
}

/** Netzwerk- und Verbindungsfehler von nodemailer: später erneut versuchen. */
const CONNECTION_CODES = new Set([
  'ECONNECTION',
  'ETIMEDOUT',
  'ESOCKET',
  'EDNS',
  'ECONNREFUSED',
  'ECONNRESET',
  'EPROTOCOL',
  'ETLS',
]);

interface SmtpErrorLike {
  code?: unknown;
  responseCode?: unknown;
  command?: unknown;
}

/** Ordnet einen SMTP-Fehler einer Kategorie zu und entscheidet über Wiederholung. */
export function classifySmtpError(error: unknown): JobError {
  const { code, responseCode, command } = (error ?? {}) as SmtpErrorLike;
  if (code === 'EAUTH') {
    // Zugangsdaten falsch: Betreiber kann sie korrigieren, deshalb wiederholen.
    return temporaryFailure('smtp_auth');
  }
  if (typeof responseCode === 'number') {
    if (responseCode >= 500) {
      return typeof command === 'string' && command.toUpperCase().startsWith('RCPT')
        ? permanentFailure('recipient_rejected')
        : permanentFailure('message_rejected');
    }
    if (responseCode >= 400) return temporaryFailure('smtp_deferred');
  }
  if (typeof code === 'string' && CONNECTION_CODES.has(code)) {
    return temporaryFailure('smtp_unavailable');
  }
  return temporaryFailure('smtp_error');
}

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(
    private readonly config: Pick<WorkerConfig, 'smtp' | 'mail'>,
    transport?: Transporter,
  ) {
    this.transport =
      transport ??
      nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        requireTLS: config.smtp.requireTls,
        ...(config.smtp.auth ? { auth: config.smtp.auth } : {}),
        connectionTimeout: 30_000,
        greetingTimeout: 30_000,
        socketTimeout: 60_000,
      });
  }

  async send(mail: OutgoingMail): Promise<void> {
    try {
      await this.transport.sendMail({
        from: { name: this.config.mail.businessName, address: this.config.mail.fromAddress },
        ...(this.config.mail.replyTo ? { replyTo: this.config.mail.replyTo } : {}),
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        messageId: mail.messageId,
        ...(mail.attachments ? { attachments: mail.attachments } : {}),
      });
    } catch (error) {
      throw classifySmtpError(error);
    }
  }

  close(): void {
    this.transport.close();
  }
}
