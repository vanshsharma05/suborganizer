import { describe, expect, it } from 'vitest';
import { estimateWidth, fitText } from './fit-text';

/** The narrowest phone worth designing for, minus the story's 30pt side padding. */
const SMALL = 320 - 60;
/** A common mid-size Android screen. */
const TYPICAL = 393 - 60;
const MAX = 68;

describe('fitText', () => {
  it('leaves a short figure at full size', () => {
    expect(fitText('₹4,820', TYPICAL, MAX)).toBe(MAX);
  });

  it('never returns more than the cap, however much room there is', () => {
    expect(fitText('₹9', 2000, MAX)).toBe(MAX);
  });

  it('shrinks a long figure rather than letting it run off', () => {
    expect(fitText('₹12,34,567', SMALL, MAX)).toBeLessThan(MAX);
  });

  it('stops shrinking at the floor, so a headline stays a headline', () => {
    expect(fitText('₹99,99,99,999', 100, MAX)).toBe(34);
  });

  it('is monotonic — a longer figure is never given a larger size', () => {
    const short = fitText('₹1,000', SMALL, MAX);
    const medium = fitText('₹1,20,000', SMALL, MAX);
    const long = fitText('₹12,34,567', SMALL, MAX);
    expect(short).toBeGreaterThanOrEqual(medium);
    expect(medium).toBeGreaterThanOrEqual(long);
  });

  it('survives degenerate inputs instead of returning something unusable', () => {
    expect(fitText('', TYPICAL, MAX)).toBe(MAX);
    expect(fitText('₹1', 0, MAX)).toBe(MAX);
    expect(fitText('₹1', -50, MAX)).toBe(MAX);
  });
});

/**
 * The point of the whole module. Each of these is a real annual total for
 * someone the app is meant to serve, and at the old fixed 68px the last digits
 * were cut off — so the number they were shown was not the number they have.
 */
describe('the figures that used to be clipped', () => {
  it.each([
    ['₹1,20,000', SMALL],
    ['₹1,20,000', TYPICAL],
    ['₹4,50,000', SMALL],
    ['₹12,34,567', SMALL],
    ['₹12,34,567', TYPICAL],
    ['$14,400', SMALL],
  ])('fits %s on a %ipt-wide slide', (text, available) => {
    const size = fitText(text, available, MAX);
    expect(estimateWidth(text, size)).toBeLessThanOrEqual(available);
  });

  it('would not have fitted at the old fixed size', () => {
    expect(estimateWidth('₹12,34,567', MAX)).toBeGreaterThan(SMALL);
  });
});
