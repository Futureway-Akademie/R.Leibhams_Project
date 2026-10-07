import type { CookieOptions, Response } from 'express';
import type { AppConfig } from '../config/config.js';

/** `__Host-` erzwingt im Browser Secure, Path=/ und keine Domain; nur mit HTTPS möglich. */
export function sessionCookieName(config: AppConfig): string {
  return config.session.cookieSecure ? '__Host-fw_session' : 'fw_session';
}

function baseOptions(config: AppConfig): CookieOptions {
  return { httpOnly: true, secure: config.session.cookieSecure, sameSite: 'lax', path: '/' };
}

export function setSessionCookie(
  res: Response,
  config: AppConfig,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(sessionCookieName(config), token, { ...baseOptions(config), expires: expiresAt });
}

export function clearSessionCookie(res: Response, config: AppConfig): void {
  res.clearCookie(sessionCookieName(config), baseOptions(config));
}
