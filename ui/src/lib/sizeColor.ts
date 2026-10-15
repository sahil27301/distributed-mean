/**
 * Position of a partial on the 1 → F colour ramp, on a log scale.
 *
 * Merges multiply sizes (1, 5, 25, 125...), so a linear ramp would leave every partial but the
 * last few looking like a raw file. On a log scale each merge level is an even step darker.
 */
export function sizeShare(filesCovered: number, fileCount: number): number {
  if (fileCount <= 1) return 1;
  const share = Math.log(filesCovered) / Math.log(fileCount);
  return Math.min(1, Math.max(0, share));
}

export function sizeColor(filesCovered: number, fileCount: number): string {
  const pct = Math.round(sizeShare(filesCovered, fileCount) * 100);
  return `color-mix(in oklab, var(--size-hi) ${pct}%, var(--size-lo))`;
}

/** Light text once the chip is dark enough. */
export function sizeInk(filesCovered: number, fileCount: number): string {
  return sizeShare(filesCovered, fileCount) > 0.45 ? "var(--panel-raised)" : "var(--ink)";
}
