"use strict";

const YAMAHA_LIFE_ENDPOINTS = Object.freeze({
  signIn: "https://app.yamaha-motor.com.tw/api/fans/Signin",
  pointList: "https://app.yamaha-motor.com.tw/api/Fans/PointList",
});

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/。$/, "").trim();
}

function cleanMemberId(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function parseJsonBody(data) {
  if (typeof data !== "string" || data.trim() === "") {
    return { ok: false, message: "伺服器未回傳可讀取的內容" };
  }

  try {
    const value = JSON.parse(data);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, message: "伺服器回傳的 JSON 格式不正確" };
    }
    return { ok: true, value };
  } catch (_error) {
    return { ok: false, message: "伺服器回傳的內容不是有效的 JSON" };
  }
}

function responseStatus(response) {
  if (!response || typeof response !== "object") return null;
  const value = response.status ?? response.statusCode;
  const status = Number(value);
  return Number.isFinite(status) ? status : null;
}

function postJson(post, url, memberId, callback) {
  const options = {
    url,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: memberId }),
  };

  try {
    post(options, (error, response, data) => {
      if (error) {
        callback({ ok: false, message: "網路錯誤，請稍後再試" });
        return;
      }

      const status = responseStatus(response);
      if (status !== null && (status < 200 || status >= 300)) {
        callback({ ok: false, message: `Yamaha API 回傳 HTTP ${status}` });
        return;
      }

      callback(parseJsonBody(data));
    });
  } catch (_error) {
    callback({ ok: false, message: "無法送出 Yamaha API 請求" });
  }
}

function apiMessage(payload) {
  if (Object.prototype.hasOwnProperty.call(payload, "RC")) {
    return cleanText(payload.RM) || `回應代碼：${cleanText(payload.RC) || "未知"}`;
  }

  const message = cleanText(payload.Message);
  const exception = cleanText(payload.ExceptionMessage);
  return [message, exception].filter(Boolean).join("；") || "Yamaha API 未提供結果說明";
}

function pointMessage(payload) {
  if (!Object.prototype.hasOwnProperty.call(payload, "RC")) return apiMessage(payload);

  const result = payload.result;
  if (!result || typeof result !== "object") return apiMessage(payload);

  const points = cleanText(result.remainPoints);
  const disabled = cleanText(result.disabled);
  if (!points && !disabled) return apiMessage(payload);

  return [`目前${points || "未知"}點`, disabled].filter(Boolean).join("，");
}

function createYamahaLifeRunner({ post, notify, done, memberId }) {
  let finished = false;

  function finish() {
    if (finished) return;
    finished = true;
    done();
  }

  function postNotification(subtitle, message) {
    notify("🛵 YAMAHA LIFE 簽到", subtitle, message, { url: "ymtrevsapp://" });
  }

  function run() {
    const id = cleanMemberId(memberId);
    if (!id || /^%[A-Z0-9_]+%$/.test(id)) {
      postNotification(
        "尚未設定會員編號",
        "請至 YAMAHA LIFE App 的「Ya 粉資訊 > 個人資料 > 會員編號」查找並填入模組參數",
      );
      finish();
      return;
    }

    postJson(post, YAMAHA_LIFE_ENDPOINTS.signIn, id, (signInResult) => {
      postNotification(
        signInResult.ok ? "簽到結果" : "請求簽到發生錯誤",
        signInResult.ok ? apiMessage(signInResult.value) : signInResult.message,
      );

      postJson(post, YAMAHA_LIFE_ENDPOINTS.pointList, id, (pointResult) => {
        postNotification(
          pointResult.ok ? "點數紀錄" : "請求點數紀錄發生錯誤",
          pointResult.ok ? pointMessage(pointResult.value) : pointResult.message,
        );
        finish();
      });
    });
  }

  return { run };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    YAMAHA_LIFE_ENDPOINTS,
    apiMessage,
    createYamahaLifeRunner,
    parseJsonBody,
    pointMessage,
  };
} else {
  createYamahaLifeRunner({
    post: $httpClient.post.bind($httpClient),
    notify: $notification.post.bind($notification),
    done: $done,
    memberId: typeof $argument === "string" ? $argument : "",
  }).run();
}
