import { useSettingsStore } from '../../stores/settingsStore';
import { useFileStore } from '../../stores/fileStore';
import { GearSix } from '@phosphor-icons/react';
import { InputBar } from '../chat/InputBar';
import { useUiStore } from '../../stores/uiStore';
import { useMcpStore } from '../../stores/mcpStore';

// Not shown for production: users of the release build never see it
const TARGET_LABEL = { local: 'lokální server', custom: 'vlastní server' } as const;

export function BottomBar() {
  const toggleSettings = useSettingsStore((s) => s.toggleSettings);
  const updateAvailable = useSettingsStore((s) => s.updateAvailable);
  const sidebarOpen = useSettingsStore((s) => s.sidebarOpen);
  const sidebarWidth = useSettingsStore((s) => s.sidebarWidth);
  const workingDirectory = useSettingsStore((s) => s.workingDirectory);
  const directoryMissing = useFileStore((s) => s.directoryMissing);
  const mcpTarget = useMcpStore((s) => s.target);
  const secondaryPanelOpen = useSettingsStore((s) => s.secondaryPanelOpen);
  const secondaryPanelWidth = useSettingsStore((s) => s.secondaryPanelWidth);
  const filePreviewOpen = useFileStore((s) => !!s.selectedFile);
  // The right panel is not under the bar's chat column: reserve its width (plus the 1px resize handle)
  // so the input stays centered on the chat column, like AppShell does for the messages
  const rightInset = secondaryPanelOpen && !filePreviewOpen ? secondaryPanelWidth + 1 : 0;

  const showInput = workingDirectory && !directoryMissing;
  // Hidden, not unmounted: InputBar owns the stream handler and action listeners
  const composerHidden = useUiStore((s) => s.composerHidden);

  return (
    <div className="flex items-end">
      {/* Settings area — matches sidebar width, own border-t */}
      <div
        className="flex-shrink-0 transition-all duration-300 ease-out overflow-hidden"
        style={{ width: sidebarOpen ? `${sidebarWidth}px` : '0px' }}
      >
        <div
          className="px-3 py-2.5 flex items-center"
          style={{ width: `${sidebarWidth}px` }}
        >
          <button onClick={toggleSettings}
            {...(import.meta.env.DEV && { 'data-testid': 'settings-button' })}
            className="relative w-8 h-8 flex items-center justify-center
              text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary
              rounded-full transition-smooth">
            <GearSix size={16} weight="light" />
            {updateAvailable && (
              <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full
                border-[1.5px] border-bg-chat bg-green-500" />
            )}
          </button>
          {mcpTarget && mcpTarget.env !== 'prod' && (
            <span title={mcpTarget.url}
              className="ml-2 px-2 py-0.5 rounded-full text-xs text-text-tertiary bg-bg-tertiary truncate">
              {TARGET_LABEL[mcpTarget.env]}
            </span>
          )}
        </div>
      </div>

      {/* Divider matching sidebar resize handle */}
      {sidebarOpen && (
        <div className="w-px self-stretch bg-border-subtle flex-shrink-0" />
      )}

      {/* Chat input area */}
      <div className={`flex-1 min-w-0 ${composerHidden ? 'invisible' : ''}`}>
        {showInput && <InputBar />}
      </div>
      <div className="flex-shrink-0" style={{ width: `${rightInset}px` }} />
    </div>
  );
}
