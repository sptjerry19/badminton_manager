"use strict";
const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");

// Fail closed trước khi import tầng DB, không fallback về .env hoặc DB ứng dụng.
const url = process.env.MONEY_TEST_URL;
if (!url || url !== process.env.POSTGRES_URL) throw new Error("Chạy bằng npm run test:money; không dùng POSTGRES_URL ứng dụng.");
const parsed = new URL(url);
if (!["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    !/^\/badminton_money_test_[a-f0-9]{12}$/.test(parsed.pathname)) {
  throw new Error("Chỉ chấp nhận DB kiểm thử local do runner tạo.");
}
const db = require("../src/postgres");
const { pool, initializeDatabase, createBasicSession, addMemberCredit, settleBasicPerson,
  setBasicSharePaid, deleteBasicSession, getBasicLedger } = db;

const A = "money-test-a";
const B = "money-test-b";
const session = (extra = {}) => createBasicSession({
  date: "2026-11-05", court: "Sân kiểm thử", courtFee: 100000,
  shuttleFee: 0, extraFee: 0, memberIds: [A], guestNames: [], ...extra,
});
const credit = (amount, memberId = A) => addMemberCredit({memberId, amount, note: "Dữ liệu kiểm thử"});
async function balance(memberId = A) {
  return Number((await pool.query("SELECT COALESCE(SUM(amount),0)::text AS total FROM member_credits WHERE member_id=$1", [memberId])).rows[0].total);
}
async function shares() { return (await pool.query("SELECT * FROM basic_shares ORDER BY id")).rows; }

before(async () => {
  const actual = (await pool.query("SELECT current_database() AS name")).rows[0].name;
  assert.equal(actual, parsed.pathname.slice(1));
  await require("../src/db/migrations").runMigrations(pool);
  await initializeDatabase();
});
beforeEach(async () => {
  await pool.query("TRUNCATE basic_shares, basic_sessions, member_credits, members CASCADE");
  await pool.query("INSERT INTO members(member_id,name) VALUES ($1,'An kiểm thử'),($2,'Bình kiểm thử')", [A, B]);
});
after(async () => { await pool.end(); });

test("Chia tiền giữ đúng tổng, chênh lệch mỗi người tối đa một đồng", async () => {
  const result = await session({courtFee: 100001, memberIds: [A, B], guestNames: ["Khách"]});
  assert.equal(result.shares.length, 3);
  const amounts = result.shares.map(s => s.shareAmount);
  assert.equal(amounts.reduce((a,b) => a+b, 0), 100001);
  assert.equal(Math.max(...amounts) - Math.min(...amounts), 1);
  assert.ok(result.shares.every(s => !s.paid && s.paidAt === ""));
});

test("Chia tổng nhỏ hơn số người không sinh tiền âm hoặc mất tiền", async () => {
  const result = await session({courtFee: 1, memberIds: [A, B], guestNames: ["Khách"]});
  assert.deepEqual(result.shares.map(s => s.shareAmount).sort(), [0,0,1]);
});

test("Loại người trùng khi chọn thành viên và nhập khách", async () => {
  const result = await session({memberIds: [A, A], guestNames: [" Khách   Một ", "khách một"]});
  assert.equal(result.shares.length, 2);
  assert.equal(result.shares.reduce((sum, s) => sum + s.shareAmount, 0), 100000);
});

test("Từ chối tiền âm, tổng bằng không, thiếu người và thành viên không hợp lệ", async () => {
  for (const input of [{courtFee: -1}, {courtFee: 0}, {memberIds: []}, {memberIds: ["không-tồn-tại"]},
    {guestNames: ["An kiểm thử"]}]) {
    await assert.rejects(session(input));
  }
  assert.deepEqual(await getBasicLedger(), []);
});

test("Tạo buổi rollback toàn bộ khi ghi phần tiền thất bại", async () => {
  await pool.query("ALTER TABLE basic_shares ADD CONSTRAINT test_reject_share CHECK (share_amount <> 12345)");
  try {
    await assert.rejects(session({courtFee: 24690, memberIds: [A,B]}));
    assert.deepEqual(await getBasicLedger(), []);
    assert.equal((await shares()).length, 0);
  } finally { await pool.query("ALTER TABLE basic_shares DROP CONSTRAINT test_reject_share"); }
});

test("Nạp và sử dụng tiền dư cho đúng người", async () => {
  await credit(100000);
  await credit(-30000);
  await credit(20000, B);
  assert.equal(await balance(), 70000);
  assert.equal(await balance(B), 20000);
});

test("Từ chối trừ quá số dư và số tiền không hợp lệ mà không đổi sổ", async () => {
  await credit(100000);
  await assert.rejects(credit(-100001));
  await assert.rejects(credit(0));
  await assert.rejects(credit(50000, "không-tồn-tại"));
  assert.equal(await balance(), 100000);
  assert.equal(Number((await pool.query("SELECT count(*) FROM member_credits")).rows[0].count), 1);
});

test("Tất toán nhiều buổi chỉ dùng đủ tiền dư, không ảnh hưởng người khác", async () => {
  await session({courtFee: 60000});
  await session({courtFee: 40000});
  await session({memberIds: [B]});
  await credit(150000);
  await settleBasicPerson({memberId: A});
  assert.equal(await balance(), 50000);
  const rows = await shares();
  assert.ok(rows.filter(s => s.member_id === A).every(s => s.paid && s.paid_at));
  assert.ok(rows.filter(s => s.member_id === B).every(s => !s.paid));
});

test("Tất toán với tiền dư ít hơn nợ không làm số dư âm", async () => {
  await session();
  await credit(30000);
  await settleBasicPerson({memberId: A});
  assert.equal(await balance(), 0);
  assert.ok((await shares()).every(s => s.paid));
});

test("Tất toán lặp không trừ tiền dư lần hai", async () => {
  await session();
  await credit(150000);
  await settleBasicPerson({memberId: A});
  await assert.rejects(settleBasicPerson({memberId: A}));
  assert.equal(await balance(), 50000);
});

test("Tất toán rollback trạng thái đã trả nếu ghi trừ tiền dư thất bại", async () => {
  await session();
  await credit(100000);
  await pool.query("ALTER TABLE member_credits ADD CONSTRAINT test_reject_debit CHECK (amount >= 0)");
  try {
    await assert.rejects(settleBasicPerson({memberId: A}));
    assert.equal(await balance(), 100000);
    assert.ok((await shares()).every(s => !s.paid && s.paid_at === null));
  } finally { await pool.query("ALTER TABLE member_credits DROP CONSTRAINT test_reject_debit"); }
});

test("Tất toán khách chỉ thay đổi khách được chọn", async () => {
  await session({guestNames: ["Khách Một", "Khách Hai"]});
  await settleBasicPerson({memberName: "khách một"});
  const rows = await shares();
  assert.equal(rows.find(s => s.member_name === "Khách Một").paid, true);
  assert.ok(rows.filter(s => s.member_name !== "Khách Một").every(s => !s.paid));
});

test("Đánh dấu và bỏ đánh dấu trả tiền lưu timestamp phù hợp", async () => {
  const created = await session();
  const id = created.shares[0].id;
  const paid = await setBasicSharePaid(id, true);
  assert.ok(paid.paid && paid.paidAt);
  const undone = await setBasicSharePaid(id, false);
  assert.equal(undone.paid, false);
  assert.equal(undone.paidAt, "");
  await assert.rejects(setBasicSharePaid(id, "true"));
});

test("Xóa buổi chưa trả xóa hết phần tiền của buổi, giữ buổi khác", async () => {
  const first = await session();
  const second = await session({memberIds: [B]});
  await deleteBasicSession(first.id);
  const ledger = await getBasicLedger();
  assert.deepEqual(ledger.map(s => s.id), [second.id]);
  assert.equal((await shares()).length, 1);
});

test("Hai yêu cầu tất toán cùng người không trừ tiền hai lần", async () => {
  await session();
  await credit(150000);
  const outcomes = await Promise.allSettled([
    settleBasicPerson({memberId: A}), settleBasicPerson({memberId: A}),
  ]);
  assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(await balance(), 50000);
});

// Khóa PostgreSQL tạo lịch xen kẽ tái hiện được, không mock SQL và không dựa vào sleep.
// Cả hai tác vụ phải đang chờ khóa (ở INSERT hoặc khóa nghiệp vụ) trước khi mở cổng.
async function overlapDebits(first, second) {
  const gate = await pool.connect();
  const key = 719513882;
  let outcomes;
  try {
    await gate.query("SELECT pg_advisory_lock($1)", [key]);
    await pool.query(`
      CREATE FUNCTION money_test_debit_gate() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.amount < 0 THEN PERFORM pg_advisory_xact_lock(719513882); END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER money_test_debit_gate BEFORE INSERT ON member_credits
        FOR EACH ROW EXECUTE FUNCTION money_test_debit_gate();
    `);
    outcomes = Promise.allSettled([first(), second()]);
    let blocked = false;
    for (let i = 0; i < 200; i++) {
      const waiting = await pool.query(`
        SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname = current_database() AND application_name = $1 AND wait_event_type = 'Lock'
      `, [process.env.PGAPPNAME]);
      if (waiting.rows[0].count >= 2) { blocked = true; break; }
      await delay(25);
    }
    assert.ok(blocked, "Không đạt lịch xen kẽ yêu cầu; đây là lỗi harness, không phải bằng chứng nghiệp vụ đúng.");
  } finally {
    await gate.query("SELECT pg_advisory_unlock($1)", [key]);
    gate.release();
    if (outcomes) await outcomes;
    await pool.query("DROP TRIGGER IF EXISTS money_test_debit_gate ON member_credits; DROP FUNCTION IF EXISTS money_test_debit_gate()");
  }
  return outcomes;
}

test("[DEBT-01] Hai khoản trừ đồng thời không được vượt số dư", async () => {
  await credit(100000);
  const outcomes = await overlapDebits(() => credit(-80000), () => credit(-80000));
  const current = await balance();
  assert.ok(current >= 0, "100.000đ bị hai lần trừ 80.000đ; thực tế còn " + current);
  assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
});

test("[DEBT-02] Tất toán đồng thời với trừ tiền thủ công không làm âm số dư", async () => {
  await session({courtFee: 80000});
  await credit(100000);
  await overlapDebits(() => settleBasicPerson({memberId: A}), () => credit(-80000));
  assert.ok(await balance() >= 0, "Tất toán và khoản trừ thủ công đã sử dụng trùng tiền dư.");
});

test("[DEBT-03] Hoàn tác phần tiền đã dùng tiền dư phải hoàn lại số dư", async () => {
  const created = await session();
  await credit(100000);
  await settleBasicPerson({memberId: A});
  await setBasicSharePaid(created.shares[0].id, false);
  assert.equal(await balance(), 100000, "Mở lại khoản nợ phải hoàn khoản tiền dư đã sử dụng.");
  assert.equal((await shares())[0].paid, false);
});

test("[DEBT-04] Xóa buổi đã dùng tiền dư phải hoàn lại khoản tiền liên quan", async () => {
  const created = await session();
  await credit(100000);
  await settleBasicPerson({memberId: A});
  await deleteBasicSession(created.id);
  assert.equal(await balance(), 100000, "Xóa buổi chưa đối ứng khoản trừ tiền dư.");
  assert.deepEqual(await getBasicLedger(), []);
});

test("[DEBT-05] Đánh dấu đã trả lặp không được thay đổi ngày thu tiền", async () => {
  const created = await session();
  const id = created.shares[0].id;
  await setBasicSharePaid(id, true);
  const original = "2026-10-31T12:00:00.000Z";
  await pool.query("UPDATE basic_shares SET paid_at=$2 WHERE id=$1", [id, original]);
  const repeated = await setBasicSharePaid(id, true);
  assert.equal(repeated.paidAt, original, "Yêu cầu lặp đã thay đổi thời điểm thanh toán.");
});

test("Đánh dấu từng phần cũng dùng tiền dư và lưu phân bổ", async () => {
  const created = await session();
  await credit(30000);
  await setBasicSharePaid(created.shares[0].id, true);
  assert.equal(await balance(), 0);
  const payment = (await pool.query("SELECT * FROM basic_share_settlements")).rows[0];
  assert.equal(payment.credit_used, 30000);
  assert.equal(payment.share_amount, 100000);
  assert.ok(payment.debit_credit_id);
});

test("Hoàn tác một buổi chỉ hoàn đúng tiền dư đã phân bổ cho buổi đó", async () => {
  const first = await session({courtFee: 60000});
  const second = await session({courtFee: 60000});
  await credit(100000);
  await settleBasicPerson({memberId: A});
  await setBasicSharePaid(second.shares[0].id, false);
  assert.equal(await balance(), 40000);
  const ledger = await getBasicLedger();
  assert.equal(ledger.find(s => s.id === first.id).shares[0].paid, true);
  assert.equal(ledger.find(s => s.id === second.id).shares[0].paid, false);
});

test("Hoàn tác lặp hoặc đồng thời không hoàn tiền hai lần", async () => {
  const created = await session();
  await credit(100000);
  await settleBasicPerson({memberId: A});
  const id = created.shares[0].id;
  await Promise.all([setBasicSharePaid(id, false), setBasicSharePaid(id, false)]);
  await setBasicSharePaid(id, false);
  assert.equal(await balance(), 100000);
  const refunds = await pool.query("SELECT * FROM basic_share_settlements WHERE refund_credit_id IS NOT NULL");
  assert.equal(refunds.rows.length, 1);
});

test("Trả lại sau hoàn tác lưu chu kỳ mới và dùng tiền đúng một lần", async () => {
  const created = await session();
  await credit(150000);
  const id = created.shares[0].id;
  await setBasicSharePaid(id, true);
  await setBasicSharePaid(id, false);
  await setBasicSharePaid(id, true);
  assert.equal(await balance(), 50000);
  const rows = (await pool.query("SELECT * FROM basic_share_settlements")).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows.filter(r => r.reversed_at === null).length, 1);
});

