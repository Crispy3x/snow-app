/**
 * Pure ordering helpers for modules, lessons and resources. Positions are
 * 1-based and contiguous after any change made through these functions.
 */

export type Positioned = { id: string; position: number };
export type PositionUpdate = { id: string; position: number };

/** Sort by position, then id for a stable order when positions collide. */
export function sortByPosition<T extends Positioned>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

/** Renumber 1..n in the given order and return only rows whose position changed. */
export function renumber(items: readonly Positioned[]): PositionUpdate[] {
  return items
    .map((item, i) => ({ id: item.id, position: i + 1, before: item.position }))
    .filter((u) => u.position !== u.before)
    .map(({ id, position }) => ({ id, position }));
}

/**
 * Move one item up or down by one place. Returns the position updates to save
 * (empty when the move is impossible, e.g. moving the first item up).
 */
export function moveItem(items: readonly Positioned[], id: string, direction: "up" | "down"): PositionUpdate[] {
  const ordered = sortByPosition(items);
  const index = ordered.findIndex((i) => i.id === id);
  if (index === -1) return [];
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= ordered.length) {
    // Nothing to swap, but still repair gaps or duplicates if there are any.
    return renumber(ordered);
  }
  const next = [...ordered];
  [next[index], next[target]] = [next[target], next[index]];
  return renumber(next);
}

/** Position for a new item appended to the end of a list. */
export function nextPosition(items: readonly Positioned[]): number {
  return items.reduce((max, i) => Math.max(max, i.position), 0) + 1;
}

/** Updates to close the gap after an item is removed from a list. */
export function removeAndRenumber(items: readonly Positioned[], id: string): PositionUpdate[] {
  return renumber(sortByPosition(items).filter((i) => i.id !== id));
}

/**
 * Moving an item to another list: it goes to the end of the target list and
 * the source list is renumbered.
 */
export function moveToList(
  source: readonly Positioned[],
  target: readonly Positioned[],
  id: string,
): { moved: PositionUpdate; source: PositionUpdate[] } {
  return {
    moved: { id, position: nextPosition(target.filter((t) => t.id !== id)) },
    source: removeAndRenumber(source, id),
  };
}
