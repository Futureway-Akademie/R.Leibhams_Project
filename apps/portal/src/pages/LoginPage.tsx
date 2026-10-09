import { loginRequestSchema } from '@fw-booking/shared';
import { useId, useRef, useState } from 'react';
import type { ReactNode, SubmitEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { isApiError } from '../api/client.js';
import { useLogin, useSession } from '../auth/hooks.js';
import { redirectTarget } from '../auth/redirect.js';
import { StatusScreen } from '../layout/StatusScreen.js';
import { APP_NAME, usePageTitle } from '../layout/usePageTitle.js';

interface FieldErrors {
  email?: string;
  password?: string;
}

export function loginErrorMessage(error: unknown): string {
  if (isApiError(error, 401)) return 'E-Mail-Adresse oder Passwort ist falsch.';
  if (isApiError(error, 429)) {
    return 'Zu viele fehlgeschlagene Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.';
  }
  if (isApiError(error, 400)) return 'Bitte E-Mail-Adresse und Passwort prüfen.';
  if (isApiError(error) && (error.kind === 'network' || error.kind === 'timeout')) {
    return 'Der Server ist nicht erreichbar. Bitte die Verbindung prüfen und erneut versuchen.';
  }
  return 'Die Anmeldung ist fehlgeschlagen. Bitte später erneut versuchen.';
}

export function LoginPage(): ReactNode {
  usePageTitle('Anmelden');
  const session = useSession();
  const login = useLogin();
  const location = useLocation();
  const ids = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const target = redirectTarget(location.state);
  if (session.isPending) return <StatusScreen>Sitzung wird geprüft …</StatusScreen>;
  // Angemeldet (nach erfolgreichem Login oder Login-Seite als Lesezeichen): weiter zum Ziel.
  if (session.data) return <Navigate to={target} replace />;

  function onSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (login.isPending) return;
    const parsed = loginRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'email') errors.email = 'Bitte eine gültige E-Mail-Adresse eingeben.';
        if (issue.path[0] === 'password') errors.password = 'Bitte das Passwort eingeben.';
      }
      setFieldErrors(errors);
      (errors.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    setFieldErrors({});
    login.mutate(parsed.data, {
      onError: (error) => {
        if (isApiError(error, 401)) {
          setPassword('');
          passwordRef.current?.focus();
        }
      },
    });
  }

  const emailErrorId = `${ids}-email-error`;
  const passwordErrorId = `${ids}-password-error`;

  return (
    <main className="login">
      <form className="login-card" noValidate onSubmit={onSubmit} aria-labelledby={`${ids}-title`}>
        <p className="login-app">{APP_NAME}</p>
        <h1 id={`${ids}-title`}>Anmelden</h1>
        {login.isError && (
          <p className="alert alert-error" role="alert">
            {loginErrorMessage(login.error)}
          </p>
        )}
        <div className="field">
          <label htmlFor={`${ids}-email`}>E-Mail-Adresse</label>
          <input
            ref={emailRef}
            id={`${ids}-email`}
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? emailErrorId : undefined}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
          {fieldErrors.email && (
            <p id={emailErrorId} className="field-error">
              {fieldErrors.email}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor={`${ids}-password`}>Passwort</label>
          <input
            ref={passwordRef}
            id={`${ids}-password`}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={200}
            value={password}
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={fieldErrors.password ? passwordErrorId : undefined}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
          {fieldErrors.password && (
            <p id={passwordErrorId} className="field-error">
              {fieldErrors.password}
            </p>
          )}
        </div>
        <button type="submit" className="button button-primary" disabled={login.isPending}>
          {login.isPending ? 'Anmelden …' : 'Anmelden'}
        </button>
      </form>
    </main>
  );
}
