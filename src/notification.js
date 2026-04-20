class NotificationService {
  async sendToMember(memberId, message) {
    // Stub for Phase 2: keep interface stable for Telegram/Zalo integration.
    console.log(`[NotificationStub][member=${memberId}] ${message}`);
    return { ok: true };
  }

  async broadcast(members, messageBuilder) {
    const jobs = members.map((member) => {
      const memberId = member.memberId || member.name;
      const message = typeof messageBuilder === "function" ? messageBuilder(member) : String(messageBuilder || "");
      return this.sendToMember(memberId, message);
    });
    await Promise.all(jobs);
  }
}

module.exports = {
  NotificationService
};
