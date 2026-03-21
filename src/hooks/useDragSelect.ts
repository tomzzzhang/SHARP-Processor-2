import { useCallback, useRef } from 'react';

/**
 * Hook for drag-selecting rows in a list/table.
 * Supports: click, Ctrl+click (toggle), Shift+click (range), drag-select.
 *
 * Usage:
 *   const { onRowMouseDown, onRowMouseEnter } = useDragSelect(orderedWells, {
 *     selectOnly, toggleWellSelection, setSelectedWells, selectedWells,
 *   });
 *   <tr onMouseDown={(e) => onRowMouseDown(e, well)} onMouseEnter={() => onRowMouseEnter(well)}>
 */
export function useDragSelect(
  orderedWells: string[],
  actions: {
    selectOnly: (well: string) => void;
    toggleWellSelection: (well: string) => void;
    setSelectedWells: (wells: Set<string>) => void;
    selectedWells: Set<string>;
  },
) {
  const dragAnchor = useRef<string | null>(null);
  const isDragging = useRef(false);
  const ctrlDrag = useRef(false);
  const baseSelection = useRef<Set<string>>(new Set());
  const lastClicked = useRef<string | null>(null);

  const getRange = useCallback((a: string, b: string): string[] => {
    const ia = orderedWells.indexOf(a);
    const ib = orderedWells.indexOf(b);
    if (ia < 0 || ib < 0) return [b];
    const lo = Math.min(ia, ib);
    const hi = Math.max(ia, ib);
    return orderedWells.slice(lo, hi + 1);
  }, [orderedWells]);

  const onRowMouseDown = useCallback((e: React.MouseEvent, well: string) => {
    // Ignore right-click
    if (e.button !== 0) return;

    // Shift+click: range select from last clicked
    if (e.shiftKey && lastClicked.current) {
      e.preventDefault();
      const range = getRange(lastClicked.current, well);
      if (e.ctrlKey || e.metaKey) {
        const next = new Set(actions.selectedWells);
        for (const w of range) next.add(w);
        actions.setSelectedWells(next);
      } else {
        actions.setSelectedWells(new Set(range));
      }
      return;
    }

    // Start drag
    dragAnchor.current = well;
    isDragging.current = false;
    ctrlDrag.current = e.ctrlKey || e.metaKey;
    baseSelection.current = ctrlDrag.current ? new Set(actions.selectedWells) : new Set();
    lastClicked.current = well;

    const onMove = () => {
      isDragging.current = true;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!isDragging.current) {
        // Was a plain click, not a drag
        if (ctrlDrag.current) {
          actions.toggleWellSelection(well);
        } else {
          actions.selectOnly(well);
        }
      }
      dragAnchor.current = null;
      isDragging.current = false;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    e.preventDefault(); // Prevent text selection during drag
  }, [actions, getRange]);

  const onRowMouseEnter = useCallback((well: string) => {
    if (!dragAnchor.current || !isDragging.current) return;
    const range = getRange(dragAnchor.current, well);
    const next = new Set(baseSelection.current);
    for (const w of range) next.add(w);
    actions.setSelectedWells(next);
  }, [actions, getRange]);

  return { onRowMouseDown, onRowMouseEnter };
}
