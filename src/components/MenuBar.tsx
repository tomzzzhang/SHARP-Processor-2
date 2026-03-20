import { useCallback, useEffect, useRef, useState } from 'react';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { useAppState } from '@/hooks/useAppState';
import { useAnalysisResults } from '@/hooks/useAnalysisResults';
import { loadSharpFile } from '@/lib/sharp-loader';
import { isInstrumentFile, loadInstrumentFile } from '@/lib/instrument-loader';
import { exportPlotImage, exportDataCsv, exportResultsCsv, exportMeltCsv, exportAsSharp } from '@/lib/export';

interface MenuItem {
  label: string;
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

export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const loadExperiment = useAppState((s) => s.loadExperiment);
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const exp = experiments[idx];
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

    let experiment;
    if (isInstrumentFile(filePath)) {
      experiment = await loadInstrumentFile(filePath);
    } else {
      const bytes = await readFile(filePath);
      experiment = await loadSharpFile(bytes.buffer as ArrayBuffer, filePath.split(/[/\\]/).pop()!);
    }
    loadExperiment(experiment);
  }, [loadExperiment]);

  const handleExportPlot = useCallback(async (format: 'png' | 'svg' | 'jpeg') => {
    const plotDiv = document.querySelector('.js-plotly-plot') as HTMLElement | null;
    if (!plotDiv || !exp) return;
    await exportPlotImage(plotDiv, format, figureDpi, exp.experimentId);
  }, [exp, figureDpi]);

  const showWells = useAppState((s) => s.showWells);
  const hideWells = useAppState((s) => s.hideWells);
  const showLegend = useAppState((s) => s.showLegend);
  const setShowLegend = useAppState((s) => s.setShowLegend);
  const allWells = exp?.wellsUsed ?? [];

  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'Open...', shortcut: 'Ctrl+O', action: handleOpen },
        { separator: true },
        { label: 'Save as .sharp', action: () => exp && exportAsSharp(exp), disabled: !hasData },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Select All Wells', shortcut: 'Ctrl+A', action: selectAll, disabled: !hasData },
        { label: 'Deselect All', action: deselectAll, disabled: !hasData },
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
      ],
    },
    {
      label: 'Tools',
      items: [
        { label: 'Doubling Time Wizard...', action: () => setPlotTab('doubling'), disabled: !hasData },
      ],
    },
    {
      label: 'Export',
      items: [
        { label: 'Plot as PNG', shortcut: 'Ctrl+Shift+S', action: () => handleExportPlot('png'), disabled: !hasData },
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
  ];

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'o' || e.key === 'O') {
          e.preventDefault();
          handleOpen();
        } else if (e.key === 'a' || e.key === 'A') {
          e.preventDefault();
          selectAll();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleOpen, selectAll]);

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
