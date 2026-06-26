// Shared UI class atoms + documented design-system rules.
//
// These keep native / hand-rolled controls (<button>, <select>, <input>)
// consistent with the Button/Checkbox primitives without re-implementing them.
// The rules below are the single reference for type scale, radius, and disabled
// dimming across the app — when in doubt, match these.
//
// ── Micro-type scale ────────────────────────────────────────────────────────
//   text-sm   (14px)  plot-tab labels, dialog titles
//   text-xs   (12px)  default control / label size in the dense chrome
//   text-[11px]       captions, secondary labels, dense action buttons
//   text-[10px]       FLOOR — space-tight DATA labels only (e.g. 96-well coords)
//   (never render UI text below 10px)
//
// ── Radius rule ─────────────────────────────────────────────────────────────
//   small controls (checkbox, chips, swatches, inline inputs)  -> rounded-sm
//   standard controls (selects, number inputs, sm buttons)     -> rounded-md
//   containers (cards, popovers, dialogs, menus)               -> rounded-lg
//
// ── Disabled dimming ────────────────────────────────────────────────────────
//   opacity-50 everywhere (matches the Button primitive). Never opacity-40.

/** Keyboard focus ring for native / hand-rolled interactive controls.
 *  The Button and Checkbox primitives already ship this; append it to bespoke
 *  <button> / <select> / <input> elements so keyboard focus is visible in the
 *  Tauri WebView (whose default focus outline is faint/inconsistent). */
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:border-ring';
