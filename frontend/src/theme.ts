// Global theme tokens for SubOrganizer
export const theme = {
  color: {
    surface: '#FDFBF7',
    onSurface: '#1A1C1E',
    surfaceSecondary: '#F4EFE6',
    onSurfaceSecondary: '#4A4C4A',
    surfaceTertiary: '#EAE4D9',
    ink: '#1A1C1E',
    inkSoft: '#4A4C4A',
    inkMuted: '#8A867F',
    brand: '#E87A5D',
    brandPrimary: '#D36043',
    brandDeep: '#B84A32',
    onBrand: '#FFFFFF',
    brandSecondary: '#0D9488',
    brandSecondaryDeep: '#0B7A70',
    brandTertiary: '#FAD7C8',
    gold: '#C9A34A',
    success: '#059669',
    warning: '#D97706',
    error: '#DC2626',
    border: '#EAE4D9',
    borderStrong: '#D1C9B9',
    // gradients
    heroGradient: ['#FDD6BE', '#F4A28C', '#E87A5D'] as const,
    tealGradient: ['#0D9488', '#059669'] as const,
    coralGradient: ['#F4A28C', '#E87A5D', '#D36043'] as const,
    proGradient: ['#1A1C1E', '#2F3A3A', '#0D9488'] as const,
    scrim: ['transparent', 'rgba(253,251,247,0.85)', '#FDFBF7'] as const,
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 6, md: 12, lg: 20, xl: 28, pill: 999 },
  font: {
    // System font — using explicit weights + letter spacing for architectural feel
    display: { fontWeight: '800' as const, letterSpacing: -0.8 },
    displayBig: { fontWeight: '800' as const, letterSpacing: -1.2 },
    heading: { fontWeight: '700' as const, letterSpacing: -0.4 },
    body: { fontWeight: '500' as const, letterSpacing: 0 },
    label: { fontWeight: '600' as const, letterSpacing: 0.4, textTransform: 'uppercase' as const },
  },
};

/**
 * Bundled, not hotlinked. This background is behind both the login screen and
 * the dashboard hero, so fetching it from a CDN meant the app's first
 * impression depended on someone else's uptime and showed a blank panel to
 * anyone opening it offline.
 */
export const IMAGES = {
  heroMesh: require('../assets/images/hero-mesh.jpg'),
};

export const CATEGORIES = [
  'Entertainment', 'Music', 'Productivity', 'Shopping', 'Storage',
  'News', 'Education', 'Fitness', 'Utilities', 'Other',
];

export const CATEGORY_COLORS: Record<string, string> = {
  Entertainment: '#E87A5D',
  Music: '#0D9488',
  Productivity: '#C9A34A',
  Shopping: '#F4A28C',
  Storage: '#4A4C4A',
  News: '#B84A32',
  Education: '#059669',
  Fitness: '#D97706',
  Utilities: '#8A867F',
  Other: '#D1C9B9',
};
