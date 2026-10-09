import { useCallback } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { PanelSlot } from './PanelSlot';

export function SecondaryPanel() {
  const rightPanelId = useSettingsStore((s) => s.rightPanelId);
  const setRightPanel = useSettingsStore((s) => s.setRightPanel);
  const togglePanel = useSettingsStore((s) => s.toggleSecondaryPanel);

  const onPanelChange = useCallback((id: string | null) => setRightPanel(id), [setRightPanel]);

  return (
    <PanelSlot
      slot="right"
      activePanelId={rightPanelId}
      onPanelChange={onPanelChange}
      onClose={togglePanel}
    />
  );
}
