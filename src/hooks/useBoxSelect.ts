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
  /** Optional: melt derivative threshold drag support.
   *  `axis` says which Plotly y-axis the threshold sits on — 'y' for a
   *  single-axis plot (amp-tab mini derivative) or 'y2' for the stacked
   *  melt plot where the derivative occupies the lower subplot. */
  meltThreshold?: {
    enabled: boolean;
    value: number;
    setValue: (v: number) => void;
    axis?: 'y' | 'y2';
  };
  /** Optional: palette arrow mode — when active, drag draws an arrow
   *  instead of a box. On mouse-up the callback receives the start and
   *  end points in data coordinates. */
  paletteArrow?: {
    active: boolean;
    onApply: (x0: number, y0: number, x1: number, y1: number) => void;
  };
  /** Optional: RMB drag resize callbacks. If provided, right-click drag
   *  resizes the view to the rectangle and double right-click resets to
   *  auto range. (Plotly's wheel-zoom is separate, on MMB scroll.) */
  onResize?: (x0: number, x1: number, y0: number, y1: number) => void;
  onResizeReset?: () => void;
  /** Optional: called on RMB *release* (stationary single click) to show the
   *  context menu. Fired with a 350 ms delay so a 2nd RMB click can suppress
   *  it (double-click → reset view instead). */
  onShowContextMenu?: (clientX: number, clientY: number) => void;
}

/**
 * Custom box selection for Plotly plots.
 * Returns refs that must be attached to the container div and overlay div.
 *
 * Plotly's built-in `plotly_selected` doesn't fire for line-only traces,
 * so we implement selection via raw mouse events + Plotly's internal p2d axis conversion.
 */
