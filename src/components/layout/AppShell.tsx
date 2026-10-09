import { useCallback, useRef, useEffect, useState } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useFileStore } from '../../stores/fileStore';
import { FilePreview } from '../files/FilePreview';

interface AppShellProps {
  sidebar: React.ReactNode;
  main: React.ReactNode;
  secondary?: React.ReactNode;
  bottomBar?: React.ReactNode;
  forceCollapseSidebar?: boolean;
}

const MIN_PANEL_WIDTH = 200;
const MAX_PANEL_WIDTH = 600;
const COLLAPSE_THRESHOLD = 120;

/* Sidebar width constants */
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 450;
const SIDEBAR_COLLAPSE_THRESHOLD = 100;

/* Preview panel width constants */
const MIN_PREVIEW_WIDTH = 300;
const MAX_PREVIEW_WIDTH = 1200;

export function AppShell({ sidebar, main, secondary, bottomBar, forceCollapseSidebar }: AppShellProps) {
  const sidebarOpenStore = useSettingsStore((s) => s.sidebarOpen);
  const sidebarOpen = forceCollapseSidebar ? false : sidebarOpenStore;
  const sidebarWidth = useSettingsStore((s) => s.sidebarWidth);
  const secondaryPanelOpen = useSettingsStore((s) => s.secondaryPanelOpen);
  const secondaryPanelWidth = useSettingsStore((s) => s.secondaryPanelWidth);

  /* File preview state — when a file is selected, we enter "preview mode" */
  const selectedFile = useFileStore((s) => s.selectedFile);
  const isFilePreviewMode = !!selectedFile;

  // --- Right-side panel dragging (secondary + preview) ---
  const isRightDragging = useRef(false);
  const rightStartX = useRef(0);
  const rightStartWidth = useRef(0);

  /* Preview panel resizable width — default to 50% of window */
  const [previewWidth, setPreviewWidth] = useState(() =>
    Math.round(window.innerWidth * 0.5)
  );

  /* Re-calculate default preview width when entering preview mode */
  const prevPreviewMode = useRef(false);
  useEffect(() => {
    if (isFilePreviewMode && !prevPreviewMode.current) {
      setPreviewWidth(Math.round(window.innerWidth * 0.5));
    }
    prevPreviewMode.current = isFilePreviewMode;
  }, [isFilePreviewMode]);

  // Refs to avoid re-registering global listeners when these values change
  const isFilePreviewModeRef = useRef(isFilePreviewMode);
  isFilePreviewModeRef.current = isFilePreviewMode;
  const secondaryPanelWidthRef = useRef(secondaryPanelWidth);
  secondaryPanelWidthRef.current = secondaryPanelWidth;
  const previewWidthRef = useRef(previewWidth);
  previewWidthRef.current = previewWidth;

  const handleRightMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isRightDragging.current = true;
    rightStartX.current = e.clientX;
    rightStartWidth.current = isFilePreviewModeRef.current
      ? previewWidthRef.current
      : secondaryPanelWidthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isRightDragging.current) return;
      const delta = rightStartX.current - e.clientX;
      const newWidth = rightStartWidth.current + delta;

      if (isFilePreviewModeRef.current) {
        if (newWidth < COLLAPSE_THRESHOLD) {
          isRightDragging.current = false;
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          useFileStore.getState().closePreview();
          return;
        }
        setPreviewWidth(
          Math.max(MIN_PREVIEW_WIDTH, Math.min(MAX_PREVIEW_WIDTH, newWidth))
        );
      } else {
        if (newWidth < COLLAPSE_THRESHOLD) {
          isRightDragging.current = false;
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          const settings = useSettingsStore.getState();
          if (settings.secondaryPanelOpen) settings.toggleSecondaryPanel();
          return;
        }
        useSettingsStore.getState().setSecondaryPanelWidth(
          Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, newWidth))
        );
      }
    };

    const handleMouseUp = () => {
      if (!isRightDragging.current) return;
      isRightDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      // Safety: reset body styles if component unmounts mid-drag
      if (isRightDragging.current) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
  }, []);

  // --- Sidebar dragging ---
  const isSidebarDragging = useRef(false);
  const sidebarStartX = useRef(0);
  const sidebarStartW = useRef(0);

  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;

  const handleSidebarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isSidebarDragging.current = true;
    sidebarStartX.current = e.clientX;
    sidebarStartW.current = sidebarWidthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isSidebarDragging.current) return;
      // Dragging right increases sidebar width
      const delta = e.clientX - sidebarStartX.current;
      const newW = sidebarStartW.current + delta;
      if (newW < SIDEBAR_COLLAPSE_THRESHOLD) {
        isSidebarDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        const settings = useSettingsStore.getState();
        if (settings.sidebarOpen) settings.toggleSidebar();
        return;
      }
      useSettingsStore.getState().setSidebarWidth(
        Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, newW))
      );
    };
    const handleUp = () => {
      if (!isSidebarDragging.current) return;
      isSidebarDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      if (isSidebarDragging.current) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
  }, []);

  const showSidebar = sidebarOpen;
  const showSecondary = secondaryPanelOpen && !isFilePreviewMode;

  return (
    <div className="flex flex-col h-full w-full overflow-hidden gradient-bg">
      {/* Drag region — data-tauri-drag-region handles both drag and double-click-to-maximize natively */}
      <div
        data-tauri-drag-region
        className="fixed top-0 left-0 right-0 h-[28px] z-50"
      />

      {/* Content row — sidebar + main + panels */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar — animates to w-0 when hidden or preview mode */}
        <div
          className="flex-shrink-0  overflow-hidden"
          style={{ width: showSidebar ? `${sidebarWidth}px` : '0px' }}
        >
          <div
            className="h-full overflow-hidden bg-bg-chat"
            style={{ width: `${sidebarWidth}px` }}
          >
            {sidebar}
          </div>
        </div>
        {/* Sidebar resize handle */}
        {showSidebar && (
          <div
            onMouseDown={handleSidebarMouseDown}
            className="w-px h-full flex-shrink-0 relative cursor-col-resize z-20
              bg-border-subtle hover:bg-accent/40 group"
          >
            <div className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize" />
          </div>
        )}

        {/* Main Panel */}
        <div className="flex-1 min-w-0 flex flex-col bg-bg-chat overflow-hidden">
          {main}
        </div>

        {/* File Preview resize handle */}
        {isFilePreviewMode && (
          <div
            onMouseDown={handleRightMouseDown}
            className="w-px h-full flex-shrink-0 relative cursor-col-resize z-10
              bg-border-subtle hover:bg-accent/40 group"
          >
            <div className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize" />
          </div>
        )}
        {/* File Preview Panel */}
        <div
          className="flex-shrink-0 overflow-hidden "
          style={{ width: isFilePreviewMode ? `${previewWidth}px` : '0px' }}
        >
          <div className="h-full overflow-hidden flex flex-col bg-bg-chat"
            style={{ width: `${previewWidth}px` }}>
            <FilePreview />
          </div>
        </div>

        {/* Secondary Panel resize handle */}
        {secondary && showSecondary && (
          <div
            onMouseDown={handleRightMouseDown}
            className="w-px h-full flex-shrink-0 relative cursor-col-resize z-10
              bg-border-subtle hover:bg-accent/40 group"
          >
            <div className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize" />
          </div>
        )}
        {/* Secondary Panel */}
        {secondary && (
          <div
            className="flex-shrink-0  overflow-hidden"
            style={{ width: showSecondary ? `${secondaryPanelWidth}px` : '0px' }}
          >
            <div
              className="h-full overflow-y-auto overflow-x-hidden bg-bg-chat"
              style={{ width: `${secondaryPanelWidth}px` }}
            >
              {secondary}
            </div>
          </div>
        )}
      </div>

      {/* Bottom bar — full width */}
      {bottomBar && (
        <div className="flex-shrink-0 bg-bg-chat">
          {bottomBar}
        </div>
      )}

    </div>
  );
}
