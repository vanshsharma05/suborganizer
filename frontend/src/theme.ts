/**
 * Design tokens.
 *
 * The palette stays warm — near-white paper rather than the cold grey every
 * other finance app uses, and a coral that matches the launcher icon. What
 * changed is everything around it. Three rules the whole system follows now:
 *
 *   Depth comes from shadow, not outline. A 1px border around every card is the
 *   single strongest tell of a dated interface; it flattens the screen into a
 *   form. Cards sit on the page and cast a soft, wide, low-opacity shadow, so
 *   hierarchy is read rather than drawn.
 *
 *   One accent, used rarely. Coral means money and action, and nothing else. A
 *   screen where six things are coloured has nothing to draw the eye to, so
 *   surfaces are paper and ink, and the accent is spent on the one thing that
 *   matters on that screen.
 *
 *   Type does the work. A real scale with tight tracking on the large end —
 *   display figures are set at -3 letter-spacing, which is what makes a number
 *   look designed rather than printed.
 */

export const theme = {
  color: {
    // Surfaces, lightest to deepest. `raised` is what cards are; it lifts off
    // `surface` by a hair and lets the shadow do the rest.
    surface: '#FCFAF7',
    raised: '#FFFFFF',
    surfaceSecondary: '#F5F1EA',
    surfaceTertiary: '#EBE5DA',
    /** For inverted panels — the one dark thing on a light screen. */
    inverse: '#16181A',

    // Ink. Deepened for contrast; the old #1A1C1E on cream was under 12:1.
    ink: '#131518',
    inkSoft: '#54565A',
    /**
     * Secondary text — subtitles, meta rows, captions. 64 places use it.
     *
     * Was #8E8B85, which is 3.40:1 on white and 3.26:1 on the page. Both are
     * under the 4.5:1 that normal-size text needs, and most of what wears this
     * colour is 11–13pt, so none of it qualified for the large-text exemption.
     *
     * #706D67 is the same warm grey, deepened until it clears 4.5:1 on every
     * ground that actually carries text — white, the page, and the secondary
     * fill. surfaceTertiary is excluded on purpose: it is a grabber handle and a
     * 3px progress track, and solving for it would have forced this to #67645E,
     * close enough to inkSoft to collapse the two into one step.
     */
    inkMuted: '#706D67',
    /** Decoration only — chevrons, out-of-month dates. Never text. */
    inkFaint: '#B5B1A9',
    onInverse: '#FCFAF7',

    brand: '#E87A5D',
    brandPrimary: '#D36043',
    brandDeep: '#B84A32',
    brandTint: '#FCEEE8',
    onBrand: '#FFFFFF',

    brandSecondary: '#0D9488',
    brandSecondaryDeep: '#0B7A70',
    brandSecondaryTint: '#E3F5F2',

    /**
     * The Pro marker, and nothing else.
     *
     * Was #C9A34A, which is 2.28:1 on the page — it fails as text by a wide
     * margin, and profile.tsx sets the word "PRO" in it at 10pt. #836423 clears
     * 4.5:1 on every ground text sits on. It reads as antique gold rather than
     * the lighter leaf it was; `goldGradient` is untouched, so the decorative
     * use is unchanged.
     */
    gold: '#836423',
    success: '#0A8754',
    successTint: '#E4F4EC',
    warning: '#C77A08',
    warningTint: '#FDF0DC',
    error: '#CC2E27',
    errorTint: '#FCEAE8',

    border: '#EDE7DC',
    borderStrong: '#D9D2C4',

    coralGradient: ['#F4A28C', '#E87A5D', '#D36043'] as const,
    tealGradient: ['#14B8A6', '#0D9488', '#0B7A70'] as const,
    inkGradient: ['#2A2D31', '#16181A'] as const,
    goldGradient: ['#E3C77F', '#C9A34A'] as const,
    scrim: ['transparent', 'rgba(252,250,247,0.9)', '#FCFAF7'] as const,
  },

  /** 4pt grid. Anything not on it is a mistake, not a decision. */
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },

  radius: { sm: 8, md: 14, lg: 20, xl: 28, xxl: 36, pill: 999 },

  /**
   * Elevation.
   *
   * Wide and faint rather than tight and dark — a large blur at low opacity
   * reads as light falling on a raised surface, while a small dense shadow reads
   * as a sticker pasted on top. `elevation` is Android's own; it has to be set
   * alongside the iOS fields or cards render flat there.
   */
  shadow: {
    sm: {
      shadowColor: '#3A2A20', shadowOpacity: 0.05, shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 }, elevation: 1,
    },
    md: {
      shadowColor: '#3A2A20', shadowOpacity: 0.07, shadowRadius: 18,
      shadowOffset: { width: 0, height: 6 }, elevation: 3,
    },
    lg: {
      shadowColor: '#3A2A20', shadowOpacity: 0.1, shadowRadius: 32,
      shadowOffset: { width: 0, height: 14 }, elevation: 8,
    },
    /** For anything coral — a warm shadow under a warm surface. */
    brand: {
      shadowColor: '#B84A32', shadowOpacity: 0.28, shadowRadius: 20,
      shadowOffset: { width: 0, height: 10 }, elevation: 6,
    },
  },

  /**
   * Type scale.
   *
   * Tracking tightens as size grows, which is how large text avoids looking
   * like stretched body copy. `display` is for figures only.
   */
  type: {
    display: { fontSize: 52, fontWeight: '800' as const, letterSpacing: -2.4, lineHeight: 56 },
    title1: { fontSize: 34, fontWeight: '800' as const, letterSpacing: -1.2, lineHeight: 40 },
    title2: { fontSize: 26, fontWeight: '800' as const, letterSpacing: -0.8, lineHeight: 32 },
    title3: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.4, lineHeight: 26 },
    body: { fontSize: 15, fontWeight: '500' as const, letterSpacing: -0.1, lineHeight: 22 },
    bodyStrong: { fontSize: 15, fontWeight: '700' as const, letterSpacing: -0.2, lineHeight: 22 },
    small: { fontSize: 13, fontWeight: '600' as const, letterSpacing: -0.05, lineHeight: 18 },
    caption: { fontSize: 11.5, fontWeight: '600' as const, letterSpacing: 0, lineHeight: 16 },
    /** Uppercase section markers. The only place letter-spacing goes positive. */
    overline: {
      fontSize: 10.5, fontWeight: '800' as const, letterSpacing: 1.1,
      lineHeight: 14, textTransform: 'uppercase' as const,
    },
  },

  /**
   * Motion.
   *
   * One spring for anything that responds to a finger, one for anything that
   * arrives on its own. Reusing two curves everywhere is most of what makes an
   * interface feel like a single piece of software rather than a pile of screens.
   */
  motion: {
    /**
     * Snappy, barely any overshoot. Presses, toggles, chips.
     *
     * Damping was 18, which is a ratio of 0.57 — an 11.5% overshoot and 267ms to
     * settle. That is a rubbery bounce, not the "barely any" this line claimed.
     * At 25 the ratio is 0.79: overshoot drops to under 2% and it settles in
     * ~190ms, so it is both calmer and faster. A finger-follow that visibly
     * springs past its target reads as toy-like, and it is the one curve every
     * tap in the app goes through.
     */
    press: { damping: 25, stiffness: 420, mass: 0.6 },
    /** Softer, visible settle. Entrances, sheets, layout shifts. */
    enter: { damping: 20, stiffness: 180, mass: 0.9 },
    /** For anything crossing the whole screen. */
    travel: { damping: 24, stiffness: 120, mass: 1 },
    duration: { fast: 160, base: 280, slow: 480, count: 1200 },
    /**
     * Delay between items in a staggered list.
     *
     * Was 55, which Reveal caps at ten items — 550ms of cascade before the last
     * card even begins, and another ~360 for the enter spring to settle. On the
     * dashboard's "Coming up" row that meant the tail was still arriving a full
     * second in, which reads as the screen struggling rather than as
     * choreography.
     *
     * At 28 the same row is complete in about three quarters of that. The point
     * of a stagger is to give the eye an order to read in, and it only needs to
     * be perceptible — past roughly 30ms it stops being rhythm and starts being
     * waiting. Only four call sites pass `index`, so this moves those lists and
     * nothing else.
     */
    stagger: 28,
  },
};

export const CATEGORIES = [
  'Entertainment', 'Music', 'Productivity', 'Shopping', 'Storage',
  'News', 'Education', 'Fitness', 'Utilities', 'Other',
];

/**
 * One hue per category, tuned to sit together in a chart.
 *
 * Picked for even spacing around the wheel at similar chroma, so no single bar
 * jumps out purely by being brighter than its neighbours.
 */
export const CATEGORY_COLORS: Record<string, string> = {
  Entertainment: '#E8654A',
  Music: '#0D9488',
  Productivity: '#C9A34A',
  Shopping: '#E08CA8',
  Storage: '#6B7A8F',
  News: '#B84A32',
  Education: '#3F8F5B',
  Fitness: '#D97706',
  Utilities: '#8E8B85',
  Other: '#B5B1A9',
};
