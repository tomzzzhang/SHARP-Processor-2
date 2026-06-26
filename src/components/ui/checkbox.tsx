import { useEffect, useRef, type ComponentProps } from "react"

import { cn } from "@/lib/utils"
import { FOCUS_RING } from "@/lib/ui-classes"

type CheckboxProps = Omit<
  ComponentProps<"input">,
  "type" | "checked" | "onChange" | "onClick"
> & {
  checked?: boolean
  indeterminate?: boolean
  onCheckedChange?: (checked: boolean) => void
}

// Renders as a NATIVE <input type="checkbox"> with accent-color, so it draws
// with the exact same OS rendering on both macOS and Windows — a clean red
// box with a checkmark when on. The `indeterminate` flag (when supplied)
// shows the "mixed" state for the tri-state per-well controls.
//
// We drive the toggle from onClick (which also fires for keyboard Space) and
// keep onChange a no-op for the controlled input.
function Checkbox({
  checked,
  indeterminate,
  onCheckedChange,
  disabled,
  className,
  style,
  ...props
}: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate
  }, [indeterminate])

  return (
    <input
      ref={ref}
      data-slot="checkbox"
      {...props}
      type="checkbox"
      checked={!!checked}
      disabled={disabled}
      onChange={() => {}}
      onClick={() => onCheckedChange?.(!checked)}
      style={{ accentColor: "var(--brand-red-dark)", ...style }}
      className={cn(
        "shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
        FOCUS_RING,
        className,
      )}
    />
  )
}

export { Checkbox }
