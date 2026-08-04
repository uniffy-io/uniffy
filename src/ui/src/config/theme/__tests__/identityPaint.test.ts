import { describe, expect, it } from 'vitest';
import { BRAND_AXIS_END, BRAND_AXIS_START, identityPaint, identityStops } from '@/config/theme/brandGradients';
import { getAvatarGradientStyle } from '@/components/subject/utils';

const NAMES = ['Ada Lovelace', 'Grace Hopper', 'anonymous', 'A', ''];

describe('identityPaint', () => {
  it('paints a peer cursor with the same gradient as their avatar', () => {
    for (const name of NAMES) {
      expect(getAvatarGradientStyle(name).background).toBe(identityPaint(name).gradient);
    }
  });

  it('is stable for a given name', () => {
    expect(identityPaint('Ada Lovelace')).toEqual(identityPaint('Ada Lovelace'));
  });

  it('keeps every stop on the brand violet-pink axis', () => {
    const axis = new Set([
      BRAND_AXIS_START,
      BRAND_AXIS_END,
      '#8e57fa',
      '#b364f4',
      '#d871ef',
      '#543bcc',
    ]);
    for (const name of NAMES) {
      const { start, end } = identityStops(name);
      expect(axis.has(start)).toBe(true);
      expect(axis.has(end)).toBe(true);
    }
  });

  it('builds a selection wash from the caret color', () => {
    const paint = identityPaint('Grace Hopper');
    expect(paint.translucent.startsWith(paint.solid)).toBe(true);
    expect(paint.translucent).toHaveLength(9);
  });
});