export function useBoxSelect(options: BoxSelectOptions) {
  const { onSelect, onDragMove, onDragEnd, onEmptyClick, threshold, meltThreshold, paletteArrow, onResize, onResizeReset, onShowContextMenu } = options;
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const resizeOverlayRef = useRef<HTMLDivElement>(null);
  const arrowOverlayRef = useRef<SVGSVGElement>(null);
  const boxSelecting = useRef(false);
  const arrowDragging = useRef(false);
  const boxStartX = useRef(0);
  const boxStartY = useRef(0);
  const thresholdDragging = useRef(false);
  const meltThresholdDragging = useRef(false);
  /** Set by external code (Plotly onClick) to suppress the empty-click handler */
  const traceClickedRef = useRef(false);

  // RMB resize state
  const rmbDragging = useRef(false);
  const rmbStartX = useRef(0);
  const rmbStartY = useRef(0);
  const rmbDragOccurred = useRef(false);
  const lastRmbUp = useRef<{ time: number; x: number; y: number; menuTimerId: number } | null>(null);

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
  const paletteArrowRef = useRef(paletteArrow);
  paletteArrowRef.current = paletteArrow;
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  const onResizeResetRef = useRef(onResizeReset);
  onResizeResetRef.current = onResizeReset;
  const onShowContextMenuRef = useRef(onShowContextMenu);
  onShowContextMenuRef.current = onShowContextMenu;

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
    if (!plotDiv?._fullLayout) return false;
    const axisKey = mt.axis === 'y2' ? 'yaxis2' : 'yaxis';
    const axis = plotDiv._fullLayout[axisKey];
    if (!axis?.d2p) return false;
    const plotRect = plotDiv.getBoundingClientRect();
    const thresholdPixelY = axis.d2p!(mt.value) + plotRect.top + (axis._offset ?? 0);
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
      // RMB — handle independently of LMB. We take over RMB whenever resize OR
      // a custom context-menu callback is wired so we control menu timing.
      if (e.button === 2 && (onResizeRef.current || onShowContextMenuRef.current) && isInPlotArea(e.clientX, e.clientY)) {
        e.preventDefault();
        rmbDragging.current = true;
        rmbDragOccurred.current = false;
        rmbStartX.current = e.clientX;
        rmbStartY.current = e.clientY;
        document.body.style.userSelect = 'none';
        return;
      }
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
      // Palette arrow mode takes priority over box-select
      const pa = paletteArrowRef.current;
      if (pa?.active && isInPlotArea(e.clientX, e.clientY)) {
        e.preventDefault();
        arrowDragging.current = true;
        boxStartX.current = e.clientX;
        boxStartY.current = e.clientY;
        document.body.style.userSelect = 'none';
        container.style.cursor = 'crosshair';
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
      if (!thresholdDragging.current && !meltThresholdDragging.current && !boxSelecting.current && !arrowDragging.current) {
        const pa = paletteArrowRef.current;
        if (pa?.active && isInPlotArea(e.clientX, e.clientY)) {
          container.style.cursor = 'crosshair';
        } else if (t?.enabled && isNearThreshold(e.clientY)) {
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
      // Melt threshold drag — read from the correct y-axis (y or y2)
      if (meltThresholdDragging.current) {
        e.preventDefault();
        const onY2 = meltThresholdRef.current?.axis === 'y2';
        const yVal = onY2 ? pixelToY2Value(e.clientY) : pixelToYValue(e.clientY);
        if (yVal != null && yVal > 0) meltThresholdRef.current?.setValue(Math.round(yVal));
        return;
      }
      // Arrow drag overlay
      if (arrowDragging.current && arrowOverlayRef.current) {
        e.preventDefault();
        const containerRect = container.getBoundingClientRect();
        const x1 = boxStartX.current - containerRect.left;
        const y1 = boxStartY.current - containerRect.top;
        const x2 = e.clientX - containerRect.left;
        const y2 = e.clientY - containerRect.top;
        const svg = arrowOverlayRef.current;
        svg.style.display = 'block';
        svg.setAttribute('viewBox', `0 0 ${containerRect.width} ${containerRect.height}`);
        svg.style.width = `${containerRect.width}px`;
        svg.style.height = `${containerRect.height}px`;
        svg.innerHTML = `<defs><marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="rgba(170,32,38,0.9)" /></marker></defs><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(170,32,38,0.8)" stroke-width="2" marker-end="url(#arrowhead)" />`;
        return;
      }
      // RMB resize overlay
      if (rmbDragging.current && resizeOverlayRef.current) {
        const dx = Math.abs(e.clientX - rmbStartX.current);
        const dy = Math.abs(e.clientY - rmbStartY.current);
        if (dx > 5 || dy > 5) {
          e.preventDefault();
          rmbDragOccurred.current = true;
          container.style.cursor = 'zoom-in';
          const containerRect = container.getBoundingClientRect();
          const x1 = rmbStartX.current - containerRect.left;
          const y1 = rmbStartY.current - containerRect.top;
          const x2 = e.clientX - containerRect.left;
          const y2 = e.clientY - containerRect.top;
          const ov = resizeOverlayRef.current;
          ov.style.display = 'block';
          ov.style.left = `${Math.min(x1, x2)}px`;
          ov.style.top = `${Math.min(y1, y2)}px`;
          ov.style.width = `${Math.abs(x2 - x1)}px`;
          ov.style.height = `${Math.abs(y2 - y1)}px`;
        }
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
      if (e.button === 2 && rmbDragging.current) {
        rmbDragging.current = false;
        document.body.style.userSelect = '';
        container.style.cursor = '';
        if (resizeOverlayRef.current) resizeOverlayRef.current.style.display = 'none';

        const dx = Math.abs(e.clientX - rmbStartX.current);
        const dy = Math.abs(e.clientY - rmbStartY.current);
        if (dx > 5 || dy > 5) {
          // Drag = resize. Suppress any pending menu from a previous click.
          if (lastRmbUp.current) {
            window.clearTimeout(lastRmbUp.current.menuTimerId);
            lastRmbUp.current = null;
          }
          const x0 = pixelToXValue(Math.min(rmbStartX.current, e.clientX));
          const x1 = pixelToXValue(Math.max(rmbStartX.current, e.clientX));
          const y0 = pixelToYValue(Math.max(rmbStartY.current, e.clientY)); // Y inverted
          const y1 = pixelToYValue(Math.min(rmbStartY.current, e.clientY));
          if (x0 != null && x1 != null && y0 != null && y1 != null) {
            onResizeRef.current?.(x0, x1, y0, y1);
          }
        } else {
          // Stationary RMB release. Either fire menu (after a delay so a 2nd
          // click can cancel it) or, if this *is* the 2nd click, reset view.
          const now = Date.now();
          const last = lastRmbUp.current;
          if (last && now - last.time < 350
              && Math.abs(e.clientX - last.x) < 8
              && Math.abs(e.clientY - last.y) < 8) {
            // Double-click → cancel pending menu, reset view
            window.clearTimeout(last.menuTimerId);
            onResizeResetRef.current?.();
            lastRmbUp.current = null;
          } else {
            // 1st click → schedule menu in 350ms
            const x = e.clientX, y = e.clientY;
            const menuTimerId = window.setTimeout(() => {
              onShowContextMenuRef.current?.(x, y);
              lastRmbUp.current = null;
            }, 350);
            lastRmbUp.current = { time: now, x, y, menuTimerId };
          }
        }
        return;
      }
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
      if (arrowDragging.current) {
        arrowDragging.current = false;
        document.body.style.userSelect = '';
        container.style.cursor = '';
        if (arrowOverlayRef.current) arrowOverlayRef.current.style.display = 'none';
        const dx = Math.abs(e.clientX - boxStartX.current);
        const dy = Math.abs(e.clientY - boxStartY.current);
        if (dx > 10 || dy > 10) {
          const x0 = pixelToXValue(boxStartX.current);
          const y0 = pixelToYValue(boxStartY.current);
          const x1 = pixelToXValue(e.clientX);
          const y1 = pixelToYValue(e.clientY);
          if (x0 != null && y0 != null && x1 != null && y1 != null) {
            paletteArrowRef.current?.onApply(x0, y0, x1, y1);
          }
        }
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

    const onContextMenu = (e: MouseEvent) => {
      // We control menu timing ourselves (fired on mouseup, after a delay).
      // Always suppress the native (and React) contextmenu event when we've
      // taken over RMB handling.
      if (onResizeRef.current || onShowContextMenuRef.current) {
        e.preventDefault();
        e.stopPropagation();
      }
      rmbDragOccurred.current = false;
    };

    container.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    container.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      container.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [isNearThreshold, isNearMeltThreshold, isInPlotArea, pixelToYValue, pixelToY2Value, pixelToXValue]);

  return { containerRef, overlayRef, resizeOverlayRef, arrowOverlayRef, traceClickedRef };
}

/** JSX for the selection overlay div — place inside the container with position:relative */
export const BOX_SELECT_OVERLAY_STYLE: React.CSSProperties = {
  position: 'absolute', display: 'none', pointerEvents: 'none', zIndex: 10,
  border: '1px solid rgba(170, 32, 38, 0.8)',
  backgroundColor: 'rgba(170, 32, 38, 0.1)',
};

/** JSX for the RMB resize overlay div */
export const RESIZE_OVERLAY_STYLE: React.CSSProperties = {
  position: 'absolute', display: 'none', pointerEvents: 'none', zIndex: 10,
  border: '1px dashed rgba(50, 130, 220, 0.8)',
  backgroundColor: 'rgba(50, 130, 220, 0.08)',
};
