"use strict";
const {query} = require("../db/client");
const businessTime = require("../../public/business-time");
const {parseCsvMonth} = require("./values");

// Báo cáo theo sự kiện thanh toán/đảo, không theo ngày chơi hoặc trạng thái hiện tại.
async function getBasicMonthlyReport(month = businessTime.monthKey()) {
  const safeMonth = parseCsvMonth(String(month || "").trim());
  const result = await query(`
    WITH bounds AS (
      SELECT ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AS start_at,
        (($1::date + INTERVAL '1 month')::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AS end_at
    ), payments AS (
      SELECT COALESCE(SUM(s.share_amount - s.credit_used),0)::text AS cash_received,
        COALESCE(SUM(s.credit_used),0)::text AS credit_used,
        COUNT(*)::int AS settlement_count
      FROM basic_share_settlements s CROSS JOIN bounds b
      WHERE s.settled_at >= b.start_at AND s.settled_at < b.end_at
    ), reversals AS (
      SELECT COALESCE(SUM(s.share_amount - s.credit_used),0)::text AS cash_reversed,
        COALESCE(SUM(s.credit_used),0)::text AS credit_restored,
        COUNT(*)::int AS reversal_count
      FROM basic_share_settlements s CROSS JOIN bounds b
      WHERE s.reversed_at >= b.start_at AND s.reversed_at < b.end_at
    ), legacy AS (
      SELECT COUNT(*) FILTER (WHERE s.paid_at >= b.start_at AND s.paid_at < b.end_at)::int AS legacy_paid_count,
        COALESCE(SUM(s.share_amount) FILTER (WHERE s.paid_at >= b.start_at AND s.paid_at < b.end_at),0)::text AS legacy_paid_amount,
        COUNT(*) FILTER (WHERE s.paid_at IS NULL)::int AS undated_legacy_paid_count,
        COALESCE(SUM(s.share_amount) FILTER (WHERE s.paid_at IS NULL),0)::text AS undated_legacy_paid_amount
      FROM basic_shares s CROSS JOIN bounds b
      WHERE s.paid = TRUE AND NOT EXISTS (
        SELECT 1 FROM basic_share_settlements p WHERE p.share_id = s.id AND p.reversed_at IS NULL
      )
    )
    SELECT * FROM payments CROSS JOIN reversals CROSS JOIN legacy
  `, [safeMonth + "-01"]);
  const row = result.rows[0];
  const cashReceived = Number(row.cash_received);
  const cashReversed = Number(row.cash_reversed);
  const creditUsed = Number(row.credit_used);
  const creditRestored = Number(row.credit_restored);
  return {
    month: safeMonth, timeZone: businessTime.timeZone,
    cashReceived, cashReversed, netCashReceived: cashReceived - cashReversed,
    creditUsed, creditRestored, netCreditUsed: creditUsed - creditRestored,
    settledAmount: cashReceived + creditUsed,
    reversedAmount: cashReversed + creditRestored,
    netSettledAmount: cashReceived + creditUsed - cashReversed - creditRestored,
    settlementCount: row.settlement_count, reversalCount: row.reversal_count,
    legacyPaidCount: row.legacy_paid_count, legacyPaidAmount: Number(row.legacy_paid_amount),
    undatedLegacyPaidCount: row.undated_legacy_paid_count,
    undatedLegacyPaidAmount: Number(row.undated_legacy_paid_amount),
  };
}

module.exports = {getBasicMonthlyReport};
