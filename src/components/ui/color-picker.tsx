/**
 * Color picker with a swatch grid + custom hex input + OK button.
 * Uses fixed positioning so it won't be clipped by overflow:hidden parents.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

/** 24 common swatches — roughly mirroring design-tool palettes. */
const SWATCHES = [
  // Row 1: grays
  '#000000', '#333333', '#666666', '#999999', '#cccccc', '#ffffff',
  // Row 2: warm
  '#c42a30', '#e15759', '#f28e2b', '#edc948', '#ff9da7', '#fdbf6f',
  // Row 3: cool
  '#4e79a7', '#0072B2', '#56B4E9', '#76b7b2', '#009E73', '#59a14f',
  // Row 4: accents
  '#b07aa1', '#CC79A7', '#6a3d9a', '#b15928', '#9c755f', '#bab0ac',
];

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  /** Optional label shown next to the chip. */
  label?: string;
}

export function ColorPicker({ value, onChange, label }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [customColor, setCustomColor] = useState(value || '#000000');
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Position the popover below the trigger using fixed coords
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const popW = 180;
    const popH = 160;
    let left = rect.left;
    let top = rect.bottom + 4;
    // Keep on screen
    if (left + popW > window.innerWidth) left = window.innerWidth - popW - 8;
    if (top + popH > window.innerHeight) top = rect.top - popH - 4;
    setPos({ top, left });
  }, [open]);

  // Close on outside click
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

  // Sync custom color when value changes externally
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
      style={{ top: pos.top, left: pos.left, width: 180 }}
    >
      {/* Swatch grid */}
      <div className="grid grid-cols-6 gap-1 mb-2">
        {SWATCHES.map((c) => (
          <button
            key={c}
            className={`w-5 h-5 rounded-sm cursor-pointer border transition-transform hover:scale-110 ${
              value === c ? 'ring-2 ring-primary ring-offset-1' : 'border-border'
            }`}
            style={{ backgroundColor: c }}
            onClick={() => handleSwatchClick(c)}
            title={c}
            type="button"
          />
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

/**
 * Inline color swatch grid — for embedding inside context menus or
 * panels where a full popover isn't needed. Renders the swatch grid
 * + custom row directly (no trigger button, no popover).
 */
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
    <div className="p-1.5" style={{ width: 170 }}>
      <div className="grid grid-cols-6 gap-1 mb-2">
        {SWATCHES.map((c) => (
          <button
            key={c}
            className={`w-5 h-5 rounded-sm cursor-pointer border transition-transform hover:scale-110 ${
              value === c ? 'ring-2 ring-primary ring-offset-1' : 'border-border'
            }`}
            style={{ backgroundColor: c }}
            onClick={() => onChange(c)}
            title={c}
            type="button"
          />
        ))}
      </div>
      <div className="flex items-center gap-1.5 border-t pt-2">
        <input
          type="color"
          value={customColor}
          onChange={(e) => setCustomColor(e.target.value)}
          className="w-6 h-6 border rounded cursor-pointer p-0 shrink-0"
        />
        <input
          type="text"
          value={customColor}
          onChange={(e) => setCustomColor(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleApply(); }}
          className="flex-1 h-6 border rounded px-1 text-[10px] bg-background font-mono"
          placeholder="#hex"
        />
        <button
          className="h-6 px-1.5 text-[10px] border rounded bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={handleApply}
          type="button"
        >
          OK
        </button>
      </div>
    </div>
  );
}