test("Xóa buổi giữ lịch sử đối ứng; xóa lần hai không hoàn thêm tiền", async () => {
  const created = await session();
  await credit(100000);
  await settleBasicPerson({memberId: A});
  await deleteBasicSession(created.id);
  await assert.rejects(deleteBasicSession(created.id));
  assert.equal(await balance(), 100000);
  const rows = (await pool.query("SELECT * FROM basic_share_settlements")).rows;
  assert.equal(rows.length, 1);
  assert.ok(rows[0].reversed_at && rows[0].refund_credit_id && rows[0].debit_credit_id);
});

test("Hoàn tác rollback cả số dư, trạng thái và lịch sử nếu ghi đối ứng lỗi", async () => {
  const created = await session();
  await credit(100000);
  await settleBasicPerson({memberId: A});
  await pool.query("ALTER TABLE member_credits ADD CONSTRAINT test_reject_refund CHECK (amount <= 0 OR note = 'Dữ liệu kiểm thử')");
  try {
    await assert.rejects(setBasicSharePaid(created.shares[0].id, false));
    assert.equal(await balance(), 0);
    assert.equal((await shares())[0].paid, true);
    const payment = (await pool.query("SELECT * FROM basic_share_settlements")).rows[0];
    assert.equal(payment.reversed_at, null);
    assert.equal(payment.refund_credit_id, null);
  } finally { await pool.query("ALTER TABLE member_credits DROP CONSTRAINT test_reject_refund"); }
});

