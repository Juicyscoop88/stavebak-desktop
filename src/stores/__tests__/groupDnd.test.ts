import { describe, it, expect } from 'vitest';
import { reorderByDragEnd } from '../groupDnd';

// Inter-group drag: dnd-kit's onDragEnd gives active/over ids.
// reorderByDragEnd computes the full ordered group id list after the drag,
// then feeds it to groupStore.reorderGroups (constraint: pass the full ordered list).
describe('reorderByDragEnd (inter-group drag reorder)', () => {
  it('drags a group from the end to the beginning, producing the full new order', () => {
    expect(reorderByDragEnd(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
  });

  it('swaps two adjacent groups', () => {
    expect(reorderByDragEnd(['a', 'b', 'c'], 'a', 'b')).toEqual(['b', 'a', 'c']);
  });

  it('drags the first group to the end', () => {
    expect(reorderByDragEnd(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
  });

  it('dragging onto itself (active === over) keeps original order', () => {
    expect(reorderByDragEnd(['a', 'b', 'c'], 'b', 'b')).toEqual(['a', 'b', 'c']);
  });

  it('keeps original order when over does not exist', () => {
    expect(reorderByDragEnd(['a', 'b', 'c'], 'a', 'ghost')).toEqual(['a', 'b', 'c']);
  });

  it('keeps original order when active does not exist', () => {
    expect(reorderByDragEnd(['a', 'b', 'c'], 'ghost', 'a')).toEqual(['a', 'b', 'c']);
  });

  it('returns a new array without mutating the input (immutable)', () => {
    const input = ['a', 'b', 'c'];
    const out = reorderByDragEnd(input, 'c', 'a');
    expect(input).toEqual(['a', 'b', 'c']); // input unchanged
    expect(out).not.toBe(input); // returns a new reference
  });
});
