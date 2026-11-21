const possibleCharacters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function randomStr(numOfChars: number): string {
  if (numOfChars < 1) {
    throw new Error(`number of chars is less than one`);
  }
  const array = randomBytes(numOfChars);
  let result = '';
  for (let i = 0; i < array.length; i++) {
    result += possibleCharacters.charAt(array[i] % 62);
  }
  return result;
}

export function randomBytes(numOfBytes: number): Uint8Array {
  if ((globalThis as Partial<typeof globalThis>).crypto?.getRandomValues) {
    const bytes = new Uint8Array(numOfBytes);
    crypto.getRandomValues(bytes);
    return bytes;
  } else {
    console.warn(`Using math to get random value, in when crypto is missing.`);
    const numOfRandU32s = Math.floor(numOfBytes / 4) + (numOfBytes % 4 > 0 ? 1 : 0);
    const u32s = new Uint32Array(numOfRandU32s);
    for (let i = 0; i < u32s.length; i += 1) {
      u32s[i] = Math.floor(0xffffffff * Math.random());
    }
    const u8s = new Uint8Array(u32s.buffer);
    return u8s.length > numOfBytes ? u8s.slice(0, numOfBytes) : u8s;
  }
}
