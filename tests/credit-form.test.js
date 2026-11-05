"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function formHarness(api) {
  const source = fs.readFileSync(require.resolve("../public/app.js"), "utf8");
  const code = source.slice(source.indexOf("function bindCredits()"), source.indexOf("function bindTools()"));
  let submit;
  let ids = 0;
  const button = {disabled: false};
  const nodes = {
    creditAmountInput: {value: "100000", addEventListener() {}},
    creditMemberSelect: {value: "member-a"},
    creditDirectionInput: {value: "add"},
    creditNoteInput: {value: "Nạp"},
    creditForm: {
      addEventListener(event, callback) { if (event === "submit") submit = callback; },
      querySelector() { return button; }
    },
  };
  const context = {$: id => nodes[id], crypto: {randomUUID: () => "request-" + (++ids)},
    api, setMessage() {}, renderCreditBoard() {}, formatMoney: String};
  vm.runInNewContext(code + ";bindCredits();", context);
  return {nodes, button, submit: () => submit({preventDefault() {}})};
}

test("Form giữ cùng requestId khi gửi lại sau lỗi mạng, tạo mã mới sau thành công", async () => {
  const requests = [];
  let fail = true;
  const form = formHarness(async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (fail) { fail = false; throw new Error("Mất phản hồi mạng"); }
    return {};
  });
  await form.submit();
  assert.equal(form.nodes.creditAmountInput.value, "100000");
  await form.submit();
  assert.equal(requests[0].requestId, requests[1].requestId);
  assert.equal(form.nodes.creditAmountInput.value, "");
  form.nodes.creditAmountInput.value = "100000";
  form.nodes.creditNoteInput.value = "Nạp";
  await form.submit();
  assert.notEqual(requests[1].requestId, requests[2].requestId);
  assert.equal(form.button.disabled, false);
});

test("Form chặn submit đồng thời và mở nút trở lại sau khi hoàn tất", async () => {
  let release;
  let calls = 0;
  const gate = new Promise(resolve => release = resolve);
  const form = formHarness(async () => { calls++; await gate; return {}; });
  const first = form.submit();
  assert.equal(form.button.disabled, true);
  await form.submit();
  assert.equal(calls, 1);
  release();
  await first;
  assert.equal(form.button.disabled, false);
});
