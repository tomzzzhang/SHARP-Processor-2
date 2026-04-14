import { useCallback, useEffect, useRef, useState } from 'react';
// Dynamic imports to allow running in plain browser (preview)
const isTauri = !!(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__;
const tauriWebviewWindow = isTauri ? import('@tauri-apps/api/webviewWindow') : null;
const tauriFs = isTauri ? import('@tauri-apps/plugin-fs') : null;
import { MenuBar } from './components/MenuBar';
import { Sidebar } from './components/Sidebar';
import { PlotArea } from './components/PlotArea';
import { QuickStylePanel } from './components/QuickStylePanel';
import { ResultsTable } from './components/ResultsTable';
import { DilutionWizard } from './components/DilutionWizard';
import { ExportWizard } from './components/ExportWizard';
import { UserManual } from './components/UserManual';
import { PlotTabs } from './components/PlotTabs';
import { useAppState } from './hooks/useAppState';
import { loadSharpFile } from './lib/sharp-loader';
import { isInstrumentFile, isSupportedFile, loadInstrumentFile } from './lib/instrument-loader';
import { addRecentFile } from './lib/recent-files';
import { checkForUpdates } from './lib/update-checker';

function App() {
  const loadExperiment = useAppState((s) => s.loadExperiment);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showWizard = useAppState((s) => s.showDilutionWizard);
  const setShowWizard = useAppState((s) => s.setShowDilutionWizard);
  const showExportWizard = useAppState((s) => s.showExportWizard);
  const setShowExportWizard = useAppState((s) => s.setShowExportWizard);
  const [showManual, setShowManual] = useState(false);
  const [updateBanner, setUpdateBanner] = useState<{ version: string; url: string } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [tableHeight, setTableHeight] = useState(160);
  const sidebarDragging = useRef(false);
  const sidebarDragStartX = useRef(0);
  const sidebarDragStartW = useRef(0);
  const tableDragging = useRef(false);
  const tableDragStartY = useRef(0);
  const tableDragStartH = useRef(0);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (sidebarDragging.current) {
        e.preventDefault();
        const delta = e.clientX - sidebarDragStartX.current;
        setSidebarWidth(Math.max(300, Math.min(450, sidebarDragStartW.current + delta)));
      }
      if (tableDragging.current) {
        e.preventDefault();
        const delta = tableDragStartY.current - e.clientY; // dragging up = bigger
        setTableHeight(Math.max(60, Math.min(500, tableDragStartH.current + delta)));
      }
    };
    const onUp = () => {
      if (sidebarDragging.current || tableDragging.current) {
        sidebarDragging.current = false;
        tableDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, []);

  const handleFilePath = useCallback(async (filePath: string) => {
    if (!isSupportedFile(filePath)) {
      setError(`Unsupported file type: ${filePath}`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let experiment;
      if (isInstrumentFile(filePath)) {
        experiment = await loadInstrumentFile(filePath);
      } else {
        const fs = await tauriFs;
        if (!fs) throw new Error('File system not available outside Tauri');
        const bytes = await fs.readFile(filePath);
        experiment = await loadSharpFile(bytes.buffer as ArrayBuffer, filePath.split(/[/\\]/).pop()!);
      }
      addRecentFile(filePath, experiment.wellsUsed?.length);
      loadExperiment(experiment, filePath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [loadExperiment]);

  // Listen for Tauri file drop events
  useEffect(() => {
    if (!tauriWebviewWindow) return;
    let cancelled = false;
    const unlistenPromise = tauriWebviewWindow.then(async (mod) => {
      if (cancelled) return undefined;
      const webview = mod.getCurrentWebviewWindow();
      return webview.onDragDropEvent((event) => {
        if (event.payload.type === 'over') {
          setDragOver(true);
        } else if (event.payload.type === 'leave') {
          setDragOver(false);
        } else if (event.payload.type === 'drop') {
          setDragOver(false);
          for (const path of event.payload.paths) {
            handleFilePath(path);
          }
        }
      });
    });
    return () => {
      cancelled = true;
      unlistenPromise.then((fn) => fn?.());
    };
  }, [handleFilePath]);

  const addEmptyTab = useAppState((s) => s.addEmptyTab);

  // Silent update check on launch
  useEffect(() => {
    checkForUpdates().then((result) => {
      if (result?.updateAvailable) {
        setUpdateBanner({ version: result.latestVersion, url: result.releaseUrl });
      }
    });
  }, []);

  const experiments = useAppState((s) => s.experiments);
  const activeExperimentIndex = useAppState((s) => s.activeExperimentIndex);
  const switchExperiment = useAppState((s) => s.switchExperiment);
  const removeExperiment = useAppState((s) => s.removeExperiment);

  return (
    <div className="flex flex-col h-screen select-none border-b border-border">
      {/* Menu bar */}
      <MenuBar onOpenWizard={() => setShowWizard(true)} onOpenManual={() => setShowManual(true)} />

      {/* Update available banner */}
      {updateBanner && (
        <div className="flex items-center justify-between px-3 py-1 bg-blue-50 dark:bg-blue-950 border-b text-xs">
          <span>
            Version {updateBanner.version} is available!{' '}
            <a href={updateBanner.url} target="_blank" rel="noopener noreferrer" className="underline text-blue-600 dark:text-blue-400">
              Download
            </a>
          </span>
          <button className="text-muted-foreground hover:text-foreground" onClick={() => setUpdateBanner(null)}>✕</button>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
      {/* Drag overlay */}
      {dragOver && (
        <div className="fixed inset-0 z-50 bg-primary/10 border-4 border-dashed border-primary flex items-center justify-center pointer-events-none">
          <div className="bg-background rounded-md shadow-lg p-8 text-center">
            <p className="text-lg font-semibold">Drop experiment file to load</p>
            <p className="text-xs text-muted-foreground mt-1">.sharp · .pcrd · .tlpd · .eds · .amxd</p>
          </div>
        </div>
      )}

      {/* Loading overlay */}
      {loading && (
        <div className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-background rounded-md shadow-lg p-6 text-center flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-3 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">Loading experiment...</p>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <div className="flex-shrink-0 overflow-hidden shadow-[1px_0_3px_rgba(0,0,0,0.04)]" style={{ width: sidebarWidth, minWidth: 300 }}>
        <Sidebar />
      </div>

      {/* Sidebar resize handle */}
      <div
        className="flex-shrink-0 w-1 cursor-col-resize hover:bg-accent active:bg-border transition-colors"
        style={{ borderRight: '1px solid var(--border)' }}
        onMouseDown={(e) => {
          e.preventDefault();
          sidebarDragging.current = true;
          sidebarDragStartX.current = e.clientX;
          sidebarDragStartW.current = sidebarWidth;
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
      />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Experiment tab bar */}
        {experiments.length > 0 && (
          <div className="flex items-end bg-muted/20 border-b shrink-0 overflow-hidden">
            {experiments.map((exp, i) => {
              const isActive = i === activeExperimentIndex;
              return (
                <div
                  key={`${exp?.experimentId ?? 'welcome'}-${i}`}
                  className={`group flex items-center gap-1 py-1.5 text-xs cursor-pointer border-r transition-all overflow-hidden ${
                    isActive
                      ? 'bg-background border-b-2 border-b-[var(--brand-red-mid)] font-medium shrink-0 px-3'
                      : 'hover:bg-accent/50 text-muted-foreground shrink px-2'
                  }`}
                  style={isActive ? { maxWidth: 200 } : { minWidth: 28, maxWidth: 100 }}
                  onClick={() => switchExperiment(i)}
                  title={exp?.experimentId ?? 'Welcome'}
                >
                  <span className="truncate">
                    {exp?.experimentId ?? 'Welcome'}
                  </span>
                  {isActive && (
                    <button
                      className="ml-1 w-4 h-4 rounded-sm flex items-center justify-center text-muted-foreground hover:bg-destructive/20 hover:text-destructive shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeExperiment(i);
                      }}
                      title="Close experiment"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
            <button
              className="px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors shrink-0"
              onClick={addEmptyTab}
              title="New tab"
            >
              +
            </button>
          </div>
        )}

        {/* Plot tabs + X-axis selector + Log Scale */}
        <PlotTabs />

        {/* Error message */}
        {error && (
          <div className="px-3 py-1 bg-destructive/10 text-destructive text-sm border-b">
            {error}
            <button className="ml-2 underline" onClick={() => setError(null)}>dismiss</button>
          </div>
        )}

        {/* Plot area + quick panel */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <PlotArea />
          <QuickStylePanel />
        </div>

        {/* Results table resize handle + table */}
        {experiments[activeExperimentIndex] != null && (
          <>
            <div
              className="flex-shrink-0 flex items-center justify-center cursor-row-resize hover:bg-accent active:bg-border transition-colors"
              style={{ height: 7, borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}
              onMouseDown={(e) => {
                e.preventDefault();
                tableDragging.current = true;
                tableDragStartY.current = e.clientY;
                tableDragStartH.current = tableHeight;
                document.body.style.cursor = 'row-resize';
                document.body.style.userSelect = 'none';
              }}
            >
              <div className="flex gap-1">
                <div className="w-1 h-1 rounded-full bg-muted-foreground/40" />
                <div className="w-1 h-1 rounded-full bg-muted-foreground/40" />
                <div className="w-1 h-1 rounded-full bg-muted-foreground/40" />
              </div>
            </div>

            <div className="overflow-auto" style={{ height: tableHeight }}>
              <ResultsTable />
            </div>
          </>
        )}
      </div>
      </div>

      {/* Dilution wizard floating panel */}
      {showWizard && <DilutionWizard onClose={() => setShowWizard(false)} />}
      {showExportWizard && <ExportWizard onClose={() => setShowExportWizard(false)} />}
      {showManual && <UserManual onClose={() => setShowManual(false)} />}
    </div>
  );
}

export default App;
