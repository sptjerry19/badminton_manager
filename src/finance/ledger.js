"use strict";
const crypto = require("node:crypto");
const {pool,query,withTransaction} = require("../db/client");
const {toNumber,safeLower,nowIso,computeEqualShares} = require("./values");
const {lockFinancialPeople} = require("./locks");
const {getMemberCreditBalanceById} = require("./credits");

function mapBasicSession(row) {
  return {
    id: row.basic_session_id,
    date: row.play_date || "",
    court: row.court || "",
    courtFee: Math.round(toNumber(row.court_fee)),
    shuttleFee: Math.round(toNumber(row.shuttle_fee)),
    extraFee: Math.round(toNumber(row.extra_fee)),
    extraNote: row.extra_note || "",
    voteSessionId: row.vote_session_id || "",
    totalFee: Math.round(toNumber(row.total_fee)),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
  };
}

function mapBasicShare(row) {
  return {
    id: String(row.id),
    memberId: row.member_id || "",
    memberName: row.member_name || "",
    shareAmount: Math.round(toNumber(row.share_amount)),
    paid: Boolean(row.paid),
    paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : "",
  };
}

async function getBasicLedger() {
  const sessionsResult = await query(
    `
    SELECT * FROM basic_sessions
    ORDER BY play_date DESC, created_at DESC
    `,
  );
  const sessions = sessionsResult.rows.map(mapBasicSession);
  if (!sessions.length) return [];

  const sharesResult = await query(
    `
    SELECT * FROM basic_shares
    WHERE basic_session_id = ANY($1::text[])
    ORDER BY member_name ASC
    `,
    [sessions.map((session) => session.id)],
  );

  const sharesBySession = {};
  sharesResult.rows.forEach((row) => {
    const sessionId = row.basic_session_id;
    if (!sharesBySession[sessionId]) sharesBySession[sessionId] = [];
    sharesBySession[sessionId].push(mapBasicShare(row));
  });

  return sessions.map((session) => ({
    ...session,
    shares: sharesBySession[session.id] || [],
  }));
}

function normalizeGuestNames(guestNames) {
  const raw = Array.isArray(guestNames) ? guestNames : [];
  const seen = new Set();
  const names = [];
  raw.forEach((item) => {
    const name = String(item || "")
      .trim()
      .replace(/\s+/g, " ");
    if (!name) return;
    if (name.length > 60) throw new Error("Tên người giao lưu quá dài.");
    const key = safeLower(name);
    if (seen.has(key)) return;
    seen.add(key);
    names.push(name);
  });
  return names;
}

