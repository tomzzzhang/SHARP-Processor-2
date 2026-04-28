import { useCallback, useEffect, useRef, useState } from 'react';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { useAppState } from '@/hooks/useAppState';
import { MOD_KEY, APP_VERSION } from '@/lib/constants';
import { checkForUpdates } from '@/lib/update-checker';
import { useAnalysisResults } from '@/hooks/useAnalysisResults';
import { loadSharpFile } from '@/lib/sharp-loader';
import { isInstrumentFile, isSupportedFile, loadInstrumentFile, loadBioradFolder } from '@/lib/instrument-loader';
import { exportPlotImage, exportCompositePlotImage, exportDataCsv, exportResultsCsv, exportMeltCsv, exportAsSharp, saveSession } from '@/lib/export';
import { getRecentFiles, addRecentFile } from '@/lib/recent-files';
import { getTheme, setTheme, type AppTheme } from '@/lib/theme';

interface MenuItem {
  label?: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
  disabled?: boolean;
  /** Optional nested submenu. When present, clicking or hovering shows
   *  the submenu to the right; the top-level item has no action. */
  submenu?: MenuItem[];
}

interface Menu {
  label: string;
  items: MenuItem[];
}

/** Render a flat list of menu items — used by both top-level dropdowns
 *  and nested submenus. Separators and disabled items are supported. */
