export interface Theme {
  name: string;
  colors: {
    primary: string;
    primaryForeground: string;
    background: string;
    foreground: string;
    muted: string;
    mutedForeground: string;
    accent: string;
    accentForeground: string;
    card: string;
    cardForeground: string;
    border: string;
    input: string;
    ring: string;
  };
  /** HSL triplet. */
  accentColor?: string;
  /** 'inter' | 'geist' | 'system' */
  fontFamily?: string;
}

export const defaultTheme: Theme = {
  name: 'default',
  colors: {
    primary: '250 100% 64.5%',
    primaryForeground: '210 40% 98%',
    background: '0 0% 94.9%',
    foreground: '0 0% 11%',
    muted: '0 0% 92%',
    mutedForeground: '0 0% 42%',
    accent: '0 0% 93%',
    accentForeground: '0 0% 11%',
    card: '0 0% 98%',
    cardForeground: '0 0% 11%',
    border: '0 0% 85%',
    input: '0 0% 91%',
    ring: '250 100% 64.5%',
  },
};

export const darkTheme: Theme = {
  name: 'dark',
  colors: {
    primary: '250 100% 64.5%',
    primaryForeground: '210 40% 98%',
    background: '223.3 40.9% 8.6%',
    foreground: '210 29% 93%',
    muted: '215 18% 16%',
    mutedForeground: '215 10% 65%',
    accent: '215 20% 14%',
    accentForeground: '210 29% 93%',
    card: '214 25% 11%',
    cardForeground: '210 29% 93%',
    border: '212 12% 21%',
    input: '215 25% 9%',
    ring: '250 100% 64.5%',
  },
};
