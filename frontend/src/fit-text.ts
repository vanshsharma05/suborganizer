/**
 * Sizing text that is not allowed to wrap.
 *
 * The headline figures in the story are drawn into a TextInput, because that is
 * the only node whose contents a UI-thread worklet can write. A TextInput does
 * not wrap and does not shrink to fit — it clips. So an amount too wide for the
 * screen simply loses its last digits, silently, and looks like a smaller number
 * rather than a broken one.
 */

/** Below this, the figure has stopped being a headline. */
const FLOOR = 34;

/**
 * How wide a bold digit is as a fraction of its font size, and how much the
 * headline's negative tracking claws back per character.
 *
 * Measured for the weight and letter-spacing `bigAmount` uses. They are only
 * ever used to decide whether something fits, so being a shade pessimistic is
 * the safe direction to be wrong in.
 */
const ADVANCE = 0.58;
const TRACKING = 3;

/**
 * The largest size at or below `max` at which `text` still fits `available`.
 *
 * Never returns more than `max`, so a short figure keeps the size it was
 * designed at and only long ones give ground.
 */
export function fitText(text: string, available: number, max: number): number {
  if (text.length === 0 || available <= 0) return max;

  const ideal = (available / text.length + TRACKING) / ADVANCE;
  return Math.max(FLOOR, Math.min(max, Math.floor(ideal)));
}

/** What `fitText` thinks the rendered width of `text` would be at `size`. */
export function estimateWidth(text: string, size: number): number {
  return text.length * (size * ADVANCE - TRACKING);
}