function MenuItemRow({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const [hoverOpen, setHoverOpen] = useState(false);

  if (item.separator) {
    return <div className="border-t my-1" />;
  }

  if (item.submenu) {
    return (
      <div
        className="relative"
        onMouseEnter={() => setHoverOpen(true)}
        onMouseLeave={() => setHoverOpen(false)}
      >
        <button
          className="w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40"
          disabled={item.disabled}
        >
          <span>{item.label}</span>
          <span className="ml-6 text-muted-foreground">▸</span>
        </button>
        {hoverOpen && !item.disabled && (
          <div className="absolute top-0 left-full z-50 min-w-[200px] bg-background border rounded-md shadow-lg py-1">
            {item.submenu.map((sub, i) => (
              <MenuItemRow key={i} item={sub} onClose={onClose} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      className="w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40 disabled:cursor-default"
      disabled={item.disabled}
      onClick={() => {
        item.action?.();
        onClose();
      }}
    >
      <span>{item.label}</span>
      {item.shortcut && (
        <span className="text-muted-foreground ml-6">{item.shortcut}</span>
      )}
    </button>
  );
}

function MenuDropdown({ menu, isOpen, onOpen, onClose }: {
  menu: Menu;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onClose]);

  return (
    <div ref={ref} className="relative">
      <button
        className={`px-3 py-1 text-xs hover:bg-accent transition-colors ${isOpen ? 'bg-accent' : ''}`}
        onClick={() => isOpen ? onClose() : onOpen()}
        onMouseEnter={() => { /* hovering opens if another menu is already open — handled by parent */ }}
      >
        {menu.label}
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 z-50 min-w-[200px] bg-background border rounded-md shadow-lg py-1">
          {menu.items.map((item, i) => (
            <MenuItemRow key={i} item={item} onClose={onClose} />
          ))}
        </div>
      )}
    </div>
  );
}

export function MenuBar({ onOpenWizard, onOpenManual }: { onOpenWizard?: () => void; onOpenManual?: () => void } = {}) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [_saveStatus, setSaveStatus] = useState<string | null>(null);
  const [currentTheme, setCurrentTheme] = useState<AppTheme>(getTheme());

  const handleTheme = useCallback((theme: AppTheme) => {
    setTheme(theme);
    setCurrentTheme(theme);
  }, []);
  const loadExperiment = useAppState((s) => s.loadExperiment);
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const exp = experiments[idx];
  const getActiveSourcePath = useAppState((s) => s.getActiveSourcePath);
  const setActiveSourcePath = useAppState((s) => s.setActiveSourcePath);
  const selectAll = useAppState((s) => s.selectAll);
  const deselectAll = useAppState((s) => s.deselectAll);
  const xAxisMode = useAppState((s) => s.xAxisMode);
  const setPlotTab = useAppState((s) => s.setPlotTab);
  const plotTab = useAppState((s) => s.plotTab);
  const setShowExportWizard = useAppState((s) => s.setShowExportWizard);
  const logScale = useAppState((s) => s.logScale);
  const setLogScale = useAppState((s) => s.setLogScale);
  const hiddenWells = useAppState((s) => s.hiddenWells);
  const figureDpi = useAppState((s) => s.figureDpi);
  const analysisResults = useAnalysisResults();

  const hasData = !!exp;
  const visibleWells = exp ? exp.wellsUsed.filter((w) => !hiddenWells.has(w)) : [];

  const openFilePath = useCallback(async (filePath: string) => {
    try {
      let experiment;
      if (isSupportedFile(filePath)) {
        if (isInstrumentFile(filePath)) {
          experiment = await loadInstrumentFile(filePath);
        } else {
          const bytes = await readFile(filePath);
          experiment = await loadSharpFile(bytes.buffer as ArrayBuffer, filePath.split(/[/\\]/).pop()!);
        }
      } else {
        // No recognized extension — assume a BioRad folder export.
        experiment = await loadBioradFolder(filePath);
      }
      addRecentFile(filePath, experiment.wellsUsed?.length);
      loadExperiment(experiment, filePath);
    } catch (err) {
      alert(`Failed to open:\n${filePath}\n\n${err instanceof Error ? err.message : String(err)}`);
    }
  }, [loadExperiment]);

  const handleOpen = useCallback(async () => {
    const path = await dialogOpen({
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
    if (!filePath) return;
    await openFilePath(filePath);
  }, [openFilePath]);

  const handleOpenBioradFolder = useCallback(async () => {
    const path = await dialogOpen({ directory: true, multiple: false });
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

  const handleSave = useCallback(async () => {
    if (!exp) return;
    // Bundle the live analysis so saved cq/end_rfu reflect current
    // threshold/baseline (not the parse-time snapshot in exp.wells).
    // tt is in xAxis units — only meaningful as cq when in cycle mode.
    const liveAnalysis = { results: analysisResults, ttIsCycle: xAxisMode === 'cycle' };
    const sourcePath = getActiveSourcePath();
    if (sourcePath?.toLowerCase().endsWith('.sharp')) {
      // Quick save to same path
      await saveSession(exp, sourcePath, liveAnalysis);
      setSaveStatus('Saved');
      setTimeout(() => setSaveStatus(null), 2000);
    } else {
      // No .sharp source — do Save As
      const path = await exportAsSharp(exp, liveAnalysis);
      if (path) {
        setActiveSourcePath(path);
        setSaveStatus('Saved');
        setTimeout(() => setSaveStatus(null), 2000);
      }
    }
  }, [exp, analysisResults, xAxisMode, getActiveSourcePath, setActiveSourcePath]);

  /**
   * Export the currently-displayed plot(s) at their on-screen size,
   * upscaled by the user's configured DPI. On the amplification tab
   * this includes the melt-derivative mini-plot stacked below the
   * main plot (composite PNG/JPEG — SVG composites fall back to the
   * main plot only, since stitching two independent Plotly SVGs is
   * non-trivial and low-value for v1).
   */
  const handleExportAsSeen = useCallback(async (format: 'png' | 'svg' | 'jpeg') => {
    if (!exp) return;
    const name = exp.experimentId;

    // Pick the plot(s) to export based on the active tab.
    const byId = (id: string) => document.getElementById(id);

    if (plotTab === 'amplification') {
      const amp = byId('sharp-plot-amp');
      const deriv = byId('sharp-plot-amp-deriv');
      if (!amp) return;
      if (deriv && (format === 'png' || format === 'jpeg')) {
        await exportCompositePlotImage([amp, deriv], format, figureDpi, name);
        return;
      }
      // No derivative, or SVG requested — single-plot export
      await exportPlotImage(amp, format, figureDpi, name);
      return;
    }

    if (plotTab === 'melt') {
      const melt = byId('sharp-plot-melt');
      if (melt) await exportPlotImage(melt, format, figureDpi, name);
      return;
    }

    if (plotTab === 'doubling') {
      const doubling = byId('sharp-plot-doubling');
      if (doubling) await exportPlotImage(doubling, format, figureDpi, name);
      return;
    }
  }, [exp, figureDpi, plotTab]);

  const undo = useAppState((s) => s.undo);
  const redo = useAppState((s) => s.redo);
  const canUndo = useAppState((s) => s.canUndo);
  const canRedo = useAppState((s) => s.canRedo);
  const getUndoDescription = useAppState((s) => s.getUndoDescription);
  const getRedoDescription = useAppState((s) => s.getRedoDescription);

  const selectedWells = useAppState((s) => s.selectedWells);
  const showWells = useAppState((s) => s.showWells);
  const hideWells = useAppState((s) => s.hideWells);
  const showLegend = useAppState((s) => s.showLegend);
  const setShowLegend = useAppState((s) => s.setShowLegend);
  const setWellGroup = useAppState((s) => s.setWellGroup);
  const removeWellGroup = useAppState((s) => s.removeWellGroup);
  const autoGroupBySample = useAppState((s) => s.autoGroupBySample);
  const allWells = exp?.wellsUsed ?? [];
  const selArray = Array.from(selectedWells);

  const handleToggleVisibility = useCallback(() => {
    if (selArray.length === 0) return;
    const anyHidden = selArray.some((w) => hiddenWells.has(w));
    if (anyHidden) showWells(selArray);
    else hideWells(selArray);
  }, [selArray, hiddenWells, showWells, hideWells]);

  const handleGroup = useCallback(() => {
    if (selArray.length === 0) return;
    const name = prompt('Group name:', 'Group 1');
    if (name) setWellGroup(selArray, name);
  }, [selArray, setWellGroup]);

  const handleUngroup = useCallback(() => {
    if (selArray.length === 0) return;
    removeWellGroup(selArray);
  }, [selArray, removeWellGroup]);

  const recentFiles = getRecentFiles();

  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'Open...', shortcut: `${MOD_KEY}+O`, action: handleOpen },
        { label: 'Open BioRad Folder...', action: handleOpenBioradFolder },
        { separator: true },
        { label: 'Save', shortcut: `${MOD_KEY}+S`, action: handleSave, disabled: !hasData },
        { label: 'Save as .sharp', action: () => exp && exportAsSharp(exp, { results: analysisResults, ttIsCycle: xAxisMode === 'cycle' }), disabled: !hasData },
        ...(recentFiles.length > 0 ? [
          { separator: true } as MenuItem,
          ...recentFiles.slice(0, 5).map((f) => ({
            label: f.name,
            action: () => openFilePath(f.path),
          })),
        ] : []),
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: `Undo${getUndoDescription() ? ` ${getUndoDescription()}` : ''}`, shortcut: `${MOD_KEY}+Z`, action: undo, disabled: !hasData || !canUndo() },
        { label: `Redo${getRedoDescription() ? ` ${getRedoDescription()}` : ''}`, shortcut: `${MOD_KEY}+Shift+Z`, action: redo, disabled: !hasData || !canRedo() },
        { separator: true },
        { label: 'Select All Wells', shortcut: `${MOD_KEY}+A`, action: selectAll, disabled: !hasData },
        { label: 'Deselect All', action: deselectAll, disabled: !hasData },
        { separator: true },
        { label: 'Toggle Visibility', shortcut: `${MOD_KEY}+H`, action: handleToggleVisibility, disabled: !hasData || selArray.length === 0 },
        { label: 'Group...', shortcut: `${MOD_KEY}+G`, action: handleGroup, disabled: !hasData || selArray.length === 0 },
        { label: 'Ungroup', shortcut: `${MOD_KEY}+Shift+G`, action: handleUngroup, disabled: !hasData || selArray.length === 0 },
        { label: 'Auto-group by Sample', action: autoGroupBySample, disabled: !hasData },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Amplification', action: () => setPlotTab('amplification') },
        { label: 'Melt', action: () => setPlotTab('melt') },
        { label: 'Doubling Time', action: () => setPlotTab('doubling') },
        { separator: true },
        { label: `${logScale ? '✓ ' : ''}Log Scale`, action: () => setLogScale(!logScale) },
        { separator: true },
        { label: 'Show All Wells', action: () => showWells(allWells), disabled: !hasData },
        { label: 'Hide All Wells', action: () => hideWells(allWells), disabled: !hasData },
        { separator: true },
        { label: `${showLegend ? '✓ ' : ''}Show Legend`, action: () => setShowLegend(!showLegend) },
        { separator: true },
        { label: `${currentTheme === 'classic' ? '● ' : '○ '}Classic`, action: () => handleTheme('classic') },
        { label: `${currentTheme === 'sharp' ? '● ' : '○ '}SHARP`, action: () => handleTheme('sharp') },
        { label: `${currentTheme === 'sharp-dark' ? '● ' : '○ '}SHARP Dark`, action: () => handleTheme('sharp-dark') },
      ],
    },
    {
      label: 'Tools',
      items: [
        { label: 'Doubling Time Wizard...', action: () => onOpenWizard?.(), disabled: !hasData },
      ],
    },
    {
      label: 'Export',
      items: [
        { label: 'Export Wizard...', action: () => setShowExportWizard(true), disabled: !hasData },
        { separator: true },
        {
          label: 'Export As Seen',
          disabled: !hasData,
          submenu: [
            { label: 'As PNG', shortcut: `${MOD_KEY}+Shift+E`, action: () => handleExportAsSeen('png') },
            { label: 'As SVG', action: () => handleExportAsSeen('svg') },
            { label: 'As JPEG', action: () => handleExportAsSeen('jpeg') },
          ],
        },
        { separator: true },
        { label: 'Amplification Data (CSV)', action: () => exp && exportDataCsv(exp, xAxisMode, visibleWells), disabled: !hasData },
        { label: 'Melt Data (CSV)', action: () => exp && exportMeltCsv(exp, visibleWells), disabled: !hasData || !exp?.melt },
        { separator: true },
        { label: 'Results Table (CSV)', action: () => exp && exportResultsCsv(exp, analysisResults, visibleWells, xAxisMode), disabled: !hasData },
        { separator: true },
        { label: 'Save as .sharp', action: () => exp && exportAsSharp(exp, { results: analysisResults, ttIsCycle: xAxisMode === 'cycle' }), disabled: !hasData },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'User Manual...', action: () => onOpenManual?.() },
        { separator: true },
        {
          label: 'Check for Updates...', action: async () => {
            const result = await checkForUpdates();
            if (!result) {
              alert('Could not check for updates. Please check your internet connection.');
            } else if (result.updateAvailable) {
              if (confirm(`Version ${result.latestVersion} is available (you have ${result.currentVersion}).\n\nOpen the download page?`)) {
                window.open(result.releaseUrl, '_blank');
              }
            } else {
              alert(`You're up to date! (v${result.currentVersion})`);
            }
          },
        },
        { separator: true },
        {
          label: 'About SHARP Processor 2', action: () => {
            alert(`SHARP Processor 2\nVersion ${APP_VERSION}\n\n© 2026 SHARP Diagnostics, Inc.\nAll rights reserved.\n\nDesktop application for qPCR & isothermal amplification data analysis.`);
          },
        },
      ],
    },
  ];

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'o' || e.key === 'O') {
          e.preventDefault();
          handleOpen();
        } else if (e.key === 's' || e.key === 'S') {
          if (e.shiftKey) {
            e.preventDefault();
            handleExportAsSeen('png');
          } else {
            e.preventDefault();
            handleSave();
          }
        } else if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
        } else if (e.key === 'a' || e.key === 'A') {
          e.preventDefault();
          selectAll();
        } else if (e.key === 'h' || e.key === 'H') {
          e.preventDefault();
          handleToggleVisibility();
        } else if (e.key === 'g' || e.key === 'G') {
          e.preventDefault();
          if (e.shiftKey) handleUngroup();
          else handleGroup();
        } else if (e.key === 'e' || e.key === 'E') {
          if (e.shiftKey) {
            e.preventDefault();
            handleExportAsSeen('png');
          }
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleOpen, handleSave, handleExportAsSeen, selectAll, undo, redo, handleToggleVisibility, handleGroup, handleUngroup]);

  return (
    <div className="flex items-center bg-muted/30 border-b shrink-0" data-tauri-drag-region>
      {menus.map((menu) => (
        <MenuDropdown
          key={menu.label}
          menu={menu}
          isOpen={openMenu === menu.label}
          onOpen={() => setOpenMenu(menu.label)}
          onClose={() => setOpenMenu(null)}
        />
      ))}
      <div className="flex-1" data-tauri-drag-region />
    </div>
  );
}
