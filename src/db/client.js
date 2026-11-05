"use strict";
const {AsyncLocalStorage} = require("node:async_hooks");
const {Pool} = require("pg");
const {databaseOptions} = require("./connection");

// Giữ timeout Happy Eyeballs hiện có cho kết nối quốc tế.
require("node:net").setDefaultAutoSelectFamilyAttemptTimeout(5000);
const pool = new Pool(databaseOptions());
const txStorage = new AsyncLocalStorage();

async function query(text, params = []) {
  const client = txStorage.getStore();
  return (client || pool).query(text, params);
}

// Tất cả module dùng cùng pool và cùng ngữ cảnh transaction; lồng nhau tái sử dụng client.
async function withTransaction(fn) {
  if (txStorage.getStore()) return fn();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await txStorage.run(client, fn);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
module.exports = {pool,query,withTransaction};
