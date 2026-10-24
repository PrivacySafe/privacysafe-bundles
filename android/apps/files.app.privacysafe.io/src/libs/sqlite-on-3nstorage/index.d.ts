import { Database as DBClass, BindParams as QueryParams, QueryExecResult as QueryResult } from './sqljs';
import { SingleProc, Action } from './synced';
export declare type Database = DBClass;
export declare type BindParams = QueryParams;
export declare type QueryExecResult = QueryResult;
declare type WritableFile = web3n.files.WritableFile;
export interface SaveOpts {
    skipUpload?: boolean;
}
export declare abstract class SQLiteOn3NStorage {
    protected readonly database: Database;
    protected readonly file: WritableFile;
    protected readonly syncProc: SingleProc;
    protected constructor(database: Database, file: WritableFile);
    static makeAndStart(file: WritableFile): Promise<SQLiteOn3NStorage>;
    private start;
    saveToFile(opts?: SaveOpts): Promise<void>;
    get db(): Database;
    sync<T>(action: Action<T>): Promise<T>;
    listTables(): string[];
}
export declare function objectFromQueryExecResult<T>(sqlResult: QueryExecResult): Array<T>;
export declare class TableColumnsAndParams<ColumnDefs extends object> {
    readonly name: string;
    private readonly columnDefs;
    readonly c: {
        [columnName in keyof ColumnDefs]: string;
    };
    readonly cReversed: {
        [snakedColName: string]: keyof ColumnDefs;
    };
    readonly p: {
        [columnName in keyof ColumnDefs]: string;
    };
    readonly q: {
        [columnName in keyof ColumnDefs]: string;
    };
    constructor(name: string, columnDefs: ColumnDefs);
    private toC;
    toParams<T extends {
        [columnName in keyof ColumnDefs]: any;
    }>(value: Partial<T>, throwOnUnknownField?: boolean): any;
    getFromQueryExecResult<T>(sqlResult: QueryExecResult): Array<T>;
    get insertQuery(): string;
    updateQuery(withTabName: boolean, columns?: (keyof ColumnDefs)[] | undefined, skipColumns?: boolean): string;
    get columnsCreateSection(): string;
    selectQuery(columnsToSelect: (keyof ColumnDefs)[] | string, ...whereAndColEqual: (keyof ColumnDefs)[]): string;
}
export {};