test("Xóa buổi nhiều người rollback toàn bộ nếu một đối ứng thất bại", async () => {
  const created = await session({courtFee: 200000, memberIds: [A,B]});
  await credit(100000);
  await credit(100000, B);
  await settleBasicPerson({memberId: A});
  await settleBasicPerson({memberId: B});
  await pool.query("ALTER TABLE member_credits ADD CONSTRAINT test_reject_b_refund CHECK (NOT (member_id = 'money-test-b' AND amount > 0 AND note <> 'Dữ liệu kiểm thử'))");
  try {
    await assert.rejects(deleteBasicSession(created.id));
    assert.equal(await balance(), 0);
    assert.equal(await balance(B), 0);
    assert.equal((await getBasicLedger()).length, 1);
    assert.ok((await shares()).every(s => s.paid));
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM basic_share_settlements WHERE reversed_at IS NOT NULL")).rows[0].count, 0);
  } finally { await pool.query("ALTER TABLE member_credits DROP CONSTRAINT test_reject_b_refund"); }
});

test("Khoản thành viên cũ thiếu lịch sử không được tự suy đoán hoàn tiền", async () => {
  const created = await session();
  await credit(100000);
  // Mô phỏng dữ liệu trước nâng cấp: đã trả và khoản trừ cũ không liên kết.
  await pool.query("UPDATE basic_shares SET paid = TRUE, paid_at = NOW()");
  await credit(-100000);
  await assert.rejects(setBasicSharePaid(created.shares[0].id, false), /đối soát/);
  await assert.rejects(deleteBasicSession(created.id), /đối soát/);
  assert.equal(await balance(), 0);
  assert.equal((await shares())[0].paid, true);
});

