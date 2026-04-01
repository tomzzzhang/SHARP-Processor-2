import { useCallback, useEffect, useRef } from 'react';

type PlotlyAxisLayout = { p2d?: (p: number) => number; d2p?: (d: number) => number; _offset?: number; _length?: number };
type PlotlyFullLayout = { xaxis?: PlotlyAxisLayout; yaxis?: PlotlyAxisLayout; yaxis2?: PlotlyAxisLayout };

interface BoxSelectOptions {
  /** Callback when a region is selected. Receives data-coordinate bounds.
   *  For stacked subplots: y2Bounds contains yaxis2 data coords (if available). */
  onSelect: (x0: number, x1: number, y0: number, y1: number, y2Bounds?: { y0: number; y1: number }) => void;
  /** Callback during drag to preview which data coords are inside the box. */
  onDragMove?: (x0: number, x1: number, y0: number, y1: number, y2Bounds?: { y0: number; y1: number }) => void;
  /** Callback when drag ends or is cancelled (to clear preview state). */
  onDragEnd?: () => void;
  /** Callback when user clicks on empty plot area (not a drag, not threshold). */
  onEmptyClick?: () => void;
  /** Optional: threshold drag support (amp plot only) */
  threshold?: {
    enabled: boolean;
    rfu: number;
    setRfu: (v: number) => void;
  };
  /** Optional: melt derivative threshold drag support */
  meltThreshold?: {
    enabled: boolean;
    value: number;
    setValue: (v: number) => void;
  };
}

/**
 * Custom box selection for Plotly plots.
 * Returns refs that must be attached to the container div and overlay div.
 *
 * Plotly's built-in `plotly_selected` doesn't fire for line-only traces,
 * so we implement selection via raw mouse events + Plotly's internal p2d axis conversion.
 */
