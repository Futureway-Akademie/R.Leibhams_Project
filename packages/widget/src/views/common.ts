// Gemeinsame Bausteine der Ansichten: Lade-, Leer- und Fehlerzustand.
import { button, el } from '../dom.js';
import { messages } from '../messages.js';

/** Ladehinweis, den Screenreader als Statusmeldung vorlesen. */
export function statusMessage(doc: Document, text: string): HTMLElement {
  return el(doc, 'p', { className: 'status', text, attrs: { role: 'status' } });
}

/** Neutraler Hinweis, z. B. für leere Listen. */
export function infoMessage(doc: Document, text: string): HTMLElement {
  return el(doc, 'p', { className: ['message', 'message--info'], text });
}

/** Fehlermeldung mit optionaler Schaltfläche „Erneut versuchen“. */
export function errorMessage(doc: Document, text: string, retry?: () => void): HTMLElement {
  return el(doc, 'div', { className: ['message', 'message--error'], attrs: { role: 'alert' } }, [
    el(doc, 'p', { className: 'message-text', text }),
    retry && button(doc, { className: 'retry', text: messages.retry }, retry),
  ]);
}
