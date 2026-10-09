export type MoveDirection = 'up' | 'down';

/**
 * Verschiebt ein Angebot um eine Position unter den sichtbaren Angeboten (z. B. bei aktivem Filter)
 * und liefert die neue Reihenfolge aller IDs. `null`, wenn sich nichts ändert.
 */
export function moveService(
  allIds: readonly string[],
  visibleIds: readonly string[],
  id: string,
  direction: MoveDirection,
): string[] | null {
  const visibleIndex = visibleIds.indexOf(id);
  const neighbor = visibleIds[direction === 'up' ? visibleIndex - 1 : visibleIndex + 1];
  if (visibleIndex === -1 || neighbor === undefined || !allIds.includes(id)) return null;

  const rest = allIds.filter((other) => other !== id);
  const neighborIndex = rest.indexOf(neighbor);
  if (neighborIndex === -1) return null;
  rest.splice(direction === 'up' ? neighborIndex : neighborIndex + 1, 0, id);
  return rest;
}
