export interface Theme {
  name: string;
  colors: {
    primary: string;
    primaryForeground: string;
    background: string;
    foreground: string;
    muted: string;
    mutedForeground: string;
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
    primary: '217 91% 50%', // Blue
    primaryForeground: '210 40% 98%', // White-ish
    background: '0 0% 100%', // White
    foreground: '222.2 84% 4.9%', // Dark
    muted: '220 14.3% 93%', // Slightly darker for visibility
    mutedForeground: '220 8.9% 40%', // Darker for better readability
    card: '0 0% 100%', // White
    cardForeground: '222.2 84% 4.9%',
    border: '220 13% 82%', // Darker for visible borders
    input: '220 13% 82%', // Match border
    ring: '217 91% 50%',
  },
};

export const darkTheme: Theme = {
  name: 'dark',
  colors: {
    primary: '217 91% 60%',
    primaryForeground: '222.2 47.4% 11.2%',
    background: '228 16% 8%',
    foreground: '220 14% 95%',
    muted: '228 10% 16%',
    mutedForeground: '225 10% 64%',
    card: '228 12% 12%',
    cardForeground: '220 14% 95%',
    border: '228 10% 21%',
    input: '228 12% 10%',
    ring: '217 91% 55%',
  },
};
