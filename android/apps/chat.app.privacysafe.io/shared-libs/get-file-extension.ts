export function getFileExtension(fullName = ''): string {
  const dotCharIndex = fullName.split('').findLastIndex((c: string) => c === '.');
  return dotCharIndex > -1 ? fullName.slice(dotCharIndex + 1).toLowerCase() : '';
}