test("Khoản khách cũ không có tài khoản tiền dư vẫn hoàn tác được", async () => {
  const created = await session({memberIds: [], guestNames: ["Khách cũ"]});
  await pool.query("UPDATE basic_shares SET paid = TRUE, paid_at = NOW()");
  await setBasicSharePaid(created.shares[0].id, false);
  assert.equal((await shares())[0].paid, false);
});

test("Khởi tạo schema lặp giữ nguyên lịch sử thanh toán và phân bổ", async () => {
  const created = await session();
  await credit(100000);
  await settleBasicPerson({memberId: A});
  await initializeDatabase();
  await setBasicSharePaid(created.shares[0].id, false);
  assert.equal(await balance(), 100000);
});

test("Không xóa thành viên có sổ tiền; vẫn xóa được thành viên chưa có lịch sử", async () => {
  await credit(100000);
  await assert.rejects(db.deleteMember(A), /lịch sử/);
  assert.equal(await balance(), 100000);
  await db.deleteMember(B);
  assert.equal((await pool.query("SELECT * FROM members WHERE member_id=$1", [B])).rows.length, 0);
});

test("Xóa buổi và hoàn tác cùng lúc không hoàn trùng tiền dư", async () => {
  const created = await session();
  await credit(100000);
  await settleBasicPerson({memberId: A});
  await Promise.allSettled([deleteBasicSession(created.id), setBasicSharePaid(created.shares[0].id, false)]);
  assert.equal(await balance(), 100000);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM basic_share_settlements WHERE refund_credit_id IS NOT NULL")).rows[0].count, 1);
});

