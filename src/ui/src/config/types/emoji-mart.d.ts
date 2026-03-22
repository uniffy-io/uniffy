declare module '@emoji-mart/react' {
  import { ComponentType } from 'react';
  interface PickerProps {
    data: unknown;
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
  }
  const Picker: ComponentType<PickerProps>;
  export default Picker;
}

declare module '@emoji-mart/data' {
  const data: unknown;
  export default data;
}
