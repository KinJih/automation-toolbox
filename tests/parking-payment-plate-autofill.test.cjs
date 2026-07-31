const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getSiteAdapter,
  isAllowedNoticeText,
  normalizePlate,
} = require("../userscripts/parking-payment-plate-autofill/parking-payment-plate-autofill.user.js");

test("normalizes full-width and lowercase plate characters", () => {
  assert.equal(normalizePlate(" ａｂｃ－１２３ "), "ABC-123");
  assert.equal(normalizePlate("abc 123"), "ABC123");
  assert.equal(normalizePlate(null), "");
});

test("resolves each supported site to the correct adapter", () => {
  assert.equal(getSiteAdapter("https://a.intella.co/g/sjcs?store=1")?.id, "intella");
  assert.equal(getSiteAdapter("https://utaggoif.utaggo.com.tw/payment")?.id, "utaggo");
  assert.equal(
    getSiteAdapter("https://www.dodohome.com.tw/iwebpay/doSearchCar.aspx?x=1")?.id,
    "dodohome",
  );
  assert.equal(getSiteAdapter("https://example.com/")?.id, undefined);
});

test("only allows known acknowledgement button labels", () => {
  assert.equal(isAllowedNoticeText("確定"), true);
  assert.equal(isAllowedNoticeText("我知道了"), true);
  assert.equal(isAllowedNoticeText("OK"), true);
  assert.equal(isAllowedNoticeText(""), false);
  assert.equal(isAllowedNoticeText("確認付款"), false);
  assert.equal(isAllowedNoticeText("刪除"), false);
});
