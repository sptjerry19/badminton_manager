"use strict";
const {databaseOptions} = require("./db/connection");
function isProduction(env = process.env) {
  return env.NODE_ENV === "production" || Boolean(env.VERCEL && env.VERCEL !== "0");
}
function validateRuntimeConfig(env = process.env) {
  const errors = [];
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push("PORT không hợp lệ");
  if (isProduction(env)) {
    if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.trim().length < 12 ||
        ["123456","change_me_please","badminton-session-secret"].includes(env.ADMIN_PASSWORD)) errors.push("ADMIN_PASSWORD cần giá trị riêng dài ít nhất 12 ký tự");
    if (!env.SESSION_SECRET || env.SESSION_SECRET.trim().length < 32 ||
        /^(change_me|replace_with|badminton-session-secret)/i.test(env.SESSION_SECRET)) errors.push("SESSION_SECRET cần giá trị riêng dài ít nhất 32 ký tự");
    if (!env.CRON_SECRET || env.CRON_SECRET.trim().length < 32 ||
        /^(change_me|replace_with)/i.test(env.CRON_SECRET)) errors.push("CRON_SECRET cần giá trị riêng dài ít nhất 32 ký tự");
    if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") errors.push("Không cho tắt xác minh TLS toàn cục trong production");
  }
  try { databaseOptions(env); } catch (error) { errors.push(error.message); }
  if (errors.length) throw new Error("Cấu hình không hợp lệ: " + errors.join("; "));
  return {isProduction:isProduction(env)};
}
module.exports = {isProduction,validateRuntimeConfig};
