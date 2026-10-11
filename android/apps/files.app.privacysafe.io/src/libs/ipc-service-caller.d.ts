/// <reference path="../@types/platform-defs/w3n.d.ts" />
declare type RPCConnection = web3n.rpc.client.RPCConnection;
declare type PassedDatum = web3n.rpc.PassedDatum;
export interface TransformOpts {
    unpackReply?: ((reply: PassedDatum | undefined) => any) | 'noop';
    packRequest?: ((args: any[]) => PassedDatum | undefined) | 'noop';
}
export declare function makeReqRepMethodCaller<F extends Function>(connection: RPCConnection, method: string, transforms?: TransformOpts): F;
export declare function makeObservableMethodCaller<F extends Function>(connection: RPCConnection, method: string, transforms?: TransformOpts): F;
export declare function makeServiceCaller<T>(connection: RPCConnection, reqRepMethods?: (keyof T)[], obsMethods?: (keyof T)[], transforms?: {
    [method in keyof T]: TransformOpts;
}): Partial<T>;
export {};
