"use strict";

// Reference:
// https://github.com/Black-Magic-Lab/Surge/blob/master/modules/iphone_check_store.sgmodule

const APPLE_TW_PICKUP_ENDPOINT = "https://www.apple.com/tw/shop/retail/pickup-message";
const APPLE_TW_BUY_PATH = "/tw/shop/buy-iphone/";
const CACHE_KEY = "iphone-store-stock-product";
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

function responseStatus(response) {
  if (!response || typeof response !== "object") return null;
  const status = Number(response.status ?? response.statusCode);
  return Number.isFinite(status) ? status : null;
}

function parseArguments(raw) {
  if (typeof raw !== "string") return {};

  return raw.split("&").reduce((result, item) => {
    const separator = item.indexOf("=");
    if (separator === -1) return result;

    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (!key) return result;

    try {
      result[key] = decodeURIComponent(value);
    } catch (_error) {
      result[key] = value;
    }
    return result;
  }, {});
}

function isPlaceholder(value) {
  return (
    !value ||
    /^請填入/.test(value) ||
    /^YYYY-MM-DD/.test(value) ||
    /^%[A-Z0-9_]+%$/.test(value) ||
    /^\{\{\{.+\}\}\}$/.test(value)
  );
}

function normalizePartNumber(value) {
  if (typeof value !== "string") return "";
  const partNumber = value.trim().toUpperCase();
  return /^[A-Z0-9]{5,15}\/A$/.test(partNumber) ? partNumber : "";
}

function parseStores(value) {
  if (typeof value !== "string") return [];

  return Array.from(
    new Set(
      value
        .toUpperCase()
        .split(/[|,;\s]+/)
        .map((store) => store.trim())
        .filter((store) => /^R\d{3}$/.test(store)),
    ),
  );
}

function parseSaleTime(value) {
  if (typeof value !== "string") return NaN;
  const input = value.trim();
  if (isPlaceholder(input)) return NaN;
  if (/^(立即|now)$/i.test(input)) return 0;
  if (/^\d{13}$/.test(input)) return Number(input);
  if (/^\d{10}$/.test(input)) return Number(input) * 1000;

  const taipeiTime = input.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (taipeiTime) {
    const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0"] =
      taipeiTime;
    const values = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
    const [year, month, day, hour, minute, second] = values;
    const timestamp = Date.UTC(year, month - 1, day, hour - 8, minute, second);
    const check = new Date(timestamp + TAIPEI_OFFSET_MS);
    const valid =
      check.getUTCFullYear() === year &&
      check.getUTCMonth() === month - 1 &&
      check.getUTCDate() === day &&
      check.getUTCHours() === hour &&
      check.getUTCMinutes() === minute &&
      check.getUTCSeconds() === second;
    return valid ? timestamp : NaN;
  }

  const timestamp = Date.parse(input);
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function partNumberFromProductUrl(value) {
  if (typeof value !== "string") return "";

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.hostname !== "www.apple.com") return "";
    if (!url.pathname.startsWith(APPLE_TW_BUY_PATH)) return "";
    return normalizePartNumber(url.searchParams.get("product") || "");
  } catch (_error) {
    return "";
  }
}

function validProductUrl(value) {
  if (typeof value !== "string") return "";

  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.apple.com" ||
      !url.pathname.startsWith(APPLE_TW_BUY_PATH)
    ) {
      return "";
    }
    return url.href;
  } catch (_error) {
    return "";
  }
}

function partNumberFromProductPage(html) {
  if (typeof html !== "string") return "";
  const patterns = [
    /defaultOnloadPart\s*:\s*"([A-Z0-9]{5,15}\/A)"/i,
    /"mainEntityOfPage"\s*:\s*"[^"]+"[\s\S]{0,1500}?"sku"\s*:\s*"([A-Z0-9]{5,15}\/A)"/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return normalizePartNumber(match[1]);
  }
  return "";
}

function buildPickupUrl(partNumber, store) {
  return (
    `${APPLE_TW_PICKUP_ENDPOINT}?pl=true&searchNearby=true` +
    `&store=${encodeURIComponent(store)}&parts.0=${encodeURIComponent(partNumber)}`
  );
}

function stripHtml(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function pickupResults(payload, partNumber, requestedStores) {
  const stores = payload?.body?.stores;
  if (!Array.isArray(stores)) return null;

  const requested = new Set(requestedStores);
  return stores
    .filter((store) => requested.has(String(store?.storeNumber || "").toUpperCase()))
    .map((store) => {
      const availability = store?.partsAvailability?.[partNumber];
      const regular = availability?.messageTypes?.regular;
      return {
        storeNumber: String(store.storeNumber || ""),
        storeName: String(store.storeName || store.storeNumber || "未知門市"),
        available:
          availability?.storePickEligible === true &&
          String(availability?.pickupDisplay || "").toLowerCase() === "available",
        quote: stripHtml(
          availability?.pickupSearchQuote || regular?.storePickupQuote || "",
        ),
        productTitle: String(regular?.storePickupProductTitle || partNumber),
      };
    });
}

function parseCache(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const cache = JSON.parse(value);
    const partNumber = normalizePartNumber(cache?.partNumber);
    if (!partNumber || typeof cache?.source !== "string") return null;
    return { source: cache.source, partNumber };
  } catch (_error) {
    return null;
  }
}

