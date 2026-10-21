export declare function serializeArgs(args: any[]): {
    bytes: Uint8Array;
    passedByReference?: any[];
};
export declare function deserializeArgs(bytes: Uint8Array, passedByReference: any[] | undefined): any[];
