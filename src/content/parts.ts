/** Educational content for one tappable part of a model. */
export interface PartInfo {
  key: string;
  name: string;
  /** Grey shade matching the part's material on the (greyscale) model. */
  color: string;
  summary: string;
  fact: string;
}

/**
 * Mesh names map to content by their prefix before the first `_`:
 * a mesh named `PulmonaryArtery_Left` belongs to the `PulmonaryArtery` part.
 */
export function partKeyFromMeshName(name: string): string {
  return name.split('_')[0];
}