export function useBoxSelect(options: BoxSelectOptions) {
  const { onSelect, onDragMove, onDragEnd, onEmptyClick, threshold, meltThreshold } = options;
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const boxSelecting = useRef(false);
  const boxStartX = useRef(0);
  const boxStartY = useRef(0);
  const thresholdDragging = useRef(false);
  const meltThresholdDragging = useRef(false);
  /** Set by external code (Plotly onClick) to suppress the empty-click handler */
  const traceClickedRef = useRef(false);

  // Stable refs for callbacks
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onDragMoveRef = useRef(onDragMove);
  onDragMoveRef.current = onDragMove;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;
  const onEmptyClickRef = useRef(onEmptyClick);
  onEmptyClickRef.current = onEmptyClick;
  const thresholdRef = useRef(threshold);
  thresholdRef.current = threshold;
  const meltThresholdRef = useRef(meltThreshold);
  meltThresholdRef.current = meltThreshold;

  const getPlotDiv = useCallback(() => {
    return containerRef.current?.querySelector('.js-plotly-plot') as
      (HTMLElement & { _fullLayout?: PlotlyFullLayout }) | null;
  }, []);

  const pixelToYValue = useCallback((pixelY: number): number | null => {
    const plotDiv = getPlotDiv();
    if (!plotDiv?._fullLayout?.yaxis?.p2d) return null;
    const yaxis = plotDiv._fullLayout.yaxis;
    const plotRect = plotDiv.getBoundingClientRect();
    return yaxis.p2d!(pixelY - plotRect.top - (yaxis._offset ?? 0));
  }, [getPlotDiv]);

  const pixelToY2Value = useCallback((pixelY: number): number | null => {
    const plotDiv = getPlotDiv();
    if (!plotDiv?._fullLayout?.yaxis2?.p2d) return null;
    const yaxis2 = plotDiv._fullLayout.yaxis2;
    const plotRect = plotDiv.getBoundingClientRect();
    return yaxis2.p2d!(pixelY - plotRect.top - (yaxis2._offset ?? 0));
  }, [getPlotDiv]);

  const pixelToXValue = useCallback((pixelX: number): number | null => {
    const plotDiv = getPlotDiv();
    if (!plotDiv?._fullLayout?.xaxis?.p2d) return null;
    const xaxis = plotDiv._fullLayout.xaxis;
    const plotRect = plotDiv.getBoundingClientRect();
    return xaxis.p2d!(pixelX - plotRect.left - (xaxis._offset ?? 0));
  }, [getPlotDiv]);

  const isNearThreshold = useCallback((pixelY: number): boolean => {
    const t = thresholdRef.current;
    if (!t?.enabled) return false;
    const plotDiv = getPlotDiv();
    if (!plotDiv?._fullLayout?.yaxis?.d2p) return false;
    const yaxis = plotDiv._fullLayout.yaxis;
    const plotRect = plotDiv.getBoundingClientRect();
    const thresholdPixelY = yaxis.d2p!(t.rfu) + plotRect.top + (yaxis._offset ?? 0);
    return Math.abs(pixelY - thresholdPixelY) < 8;
  }, [getPlotDiv]);

  const isNearMeltThreshold = useCallback((pixelY: number): boolean => {
    const mt = meltThresholdRef.current;
    if (!mt?.enabled) return false;
    const plotDiv = getPlotDiv();
    if (!plotDiv?._fullLayout?.yaxis?.d2p) return false;
    const yaxis = plotDiv._fullLayout.yaxis;
    const plotRect = plotDiv.getBoundingClientRect();
    const thresholdPixelY = yaxis.d2p!(mt.value) + plotRect.top + (yaxis._offset ?? 0);
    return Math.abs(pixelY - thresholdPixelY) < 8;
  }, [getPlotDiv]);

  const isInPlotArea = useCallback((clientX: number, clientY: number): boolean => {
    const plotDiv = getPlotDiv();
    if (!plotDiv?._fullLayout?.xaxis || !plotDiv._fullLayout.yaxis) return false;
    const rect = plotDiv.getBoundingClientRect();
    const xa = plotDiv._fullLayout.xaxis;
    const ya = plotDiv._fullLayout.yaxis;
    const left = rect.left + (xa._offset ?? 0);
    if (clientX < left || clientX > left + (xa._length ?? 0)) return false;
    // Check primary y-axis region
    const top1 = rect.top + (ya._offset ?? 0);
    if (clientY >= top1 && clientY <= top1 + (ya._length ?? 0)) return true;
    // Also check yaxis2 region (stacked subplots)
    const ya2 = plotDiv._fullLayout.yaxis2;
    if (ya2) {
      const top2 = rect.top + (ya2._offset ?? 0);
      if (clientY >= top2 && clientY <= top2 + (ya2._length ?? 0)) return true;
    }
    return false;
  }, [getPlotDiv]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const t = thresholdRef.current;
      // Threshold drag takes priority
      if (t?.enabled && isNearThreshold(e.clientY)) {
        e.preventDefault();
        e.stopPropagation();
        thresholdDragging.current = true;
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
        return;
      }
      // Melt threshold drag
      const mt = meltThresholdRef.current;
      if (mt?.enabled && isNearMeltThreshold(e.clientY)) {
        e.preventDefault();
        e.stopPropagation();
        meltThresholdDragging.current = true;
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
        return;
      }
      // Start box selection if click is inside the plot area
      if (isInPlotArea(e.clientX, e.clientY)) {
        boxSelecting.current = true;
        boxStartX.current = e.clientX;
        boxStartY.current = e.clientY;
        document.body.style.userSelect = 'none';
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      const t = thresholdRef.current;
      const mt = meltThresholdRef.current;
      // Threshold hover cursor
      if (!thresholdDragging.current && !meltThresholdDragging.current && !boxSelecting.current) {
        if (t?.enabled && isNearThreshold(e.clientY)) {
          container.style.cursor = 'ns-resize';
        } else if (mt?.enabled && isNearMeltThreshold(e.clientY)) {
          container.style.cursor = 'ns-resize';
        } else {
          container.style.cursor = '';
        }
      }
      // Threshold drag
      if (thresholdDragging.current) {
        e.preventDefault();
        const yVal = pixelToYValue(e.clientY);
        if (yVal != null && yVal > 0) thresholdRef.current?.setRfu(Math.round(yVal * 10) / 10);
        return;
      }
      // Melt threshold drag
      if (meltThresholdDragging.current) {
        e.preventDefault();
        const yVal = pixelToYValue(e.clientY);
        if (yVal != null && yVal > 0) meltThresholdRef.current?.setValue(Math.round(yVal));
        return;
      }
      // Box selection overlay
      if (boxSelecting.current && overlayRef.current) {
        const dx = Math.abs(e.clientX - boxStartX.current);
        const dy = Math.abs(e.clientY - boxStartY.current);
        if (dx > 5 || dy > 5) {
          e.preventDefault();
          const containerRect = container.getBoundingClientRect();
          const x1 = boxStartX.current - containerRect.left;
          const y1 = boxStartY.current - containerRect.top;
          const x2 = e.clientX - containerRect.left;
          const y2 = e.clientY - containerRect.top;
          const ov = overlayRef.current;
          ov.style.display = 'block';
          ov.style.left = `${Math.min(x1, x2)}px`;
          ov.style.top = `${Math.min(y1, y2)}px`;
          ov.style.width = `${Math.abs(x2 - x1)}px`;
          ov.style.height = `${Math.abs(y2 - y1)}px`;

          // Live preview callback
          if (onDragMoveRef.current) {
            const dataX0 = pixelToXValue(Math.min(boxStartX.current, e.clientX));
            const dataX1 = pixelToXValue(Math.max(boxStartX.current, e.clientX));
            const dataY0 = pixelToYValue(Math.max(boxStartY.current, e.clientY));
            const dataY1 = pixelToYValue(Math.min(boxStartY.current, e.clientY));
            if (dataX0 != null && dataX1 != null && dataY0 != null && dataY1 != null) {
              const y2lo = pixelToY2Value(Math.max(boxStartY.current, e.clientY));
              const y2hi = pixelToY2Value(Math.min(boxStartY.current, e.clientY));
              const y2Bounds = y2lo != null && y2hi != null ? { y0: y2lo, y1: y2hi } : undefined;
              onDragMoveRef.current(dataX0, dataX1, dataY0, dataY1, y2Bounds);
            }
          }
        }
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (thresholdDragging.current) {
        thresholdDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        return;
      }
      if (meltThresholdDragging.current) {
        meltThresholdDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        return;
      }
      if (boxSelecting.current) {
        boxSelecting.current = false;
        document.body.style.userSelect = '';
        if (overlayRef.current) overlayRef.current.style.display = 'none';
        onDragEndRef.current?.();

        const dx = Math.abs(e.clientX - boxStartX.current);
        const dy = Math.abs(e.clientY - boxStartY.current);
        if (dx < 5 && dy < 5) {
          // This was a click, not a drag. Check if Plotly handled it as a trace click.
          // Use a microtask to let Plotly's onClick fire first (it runs synchronously).
          setTimeout(() => {
            if (!traceClickedRef.current && onEmptyClickRef.current) {
              onEmptyClickRef.current();
            }
            traceClickedRef.current = false;
          }, 0);
          return;
        }

        const dataX0 = pixelToXValue(Math.min(boxStartX.current, e.clientX));
        const dataX1 = pixelToXValue(Math.max(boxStartX.current, e.clientX));
        const dataY0 = pixelToYValue(Math.max(boxStartY.current, e.clientY)); // Y inverted
        const dataY1 = pixelToYValue(Math.min(boxStartY.current, e.clientY));
        if (dataX0 == null || dataX1 == null || dataY0 == null || dataY1 == null) return;

        const y2lo = pixelToY2Value(Math.max(boxStartY.current, e.clientY));
        const y2hi = pixelToY2Value(Math.min(boxStartY.current, e.clientY));
        const y2Bounds = y2lo != null && y2hi != null ? { y0: y2lo, y1: y2hi } : undefined;
        onSelectRef.current(dataX0, dataX1, dataY0, dataY1, y2Bounds);
      }
    };

    container.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      container.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [isNearThreshold, isNearMeltThreshold, isInPlotArea, pixelToYValue, pixelToY2Value, pixelToXValue]);

  return { containerRef, overlayRef, traceClickedRef };
}

/** JSX for the selection overlay div — place inside the container with position:relative */
export const BOX_SELECT_OVERLAY_STYLE: React.CSSProperties = {
  position: 'absolute', display: 'none', pointerEvents: 'none', zIndex: 10,
  border: '1px solid rgba(170, 32, 38, 0.8)',
  backgroundColor: 'rgba(170, 32, 38, 0.1)',
};
