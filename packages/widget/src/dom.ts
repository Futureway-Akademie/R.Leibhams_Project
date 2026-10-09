// Sichere DOM-Erzeugung: Inhalte aus API-Daten werden ausschließlich als Text gesetzt, nie als HTML.
// Klassen erhalten automatisch das Präfix fw-booking-.

export const CLASS_PREFIX = 'fw-booking-';

export interface ElementOptions {
  /** Klassennamen ohne Präfix, z. B. `['session', 'session--full']`. */
  className?: string | readonly string[];
  text?: string;
  attrs?: Record<string, string>;
}

export type Child = Node | string | null | undefined | false;

export function cls(...names: string[]): string {
  return names.map((name) => `${CLASS_PREFIX}${name}`).join(' ');
}

export function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  options: ElementOptions = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (options.className !== undefined) {
    node.className = cls(
      ...(typeof options.className === 'string' ? [options.className] : options.className),
    );
  }
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) node.setAttribute(name, value);
  }
  if (options.text !== undefined) node.textContent = options.text;
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

/** Schaltfläche mit `type="button"`, damit sie in Formularen der Seite nichts absendet. */
export function button(
  doc: Document,
  options: ElementOptions,
  onClick: (event: MouseEvent) => void,
  children: readonly Child[] = [],
): HTMLButtonElement {
  const node = el(doc, 'button', options, children);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

/**
 * Fügt zwischen Teilen einen sichtbaren Trenner ein, damit sie auch ohne Styling lesbar bleiben
 * („18:00–19:00 · Studio 1 · 3 Plätze frei“). Screenreader überspringen den Trenner.
 */
export function withSeparators(doc: Document, parts: readonly Child[]): Node[] {
  const nodes: Node[] = [];
  for (const part of parts) {
    if (part === null || part === undefined || part === false) continue;
    if (nodes.length > 0) {
      nodes.push(
        el(doc, 'span', { className: 'separator', text: ' · ', attrs: { 'aria-hidden': 'true' } }),
      );
    }
    nodes.push(typeof part === 'string' ? doc.createTextNode(part) : part);
  }
  return nodes;
}
