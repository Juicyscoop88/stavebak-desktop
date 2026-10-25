import { describe, it, expect, beforeEach } from 'vitest';
import { useGroupStore } from '../groupStore';

function reset() {
  useGroupStore.setState({ groups: [] });
}

describe('groupStore', () => {
  beforeEach(() => {
    reset();
  });

  describe('createGroup', () => {
    it('creates a group under the given workspace with the given label', () => {
      const id = useGroupStore.getState().createGroup('~/Projects/app', 'Reading pipeline');
      const groups = useGroupStore.getState().getGroupsForWorkspace('~/Projects/app');
      expect(groups).toHaveLength(1);
      expect(groups[0].id).toBe(id);
      expect(groups[0].label).toBe('Reading pipeline');
      expect(groups[0].workspace).toBe('~/Projects/app');
      expect(groups[0].sessionIds).toEqual([]);
      expect(groups[0].pinnedInGroup).toEqual([]);
    });

    it('puts a newly created group at the top of its workspace', () => {
      useGroupStore.getState().createGroup('~/ws', 'Old group');
      const newId = useGroupStore.getState().createGroup('~/ws', 'New group');
      const groups = useGroupStore.getState().getGroupsForWorkspace('~/ws');
      expect(groups[0].id).toBe(newId);
      expect(groups[0].label).toBe('New group');
    });

    it('isolates groups by workspace', () => {
      useGroupStore.getState().createGroup('~/ws-a', 'Group A');
      useGroupStore.getState().createGroup('~/ws-b', 'Group B');
      const a = useGroupStore.getState().getGroupsForWorkspace('~/ws-a');
      const b = useGroupStore.getState().getGroupsForWorkspace('~/ws-b');
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
      expect(a[0].label).toBe('Group A');
      expect(b[0].label).toBe('Group B');
    });
  });

  describe('addToGroup (single membership)', () => {
    it('adds a session to a group', () => {
      const g = useGroupStore.getState().createGroup('~/ws', 'Group 1');
      useGroupStore.getState().addToGroup('s1', g);
      const group = useGroupStore.getState().getGroupOfSession('s1');
      expect(group?.id).toBe(g);
      expect(group?.sessionIds).toContain('s1');
    });

    it('moving a session from A to B removes it from A (single membership)', () => {
      const a = useGroupStore.getState().createGroup('~/ws', 'A');
      const b = useGroupStore.getState().createGroup('~/ws', 'B');
      useGroupStore.getState().addToGroup('s1', a);
      useGroupStore.getState().addToGroup('s1', b);
      const groupA = useGroupStore.getState().groups.find((x) => x.id === a)!;
      const groupB = useGroupStore.getState().groups.find((x) => x.id === b)!;
      expect(groupA.sessionIds).not.toContain('s1');
      expect(groupB.sessionIds).toContain('s1');
      expect(useGroupStore.getState().getGroupOfSession('s1')?.id).toBe(b);
    });

    it('appends new members to the end of the group order', () => {
      const g = useGroupStore.getState().createGroup('~/ws', 'Group');
      useGroupStore.getState().addToGroup('s1', g);
      useGroupStore.getState().addToGroup('s2', g);
      const group = useGroupStore.getState().getGroupOfSession('s2')!;
      expect(group.sessionIds).toEqual(['s1', 's2']);
    });

    it('does not duplicate a session already in the group', () => {
      const g = useGroupStore.getState().createGroup('~/ws', 'Group');
      useGroupStore.getState().addToGroup('s1', g);
      useGroupStore.getState().addToGroup('s1', g);
      const group = useGroupStore.getState().getGroupOfSession('s1')!;
      expect(group.sessionIds).toEqual(['s1']);
    });

    it('is a no-op when the target group does not exist (session stays put)', () => {
      const g = useGroupStore.getState().createGroup('~/ws', 'Group');
      useGroupStore.getState().addToGroup('s1', g);
      useGroupStore.getState().addToGroup('s1', 'no-such-group');
      expect(useGroupStore.getState().getGroupOfSession('s1')?.id).toBe(g);
    });
  });

  describe('renameGroup', () => {
    it('renames a group', () => {
      const g = useGroupStore.getState().createGroup('~/ws', 'Old name');
      useGroupStore.getState().renameGroup(g, 'New name');
      expect(useGroupStore.getState().getGroupsForWorkspace('~/ws')[0].label).toBe('New name');
    });
  });

  describe('removeFromGroup', () => {
    it('removes a session back to ungrouped', () => {
      const g = useGroupStore.getState().createGroup('~/ws', 'Group');
      useGroupStore.getState().addToGroup('s1', g);
      useGroupStore.getState().removeFromGroup('s1');
      expect(useGroupStore.getState().getGroupOfSession('s1')).toBeUndefined();
      const group = useGroupStore.getState().groups.find((x) => x.id === g)!;
      expect(group.sessionIds).not.toContain('s1');
    });

    it('is a no-op for a session that is in no group', () => {
      const g = useGroupStore.getState().createGroup('~/ws', 'Group');
      useGroupStore.getState().addToGroup('s1', g);
      useGroupStore.getState().removeFromGroup('s2');
      expect(useGroupStore.getState().getGroupOfSession('s1')?.id).toBe(g);
    });
  });

  describe('deleteGroup', () => {
    it('deletes the group', () => {
      const g = useGroupStore.getState().createGroup('~/ws', 'Group');
      useGroupStore.getState().deleteGroup(g);
      expect(useGroupStore.getState().getGroupsForWorkspace('~/ws')).toHaveLength(0);
    });

    it('returns its members to ungrouped (sessions themselves survive)', () => {
      const g = useGroupStore.getState().createGroup('~/ws', 'Group');
      useGroupStore.getState().addToGroup('s1', g);
      useGroupStore.getState().addToGroup('s2', g);
      useGroupStore.getState().deleteGroup(g);
      expect(useGroupStore.getState().getGroupOfSession('s1')).toBeUndefined();
      expect(useGroupStore.getState().getGroupOfSession('s2')).toBeUndefined();
    });

    it('only deletes the target group, leaving siblings intact', () => {
      const a = useGroupStore.getState().createGroup('~/ws', 'A');
      const b = useGroupStore.getState().createGroup('~/ws', 'B');
      useGroupStore.getState().addToGroup('s1', b);
      useGroupStore.getState().deleteGroup(a);
      expect(useGroupStore.getState().getGroupsForWorkspace('~/ws')).toHaveLength(1);
      expect(useGroupStore.getState().getGroupOfSession('s1')?.id).toBe(b);
    });
  });

  describe('reorderInGroup', () => {
    it('fixes the manual order of sessions within a group', () => {
      const g = useGroupStore.getState().createGroup('~/ws', 'Group');
      useGroupStore.getState().addToGroup('s1', g);
      useGroupStore.getState().addToGroup('s2', g);
      useGroupStore.getState().addToGroup('s3', g);
      useGroupStore.getState().reorderInGroup(g, ['s3', 's1', 's2']);
      const group = useGroupStore.getState().groups.find((x) => x.id === g)!;
      expect(group.sessionIds).toEqual(['s3', 's1', 's2']);
    });
  });

  describe('reorderGroups', () => {
    it('fixes the order of groups within a workspace', () => {
      const a = useGroupStore.getState().createGroup('~/ws', 'A');
      const b = useGroupStore.getState().createGroup('~/ws', 'B');
      // After creation order is [b, a] (newest-first). Flip it.
      useGroupStore.getState().reorderGroups('~/ws', [a, b]);
      const list = useGroupStore.getState().getGroupsForWorkspace('~/ws');
      expect(list.map((x) => x.id)).toEqual([a, b]);
    });

    it('leaves groups in other workspaces untouched', () => {
      const a = useGroupStore.getState().createGroup('~/ws1', 'A');
      const b = useGroupStore.getState().createGroup('~/ws1', 'B');
      const c = useGroupStore.getState().createGroup('~/ws2', 'C');
      useGroupStore.getState().reorderGroups('~/ws1', [a, b]);
      expect(useGroupStore.getState().getGroupsForWorkspace('~/ws1').map((x) => x.id)).toEqual([a, b]);
      expect(useGroupStore.getState().getGroupsForWorkspace('~/ws2').map((x) => x.id)).toEqual([c]);
    });
  });

  describe('pinInGroup / unpinInGroup', () => {
    it('pins a session within its group', () => {
      const g = useGroupStore.getState().createGroup('~/ws', 'Group');
      useGroupStore.getState().addToGroup('s1', g);
      useGroupStore.getState().pinInGroup(g, 's1');
      const group = useGroupStore.getState().groups.find((x) => x.id === g)!;
      expect(group.pinnedInGroup).toContain('s1');
    });

    it('unpins a session within its group', () => {
      const g = useGroupStore.getState().createGroup('~/ws', 'Group');
      useGroupStore.getState().addToGroup('s1', g);
      useGroupStore.getState().pinInGroup(g, 's1');
      useGroupStore.getState().unpinInGroup(g, 's1');
      const group = useGroupStore.getState().groups.find((x) => x.id === g)!;
      expect(group.pinnedInGroup).not.toContain('s1');
    });

    it('does not duplicate a pin', () => {
      const g = useGroupStore.getState().createGroup('~/ws', 'Group');
      useGroupStore.getState().addToGroup('s1', g);
      useGroupStore.getState().pinInGroup(g, 's1');
      useGroupStore.getState().pinInGroup(g, 's1');
      const group = useGroupStore.getState().groups.find((x) => x.id === g)!;
      expect(group.pinnedInGroup).toEqual(['s1']);
    });

    it('clears the in-group pin when the session moves to another group', () => {
      const a = useGroupStore.getState().createGroup('~/ws', 'A');
      const b = useGroupStore.getState().createGroup('~/ws', 'B');
      useGroupStore.getState().addToGroup('s1', a);
      useGroupStore.getState().pinInGroup(a, 's1');
      useGroupStore.getState().addToGroup('s1', b);
      const groupA = useGroupStore.getState().groups.find((x) => x.id === a)!;
      expect(groupA.pinnedInGroup).not.toContain('s1');
    });

    it('clears the in-group pin when the session is removed from the group', () => {
      const g = useGroupStore.getState().createGroup('~/ws', 'Group');
      useGroupStore.getState().addToGroup('s1', g);
      useGroupStore.getState().pinInGroup(g, 's1');
      useGroupStore.getState().removeFromGroup('s1');
      const group = useGroupStore.getState().groups.find((x) => x.id === g)!;
      expect(group.pinnedInGroup).not.toContain('s1');
    });

    it('does not pin a session that is not a member of the group', () => {
      const g = useGroupStore.getState().createGroup('~/ws', 'Group');
      useGroupStore.getState().pinInGroup(g, 'not-a-member');
      const group = useGroupStore.getState().groups.find((x) => x.id === g)!;
      expect(group.pinnedInGroup).not.toContain('not-a-member');
    });
  });

  describe('replaceSessionId (draft -> real id sync)', () => {
    it('replaces old member id with new in the group (session stays in group after promote)', () => {
      const g = useGroupStore.getState().createGroup('~/ws', 'Group');
      useGroupStore.getState().addToGroup('draft_1', g);
      useGroupStore.getState().pinInGroup(g, 'draft_1');
      useGroupStore.getState().replaceSessionId('draft_1', 'real-uuid');
      const group = useGroupStore.getState().groups.find((x) => x.id === g)!;
      expect(group.sessionIds).toEqual(['real-uuid']);
      expect(group.pinnedInGroup).toEqual(['real-uuid']);
    });

    it('preserves order within group, only replaces the target id', () => {
      const g = useGroupStore.getState().createGroup('~/ws', 'Group');
      useGroupStore.getState().addToGroup('a', g);
      useGroupStore.getState().addToGroup('draft_1', g);
      useGroupStore.getState().addToGroup('b', g);
      useGroupStore.getState().replaceSessionId('draft_1', 'real-uuid');
      const group = useGroupStore.getState().groups.find((x) => x.id === g)!;
      expect(group.sessionIds).toEqual(['a', 'real-uuid', 'b']);
    });

    it('safe no-op when old id is not in any group', () => {
      const g = useGroupStore.getState().createGroup('~/ws', 'Group');
      useGroupStore.getState().addToGroup('s1', g);
      useGroupStore.getState().replaceSessionId('ghost', 'x');
      const group = useGroupStore.getState().groups.find((x) => x.id === g)!;
      expect(group.sessionIds).toEqual(['s1']);
    });
  });
});