test("Gửi lại mã giao dịch nạp hoặc trừ không ghi tiền hai lần", async () => {
  const deposit = {memberId: A, amount: 100000, note: "Nạp", requestId: "deposit-retry-0001"};
  await Promise.all([addMemberCredit(deposit), addMemberCredit(deposit)]);
  assert.equal(await balance(), 100000);
  const debit = {memberId: A, amount: -80000, note: "Trừ", requestId: "debit-retry-000001"};
  await Promise.all([addMemberCredit(debit), addMemberCredit(debit)]);
  assert.equal(await balance(), 20000);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM member_credits")).rows[0].count, 2);
});

test("Không tái sử dụng mã yêu cầu cho số tiền hoặc ghi chú khác", async () => {
  const input = {memberId: A, amount: 100000, note: "Nạp", requestId: "credit-request-00001"};
  await addMemberCredit(input);
  await assert.rejects(addMemberCredit({...input, amount: 200000}), /giao dịch khác/);
  await assert.rejects(addMemberCredit({...input, note: "Đổi nội dung"}), /giao dịch khác/);
  await assert.rejects(addMemberCredit({...input, requestId: "x"}), /Mã yêu cầu/);
  assert.equal(await balance(), 100000);
});

async function payAt(amount, when, prepaid = 0, playDate = "2026-10-01") {
  const created = await session({courtFee: amount, date: playDate});
  if (prepaid) await credit(prepaid);
  await setBasicSharePaid(created.shares[0].id, true);
  await pool.query("UPDATE basic_share_settlements SET settled_at=$2 WHERE share_id=$1", [created.shares[0].id, when]);
  await pool.query("UPDATE basic_shares SET paid_at=$2 WHERE id=$1", [created.shares[0].id, when]);
  return created;
}

