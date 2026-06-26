import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Shared close button for the floating wizard / modal dialogs. Gives every
 *  dialog the same lucide glyph, a comfortable ~28px hit area, and a keyboard
 *  focus ring — replacing the per-dialog raw `×` / `✕` text glyphs. */
export function DialogCloseButton({
  onClick,
  className,
  title = 'Close',
}: {
  onClick: () => void;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <X className="size-4" />
    </button>
  );
}
