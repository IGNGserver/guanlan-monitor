/** Web presentation is based on available space and input capabilities. */
export type WebLayoutPreference = "auto" | "touch" | "desktop";
export type WebPresentation = "desktop" | "phone" | "tablet";
export interface PresentationInput {
  width: number;
  height: number;
  screenShortSide: number;
  hasTouch: boolean;
  coarsePointer: boolean;
  userAgent: string;
  preference: WebLayoutPreference;
  native: boolean;
}
export function resolveWebPresentation(input: PresentationInput): WebPresentation {
  if (input.native || input.preference === "desktop") return "desktop";
  const phoneHint = /iphone|ipod|android.*mobile|windows phone/i.test(input.userAgent);
  const tabletHint = /ipad|tablet|android(?!.*mobile)/i.test(input.userAgent)
    || (/macintosh/i.test(input.userAgent) && (input.hasTouch || /mobile\//i.test(input.userAgent)));
  const useTouch = input.preference === "touch" || input.width < 840
    || input.coarsePointer || phoneHint || tabletHint;
  if (!useTouch) return "desktop";
  // A rotated phone keeps its navigation; a tablet in split-screen keeps its
  // identity, but its columns still depend on the *window* width below.
  if (phoneHint || (!tabletHint && input.screenShortSide < 600)) return "phone";
  const tabletScreen = input.screenShortSide >= 600 && (input.hasTouch || input.coarsePointer);
  return tabletHint || tabletScreen || input.width >= 600 ? "tablet" : "phone";
}
export function supportsTouchSplit(presentation: WebPresentation, width: number): boolean {
  return presentation === "tablet" && width >= 840;
}
