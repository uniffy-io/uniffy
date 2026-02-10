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
    primary: '221.2 83.2% 53.3%', // hsl(221.2, 83.2%, 53.3%) - Blue 600
    primaryForeground: '210 40% 98%', // White-ish
    background: '0 0% 100%', // White
    foreground: '222.2 84% 4.9%', // Dark
    muted: '220 14.3% 93%', // Slightly darker for visibility
    mutedForeground: '220 8.9% 40%', // Darker for better readability
    card: '0 0% 100%', // White
    cardForeground: '222.2 84% 4.9%',
    border: '220 13% 82%', // Darker for visible borders
    input: '220 13% 82%', // Match border
    ring: '221.2 83.2% 53.3%',
  },
};

export const darkTheme: Theme = {
  name: 'dark',
  colors: {
    primary: '217.2 91.2% 59.8%',
    primaryForeground: '222.2 47.4% 11.2%',
    background: '228 16% 8%',
    foreground: '220 14% 95%',
    muted: '228 10% 16%',
    mutedForeground: '225 10% 64%',
    card: '228 12% 12%',
    cardForeground: '220 14% 95%',
    border: '228 10% 21%',
    input: '228 12% 10%',
    ring: '224.3 76.3% 48%',
  },
};
