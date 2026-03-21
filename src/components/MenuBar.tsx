import { useCallback, useEffect, useRef, useState } from 'react';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { useAppState } from '@/hooks/useAppState';
import { useAnalysisResults } from '@/hooks/useAnalysisResults';
import { loadSharpFile } from '@/lib/sharp-loader';
import { isInstrumentFile, isSupportedFile, loadInstrumentFile } from '@/lib/instrument-loader';
import { exportPlotImage, exportDataCsv, exportResultsCsv, exportMeltCsv, exportAsSharp, saveSession } from '@/lib/export';
import { getRecentFiles, addRecentFile } from '@/lib/recent-files';
import { getTheme, setTheme, type AppTheme } from '@/lib/theme';

interface MenuItem {
  label?: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
  disabled?: boolean;
}

interface Menu {
  label: string;
  items: MenuItem[];
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
          {menu.items.map((item, i) =>
            item.separator ? (
              <div key={i} className="border-t my-1" />
            ) : (
              <button
                key={i}
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
            )
          )}
        </div>
      )}
    </div>
  );
}

export function MenuBar({ onOpenWizard }: { onOpenWizard?: () => void } = {}) {
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
  const selectAll = useAppState((s) => s.selectAll);
  const deselectAll = useAppState((s) => s.deselectAll);
  const xAxisMode = useAppState((s) => s.xAxisMode);
  const setPlotTab = useAppState((s) => s.setPlotTab);
  const logScale = useAppState((s) => s.logScale);
  const setLogScale = useAppState((s) => s.setLogScale);
  const hiddenWells = useAppState((s) => s.hiddenWells);
  const figureDpi = useAppState((s) => s.figureDpi);
  const analysisResults = useAnalysisResults();

  const hasData = !!exp;
  const visibleWells = exp ? exp.wellsUsed.filter((w) => !hiddenWells.has(w)) : [];

  const openFilePath = useCallback(async (filePath: string) => {
    if (!isSupportedFile(filePath)) return;
    let experiment;
    if (isInstrumentFile(filePath)) {
      experiment = await loadInstrumentFile(filePath);
    } else {
      const bytes = await readFile(filePath);
      experiment = await loadSharpFile(bytes.buffer as ArrayBuffer, filePath.split(/[/\\]/).pop()!);
    }
    addRecentFile(filePath);
    loadExperiment(experiment, filePath);
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

  const handleSave = useCallback(async () => {
    if (!exp) return;
    const sourcePath = getActiveSourcePath();
    if (sourcePath?.toLowerCase().endsWith('.sharp')) {
      // Quick save to same path
      await saveSession(exp, sourcePath);
      setSaveStatus('Saved');
      setTimeout(() => setSaveStatus(null), 2000);
    } else {
      // No .sharp source — do Save As
      const path = await exportAsSharp(exp);
      if (path) {
        setSaveStatus('Saved');
        setTimeout(() => setSaveStatus(null), 2000);
      }
    }
  }, [exp, getActiveSourcePath]);

  const handleExportPlot = useCallback(async (format: 'png' | 'svg' | 'jpeg') => {
    const plotDiv = document.querySelector('.js-plotly-plot') as HTMLElement | null;
    if (!plotDiv || !exp) return;
    await exportPlotImage(plotDiv, format, figureDpi, exp.experimentId);
  }, [exp, figureDpi]);

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
        { label: 'Open...', shortcut: 'Ctrl+O', action: handleOpen },
        { separator: true },
        { label: 'Save', shortcut: 'Ctrl+S', action: handleSave, disabled: !hasData },
        { label: 'Save as .sharp', action: () => exp && exportAsSharp(exp), disabled: !hasData },
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
        { label: `Undo${getUndoDescription() ? ` ${getUndoDescription()}` : ''}`, shortcut: 'Ctrl+Z', action: undo, disabled: !hasData || !canUndo() },
        { label: `Redo${getRedoDescription() ? ` ${getRedoDescription()}` : ''}`, shortcut: 'Ctrl+Shift+Z', action: redo, disabled: !hasData || !canRedo() },
        { separator: true },
        { label: 'Select All Wells', shortcut: 'Ctrl+A', action: selectAll, disabled: !hasData },
        { label: 'Deselect All', action: deselectAll, disabled: !hasData },
        { separator: true },
        { label: 'Toggle Visibility', shortcut: 'Ctrl+H', action: handleToggleVisibility, disabled: !hasData || selArray.length === 0 },
        { label: 'Group...', shortcut: 'Ctrl+G', action: handleGroup, disabled: !hasData || selArray.length === 0 },
        { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', action: handleUngroup, disabled: !hasData || selArray.length === 0 },
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
        { label: 'Plot as PNG', shortcut: 'Ctrl+Shift+E', action: () => handleExportPlot('png'), disabled: !hasData },
        { label: 'Plot as SVG', action: () => handleExportPlot('svg'), disabled: !hasData },
        { label: 'Plot as JPEG', action: () => handleExportPlot('jpeg'), disabled: !hasData },
        { separator: true },
        { label: 'Amplification Data (CSV)', action: () => exp && exportDataCsv(exp, xAxisMode, visibleWells), disabled: !hasData },
        { label: 'Melt Data (CSV)', action: () => exp && exportMeltCsv(exp, visibleWells), disabled: !hasData || !exp?.melt },
        { separator: true },
        { label: 'Results Table (CSV)', action: () => exp && exportResultsCsv(exp, analysisResults, visibleWells, xAxisMode), disabled: !hasData },
        { separator: true },
        { label: 'Save as .sharp', action: () => exp && exportAsSharp(exp), disabled: !hasData },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'User Manual...', action: () => { /* TODO: open help page */ } },
        { separator: true },
        { label: 'About SHARP Processor 2', action: () => { /* TODO: about dialog */ } },
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
            handleExportPlot('png');
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
            handleExportPlot('png');
          }
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleOpen, handleSave, handleExportPlot, selectAll, undo, redo, handleToggleVisibility, handleGroup, handleUngroup]);

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
