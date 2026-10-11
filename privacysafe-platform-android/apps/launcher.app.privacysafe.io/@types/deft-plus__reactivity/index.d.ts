declare module 'jsr:@deft-plus/reactivity' {
  /**
   * Represents a base signal function. Which in essence is a function that returns a value.
   *
   * @template T - The type of the value returned by the signal.
   */
  export type BaseSignal<T = unknown> = () => T;

  /** Different types of signals. */
  export type SignalType = 'writable' | 'readonly' | 'memoized';

  /**
   * Adds the signal symbol to the given type.
   *
   * @template T - The type to add the signal symbol to.
   */
  export interface WithSignalSymbol<T> extends BaseSignal<T> {
    /**
     * Symbol to identify signal type ({@link SignalType}).
     * @internal
     */
    [SIGNAL]: SignalType;
  }

  /**
   * A signal that can be read but not updated.
   *
   * @template T - The type of the value returned by the signal.
   */
  export interface ReadonlySignal<T = unknown> extends WithSignalSymbol<T> {
    /** Named of the signal (Useful when the name is not set). */
    identifier: string;
    /**
     * Get the value without creating a dependency.
     *
     * @returns The current value without creating a dependency.
     */
    untracked(): T;
  }

  /**
   * A signal that can be changed.
   *
   * @template T - The type of the value returned by the signal.
   */
  export interface WritableSignal<T = unknown> extends ReadonlySignal<T> {
    /**
     * Set a new value and notify dependents.
     *
     * @param value - New value to set.
     */
    set(value: T): void;
    /**
     * Update the value based on the current value and notify dependents.
     *
     * @param updateFn - Function to update the value.
     */
    update(updateFn: (value: T) => T): void;
    /**
     * Modify the current value in-place and notify dependents.
     *
     * @param mutatorFn - Function to mutate the value.
     */
    mutate(mutatorFn: (value: T) => void): void;
    /**
     * Get a read-only version of this signal.
     *
     * @returns A read-only signal {@linkcode ReadonlySignal}.
     */
    readonly(): ReadonlySignal<T>;
  }

  /**
   * A writable signal that can be disposed of.
   *
   * @template T - The type of the value returned by the signal.
   */
  export interface WritableEventSignal<T = unknown> extends WritableSignal<T> {
    /** Dispose of the signal and clean up all event listeners. */
    [Symbol.dispose]: () => void;
  }

  /**
   * A memoized signal that computes the value based on dependencies.
   *
   * @template T - The type of the value returned by the signal.
   */
  export interface MemoizedSignal<T = unknown> extends ReadonlySignal<T> {}

  /**
   * Union with both the read-only ({@link ReadonlySignal}) and writable signal
   * ({@link WritableSignal}).
   *
   * @template T - The type of the value returned by the signal.
   */
  export type Signal<T = unknown> = ReadonlySignal<T> | WritableSignal<T> | MemoizedSignal<T>;

  /**
   * Options for creating a signal of the given type.
   *
   * @template T - The type of the value returned by the signal.
   */
  export interface SignalOptions<T> {
    /** Identifier for the signal. Useful for debugging, update with events and testing. */
    name?: string;
    /** Whether to log the signal's changes (Defaults to `false`). */
    log?: boolean;
    /**
     * Function to check if two signal values are equal (Defaults to the built-in equality check
     * {@link defaultEquals}).
     *
     * @param a - First value to compare.
     * @param b - Second value to compare.
     * @returns `true` if the values are equal, `false` otherwise.
     */
    equal?: (a: T, b: T) => boolean;
    /**
     * Function to call after the signal value changes.
     *
     * @param newValue - New value of the signal.
     */
    subscribe?: (newValue: T, oldValue: T) => void;
  }

  /**
   * Options for creating a signal that can listen for events.
   *
   * @template T - The type of the value returned by the signal.
   */
  export interface SignalEventOptions<T> extends SignalOptions<T> {
    /** Whether to allow events to be dispatched (Defaults to `false`). */
    allowEvents: true;
    /** Function to call when the signal is disposed. */
    onDispose?: () => void;
  }

  /**
   * Options for creating a memoized signal.
   *
   * @template T - The type of the value returned by the signal.
   */
  export interface MemoizedSignalOptions<T> extends SignalOptions<T> {
    // Empty for now but could be extended in the future.
  }

  /**
   * Represents a node in the reactive graph. Nodes can act as producers, consumers, or both.
   */
  export abstract class ReactiveNode {
    /** Counter for generating unique IDs for producers and consumers. */
    private static nextId = 0;

    /** The currently active reactive consumer, or `null` if none. */
    private static activeConsumer: ReactiveNode | null = null;

    /** Whether change notifications are currently being propagated. */
    private static notifying = false;

    /** Unique identifier for this node. */
    private readonly id = ReactiveNode.nextId++;

    /** Weak reference to this node, used in dependencies. */
    private readonly ref = new WeakRef(this);

    /** Dependencies of this node as a producer. */
    private readonly producers = new Map<number, Dependency>();

    /** Dependencies of this node as a consumer. */
    private readonly consumers = new Map<number, Dependency>();

    /** Version of the consumer's dependencies. */
    protected trackingVersion = 0;

    /** Version of the producer's value. */
    protected valueVersion = 0;

    /** Whether this consumer has any producers. */
    protected get hasProducers(): boolean {
      return this.producers.size > 0;
    }

    /**
     * Sets the active reactive consumer and returns the previous one.
     *
     * @param consumer - The new reactive consumer ({@link ReactiveNode}) or `null`.
     * @returns The previous reactive consumer ({@link ReactiveNode}) or `null` if none.
     * @internal
     */
    public static setActiveConsumer(consumer: ReactiveNode | null): ReactiveNode | null {
      const previous = ReactiveNode.activeConsumer;
      ReactiveNode.activeConsumer = consumer;
      return previous;
    }

    /** Called when a dependency may have changed. */
    protected abstract onDependencyChange(): void;

    /** Called when a consumer checks if the producer's value has changed. */
    protected abstract onProducerMayChanged(): void;

    /**
     * Checks if any of this node's dependencies have actually changed.
     *
     * @returns `true` if any dependencies have changed, `false` otherwise.
     */
    protected haveDependenciesChanged(): boolean {
      for (const [producerId, dependency] of this.producers) {
        const producer = dependency.producerRef.deref();

        if (producer === undefined || dependency.consumerVersion !== this.trackingVersion) {
          // Dependency is stale; remove it.
          this.producers.delete(producerId);
          producer?.consumers.delete(this.id);
          continue;
        }

        if (producer.haveValueChanged(dependency.producerVersion)) {
          return true;
        }
      }

      return false;
    }

    /** Notifies consumers that this producer's value may have changed. */
    protected notifyConsumers(): void {
      const wasNotifying = ReactiveNode.notifying;
      ReactiveNode.notifying = true;
      try {
        for (const [consumerId, dependency] of this.consumers) {
          const consumer = dependency.consumerRef.deref();
          if (consumer === undefined || consumer.trackingVersion !== dependency.consumerVersion) {
            this.consumers.delete(consumerId);
            consumer?.producers.delete(this.id);
            continue;
          }

          consumer.onDependencyChange();
        }
      } finally {
        ReactiveNode.notifying = wasNotifying;
      }
    }

    /** Records that this producer node was accessed in the current context. */
    protected recordAccess(): void {
      if (ReactiveNode.notifying) {
        throw new Error('Cannot read signals during notification phase.');
      }

      if (ReactiveNode.activeConsumer === null) {
        return;
      }

      let dependency = ReactiveNode.activeConsumer.producers.get(this.id);
      if (dependency === undefined) {
        dependency = {
          consumerRef: ReactiveNode.activeConsumer.ref,
          producerRef: this.ref,
          producerVersion: this.valueVersion,
          consumerVersion: ReactiveNode.activeConsumer.trackingVersion,
        };
        ReactiveNode.activeConsumer.producers.set(this.id, dependency);
        this.consumers.set(ReactiveNode.activeConsumer.id, dependency);
      } else {
        dependency.producerVersion = this.valueVersion;
        dependency.consumerVersion = ReactiveNode.activeConsumer.trackingVersion;
      }
    }

    /**
     * Checks if the producer's value has changed compared to the last recorded version.
     *
     * @param lastSeenVersion - The last version of the value seen by the consumer.
     * @returns `true` if the value has changed, `false` otherwise.
     */
    private haveValueChanged(lastSeenVersion: number): boolean {
      if (this.valueVersion !== lastSeenVersion) {
        return true;
      }

      this.onProducerMayChanged();
      return this.valueVersion !== lastSeenVersion;
    }

    /**
     * Logs the change of value for debugging purposes.
     *
     * @param config - Configuration for logging the change.
     */
    protected log(config: LogConfig): void {
      const { type, name, newValue, oldValue } = config;

      // Rule disabled because this is a debugging method.
      // deno-lint-ignore no-console
      console.log(`[${type}: ${name}]`);
      // deno-lint-ignore no-console
      console.log(`  New value:`, JSON.stringify(newValue));
      // deno-lint-ignore no-console
      console.log(`  Old value:`, JSON.stringify(oldValue));
    }
  }

  /** Representation of a dependency between a producer and a consumer. */
  interface Dependency {
    /** Reference to the producer node. */
    readonly producerRef: WeakRef<ReactiveNode>;
    /** Reference to the consumer node. */
    readonly consumerRef: WeakRef<ReactiveNode>;
    /** Version of the consumer when this dependency was last observed. */
    consumerVersion: number;
    /** Version of the producer's value when this dependency was last accessed. */
    producerVersion: number;
  }

  /** Configuration for logging changes in the reactive node. */
  interface LogConfig {
    type: string;
    name: string;
    newValue: unknown;
    oldValue: unknown;
  }

  /**
   * Watches a reactive expression and schedules it to re-run when dependencies change.
   * @internal
   */
  class EffectImpl extends ReactiveNode {
    constructor(private callback: EffectCallback) {
      super();
    }

    /** Set of all active effects. */
    private static activeEffects = new Set<EffectImpl>();

    /** Set of effects scheduled for execution. */
    private static executionQueue = new Set<EffectImpl>();

    /** Promise that resolves when the execution queue is empty. */
    private static pendingQueue: PromiseWithResolvers<void> | null = null;

    /** Property to track if this watch is dirty and needs to be re-scheduled. */
    private dirty = false;

    /** Property to track the current tracking version. */
    private cleanupFn = NOOP_CLEANUP;

    /** Stop all active effects. */
    public static resetEffects(): void {
      EffectImpl.executionQueue.clear();
      EffectImpl.activeEffects.clear();
    }

    /** Called when a dependency may have changed. */
    protected override onDependencyChange(): void {
      this.notify();
    }

    /** Called when a consumer checks if the producer's value has changed. */
    protected override onProducerMayChanged(): void {
      // Watches don't update producer values.
    }

    /**
     * Get the effect reference.
     *
     * @returns A reference to the effect ({@link EffectRef}).
     */
    public effect(): EffectRef {
      EffectImpl.activeEffects.add(this);

      // Schedule the effect to run.
      this.notify();

      const destroy = () => {
        this.cleanup();
        EffectImpl.activeEffects.delete(this);
        EffectImpl.executionQueue.delete(this);
      };

      return {
        destroy,
        [Symbol.dispose]: () => {
          destroy();
        },
      };
    }

    /** Notify that this watch needs to be re-scheduled. */
    private notify(): void {
      if (!this.dirty) {
        this.schedule();
      }

      this.dirty = true;
    }

    /**
     * Executes the reactive expression within the context of this `Watch` instance. Should be called
     * by the scheduling function when `Watch.notify()` is triggered.
     */
    private run(): void {
      this.dirty = false;

      if (this.trackingVersion !== 0 && !this.haveDependenciesChanged()) {
        return;
      }

      const previousConsumer = ReactiveNode.setActiveConsumer(this);
      this.trackingVersion++;

      try {
        this.cleanupFn();
        this.cleanupFn = this.callback() ?? NOOP_CLEANUP;
      } finally {
        ReactiveNode.setActiveConsumer(previousConsumer);
      }
    }

    /** Run the cleanup function. */
    private cleanup(): void {
      this.cleanupFn();
    }

    /** Queue an effect for execution. */
    private schedule(): void {
      if (EffectImpl.executionQueue.has(this) || !EffectImpl.activeEffects.has(this)) {
        return;
      }

      EffectImpl.executionQueue.add(this);

      if (EffectImpl.pendingQueue === null) {
        Promise.resolve().then(this.executeQueue);
        EffectImpl.pendingQueue = Promise.withResolvers();
      }
    }

    /** Execute all queued effects. */
    private executeQueue(): void {
      for (const watch of EffectImpl.executionQueue) {
        EffectImpl.executionQueue.delete(watch);
        watch.run();
      }

      EffectImpl.pendingQueue?.resolve();
      EffectImpl.pendingQueue = null;
    }
  }

  /** Cleanup function for a watch. */
  export type EffectCleanup = () => void;

  /** Callback for the `effect()` function, called when changes are detected. */
  export type EffectCallback = () => void | EffectCleanup;

  /** Reference to the reactive effect created. */
  export interface EffectRef {
    /** Stop the effect and remove it from execution. */
    destroy: () => void;
    /** Dispose of the effect and clean up all event listeners. */
    [Symbol.dispose]: () => void;
  }

  /**
   * Function that takes a callback and calls it when changes are detected in its dependencies. Then
   * returns a reference to a reactive effect that can be manually destroyed.
   */
  export type EffectHandler = (callback: EffectCallback) => EffectRef;

  /** A factory function for creating, stopping, and resetting effects. */
  export interface EffectFactory extends EffectHandler {
    /** Stop all active effects. */
    resetEffects: () => void;
    /** Immediately run the effect and then re-schedule it on changes. */
    initial: EffectHandler;
  }

  export type EffectFn = (callback: EffectCallback) => EffectRef;
  export interface Effect extends EffectFn {
    /**
     *  Creates a reactive effect that runs the given callback function immediately and then
     * re-schedules it on changes in its dependencies.
     *
     * @example Usage
     * ```ts
     * // Run the effect one initial time and then re-schedule it on changes.
     * const effectRef = effect.initial(() => {
     *   console.log('Signal changed and run first time:', signal());
     * });
     *
     * effectRef.destroy();
     * ```
     *
     * @param callback - The callback function ({@link EffectCallback}) to execute when changes are
     * detected.
     * @returns A reference ({@link EffectRef}) to the effect that can be manually destroyed.
     */
    initial: (callback: EffectCallback) => EffectRef;
    /** Stop all active effects. */
    resetEffects: () => void;
  }

  /**
   * Creates a reactive effect that runs the given callback function when changes are detected in its
   * dependencies.
   *
   * It also provides a way to manually destroy all effects.
   *
   * @example Usage
   * ```ts
   * const effectRef = effect(() => {
   *   console.log('Signal changed:', signal());
   * });
   *
   * effectRef.destroy();
   *
   * // Manually destroy all effects.
   * effect.resetEffects();
   * ```
   *
   * @param callback - The callback function ({@link EffectCallback}) to execute when changes are
   * detected.
   * @returns A reference ({@link EffectRef}) to the effect that can be manually destroyed.
   */
  export const effect: Effect;

  /**
   * Creates a memoized signal that computes the value and caches it until dependencies change.
   *
   * @example Usage
   * ```ts
   * const counter = signal(1);
   * const doubleCounter = memoSignal(() => counter() * 2);
   *
   * console.log(doubleCounter()); // Logs: "2".
   *
   * // The value is cached until dependencies change.
   * counter.set(2);
   *
   * console.log(doubleCounter()); // Logs: "4".
   * ```
   *
   * @template T - The type of the value returned by the signal.
   * @param compute - Computation function to derive the value.
   * @param options - Options for the memoized signal ({@link MemoizedSignalOptions}).
   * @returns A memoized signal ({@link MemoizedSignal}) that computes the value on demand.
   */
  export declare function memoSignal<T>(compute: () => T, options?: MemoizedSignalOptions<T>): MemoizedSignal<T>;

  /**
   * Create a signal that can be set or updated directly.
   *
   * @example Usage
   * ```ts
   * const counter = signal(0);
   *
   * console.log(counter()); // Logs: "0".
   *
   * counter.set(1);
   *
   * console.log(counter()); // Logs: "1".
   *
   * counter.update((value) => value + 1);
   *
   * console.log(counter()); // Logs: "2".
   *
   * counter.mutate((value) => value++);
   *
   * console.log(counter()); // Logs: "3".
   * ```
   *
   * @example Usage with options
   * ```ts
   * const counter = signal(0, {
   *   id: 'counter',
   *   log: true,
   *   equal: (a, b) => a === b,
   *   onChange: (value) => console.log(`Counter changed to: ${value}`),
   * });
   *
   * console.log(counter()); // Logs: "0".
   *
   * counter.set(1); // Logs: "Counter changed to: 1".
   *
   * console.log(counter()); // Logs: "1".
   *
   * counter.set(1); // No log.
   * ```
   *
   * @template T - The type of the signal value.
   * @param initialValue - The initial value of the signal.
   * @param options - The options for the signal.
   * @returns A writable signal.
   */
  export declare function signal<T>(initialValue: T, options?: SignalOptions<T>): WritableSignal<T>;
  /**
   * Create a signal that can be set or updated directly and that receives events.
   *
   * @example Usage
   * ```ts
   * {
   *   using counter = signal(0, {
   *     allowEvents: true,
   *     onDispose: () => console.log('Cleanup logic'), // Cleanup logic.
   *   });
   *
   *   console.log(counter()); // Logs: "0".
   *
   *   counter.set(1);
   *
   *   console.log(counter()); // Logs: "1".
   *
   *   dispatchEvent(new CustomEvent(counter.identifier, { detail: 2 }));
   *
   *   console.log(counter()); // Logs: "2".
   * } // Logs: "Cleanup logic".
   * ```
   *
   * @template T - The type of the signal value.
   * @param initialValue - The initial value of the signal.
   * @param options - The options for the signal.
   * @returns A writable signal.
   */
  export declare function signal<T>(initialValue: T, options?: SignalEventOptions<T>): WritableEventSignal<T>;
  /**
   * Create a signal that can be set or updated directly.
   *
   * @template T - The type of the signal value.
   * @param initialValue - The initial value of the signal.
   * @param options - The options for the signal.
   * @returns A writable signal.
   */
  export declare function signal<T>(
    initialValue: T,
    options?: SignalEventOptions<T> | SignalOptions<T>,
  ): WritableSignal<T> | WritableEventSignal<T>;

  /** Utility type to check if a value is a valid store. */
  export type ValidStore = Record<PropertyKey, unknown>;

  /**
   * Configuration options for a signal.
   *
   * @template T - The type of the signal value.
   */
  export interface ConfiguredSignal<T = unknown> extends SignalOptions<T> {
    /** Initial value of the signal.*/
    value: T;
  }

  /**
   * Configuration options for a memoized signal.
   *
   * @template T - The type of the signal value.
   */
  export interface ConfiguredMemoSignal<T = unknown> extends MemoizedSignalOptions<T> {
    /**
     * Initial value of the signal.
     *
     * @returns The initial value of the signal.
     */
    value: () => T;
  }

  /**
   * Utility type to define a configured value.
   *
   * @template T - The type of the signal value.
   */
  export type ConfiguredValue<T = unknown> = ConfiguredSignal<T> | ConfiguredMemoSignal<T>;

  /**
   * Utility type to add the meta data property to the state.
   *
   * @template T - The type of the store.
   */
  export type StateWithMeta<T extends ValidStore> = T & { __id__: string };

  /**
   * Maps all the values of the object as signals and actions.
   *
   * @template T - The type of the store.
   */
  export type WritableState<T extends ValidStore> =
    StateWithMeta<// Disabled since it's okay to use this type here to map the values of the state.
    // deno-lint-ignore ban-types
    { [K in keyof T]: T[K] extends Function ? T[K] : WritableSignal<T[K]> }>;

  /**
   * Maps all the values of the object as readonly signals and actions.
   *
   * @template T - The type of the store.
   */
  export type ReadonlyState<T extends ValidStore> =
    StateWithMeta<// Disabled since it's okay to use this type here to map the values of the state.
    // deno-lint-ignore ban-types
    { [K in keyof T]: T[K] extends Function ? T[K] : ReadonlySignal<T[K]> }>;

  /**
   * Function to create the store with the initial values.
   *
   * @template T - The type of the store.
   */
  export type StoreValues<T extends ValidStore> = (values: {
    /**
     * Returns the current state of the store.
     *
     * `WritableState<T>` cannot be nullable, However, it's initially undefined when the store is
     * created because the state isn't yet initialized. This ensures that the state is always
     * accessible without needing constant null checks.
     */
    get: () => WritableState<T>;
  }) => {
    // Disabled since it's okay to use this type here to map the values of the state.
    // deno-lint-ignore ban-types
    [K in keyof T]: T[K] extends Function ? T[K] : T[K] | ConfiguredValue<T[K]>;
  };

  /**
   * A store is a function that returns an atomic and encapsulated state. It can be read through
   * signals and written through actions.
   *
   * @template T - The type of the store.
   */
  export interface Store<T extends ValidStore> {
    /**
     * Function to use the store.
     *
     * @template U - Key of the store to select.
     * @param selector - Key of the store to select.
     * @returns The value of the selected store key.
     */
    <U extends keyof T>(selector: U): ReadonlyState<T>[U];
    /**
     * Function to use the store.
     *
     * @returns The state of the store.
     */
    (): ReadonlyState<T>;
  }

  /**
   * Creates a reactive atomic piece of state ({@link store}) that can be read through signals and
   * written through actions.
   *
   * @example Usage
   * ```ts
   * const counterStore = store(({ get }) => ({
   *   counter: 0,
   *   increment: () => get().counter++,
   *   decrement: () => get().counter--,
   * }));
   *
   * const counterValues = counterStore();
   *
   * console.log(counterValues.counter()); // Logs: "0".
   *
   * counterValues.increment();
   *
   * console.log(counterValues.counter()); // Logs: "1".
   * ```
   *
   * @example Usage with selector
   * ```ts
   * const counterStore = store(({ get }) => ({
   *   counter: 0,
   *   increment: () => get().counter++,
   *   decrement: () => get().counter--,
   * }));
   *
   * const counter = counterStore('counter');
   * const increment = counterStore('increment');
   *
   * console.log(counter()); // Logs: "0".
   *
   * increment();
   *
   * console.log(counter()); // Logs: "1".
   * ```
   *
   * @template T - The type of the store.
   * @param initializeStoreValues - Function that initializes the store values.
   * @returns A store that can be used to read and write the state.
   */
  export declare function store<T extends ValidStore>(initializeStoreValues: StoreValues<T>): Store<T>;

  /**
   * The value of a promise.
   * @template T - The type for the promise value.
   */
  export type PromiseValue<T> =
    | { status: 'pending' }
    | { status: 'fulfilled'; value: T }
    | { status: 'rejected'; error: unknown };

  /**
   * Creates a signal from a promise.
   *
   * @example Usage
   * ```ts
   * // Create a signal from a promise using async/await.
   * const promiseSignal = toSignal(async () => {
   *   const response = await fetch('https://api.example.com/data');
   *   return await response.json();
   * });
   *
   * // Or using a promise directly.
   * const promiseSignal = toSignal(
   *   fetch('https://api.example.com/data').then((response) => response.json())
   * );
   *
   * // The signal is initially pending.
   * console.log(promiseSignal()); // Logs: "{ status: 'pending' }".
   *
   * // The value is updated when the promise resolves.
   * await delay(1000);
   * console.log(promiseSignal()); // Logs: "{ status: 'fulfilled', value: 'Hello, World!' }".

   * // Or if the promise rejects.
   * console.log(promiseSignal()); // Logs: "{ status: 'rejected', error: 'Error!' }".
   * ```
   *
   * @template T - The type of the promise value.
   * @param value - Promise function or promise to create the signal from.
   * @returns A read-only signal ({@link ReadonlySignal}) that resolves the promise and updates its
   * value based on the promise's status.
   */
  export declare function toSignal<T>(value: (() => Promise<T>) | Promise<T>): ReadonlySignal<PromiseValue<T>>;

  /**
   * Reads the value of a signal without creating a dependency.
   *
   * @template T - The type of the signal value.
   * @param readFn - The function to read the signal value.
   * @returns The value of the signal.
   */
  export declare function untrackedSignal<T>(readFn: () => T): T;
}
