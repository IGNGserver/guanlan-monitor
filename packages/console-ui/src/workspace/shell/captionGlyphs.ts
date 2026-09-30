/**
 * Windows caption-button glyphs.
 *
 * The desktop shell draws its own title bar (`frame: false`), so it renders
 * minimize / maximize / restore / close caption buttons natively.
 *
 * These are single-path vector glyphs on a 10x10 grid with a 1px stroke,
 * matching native OS caption control dimensions and weights.
 * They are declared as data so the four shapes can be asserted to be distinct.
 */
export type CaptionGlyphName = "minimize" | "maximize" | "restore" | "close";

/**
 * The four names the shared `Icon` map uses for window chrome, and their glyph.
 *
 * Declared here rather than in `ui.tsx` so the mapping is testable without a DOM
 * or a React runtime — the regression this guards (restore rendering the
 * maximize square) lived in the mapping, not in the path data.
 */
const CAPTION_ICON_GLYPHS = {
  windowMinimize: "minimize",
  windowMaximize: "maximize",
  windowRestore: "restore",
  windowClose: "close"
} as const satisfies Record<string, CaptionGlyphName>;

export type CaptionIconName = keyof typeof CAPTION_ICON_GLYPHS;

export function isCaptionIcon(name: string): name is CaptionIconName {
  return Object.prototype.hasOwnProperty.call(CAPTION_ICON_GLYPHS, name);
}

export function captionGlyphFor(name: CaptionIconName): CaptionGlyphName {
  return CAPTION_ICON_GLYPHS[name];
}

export const CAPTION_GLYPHS: Record<CaptionGlyphName, string> = {
  /** A single hairline on the vertical centre. */
  minimize: "M0.5 5H9.5",
  /** One square filling the grid. */
  maximize: "M0.5 0.5H9.5V9.5H0.5Z",
  /** Two offset squares: the restored-down state. The back window is only its
   *  top and right edges, so the front square reads as being in front of it. */
  restore: "M2.5 0.5H9.5V7.5M0.5 2.5H7.5V9.5H0.5Z",
  /** The standard diagonal cross. */
  close: "M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5"
};