test("Báo cáo theo ngày thanh toán thay vì tháng chơi, tách tiền dư khỏi thu mới", async () => {
  await payAt(100000, "2026-11-01T00:30:00+07:00", 20000);
  const november = await db.getBasicMonthlyReport("2026-11");
  assert.equal(november.cashReceived, 80000);
  assert.equal(november.creditUsed, 20000);
  assert.equal(november.netSettledAmount, 100000);
  assert.equal(november.settlementCount, 1);
  assert.equal((await db.getBasicMonthlyReport("2026-10")).cashReceived, 0);
});

test("Báo cáo chọn đúng ranh giới tháng theo Việt Nam", async () => {
  await payAt(111, "2026-10-31T16:59:59.999Z");
  await payAt(222, "2026-10-31T17:00:00.000Z");
  await payAt(333, "2026-11-30T16:59:59.999Z");
  await payAt(444, "2026-11-30T17:00:00.000Z");
  const report = await db.getBasicMonthlyReport("2026-11");
  assert.equal(report.cashReceived, 555);
  assert.equal(report.settlementCount, 2);
  assert.equal(report.timeZone, "Asia/Ho_Chi_Minh");
});

test("Đảo tháng sau ghi giảm tháng sau, không thay đổi số thu tháng trước", async () => {
  const created = await payAt(100000, "2026-10-31T16:00:00Z", 20000);
  await setBasicSharePaid(created.shares[0].id, false);
  await pool.query("UPDATE basic_share_settlements SET reversed_at='2026-11-01T00:00:00+07:00'");
  const october = await db.getBasicMonthlyReport("2026-10");
  const november = await db.getBasicMonthlyReport("2026-11");
  assert.equal(october.netCashReceived, 80000);
  assert.equal(october.netCreditUsed, 20000);
  assert.equal(november.netCashReceived, -80000);
  assert.equal(november.netCreditUsed, -20000);
  assert.equal(november.reversalCount, 1);
});

test("Thanh toán rồi đảo trong cùng tháng có thu ròng bằng không", async () => {
  const created = await payAt(100000, "2026-11-01T03:00:00+07:00", 30000);
  await setBasicSharePaid(created.shares[0].id, false);
  await pool.query("UPDATE basic_share_settlements SET reversed_at='2026-11-02T01:00:00+07:00'");
  const report = await db.getBasicMonthlyReport("2026-11");
  assert.equal(report.cashReceived, 70000);
  assert.equal(report.cashReversed, 70000);
  assert.equal(report.creditRestored, 30000);
  assert.equal(report.netCashReceived, 0);
  assert.equal(report.netSettledAmount, 0);
});

