// Ratenbegrenzung öffentlicher Endpunkte je Client-IP (docs/architecture.md, Missbrauchsschutz).
// Zähler im Speicher: je Installation läuft genau eine API-Instanz; nach einem Neustart beginnen
// die Fenster neu.
import { Inject, Injectable, SetMetadata } from '@nestjs/common';
import type { CanActivate, ExecutionContext, OnModuleDestroy } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { IS_PUBLIC } from '../auth/decorators.js';
import { bookingLimit } from '../bookings/booking-errors.js';
import { APP_CONFIG } from '../config/config.js';
import type { AppConfig, RateLimitBucket, RateLimitRule } from '../config/config.js';

export const RATE_LIMIT_BUCKET = 'fw:rateLimitBucket';

/**
 * Ordnet eine öffentliche Route einer Grenze zu. Öffentliche Routen ohne Angabe fallen unter
 * `read`; `null` nimmt eine Route aus (nur für Betriebsendpunkte wie den Healthcheck).
 */
export const RateLimit = (bucket: RateLimitBucket | null) => SetMetadata(RATE_LIMIT_BUCKET, bucket);

export const SkipRateLimit = () => RateLimit(null);

/**
 * Schlüssel für die Zählung: IPv4 einzeln, IPv6 je /64-Netz, weil einem Anschluss üblicherweise
 * ein ganzes /64 zur Verfügung steht.
 */
export function clientKey(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped?.[1]) return mapped[1];
  if (!ip.includes(':')) return ip;
  const [head = '', tail = ''] = ip.toLowerCase().split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = ip.includes('::') ? 8 - headParts.length - tailParts.length : 0;
  const groups = [...headParts, ...Array<string>(Math.max(0, missing)).fill('0'), ...tailParts];
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

interface Window {
  count: number;
  resetAt: number;
}

/** Feste Zeitfenster je Schlüssel. Abgelaufene Einträge werden regelmäßig entfernt. */
@Injectable()
export class RateLimitStore implements OnModuleDestroy {
  private readonly windows = new Map<string, Window>();
  private readonly sweeper: NodeJS.Timeout;

  constructor() {
    this.sweeper = setInterval(() => {
      this.sweep(Date.now());
    }, 60_000);
    this.sweeper.unref();
  }

  /** Zählt eine Anfrage. Liefert die Wartezeit in Sekunden, wenn die Grenze überschritten ist. */
  hit(key: string, rule: RateLimitRule, now = Date.now()): { retryAfterSeconds: number } | null {
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + rule.windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    if (window.count > rule.limit) {
      return { retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1000)) };
    }
    return null;
  }

  sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }

  get size(): number {
    return this.windows.size;
  }

  reset(): void {
    this.windows.clear();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweeper);
  }
}

/** Begrenzt öffentliche Routen; Owner-Routen sind durch die Anmeldung geschützt. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly store: RateLimitStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, targets) !== true) {
      return true;
    }
    const configured = this.reflector.getAllAndOverride<RateLimitBucket | null | undefined>(
      RATE_LIMIT_BUCKET,
      targets,
    );
    if (configured === null) return true;
    const bucket = configured ?? 'read';
    const rule = this.config.rateLimits[bucket];
    if (rule.limit === 0) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const exceeded = this.store.hit(`${bucket}:${clientKey(request.ip)}`, rule);
    if (!exceeded) return true;

    http.getResponse<Response>().setHeader('Retry-After', String(exceeded.retryAfterSeconds));
    throw bookingLimit('rate_limited');
  }
}
