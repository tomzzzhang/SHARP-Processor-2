/**
 * Assign Fluorophores wizard — a floating modal to rename/recolour each
 * fluorescence channel. Seeds from the parser-detected dye + current overrides;
 * OK commits `channelLabels` / `channelColors` in one undoable action.
 */
import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppState } from '@/hooks/useAppState';
import { Button } from '@/components/ui/button';
import { COMMON_FLUOROPHORES } from '@/lib/constants';
import { effectiveChannelLabel, effectiveChannelColor } from '@/lib/channels';

interface Props { onClose: () => void; }

export function FluorophoreWizard({ onClose }: Props) {
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const channelLabels = useAppState((s) => s.channelLabels);
  const channelColors = useAppState((s) => s.channelColors);
  const setChannelMeta = useAppState((s) => s.setChannelMeta);
  const exp = experiments[idx];
  const channels = exp?.channels ?? [];

  // Working copies seeded from current effective values.
  const [labels, setLabels] = useState<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const ch of channels) m.set(ch, effectiveChannelLabel(ch, channelLabels, exp?.channelFluorophore));
    return m;
  });
  const [colors, setColors] = useState<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const ch of channels) m.set(ch, effectiveChannelColor(ch, channelColors, channelLabels, exp?.channelFluorophore));
    return m;
  });

  // Drag-to-move.
  const [pos, setPos] = useState({ x: window.innerWidth / 2 - 230, y: 120 });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const onHeaderDown = (e: React.MouseEvent) => {
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    const move = (ev: MouseEvent) => {
      if (drag.current) setPos({ x: ev.clientX - drag.current.dx, y: ev.clientY - drag.current.dy });
    };
    const up = () => { drag.current = null; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const dyeOptions = useMemo(() => {
    const set = new Set(COMMON_FLUOROPHORES);
    for (const v of labels.values()) if (v) set.add(v);
    return [...set];
  }, [labels]);

  const setLabel = (ch: string, v: string) => setLabels((m) => new Map(m).set(ch, v));
  const setColor = (ch: string, v: string) => setColors((m) => new Map(m).set(ch, v));

  const commit = () => { setChannelMeta(labels, colors); onClose(); };

  if (!exp) return null;

  return createPortal(
    <div
      className="fixed z-[1100] rounded-lg border bg-popover shadow-xl text-sm"
      style={{ left: pos.x, top: pos.y, width: 460 }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 border-b cursor-move select-none bg-muted/40 rounded-t-lg"
        onMouseDown={onHeaderDown}
      >
        <span className="font-medium">Assign Fluorophores</span>
        <button className="text-muted-foreground hover:text-foreground" onClick={onClose}>✕</button>
      </div>

      <div className="p-3 space-y-2 max-h-[60vh] overflow-auto">
        <div className="grid grid-cols-[1fr_1.3fr_auto] gap-2 text-xs text-muted-foreground font-medium px-1">
          <span>Channel</span><span>Fluorophore</span><span>Colour</span>
        </div>
        {channels.map((ch) => (
          <div key={ch} className="grid grid-cols-[1fr_1.3fr_auto] gap-2 items-center">
            <span className="font-mono text-xs truncate" title={ch}>{ch}</span>
            <input
              list={`dyes-${ch}`}
              value={labels.get(ch) ?? ''}
              onChange={(e) => setLabel(ch, e.target.value)}
              className="h-7 border rounded px-1 text-sm bg-background"
            />
            <datalist id={`dyes-${ch}`}>
              {dyeOptions.map((d) => <option key={d} value={d} />)}
            </datalist>
            <span className="flex items-center gap-1">
              <span className="inline-block w-5 h-5 rounded border" style={{ background: colors.get(ch) }} />
              <input
                value={colors.get(ch) ?? ''}
                onChange={(e) => setColor(ch, e.target.value)}
                className="h-7 w-20 border rounded px-1 text-xs font-mono bg-background"
                placeholder="#rrggbb"
              />
            </span>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2 px-3 py-2 border-t">
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={commit}>OK</Button>
      </div>
    </div>,
    document.body,
  );
}
