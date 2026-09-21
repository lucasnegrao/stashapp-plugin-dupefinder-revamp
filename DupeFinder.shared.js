(function () {
  "use strict";
  const root = window.DupeFinder = window.DupeFinder || {};

  root.constants = {
    MODAL_ID: "df-modal",
    PLUGIN_ID: "DupeFinder",
    SHOW_HEADER_BUTTON_SETTING: "showHeaderButton",
    SETTINGS_KEY: "df-settings-v2",
    CODEC_RANK: ["av1", "hevc", "h265", "vp9", "h264", "avc", "mpeg4", "mpeg2"],
    PHASH_DISTANCE_PRESETS: [
      { value: "exact", label: "Exact", distance: 0, meaning: "All pHash bits must match" },
      { value: "high", label: "High", distance: 4, meaning: "Up to 4 differing bits" },
      { value: "medium", label: "Medium", distance: 8, meaning: "Up to 8 differing bits" },
      { value: "low", label: "Low", distance: 10, meaning: "Up to 10 differing bits" },
    ],
    BATCH_DURATION_DIFF_OPTIONS: [
      { value: -1, label: "Any" },
      { value: 0, label: "Equal" },
      { value: 1, label: "1 s" },
      { value: 5, label: "5 s" },
      { value: 10, label: "10 s" },
    ],
  };

  root.defaults = {
    settings: {
      duplicateFinderMode: "phash",
      useLegacyWhenNoPhash: false,
      phashDistanceMode: "exact",
      phashDistance: 0,
      legacyDistance: 0,
      bestAlgorithm: "balanced",
      batchDurationDiffSeconds: 10,
      autoExcludeDuplicateUnsafe: true,
      preferOrganizedInBest: false,
    },
    style: {
      overlay: "position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9998;display:flex;align-items:center;justify-content:center;",
      modal: "position:relative;background:#21252b;border:1px solid #3e4451;border-radius:8px;width:92vw;max-width:1300px;height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.6);z-index:9999;",
      header: "display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #3e4451;flex-shrink:0;gap:12px;",
      tabs: "display:flex;gap:4px;padding:10px 18px 0;border-bottom:1px solid #3e4451;flex-shrink:0;",
      body: "flex:1;overflow-y:auto;padding:14px 18px;",
      table: "width:100%;border-collapse:collapse;font-size:0.83em;color:#abb2bf;table-layout:fixed;",
      th: "text-align:left;padding:7px 10px;border-bottom:1px solid #3e4451;color:#61afef;font-weight:600;white-space:nowrap;",
      td: "padding:6px 10px;border-bottom:1px solid #2c313a;vertical-align:middle;overflow:hidden;text-overflow:ellipsis;",
      groupHdr: "background:#2c313a;padding:8px 10px;border-radius:4px;margin:10px 0 4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;",
      badge: "display:inline-block;padding:2px 7px;border-radius:10px;font-size:0.78em;font-weight:600;flex-shrink:0;",
      link: "color:#61afef;text-decoration:none;cursor:pointer;",
      keepBadge: "display:inline-block;padding:1px 6px;border-radius:3px;font-size:0.75em;background:#98c379;color:#21252b;font-weight:700;margin-left:4px;vertical-align:middle;",
      batchBar: "display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#2c313a;border:1px solid #3e4451;border-radius:6px;padding:10px 12px;margin-bottom:12px;",
      rowHint: "color:#5c6370;font-size:0.8em;margin-bottom:10px;",
    },
    columns: {
      multi: [
        { key: "actions", label: "", width: "62px" },
        { key: "path", label: "Path", width: "38%" },
        { key: "res", label: "Res", width: "75px" },
        { key: "codec", label: "Codec", width: "100px" },
        { key: "phash", label: "pHash", width: "170px" },
        { key: "duration", label: "Duration", width: "90px" },
        { key: "size", label: "Size", width: "95px" },
      ],
      dupes: [
        { key: "actions", label: "", width: "62px" },
        { key: "scene", label: "Scene", width: "130px" },
        { key: "files", label: "Files", width: "22%" },
        { key: "res", label: "Res", width: "70px" },
        { key: "codec", label: "Codec", width: "95px" },
        { key: "phash", label: "pHash", width: "170px" },
        { key: "duration", label: "Duration", width: "90px" },
        { key: "size", label: "Size", width: "95px" },
        { key: "organized", label: "Organized", width: "90px" },
        { key: "performers", label: "Performers", width: "20%" },
      ],
    },
  };

  root.ui = {
    el(tag, css, text) {
      const e = document.createElement(tag);
      if (css) e.style.cssText = css;
      if (text !== undefined) e.textContent = text;
      return e;
    },
    mkBtn(label, bg, onClick) {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = `background:${bg};border:none;border-radius:4px;color:#fff;padding:4px 11px;font-size:0.8em;cursor:pointer;white-space:nowrap;flex-shrink:0;`;
      b.addEventListener("click", e => {
        e.stopPropagation();
        onClick(e);
      });
      return b;
    },
    tabBtn(label, active, onClick) {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = `background:${active ? "#61afef" : "transparent"};color:${active ? "#21252b" : "#abb2bf"};border:none;border-radius:4px 4px 0 0;padding:7px 16px;font-size:0.85em;cursor:pointer;font-weight:${active ? 700 : 400};`;
      b.addEventListener("click", onClick);
      return b;
    },
    toast(msg, color) {
      const t = this.el("div",
        `position:fixed;bottom:130px;left:24px;z-index:99999;background:${color || "#3e4451"};` +
        `color:#fff;padding:9px 16px;border-radius:6px;font-size:0.85em;box-shadow:0 2px 8px rgba(0,0,0,0.4);`,
        msg);
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 3000);
    },
    previewAction(title, lines) {
      alert(`DRY RUN / PREVIEW — ${title}\n\n${lines.join("\n")}`);
    },
    stopRowSelection(e) {
      e.stopPropagation();
    },
    renderColgroup(columns) {
      const colgroup = document.createElement("colgroup");
      columns.forEach(col => {
        const c = document.createElement("col");
        if (col.width) c.style.width = col.width;
        colgroup.appendChild(c);
      });
      return colgroup;
    },
  };

  root.helpers = {
    formatBytes(bytes) {
      if (!bytes) return "—";
      const gb = bytes / 1073741824;
      if (gb >= 1) return `${gb.toFixed(2)} GB`;
      return `${(bytes / 1048576).toFixed(1)} MB`;
    },
    formatDuration(seconds) {
      const n = Number(seconds);
      if (!Number.isFinite(n) || n <= 0) return "—";
      if (n < 60) return `${Math.round(n)}s`;
      if (n < 3600) return `${(n / 60).toFixed(1)}m`;
      return `${(n / 3600).toFixed(2)}h`;
    },
    sceneUrl(id) { return `/scenes/${id}`; },
    fileName(file) { return (file && (file.basename || (file.path || "").split(/[/\\]/).pop())) || "(unknown)"; },
    filePathLabel(file) { return (file && file.path) || this.fileName(file); },
    sceneName(scene) { return (scene && scene.title) || `#${scene && scene.id}`; },
    idKey(id) { return String(id); },
    norm(str) { return (str || "").trim().toLowerCase(); },
    normDate(str) { return (str || "").trim(); },
    toFiniteNumber(value) {
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    },
    rawPhash(file) {
      const fps = (file && file.fingerprints) || [];
      const found = fps.find(fp => /phash/i.test((fp && fp.type) || ""));
      const value = found && found.value;
      return value ? String(value).trim() : null;
    },
    readPhash(file) {
      return this.rawPhash(file) || "—";
    },
    placeholder(value) {
      return value === undefined || value === null || value === "" ? "—" : String(value);
    },
    durationDiffLimitLabel(value) {
      const option = root.constants.BATCH_DURATION_DIFF_OPTIONS.find(item => item.value === Number(value));
      return option ? option.label : `${value} s`;
    },
  };

  root.settings = {
    phashPresetForDistance(distance) {
      const presets = root.constants.PHASH_DISTANCE_PRESETS;
      const numeric = Number(distance);
      const exact = presets.find(preset => preset.distance === numeric);
      return (exact || presets[0]).value;
    },
    phashDistanceForPreset(presetValue) {
      const preset = root.constants.PHASH_DISTANCE_PRESETS.find(item => item.value === presetValue);
      return preset ? preset.distance : root.constants.PHASH_DISTANCE_PRESETS[0].distance;
    },
    normalize(raw) {
      const defaults = root.defaults.settings;
      const candidate = raw || {};
      const duplicateFinderMode = ["phash", "legacy"].includes(candidate.duplicateFinderMode)
        ? candidate.duplicateFinderMode
        : defaults.duplicateFinderMode;
      const useLegacyWhenNoPhash = candidate.useLegacyWhenNoPhash !== undefined
        ? !!candidate.useLegacyWhenNoPhash
        : defaults.useLegacyWhenNoPhash;
      const phashDistanceMode = root.constants.PHASH_DISTANCE_PRESETS.some(preset => preset.value === candidate.phashDistanceMode)
        ? candidate.phashDistanceMode
        : this.phashPresetForDistance(candidate.phashDistance);
      const phashDistance = this.phashDistanceForPreset(phashDistanceMode);
      const legacyDistance = Number(candidate.legacyDistance !== undefined ? candidate.legacyDistance : candidate.defaultDistance);
      const threshold = Number(candidate.batchDurationDiffSeconds);
      const validThreshold = root.constants.BATCH_DURATION_DIFF_OPTIONS.some(option => option.value === threshold);
      const algo = String(candidate.bestAlgorithm || defaults.bestAlgorithm);
      const bestAlgorithm = ["balanced", "quality", "size"].includes(algo) ? algo : defaults.bestAlgorithm;
      return {
        duplicateFinderMode,
        useLegacyWhenNoPhash,
        phashDistanceMode,
        phashDistance: Number.isFinite(phashDistance) ? Math.max(0, Math.min(64, Math.round(phashDistance))) : defaults.phashDistance,
        legacyDistance: Number.isFinite(legacyDistance) ? Math.max(0, Math.min(10, Math.round(legacyDistance))) : defaults.legacyDistance,
        bestAlgorithm,
        batchDurationDiffSeconds: validThreshold ? threshold : defaults.batchDurationDiffSeconds,
        autoExcludeDuplicateUnsafe: candidate.autoExcludeDuplicateUnsafe !== undefined ? !!candidate.autoExcludeDuplicateUnsafe : defaults.autoExcludeDuplicateUnsafe,
        preferOrganizedInBest: candidate.preferOrganizedInBest !== undefined ? !!candidate.preferOrganizedInBest : defaults.preferOrganizedInBest,
      };
    },
    load() {
      try {
        const text = localStorage.getItem(root.constants.SETTINGS_KEY);
        if (!text) return this.normalize(root.defaults.settings);
        return this.normalize(JSON.parse(text));
      } catch (_) {
        return this.normalize(root.defaults.settings);
      }
    },
    save(settings) {
      const normalized = this.normalize(settings);
      localStorage.setItem(root.constants.SETTINGS_KEY, JSON.stringify(normalized));
      return normalized;
    },
    reset() {
      localStorage.removeItem(root.constants.SETTINGS_KEY);
      return this.normalize(root.defaults.settings);
    },
  };
})();
