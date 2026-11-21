import { describe, expect, it } from 'vitest';
import { getFsEntityTypeIcon, isLinkEntityType } from '../../../src/utils/fs-entity-type-icon.ts';

describe('getFsEntityTypeIcon', () => {
  it.each([
    ['folder', 'round-folder', false],
    ['link-folder', 'round-folder', true],
    ['file', 'round-subject', false],
    ['link-file', 'round-subject', true],
    ['link-broken', 'data-alert', true],
  ] as const)('%s gets %s, link: %s', (type, icon, isLink) => {
    expect(getFsEntityTypeIcon(type)).toBe(icon);
    expect(isLinkEntityType(type)).toBe(isLink);
  });
});
