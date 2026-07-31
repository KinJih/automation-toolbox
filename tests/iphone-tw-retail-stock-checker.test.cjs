const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildPickupUrl,
  createIphoneStockRunner,
  parseSaleTime,
  parseStores,
  partNumberFromProductPage,
} = require("../Surge/iphone-tw-retail-stock-checker/iphone-tw-retail-stock-checker.js");

const ACTIVE_TAIPEI_TIME = Date.UTC(2026, 8, 18, 2, 0, 0);

function pickupPayload(partNumber, stores) {
  return JSON.stringify({
    body: {
      stores: stores.map(({ number, name, available, quote }) => ({
        storeNumber: number,
        storeName: name,
        partsAvailability: {
          [partNumber]: {
            storePickEligible: available,
            pickupDisplay: available ? "available" : "unavailable",
            pickupSearchQuote: quote,
            messageTypes: {
              regular: { storePickupProductTitle: "iPhone 測試機 256GB 藍色" },
            },
          },
        },
      })),
    },
  });
}

function makeRunner({ argument, responses = [], now = ACTIVE_TAIPEI_TIME, cache = null }) {
  const requests = [];
  const notifications = [];
  const logs = [];
  const writes = [];
  let doneCount = 0;

  const runner = createIphoneStockRunner({
    argument,
    now: () => now,
    get(options, callback) {
      requests.push(options);
      const response = responses.shift();
      callback(response?.error || null, response?.response || { status: 200 }, response?.data || "");
    },
    notify(...args) {
      notifications.push(args);
    },
    log(message) {
      logs.push(message);
    },
    readCache() {
      return cache;
    },
    writeCache(...args) {
      writes.push(args);
      return true;
    },
    done() {
      doneCount += 1;
    },
  });

  runner.run();
  return {
    requests,
    notifications,
    logs,
    writes,
    get doneCount() {
      return doneCount;
    },
  };
}

test("parses Taipei sale times without requiring epoch conversion", () => {
  assert.equal(parseSaleTime("2026-09-18 08:00"), Date.UTC(2026, 8, 18, 0, 0, 0));
  assert.equal(parseSaleTime("立即"), 0);
  assert.equal(parseSaleTime("1663286400000"), 1663286400000);
  assert.ok(Number.isNaN(parseSaleTime("2026-02-30 08:00")));
  assert.ok(Number.isNaN(parseSaleTime("YYYY-MM-DD HH:mm")));
});

test("accepts both Taiwan store codes and deduplicates them", () => {
  assert.deepEqual(parseStores("R713|R694|r713"), ["R713", "R694"]);
});

test("waits until sale time without making a request", () => {
  const result = makeRunner({
    argument: "model=MFYM4ZP/A&stores=R713|R694&saleAt=2026-09-18 08:00",
    now: Date.UTC(2026, 8, 17, 23, 59, 0),
  });

  assert.equal(result.requests.length, 0);
  assert.equal(result.notifications.length, 0);
  assert.match(result.logs[0], /還沒開賣/);
  assert.equal(result.doneCount, 1);
});

test("queries Apple once and combines available store notifications", () => {
  const partNumber = "MFYM4ZP/A";
  const result = makeRunner({
    argument: `model=${partNumber}&stores=R713|R694&saleAt=立即`,
    responses: [
      {
        data: pickupPayload(partNumber, [
          { number: "R713", name: "台北 101", available: true, quote: "供貨 明天" },
          { number: "R694", name: "信義 A13", available: false, quote: "目前無法取貨" },
        ]),
      },
    ],
  });

  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0].url, buildPickupUrl(partNumber, "R713"));
  assert.equal(result.notifications.length, 1);
  assert.match(result.notifications[0][1], /iPhone 測試機 256GB 藍色 有貨/);
  assert.equal(result.notifications[0][2], "台北 101：供貨 明天");
  assert.equal(result.doneCount, 1);
});

test("resolves and caches the part number from an exact Apple product URL", () => {
  const url = "https://www.apple.com/tw/shop/buy-iphone/iphone-test/6.3-inch-256gb-blue";
  const partNumber = "MFYM4ZP/A";
  const result = makeRunner({
    argument: `model=${url}&stores=R713|R694&saleAt=立即`,
    responses: [
      { data: `<script>defaultOnloadPart: "${partNumber}"</script>` },
      {
        data: pickupPayload(partNumber, [
          { number: "R713", name: "台北 101", available: false, quote: "目前無法取貨" },
          { number: "R694", name: "信義 A13", available: false, quote: "目前無法取貨" },
        ]),
      },
    ],
  });

  assert.equal(result.requests.length, 2);
  assert.equal(result.requests[0].url, url);
  assert.match(result.requests[1].url, /parts\.0=MFYM4ZP%2FA/);
  assert.equal(result.writes.length, 1);
  assert.match(result.writes[0][0], /MFYM4ZP\/A/);
  assert.equal(result.notifications.length, 0);
  assert.equal(result.doneCount, 1);
});

test("extracts the selected SKU and rejects unsafe or unresolved inputs", () => {
  assert.equal(
    partNumberFromProductPage('defaultOnloadPart: "MFYM4ZP/A"'),
    "MFYM4ZP/A",
  );
  assert.equal(partNumberFromProductPage("no selected product"), "");

  const result = makeRunner({
    argument: "model=https://example.com/product&stores=R713&saleAt=立即",
  });
  assert.equal(result.requests.length, 0);
  assert.equal(result.notifications.length, 1);
  assert.match(result.notifications[0][2], /機型代號格式不正確/);
  assert.equal(result.doneCount, 1);
});

test("module declares all parameters, reference, and only one cron script", () => {
  const modulePath = path.join(
    __dirname,
    "../Surge/iphone-tw-retail-stock-checker/iphone-tw-retail-stock-checker.sgmodule",
  );
  const source = fs.readFileSync(modulePath, "utf8");

  assert.match(source, /^#!arguments=機型代號:.*門市代號:R713\|R694,開賣時間:/m);
  assert.match(source, /Black-Magic-Lab\/Surge\/blob\/master\/modules\/iphone_check_store\.sgmodule/);
  assert.match(source, /type=cron,cronexp="\* \* \* \* \*"/);
  assert.match(source, /model=\{\{\{機型代號\}\}\}/);
  assert.match(source, /stores=\{\{\{門市代號\}\}\}/);
  assert.match(source, /saleAt=\{\{\{開賣時間\}\}\}/);
  assert.doesNotMatch(source, /\[MITM\]|type=http-(?:request|response)/);
});
