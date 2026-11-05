"use strict";
const crypto = require("node:crypto");
const {query,withTransaction} = require("../db/client");
const {toNumber,nowIso} = require("./values");
const {lockFinancialPeople} = require("./locks");

async function addMemberCredit({ memberId, amount, note, requestId }) {
  const delta = Math.round(toNumber(amount));
  if (!delta) throw new Error("Số tiền thừa phải khác 0.");
  const safeMemberId = String(memberId || "").trim();
  const safeRequestId = requestId == null ? null : String(requestId).trim();
  if (safeRequestId !== null && !/^[A-Za-z0-9_-]{16,128}$/.test(safeRequestId)) throw new Error("Mã yêu cầu không hợp lệ.");
  const safeNote = String(note || "").trim();
  return withTransaction(async () => {
    await lockFinancialPeople([{member_id: safeMemberId, member_name: ""}]);
    const memberResult = await query("SELECT member_id, name FROM members WHERE member_id = $1", [safeMemberId]);
    const member = memberResult.rows[0];
    if (!member) throw new Error("Không tìm thấy thành viên.");
    if (safeRequestId) {
      const replay = await query("SELECT amount, note FROM member_credits WHERE member_id=$1 AND request_id=$2", [safeMemberId, safeRequestId]);
      if (replay.rows.length) {
        if (Number(replay.rows[0].amount) !== delta || replay.rows[0].note !== safeNote) {
          throw new Error("Mã yêu cầu đã dùng cho giao dịch khác.");
        }
        return getMemberCreditSummary();
      }
    }
    if (delta < 0) {
      const current = await getMemberCreditBalanceById(member.member_id);
      if (current + delta < 0) throw new Error("Không đủ tiền thừa để trừ.");
    }
    await query(`
      INSERT INTO member_credits(credit_id, member_id, member_name, amount, note, created_at, request_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `, [crypto.randomUUID(), member.member_id, member.name, delta, safeNote, nowIso(), safeRequestId]);
    return getMemberCreditSummary();
  });
}

async function getMemberCreditBalanceById(memberId) {
  const result = await query(
    `SELECT COALESCE(SUM(amount), 0)::int AS balance FROM member_credits WHERE member_id = $1`,
    [String(memberId || "").trim()],
  );
  return Math.round(toNumber(result.rows[0]?.balance));
}

async function getMemberCreditBalanceByName(memberName) {
  const result = await query(
    `
    SELECT COALESCE(SUM(c.amount), 0)::int AS balance
    FROM member_credits c
    JOIN members m ON m.member_id = c.member_id
    WHERE LOWER(m.name) = LOWER($1)
    `,
    [String(memberName || "").trim()],
  );
  return Math.round(toNumber(result.rows[0]?.balance));
}

async function getMemberCreditSummary() {
  const [balances, entries] = await Promise.all([
    query(`
      SELECT member_id, MAX(member_name) AS member_name, SUM(amount)::int AS balance
      FROM member_credits
      GROUP BY member_id
      HAVING SUM(amount) <> 0
      ORDER BY MAX(member_name) ASC
    `),
    query(`SELECT * FROM member_credits ORDER BY created_at DESC LIMIT 40`),
  ]);
  return {
    balances: balances.rows.map((row) => ({
      memberId: row.member_id,
      memberName: row.member_name,
      balance: Math.round(toNumber(row.balance)),
    })),
    entries: entries.rows.map((row) => ({
      creditId: row.credit_id,
      memberId: row.member_id,
      memberName: row.member_name,
      amount: Math.round(toNumber(row.amount)),
      note: row.note || "",
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
    })),
  };
}

module.exports = {addMemberCredit,getMemberCreditBalanceById,getMemberCreditBalanceByName,getMemberCreditSummary};
