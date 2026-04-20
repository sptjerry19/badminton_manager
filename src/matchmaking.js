function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildPairKey(a, b) {
  return [a, b].sort((x, y) => x.localeCompare(y)).join("|");
}

function getPairScore(pair, pairHistory, roundPairCount) {
  const key = buildPairKey(pair[0].name, pair[1].name);
  return (pairHistory[key] || 0) * 10 + (roundPairCount[key] || 0);
}

function teamLevel(team) {
  return team.reduce((sum, p) => sum + toNumber(p.level, 5), 0);
}

function enumerateChunkAssignments(chunk) {
  if (chunk.length !== 4) return [];
  const [a, b, c, d] = chunk;
  return [
    {
      teamA: [a, d],
      teamB: [b, c]
    },
    {
      teamA: [a, c],
      teamB: [b, d]
    },
    {
      teamA: [a, b],
      teamB: [c, d]
    }
  ];
}

function pickBestAssignment(chunk, pairHistory, roundPairCount) {
  const candidates = enumerateChunkAssignments(chunk).map((candidate) => {
    const levelDiff = Math.abs(teamLevel(candidate.teamA) - teamLevel(candidate.teamB));
    const pairPenalty =
      getPairScore(candidate.teamA, pairHistory, roundPairCount) +
      getPairScore(candidate.teamB, pairHistory, roundPairCount);
    const hardPenalty = levelDiff > 2 ? 50 : 0;
    return {
      ...candidate,
      levelDiff,
      score: pairPenalty + levelDiff + hardPenalty
    };
  });

  candidates.sort((x, y) => x.score - y.score);
  return candidates[0];
}

function rotateList(list, shift) {
  if (!list.length) return list;
  const normalized = ((shift % list.length) + list.length) % list.length;
  return [...list.slice(normalized), ...list.slice(0, normalized)];
}

function selectWaitingPlayers(players, waitQueue, waitPointerRef, waitCount, benchStreakMap) {
  if (waitCount <= 0) return [];
  const waiting = [];
  const selected = new Set();
  const maxAttempts = players.length * 3;
  let attempts = 0;

  // Round-robin selection with hard rule: no one benches 3 rounds in a row.
  while (waiting.length < waitCount && attempts < maxAttempts) {
    const candidate = waitQueue[waitPointerRef.value % waitQueue.length];
    waitPointerRef.value += 1;
    attempts += 1;
    if (!candidate || selected.has(candidate.name)) continue;
    if ((benchStreakMap[candidate.name] || 0) >= 2) continue;
    selected.add(candidate.name);
    waiting.push(candidate);
  }

  // Fallback only when constraints are impossible in edge cases.
  if (waiting.length < waitCount) {
    const fallback = players
      .filter((player) => !selected.has(player.name))
      .sort((a, b) => (benchStreakMap[a.name] || 0) - (benchStreakMap[b.name] || 0));
    for (let i = 0; i < fallback.length && waiting.length < waitCount; i += 1) {
      waiting.push(fallback[i]);
    }
  }

  return waiting;
}

function generateMatchPlan(participants, pairHistory, roundCount = 2) {
  const eligible = [...participants].sort((a, b) => toNumber(b.level, 5) - toNumber(a.level, 5));
  if (eligible.length < 4) {
    throw new Error("Cần ít nhất 4 người xác nhận tham gia để xếp trận.");
  }

  const waitCount = eligible.length % 4;
  const waitQueue = [...eligible].sort((a, b) => a.name.localeCompare(b.name));
  const waitPointerRef = { value: 0 };

  const rounds = [];
  const localPairCount = {};
  const benchStreakMap = {};

  for (let round = 1; round <= roundCount; round += 1) {
    const waitingPlayers = selectWaitingPlayers(eligible, waitQueue, waitPointerRef, waitCount, benchStreakMap);
    const waitingSet = new Set(waitingPlayers.map((player) => player.name));
    const playingPlayers = eligible.filter((player) => !waitingSet.has(player.name));

    if (playingPlayers.length < 4 || playingPlayers.length % 4 !== 0) {
      throw new Error("Không thể chia đội hợp lệ với số người hiện tại.");
    }

    const arranged = rotateList(playingPlayers, round - 1);
    const matches = [];

    for (let i = 0; i < arranged.length; i += 4) {
      const chunk = arranged.slice(i, i + 4);
      if (chunk.length < 4) continue;
      const match = pickBestAssignment(chunk, pairHistory, localPairCount);
      const pairA = buildPairKey(match.teamA[0].name, match.teamA[1].name);
      const pairB = buildPairKey(match.teamB[0].name, match.teamB[1].name);
      localPairCount[pairA] = (localPairCount[pairA] || 0) + 1;
      localPairCount[pairB] = (localPairCount[pairB] || 0) + 1;

      matches.push({
        teamA: match.teamA,
        teamB: match.teamB,
        levelDiff: match.levelDiff
      });
    }

    eligible.forEach((player) => {
      if (waitingSet.has(player.name)) {
        benchStreakMap[player.name] = (benchStreakMap[player.name] || 0) + 1;
      } else {
        benchStreakMap[player.name] = 0;
      }
    });

    rounds.push({
      round,
      waiting: waitingPlayers.map((p) => p.name),
      matches
    });
  }

  return rounds;
}

module.exports = {
  buildPairKey,
  generateMatchPlan
};
