"use strict";

function nowIso() {
  return new Date().toISOString();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeLower(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function parseCsvMonth(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("Tham số month phải có định dạng YYYY-MM.");
  return month;
}

function computeEqualShares(totalAmountRounded, participantCount) {
  const count = Math.max(0, Number(participantCount || 0));
  if (count <= 0) return [];
  const base = Math.floor(totalAmountRounded / count);
  const remainder = totalAmountRounded - base * count;
  // Distribute remainder (+1) to the first `remainder` participants so that:
  // sum(shares) == totalAmountRounded
  return Array.from({ length: count }).map(
    (_item, idx) => base + (idx < remainder ? 1 : 0),
  );
}

module.exports = {nowIso,toNumber,safeLower,parseCsvMonth,computeEqualShares};
