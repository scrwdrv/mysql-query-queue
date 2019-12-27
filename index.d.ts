import * as mysql from 'mysql2';
declare type exec = (msg: any, callback: (err: any, result: any) => void) => void;
export declare class mysqlServer {
    private host;
    private user;
    private password;
    private database;
    private backupPath;
    pool: mysql.Pool;
    queryQueue: {
        high: any[];
        low: any[];
    };
    queryRunning: boolean;
    constructor(options: {
        host: string;
        user: string;
        password: string;
        database: string;
        backupPath: string;
    });
    connect(): any;
    clear(): Promise<unknown>;
    backup(callback: (err: any) => void): any;
}
export declare class mysqlClient {
    private system;
    private cluster;
    private ipcClient;
    low: exec;
    high: exec;
    instant: exec;
    constructor(options: {
        system: string;
        cluster: number | string;
    });
    date(offset?: number): string;
    escape(str: string): string;
    quote(str: string): string;
}
export {};
