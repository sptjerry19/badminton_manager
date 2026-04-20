function normalizeGender(gender) {
  const value = String(gender || "").trim().toLowerCase();
  if (value === "nam" || value === "male" || value === "m") return "Nam";
  if (value === "nu" || value === "nữ" || value === "female" || value === "f") return "Nữ";
  return "Nam";
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round(value);
}

function calculateSession(payload, settings) {
  const date = String(payload.date || "").trim();
  if (!date) throw new Error("Thiếu ngày đánh cầu.");

  const fixedCourtCost = toNumber(payload.fixedCourtCost);
  const extraCourts = Math.max(0, toNumber(payload.extraCourts));
  const shuttlecockCost = toNumber(payload.shuttlecockCost);

  const fixedMembers = Array.isArray(payload.fixedMembers) ? payload.fixedMembers : [];
  const guestsInput = Array.isArray(payload.guests) ? payload.guests : [];

  const fixedParticipants = fixedMembers.map((item) => ({
    name: String(item.name || "").trim(),
    type: "Cố định",
    gender: "",
    present: Boolean(item.present),
    amount: 0
  }));

  const guests = guestsInput
    .map((item) => ({
      name: String(item.name || "").trim(),
      type: "GL",
      gender: normalizeGender(item.gender),
      present: true,
      amount: 0
    }))
    .filter((item) => item.name);

  if (!fixedParticipants.length) {
    throw new Error("Danh sách thành viên cố định đang trống.");
  }

  const fixedPresent = fixedParticipants.filter((item) => item.present);
  const totalPeople = fixedPresent.length + guests.length;
  if (totalPeople <= 0) throw new Error("Chưa có ai tham gia buổi đánh.");

  const totalCost = fixedCourtCost + extraCourts * settings.extraCourtRate + shuttlecockCost;
  const mode = totalPeople > settings.highThreshold ? "GL_RIENG" : "CHIA_DEU";
  const warnings = [];

  if (totalPeople < settings.lowThreshold && extraCourts > 0) {
    warnings.push("Tổng người dưới ngưỡng thấp; cân nhắc không đặt sân thêm.");
  }

  let totalGuestFee = 0;

  if (mode === "GL_RIENG") {
    guests.forEach((guest) => {
      guest.amount = guest.gender === "Nữ" ? settings.femaleGuestRate : settings.maleGuestRate;
      totalGuestFee += guest.amount;
    });

    const fixedPool = Math.max(totalCost - totalGuestFee, 0);
    const fixedShare = fixedPresent.length ? roundMoney(fixedPool / fixedPresent.length) : 0;
    fixedParticipants.forEach((member) => {
      member.amount = member.present ? fixedShare : 0;
    });

    if (totalGuestFee > totalCost) {
      warnings.push("Tổng phí giao lưu đang lớn hơn tổng chi buổi.");
    }
  } else {
    const perHead = roundMoney(totalCost / totalPeople);
    fixedParticipants.forEach((member) => {
      member.amount = member.present ? perHead : 0;
    });
    guests.forEach((guest) => {
      guest.amount = perHead;
    });
  }

  const participants = [...fixedParticipants, ...guests];
  const totalCollected = participants.reduce((sum, p) => sum + toNumber(p.amount), 0);

  return {
    date,
    fixedCourtCost,
    extraCourts,
    shuttlecockCost,
    totalCost: roundMoney(totalCost),
    totalPeople,
    totalGuestFee: roundMoney(totalGuestFee),
    totalCollected: roundMoney(totalCollected),
    mode,
    warnings,
    participants
  };
}

module.exports = {
  calculateSession
};