test("Xóa buổi vẫn giữ đúng số thu và đảo trong lịch sử báo cáo", async () => {
  const created = await payAt(100000, "2026-11-01T03:00:00+07:00");
  await deleteBasicSession(created.id);
  await pool.query("UPDATE basic_share_settlements SET reversed_at='2026-11-02T01:00:00+07:00'");
  const report = await db.getBasicMonthlyReport("2026-11");
  assert.equal(report.settlementCount, 1);
  assert.equal(report.reversalCount, 1);
  assert.equal(report.netCashReceived, 0);
});

test("Khoản cũ thiếu phân bổ hoặc ngày trả được báo riêng, không suy đoán thu mới", async () => {
  const dated = await session({courtFee: 100000});
  const undated = await session({courtFee: 70000});
  await pool.query("UPDATE basic_shares SET paid=TRUE, paid_at='2026-11-01T01:00:00+07:00' WHERE basic_session_id=$1", [dated.id]);
  await pool.query("UPDATE basic_shares SET paid=TRUE, paid_at=NULL WHERE basic_session_id=$1", [undated.id]);
  const november = await db.getBasicMonthlyReport("2026-11");
  assert.equal(november.cashReceived, 0);
  assert.equal(november.legacyPaidCount, 1);
  assert.equal(november.legacyPaidAmount, 100000);
  assert.equal(november.undatedLegacyPaidCount, 1);
  assert.equal(november.undatedLegacyPaidAmount, 70000);
  const december = await db.getBasicMonthlyReport("2026-12");
  assert.equal(december.legacyPaidCount, 0);
  assert.equal(december.undatedLegacyPaidCount, 1);
});

test("Nạp trước và dùng toàn bộ tiền dư không tạo thu tiền sân mới", async () => {
  await credit(50000);
  await payAt(50000, "2026-11-01T01:00:00+07:00");
  const report = await db.getBasicMonthlyReport("2026-11");
  assert.equal(report.cashReceived, 0);
  assert.equal(report.creditUsed, 50000);
  assert.equal(report.settledAmount, 50000);
});

test("Báo cáo xử lý tháng nhuận và tháng cuối năm", async () => {
  await payAt(100, "2024-02-29T23:59:59+07:00");
  await payAt(200, "2024-03-01T00:00:00+07:00");
  await payAt(300, "2026-12-31T23:59:59+07:00");
  await payAt(400, "2027-01-01T00:00:00+07:00");
  assert.equal((await db.getBasicMonthlyReport("2024-02")).cashReceived, 100);
  assert.equal((await db.getBasicMonthlyReport("2026-12")).cashReceived, 300);
});

test("Từ chối tháng không hợp lệ trước khi truy vấn báo cáo", async () => {
  for (const month of ["2026-00", "2026-13", "2026-1", "2026-11-01", "", "abc"]) {
    await assert.rejects(db.getBasicMonthlyReport(month), /YYYY-MM/);
  }
});

