"use strict";
const {query} = require("../db/client");
const {safeLower} = require("./values");

// Mọi đường ghi tiền dùng cùng khóa; nhiều người được khóa theo thứ tự cố định.
function financialPersonKey(row) {
  return row.member_id ? "member:" + row.member_id : "guest:" + safeLower(row.member_name);
}

async function lockFinancialPeople(rows) {
  const keys = [...new Set(rows.map(financialPersonKey))].sort();
  for (const key of keys) {
    await query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
    if (key.startsWith("member:")) {
      const member = await query("SELECT member_id FROM members WHERE member_id = $1 FOR KEY SHARE", [key.slice(7)]);
      if (!member.rows.length) throw new Error("Thành viên không tồn tại; cần đối soát trước khi thay đổi tiền.");
    }
  }
}

module.exports = {financialPersonKey,lockFinancialPeople};
