type Observer<T> = web3n.Observer<T>;

export function streamFrom<T>(
  startWatching: (obs: Observer<T>) => (() => void),
): ReadableStream<T> {
  let unsub: () => void;

  return new ReadableStream<T>({
    start(ctrl) {
      unsub = startWatching({
        next: v => ctrl.enqueue(v),
        complete: () => ctrl.close(),
        error: err => ctrl.error(err),
      });
    },
    cancel: () => unsub(),
  });
}

export function map<I, O>(fn: (v: I) => O): TransformStream<I, O> {
  return new TransformStream<I, O>({
    transform: (v, ctrl) => ctrl.enqueue(fn(v)),
  });
}

export function filter<T>(predicate: (v: T) => boolean): TransformStream<T, T> {
  return new TransformStream<T, T>({
    transform: (v, ctrl) => {
      if (predicate(v)) {
        ctrl.enqueue(v);
      }
    },
  });
}

export function doWithEach<T>(fn: (v: T) => void): TransformStream<T, T> {
  return new TransformStream<T, T>({
    transform: (v, ctrl) => {
      try {
        fn(v);
      } catch (err) {
        w3n.log('error', JSON.stringify(err), err);
      }
      ctrl.enqueue(v);
    },
  });
}

export function doAndAwaitWithEach<T>(
  fn: (v: T) => Promise<void>,
): TransformStream<T, T> {
  return new TransformStream<T, T>({
    transform: async (v, ctrl) => {
      try {
        await fn(v);
      } catch (err) {
        w3n.log('error', JSON.stringify(err), err);
      }
      ctrl.enqueue(v);
    },
  });
}

export async function* readerToIterable<T>(
  reader: ReadableStreamDefaultReader<T>,
) {
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    } else {
      yield value;
    }
  }
}

