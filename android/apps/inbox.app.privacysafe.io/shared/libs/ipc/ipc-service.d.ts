/// <reference path="../@types/platform-defs/w3n.d.ts" />
declare type IncomingConnection = web3n.rpc.service.IncomingConnection;
declare type PassedDatum = web3n.rpc.PassedDatum;
declare type Observer<T> = web3n.Observer<T>;
export declare type HandleObservingCall = (obs: Observer<any>, ...requestArgs: any[]) => (() => void);
export declare type HandleReqReplyCall = (...requestArgs: any[]) => Promise<any>;

export interface TransformOpts {
  unpackRequest?: ((req: PassedDatum | undefined) => any[]) | 'noop';
  packReply?: ((reply: any) => PassedDatum | undefined) | 'noop';
}

declare class ConnectionState {
  private readonly disconnect;
  private readonly calls;
  private isRunning;

  constructor(disconnect: () => void);

  acceptsMsgs(): boolean;

  stop(): void;

  hasCall(callNum: number): boolean;

  cancelCall(callNum: number): void;

  completeCall(callNum: number): void;

  registerReqReplyCall(callNum: number): void;

  registerObservableCall(callNum: number, cancel: () => void): void;
}

export declare abstract class IPCWrap {
  readonly srvName: string;
  protected readonly connections: Map<web3n.rpc.service.IncomingConnection, ConnectionState>;
  private readonly methods;

  constructor(srvName: string);

  addReqReplyMethod(method: string, srv: object | undefined, func: HandleReqReplyCall, transforms?: TransformOpts): void;

  exposeReqReplyMethods<T extends object>(srv: T, methods: (keyof T)[], transforms?: {
    [method in keyof T]: TransformOpts;
  }): void;

  addObservableMethod(method: string, srv: object | undefined, func: HandleObservingCall, transforms?: TransformOpts): void;

  exposeObservableMethods<T extends object>(srv: T, methods: (keyof T)[], transforms?: {
    [method in keyof T]: TransformOpts;
  }): void;

  private onMsg;
  private callReqReplyHandler;
  private callObsHandler;

  startIPC(): () => void;

  stopIPC(): void;

  protected onConnection(connection: IncomingConnection): Promise<void>;

  protected onConnectionCompletion(connection: IncomingConnection, connectionState: ConnectionState): Promise<void>;

  protected onConnectionError(connection: IncomingConnection, connectionState: ConnectionState, err: any): Promise<void>;

  protected abstract onListeningCompletion(): Promise<void>;

  protected abstract onListeningError(err: any): Promise<void>;
}

export declare class SingleConnectionIPCWrap extends IPCWrap {
  constructor(srvName: string);

  protected onListeningCompletion(): Promise<void>;

  protected onListeningError(err: any): Promise<void>;

  protected onConnectionCompletion(connection: IncomingConnection, connectionState: ConnectionState): Promise<void>;

  protected onConnectionError(connection: IncomingConnection, connectionState: ConnectionState, err: any): Promise<void>;
}

export declare class MultiConnectionIPCWrap extends IPCWrap {
  constructor(srvName: string);

  protected onListeningCompletion(): Promise<void>;

  protected onListeningError(err: any): Promise<void>;

  protected onConnectionError(connection: IncomingConnection, connectionState: ConnectionState, err: any): Promise<void>;
}

export {};
