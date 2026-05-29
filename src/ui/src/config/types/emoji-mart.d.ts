declare module '@emoji-mart/react' {
  import { ComponentType } from 'react';
  interface PickerProps {
    data: unknown;
    i18n?: unknown;
    onEmojiSelect: (emoji: { native: string; id: string; name: string }) => void;
    theme?: 'light' | 'dark' | 'auto';
    previewPosition?: 'top' | 'bottom' | 'none';
    skinTonePosition?: 'preview' | 'search' | 'none';
    perLine?: number;
    maxFrequentRows?: number;
    navPosition?: 'top' | 'bottom' | 'none';
    set?: 'native' | 'apple' | 'google' | 'twitter' | 'facebook';
    locale?: string;
    autoFocus?: boolean;
    getImageURL?: (set: string, unified: string) => string;
    getSpritesheetURL?: (set: string) => string;
  }
  const Picker: ComponentType<PickerProps>;
  export default Picker;
}

declare module '@emoji-mart/data' {
  const data: unknown;
  export default data;
}

declare module '@emoji-mart/data/i18n/en.json' {
  const en: unknown;
  export default en;
}
