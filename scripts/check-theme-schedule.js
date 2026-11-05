"use strict";
require("dotenv").config({ quiet: true });
const Calendar = require("../public/theme-calendar");
const { schedules, errors } = Calendar.fromEnvironment(process.env);
for (const definition of Calendar.definitions) {
  const rule = schedules.find(item => item.id === definition.id);
  console.log(definition.id + ": " + (rule ? rule.start + " → " + rule.end + " (không gồm ngày END)" : "tắt trong lịch tự động"));
}
for (const error of errors) console.error(error);
if (!schedules.length && !errors.length) console.log("Chưa bật lịch nào; chế độ tự động dùng theme mặc định.");
console.log("Múi giờ: " + Calendar.timeZone);
process.exitCode = errors.length ? 1 : 0;
