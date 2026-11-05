"use strict";
const {isProduction} = require("../runtime-config");
const {DEFAULT_FIXED_MEMBERS} = require("../config");
async function seedDemo(pool,env = process.env) {
  if (isProduction(env)) throw new Error("Không seed thành viên mẫu trong production.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(719513884)");
    const existing = (await client.query("SELECT COUNT(*)::int AS count FROM members")).rows[0].count;
    if (existing) throw new Error("Chỉ seed demo khi danh sách thành viên trống.");
    for (let i=0;i<DEFAULT_FIXED_MEMBERS.length;i++) {
      const name=DEFAULT_FIXED_MEMBERS[i];
      const slug=name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
      await client.query("INSERT INTO members(member_id,name,type) VALUES ($1,$2,'Cố định')",["m_"+slug+"_"+(i+1),name]);
    }
    await client.query("COMMIT");
    return {membersCreated:DEFAULT_FIXED_MEMBERS.length};
  } catch(error) {
    await client.query("ROLLBACK").catch(()=>{});
    throw error;
  } finally {client.release();}
}
module.exports = {seedDemo};
