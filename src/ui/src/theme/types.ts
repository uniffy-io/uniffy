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
}

export const defaultTheme: Theme = {
  name: 'default',
  colors: {
    primary: '221.2 83.2% 53.3%', // hsl(221.2, 83.2%, 53.3%) - Blue 600
    primaryForeground: '210 40% 98%', // White-ish
    background: '0 0% 100%', // White
    foreground: '222.2 84% 4.9%', // Dark
    muted: '210 40% 96.1%',
    mutedForeground: '215.4 16.3% 46.9%',
    card: '0 0% 100%', // White
    cardForeground: '222.2 84% 4.9%',
    border: '214.3 31.8% 91.4%',
    input: '214.3 31.8% 91.4%',
    ring: '221.2 83.2% 53.3%',
  },
};

export const darkTheme: Theme = {
  name: 'dark',
  colors: {
    primary: '217.2 91.2% 59.8%', // Blue 500
    primaryForeground: '222.2 47.4% 11.2%',
    background: '222.2 84% 4.9%',
    foreground: '210 40% 98%',
    muted: '217.2 32.6% 17.5%',
    mutedForeground: '215 20.2% 65.1%',
    card: '222.2 84% 4.9%', // Dark background
    cardForeground: '210 40% 98%',
    border: '217.2 32.6% 17.5%',
    input: '217.2 32.6% 17.5%',
    ring: '224.3 76.3% 48%',
  },
};
