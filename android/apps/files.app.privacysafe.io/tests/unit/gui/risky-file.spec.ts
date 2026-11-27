import { describe, expect, it } from 'vitest';
import { isRiskyFileName } from '../../../src/utils/risky-file.ts';

// Security audit 2026-11: any file, synced from another device or shared by another person,
// went to the OS default handler on a double click without a word.
describe('isRiskyFileName', () => {
  it.each(['setup.exe', 'run.sh', 'page.HTML', 'icon.svg', 'Tool.app', 'x.command', 'a.desktop', 'invoice.pdf.js'])(
    'flags %j',
    name => {
      expect(isRiskyFileName(name)).toBe(true);
    },
  );

  it.each(['invoice‮fdp.exe', 'report‮fdp.txt', 'setup.exe.', 'setup.exe  '])(
    'flags the disguised %j',
    name => {
      expect(isRiskyFileName(name)).toBe(true);
    },
  );

  it.each(['report.pdf', 'photo.jpeg', 'notes.txt', 'archive.zip', 'README', '', undefined])('passes %j', name => {
    expect(isRiskyFileName(name)).toBe(false);
  });
});
