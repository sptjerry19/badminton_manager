/**
 * Circle method round-robin for an array of pair ids.
 * Returns [{ round, matchNo, pairAId, pairBId }]
 */
function generateRoundRobin(pairIds) {
  const ids = (Array.isArray(pairIds) ? pairIds : []).map((id) => String(id || "").trim()).filter(Boolean);
  if (ids.length < 2) return [];

  const list = [...ids];
  if (list.length % 2 === 1) list.push("__BYE__");
  const n = list.length;
  const rounds = n - 1;
  const half = n / 2;
  const matches = [];
  let arr = [...list];

  for (let round = 1; round <= rounds; round += 1) {
    let matchNo = 1;
    for (let i = 0; i < half; i += 1) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== "__BYE__" && b !== "__BYE__") {
        matches.push({
          round,
          matchNo,
          pairAId: a,
          pairBId: b
        });
        matchNo += 1;
      }
    }
    // rotate: keep index 0 fixed
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }
  return matches;
}

module.exports = { generateRoundRobin };