async function createBasicSession({
  date,
  court,
  courtFee,
  shuttleFee,
  extraFee,
  extraNote,
  voteSessionId,
  memberIds,
  guestNames,
}) {
  const playDate = String(date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(playDate)) {
    throw new Error("Ngày đánh phải có định dạng YYYY-MM-DD.");
  }

  const safeCourt = String(court || "").trim();
  if (!safeCourt) throw new Error("Thiếu tên sân.");

  const safeCourtFee = Math.round(toNumber(courtFee));
  const safeShuttleFee = Math.round(toNumber(shuttleFee));
  const safeExtraFee = Math.round(toNumber(extraFee));
  if (safeCourtFee < 0 || safeShuttleFee < 0 || safeExtraFee < 0) {
    throw new Error("Tiền sân, tiền cầu và phát sinh không được âm.");
  }
  const safeExtraNote = String(extraNote || "").trim().slice(0, 200);
  const safeVoteSessionId = String(voteSessionId || "").trim();
  if (safeVoteSessionId) {
    const vote = await query("SELECT session_id FROM sessions WHERE session_id = $1", [safeVoteSessionId]);
    if (!vote.rows.length) throw new Error("Không tìm thấy buổi vote cần tính tiền.");
  }

  const totalFee = safeCourtFee + safeShuttleFee + safeExtraFee;
  if (totalFee <= 0) throw new Error("Tổng tiền phải lớn hơn 0.");

  const ids = Array.isArray(memberIds)
    ? [
        ...new Set(
          memberIds.map((id) => String(id || "").trim()).filter(Boolean),
        ),
      ]
    : [];
  const guestsInput = normalizeGuestNames(guestNames);

  let members = [];
  if (ids.length) {
    const membersResult = await query(
      `
      SELECT member_id, name
      FROM members
      WHERE active = TRUE AND member_id = ANY($1::text[])
      `,
      [ids],
    );
    if (membersResult.rows.length !== ids.length) {
      throw new Error("Có thành viên không tồn tại hoặc đã bị khóa.");
    }
    members = membersResult.rows.map((row) => ({
      memberId: row.member_id,
      name: row.name,
    }));
  }

  const activeMembers = await query(
    `SELECT name FROM members WHERE active = TRUE`,
  );
  const activeNames = new Set(
    activeMembers.rows.map((row) => safeLower(row.name)),
  );
  const guests = guestsInput.map((name) => {
    if (activeNames.has(safeLower(name))) {
      throw new Error(
        `"${name}" đã có trong danh sách thành viên. Hãy chọn người đó thay vì thêm giao lưu.`,
      );
    }
    return { memberId: "", name };
  });

  const people = [...members, ...guests].sort((a, b) =>
    a.name.localeCompare(b.name, "vi", { sensitivity: "base" }),
  );
  if (!people.length) throw new Error("Chọn ít nhất một người tham gia.");

  const shares = computeEqualShares(totalFee, people.length);
  const sessionId = crypto.randomUUID();
  const ts = nowIso();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `
      INSERT INTO basic_sessions(
        basic_session_id, play_date, court, court_fee, shuttle_fee,
        extra_fee, extra_note, vote_session_id, total_fee, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
      [
        sessionId,
        playDate,
        safeCourt,
        safeCourtFee,
        safeShuttleFee,
        safeExtraFee,
        safeExtraNote,
        safeVoteSessionId,
        totalFee,
        ts,
      ],
    );

    for (let i = 0; i < people.length; i += 1) {
      const member = people[i];
      await client.query(
        `
        INSERT INTO basic_shares(
          basic_session_id, member_id, member_name, member_name_ci, share_amount, paid
        )
        VALUES ($1,$2,$3,$4,$5,FALSE)
        `,
        [
          sessionId,
          member.memberId,
          member.name,
          safeLower(member.name),
          shares[i],
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const ledger = await getBasicLedger();
  return ledger.find((session) => session.id === sessionId) || null;
}

async function recordBasicSharePayment(row) {
  let used = 0;
  let debitId = null;
  if (row.member_id) {
    const available = Math.max(0, await getMemberCreditBalanceById(row.member_id));
    used = Math.min(available, Math.round(toNumber(row.share_amount)));
    if (used > 0) {
      debitId = crypto.randomUUID();
      await query(`
        INSERT INTO member_credits(credit_id, member_id, member_name, amount, note, created_at)
        VALUES ($1,$2,$3,$4,$5,NOW())
      `, [debitId, row.member_id, row.member_name, -used, "Trừ vào tiền sân · phần " + row.id]);
    }
  }
  await query(`
    INSERT INTO basic_share_settlements(
      settlement_id, share_id, basic_session_id, member_id, member_name,
      share_amount, credit_used, debit_credit_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
  `, [crypto.randomUUID(), row.id, row.basic_session_id, row.member_id,
    row.member_name, row.share_amount, used, debitId]);
  const updated = await query(`
    UPDATE basic_shares SET paid = TRUE, paid_at = NOW() WHERE id = $1 RETURNING *
  `, [row.id]);
  return updated.rows[0];
}

async function reverseBasicSharePayment(row) {
  const result = await query(`
    SELECT * FROM basic_share_settlements
    WHERE share_id = $1 AND reversed_at IS NULL FOR UPDATE
  `, [row.id]);
  const payment = result.rows[0];
  // Các khoản thành viên cũ không có phân bổ tín dụng: không suy đoán hoàn tiền.
  if (!payment && row.member_id && row.paid) {
    throw new Error("Khoản đã trả này thiếu lịch sử phân bổ tiền dư. Cần đối soát trước khi hoàn tác hoặc xóa buổi.");
  }
  if (!payment) return; // Khách cũ không có tài khoản tiền dư.
  let refundId = null;
  if (payment.credit_used > 0) {
    refundId = crypto.randomUUID();
    await query(`
      INSERT INTO member_credits(credit_id, member_id, member_name, amount, note, created_at)
      VALUES ($1,$2,$3,$4,$5,NOW())
    `, [refundId, payment.member_id, payment.member_name, payment.credit_used,
      "Hoàn tiền dư · phần " + row.id]);
  }
  await query(`
    UPDATE basic_share_settlements SET refund_credit_id = $2, reversed_at = NOW()
    WHERE settlement_id = $1
  `, [payment.settlement_id, refundId]);
}

async function setBasicSharePaid(shareId, paid) {
  if (typeof paid !== "boolean") throw new Error("Thiếu trạng thái thanh toán.");
  const id = String(shareId || "").trim();
  if (!/^\d+$/.test(id)) throw new Error("Không tìm thấy phần tiền.");
  return withTransaction(async () => {
    const initial = await query("SELECT * FROM basic_shares WHERE id = $1::bigint", [id]);
    if (!initial.rows.length) throw new Error("Không tìm thấy phần tiền.");
    await lockFinancialPeople(initial.rows);
    const result = await query("SELECT * FROM basic_shares WHERE id = $1::bigint FOR UPDATE", [id]);
    const row = result.rows[0];
    if (!row) throw new Error("Không tìm thấy phần tiền.");
    if (row.paid === paid) return mapBasicShare(row);
    if (paid) return mapBasicShare(await recordBasicSharePayment(row));
    await reverseBasicSharePayment(row);
    const undone = await query(`
      UPDATE basic_shares SET paid = FALSE, paid_at = NULL WHERE id = $1 RETURNING *
    `, [id]);
    return mapBasicShare(undone.rows[0]);
  });
}

async function settleBasicPerson(input) {
  return withTransaction(() => settleBasicPersonTx(input));
}

async function settleBasicPersonTx({ memberId, memberName }) {
  const id = String(memberId || "").trim();
  const name = String(memberName || "").trim();
  if (!id && !name) throw new Error("Thiếu người cần cập nhật.");
  await lockFinancialPeople([{member_id: id, member_name: name}]);
  const result = await query(
    id
      ? "SELECT * FROM basic_shares WHERE member_id = $1 AND paid = FALSE ORDER BY id FOR UPDATE"
      : "SELECT * FROM basic_shares WHERE member_id = '' AND member_name_ci = $1 AND paid = FALSE ORDER BY id FOR UPDATE",
    [id || safeLower(name)],
  );
  if (!result.rows.length) throw new Error("Người này không còn phần nào chưa trả.");
  for (const row of result.rows) await recordBasicSharePayment(row);
  return getBasicLedger();
}

async function deleteBasicSession(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) throw new Error("Thiếu mã buổi.");
  return withTransaction(async () => {
    const people = await query("SELECT * FROM basic_shares WHERE basic_session_id = $1", [id]);
    await lockFinancialPeople(people.rows);
    const session = await query("SELECT basic_session_id FROM basic_sessions WHERE basic_session_id = $1 FOR UPDATE", [id]);
    if (!session.rows.length) throw new Error("Không tìm thấy buổi.");
    const parts = await query("SELECT * FROM basic_shares WHERE basic_session_id = $1 ORDER BY id FOR UPDATE", [id]);
    for (const row of parts.rows) if (row.paid) await reverseBasicSharePayment(row);
    await query("DELETE FROM basic_sessions WHERE basic_session_id = $1", [id]);
    return { id };
  });
}

module.exports = {getBasicLedger,createBasicSession,setBasicSharePaid,settleBasicPerson,deleteBasicSession};
