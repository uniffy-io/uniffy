export interface Theme {
  name: string;
  /** HSL triplet. */
  accentColor?: string;
  /** 'inter' | 'geist' | 'jakarta' | 'system' */
  fontFamily?: string;
}

/* Palettes live in index.css (:root and .dark); these only name the mode. */
export const defaultTheme: Theme = { name: "default" };

export const darkTheme: Theme = { name: "dark" };
