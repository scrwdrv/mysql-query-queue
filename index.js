"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ipc = require("fast-ipc");
const mysql = require("mysql2");
const recurdir = require("recurdir");
const child_process_1 = require("child_process");
const priorities = ['low', 'high', 'instant'];
class mysqlServer {
    constructor(options) {
        this.queryQueue = {
            high: [],
            low: []
        };
        this.queryRunning = false;
        for (let part in options)
            this[part] = options[part];
        const ipcServer = new ipc.server('mysql'), connection = this.connect();
        connection.query(`CREATE DATABASE IF NOT EXISTS ${this.database}`, err => {
            if (err)
                return console.log(err);
            connection.end((err) => {
                if (err)
                    return console.log(err);
                this.pool = mysql.createPool({
                    host: this.host,
                    user: this.user,
                    password: this.password,
                    database: this.database
                });
            });
        });
        for (let priority of priorities)
            ipcServer.on(priority, (req, res) => {
                /*
                system: req[0],
                cluster: req[1]
                */
                const sql = req.slice(2), queriesLastIndex = sql.length - 1, queryExec = () => {
                    this.queryRunning = true;
                    const exec = (i = 0, results = []) => {
                        if (!this.pool)
                            return setTimeout(exec, 500, i, results);
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
                            }
                            else
                                exec(i + 1, results);
                        });
                    };
                    exec();
                };
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
                else
                    queryExec();
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
                if (err)
                    return reject(err);
                connection.end((err) => {
                    if (err)
                        return reject(err);
                    const oldPool = this.pool;
                    this.pool = null;
                    oldPool.end((err) => {
                        if (err)
                            return reject(err);
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
    async backup(callback) {
        if (!this.pool)
            return setTimeout(() => this.backup(callback), 1000);
        try {
            await recurdir.mk(this.backupPath);
        }
        catch (err) {
            return console.log(err);
        }
        const mysqlBackupProcess = child_process_1.exec(`mysqldump -u ${this.user} -p"${this.password}" ${this.database} > ${this.backupPath}/${this.database}_${new Date().toISOString().slice(0, 10)}.sql`, (err) => {
            mysqlBackupProcess.kill();
            if (err)
                return callback(err);
            callback(null);
        });
    }
}
exports.mysqlServer = mysqlServer;
class mysqlClient {
    constructor(options) {
        for (let part in options)
            this[part] = options[part];
        this.ipcClient = new ipc.client('mysql');
        for (let priority of priorities)
            this[priority] = (msg, callback) => {
                if (typeof msg !== 'object')
                    this.ipcClient.send(priority, [this.system, this.cluster, msg], callback);
                else
                    this.ipcClient.send(priority, [this.system, this.cluster, ...msg], callback);
            };
    }
    date(offset = 0) {
        return new Date(Date.now() + offset).toISOString().slice(0, 10);
    }
    escape(str) {
        return str.replace(/['\\]/g, '\\$&');
    }
    quote(str) {
        return '`' + str + '`';
    }
}
exports.mysqlClient = mysqlClient;
//# sourceMappingURL=index.js.map