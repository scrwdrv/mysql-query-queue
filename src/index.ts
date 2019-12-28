import * as ipc from 'fast-ipc';
import * as mysql from 'mysql2';
import * as recurdir from 'recurdir';
import { exec as childExec } from 'child_process';

const priorities = ['low', 'high', 'instant'];
type exec = (msg: any, callback: (err: any, result: any) => void) => void;


export class mysqlServer {

    private host: string;
    private user: string;
    private password: string;
    private database: string;
    private backupPath: string;

    public pool: mysql.Pool;
    public queryQueue = {
        high: [],
        low: []
    };
    public queryRunning = false;

    constructor(options: {
        host: string;
        user: string;
        password: string;
        database: string;
        backupPath: string;
    }) {
        for (let part in options)
            this[part] = options[part];

        const ipcServer = new ipc.server('mysql'),
            connection = this.connect();

        connection.query(`CREATE DATABASE IF NOT EXISTS ${this.database}`, err => {
            if (err) return console.log(err);
            connection.end((err) => {
                if (err) return console.log(err);
                this.pool = mysql.createPool({
                    host: this.host,
                    user: this.user,
                    password: this.password,
                    database: this.database
                });
            });
        });

        for (let priority of priorities)
            ipcServer.on(priority, (req: string[], res: (err: any, result: any) => void) => {
                /* 
                system: req[0],
                cluster: req[1]
                */
                const sql = req.slice(2),
                    queriesLastIndex = sql.length - 1,
                    queryExec = () => {
                        this.queryRunning = true;
                        const exec = (i = 0, results = []) => {
                            if (!this.pool) return setTimeout(exec, 500, i, results);
                            this.pool.query(sql[i], (err, result) => {
                                results.push(result);
                                if (i === queriesLastIndex || err) {
                                    res(err, queriesLastIndex ? results : results[0]);

                                    if (this.queryQueue.high[0])
                                        this.queryQueue.high.shift()();
                                    else if (this.queryQueue.low[0])
                                        this.queryQueue.low.shift()();
                                    else
                                        this.queryRunning = false;

                                } else exec(i + 1, results);
                            });
                        }
                        exec();
                    }

                if (this.queryRunning)
                    switch (priority) {
                        case 'instant':
                            this.queryQueue.high = [queryExec, ...this.queryQueue.high];
                            break;
                        case 'high':
                            this.queryQueue.high.push(queryExec);
                            break;
                        case 'low':
                            this.queryQueue.low.push(queryExec);
                            break;
                    }
                else queryExec();
            });
    }

    connect() {
        return mysql.createConnection({
            host: this.host,
            user: this.user,
            password: this.password,
            multipleStatements: true
        });
    }

    clear() {
        return new Promise((resolve, reject) => {
            const connection = this.connect();
            connection.query(`DROP SCHEMA IF EXISTS ${this.database};
                          CREATE DATABASE IF NOT EXISTS ${this.database}`, err => {
                if (err) return reject(err);
                connection.end((err) => {
                    if (err) return reject(err);
                    const oldPool = this.pool;
                    this.pool = null;
                    oldPool.end((err) => {
                        if (err) return reject(err);
                        this.pool = mysql.createPool({
                            host: this.host,
                            user: this.user,
                            password: this.password,
                            database: this.database
                        });
                        resolve();
                    });
                });
            });
        });
    }

    backupPromise() {
        return new Promise((resolve, reject) => {
            this.untilConnected().then(() => {
                recurdir.mk(this.backupPath).then(() => {
                    const mysqlBackupProcess = childExec(`mysqldump -u ${this.user} -p"${this.password}" ${this.database} > ${this.backupPath}/${this.database}_${new Date().toISOString().slice(0, 10)}.sql`,
                        (err) => {
                            mysqlBackupProcess.kill();
                            if (err) return reject(err);
                            resolve();
                        });
                }).catch(reject);
            });
        });
    }


    backup(callback: (err?: any) => void) {

        if (!this.pool) return setTimeout(() => this.backup(callback), 1000);

        recurdir.mk(this.backupPath).then(() => {
            const mysqlBackupProcess = childExec(`mysqldump -u ${this.user} -p"${this.password}" ${this.database} > ${this.backupPath}/${this.database}_${new Date().toISOString().slice(0, 10)}.sql`,
                (err) => {
                    mysqlBackupProcess.kill();
                    if (err) return callback(err);
                    callback();
                });
        }).catch(callback);
    }

    untilConnected() {
        return new Promise((resolve) => {
            const checkPool = () => {
                if (!this.pool) return setTimeout(() => checkPool(), 500);
                resolve();
            }
            checkPool();
        })
    }
}

export class mysqlClient {

    private system: string;
    private cluster: number | string;

    public low: exec;
    public high: exec;
    public instant: exec;

    constructor(options: {
        system: string;
        cluster: number | string;
    }) {
        for (let part in options)
            this[part] = options[part];

        const ipcClient = new ipc.client('mysql');

        for (let priority of priorities)
            this[priority] = (msg: string | string[], callback: (err: any, result: any) => void) => {
                if (typeof msg !== 'object')
                    ipcClient.send(priority, [this.system, this.cluster, msg], callback);
                else ipcClient.send(priority, [this.system, this.cluster, ...msg], callback);
            }
    }

    date(offset = 0) {
        return new Date(Date.now() + offset).toISOString().slice(0, 10);
    }

    escape(str: string) {
        return str.replace(/['\\]/g, '\\$&');
    }

    quote(str: string) {
        return '`' + str + '`';
    }
}