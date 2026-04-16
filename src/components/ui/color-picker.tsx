/**
 * Color picker with a swatch grid + custom hex input + Apply button.
 * Renders as a popover anchored to a small color chip.
 */

import { useState, useRef, useEffect, useCallback } from 'react';

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
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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

  return (
    <div className="relative inline-flex items-center gap-2">
      <button
        ref={triggerRef}
        className="w-7 h-7 border rounded cursor-pointer p-0 shrink-0"
        style={{ backgroundColor: value || '#fafafa' }}
        onClick={() => setOpen(!open)}
        title={value || 'Pick a color'}
        type="button"
      />
      {label && <span className="text-sm text-muted-foreground">{label}</span>}

      {open && (
        <div
          ref={popoverRef}
          className="absolute top-full left-0 mt-1 z-50 bg-background border rounded-lg shadow-lg p-3 w-[210px]"
          style={{ minWidth: 210 }}
        >
          {/* Swatch grid */}
          <div className="grid grid-cols-6 gap-1.5 mb-3">
            {SWATCHES.map((c) => (
              <button
                key={c}
                className={`w-6 h-6 rounded cursor-pointer border transition-transform hover:scale-110 ${
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
        </div>
      )}
    </div>
  );
}
