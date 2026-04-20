const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const APP_PASSWORD = process.env.APP_PASSWORD || "123456";
const SESSION_SECRET = process.env.SESSION_SECRET || "badminton-session-secret";
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || "";
const GOOGLE_APPLICATION_CREDENTIALS =
  process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(process.cwd(), "credentials.json");

const DEFAULT_SETTINGS = {
  extraCourtRate: 300000,
  maleGuestRate: 80000,
  femaleGuestRate: 60000,
  highThreshold: 12,
  lowThreshold: 8
};

const DEFAULT_FIXED_MEMBERS = [
  "Duy linh",
  "Phuong thao",
  "Quynh chi",
  "Ngoc anh",
  "Khanh loan",
  "Thanh nhan",
  "Quang nhat"
];

module.exports = {
  PORT,
  APP_PASSWORD,
  SESSION_SECRET,
  GOOGLE_SHEET_ID,
  GOOGLE_APPLICATION_CREDENTIALS,
  DEFAULT_SETTINGS,
  DEFAULT_FIXED_MEMBERS
};