function createIphoneStockRunner({
  get,
  notify,
  done,
  log = () => {},
  readCache = () => null,
  writeCache = () => false,
  argument,
  now = () => Date.now(),
}) {
  let finished = false;

  function finish() {
    if (finished) return;
    finished = true;
    done();
  }

  function postNotification(subtitle, message) {
    notify("🍎 iPhone 台灣直營店庫存", subtitle, message, {
      url: "https://www.apple.com/tw/shop/buy-iphone",
    });
  }

  function fail(message) {
    postNotification("檢查失敗", message);
    finish();
  }

  function getText(url, callback) {
    try {
      get({ url }, (error, response, data) => {
        if (error) {
          callback({ ok: false, message: "連線 Apple 服務失敗，請稍後再試" });
          return;
        }

        const status = responseStatus(response);
        if (status !== null && (status < 200 || status >= 300)) {
          callback({ ok: false, message: `Apple 服務回傳 HTTP ${status}` });
          return;
        }
        callback({ ok: true, data });
      });
    } catch (_error) {
      callback({ ok: false, message: "無法送出 Apple 庫存查詢" });
    }
  }

  function checkStock(partNumber, stores) {
    getText(buildPickupUrl(partNumber, stores[0]), (result) => {
      if (!result.ok) {
        fail(result.message);
        return;
      }

      let payload;
      try {
        payload = JSON.parse(result.data);
      } catch (_error) {
        fail("Apple 庫存服務回傳的內容不是有效 JSON");
        return;
      }

      const stock = pickupResults(payload, partNumber, stores);
      if (!stock || stock.length === 0) {
        fail("找不到指定機型或門市，請確認模組參數");
        return;
      }

      const available = stock.filter((item) => item.available);
      if (available.length > 0) {
        const title = available[0].productTitle || partNumber;
        const details = available
          .map((item) => `${item.storeName}：${item.quote || "可店內取貨"}`)
          .join("\n");
        postNotification(`${title} 有貨`, details);
      } else {
        log(
          `📱 ${partNumber}：${stock
            .map((item) => `${item.storeName} ${item.quote || "目前無法取貨"}`)
            .join("；")}`,
        );
      }
      finish();
    });
  }

  function resolvePartNumber(source, callback) {
    const direct = normalizePartNumber(source) || partNumberFromProductUrl(source);
    if (direct) {
      callback({ ok: true, partNumber: direct });
      return;
    }

    const productUrl = validProductUrl(source);
    if (!productUrl) {
      callback({ ok: false, message: "機型代號格式不正確，請填零件編號或 Apple 台灣產品網址" });
      return;
    }

    const cache = parseCache(readCache(CACHE_KEY));
    if (cache?.source === productUrl) {
      callback({ ok: true, partNumber: cache.partNumber });
      return;
    }

    getText(productUrl, (result) => {
      if (!result.ok) {
        callback(result);
        return;
      }

      const partNumber = partNumberFromProductPage(result.data);
      if (!partNumber) {
        callback({
          ok: false,
          message: "無法從產品頁辨識機型代號；請確認網址已選定尺寸、容量與顏色",
        });
        return;
      }

      writeCache(JSON.stringify({ source: productUrl, partNumber }), CACHE_KEY);
      callback({ ok: true, partNumber });
    });
  }

  function run() {
    const args = parseArguments(argument);
    const modelSource = String(args.model || "").trim();
    const stores = parseStores(args.stores || "");
    const saleAt = parseSaleTime(args.saleAt || "");

    if (isPlaceholder(modelSource)) {
      fail("請編輯模組參數，填入機型代號或 Apple 台灣的完整產品網址");
      return;
    }
    if (stores.length === 0) {
      fail("門市代號格式不正確；台北 101 為 R713，信義 A13 為 R694");
      return;
    }
    if (!Number.isFinite(saleAt)) {
      fail("開賣時間格式不正確，請使用台灣時間 YYYY-MM-DD HH:mm，或填「立即」");
      return;
    }

    const currentTime = now();
    if (currentTime < saleAt) {
      log(`還沒開賣；預定於 ${String(args.saleAt).trim()} 後開始查詢`);
      finish();
      return;
    }

    const taipeiHour = new Date(currentTime + TAIPEI_OFFSET_MS).getUTCHours();
    if (taipeiHour < 8 || taipeiHour > 21) {
      log("不在庫存檢查時段（台灣時間 08:00–21:59）");
      finish();
      return;
    }

    resolvePartNumber(modelSource, (result) => {
      if (!result.ok) {
        fail(result.message);
        return;
      }
      checkStock(result.partNumber, stores);
    });
  }

  return { run };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    APPLE_TW_PICKUP_ENDPOINT,
    buildPickupUrl,
    createIphoneStockRunner,
    normalizePartNumber,
    parseArguments,
    parseSaleTime,
    parseStores,
    partNumberFromProductPage,
    partNumberFromProductUrl,
    pickupResults,
  };
} else {
  createIphoneStockRunner({
    get: $httpClient.get.bind($httpClient),
    notify: $notification.post.bind($notification),
    done: $done,
    log: console.log.bind(console),
    readCache: $persistentStore.read.bind($persistentStore),
    writeCache: $persistentStore.write.bind($persistentStore),
    argument: typeof $argument === "string" ? $argument : "",
  }).run();
}
