import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { collections } from '../database/documents.js';
import { createTestApp } from '../testing/app.js';
import type { TestApp } from '../testing/app.js';
import { startReplSet } from '../testing/mongo.js';
import { sha256Hex } from './crypto.js';
import { MAX_FAILED_LOGINS } from './login-throttle.service.js';
import { createOwner } from './owners.js';

const EMAIL = 'owner@example.test';
const PASSWORD = 'richtig-langes-passwort';
const COOKIE = 'fw_session';

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await startReplSet();
});

afterAll(async () => {
  await replSet.stop();
});

function sessionCookie(setCookie: string[] | string | undefined): string {
  const header = ([] as string[]).concat(setCookie ?? []).find((c) => c.startsWith(`${COOKIE}=`));
  if (!header) throw new Error('Kein Sitzungs-Cookie gesetzt');
  return header.split(';')[0] ?? '';
}

describe('Owner-Login', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());

  const login = (email = EMAIL, password = PASSWORD) =>
    http().post('/api/auth/login').send({ email, password });

  beforeAll(async () => {
    t = await createTestApp(replSet.getUri());
    await createOwner(t.db, EMAIL, PASSWORD);
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    const c = collections(t.db);
    await Promise.all([c.authSessions.deleteMany({}), c.loginAttempts.deleteMany({})]);
    await c.owners.updateMany({}, { $set: { status: 'active' } });
  });

  describe('Anmelden', () => {
    it('setzt ein HttpOnly-Sitzungs-Cookie und liefert CSRF-Token', async () => {
      const response = await login().expect(200);
      expect(response.body).toEqual({
        owner: { id: expect.any(String) as string, email: EMAIL },
        csrfToken: expect.any(String) as string,
      });
      const header = String(response.headers['set-cookie']);
      expect(header).toMatch(/fw_session=/);
      expect(header).toMatch(/HttpOnly/i);
      expect(header).toMatch(/SameSite=Lax/i);
      expect(header).toMatch(/Path=\//);
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('akzeptiert E-Mail in anderer Schreibweise', async () => {
      await login('  Owner@Example.TEST ').expect(200);
    });

    it('speichert nur den Hash des Sitzungstokens', async () => {
      const response = await login().expect(200);
      const token = sessionCookie(response.headers['set-cookie']).split('=')[1] ?? '';
      const sessions = await collections(t.db).authSessions.find().toArray();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?._id).toBe(sha256Hex(token));
      expect(JSON.stringify(sessions)).not.toContain(token);
    });

    it('antwortet bei falschem Passwort und unbekannter E-Mail gleich', async () => {
      const wrongPassword = await login(EMAIL, 'falsches-passwort-123').expect(401);
      const unknownEmail = await login('niemand@example.test', PASSWORD).expect(401);
      expect(wrongPassword.body).toEqual(unknownEmail.body);
      expect(wrongPassword.headers['set-cookie']).toBeUndefined();
    });

    it('lehnt deaktivierte Owner ab', async () => {
      await collections(t.db).owners.updateOne({ email: EMAIL }, { $set: { status: 'disabled' } });
      await login().expect(401);
    });

    it('validiert die Eingabe ohne Werte zurückzugeben', async () => {
      const response = await http()
        .post('/api/auth/login')
        .send({ email: 'kein-email', password: 'geheimes-passwort' })
        .expect(400);
      expect(JSON.stringify(response.body)).not.toContain('geheimes-passwort');
    });

    it('verlangt JSON', async () => {
      await http()
        .post('/api/auth/login')
        .type('form')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(415);
    });

    it('ersetzt eine bestehende Sitzung beim erneuten Login', async () => {
      const first = sessionCookie((await login().expect(200)).headers['set-cookie']);
      await http()
        .post('/api/auth/login')
        .set('Cookie', first)
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200);
      expect(await collections(t.db).authSessions.countDocuments()).toBe(1);
      await http().get('/api/auth/session').set('Cookie', first).expect(401);
    });

    it('protokolliert den Login ohne Geheimnisse', async () => {
      await login().expect(200);
      const event = await collections(t.db).auditEvents.findOne(
        { action: 'owner.login' },
        { sort: { at: -1 } },
      );
      expect(event).not.toBeNull();
      expect(JSON.stringify(event)).not.toContain(PASSWORD);
    });
  });

  describe('Sitzung und geschützte Routen', () => {
    it('liefert die Sitzung mit gültigem Cookie', async () => {
      const loggedIn = await login().expect(200);
      const cookie = sessionCookie(loggedIn.headers['set-cookie']);
      const response = await http().get('/api/auth/session').set('Cookie', cookie).expect(200);
      expect(response.body).toEqual(loggedIn.body);
    });

    it('verweigert Zugriff ohne oder mit ungültigem Cookie', async () => {
      await http().get('/api/auth/session').expect(401);
      await http().get('/api/auth/session').set('Cookie', `${COOKIE}=erfunden`).expect(401);
    });

    it('lässt öffentliche Routen ohne Sitzung zu', async () => {
      await http().get('/health').expect(200);
    });

    it('beendet Sitzungen nach 12 Stunden Inaktivität', async () => {
      const cookie = sessionCookie((await login().expect(200)).headers['set-cookie']);
      await collections(t.db).authSessions.updateMany(
        {},
        { $set: { idleExpiresAt: new Date(Date.now() - 1000) } },
      );
      await http().get('/api/auth/session').set('Cookie', cookie).expect(401);
      expect(await collections(t.db).authSessions.countDocuments()).toBe(0);
    });

    it('beendet Sitzungen nach spätestens 7 Tagen', async () => {
      const cookie = sessionCookie((await login().expect(200)).headers['set-cookie']);
      await collections(t.db).authSessions.updateMany(
        {},
        { $set: { absoluteExpiresAt: new Date(Date.now() - 1000) } },
      );
      await http().get('/api/auth/session').set('Cookie', cookie).expect(401);
    });

    it('legt Sitzungsablauf auf 12 h bzw. 7 Tage fest', async () => {
      const before = Date.now();
      await login().expect(200);
      const session = await collections(t.db).authSessions.findOne();
      expect(session).not.toBeNull();
      const idle = (session?.idleExpiresAt.getTime() ?? 0) - before;
      const absolute = (session?.absoluteExpiresAt.getTime() ?? 0) - before;
      expect(idle).toBeGreaterThanOrEqual(12 * 3600_000 - 5_000);
      expect(idle).toBeLessThanOrEqual(12 * 3600_000 + 5_000);
      expect(absolute).toBeGreaterThanOrEqual(7 * 86_400_000 - 5_000);
      expect(absolute).toBeLessThanOrEqual(7 * 86_400_000 + 5_000);
    });

    it('meldet deaktivierte Owner sofort ab', async () => {
      const cookie = sessionCookie((await login().expect(200)).headers['set-cookie']);
      await collections(t.db).owners.updateOne({ email: EMAIL }, { $set: { status: 'disabled' } });
      await http().get('/api/auth/session').set('Cookie', cookie).expect(401);
      expect(await collections(t.db).authSessions.countDocuments()).toBe(0);
    });
  });

  describe('Abmelden und CSRF', () => {
    it('verlangt das CSRF-Token für ändernde Anfragen', async () => {
      const cookie = sessionCookie((await login().expect(200)).headers['set-cookie']);
      await http().post('/api/auth/logout').set('Cookie', cookie).send({}).expect(403);
      await http()
        .post('/api/auth/logout')
        .set('Cookie', cookie)
        .set('X-CSRF-Token', 'falsch')
        .send({})
        .expect(403);
      await http().get('/api/auth/session').set('Cookie', cookie).expect(200);
    });

    it('akzeptiert kein CSRF-Token einer anderen Sitzung', async () => {
      const first = await login().expect(200);
      const second = await login().expect(200);
      await http()
        .post('/api/auth/logout')
        .set('Cookie', sessionCookie(second.headers['set-cookie']))
        .set('X-CSRF-Token', (first.body as { csrfToken: string }).csrfToken)
        .send({})
        .expect(403);
    });

    it('meldet mit gültigem Token ab und löscht Cookie und Sitzung', async () => {
      const loggedIn = await login().expect(200);
      const cookie = sessionCookie(loggedIn.headers['set-cookie']);
      const response = await http()
        .post('/api/auth/logout')
        .set('Cookie', cookie)
        .set('X-CSRF-Token', (loggedIn.body as { csrfToken: string }).csrfToken)
        .send({})
        .expect(204);
      expect(String(response.headers['set-cookie'])).toMatch(/fw_session=;/);
      await http().get('/api/auth/session').set('Cookie', cookie).expect(401);
      expect(await collections(t.db).authSessions.countDocuments()).toBe(0);
      expect(await collections(t.db).auditEvents.countDocuments({ action: 'owner.logout' })).toBe(
        1,
      );
    });
  });

  describe('Schutz gegen Passwort-Raten', () => {
    it(`sperrt nach ${String(MAX_FAILED_LOGINS)} Fehlversuchen, auch mit richtigem Passwort`, async () => {
      for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
        await login(EMAIL, 'falsches-passwort-123').expect(401);
      }
      await login().expect(429);
    });

    it('setzt den E-Mail-Zähler nach erfolgreichem Login zurück', async () => {
      for (let i = 0; i < MAX_FAILED_LOGINS - 1; i++) {
        await login(EMAIL, 'falsches-passwort-123').expect(401);
      }
      await login().expect(200);
      expect(
        await collections(t.db).loginAttempts.findOne({ _id: `email:${sha256Hex(EMAIL)}` }),
      ).toBeNull();
    });

    it('sperrt auch je IP über verschiedene E-Mail-Adressen', async () => {
      for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
        await login(`unbekannt${String(i)}@example.test`, 'falsches-passwort-123').expect(401);
      }
      await login().expect(429);
    });

    it('gibt nach Ablauf des Fensters wieder frei', async () => {
      for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
        await login(EMAIL, 'falsches-passwort-123').expect(401);
      }
      await collections(t.db).loginAttempts.updateMany(
        {},
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );
      await login().expect(200);
    });

    it('speichert keine E-Mail-Adressen im Klartext', async () => {
      await login(EMAIL, 'falsches-passwort-123').expect(401);
      const attempts = await collections(t.db).loginAttempts.find().toArray();
      expect(JSON.stringify(attempts)).not.toContain(EMAIL);
    });
  });
});

describe('Secure-Cookies', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp(replSet.getUri(), { session: { cookieSecure: true } });
    await createOwner(t.db, EMAIL, PASSWORD);
  });

  afterAll(async () => {
    await t.close();
  });

  it('verwendet __Host-Präfix und Secure-Flag', async () => {
    const response = await request(t.app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
    const header = String(response.headers['set-cookie']);
    expect(header).toMatch(/^__Host-fw_session=/);
    expect(header).toMatch(/Secure/);
  });
});
