const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  YAMAHA_LIFE_ENDPOINTS,
  createYamahaLifeRunner,
  parseJsonBody,
} = require("../Surge/yamaha-life-daily-sign-in/yamaha-life-daily-sign-in.js");

function makeRunner(responses, memberId = "TEST_MEMBER_ID") {
  const requests = [];
  const notifications = [];
  let doneCount = 0;

  const runner = createYamahaLifeRunner({
    memberId,
    post(options, callback) {
      requests.push(options);
      const next = responses.shift();
      callback(next.error || null, next.response || { status: 200 }, next.data);
    },
    notify(...args) {
      notifications.push(args);
    },
    done() {
      doneCount += 1;
    },
  });

  runner.run();
  return { requests, notifications, get doneCount() { return doneCount; } };
}

test("posts the member number to only the two original Yamaha endpoints", () => {
  const result = makeRunner([
    { data: JSON.stringify({ RC: "0", RM: "簽到成功。" }) },
    { data: JSON.stringify({ RC: "0", result: { remainPoints: 12, disabled: "無即將到期點數" } }) },
  ]);

  assert.deepEqual(result.requests.map(({ url }) => url), [
    YAMAHA_LIFE_ENDPOINTS.signIn,
    YAMAHA_LIFE_ENDPOINTS.pointList,
  ]);
  assert.equal(result.requests[0].body, JSON.stringify({ access_token: "TEST_MEMBER_ID" }));
  assert.equal(result.requests[1].body, JSON.stringify({ access_token: "TEST_MEMBER_ID" }));
  assert.equal(result.notifications[0][1], "簽到結果");
  assert.equal(result.notifications[0][2], "簽到成功");
  assert.equal(result.notifications[1][1], "點數紀錄");
  assert.equal(result.notifications[1][2], "目前12點，無即將到期點數");
  assert.equal(result.doneCount, 1);
});

test("does not send requests when the member number is missing", () => {
  const result = makeRunner([], "");
  assert.equal(result.requests.length, 0);
  assert.equal(result.notifications[0][1], "尚未設定會員編號");
  assert.equal(result.doneCount, 1);
});

test("does not send requests when the module placeholder is unresolved", () => {
  const result = makeRunner([], "{{{會員編號}}}");
  assert.equal(result.requests.length, 0);
  assert.equal(result.notifications[0][1], "尚未設定會員編號");
  assert.equal(result.doneCount, 1);
});

test("does not send requests when the module still has its prompt value", () => {
  const result = makeRunner([], "請填入會員編號");
  assert.equal(result.requests.length, 0);
  assert.equal(result.notifications[0][1], "尚未設定會員編號");
  assert.equal(result.doneCount, 1);
});

test("handles network and invalid JSON failures without exposing response bodies", () => {
  const result = makeRunner([
    { error: "offline" },
    { data: "private non-json response" },
  ]);

  assert.equal(result.notifications[0][1], "請求簽到發生錯誤");
  assert.match(result.notifications[0][2], /網路錯誤/);
  assert.equal(result.notifications[1][1], "請求點數紀錄發生錯誤");
  assert.equal(result.notifications[1][2], "伺服器回傳的內容不是有效的 JSON");
  assert.doesNotMatch(JSON.stringify(result.notifications), /private non-json response/);
  assert.equal(result.doneCount, 1);
});

test("rejects missing, non-object, and malformed response bodies", () => {
  assert.equal(parseJsonBody("").ok, false);
  assert.equal(parseJsonBody("[]").ok, false);
  assert.equal(parseJsonBody("not-json").ok, false);
});

test("module contains only the scheduled script and its exact remote path", () => {
  const modulePath = path.join(
    __dirname,
    "../Surge/yamaha-life-daily-sign-in/yamaha-life-daily-sign-in.sgmodule",
  );
  const source = fs.readFileSync(modulePath, "utf8");

  assert.match(source, /^#!arguments=會員編號:請填入會員編號$/m);
  assert.match(source, /^#!arguments-desc=.*Ya 粉資訊 > 個人資料 > 會員編號/m);
  assert.match(source, /type=cron,cronexp="5 0 \* \* \*"/);
  assert.match(source, /argument="\{\{\{會員編號\}\}\}"/);
  assert.doesNotMatch(source, /MEMBER_ID/);
  assert.match(
    source,
    /script-path=https:\/\/raw\.githubusercontent\.com\/kinjih\/automation-toolbox\/main\/Surge\/yamaha-life-daily-sign-in\/yamaha-life-daily-sign-in\.js/,
  );
  assert.doesNotMatch(source, /\[MITM\]|type=http-(?:request|response)|requires-body|binary-body-mode/);
});
