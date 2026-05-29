import { type ComponentProps } from 'react';
import data from '@emoji-mart/data';
import enI18n from '@emoji-mart/data/i18n/en.json';
import Picker from '@emoji-mart/react';

/**
 * emoji-mart falls back to fetching data, i18n, and emoji images from
 * cdn.jsdelivr.net when those props are missing. Project CSP blocks the
 * fetches at runtime, but it's cleaner to never attempt them. This wrapper
 * is the only place that mounts emoji-mart's Picker; pre-binding the
 * three CDN-prone props guarantees no jsdelivr request is reachable.
 */
type EmojiMartPickerProps = ComponentProps<typeof Picker>;

const STATIC_URL = '';

export function SafeEmojiPicker(props: Omit<EmojiMartPickerProps, 'data' | 'i18n'>) {
    return (
        <Picker
            data={data}
            i18n={enI18n}
            set="native"
            getImageURL={() => STATIC_URL}
            getSpritesheetURL={() => STATIC_URL}
            {...props}
        />
    );
}