test("API báo cáo chỉ cho admin và trả tháng được yêu cầu", async () => {
  const crypto = require("node:crypto");
  const app = require("../server");
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    assert.equal((await fetch(base + "/api/basic/report?month=2026-11")).status, 401);
    const {SESSION_SECRET} = require("../src/config");
    async function cookie(role) {
      const sid = crypto.randomUUID();
      await pool.query("INSERT INTO login_sessions(sid,sess,expire) VALUES ($1,$2,NOW()+INTERVAL '1 hour')",
        [sid, JSON.stringify({cookie:{originalMaxAge:3600000,httpOnly:true,path:"/"},authenticated:true,role,memberName:"An kiểm thử"})]);
      const sig = crypto.createHmac("sha256", SESSION_SECRET).update(sid).digest("base64").replace(/=+$/, "");
      return "bgm.sid=" + encodeURIComponent("s:" + sid + "." + sig);
    }
    const userCookie = await cookie("user");
    const adminCookie = await cookie("admin");
    assert.equal((await fetch(base + "/api/basic/report?month=2026-11", {headers:{cookie:userCookie}})).status, 403);
    const response = await fetch(base + "/api/basic/report?month=2026-11", {headers:{cookie:adminCookie}});
    assert.equal(response.status, 200);
    assert.equal((await response.json()).month, "2026-11");
    assert.equal((await fetch(base + "/api/basic/report?month=2026-13", {headers:{cookie:adminCookie}})).status, 400);
    const personal = await fetch(base + "/api/basic", {headers:{cookie:userCookie}});
    assert.equal(Object.hasOwn(await personal.json(), "monthlyReport"), false);
    const admin = await fetch(base + "/api/basic", {headers:{cookie:adminCookie}});
    assert.equal((await admin.json()).monthlyReport.timeZone, "Asia/Ho_Chi_Minh");
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test("Lịch sắp tới và poll không giữ buổi đã qua theo giờ Việt Nam", async () => {
  const time = require("../public/business-time");
  const past = time.dateTimeKey(new Date(Date.now() - 60 * 60 * 1000));
  await db.createSession({date:past.slice(0,10),time:past.slice(11),pollQuestion:"Có tham gia?"});
  assert.equal(await db.getUpcomingSessionForMember("An kiểm thử"), null);
  assert.equal(await db.getActivePollForMember("An kiểm thử"), null);
  const future = time.dateTimeKey(new Date(Date.now() + 60 * 60 * 1000));
  const created = await db.createSession({date:future.slice(0,10),time:future.slice(11),pollQuestion:"Có tham gia?"});
  assert.equal((await db.getUpcomingSessionForMember("An kiểm thử")).sessionId, created.sessionId);
  assert.equal((await db.getActivePollForMember("An kiểm thử")).sessionId, created.sessionId);
});

test("Transaction từ facade rollback đồng thời tiền dư, thanh toán và báo cáo qua module", async () => {
  const created = await session();
  await assert.rejects(db.withTransaction(async () => {
    await credit(150000);
    await setBasicSharePaid(created.shares[0].id, true);
    const summary = await db.getMemberCreditSummary();
    assert.equal(summary.balances.find(b => b.memberId === A).balance, 50000);
    const report = await db.getBasicMonthlyReport();
    assert.equal(report.creditUsed, 100000);
    assert.equal(report.cashReceived, 0);
    throw new Error("Rollback kiểm thử xuyên module");
  }), /xuyên module/);
  assert.equal(await balance(), 0);
  assert.equal((await shares())[0].paid, false);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM basic_share_settlements")).rows[0].count, 0);
  assert.equal((await db.getBasicMonthlyReport()).settlementCount, 0);
});

test("Transaction lồng qua module commit đúng một lần và báo cáo thấy số liệu mới", async () => {
  const created = await session();
  await db.withTransaction(async () => {
    await db.withTransaction(() => credit(50000));
    await setBasicSharePaid(created.shares[0].id, true);
    const report = await db.getBasicMonthlyReport();
    assert.equal(report.creditUsed, 50000);
    assert.equal(report.netCashReceived, 50000);
  });
  assert.equal(await balance(), 0);
  assert.equal((await shares())[0].paid, true);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM basic_share_settlements")).rows[0].count, 1);
});

test("Buổi tiền sân vẫn kiểm tra và giữ liên kết vote sau khi tách module", async () => {
  await assert.rejects(session({voteSessionId:"missing-vote"}), /Không tìm thấy buổi vote/);
  const vote = await db.createSession({date:"2026-11-05",time:"18:00"});
  const created = await session({voteSessionId:vote.sessionId});
  assert.equal(created.voteSessionId, vote.sessionId);
});
