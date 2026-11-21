import { describe, expect, it } from 'vitest';
import { getCreateLinkErrorKey } from '../../../src/utils/create-link.ts';

describe('getCreateLinkErrorKey', () => {
  it.each([
    ['a taken name', { runtimeException: true, type: 'file', alreadyExists: true }, 'fs.name_taken'],
    ['a readonly folder behind a link', { readonlyLinkTarget: true }, 'fs.create_link_error_readonly'],
    ['a not linkable folder', { notLinkableFolder: true }, 'fs.create_link_error_not_allowed'],
    ['a not linkable file', { notLinkableFile: true }, 'fs.create_link_error_not_allowed'],
    // core: ensureLinkingAllowedTo (xsp-fs) and DeviceFS.link
    [
      'a target of another storage',
      new Error('Cannot create link to device from synced storage.'),
      'fs.create_link_error_not_allowed',
    ],
    [
      'the same as a string',
      'Cannot create link to share from device storage.',
      'fs.create_link_error_not_allowed',
    ],
    ['anything else', new Error('boom'), 'fs.create_link_error'],
    ['nothing', undefined, 'fs.create_link_error'],
  ])('%s', (_name, err, key) => {
    expect(getCreateLinkErrorKey(err)).toBe(key);
  });
});
