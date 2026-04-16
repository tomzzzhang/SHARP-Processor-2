/**
 * Color picker with palette-based swatch rows + custom hex input + OK.
 * Uses fixed positioning so it won't be clipped by overflow:hidden parents.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { getPaletteColors, TABLEAU_10, COLORBLIND_SAFE, PAIRED } from '@/lib/constants';

/** Palette-based swatch series. Each row is labeled with the palette
 *  name and shows its colors as clickable chips. */
const SWATCH_SERIES: { label: string; colors: string[] }[] = [
  { label: 'Basics', colors: ['#000000', '#444444', '#888888', '#bbbbbb', '#ffffff', '#c42a30', '#2563eb', '#16a34a'] },
  { label: 'SHARP', colors: getPaletteColors('SHARP', 6) },
  { label: 'Tableau', colors: TABLEAU_10 },
  { label: 'CB Safe', colors: COLORBLIND_SAFE },
  { label: 'Paired', colors: PAIRED },
];

/** Flat list of all swatch colors for the InlineColorPicker (compact). */
const INLINE_SWATCHES = [
  '#000000', '#444444', '#888888', '#bbbbbb', '#ffffff',
  ...getPaletteColors('SHARP', 5),
  ...TABLEAU_10,
  ...COLORBLIND_SAFE.slice(0, 6),
];

// ── Shared swatch button ──────────────────────────────────────────

function Swatch({ color, selected, size = 'md', onClick }: {
  color: string; selected?: boolean; size?: 'sm' | 'md'; onClick: () => void;
}) {
  const dim = size === 'sm' ? 'w-4 h-4' : 'w-[18px] h-[18px]';
  const ring = selected
    ? 'ring-2 ring-primary ring-offset-1'
    : 'border-border';
  return (
    <button
      className={`${dim} rounded-sm cursor-pointer border hover:scale-110 transition-transform ${ring}`}
      style={{ backgroundColor: color }}
      onClick={onClick}
      title={color}
      type="button"
    />
  );
}

// ── ColorPicker (popover, for StyleTab) ───────────────────────────

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  label?: string;
}

export function ColorPicker({ value, onChange, label }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [customColor, setCustomColor] = useState(value || '#000000');
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const popW = 220;
    const popH = 260;
    let left = rect.left;
    let top = rect.bottom + 4;
    if (left + popW > window.innerWidth) left = window.innerWidth - popW - 8;
    if (top + popH > window.innerHeight) top = rect.top - popH - 4;
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (value) setCustomColor(value);
  }, [value]);

  const handleSwatchClick = useCallback((color: string) => {
    onChange(color);
    setOpen(false);
  }, [onChange]);

  const handleApply = useCallback(() => {
    onChange(customColor);
    setOpen(false);
  }, [customColor, onChange]);

  const popover = open ? createPortal(
    <div
      ref={popoverRef}
      className="fixed z-[9999] bg-background border rounded-lg shadow-lg p-2.5"
      style={{ top: pos.top, left: pos.left, width: 220 }}
    >
      {/* Palette rows */}
      <div className="space-y-1.5 mb-2">
        {SWATCH_SERIES.map((series) => (
          <div key={series.label}>
            <div className="text-[9px] text-muted-foreground mb-0.5">{series.label}</div>
            <div className="flex flex-wrap gap-1">
              {series.colors.map((c, i) => (
                <Swatch key={`${c}-${i}`} color={c} selected={value === c} onClick={() => handleSwatchClick(c)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Custom color row */}
      <div className="flex items-center gap-2 border-t pt-2">
        <input
          type="color"
          value={customColor}
          onChange={(e) => setCustomColor(e.target.value)}
          className="w-7 h-7 border rounded cursor-pointer p-0 shrink-0"
        />
        <input
          type="text"
          value={customColor}
          onChange={(e) => setCustomColor(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleApply(); }}
          className="flex-1 h-7 border rounded px-1.5 text-xs bg-background font-mono"
          placeholder="#hexcolor"
        />
        <button
          className="h-7 px-2 text-xs border rounded bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={handleApply}
          type="button"
        >
          OK
        </button>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <div className="inline-flex items-center gap-2">
        <button
          ref={triggerRef}
          className="w-7 h-7 border rounded cursor-pointer p-0 shrink-0"
          style={{ backgroundColor: value || '#fafafa' }}
          onClick={() => setOpen(!open)}
          title={value || 'Pick a color'}
          type="button"
        />
        {label && <span className="text-sm text-muted-foreground">{label}</span>}
      </div>
      {popover}
    </>
  );
}

// ── InlineColorPicker (for context menu / QuickStylePanel) ────────

interface InlineColorPickerProps {
  value?: string;
  onChange: (color: string) => void;
}

export function InlineColorPicker({ value, onChange }: InlineColorPickerProps) {
  const [customColor, setCustomColor] = useState(value || '#000000');

  const handleApply = useCallback(() => {
    onChange(customColor);
  }, [customColor, onChange]);

  return (
    <div className="p-1">
      <div className="flex flex-wrap gap-0.5 mb-1.5">
        {INLINE_SWATCHES.map((c, i) => (
          <Swatch key={`${c}-${i}`} color={c} selected={value === c} size="sm" onClick={() => onChange(c)} />
        ))}
      </div>
      <div className="flex items-center gap-1 border-t pt-1.5">
        <input
          type="color"
          value={customColor}
          onChange={(e) => setCustomColor(e.target.value)}
          className="w-5 h-5 border rounded cursor-pointer p-0 shrink-0"
        />
        <input
          type="text"
          value={customColor}
          onChange={(e) => setCustomColor(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleApply(); }}
          className="flex-1 h-5 border rounded px-1 text-[9px] bg-background font-mono min-w-0"
          placeholder="#hex"
        />
        <button
          className="h-5 px-1 text-[9px] border rounded bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={handleApply}
          type="button"
        >
          OK
        </button>
      </div>
    </div>
  );
}
