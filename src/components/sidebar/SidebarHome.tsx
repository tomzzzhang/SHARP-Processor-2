import { useCallback } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { Button } from '@/components/ui/button';
import { loadSharpFile } from '@/lib/sharp-loader';
import { isInstrumentFile, isSupportedFile, loadInstrumentFile, loadBioradFolder } from '@/lib/instrument-loader';
import { getRecentFiles, addRecentFile } from '@/lib/recent-files';

// Dynamic imports — avoid crash when running outside Tauri (e.g. plain Vite dev)
const isTauri = !!(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__;
const tauriDialog = isTauri ? import('@tauri-apps/plugin-dialog') : null;
const tauriFs = isTauri ? import('@tauri-apps/plugin-fs') : null;

export function SidebarHome() {
  const loadExperiment = useAppState((s) => s.loadExperiment);

  const openFilePath = useCallback(async (filePath: string) => {
    let experiment;
    if (isSupportedFile(filePath)) {
      if (isInstrumentFile(filePath)) {
        experiment = await loadInstrumentFile(filePath);
      } else {
        const fs = await tauriFs;
        if (!fs) throw new Error('File system not available outside Tauri');
        const bytes = await fs.readFile(filePath);
        experiment = await loadSharpFile(bytes.buffer as ArrayBuffer, filePath.split(/[/\\]/).pop()!);
      }
    } else {
      // No recognized extension — assume a BioRad CSV folder export.
      experiment = await loadBioradFolder(filePath);
    }
    addRecentFile(filePath, experiment.wellsUsed?.length);
    loadExperiment(experiment, filePath);
  }, [loadExperiment]);

  const handleOpen = useCallback(async () => {
    const dialog = await tauriDialog;
    if (!dialog) return;
    const path = await dialog.open({
      filters: [
        { name: 'Experiment Files', extensions: ['sharp', 'pcrd', 'tlpd', 'eds', 'amxd', 'adxd'] },
        { name: 'SHARP Files', extensions: ['sharp'] },
        { name: 'BioRad .pcrd', extensions: ['pcrd'] },
        { name: 'TianLong .tlpd', extensions: ['tlpd'] },
        { name: 'ThermoFisher .eds', extensions: ['eds'] },
        { name: 'Agilent .amxd', extensions: ['amxd', 'adxd'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      multiple: false,
    });
    if (!path) return;
    const filePath = typeof path === 'string' ? path : path[0];
    if (filePath) await openFilePath(filePath);
  }, [openFilePath]);

  const handleOpenBioradFolder = useCallback(async () => {
    const dialog = await tauriDialog;
    if (!dialog) return;
    const path = await dialog.open({ directory: true, multiple: false });
    if (!path) return;
    const dirPath = typeof path === 'string' ? path : path[0];
    if (!dirPath) return;
    try {
      const experiment = await loadBioradFolder(dirPath);
      addRecentFile(dirPath, experiment.wellsUsed?.length);
      loadExperiment(experiment, dirPath);
    } catch (err) {
      alert(`Failed to load BioRad folder:\n${err instanceof Error ? err.message : String(err)}`);
    }
  }, [loadExperiment]);

  const recentFiles = getRecentFiles();

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        No experiment loaded.
      </p>
      <Button
        variant="outline"
        className="w-full"
        onClick={handleOpen}
      >
        Load file...
      </Button>
      <Button
        variant="outline"
        className="w-full"
        onClick={handleOpenBioradFolder}
      >
        Load BioRad folder...
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        or drag & drop a file anywhere
      </p>
      <p className="text-xs text-muted-foreground text-center">
        .sharp · .pcrd · .tlpd · .eds · .amxd
      </p>

      {recentFiles.length > 0 && (
        <div className="pt-2 border-t">
          <h3 className="text-xs font-semibold text-muted-foreground mb-2">Recent Experiments</h3>
          <div className="border border-border rounded overflow-hidden">
            {/* Header */}
            <div className="flex text-[10px] font-semibold text-muted-foreground bg-muted/50 border-b border-border px-2 py-1">
              <span className="flex-1">Name</span>
              <span className="w-10 text-center">Wells</span>
              <span className="w-14 text-right">Format</span>
            </div>
            {/* Scrollable list */}
            <div className="max-h-[200px] overflow-y-auto">
              {recentFiles.map((f, i) => (
                <button
                  key={i}
                  className={`w-full flex items-center px-2 py-1.5 text-xs hover:bg-accent transition-colors ${i % 2 === 1 ? 'bg-muted/30' : ''}`}
                  title={f.path}
                  onClick={() => openFilePath(f.path)}
                >
                  <span className="flex-1 font-medium truncate text-left">{f.name.replace(/\.[^.]+$/, '')}</span>
                  <span className="w-10 text-center text-muted-foreground">{f.wellCount ?? '—'}</span>
                  <span className="w-14 text-right text-muted-foreground">{f.format}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="pt-4 mt-auto">
        <p className="text-[10px] text-muted-foreground/60 text-center">© 2026 SHARP Diagnostics, Inc.</p>
      </div>
    </div>
  );
}
