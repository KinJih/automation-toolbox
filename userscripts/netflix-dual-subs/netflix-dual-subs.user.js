// ==UserScript==
// @name         Netflix 雙字幕
// @namespace    https://github.com/kinjih/automation-toolbox
// @version      0.4.2
// @description  同時顯示 Netflix 提供的兩條字幕軌；不翻譯、不呼叫第三方服務、不使用 AI。
// @author       KinJih
// @license      MIT
// @match        https://www.netflix.com/*
// @match        https://www.netflix.com/*/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// @noframes
// @homepageURL  https://github.com/kinjih/automation-toolbox/tree/main/userscripts/netflix-dual-subs
// @supportURL   https://github.com/kinjih/automation-toolbox/issues
// @downloadURL  https://raw.githubusercontent.com/kinjih/automation-toolbox/main/userscripts/netflix-dual-subs/netflix-dual-subs.user.js
// @updateURL    https://raw.githubusercontent.com/kinjih/automation-toolbox/main/userscripts/netflix-dual-subs/netflix-dual-subs.user.js
// ==/UserScript==

/*
Netflix Dual Subtitles

Privacy:
- Reads only subtitle tracks already present in the Netflix playback manifest.
- Sends no data to any third party.
- Stores preferences only in netflix.com localStorage.

Limitations:
- It cannot unlock subtitle languages that Netflix does not expose to the
  current title, profile, account, or region.
- Netflix uses private, undocumented player data. A future player update may
  require this script to be updated.
- Text subtitles (WebVTT/TTML) are supported. Image-only tracks are skipped.

This script includes portions adapted from:

MultiSub, Copyright (c) 2026 snch1211
NflxMultiSubs, Copyright (c) 2021 Dan Chen, Gert Mertes

Both projects are licensed under the MIT License:

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

(() => {
  'use strict';

  const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const SCRIPT_ID = 'netflix-dual-subs';
  const VERSION = '0.4.2';
  const STORAGE_KEY = `${SCRIPT_ID}:settings:v2`;
  const LEGACY_STORAGE_KEYS = Object.freeze([
    `${SCRIPT_ID}:settings:v1`,
    'netflix-official-dual-subs:settings:v2',
    'netflix-official-dual-subs:settings:v1',
  ]);
  const WEBVTT_PROFILE = 'webvtt-lssdh-ios8';
  const DEBUG = false;
  const FONT_FAMILIES = Object.freeze({
    netflix:
      '"Netflix Sans", "Helvetica Neue", "PingFang TC", "Noto Sans TC", Arial, sans-serif',
    system:
      '-apple-system, BlinkMacSystemFont, "PingFang TC", "Helvetica Neue", sans-serif',
    pingfang: '"PingFang TC", "PingFang SC", "Noto Sans TC", sans-serif',
    rounded: '"SF Pro Rounded", "Arial Rounded MT Bold", "PingFang TC", sans-serif',
    serif: '"Songti TC", "Noto Serif TC", Georgia, serif',
    mono: '"SFMono-Regular", Menlo, Monaco, "Noto Sans Mono CJK TC", monospace',
  });
  const VISUAL_DEFAULTS = Object.freeze({
    fontScale: 1,
    bottomPercent: 6,
    fontFamily: 'netflix',
    fontWeight: 500,
    primaryColor: '#ffffff',
    secondaryColor: '#eeeeee',
    secondaryScale: 0.82,
    backgroundOpacity: 0,
    outlineStrength: 2,
    lineHeight: 1.3,
    captionGap: 0.2,
  });

  if (
    PAGE.__netflixDualSubsInstalled ||
    PAGE.__netflixOfficialDualSubsInstalled
  ) return;
  PAGE.__netflixDualSubsInstalled = true;
  // Keep the old marker so upgrading users cannot load both versions at once.
  PAGE.__netflixOfficialDualSubsInstalled = true;

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    preferredPrimaryLanguage: '',
    preferredPrimaryTrackType: '',
    preferredPrimaryForced: false,
    preferredLanguage: '',
    preferredTrackType: '',
    preferredForced: false,
    ...VISUAL_DEFAULTS,
    delaySeconds: 0,
    syncMode: 'stable',
    panelOpen: false,
  });

  const state = {
    settings: loadSettings(),
    manifests: new Map(),
    latestManifestId: '',
    currentMovieId: '',
    tracks: [],
    activePrimaryLanguage: '',
    primaryTrackId: '',
    selectedTrackId: '',
    loadingPrimaryTrackId: '',
    loadingTrackId: '',
    primaryAttemptSignature: '',
    attemptSignature: '',
    primaryCues: [],
    cues: [],
    alignedBlocks: [],
    alignmentSignature: '',
    cueKey: '',
    primaryLoadGeneration: 0,
    loadGeneration: 0,
    primaryLoadError: '',
    secondaryLoadError: '',
    status: '等待 Netflix 字幕資料…',
    statusKind: '',
    overlay: null,
    overlayText: null,
    controlsRoot: null,
    toggleButton: null,
    panel: null,
    primaryTrackSelect: null,
    trackSelect: null,
    syncModeSelect: null,
    statusNode: null,
    video: null,
    overlayHost: null,
    lastTickAt: 0,
  };

  function log(...args) {
    if (DEBUG) console.debug('[Netflix Dual Subs]', ...args);
  }

  function warn(...args) {
    console.warn('[Netflix Dual Subs]', ...args);
  }

  function clampNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(maximum, Math.max(minimum, number))
      : fallback;
  }

  function normalizeColor(value, fallback) {
    const color = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
  }

  function normalizeSettings(input = {}) {
    const merged = { ...DEFAULT_SETTINGS, ...input };
    const legacyPrimaryColor =
      input.primaryColor === undefined ? input.textColor : input.primaryColor;
    return {
      ...merged,
      fontScale: clampNumber(
        merged.fontScale,
        0.7,
        1.6,
        VISUAL_DEFAULTS.fontScale,
      ),
      bottomPercent: clampNumber(
        merged.bottomPercent,
        2,
        42,
        VISUAL_DEFAULTS.bottomPercent,
      ),
      delaySeconds: clampNumber(merged.delaySeconds, -5, 5, 0),
      fontFamily: Object.hasOwn(FONT_FAMILIES, merged.fontFamily)
        ? merged.fontFamily
        : VISUAL_DEFAULTS.fontFamily,
      fontWeight: [400, 500, 600, 700, 800].includes(Number(merged.fontWeight))
        ? Number(merged.fontWeight)
        : VISUAL_DEFAULTS.fontWeight,
      primaryColor: normalizeColor(
        legacyPrimaryColor,
        VISUAL_DEFAULTS.primaryColor,
      ),
      secondaryColor: normalizeColor(
        merged.secondaryColor,
        VISUAL_DEFAULTS.secondaryColor,
      ),
      secondaryScale: clampNumber(
        merged.secondaryScale,
        0.7,
        1,
        VISUAL_DEFAULTS.secondaryScale,
      ),
      backgroundOpacity: clampNumber(
        merged.backgroundOpacity,
        0,
        0.9,
        VISUAL_DEFAULTS.backgroundOpacity,
      ),
      outlineStrength: Math.round(
        clampNumber(
          merged.outlineStrength,
          0,
          3,
          VISUAL_DEFAULTS.outlineStrength,
        ),
      ),
      lineHeight: clampNumber(
        merged.lineHeight,
        1.1,
        1.6,
        VISUAL_DEFAULTS.lineHeight,
      ),
      captionGap: clampNumber(
        merged.captionGap,
        0,
        0.6,
        VISUAL_DEFAULTS.captionGap,
      ),
    };
  }

  function subtitleShadow(strength) {
    const shadows = [
      'none',
      '0 1px 2px rgba(0, 0, 0, .95)',
      '-1px -1px 1px #000, 1px -1px 1px #000, -1px 1px 1px #000, 1px 1px 1px #000, 0 2px 3px rgba(0, 0, 0, .95)',
      '-2px -2px 2px #000, 2px -2px 2px #000, -2px 2px 2px #000, 2px 2px 2px #000, 0 3px 5px #000',
    ];
    return shadows[Math.round(clampNumber(strength, 0, 3, 2))];
  }

  function loadSettings() {
    try {
      let saved = PAGE.localStorage.getItem(STORAGE_KEY);
      let legacyStorageKey = '';
      if (!saved) {
        legacyStorageKey = LEGACY_STORAGE_KEYS.find((key) =>
          PAGE.localStorage.getItem(key),
        ) || '';
        saved = legacyStorageKey
          ? PAGE.localStorage.getItem(legacyStorageKey)
          : null;
      }
      if (!saved) return normalizeSettings();
      const parsed = PAGE.JSON.parse(saved);
      const settings = normalizeSettings(parsed);
      if (legacyStorageKey) {
        try {
          PAGE.localStorage.setItem(STORAGE_KEY, PAGE.JSON.stringify(settings));
        } catch (migrationError) {
          warn('已讀取舊版設定，但暫時無法遷移儲存位置。', migrationError);
        }
      }
      return settings;
    } catch (error) {
      warn('無法讀取設定，改用預設值。', error);
      return normalizeSettings();
    }
  }

  function saveSettings(patch = {}) {
    state.settings = normalizeSettings({ ...state.settings, ...patch });
    try {
      PAGE.localStorage.setItem(STORAGE_KEY, PAGE.JSON.stringify(state.settings));
    } catch (error) {
      warn('無法儲存設定。', error);
    }
    applyVisualSettings();
  }

  // ---------------------------------------------------------------------------
  // Netflix manifest interception
  // ---------------------------------------------------------------------------

  function installManifestHooks() {
    const nativeStringify = PAGE.JSON.stringify;
    const nativeParse = PAGE.JSON.parse;

    PAGE.JSON.stringify = function netflixDualSubsStringify(value) {
      try {
        const profiles = value?.params?.profiles;
        if (
          Array.isArray(profiles) &&
          profiles.some(
            (profile) =>
              typeof profile === 'string' &&
              /^(heaac|playready|dfxp|simplesdh|imsc|webvtt)/i.test(profile),
          ) &&
          !profiles.includes(WEBVTT_PROFILE)
        ) {
          profiles.push(WEBVTT_PROFILE);
        }
      } catch (_) {
        // Never interfere with Netflix playback.
      }
      return Reflect.apply(nativeStringify, this, arguments);
    };

    PAGE.JSON.parse = function netflixDualSubsParse() {
      const value = Reflect.apply(nativeParse, this, arguments);
      try {
        const raw = arguments[0];
        if (
          typeof raw === 'string' &&
          raw.includes('"movieId"') &&
          (raw.includes('"textTracks"') || raw.includes('"timedtexttracks"'))
        ) {
          scanForManifests(value);
        }
      } catch (_) {
        // Never interfere with Netflix playback.
      }
      return value;
    };
  }

  function scanForManifests(root) {
    if (!root || typeof root !== 'object') return;

    const queue = [{ value: root, depth: 0 }];
    const seen = new Set();
    let visited = 0;

    while (queue.length && visited < 300) {
      const { value, depth } = queue.shift();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      visited += 1;

      const tracks = Array.isArray(value.textTracks)
        ? value.textTracks
        : value.timedtexttracks;
      if (value.movieId != null && Array.isArray(tracks)) {
        captureManifest(value);
      }

      if (depth >= 5) continue;
      if (Array.isArray(value)) {
        for (let i = 0; i < Math.min(value.length, 80); i += 1) {
          queue.push({ value: value[i], depth: depth + 1 });
        }
      } else {
        for (const key of Object.keys(value)) {
          const child = value[key];
          if (child && typeof child === 'object') {
            queue.push({ value: child, depth: depth + 1 });
          }
        }
      }
    }
  }

  function captureManifest(manifest) {
    const movieId = String(manifest.movieId);
    state.manifests.set(movieId, manifest);
    state.latestManifestId = movieId;
    log('擷取 manifest', movieId);
    queueMicrotask(refreshPlaybackContext);
  }

  // ---------------------------------------------------------------------------
  // Track extraction and download
  // ---------------------------------------------------------------------------

  function isNoneTrack(track) {
    if (!track || track.isNoneTrack || track.isNone || track.rank < 0) return true;
    const rawId = track.id ?? track.new_track_id;
    if (typeof rawId === 'string') {
      try {
        if (rawId.split(';')[4] === '1') return true;
      } catch (_) {
        // Ignore malformed IDs.
      }
    }
    return false;
  }

  function trackTypeOf(track) {
    return String(track.rawTrackType || track.trackType || '');
  }

  function downloadableUrls(downloadable) {
    if (!downloadable) return [];
    const result = [];
    const add = (candidate) => {
      const url =
        typeof candidate === 'string'
          ? candidate
          : candidate?.url || candidate?.cdnUrl;
      if (typeof url === 'string' && url.startsWith('http') && !result.includes(url)) {
        result.push(url);
      }
    };

    if (Array.isArray(downloadable.urls)) {
      downloadable.urls.forEach(add);
    }
    if (downloadable.downloadUrls && typeof downloadable.downloadUrls === 'object') {
      Object.values(downloadable.downloadUrls).forEach(add);
    }
    add(downloadable);
    return result;
  }

  function selectTextDownloadable(track) {
    const downloadables = track.downloadables || track.ttDownloadables || {};
    const keys = Object.keys(downloadables);
    const preferredKeys = [
      WEBVTT_PROFILE,
      ...keys.filter((key) => /webvtt|vtt/i.test(key)),
      'dfxp-ls-sdh',
      ...keys.filter((key) => /dfxp|ttml|imsc|simplesdh/i.test(key)),
    ];

    for (const key of [...new Set(preferredKeys)]) {
      const downloadable = downloadables[key];
      if (!downloadable || downloadable.isImage) continue;
      const urls = downloadableUrls(downloadable);
      if (!urls.length) continue;
      return {
        profile: key,
        format: /webvtt|vtt/i.test(key) ? 'webvtt' : 'ttml',
        urls,
      };
    }
    return null;
  }

  function extractTracks(manifest) {
    const sourceTracks = Array.isArray(manifest.textTracks)
      ? manifest.textTracks
      : manifest.timedtexttracks || [];
    const tracks = [];

    for (const source of sourceTracks) {
      if (isNoneTrack(source)) continue;
      const downloadable = selectTextDownloadable(source);
      if (!downloadable) continue;
      const type = trackTypeOf(source);
      const language = String(source.language || source.bcp47 || '');
      const label = String(
        source.languageDescription ||
          source.displayName ||
          source.trackDisplayName ||
          language ||
          '未知語言',
      );
      tracks.push({
        id: `${source.id ?? source.new_track_id ?? language}:${type}:${tracks.length}`,
        language,
        label,
        trackType: type,
        forced: Boolean(source.isForcedNarrative || source.forced),
        profile: downloadable.profile,
        format: downloadable.format,
        urls: downloadable.urls,
      });
    }
    return tracks;
  }

  function slotKeys(role) {
    return role === 'primary'
      ? {
          trackId: 'primaryTrackId',
          loadingTrackId: 'loadingPrimaryTrackId',
          attemptSignature: 'primaryAttemptSignature',
          cues: 'primaryCues',
          loadGeneration: 'primaryLoadGeneration',
          error: 'primaryLoadError',
        }
      : {
          trackId: 'selectedTrackId',
          loadingTrackId: 'loadingTrackId',
          attemptSignature: 'attemptSignature',
          cues: 'cues',
          loadGeneration: 'loadGeneration',
          error: 'secondaryLoadError',
        };
  }

  function takeoverReady() {
    return Boolean(
      state.settings.enabled &&
        state.primaryTrackId &&
        state.selectedTrackId &&
        state.primaryCues.length &&
        state.cues.length,
    );
  }

  function updateLoadStatus() {
    const primary = state.tracks.find((track) => track.id === state.primaryTrackId);
    const secondary = state.tracks.find((track) => track.id === state.selectedTrackId);
    if (!state.settings.enabled) {
      updateStatus('雙字幕已關閉；使用 Netflix 原生字幕', '');
    } else if (state.primaryLoadError || state.secondaryLoadError) {
      const failures = [
        state.primaryLoadError ? `主字幕：${state.primaryLoadError}` : '',
        state.secondaryLoadError ? `第二字幕：${state.secondaryLoadError}` : '',
      ].filter(Boolean);
      updateStatus(`接管失敗，已保留 Netflix 原生字幕（${failures.join('；')}）`, 'error');
    } else if (takeoverReady()) {
      rebuildStableBlocks();
      updateStatus(
        `主字幕 ${state.primaryCues.length} 段「${displayTrackLabel(primary)}」` +
          `＋第二字幕 ${state.cues.length} 段「${displayTrackLabel(secondary)}」` +
          (state.settings.syncMode === 'stable'
            ? `；穩定對齊 ${state.alignedBlocks.length} 組`
            : ''),
        'ok',
      );
    } else if (state.loadingPrimaryTrackId || state.loadingTrackId) {
      const loading = [
        state.loadingPrimaryTrackId ? `主字幕「${displayTrackLabel(primary)}」` : '',
        state.loadingTrackId ? `第二字幕「${displayTrackLabel(secondary)}」` : '',
      ].filter(Boolean);
      updateStatus(`下載${loading.join('、')}…`, '');
    } else {
      updateStatus('等待兩條 Netflix 提供的字幕…', '');
    }
    applyTakeoverState();
  }

  async function loadTrack(track, role = 'secondary') {
    const keys = slotKeys(role);
    if (!track) {
      state[keys.loadGeneration] += 1;
      state[keys.trackId] = '';
      state[keys.loadingTrackId] = '';
      state[keys.attemptSignature] = '';
      state[keys.cues] = [];
      state[keys.error] = '';
      state.alignedBlocks = [];
      state.alignmentSignature = '';
      state.cueKey = '';
      renderDualSubtitles('', '');
      syncTrackSelects();
      updateLoadStatus();
      return;
    }

    const signature = `${state.currentMovieId}|${track.id}|${track.urls[0] || ''}`;
    if (
      state[keys.attemptSignature] === signature &&
      (state[keys.cues].length ||
        state[keys.loadingTrackId] === track.id ||
        state[keys.error])
    ) {
      return;
    }

    const generation = ++state[keys.loadGeneration];
    state[keys.trackId] = track.id;
    state[keys.loadingTrackId] = track.id;
    state[keys.attemptSignature] = signature;
    state[keys.cues] = [];
    state[keys.error] = '';
    state.alignedBlocks = [];
    state.alignmentSignature = '';
    state.cueKey = '';
    renderDualSubtitles('', '');
    syncTrackSelects();
    updateLoadStatus();

    let lastError = null;
    for (const url of track.urls) {
      try {
        const response = await PAGE.fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        const format = /^\s*WEBVTT/i.test(text) ? 'webvtt' : track.format;
        const cues = format === 'webvtt' ? parseWebVTT(text) : parseTTML(text);
        if (!cues.length) throw new Error('字幕檔沒有可解析的文字時間碼');
        if (generation !== state[keys.loadGeneration]) return;
        state[keys.loadingTrackId] = '';
        state[keys.cues] = cues;
        state[keys.error] = '';
        state.cueKey = '';
        updateLoadStatus();
        return;
      } catch (error) {
        lastError = error;
      }
    }

    if (generation !== state[keys.loadGeneration]) return;
    state[keys.loadingTrackId] = '';
    state[keys.cues] = [];
    state[keys.error] = lastError?.message || '未知錯誤';
    updateLoadStatus();
  }

  // ---------------------------------------------------------------------------
  // WebVTT and TTML parsers
  // ---------------------------------------------------------------------------

  function clockTime(value) {
    const text = String(value || '').trim().replace(',', '.');
    const unit = text.match(/^(-?[\d.]+)(h|m|s|ms)$/i);
    if (unit) {
      const amount = Number(unit[1]);
      const suffix = unit[2].toLowerCase();
      if (suffix === 'h') return amount * 3600;
      if (suffix === 'm') return amount * 60;
      if (suffix === 'ms') return amount / 1000;
      return amount;
    }

    const parts = text.split(':');
    if (parts.length < 2 || parts.length > 3) return Number(text) || 0;
    const seconds = Number(parts.pop()) || 0;
    const minutes = Number(parts.pop()) || 0;
    const hours = parts.length ? Number(parts.pop()) || 0 : 0;
    return hours * 3600 + minutes * 60 + seconds;
  }

  function decodeEntities(value) {
    return String(value)
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;|&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)));
  }

  function stripSubtitleMarkup(value) {
    return decodeEntities(
      String(value)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, ''),
    )
      .replace(/\u200e|\u200f|\ufeff/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  function mergeCues(cues) {
    const sorted = cues
      .filter(
        (cue) =>
          Number.isFinite(cue.start) &&
          Number.isFinite(cue.end) &&
          cue.end >= cue.start &&
          cue.text,
      )
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const output = [];

    for (const cue of sorted) {
      const previous = output[output.length - 1];
      if (
        previous &&
        Math.abs(previous.start - cue.start) < 0.02 &&
        Math.abs(previous.end - cue.end) < 0.02
      ) {
        if (previous.text !== cue.text && !previous.text.includes(cue.text)) {
          previous.text += `\n${cue.text}`;
        }
      } else {
        output.push({ start: cue.start, end: cue.end, text: cue.text });
      }
    }
    return output;
  }

  function parseWebVTT(text) {
    const cues = [];
    const lines = String(text).replace(/\r/g, '').split('\n');

    for (let index = 0; index < lines.length; index += 1) {
      const timing = lines[index].match(
        /^\s*([\d:.,]+)\s+-->\s+([\d:.,]+)(?:\s+.*)?$/,
      );
      if (!timing) continue;
      const buffer = [];
      index += 1;
      while (index < lines.length && lines[index].trim() !== '') {
        buffer.push(lines[index]);
        index += 1;
      }
      const cueText = stripSubtitleMarkup(buffer.join('\n'));
      if (cueText) {
        cues.push({
          start: clockTime(timing[1]),
          end: clockTime(timing[2]),
          text: cueText,
        });
      }
    }
    return mergeCues(cues);
  }

  function parseTTML(text) {
    const parser = new PAGE.DOMParser();
    const documentNode = parser.parseFromString(String(text), 'text/xml');
    if (documentNode.querySelector('parsererror')) return [];

    const root = documentNode.documentElement;
    const namespace = 'http://www.w3.org/ns/ttml#parameter';
    const tickRate = Number(root.getAttribute('ttp:tickRate') || root.getAttributeNS(namespace, 'tickRate')) || 10_000_000;
    const frameRate = Number(root.getAttribute('ttp:frameRate') || root.getAttributeNS(namespace, 'frameRate')) || 30;

    const parseTime = (raw) => {
      const value = String(raw || '').trim();
      if (!value) return 0;
      if (/t$/i.test(value)) return parseFloat(value) / tickRate;
      if (/f$/i.test(value)) return parseFloat(value) / frameRate;
      const frameClock = value.match(/^(\d+):(\d+):(\d+):(\d+(?:\.\d+)?)$/);
      if (frameClock) {
        return (
          Number(frameClock[1]) * 3600 +
          Number(frameClock[2]) * 60 +
          Number(frameClock[3]) +
          Number(frameClock[4]) / frameRate
        );
      }
      return clockTime(value);
    };

    const paragraphs = Array.from(documentNode.getElementsByTagName('*')).filter(
      (node) => node.localName?.toLowerCase() === 'p',
    );
    const cues = [];

    for (const paragraph of paragraphs) {
      const start = parseTime(paragraph.getAttribute('begin'));
      let end = parseTime(paragraph.getAttribute('end'));
      if (!paragraph.getAttribute('end') && paragraph.getAttribute('dur')) {
        end = start + parseTime(paragraph.getAttribute('dur'));
      }

      let value = '';
      const walk = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === PAGE.Node.TEXT_NODE) {
            value += child.textContent || '';
          } else if (child.localName?.toLowerCase() === 'br') {
            value += '\n';
          } else {
            walk(child);
          }
        }
      };
      walk(paragraph);
      value = value
        .replace(/\s*\n\s*/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
      if (value) cues.push({ start, end, text: value });
    }
    return mergeCues(cues);
  }

  // ---------------------------------------------------------------------------
  // Stable bilingual timing
  // ---------------------------------------------------------------------------

  function hasTerminalPunctuation(text) {
    return /[.!?。！？…][\s"'’”」』）)\]]*$/.test(String(text || '').trim());
  }

  function joinSubtitleParts(parts, separator = '') {
    const output = [];
    for (const value of parts) {
      const text = String(value || '').replace(/\s*\n\s*/g, ' ').trim();
      if (!text || output.includes(text)) continue;
      output.push(text);
    }
    if (!output.length) return '';
    if (separator) return output.join(separator);

    let result = output[0];
    for (const next of output.slice(1)) {
      const needsSpace =
        !/[\u3400-\u9fff]$/.test(result) ||
        !/^[\u3400-\u9fff]/.test(next);
      result += `${needsSpace ? ' ' : ''}${next}`;
    }
    return result;
  }

  function groupSentenceCues(cues) {
    const groups = [];
    for (const cue of cues) {
      if (!cue?.text) continue;
      const current = groups.at(-1);
      if (!current) {
        groups.push({
          start: cue.start,
          end: cue.end,
          parts: [cue.text],
          text: cue.text,
        });
        continue;
      }

      const gap = cue.start - current.end;
      const startSpread = cue.start - current.start;
      const shouldMerge =
        gap <= 0.28 &&
        startSpread <= 2.4 &&
        cue.end - current.start <= 7 &&
        (!hasTerminalPunctuation(current.text) || cue.start < current.end - 0.05);

      if (shouldMerge) {
        current.end = Math.max(current.end, cue.end);
        current.parts.push(cue.text);
        current.text = joinSubtitleParts(current.parts);
      } else {
        groups.push({
          start: cue.start,
          end: cue.end,
          parts: [cue.text],
          text: cue.text,
        });
      }
    }
    return groups;
  }

  function intervalGap(first, second) {
    if (first.end < second.start) return second.start - first.end;
    if (second.end < first.start) return first.start - second.end;
    return 0;
  }

  function buildStableBlocks(primaryCues, secondaryCues) {
    const primary = groupSentenceCues(primaryCues);
    const secondary = groupSentenceCues(secondaryCues);
    const blocks = [];
    let primaryIndex = 0;
    let secondaryIndex = 0;

    while (primaryIndex < primary.length || secondaryIndex < secondary.length) {
      const firstPrimary = primary[primaryIndex];
      const firstSecondary = secondary[secondaryIndex];

      if (!firstPrimary) {
        secondaryIndex += 1;
        continue;
      }
      if (!firstSecondary) {
        primaryIndex += 1;
        continue;
      }

      if (intervalGap(firstPrimary, firstSecondary) > 0.55) {
        if (firstPrimary.end < firstSecondary.start) {
          primaryIndex += 1;
        } else {
          secondaryIndex += 1;
        }
        continue;
      }

      const primaryItems = [firstPrimary];
      const secondaryItems = [firstSecondary];
      primaryIndex += 1;
      secondaryIndex += 1;

      for (let pass = 0; pass < 4; pass += 1) {
        const primaryEnd = Math.max(...primaryItems.map((item) => item.end));
        const secondaryEnd = Math.max(...secondaryItems.map((item) => item.end));
        const nextPrimary = primary[primaryIndex];
        const nextSecondary = secondary[secondaryIndex];
        let extended = false;

        if (
          nextPrimary &&
          primaryEnd + 0.25 < secondaryEnd &&
          nextPrimary.start <= secondaryEnd + 0.08 &&
          nextPrimary.end - primaryItems[0].start <= 8
        ) {
          primaryItems.push(nextPrimary);
          primaryIndex += 1;
          extended = true;
        }
        if (
          nextSecondary &&
          secondaryEnd + 0.25 < primaryEnd &&
          nextSecondary.start <= primaryEnd + 0.08 &&
          nextSecondary.end - secondaryItems[0].start <= 8
        ) {
          secondaryItems.push(nextSecondary);
          secondaryIndex += 1;
          extended = true;
        }
        if (!extended) break;
      }

      const primaryStart = Math.min(...primaryItems.map((item) => item.start));
      const secondaryStart = Math.min(...secondaryItems.map((item) => item.start));
      blocks.push({
        start: Math.max(primaryStart, secondaryStart) - 0.04,
        end: Math.max(
          ...primaryItems.map((item) => item.end),
          ...secondaryItems.map((item) => item.end),
        ),
        primaryText: joinSubtitleParts(primaryItems.map((item) => item.text)),
        secondaryText: joinSubtitleParts(secondaryItems.map((item) => item.text)),
        paired: true,
      });
    }

    blocks.sort((first, second) => first.start - second.start);
    for (let index = 0; index < blocks.length - 1; index += 1) {
      const current = blocks[index];
      const next = blocks[index + 1];
      if (current.end >= next.start) {
        current.end = Math.max(current.start + 0.12, next.start - 0.04);
      }
    }
    return blocks.filter((block) => block.end > block.start);
  }

  function activeStableBlock(blocks, time) {
    if (!blocks.length) return null;
    let low = 0;
    let high = blocks.length - 1;
    let lastStarted = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (blocks[middle].start <= time) {
        lastStarted = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (lastStarted < 0) return null;
    const block = blocks[lastStarted];
    return block.end + 0.08 >= time ? block : null;
  }

  function rebuildStableBlocks() {
    const signature =
      `${state.currentMovieId}|${state.primaryTrackId}|${state.primaryCues.length}|` +
      `${state.selectedTrackId}|${state.cues.length}`;
    if (signature === state.alignmentSignature) return;
    state.alignmentSignature = signature;
    state.alignedBlocks = buildStableBlocks(state.primaryCues, state.cues);
  }

  // ---------------------------------------------------------------------------
  // Playback and automatic track selection
  // ---------------------------------------------------------------------------

  function normalizeLanguage(language) {
    return String(language || '')
      .toLowerCase()
      .replace(/_/g, '-');
  }

  function baseLanguage(language) {
    return normalizeLanguage(language).split('-')[0];
  }

  function isCaption(track) {
    return /closed|caption|sdh/i.test(track.trackType);
  }

  function displayTrackLabel(track) {
    const suffixes = [];
    if (track.forced) suffixes.push('強制');
    if (isCaption(track)) suffixes.push('CC');
    return `${track.label}${suffixes.length ? `（${suffixes.join('、')}）` : ''}`;
  }

  function getPlayerMovieIdAndPrimaryLanguage() {
    try {
      const playerApp = PAGE.netflix?.appContext?.state?.playerApp;
      const api = playerApp?.getAPI?.();
      const videoPlayer = api?.videoPlayer;
      const sessionIds = videoPlayer?.getAllPlayerSessionIds?.() || [];
      for (const sessionId of sessionIds) {
        const player = videoPlayer.getVideoPlayerBySessionId?.(sessionId);
        const movieId = player?.getMovieId?.();
        if (movieId == null) continue;
        const primary = player?.getTimedTextTrack?.();
        const language =
          primary && !primary.isNoneTrack
            ? primary.bcp47Code ||
              primary.bcp47 ||
              primary.language ||
              ''
            : '';
        return { movieId: String(movieId), primaryLanguage: String(language) };
      }
    } catch (_) {
      // The private player API is best-effort only.
    }
    return { movieId: '', primaryLanguage: '' };
  }

  function movieIdFromUrl() {
    return PAGE.location.pathname.match(/^\/watch\/(\d+)/)?.[1] || '';
  }

  function findPreferredTrack(tracks, language, trackType, forced, excludedIds = []) {
    if (!language) return null;
    const available = tracks.filter((track) => !excludedIds.includes(track.id));
    const preferred = normalizeLanguage(language);
    const exact = available.find(
      (track) =>
        normalizeLanguage(track.language) === preferred &&
        isCaption(track) === /closed|caption|sdh/i.test(trackType) &&
        track.forced === Boolean(forced),
    );
    if (exact) return exact;
    const sameLanguage = available.find(
      (track) => normalizeLanguage(track.language) === preferred && !track.forced,
    );
    if (sameLanguage) return sameLanguage;
    return (
      available.find(
        (track) => baseLanguage(track.language) === baseLanguage(preferred) && !track.forced,
      ) || null
    );
  }

  function localeCandidates() {
    return Array.from(
      new Set(
        [
          ...(PAGE.navigator.languages || []),
          PAGE.navigator.language,
          'zh-Hant',
          'zh-TW',
          'en',
        ].filter(Boolean),
      ),
    );
  }

  function choosePrimaryTrack(tracks) {
    if (!tracks.length) return null;
    const settings = state.settings;
    const saved = findPreferredTrack(
      tracks,
      settings.preferredPrimaryLanguage,
      settings.preferredPrimaryTrackType,
      settings.preferredPrimaryForced,
    );
    if (saved) return saved;

    const current = findPreferredTrack(
      tracks,
      state.activePrimaryLanguage,
      '',
      false,
    );
    if (current) return current;

    for (const language of localeCandidates()) {
      const candidate = findPreferredTrack(tracks, language, '', false);
      if (candidate) return candidate;
    }
    return tracks.find((track) => !track.forced) || tracks[0];
  }

  function chooseInitialTrack(tracks, primaryTrack = null) {
    if (!tracks.length) return null;
    const settings = state.settings;
    const excludedIds = primaryTrack ? [primaryTrack.id] : [];
    const saved = findPreferredTrack(
      tracks,
      settings.preferredLanguage,
      settings.preferredTrackType,
      settings.preferredForced,
      excludedIds,
    );
    if (saved) return saved;

    const primaryBase = baseLanguage(primaryTrack?.language || state.activePrimaryLanguage);
    const localeCandidates = Array.from(
      new Set(
        [
          ...(PAGE.navigator.languages || []),
          PAGE.navigator.language,
          'zh-Hant',
          'zh-TW',
          'en',
        ].filter(Boolean),
      ),
    );
    const desired =
      primaryBase === 'en'
        ? localeCandidates
        : ['en', ...localeCandidates];

    for (const language of desired) {
      const exact = tracks.find(
        (track) =>
          normalizeLanguage(track.language) === normalizeLanguage(language) &&
          !track.forced &&
          baseLanguage(track.language) !== primaryBase &&
          !excludedIds.includes(track.id),
      );
      if (exact) return exact;
    }
    for (const language of desired) {
      const sameBase = tracks.find(
        (track) =>
          baseLanguage(track.language) === baseLanguage(language) &&
          !track.forced &&
          baseLanguage(track.language) !== primaryBase &&
          !excludedIds.includes(track.id),
      );
      if (sameBase) return sameBase;
    }
    return (
      tracks.find((track) => !track.forced && !excludedIds.includes(track.id)) ||
      tracks.find((track) => !excludedIds.includes(track.id)) ||
      null
    );
  }

  function selectManifestForPlayback() {
    const player = getPlayerMovieIdAndPrimaryLanguage();
    state.activePrimaryLanguage = player.primaryLanguage;
    const candidates = [player.movieId, movieIdFromUrl()].filter(Boolean);

    for (const id of candidates) {
      if (state.manifests.has(id)) return state.manifests.get(id);
    }

    const video = document.querySelector('#appMountPoint video, video');
    if (video) {
      for (const [id, manifest] of [...state.manifests.entries()].reverse()) {
        let parent = video.parentElement;
        for (let level = 0; parent && level < 5; level += 1, parent = parent.parentElement) {
          if (parent.id?.includes(id)) return manifest;
        }
      }
    }
    return null;
  }

  function activateManifest(manifest) {
    const movieId = String(manifest.movieId);
    const tracks = extractTracks(manifest);
    if (!tracks.length) {
      updateStatus('此集沒有可讀取的文字字幕軌', 'error');
      return;
    }

    state.currentMovieId = movieId;
    state.tracks = tracks;
    populateTrackSelects();

    if (!state.settings.enabled) {
      updateLoadStatus();
      return;
    }

    const primary =
      tracks.find((track) => track.id === state.primaryTrackId) ||
      choosePrimaryTrack(tracks);
    const secondary =
      tracks.find(
        (track) =>
          track.id === state.selectedTrackId &&
          track.id !== primary?.id,
      ) || chooseInitialTrack(tracks, primary);

    if (!primary || !secondary) {
      state.primaryLoadError = !primary ? '找不到主字幕軌' : '';
      state.secondaryLoadError = !secondary ? '找不到不同的第二字幕軌' : '';
      updateLoadStatus();
      return;
    }

    loadTrack(primary, 'primary');
    loadTrack(secondary, 'secondary');
  }

  function refreshPlaybackContext() {
    ensureUI();
    const onWatchPage = Boolean(movieIdFromUrl());
    setControlsVisible(onWatchPage);
    if (!onWatchPage) {
      state.currentMovieId = '';
      state.tracks = [];
      state.primaryLoadGeneration += 1;
      state.loadGeneration += 1;
      state.loadingPrimaryTrackId = '';
      state.loadingTrackId = '';
      state.primaryAttemptSignature = '';
      state.attemptSignature = '';
      state.primaryCues = [];
      state.cues = [];
      state.alignedBlocks = [];
      state.alignmentSignature = '';
      state.primaryTrackId = '';
      state.selectedTrackId = '';
      state.primaryLoadError = '';
      state.secondaryLoadError = '';
      state.cueKey = '';
      renderDualSubtitles('', '');
      applyTakeoverState();
      return;
    }

    const manifest = selectManifestForPlayback();
    if (manifest) {
      activateManifest(manifest);
    } else {
      updateStatus('等待 Netflix 字幕資料…若持續無資料請重新整理播放頁', '');
    }
  }

  // ---------------------------------------------------------------------------
  // Overlay and controls
  // ---------------------------------------------------------------------------

  function installStyles() {
    if (document.getElementById(`${SCRIPT_ID}-style`)) return;
    const style = document.createElement('style');
    style.id = `${SCRIPT_ID}-style`;
    style.textContent = `
      html.ndos-takeover-active .player-timedtext,
      html.ndos-takeover-active .player-timedtext-text-container,
      html.ndos-takeover-active [data-uia="player-subtitle-text"] {
        visibility: hidden !important;
      }
      #ndos-overlay {
        --ndos-bottom: 6%;
        --ndos-scale: 1;
        --ndos-color: #fff;
        --ndos-secondary-color: #eee;
        --ndos-bg: rgba(0, 0, 0, 0);
        --ndos-font-family: "Netflix Sans", "Helvetica Neue", "PingFang TC",
          "Noto Sans TC", Arial, sans-serif;
        --ndos-weight: 500;
        --ndos-secondary-scale: .82;
        --ndos-line-height: 1.3;
        --ndos-caption-gap: .2em;
        --ndos-shadow:
          -1px -1px 1px #000, 1px -1px 1px #000,
          -1px 1px 1px #000, 1px 1px 1px #000,
          0 2px 3px rgba(0, 0, 0, .95);
        position: absolute;
        inset: 0;
        z-index: 2147483600;
        pointer-events: none;
        overflow: hidden;
        font-family: var(--ndos-font-family);
      }
      #ndos-overlay-text {
        position: absolute;
        left: 4%;
        right: 4%;
        bottom: var(--ndos-bottom);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--ndos-caption-gap);
        color: var(--ndos-color);
        font-size: clamp(18px, calc(2.15vw * var(--ndos-scale)), 54px);
        font-weight: var(--ndos-weight);
        line-height: var(--ndos-line-height);
        text-align: center;
        text-shadow: var(--ndos-shadow);
      }
      #ndos-overlay-text .ndos-caption {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-end;
        gap: .08em;
        width: 100%;
        min-height: 1.3em;
      }
      #ndos-overlay-text .ndos-primary {
        order: 1;
      }
      #ndos-overlay-text .ndos-secondary {
        order: 2;
        color: var(--ndos-secondary-color);
        font-size: calc(1em * var(--ndos-secondary-scale));
        font-weight: var(--ndos-weight);
      }
      #ndos-overlay-text .ndos-placeholder {
        visibility: hidden;
      }
      #ndos-overlay-text .ndos-line {
        display: inline;
        width: fit-content;
        max-width: 100%;
        padding: .05em .24em .08em;
        border-radius: .12em;
        background: var(--ndos-bg);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      #ndos-controls-root {
        position: fixed;
        top: 68px;
        right: 18px;
        z-index: 2147483646;
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang TC",
          "Helvetica Neue", sans-serif;
      }
      #ndos-toggle {
        float: right;
        width: 44px;
        height: 34px;
        border: 1px solid rgba(255,255,255,.38);
        border-radius: 9px;
        color: #fff;
        background: rgba(18,18,18,.84);
        box-shadow: 0 4px 16px rgba(0,0,0,.38);
        font: 700 14px/1 -apple-system, BlinkMacSystemFont, sans-serif;
        cursor: pointer;
        backdrop-filter: blur(12px);
      }
      #ndos-toggle:hover, #ndos-toggle[aria-expanded="true"] {
        background: #e50914;
        border-color: #e50914;
      }
      #ndos-panel {
        clear: both;
        width: min(330px, calc(100vw - 36px));
        max-height: min(78vh, 720px);
        margin-top: 42px;
        padding: 15px;
        border: 1px solid rgba(255,255,255,.18);
        border-radius: 12px;
        background: rgba(16,16,18,.94);
        box-shadow: 0 12px 38px rgba(0,0,0,.55);
        backdrop-filter: blur(18px);
        overflow: auto;
      }
      #ndos-panel[hidden] { display: none !important; }
      #ndos-panel h2 {
        margin: 0 0 12px;
        font-size: 16px;
        line-height: 1.25;
      }
      #ndos-panel label {
        display: block;
        margin-top: 11px;
        color: rgba(255,255,255,.86);
        font-size: 12px;
      }
      #ndos-panel .ndos-inline {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      #ndos-panel .ndos-inline label {
        margin: 0;
        font-size: 13px;
      }
      #ndos-panel select,
      #ndos-panel input[type="range"],
      #ndos-panel input[type="color"] {
        width: 100%;
        margin-top: 5px;
      }
      #ndos-panel select {
        box-sizing: border-box;
        height: 34px;
        padding: 0 8px;
        border: 1px solid rgba(255,255,255,.24);
        border-radius: 7px;
        color: #fff;
        background: #29292d;
        font-size: 13px;
      }
      #ndos-panel output {
        color: rgba(255,255,255,.7);
        font-variant-numeric: tabular-nums;
      }
      #ndos-style {
        margin-top: 12px;
        border-top: 1px solid rgba(255,255,255,.12);
        padding-top: 10px;
      }
      #ndos-style summary {
        color: rgba(255,255,255,.92);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      #ndos-style .ndos-color-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      #ndos-style input[type="color"] {
        box-sizing: border-box;
        height: 34px;
        padding: 3px;
        border: 1px solid rgba(255,255,255,.24);
        border-radius: 7px;
        background: #29292d;
      }
      #ndos-style-reset {
        width: 100%;
        height: 32px;
        margin-top: 12px;
        border: 1px solid rgba(255,255,255,.22);
        border-radius: 7px;
        color: rgba(255,255,255,.9);
        background: #29292d;
        cursor: pointer;
      }
      #ndos-style-reset:hover {
        border-color: rgba(255,255,255,.5);
        background: #34343a;
      }
      #ndos-status {
        min-height: 30px;
        margin-top: 12px;
        padding-top: 10px;
        border-top: 1px solid rgba(255,255,255,.12);
        color: rgba(255,255,255,.66);
        font-size: 11px;
        line-height: 1.4;
      }
      #ndos-status[data-kind="ok"] { color: #74d98b; }
      #ndos-status[data-kind="error"] { color: #ff8989; }
      #ndos-shortcuts {
        margin-top: 8px;
        color: rgba(255,255,255,.42);
        font-size: 10px;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureUI() {
    if (!document.documentElement) return;
    installStyles();

    if (!state.overlay) {
      const overlay = document.createElement('div');
      overlay.id = 'ndos-overlay';
      const text = document.createElement('div');
      text.id = 'ndos-overlay-text';
      overlay.appendChild(text);
      state.overlay = overlay;
      state.overlayText = text;
      applyVisualSettings();
    }

    if (!state.controlsRoot && document.body) {
      const root = document.createElement('div');
      root.id = 'ndos-controls-root';

      const button = document.createElement('button');
      button.id = 'ndos-toggle';
      button.type = 'button';
      button.textContent = 'CC²';
      button.title = 'Netflix 雙字幕設定（Option/Alt + S）';
      button.setAttribute('aria-expanded', String(state.settings.panelOpen));

      const panel = document.createElement('section');
      panel.id = 'ndos-panel';
      panel.hidden = !state.settings.panelOpen;
      panel.innerHTML = `
        <h2>Netflix 雙字幕</h2>
        <div class="ndos-inline">
          <label for="ndos-enabled">統一顯示雙字幕</label>
          <input id="ndos-enabled" type="checkbox">
        </div>
        <label for="ndos-primary-track">主字幕軌（上方）</label>
        <select id="ndos-primary-track"></select>
        <label for="ndos-track">第二字幕軌（下方）</label>
        <select id="ndos-track"></select>
        <label for="ndos-sync-mode">時間軸模式</label>
        <select id="ndos-sync-mode">
          <option value="stable">穩定整句（同步開始與結束）</option>
          <option value="original">Netflix 提供的原始時間</option>
        </select>
        <label for="ndos-size">
          字幕大小 <output id="ndos-size-value"></output>
        </label>
        <input id="ndos-size" type="range" min="0.7" max="1.6" step="0.05">
        <label for="ndos-bottom">
          距離底部 <output id="ndos-bottom-value"></output>
        </label>
        <input id="ndos-bottom" type="range" min="2" max="42" step="1">
        <label for="ndos-delay">
          字幕延遲 <output id="ndos-delay-value"></output>
        </label>
        <input id="ndos-delay" type="range" min="-5" max="5" step="0.1">
        <details id="ndos-style">
          <summary>字幕風格</summary>
          <label for="ndos-font-family">字型</label>
          <select id="ndos-font-family">
            <option value="netflix">Netflix／系統黑體</option>
            <option value="system">macOS 系統字型</option>
            <option value="pingfang">蘋方黑體</option>
            <option value="rounded">圓體</option>
            <option value="serif">襯線體</option>
            <option value="mono">等寬字體</option>
          </select>
          <label for="ndos-font-weight">字重</label>
          <select id="ndos-font-weight">
            <option value="400">標準</option>
            <option value="500">中等</option>
            <option value="600">半粗</option>
            <option value="700">粗體</option>
            <option value="800">特粗</option>
          </select>
          <div class="ndos-color-grid">
            <label for="ndos-primary-color">
              主字幕顏色
              <input id="ndos-primary-color" type="color">
            </label>
            <label for="ndos-secondary-color">
              第二字幕顏色
              <input id="ndos-secondary-color" type="color">
            </label>
          </div>
          <label for="ndos-secondary-scale">
            第二字幕比例 <output id="ndos-secondary-scale-value"></output>
          </label>
          <input id="ndos-secondary-scale" type="range" min="0.7" max="1" step="0.01">
          <label for="ndos-background">
            背景深度 <output id="ndos-background-value"></output>
          </label>
          <input id="ndos-background" type="range" min="0" max="0.9" step="0.05">
          <label for="ndos-outline">
            描邊強度 <output id="ndos-outline-value"></output>
          </label>
          <input id="ndos-outline" type="range" min="0" max="3" step="1">
          <label for="ndos-line-height">
            行距 <output id="ndos-line-height-value"></output>
          </label>
          <input id="ndos-line-height" type="range" min="1.1" max="1.6" step="0.05">
          <label for="ndos-caption-gap">
            雙字幕間距 <output id="ndos-caption-gap-value"></output>
          </label>
          <input id="ndos-caption-gap" type="range" min="0" max="0.6" step="0.05">
          <button id="ndos-style-reset" type="button">恢復預設字幕外觀</button>
        </details>
        <div id="ndos-status"></div>
        <div id="ndos-shortcuts">Option/Alt + D：開關字幕　Option/Alt + S：設定</div>
      `;

      root.append(button, panel);
      document.body.appendChild(root);
      state.controlsRoot = root;
      state.toggleButton = button;
      state.panel = panel;
      state.primaryTrackSelect = panel.querySelector('#ndos-primary-track');
      state.trackSelect = panel.querySelector('#ndos-track');
      state.syncModeSelect = panel.querySelector('#ndos-sync-mode');
      state.statusNode = panel.querySelector('#ndos-status');

      bindControls();
      populateTrackSelects();
      updateStatus(state.status, state.statusKind);
      applyVisualSettings();
    }
  }

  function bindControls() {
    const panel = state.panel;
    const settings = state.settings;
    const enabled = panel.querySelector('#ndos-enabled');
    const syncMode = panel.querySelector('#ndos-sync-mode');
    const size = panel.querySelector('#ndos-size');
    const bottom = panel.querySelector('#ndos-bottom');
    const delay = panel.querySelector('#ndos-delay');
    const fontFamily = panel.querySelector('#ndos-font-family');
    const fontWeight = panel.querySelector('#ndos-font-weight');
    const primaryColor = panel.querySelector('#ndos-primary-color');
    const secondaryColor = panel.querySelector('#ndos-secondary-color');
    const secondaryScale = panel.querySelector('#ndos-secondary-scale');
    const background = panel.querySelector('#ndos-background');
    const outline = panel.querySelector('#ndos-outline');
    const lineHeight = panel.querySelector('#ndos-line-height');
    const captionGap = panel.querySelector('#ndos-caption-gap');
    const styleReset = panel.querySelector('#ndos-style-reset');

    enabled.checked = settings.enabled;
    syncMode.value = settings.syncMode;
    size.value = String(settings.fontScale);
    bottom.value = String(settings.bottomPercent);
    delay.value = String(settings.delaySeconds);
    fontFamily.value = settings.fontFamily;
    fontWeight.value = String(settings.fontWeight);
    primaryColor.value = settings.primaryColor;
    secondaryColor.value = settings.secondaryColor;
    secondaryScale.value = String(settings.secondaryScale);
    background.value = String(settings.backgroundOpacity);
    outline.value = String(settings.outlineStrength);
    lineHeight.value = String(settings.lineHeight);
    captionGap.value = String(settings.captionGap);

    state.toggleButton.addEventListener('click', () => {
      saveSettings({ panelOpen: !state.settings.panelOpen });
    });
    enabled.addEventListener('change', () => {
      saveSettings({ enabled: enabled.checked });
      state.cueKey = '';
      if (!enabled.checked) {
        renderDualSubtitles('', '');
        updateLoadStatus();
      } else {
        const primary =
          state.tracks.find((track) => track.id === state.primaryTrackId) ||
          choosePrimaryTrack(state.tracks);
        const secondary =
          state.tracks.find(
            (track) => track.id === state.selectedTrackId && track.id !== primary?.id,
          ) || chooseInitialTrack(state.tracks, primary);
        if (primary) loadTrack(primary, 'primary');
        if (secondary) loadTrack(secondary, 'secondary');
        updateLoadStatus();
      }
    });
    state.primaryTrackSelect.addEventListener('change', () => {
      const track = state.tracks.find(
        (candidate) => candidate.id === state.primaryTrackSelect.value,
      );
      if (!track) return;
      saveSettings({
        enabled: true,
        preferredPrimaryLanguage: track.language,
        preferredPrimaryTrackType: track.trackType,
        preferredPrimaryForced: track.forced,
      });
      enabled.checked = true;
      loadTrack(track, 'primary');
      if (track.id === state.selectedTrackId) {
        const secondary = chooseInitialTrack(state.tracks, track);
        if (secondary) {
          saveSettings({
            preferredLanguage: secondary.language,
            preferredTrackType: secondary.trackType,
            preferredForced: secondary.forced,
          });
          loadTrack(secondary, 'secondary');
        }
      }
    });
    state.trackSelect.addEventListener('change', () => {
      const track = state.tracks.find((candidate) => candidate.id === state.trackSelect.value);
      if (!track) {
        saveSettings({
          enabled: false,
          preferredLanguage: '',
          preferredTrackType: '',
          preferredForced: false,
        });
        enabled.checked = false;
        loadTrack(null, 'secondary');
        return;
      }
      if (track.id === state.primaryTrackId) {
        const primary = state.tracks.find(
          (candidate) =>
            candidate.id !== track.id &&
            baseLanguage(candidate.language) !== baseLanguage(track.language) &&
            !candidate.forced,
        );
        if (primary) {
          saveSettings({
            preferredPrimaryLanguage: primary.language,
            preferredPrimaryTrackType: primary.trackType,
            preferredPrimaryForced: primary.forced,
          });
          loadTrack(primary, 'primary');
        }
      }
      saveSettings({
        enabled: true,
        preferredLanguage: track.language,
        preferredTrackType: track.trackType,
        preferredForced: track.forced,
      });
      enabled.checked = true;
      loadTrack(track, 'secondary');
    });
    syncMode.addEventListener('change', () => {
      saveSettings({ syncMode: syncMode.value });
      state.cueKey = '';
      rebuildStableBlocks();
      updateLoadStatus();
    });
    size.addEventListener('input', () => {
      saveSettings({ fontScale: Number(size.value) });
    });
    bottom.addEventListener('input', () => {
      saveSettings({ bottomPercent: Number(bottom.value) });
    });
    delay.addEventListener('input', () => {
      saveSettings({ delaySeconds: Number(delay.value) });
      state.cueKey = '';
    });
    fontFamily.addEventListener('change', () => {
      saveSettings({ fontFamily: fontFamily.value });
    });
    fontWeight.addEventListener('change', () => {
      saveSettings({ fontWeight: Number(fontWeight.value) });
    });
    primaryColor.addEventListener('input', () => {
      saveSettings({ primaryColor: primaryColor.value });
    });
    secondaryColor.addEventListener('input', () => {
      saveSettings({ secondaryColor: secondaryColor.value });
    });
    secondaryScale.addEventListener('input', () => {
      saveSettings({ secondaryScale: Number(secondaryScale.value) });
    });
    background.addEventListener('input', () => {
      saveSettings({ backgroundOpacity: Number(background.value) });
    });
    outline.addEventListener('input', () => {
      saveSettings({ outlineStrength: Number(outline.value) });
    });
    lineHeight.addEventListener('input', () => {
      saveSettings({ lineHeight: Number(lineHeight.value) });
    });
    captionGap.addEventListener('input', () => {
      saveSettings({ captionGap: Number(captionGap.value) });
    });
    styleReset.addEventListener('click', () => {
      saveSettings(VISUAL_DEFAULTS);
    });
  }

  function appendTrackOptions(select, allowOff) {
    select.textContent = '';

    if (allowOff) {
      const off = document.createElement('option');
      off.value = '';
      off.textContent = '關閉雙字幕（恢復 Netflix 字幕）';
      select.appendChild(off);
    }

    for (const track of state.tracks) {
      const option = document.createElement('option');
      option.value = track.id;
      option.textContent =
        displayTrackLabel(track) +
        (normalizeLanguage(track.language) === normalizeLanguage(state.activePrimaryLanguage)
          ? ' — 目前主字幕'
          : '');
      select.appendChild(option);
    }
  }

  function populateTrackSelects() {
    if (!state.primaryTrackSelect || !state.trackSelect) return;
    appendTrackOptions(state.primaryTrackSelect, false);
    appendTrackOptions(state.trackSelect, true);
    syncTrackSelects();
  }

  function syncTrackSelects() {
    if (state.primaryTrackSelect) {
      const primaryExists = state.tracks.some(
        (track) => track.id === state.primaryTrackId,
      );
      state.primaryTrackSelect.value = primaryExists ? state.primaryTrackId : '';
    }
    if (state.trackSelect) {
      const secondaryExists = state.tracks.some(
        (track) => track.id === state.selectedTrackId,
      );
      state.trackSelect.value = secondaryExists ? state.selectedTrackId : '';
    }
  }

  function updateStatus(message, kind = '') {
    state.status = message;
    state.statusKind = kind;
    if (state.statusNode) {
      state.statusNode.textContent = message;
      state.statusNode.dataset.kind = kind;
    }
  }

  function setControlsVisible(visible) {
    if (state.controlsRoot) {
      state.controlsRoot.style.display = visible ? '' : 'none';
    }
  }

  function applyTakeoverState() {
    const ready = takeoverReady();
    document.documentElement?.classList.toggle('ndos-takeover-active', ready);
    if (state.overlay) {
      state.overlay.style.display = ready ? '' : 'none';
    }
    if (!ready && state.overlayText?.childNodes.length) {
      renderDualSubtitles('', '');
      state.cueKey = '';
    }
  }

  function applyVisualSettings() {
    const settings = state.settings;
    if (state.overlay) {
      state.overlay.style.setProperty('--ndos-bottom', `${settings.bottomPercent}%`);
      state.overlay.style.setProperty('--ndos-scale', String(settings.fontScale));
      state.overlay.style.setProperty('--ndos-color', settings.primaryColor);
      state.overlay.style.setProperty(
        '--ndos-secondary-color',
        settings.secondaryColor,
      );
      state.overlay.style.setProperty(
        '--ndos-bg',
        `rgba(0, 0, 0, ${settings.backgroundOpacity})`,
      );
      state.overlay.style.setProperty(
        '--ndos-font-family',
        FONT_FAMILIES[settings.fontFamily],
      );
      state.overlay.style.setProperty('--ndos-weight', String(settings.fontWeight));
      state.overlay.style.setProperty(
        '--ndos-secondary-scale',
        String(settings.secondaryScale),
      );
      state.overlay.style.setProperty(
        '--ndos-line-height',
        String(settings.lineHeight),
      );
      state.overlay.style.setProperty(
        '--ndos-caption-gap',
        `${settings.captionGap}em`,
      );
      state.overlay.style.setProperty(
        '--ndos-shadow',
        subtitleShadow(settings.outlineStrength),
      );
    }
    if (state.panel) {
      state.panel.hidden = !settings.panelOpen;
      state.toggleButton.setAttribute('aria-expanded', String(settings.panelOpen));
      state.panel.querySelector('#ndos-enabled').checked = settings.enabled;
      state.panel.querySelector('#ndos-sync-mode').value = settings.syncMode;
      state.panel.querySelector('#ndos-size').value = String(settings.fontScale);
      state.panel.querySelector('#ndos-size-value').textContent =
        `${Math.round(settings.fontScale * 100)}%`;
      state.panel.querySelector('#ndos-bottom').value = String(settings.bottomPercent);
      state.panel.querySelector('#ndos-bottom-value').textContent =
        `${settings.bottomPercent}%`;
      state.panel.querySelector('#ndos-delay').value = String(settings.delaySeconds);
      const delay = Number(settings.delaySeconds);
      state.panel.querySelector('#ndos-delay-value').textContent =
        `${delay > 0 ? '+' : ''}${delay.toFixed(1)} 秒`;
      state.panel.querySelector('#ndos-font-family').value = settings.fontFamily;
      state.panel.querySelector('#ndos-font-weight').value =
        String(settings.fontWeight);
      state.panel.querySelector('#ndos-primary-color').value =
        settings.primaryColor;
      state.panel.querySelector('#ndos-secondary-color').value =
        settings.secondaryColor;
      state.panel.querySelector('#ndos-secondary-scale').value =
        String(settings.secondaryScale);
      state.panel.querySelector('#ndos-secondary-scale-value').textContent =
        `${Math.round(settings.secondaryScale * 100)}%`;
      state.panel.querySelector('#ndos-background').value =
        String(settings.backgroundOpacity);
      state.panel.querySelector('#ndos-background-value').textContent =
        `${Math.round(settings.backgroundOpacity * 100)}%`;
      state.panel.querySelector('#ndos-outline').value =
        String(settings.outlineStrength);
      state.panel.querySelector('#ndos-outline-value').textContent =
        ['無', '淡', '標準', '強'][settings.outlineStrength];
      state.panel.querySelector('#ndos-line-height').value =
        String(settings.lineHeight);
      state.panel.querySelector('#ndos-line-height-value').textContent =
        settings.lineHeight.toFixed(2);
      state.panel.querySelector('#ndos-caption-gap').value =
        String(settings.captionGap);
      state.panel.querySelector('#ndos-caption-gap-value').textContent =
        `${settings.captionGap.toFixed(2)} em`;
    }
    applyTakeoverState();
  }

  function ensureOverlayAttached(video) {
    if (!state.overlay) ensureUI();
    if (!state.overlay) return;
    const host =
      video.closest('.watch-video') ||
      video.closest('[data-uia="video-canvas"]') ||
      video.parentElement;
    if (!host) return;
    if (state.overlay.parentElement !== host) {
      if (PAGE.getComputedStyle(host).position === 'static') {
        host.style.position = 'relative';
      }
      host.appendChild(state.overlay);
      state.overlayHost = host;
    }
  }

  function renderDualSubtitles(primaryText, secondaryText) {
    if (!state.overlayText) return;
    if (!primaryText && !secondaryText) {
      state.overlayText.replaceChildren();
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const [role, text] of [
      ['primary', primaryText],
      ['secondary', secondaryText],
    ]) {
      const caption = document.createElement('div');
      caption.className =
        `ndos-caption ndos-${role}${text ? '' : ' ndos-placeholder'}`;
      caption.setAttribute('aria-label', role === 'primary' ? '主字幕' : '第二字幕');
      for (const line of String(text || '\u00a0').split('\n')) {
        const lineNode = document.createElement('div');
        lineNode.className = 'ndos-line';
        lineNode.textContent = line;
        caption.appendChild(lineNode);
      }
      fragment.appendChild(caption);
    }
    state.overlayText.replaceChildren(fragment);
  }

  function activeCueText(cues, time) {
    if (!cues.length) return '';

    let low = 0;
    let high = cues.length - 1;
    let lastStarted = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (cues[middle].start <= time) {
        lastStarted = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (lastStarted < 0) return '';

    const active = [];
    for (let index = lastStarted; index >= 0 && index >= lastStarted - 30; index -= 1) {
      const cue = cues[index];
      if (cue.end + 0.08 >= time && cue.start - 0.02 <= time) {
        active.unshift(cue.text);
      }
    }
    return [...new Set(active)].join('\n');
  }

  function tick(timestamp) {
    PAGE.requestAnimationFrame(tick);
    if (timestamp - state.lastTickAt < 50) return;
    state.lastTickAt = timestamp;

    const video = document.querySelector('#appMountPoint video, video');
    if (!video) {
      if (state.cueKey) {
        state.cueKey = '';
        renderDualSubtitles('', '');
      }
      return;
    }
    state.video = video;
    ensureOverlayAttached(video);
    if (!takeoverReady()) {
      if (state.cueKey) {
        state.cueKey = '';
        renderDualSubtitles('', '');
      }
      return;
    }

    // A positive delay means "show the subtitle later".
    const subtitleTime = video.currentTime - Number(state.settings.delaySeconds || 0);
    let primaryText = '';
    let secondaryText = '';
    if (state.settings.syncMode === 'stable') {
      rebuildStableBlocks();
      const block = activeStableBlock(state.alignedBlocks, subtitleTime);
      primaryText = block?.primaryText || '';
      secondaryText = block?.secondaryText || '';
    } else {
      primaryText = activeCueText(state.primaryCues, subtitleTime);
      secondaryText = activeCueText(state.cues, subtitleTime);
    }
    const cueKey =
      `${state.settings.syncMode}\u0000${primaryText}\u0000${secondaryText}`;
    if (cueKey !== state.cueKey) {
      state.cueKey = cueKey;
      renderDualSubtitles(primaryText, secondaryText);
    }
  }

  // ---------------------------------------------------------------------------
  // SPA/fullscreen lifecycle and public diagnostics
  // ---------------------------------------------------------------------------

  function moveControlsIntoFullscreen() {
    if (!state.controlsRoot) return;
    const target =
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.body;
    if (target && state.controlsRoot.parentElement !== target) {
      target.appendChild(state.controlsRoot);
    }
  }

  function handleShortcut(event) {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key.toLowerCase() === 'd') {
      event.preventDefault();
      const willEnable = !state.settings.enabled;
      saveSettings({ enabled: willEnable });
      state.cueKey = '';
      if (!willEnable) {
        renderDualSubtitles('', '');
        updateLoadStatus();
      } else {
        refreshPlaybackContext();
      }
    } else if (event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveSettings({ panelOpen: !state.settings.panelOpen });
    }
  }

  function startLifecycle() {
    const start = () => {
      ensureUI();
      refreshPlaybackContext();
      PAGE.requestAnimationFrame(tick);
      PAGE.setInterval(refreshPlaybackContext, 1000);
    };

    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });

    document.addEventListener('fullscreenchange', moveControlsIntoFullscreen);
    document.addEventListener('webkitfullscreenchange', moveControlsIntoFullscreen);
    PAGE.addEventListener('popstate', refreshPlaybackContext);
    PAGE.addEventListener('keydown', handleShortcut, true);

    for (const method of ['pushState', 'replaceState']) {
      const nativeMethod = PAGE.history[method];
      PAGE.history[method] = function netflixDualSubsHistory() {
        const result = Reflect.apply(nativeMethod, this, arguments);
        PAGE.setTimeout(refreshPlaybackContext, 0);
        return result;
      };
    }
  }

  const diagnostics = Object.freeze({
    version: VERSION,
    openSettings() {
      ensureUI();
      saveSettings({ panelOpen: true });
    },
    reload() {
      state.currentMovieId = '';
      refreshPlaybackContext();
    },
    status() {
      return {
        version: VERSION,
        movieId: state.currentMovieId,
        netflixPrimaryLanguage: state.activePrimaryLanguage,
        primaryTrackId: state.primaryTrackId,
        secondaryTrackId: state.selectedTrackId,
        trackCount: state.tracks.length,
        primaryCueCount: state.primaryCues.length,
        secondaryCueCount: state.cues.length,
        syncMode: state.settings.syncMode,
        alignedBlockCount: state.alignedBlocks.length,
        takeoverActive: takeoverReady(),
        status: state.status,
      };
    },
    // Parser hooks are exposed only to make offline regression testing easy.
    test: Object.freeze({
      parseWebVTT,
      parseTTML,
      clockTime,
      activeCueText,
      groupSentenceCues,
      buildStableBlocks,
      activeStableBlock,
      normalizeSettings,
      subtitleShadow,
    }),
  });
  PAGE.NetflixDualSubs = diagnostics;
  // Preserve the previous diagnostics name for existing bookmarks and consoles.
  PAGE.NetflixOfficialDualSubs = diagnostics;

  installManifestHooks();
  startLifecycle();
})();
