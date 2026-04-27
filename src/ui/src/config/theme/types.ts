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
  accentColor?: string; // Optional custom accent color in HSL format
  fontFamily?: string; // Optional custom font: 'inter', 'geist', 'system'
}

export const defaultTheme: Theme = {
  name: 'default',
  colors: {
    primary: '217 91% 50%',
    primaryForeground: '210 40% 98%',
    background: '220 20% 99%',
    foreground: '222 47% 11%',
    muted: '220 14% 93%',
    mutedForeground: '220 10% 42%',
    accent: '220 14% 94%',
    accentForeground: '222 47% 11%',
    card: '220 16% 96%',
    cardForeground: '222 47% 11%',
    border: '220 12% 86%',
    input: '220 14% 91%',
    ring: '217 91% 50%',
  },
};

export const darkTheme: Theme = {
  name: 'dark',
  colors: {
    primary: '217 91% 60%',
    primaryForeground: '210 40% 98%',
    background: '215 28% 7%',
    foreground: '210 29% 93%',
    muted: '215 18% 16%',
    mutedForeground: '215 10% 65%',
    accent: '215 20% 14%',
    accentForeground: '210 29% 93%',
    card: '214 25% 11%',
    cardForeground: '210 29% 93%',
    border: '212 12% 21%',
    input: '215 25% 9%',
    ring: '217 91% 58%',
  },
};
