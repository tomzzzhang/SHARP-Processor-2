import { useCallback, useRef, useState, useMemo } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useAnalysisResults } from '@/hooks/useAnalysisResults';
import { WELL_EMPTY_COLOR, WELL_SELECTED_BORDER, getPaletteColors, DEFAULT_PLATE_ROW_COUNT, DEFAULT_PLATE_COL_COUNT, getPlateRowLetters, getPlateColNumbers } from '@/lib/constants';
import { ContextMenu, useContextMenu } from './ContextMenu';

// Cell size constants (must match render)
const CELL_SIZE = 19;
const GAP = 1;
const HEADER_COL_W = 16;
const HEADER_ROW_H = 16; // approximate height of col header row

export function WellGrid() {
  const selectedWells = useAppState((s) => s.selectedWells);
  const hiddenWells = useAppState((s) => s.hiddenWells);
  const setSelectedWells = useAppState((s) => s.setSelectedWells);
  const addToSelection = useAppState((s) => s.addToSelection);
  const { menu, onContextMenu, close } = useContextMenu();
  const toggleWellSelection = useAppState((s) => s.toggleWellSelection);
  const selectOnly = useAppState((s) => s.selectOnly);
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const palette = useAppState((s) => s.palette);
  const paletteReversed = useAppState((s) => s.paletteReversed);
  const wellGroups = useAppState((s) => s.wellGroups);
  const hoveredWell = useAppState((s) => s.hoveredWell);
  const setHoveredWell = useAppState((s) => s.setHoveredWell);
  const dragPreviewWells = useAppState((s) => s.dragPreviewWells);
  const setDragPreviewWells = useAppState((s) => s.setDragPreviewWells);
  const wellStyleOverrides = useAppState((s) => s.wellStyleOverrides);
  const exp = experiments[idx];
  const usedWells = exp ? exp.wellsUsed : [];
  const usedSet = new Set(usedWells);
  const plateRowCount = exp?.plateRows ?? DEFAULT_PLATE_ROW_COUNT;
  const plateColCount = exp?.plateCols ?? DEFAULT_PLATE_COL_COUNT;
  const rows = getPlateRowLetters(plateRowCount);
  const cols = getPlateColNumbers(plateColCount);
  const analysisResults = useAnalysisResults();

  // Build well→color map respecting groups and Tt ordering (matches plot color logic)
  const wellColorMap = useMemo(() => {
    const m = new Map<string, string>();
    if (usedWells.length === 0) return m;

    const seenGroups = new Set<string>();
    const groupMembers = new Map<string, string[]>();
    const ungrouped: string[] = [];
    for (const well of usedWells) {
      const group = wellGroups.get(well);
      if (group) {
        if (!seenGroups.has(group)) { seenGroups.add(group); groupMembers.set(group, []); }
        groupMembers.get(group)!.push(well);
      } else { ungrouped.push(well); }
    }

    // Build sortable units with Tt ordering
    const units: [number, string[]][] = [];
    for (const [, members] of groupMembers) {
      let sum = 0, count = 0;
      for (const w of members) {
        const tt = analysisResults.get(w)?.tt;
        if (tt != null) { sum += tt; count++; }
      }
      units.push([count > 0 ? sum / count : Infinity, members]);
    }
    for (const well of ungrouped) {
      const tt = analysisResults.get(well)?.tt;
      units.push([tt ?? Infinity, [well]]);
    }
    if (analysisResults.size > 0) units.sort((a, b) => a[0] - b[0]);

    let colors = getPaletteColors(palette, units.length);
    if (paletteReversed) colors = [...colors].reverse();
    for (let i = 0; i < units.length; i++) {
      const color = colors[i % colors.length];
      for (const well of units[i][1]) m.set(well, color);
    }

    // Per-well overrides
    for (const [well, ov] of wellStyleOverrides.entries()) {
      const override = ov as { color?: string } | undefined;
      if (override?.color) m.set(well, override.color);
    }
    return m;
  }, [usedWells, palette, paletteReversed, wellGroups, wellStyleOverrides, analysisResults]);

  // ── Drag-to-select state ──
  const gridRef = useRef<HTMLDivElement>(null);
  const [dragRect, setDragRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const isDragging = useRef(false);
  const ctrlHeld = useRef(false);

  // Convert pixel position relative to the grid into row/col indices
  const pixelToRowCol = useCallback((px: number, py: number) => {
    // Column: skip header column (HEADER_COL_W), then each cell is CELL_SIZE + GAP
    const col = Math.floor((px - HEADER_COL_W) / (CELL_SIZE + GAP));
    // Row: skip header row, then each cell is CELL_SIZE + GAP
    const row = Math.floor((py - HEADER_ROW_H) / (CELL_SIZE + GAP));
    return { row, col };
  }, []);

  // Get all wells inside a rectangle (pixel coords relative to grid)
  const getWellsInRect = useCallback((x1: number, y1: number, x2: number, y2: number): string[] => {
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);

    const topLeft = pixelToRowCol(left, top);
    const bottomRight = pixelToRowCol(right, bottom);

    const rowStart = Math.max(0, topLeft.row);
    const rowEnd = Math.min(plateRowCount - 1, bottomRight.row);
    const colStart = Math.max(0, topLeft.col);
    const colEnd = Math.min(plateColCount - 1, bottomRight.col);

    const wells: string[] = [];
    for (let r = rowStart; r <= rowEnd; r++) {
      for (let c = colStart; c <= colEnd; c++) {
        const well = `${rows[r]}${cols[c]}`;
        // Only allow selecting populated wells
        if (usedSet.has(well)) wells.push(well);
      }
    }
    return wells;
  }, [pixelToRowCol, usedSet, plateRowCount, plateColCount, rows, cols]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only left button, not on right-click
    if (e.button !== 0) return;
    if (!gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    dragStart.current = { x, y };
    isDragging.current = false;
    ctrlHeld.current = e.ctrlKey || e.metaKey;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragStart.current || !gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dx = x - dragStart.current.x;
    const dy = y - dragStart.current.y;

    // Start drag only after moving 4px threshold
    if (!isDragging.current && Math.abs(dx) + Math.abs(dy) > 4) {
      isDragging.current = true;
    }
    if (isDragging.current) {
      setDragRect({
        x: Math.min(dragStart.current.x, x),
        y: Math.min(dragStart.current.y, y),
        w: Math.abs(dx),
        h: Math.abs(dy),
      });
      const previewWells = getWellsInRect(dragStart.current.x, dragStart.current.y, x, y);
      setDragPreviewWells(previewWells.length > 0 ? new Set(previewWells) : null);
    }
  }, [getWellsInRect, setDragPreviewWells]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (isDragging.current && dragStart.current && gridRef.current) {
      const rect = gridRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const wells = getWellsInRect(dragStart.current.x, dragStart.current.y, x, y);
      if (wells.length > 0) {
        if (ctrlHeld.current) {
          addToSelection(wells);
        } else {
          setSelectedWells(new Set(wells));
        }
      }
    }
    dragStart.current = null;
    isDragging.current = false;
    setDragRect(null);
    setDragPreviewWells(null);
  }, [getWellsInRect, addToSelection, setSelectedWells, setDragPreviewWells]);

  return (
    <div
      className="p-4 -m-4 mb-0"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        if (isDragging.current) {
          dragStart.current = null;
          isDragging.current = false;
          setDragRect(null);
          setDragPreviewWells(null);
        }
      }}
    >
    <div
      ref={gridRef}
      className="inline-grid gap-[1px] relative select-none"
      onContextMenu={onContextMenu}
      style={{
        gridTemplateColumns: `${HEADER_COL_W}px repeat(${plateColCount}, ${CELL_SIZE}px)`,
      }}
    >
      {/* Column headers */}
      <div />
      {cols.map((col) => (
        <div key={col} className="text-center text-[9px] text-muted-foreground font-medium leading-4">
          {col}
        </div>
      ))}

      {/* Rows */}
      {[...rows].flatMap((row) => [
        <div key={`label-${row}`} className="text-[9px] text-muted-foreground font-medium flex items-center justify-center">
          {row}
        </div>,
        ...cols.map((col) => {
          const well = `${row}${col}`;
          const isSelected = selectedWells.has(well);
          const isUsed = usedSet.has(well);
          const isHidden = hiddenWells.has(well);
          const isHovered = hoveredWell === well;
          const isDragHighlighted = dragPreviewWells ? dragPreviewWells.has(well) : null;
          const traceColor = wellColorMap.get(well);

          const bgColor = !isUsed
            ? WELL_EMPTY_COLOR
            : isHidden
              ? 'var(--muted-foreground)'
              : traceColor ?? WELL_EMPTY_COLOR;

          // Dim populated, visible, unselected wells when a partial selection
          // is active — so the selected set "pops" against the rest of the plate.
          const hasPartialSelection = selectedWells.size > 0 && selectedWells.size < usedWells.length;
          const isDimmedBySelection = isUsed && !isHidden && !isSelected && hasPartialSelection;

          let cellOpacity = isHidden ? 0.5 : isUsed ? (isDimmedBySelection ? 0.55 : 1) : 0.4;
          if (isDragHighlighted === true) cellOpacity = 1;
          else if (isDragHighlighted === false && isUsed) cellOpacity = 0.25;

          return (
            <div
              key={well}
              className={`relative transition-all duration-100 ${isUsed ? 'cursor-pointer' : 'cursor-default'}`}
              style={{
                width: CELL_SIZE, height: CELL_SIZE,
                backgroundColor: bgColor,
                border: `${isSelected ? 2 : isDragHighlighted === true ? 2 : 1}px solid ${isSelected ? WELL_SELECTED_BORDER : isDragHighlighted === true ? WELL_SELECTED_BORDER : 'rgba(0,0,0,0.18)'}`,
                borderRadius: 3,
                opacity: cellOpacity,
                outline: isHovered ? `2px solid ${WELL_SELECTED_BORDER}` : 'none',
                outlineOffset: 1,
                zIndex: isHovered ? 2 : undefined,
              }}
              title={well}
              onMouseEnter={() => { if (isUsed) setHoveredWell(well); }}
              onMouseLeave={() => { if (hoveredWell === well) setHoveredWell(null); }}
              onClick={(e) => {
                // Only handle click on populated wells, and not after a drag
                if (!isUsed || isDragging.current) return;
                e.stopPropagation();
                if (e.ctrlKey || e.metaKey) {
                  toggleWellSelection(well);
                } else {
                  selectOnly(well);
                }
              }}
            />
          );
        }),
      ])}

      {/* Drag selection rectangle overlay */}
      {dragRect && (
        <div
          style={{
            position: 'absolute',
            left: dragRect.x,
            top: dragRect.y,
            width: dragRect.w,
            height: dragRect.h,
            border: `1.5px dashed ${WELL_SELECTED_BORDER}`,
            backgroundColor: 'rgba(170, 32, 38, 0.07)',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        />
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={close} />}
    </div>
    </div>
  );
}
