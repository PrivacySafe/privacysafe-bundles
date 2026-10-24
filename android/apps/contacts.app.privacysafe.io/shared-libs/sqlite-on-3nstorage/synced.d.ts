/**
 * This represents a function that will create a promise, potentially starting
 * some background process, only when it is called. Such wrap of code is needed
 * for scheduling, as very often any start of an action must be postponed till
 * later time. Scheduler needs a not-yet-started activity, as scheduler has
 * control action's start.
 */
export declare type Action<T> = () => Promise<T>;

/**
 * This is a container of processes, labeled by some ids. It allows to track if
 * there is a process already in progress with a given id. And, it allows to
 * chain process, when needed.
 *
 * Common use of such class is to reuse getting of some expensive resource(s).
 */
export declare class NamedProcs {
  private processes;

  constructor();

  /**
   * @param id is a string key of a process
   * @return a promise of a process' completion, or undefined, if process with
   * given id is unknown.
   */
  latestTaskAtThisMoment<T>(id: string): Promise<T> | undefined;

  isProcessing(id: string): boolean;

  /**
   * This method will add a promise of an already started process.
   * @param id is a string key of a process
   * @param promise of an already started process
   * @return a promise of a process' completion.
   */
  addStarted<T>(id: string, promise: Promise<T>): Promise<T>;

  /**
   * This method will start a given action only, if a process with a given id
   * is not running.
   * @param id is a string key of a process
   * @param action is a function that starts some process
   * @return a promise of a process' completion.
   */
  start<T>(id: string, action: Action<T>): Promise<T>;

  /**
   * This method will chain a given action to an already running process, or,
   * if identified process is not running, this will start given action under
   * a given id.
   * @param id is a string key of a process
   * @param action is a function that starts some process
   * @return a promise of a process' completion.
   */
  startOrChain<T>(id: string, action: Action<T>): Promise<T>;
}

/**
 * This is a container of process. It allows to track if a process is already
 * in progress. It also allows to chain process, when needed.
 *
 * Common use of such class is to reuse getting of some expensive resource, or
 * do ning something as an exclusive process.
 */
export declare class SingleProc {
  private onGoingIdle?;
  private actions;
  private running;

  constructor(onGoingIdle?: (() => void) | undefined);

  isProcessing(): boolean;

  latestTaskAtThisMoment<T>(): Promise<T> | undefined;

  addStarted<T>(promise: Promise<T>): Promise<T>;

  start<T>(action: Action<T>): Promise<T>;

  private runIfIdle;

  startOrChain<T>(action: Action<T>): Promise<T>;
}

/**
 * This wraps given function/method into syncing wrap.
 */
export declare function makeSyncedFunc<T extends Function>(syncProc: SingleProc, thisArg: any, func: T): T;
