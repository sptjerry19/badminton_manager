"use strict";
const Calendar = require("../public/theme-calendar");

function createThemeConfigHandler({ environment = () => process.env, now = () => new Date(), logger = console } = {}) {
  let lastWarnings = "";
  return (_req, res) => {
    const { schedules, errors } = Calendar.fromEnvironment(environment());
    const warnings = errors.join(" ");
    if (warnings && warnings !== lastWarnings) logger.warn("Cấu hình lịch theme: " + warnings);
    lastWarnings = warnings;
    res.set("Cache-Control", "no-store");
    res.json({
      version: 1,
      timeZone: Calendar.timeZone,
      serverNow: now().toISOString(),
      configValid: errors.length === 0,
      schedules,
    });
  };
}
module.exports = { createThemeConfigHandler };
