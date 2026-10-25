/**
 * Group drag-end handler: produces the complete ordered group-id list
 * (fed to groupStore.reorderGroups).
 *
 * Pure function: dnd-kit's onDragEnd gives active/over ids; this uses
 * arrayMove semantics to compute the new order. Extracted as a pure
 * function so it can be unit-tested in Node without simulating pointer
 * drag in jsdom (see ADR-0002). reorderGroups expects the full ordered
 * list (mp-review constraint).
 *
 * - active === over: no movement, return as-is.
 * - active/over not in list: invalid drop target, return as-is.
 * - Always returns a new array; never mutates the input.
 */
export function reorderByDragEnd(
  orderedIds: string[],
  activeId: string,
  overId: string,
): string[] {
  if (activeId === overId) return orderedIds.slice();
  const from = orderedIds.indexOf(activeId);
  const to = orderedIds.indexOf(overId);
  if (from === -1 || to === -1) return orderedIds.slice();
  const next = orderedIds.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
