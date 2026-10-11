export function prepareFolderPath(paths: Array<string | undefined> = []): string {
  return paths.reduce((res: string, item) => {
    if (item) {
      res = res ? `${res}/${item}` : item;
    }

    return res;
  }, '');
}

export async function getFileArray(file: File): Promise<Uint8Array | undefined | null> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => {
      if (!ev.target) {
        resolve(null);
      }
      const bytes = ev.target!.result;
      if (!bytes) {
        resolve(null);
      }

      resolve(new Uint8Array(bytes as ArrayBuffer));
    };
    reader.onerror = err => {
      reject(err);
    };
    reader.readAsArrayBuffer(file);
  });
}

export function transformStringToURI(val: string): string {
  return encodeURI(val);
}

export function transformURIToString(val: string): string {
  return decodeURI(val);
}
