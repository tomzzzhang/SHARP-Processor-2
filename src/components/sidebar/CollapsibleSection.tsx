import { useState, type ReactNode } from 'react';

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({ title, defaultOpen = true, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border rounded-md overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-1.5 text-sm font-semibold hover:bg-accent/50 transition-colors select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <span>{title}</span>
        <svg
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-150 ${open ? '' : '-rotate-90'}`}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M3 4.5 L6 7.5 L9 4.5" />
        </svg>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-3 border-t">
          {children}
        </div>
      )}
    </div>
  );
}
