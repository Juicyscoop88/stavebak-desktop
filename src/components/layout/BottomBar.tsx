import { useSettingsStore } from '../../stores/settingsStore';
import { useFileStore } from '../../stores/fileStore';
import { GearSix } from '@phosphor-icons/react';
import { InputBar } from '../chat/InputBar';

export function BottomBar() {
  const toggleSettings = useSettingsStore((s) => s.toggleSettings);
  const updateAvailable = useSettingsStore((s) => s.updateAvailable);
  const sidebarOpen = useSettingsStore((s) => s.sidebarOpen);
  const sidebarWidth = useSettingsStore((s) => s.sidebarWidth);
  const workingDirectory = useSettingsStore((s) => s.workingDirectory);
  const directoryMissing = useFileStore((s) => s.directoryMissing);

  const showInput = workingDirectory && !directoryMissing;

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
        </div>
      </div>

      {/* Divider matching sidebar resize handle */}
      {sidebarOpen && (
        <div className="w-px self-stretch bg-border-subtle flex-shrink-0" />
      )}

      {/* Chat input area */}
      <div className="flex-1 min-w-0">
        {showInput && <InputBar />}
      </div>
    </div>
  );
}
