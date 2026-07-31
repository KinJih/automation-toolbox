// ==UserScript==
// @name         停車繳費車牌自動填入
// @namespace    https://github.com/kinjih/automation-toolbox
// @version      2.0.0
// @description  在支援的停車繳費網站共用、記憶並自動填入車牌號碼。
// @author       KinJih
// @license      MIT
// @match        https://a.intella.co/g/sjcs*
// @match        https://utaggoif.utaggo.com.tw/*
// @match        https://www.dodohome.com.tw/iwebpay/doSearchCar.aspx*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @homepageURL  https://github.com/kinjih/automation-toolbox
// @supportURL   https://github.com/kinjih/automation-toolbox/issues
// @downloadURL  https://raw.githubusercontent.com/kinjih/automation-toolbox/main/userscripts/parking-payment-plate-autofill/parking-payment-plate-autofill.user.js
// @updateURL    https://raw.githubusercontent.com/kinjih/automation-toolbox/main/userscripts/parking-payment-plate-autofill/parking-payment-plate-autofill.user.js
// ==/UserScript==

(() => {
  "use strict";

  const STORAGE_KEYS = {
    plate: "parkingPaymentPlateAutofill.plate",
    carType: "parkingPaymentPlateAutofill.carType",
    autoFill: "parkingPaymentPlateAutofill.autoFill",
  };
  const LEGACY_STORAGE_KEYS = {
    plate: ["parkingPlateAutofill.plate", "intellaSjcsPlateNumber"],
    carType: ["parkingPlateAutofill.carType", "parkingPlateAutofillCarType"],
    autoFill: ["parkingPlateAutofill.autoFill", "parkingPlateAutofillEnabled"],
  };
  const HOST_ID = "kinjih-parking-payment-plate-autofill";
  const OBSERVER_DEBOUNCE_MS = 120;
  const NOTICE_TEXT_PATTERN = /^(確定|確認|我知道了|知道了|OK)$/i;

  const SITE_ADAPTERS = [
    {
      id: "intella",
      matches: ({ hostname, pathname }) => (
        hostname === "a.intella.co" && pathname.startsWith("/g/sjcs")
      ),
      inputSelectors: [
        'input[placeholder="請輸入完整車牌號碼"]',
      ],
      noticeButtonSelectors: [
        "section.popup-notice .btn",
      ],
    },
    {
      id: "utaggo",
      matches: ({ hostname }) => hostname === "utaggoif.utaggo.com.tw",
      inputSelectors: [
        "#PlateNumber",
        'input[placeholder="輸入車牌號碼"]',
      ],
      noticeButtonSelectors: [
        "#NoticeDialog button",
        "#NoticeDialog .btn",
        "#NoticeDialog [role='button']",
      ],
    },
    {
      id: "dodohome",
      matches: ({ hostname, pathname }) => (
        hostname === "www.dodohome.com.tw"
        && pathname.toLowerCase() === "/iwebpay/dosearchcar.aspx"
      ),
      inputSelectors: [
        "#txtCarnum",
        'input[name="txtCarnum"]',
      ],
      noticeButtonSelectors: [
        ".swal2-container .btnconfirm",
        ".swal2-container .swal2-confirm",
      ],
      carType: {
        inputName: "radCarType",
        defaultValue: "C",
      },
    },
  ];

  const normalizePlate = (plate) => String(plate ?? "")
    .replace(/[Ａ-Ｚａ-ｚ０-９－]/g, (character) => (
      character === "－"
        ? "-"
        : String.fromCharCode(character.charCodeAt(0) - 0xfee0)
    ))
    .replace(/[^A-Za-z0-9-]/g, "")
    .toUpperCase();

  const getSiteAdapter = (locationLike) => {
    const parsedLocation = typeof locationLike === "string"
      ? new URL(locationLike)
      : locationLike;

    return SITE_ADAPTERS.find((adapter) => adapter.matches(parsedLocation)) || null;
  };

  const isAllowedNoticeText = (text) => NOTICE_TEXT_PATTERN.test(String(text ?? "").trim());

  if (
    typeof module === "object"
    && module.exports
    && typeof process === "object"
    && process.versions?.node
  ) {
    module.exports = {
      getSiteAdapter,
      isAllowedNoticeText,
      normalizePlate,
    };
    return;
  }

  const state = {
    autoFillEnabled: true,
    carType: "",
    plate: "",
  };
  let ui = null;
  let observerTimer = 0;
  let carTypeListenerRegistered = false;

  const readStoredValue = async (key, fallback = null) => {
    try {
      if (typeof GM !== "undefined" && typeof GM.getValue === "function") {
        return await GM.getValue(key, fallback);
      }
    } catch (_) {
      // Try the legacy API, then localStorage.
    }

    try {
      if (typeof GM_getValue === "function") {
        return GM_getValue(key, fallback);
      }
    } catch (_) {
      // Fall through to localStorage.
    }

    try {
      return localStorage.getItem(key) ?? fallback;
    } catch (_) {
      return fallback;
    }
  };

  const setStoredValue = async (key, value) => {
    try {
      if (typeof GM !== "undefined" && typeof GM.setValue === "function") {
        await GM.setValue(key, value);
        return;
      }
    } catch (_) {
      // Try the legacy API, then localStorage.
    }

    try {
      if (typeof GM_setValue === "function") {
        GM_setValue(key, value);
        return;
      }
    } catch (_) {
      // Fall through to localStorage.
    }

    try {
      localStorage.setItem(key, value);
    } catch (_) {
      // Some private browsing modes block localStorage.
    }
  };

  const deleteStoredValue = async (key) => {
    try {
      if (typeof GM !== "undefined" && typeof GM.deleteValue === "function") {
        await GM.deleteValue(key);
        return;
      }
    } catch (_) {
      // Try the legacy API, then localStorage.
    }

    try {
      if (typeof GM_deleteValue === "function") {
        GM_deleteValue(key);
        return;
      }
    } catch (_) {
      // Fall through to localStorage.
    }

    try {
      localStorage.removeItem(key);
    } catch (_) {
      // Keep the in-memory value cleared if storage is unavailable.
    }
  };

  const readMigratedValue = async (key, legacyKeys, fallback) => {
    const currentValue = await readStoredValue(key, null);
    if (currentValue !== null) return currentValue;

    for (const legacyKey of legacyKeys) {
      const legacyValue = await readStoredValue(legacyKey, null);
      if (legacyValue === null) continue;

      await setStoredValue(key, legacyValue);
      return legacyValue;
    }

    return fallback;
  };

  const loadSettings = async () => {
    const [plate, carType, autoFill] = await Promise.all([
      readMigratedValue(STORAGE_KEYS.plate, LEGACY_STORAGE_KEYS.plate, ""),
      readMigratedValue(STORAGE_KEYS.carType, LEGACY_STORAGE_KEYS.carType, ""),
      readMigratedValue(STORAGE_KEYS.autoFill, LEGACY_STORAGE_KEYS.autoFill, "1"),
    ]);

    state.plate = normalizePlate(plate);
    state.carType = String(carType ?? "");
    state.autoFillEnabled = autoFill !== "0" && autoFill !== false;
  };

  const setStoredPlate = async (plate) => {
    state.plate = normalizePlate(plate);
    await setStoredValue(STORAGE_KEYS.plate, state.plate);
  };

  const clearStoredPlate = async () => {
    state.plate = "";
    await Promise.all([
      deleteStoredValue(STORAGE_KEYS.plate),
      ...LEGACY_STORAGE_KEYS.plate.map(deleteStoredValue),
    ]);
  };

  const setAutoFillEnabled = async (enabled) => {
    state.autoFillEnabled = enabled;
    await setStoredValue(STORAGE_KEYS.autoFill, enabled ? "1" : "0");
  };

  const findFirst = (selectors, root = document) => {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      if (element) return element;
    }
    return null;
  };

  const findPlateInput = (adapter) => findFirst(adapter.inputSelectors);

  const setNativeValue = (input, value) => {
    const prototype = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor?.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const isVisible = (element) => {
    if (!element.isConnected || element.getClientRects().length === 0) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  };

  const getButtonText = (element) => (
    element.textContent
    || element.getAttribute("aria-label")
    || element.value
    || ""
  ).trim();

  const dismissNotice = (adapter) => {
    for (const selector of adapter.noticeButtonSelectors) {
      const buttons = document.querySelectorAll(selector);
      const button = [...buttons].find((element) => (
        isVisible(element) && isAllowedNoticeText(getButtonText(element))
      ));

      if (!button) continue;
      button.click();
      return true;
    }

    return false;
  };

  const applyCarTypePreference = (adapter) => {
    if (!adapter.carType) return false;

    const radios = document.querySelectorAll(`input[name="${adapter.carType.inputName}"]`);
    const preferredValue = state.carType || adapter.carType.defaultValue;
    const radio = [...radios].find((element) => element.value === preferredValue);

    if (!radio || radio.checked) return false;

    radio.checked = true;
    radio.dispatchEvent(new Event("input", { bubbles: true }));
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };

  const registerCarTypeListener = () => {
    if (carTypeListenerRegistered) return;
    carTypeListenerRegistered = true;

    document.addEventListener("change", async (event) => {
      const adapter = getSiteAdapter(window.location);
      const carType = adapter?.carType;
      const target = event.target;

      if (!(target instanceof HTMLInputElement) || !carType) return;
      if (target.name !== carType.inputName || !target.checked) return;

      state.carType = target.value;
      await setStoredValue(STORAGE_KEYS.carType, state.carType);
    });
  };

  const fillPlate = (adapter, plate = state.plate) => {
    const normalizedPlate = normalizePlate(plate);
    const input = findPlateInput(adapter);

    if (!normalizedPlate || !input) return false;
    if (input.value !== normalizedPlate) setNativeValue(input, normalizedPlate);
    return input.value === normalizedPlate;
  };

  const getPagePlate = (adapter) => normalizePlate(findPlateInput(adapter)?.value || "");

  const closePanel = () => {
    if (!ui) return;
    ui.panel.classList.remove("is-open");
    ui.backdrop.classList.remove("is-open");
    ui.button.setAttribute("aria-expanded", "false");
  };

  const showStatus = (message) => {
    if (!ui) return;
    ui.status.textContent = message;

    window.setTimeout(() => {
      if (ui?.status.textContent === message) ui.status.textContent = "";
    }, 1800);
  };

  const updateAutoFillButton = () => {
    if (!ui) return;
    ui.autoFillButton.textContent = `自動填入：${state.autoFillEnabled ? "開" : "關"}`;
    ui.autoFillButton.dataset.primary = state.autoFillEnabled ? "true" : "false";
  };

  const openPanel = async () => {
    if (!ui) return;

    await loadSettings();
    const adapter = getSiteAdapter(window.location);
    ui.input.value = state.plate || (adapter ? getPagePlate(adapter) : "");
    updateAutoFillButton();
    ui.backdrop.classList.add("is-open");
    ui.panel.classList.add("is-open");
    ui.button.setAttribute("aria-expanded", "true");
    ui.input.focus();
  };

  const handlePanelAction = async (action) => {
    if (!ui) return;

    const adapter = getSiteAdapter(window.location);
    const value = normalizePlate(ui.input.value);

    if (action === "save") {
      if (!value) {
        showStatus("請先輸入車牌");
        return;
      }
      await setStoredPlate(value);
      if (adapter) fillPlate(adapter, value);
      ui.input.value = value;
      showStatus("已儲存並填入");
      return;
    }

    if (action === "toggle-autofill") {
      await setAutoFillEnabled(!state.autoFillEnabled);
      updateAutoFillButton();
      if (state.autoFillEnabled && adapter) fillPlate(adapter);
      showStatus(`自動填入已${state.autoFillEnabled ? "開啟" : "關閉"}`);
      return;
    }

    if (action === "use-current") {
      const currentPlate = adapter ? getPagePlate(adapter) : "";
      if (!currentPlate) {
        showStatus("頁面車牌欄位是空的");
        return;
      }
      await setStoredPlate(currentPlate);
      ui.input.value = currentPlate;
      showStatus("已記錄目前車牌");
      return;
    }

    if (action === "clear") {
      await clearStoredPlate();
      ui.input.value = "";
      showStatus("已清除記憶車牌");
    }
  };

  const buildFloatingUi = () => {
    if (ui?.host.isConnected) return;

    const existingHost = document.getElementById(HOST_ID);
    if (existingHost) existingHost.remove();

    const host = document.createElement("div");
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        button, input { box-sizing: border-box; }
        #launcher {
          position: fixed;
          left: 16px;
          bottom: 20px;
          z-index: 2147483647;
          width: 52px;
          height: 52px;
          border: 0;
          border-radius: 50%;
          background: #2f56d9;
          color: #fff;
          box-shadow: 0 8px 22px rgba(0, 0, 0, .28);
          font: 700 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          cursor: pointer;
        }
        #backdrop {
          position: fixed;
          inset: 0;
          z-index: 2147483646;
          display: none;
          background: transparent;
        }
        #backdrop.is-open { display: block; }
        #panel {
          position: fixed;
          left: 14px;
          bottom: 84px;
          z-index: 2147483647;
          display: none;
          width: min(300px, calc(100vw - 28px));
          box-sizing: border-box;
          padding: 14px;
          border-radius: 12px;
          background: #fff;
          color: #1f2937;
          box-shadow: 0 10px 32px rgba(0, 0, 0, .25);
          font: 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        #panel.is-open { display: block; }
        label {
          display: block;
          margin-bottom: 8px;
          font-weight: 700;
        }
        #plate-input {
          width: 100%;
          margin-bottom: 10px;
          padding: 10px 12px;
          border: 1px solid #c7cdd8;
          border-radius: 8px;
          font: 18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          text-transform: uppercase;
        }
        #actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        #actions button {
          min-height: 40px;
          border: 0;
          border-radius: 8px;
          background: #edf1f7;
          color: #1f2937;
          font: 700 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          cursor: pointer;
        }
        #actions button[data-primary="true"] {
          background: #2f56d9;
          color: #fff;
        }
        #status {
          min-height: 18px;
          margin-top: 8px;
          color: #4b5563;
          font-size: 13px;
        }
      </style>
      <div id="backdrop"></div>
      <section id="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title">
        <label id="panel-title" for="plate-input">車牌號碼</label>
        <input id="plate-input" type="text" autocomplete="off" inputmode="latin" placeholder="ABC-123">
        <div id="actions">
          <button type="button" data-action="save" data-primary="true">儲存填入</button>
          <button type="button" data-action="toggle-autofill">自動填入：開</button>
          <button type="button" data-action="use-current">記錄目前</button>
          <button type="button" data-action="clear">清除</button>
        </div>
        <div id="status" aria-live="polite"></div>
      </section>
      <button id="launcher" type="button" aria-label="開啟車牌自動填入設定" aria-haspopup="dialog" aria-expanded="false">車牌</button>
    `;

    const button = shadow.querySelector("#launcher");
    const panel = shadow.querySelector("#panel");
    const backdrop = shadow.querySelector("#backdrop");
    const input = shadow.querySelector("#plate-input");
    const autoFillButton = shadow.querySelector('[data-action="toggle-autofill"]');
    const status = shadow.querySelector("#status");

    ui = {
      autoFillButton,
      backdrop,
      button,
      host,
      input,
      panel,
      status,
    };

    button.addEventListener("click", async () => {
      if (panel.classList.contains("is-open")) {
        closePanel();
      } else {
        await openPanel();
      }
    });
    backdrop.addEventListener("click", closePanel);
    panel.addEventListener("click", async (event) => {
      const action = event.target?.dataset?.action;
      if (action) await handlePanelAction(action);
    });
    input.addEventListener("input", () => {
      input.value = normalizePlate(input.value);
    });

    (document.body || document.documentElement).append(host);
    updateAutoFillButton();
  };

  const run = () => {
    const adapter = getSiteAdapter(window.location);
    if (!adapter) return;

    buildFloatingUi();
    dismissNotice(adapter);
    applyCarTypePreference(adapter);
    if (state.autoFillEnabled) fillPlate(adapter);
  };

  const scheduleRun = () => {
    window.clearTimeout(observerTimer);
    observerTimer = window.setTimeout(run, OBSERVER_DEBOUNCE_MS);
  };

  const start = async () => {
    await loadSettings();
    registerCarTypeListener();
    run();

    const observer = new MutationObserver(scheduleRun);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closePanel();
    });
    window.addEventListener("hashchange", scheduleRun);
    window.addEventListener("pageshow", scheduleRun);
    window.addEventListener("popstate", scheduleRun);
  };

  void start();
})();
