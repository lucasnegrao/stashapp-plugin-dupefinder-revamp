// v1.2 - DupeFinder - manual keep selection + batch mode
(function () {
  "use strict";
  console.log("[DupeFinder] Script loaded v1.2");

  const MODAL_ID = "df-modal";
  const BTN_ID   = "df-button";

  // ── GraphQL ────────────────────────────────────────────────────────────────

  async function gql(query, variables = {}) {
    const res = await fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.errors) throw new Error(data.errors.map(e => e.message).join(", "));
    return data.data;
  }

  async function destroyScene(id, deleteFile) {
    return gql(`
      mutation SceneDestroy($input: SceneDestroyInput!) {
        sceneDestroy(input: $input)
      }
    `, { input: { id: String(id), delete_file: deleteFile } });
  }

  async function mergeScenes(sourceIds, destinationId) {
    return gql(`
      mutation MergeScenes($source: [ID!]!, $destination: ID!) {
        sceneMerge(input: { source: $source, destination: $destination }) { id }
      }
    `, { source: sourceIds.map(String), destination: String(destinationId) });
  }

  async function deleteFiles(fileIds) {
    return gql(`
      mutation DeleteFiles($ids: [ID!]!) {
        deleteFiles(ids: $ids)
      }
    `, { ids: fileIds.map(String) });
  }

  async function setScenePrimaryFile(sceneId, fileId) {
    return gql(`
      mutation SceneSetPrimaryFile($input: SceneUpdateInput!) {
        sceneUpdate(input: $input) { id }
      }
    `, { input: { id: String(sceneId), primary_file_id: String(fileId) } });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function mkBtn(label, bg, onClick) {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = `background:${bg};border:none;border-radius:4px;color:#fff;padding:4px 11px;font-size:0.8em;cursor:pointer;white-space:nowrap;flex-shrink:0;`;
    b.addEventListener("click", e => {
      e.stopPropagation();
      onClick(e);
    });
    return b;
  }

  function formatBytes(bytes) {
    if (!bytes) return "";
    const gb = bytes / 1073741824;
    if (gb >= 1) return gb.toFixed(2) + " GB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  function sceneUrl(id) { return `/scenes/${id}`; }
  function fileName(file) { return file.basename || file.path.split(/[/\\]/).pop(); }
  function filePathLabel(file) { return file.path || fileName(file); }
  function sceneName(scene) { return scene.title || `#${scene.id}`; }
  function idKey(id) { return String(id); }
  function norm(str) { return (str || "").trim().toLowerCase(); }
  function normDate(str) { return (str || "").trim(); }

  function previewAction(title, lines) {
    alert(`DRY RUN / PREVIEW — ${title}\n\n${lines.join("\n")}`);
  }

  function toast(msg, color) {
    const t = el("div",
      `position:fixed;bottom:130px;left:24px;z-index:99999;background:${color || "#3e4451"};` +
      `color:#fff;padding:9px 16px;border-radius:6px;font-size:0.85em;box-shadow:0 2px 8px rgba(0,0,0,0.4);`,
      msg);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  function stopRowSelection(e) {
    e.stopPropagation();
  }

  function duplicateGroupKey(scene) {
    return JSON.stringify([
      norm(scene.title),
      normDate(scene.date),
      norm(scene.studio ? scene.studio.name : ""),
    ]);
  }

  // ── Data fetching ──────────────────────────────────────────────────────────

  const SCENE_FRAGMENT = `
    id title date organized
    studio { name }
    performers { name }
    files { id path basename size video_codec height duration }
  `;

  async function fetchAllScenes(onProgress) {
    const PER_PAGE = 500;
    let page = 1, all = [], total = null;
    while (true) {
      const d = await gql(`
        query($filter: FindFilterType!) {
          findScenes(filter: $filter) {
            count
            scenes { ${SCENE_FRAGMENT} }
          }
        }
      `, { filter: { per_page: PER_PAGE, page, sort: "title" } });
      const { count, scenes } = d.findScenes;
      if (total === null) total = count;
      all = all.concat(scenes);
      if (onProgress) onProgress(all.length, total);
      if (all.length >= total) break;
      page++;
    }
    return all;
  }

  async function fetchScene(id) {
    const d = await gql(`
      query FindScene($id: ID!) {
        findScene(id: $id) { ${SCENE_FRAGMENT} }
      }
    `, { id: String(id) });
    return d.findScene;
  }

  // ── Analysis ───────────────────────────────────────────────────────────────

  function findMultiFileScenes(scenes) {
    return scenes
      .filter(s => s.files && s.files.length > 1)
      .sort((a, b) => b.files.length - a.files.length);
  }

  function findDuplicateScenes(scenes) {
    const groups = {};
    for (const scene of scenes) {
      const title = norm(scene.title);
      const date = normDate(scene.date);
      const studio = norm(scene.studio ? scene.studio.name : "");
      if (!title && !(date && studio)) continue;
      const key = duplicateGroupKey(scene);
      if (!groups[key]) groups[key] = [];
      groups[key].push(scene);
    }
    return Object.entries(groups)
      .filter(([, groupScenes]) => groupScenes.length > 1)
      .map(([key, groupScenes]) => ({ key, scenes: groupScenes }))
      .sort((a, b) => {
        const sizeDiff = b.scenes.length - a.scenes.length;
        if (sizeDiff) return sizeDiff;
        return a.key.localeCompare(b.key);
      });
  }

  const CODEC_RANK = ["av1", "hevc", "h265", "vp9", "h264", "avc", "mpeg4", "mpeg2"];
  function codecScore(sceneOrFile) {
    const file = sceneOrFile && sceneOrFile.video_codec !== undefined
      ? sceneOrFile
      : ((((sceneOrFile || {}).files) || [])[0] || {});
    const codec = file.video_codec || "";
    const idx = CODEC_RANK.indexOf(codec.toLowerCase());
    return idx === -1 ? CODEC_RANK.length : idx;
  }

  function compareFiles(a, b) {
    const resDiff = (b.height || 0) - (a.height || 0);
    if (resDiff) return resDiff;
    const sizeDiff = (a.size || 0) - (b.size || 0);
    if (sizeDiff) return sizeDiff;
    return codecScore(a) - codecScore(b);
  }

  function pickBestFile(files) {
    return [...(files || [])].sort(compareFiles)[0];
  }

  function bestScene(groupScenes) {
    return [...groupScenes].sort((a, b) => {
      const aRes = Math.max(...(a.files || []).map(f => f.height || 0));
      const bRes = Math.max(...(b.files || []).map(f => f.height || 0));
      if (bRes !== aRes) return bRes - aRes;
      const aSize = (a.files || []).reduce((n, f) => n + (f.size || 0), 0);
      const bSize = (b.files || []).reduce((n, f) => n + (f.size || 0), 0);
      if (aSize !== bSize) return aSize - bSize;
      return codecScore(a) - codecScore(b);
    })[0];
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  const STYLE = {
    overlay:   "position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9998;display:flex;align-items:center;justify-content:center;",
    modal:     "background:#21252b;border:1px solid #3e4451;border-radius:8px;width:92vw;max-width:1100px;height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.6);z-index:9999;",
    header:    "display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #3e4451;flex-shrink:0;gap:12px;",
    tabs:      "display:flex;gap:4px;padding:10px 18px 0;border-bottom:1px solid #3e4451;flex-shrink:0;",
    body:      "flex:1;overflow-y:auto;padding:14px 18px;",
    table:     "width:100%;border-collapse:collapse;font-size:0.83em;color:#abb2bf;",
    th:        "text-align:left;padding:7px 10px;border-bottom:1px solid #3e4451;color:#61afef;font-weight:600;white-space:nowrap;",
    td:        "padding:6px 10px;border-bottom:1px solid #2c313a;vertical-align:middle;",
    groupHdr:  "background:#2c313a;padding:8px 10px;border-radius:4px;margin:10px 0 4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;",
    badge:     "display:inline-block;padding:2px 7px;border-radius:10px;font-size:0.78em;font-weight:600;flex-shrink:0;",
    link:      "color:#61afef;text-decoration:none;cursor:pointer;",
    keepBadge: "display:inline-block;padding:1px 6px;border-radius:3px;font-size:0.75em;background:#98c379;color:#21252b;font-weight:700;margin-left:4px;vertical-align:middle;",
    batchBar:  "display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#2c313a;border:1px solid #3e4451;border-radius:6px;padding:10px 12px;margin-bottom:12px;",
    rowHint:   "color:#5c6370;font-size:0.8em;margin-bottom:10px;",
  };

  function tabBtn(label, active, onClick) {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = `background:${active ? "#61afef" : "transparent"};color:${active ? "#21252b" : "#abb2bf"};border:none;border-radius:4px 4px 0 0;padding:7px 16px;font-size:0.85em;cursor:pointer;font-weight:${active ? 700 : 400};`;
    b.addEventListener("click", onClick);
    return b;
  }

  function renderMultiFileTable(scenes, opts = {}) {
    const {
      dryRun = false,
      batchMode = false,
      isSceneIncluded = () => true,
      getSelectedFile = scene => pickBestFile(scene.files),
      onSelectFile = () => {},
      onToggleSceneBatch = () => {},
      onKeepScene = () => {},
      onSceneDeleted = () => {},
    } = opts;

    if (!scenes.length) {
      return el("div", "color:#5c6370;padding:20px 0;text-align:center;", "No multi-file scenes found ✓");
    }

    const wrap = document.createElement("div");
    wrap.appendChild(el("div", "color:#5c6370;font-size:0.83em;margin-bottom:6px;",
      `${scenes.length} scene${scenes.length !== 1 ? "s" : ""} with multiple files`));
    wrap.appendChild(el("div", STYLE.rowHint, "Click a file row to choose which file to keep."));

    for (const scene of scenes) {
      const sceneWrap = document.createElement("div");
      const selectedFile = getSelectedFile(scene);
      const sorted = [...scene.files].sort((a, b) => {
        if (selectedFile && idKey(a.id) === idKey(selectedFile.id)) return -1;
        if (selectedFile && idKey(b.id) === idKey(selectedFile.id)) return 1;
        return compareFiles(a, b);
      });
      const keeper = selectedFile || sorted[0];
      const extraFiles = sorted.filter(f => idKey(f.id) !== idKey(keeper.id));
      const included = isSceneIncluded(scene);

      const hdr = el("div", STYLE.groupHdr);
      const link = document.createElement("a");
      link.href = sceneUrl(scene.id);
      link.target = "_blank";
      link.style.cssText = STYLE.link + "font-size:1em;font-weight:600;color:#e5c07b;";
      link.textContent = scene.title || "(untitled)";
      link.addEventListener("click", stopRowSelection);
      hdr.appendChild(link);
      hdr.appendChild(el("span", STYLE.badge + "background:#e06c75;color:#fff;", `${scene.files.length} files`));
      if (batchMode) {
        hdr.appendChild(el("span", STYLE.badge + `${included ? "background:#98c379;color:#21252b;" : "background:#5c6370;color:#fff;"}`,
          included ? "In batch" : "Excluded"));
      }
      if (scene.date) hdr.appendChild(el("span", "color:#5c6370;font-size:0.85em;", scene.date));
      if (scene.studio) hdr.appendChild(el("span", "color:#5c6370;font-size:0.85em;", scene.studio.name));
      hdr.appendChild(el("span", "flex:1;"));

      if (batchMode) {
        hdr.appendChild(mkBtn(included ? "➖ Exclude from batch" : "➕ Include in batch", included ? "#5c6370" : "#56b6c2", () => {
          onToggleSceneBatch(scene.id);
        }));
      }

      if (keeper && extraFiles.length) {
        hdr.appendChild(mkBtn(dryRun ? "👁 Preview keep" : "🧹 Keep", "#98c379", async () => {
          await onKeepScene(scene);
        }));
      }

      const delBtn = mkBtn(dryRun ? "👁 Preview delete scene" : "🗑 Delete scene", "#e06c75", async () => {
        if (dryRun) {
          previewAction(`Delete scene ${sceneName(scene)}`, [
            `Would delete scene #${scene.id} and ${scene.files.length} file(s) from disk:`,
            ...scene.files.map(f => `- ${fileName(f)}`),
          ]);
          return;
        }
        if (!confirm(`Delete scene "${sceneName(scene)}" and ALL its files from disk?`)) return;
        delBtn.textContent = "Deleting…";
        delBtn.disabled = true;
        try {
          await destroyScene(scene.id, true);
          onSceneDeleted(scene.id);
          toast(`Deleted scene #${scene.id}`, "#e06c75");
        } catch (e) {
          toast(`Error: ${e.message}`, "#e06c75");
          delBtn.textContent = dryRun ? "👁 Preview delete scene" : "🗑 Delete scene";
          delBtn.disabled = false;
        }
      });
      hdr.appendChild(delBtn);
      sceneWrap.appendChild(hdr);

      const table = el("table", STYLE.table);
      table.innerHTML = `<thead><tr>
        <th style="${STYLE.th}">Path</th>
        <th style="${STYLE.th}">Res</th>
        <th style="${STYLE.th}">Codec</th>
        <th style="${STYLE.th}">Duration</th>
        <th style="${STYLE.th}">Size</th>
      </tr></thead>`;
      const tbody = document.createElement("tbody");
      sorted.forEach(f => {
        const selected = keeper && idKey(f.id) === idKey(keeper.id);
        const tr = document.createElement("tr");
        tr.style.cssText = [
          `background:${selected ? "rgba(152,195,121,0.16)" : "rgba(224,108,117,0.06)"};`,
          "cursor:pointer;",
        ].join("");
        tr.title = "Click to keep this file";
        tr.addEventListener("click", () => onSelectFile(scene.id, f.id));

        const basename = fileName(f);
        const dir = f.path ? f.path.replace(/[/\\][^/\\]+$/, "") : "";
        const keepMark = selected ? `<span style="${STYLE.keepBadge}">keep</span>` : "";
        tr.innerHTML = `
          <td style="${STYLE.td}">
            <div style="color:${selected ? "#98c379" : "#abb2bf"};font-size:0.9em;">${basename}${keepMark}</div>
            <div style="color:#5c6370;font-size:0.78em;margin-top:2px;">${dir}</div>
          </td>
          <td style="${STYLE.td}color:#abb2bf;">${f.height ? f.height + "p" : ""}</td>
          <td style="${STYLE.td}color:#abb2bf;">${f.video_codec || ""}</td>
          <td style="${STYLE.td}color:#abb2bf;">${f.duration ? Math.round(f.duration / 60) + "m" : ""}</td>
          <td style="${STYLE.td}color:#abb2bf;">${formatBytes(f.size)}</td>
        `;
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      sceneWrap.appendChild(table);
      wrap.appendChild(sceneWrap);
    }

    return wrap;
  }

  function renderDuplicatesTable(groups, opts = {}) {
    const {
      dryRun = false,
      batchMode = false,
      isGroupIncluded = () => true,
      getSelectedScene = group => bestScene(group.scenes),
      onSelectScene = () => {},
      onToggleGroupBatch = () => {},
      onMergeGroup = () => {},
      onSceneDeleted = () => {},
    } = opts;

    if (!groups.length) {
      return el("div", "color:#5c6370;padding:20px 0;text-align:center;", "No duplicate scenes found ✓");
    }

    const wrap = document.createElement("div");
    wrap.appendChild(el("div", "color:#5c6370;font-size:0.83em;margin-bottom:6px;",
      `${groups.length} group${groups.length !== 1 ? "s" : ""} of duplicates ` +
      `(${groups.reduce((n, g) => n + g.scenes.length, 0)} scenes total)`));
    wrap.appendChild(el("div", STYLE.rowHint, "Click a scene row to choose which scene to keep before merging."));

    for (const group of groups) {
      const groupWrap = document.createElement("div");
      groupWrap.style.marginBottom = "16px";

      const first = group.scenes[0];
      const keeper = getSelectedScene(group);
      const titleStr = (first.title || "(untitled)").trim();
      const dateStr = first.date || "";
      const stuStr = first.studio ? first.studio.name : "";
      const included = isGroupIncluded(group);

      const hdr = el("div", STYLE.groupHdr);
      hdr.appendChild(el("span", "font-size:1em;color:#e5c07b;font-weight:700;", titleStr));
      hdr.appendChild(el("span", STYLE.badge + "background:#c678dd;color:#fff;", `${group.scenes.length} scenes`));
      if (batchMode) {
        hdr.appendChild(el("span", STYLE.badge + `${included ? "background:#98c379;color:#21252b;" : "background:#5c6370;color:#fff;"}`,
          included ? "In batch" : "Excluded"));
      }
      if (dateStr) hdr.appendChild(el("span", "color:#5c6370;font-size:0.85em;", dateStr));
      if (stuStr) hdr.appendChild(el("span", "color:#5c6370;font-size:0.85em;", stuStr));
      hdr.appendChild(el("span", "flex:1;"));

      if (batchMode) {
        hdr.appendChild(mkBtn(included ? "➖ Exclude from batch" : "➕ Include in batch", included ? "#5c6370" : "#56b6c2", () => {
          onToggleGroupBatch(group.key);
        }));
      }

      hdr.appendChild(mkBtn(dryRun ? "👁 Preview merge" : "⚡ Merge", "#61afef", async () => {
        await onMergeGroup(group);
      }));
      groupWrap.appendChild(hdr);

      const table = el("table", STYLE.table);
      table.innerHTML = `<thead><tr>
        <th style="${STYLE.th}">Scene</th>
        <th style="${STYLE.th}">Files</th>
        <th style="${STYLE.th}">Res</th>
        <th style="${STYLE.th}">Codec</th>
        <th style="${STYLE.th}">Size</th>
        <th style="${STYLE.th}">Organized</th>
        <th style="${STYLE.th}">Performers</th>
        <th style="${STYLE.th}"></th>
      </tr></thead>`;
      const tbody = document.createElement("tbody");

      for (const scene of group.scenes) {
        const isKeeper = keeper && idKey(scene.id) === idKey(keeper.id);
        const bestFile = pickBestFile(scene.files) || {};
        const totalSize = (scene.files || []).reduce((n, f) => n + (f.size || 0), 0);
        const perfs = (scene.performers || []).map(p => p.name).join(", ");
        const filenames = (scene.files || []).map(fileName).join("<br>");

        const tr = document.createElement("tr");
        tr.style.cssText = `background:${isKeeper ? "rgba(152,195,121,0.16)" : "transparent"};cursor:pointer;`;
        tr.title = "Click to keep this scene";
        tr.addEventListener("click", () => onSelectScene(group.key, scene.id));

        const tdId = el("td", STYLE.td);
        const idLink = document.createElement("a");
        idLink.href = sceneUrl(scene.id);
        idLink.target = "_blank";
        idLink.style.cssText = STYLE.link;
        idLink.textContent = `#${scene.id}`;
        idLink.addEventListener("click", stopRowSelection);
        tdId.appendChild(idLink);
        if (isKeeper) tdId.appendChild(el("span", STYLE.keepBadge, "keep"));

        const tdFiles = el("td", STYLE.td + "color:#5c6370;font-size:0.78em;");
        tdFiles.innerHTML = filenames;

        const tdRes = el("td", STYLE.td + "color:#abb2bf;", bestFile.height ? bestFile.height + "p" : "");
        const tdCodec = el("td", STYLE.td + "color:#abb2bf;", bestFile.video_codec || "");
        const tdSize = el("td", STYLE.td + "color:#abb2bf;", formatBytes(totalSize));
        const tdOrg = el("td", STYLE.td + "text-align:center;color:#98c379;", scene.organized ? "✓" : "");
        const tdPerf = el("td", STYLE.td + "color:#abb2bf;", perfs);

        const tdAct = el("td", STYLE.td);
        const delBtn = mkBtn(dryRun ? "👁 Preview delete" : "🗑 Delete", "#e06c75", async () => {
          if (dryRun) {
            previewAction(`Delete duplicate scene #${scene.id}`, [
              `Would delete scene #${scene.id} "${scene.title || ""}" and ${scene.files.length} file(s) from disk:`,
              ...scene.files.map(f => `- ${fileName(f)}`),
            ]);
            return;
          }
          if (!confirm(`Delete scene #${scene.id} "${scene.title || ""}" and its file(s) from disk?`)) return;
          delBtn.textContent = "Deleting…";
          delBtn.disabled = true;
          try {
            await destroyScene(scene.id, true);
            onSceneDeleted(scene.id);
            toast(`Deleted scene #${scene.id}`, "#e06c75");
          } catch (e) {
            toast(`Error: ${e.message}`, "#e06c75");
            delBtn.textContent = dryRun ? "👁 Preview delete" : "🗑 Delete";
            delBtn.disabled = false;
          }
        });
        tdAct.appendChild(delBtn);

        tr.append(tdId, tdFiles, tdRes, tdCodec, tdSize, tdOrg, tdPerf, tdAct);
        tbody.appendChild(tr);
      }

      table.appendChild(tbody);
      groupWrap.appendChild(table);
      wrap.appendChild(groupWrap);
    }

    return wrap;
  }

  // ── Main modal ─────────────────────────────────────────────────────────────

  function openModal() {
    if (document.getElementById(MODAL_ID)) return;

    const overlay = el("div", STYLE.overlay);
    overlay.id = MODAL_ID;
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    const modal = el("div", STYLE.modal);
    overlay.appendChild(modal);

    const header = el("div", STYLE.header);
    const titleEl = el("span", "color:#e5c07b;font-weight:700;font-size:1.1em;", "🔍 DupeFinder");
    const closeBtn = mkBtn("✕", "#3e4451", () => overlay.remove());
    const controls = el("div", "display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-left:auto;");
    modal.appendChild(header);
    header.appendChild(titleEl);

    const tabBar = el("div", STYLE.tabs);
    modal.appendChild(tabBar);

    const body = el("div", STYLE.body);
    modal.appendChild(body);
    const loadingEl = el("div", "color:#5c6370;padding:40px 0;text-align:center;font-size:0.9em;", "Loading scenes… 0 / ?");
    body.appendChild(loadingEl);

    let allScenes = [];
    let multiFileScenes = [];
    let dupGroups = [];
    let currentTab = "multi";
    let dryRun = false;
    let batchMode = false;
    let loaded = false;

    let multiKeepers = {};
    let duplicateKeepers = {};
    let multiBatchExcluded = new Set();
    let dupBatchExcluded = new Set();

    function updateTitle() {
      titleEl.textContent = batchMode ? `🔍 DupeFinder — ${currentTab === "multi" ? "Multi-file" : "Duplicates"} batch mode` : "🔍 DupeFinder";
    }

    function getSelectedMultiFile(scene) {
      const selectedId = multiKeepers[idKey(scene.id)];
      return (scene.files || []).find(file => idKey(file.id) === selectedId) || pickBestFile(scene.files);
    }

    function getSelectedDuplicateScene(group) {
      const selectedId = duplicateKeepers[group.key];
      return group.scenes.find(scene => idKey(scene.id) === selectedId) || bestScene(group.scenes);
    }

    function isSceneIncluded(scene) {
      return !multiBatchExcluded.has(idKey(scene.id));
    }

    function isGroupIncluded(group) {
      return !dupBatchExcluded.has(group.key);
    }

    function refreshDerivedState() {
      multiFileScenes = findMultiFileScenes(allScenes);
      dupGroups = findDuplicateScenes(allScenes);

      const validMultiIds = new Set(multiFileScenes.map(scene => idKey(scene.id)));
      Object.keys(multiKeepers).forEach(sceneId => {
        if (!validMultiIds.has(sceneId)) delete multiKeepers[sceneId];
      });
      multiFileScenes.forEach(scene => {
        const selectedId = multiKeepers[idKey(scene.id)];
        if (selectedId && !(scene.files || []).some(file => idKey(file.id) === selectedId)) {
          delete multiKeepers[idKey(scene.id)];
        }
      });
      multiBatchExcluded = new Set([...multiBatchExcluded].filter(sceneId => validMultiIds.has(sceneId)));

      const dupMap = new Map(dupGroups.map(group => [group.key, group]));
      Object.keys(duplicateKeepers).forEach(groupKey => {
        const group = dupMap.get(groupKey);
        if (!group || !group.scenes.some(scene => idKey(scene.id) === duplicateKeepers[groupKey])) {
          delete duplicateKeepers[groupKey];
        }
      });
      dupBatchExcluded = new Set([...dupBatchExcluded].filter(groupKey => dupMap.has(groupKey)));
    }

    function removeSceneFromState(sceneId) {
      const sceneKey = idKey(sceneId);
      allScenes = allScenes.filter(scene => idKey(scene.id) !== sceneKey);
      delete multiKeepers[sceneKey];
      multiBatchExcluded.delete(sceneKey);
      refreshDerivedState();
    }

    function refreshCleanedSceneState(sceneId, keeperFileId) {
      const sceneKey = idKey(sceneId);
      const fileKey = idKey(keeperFileId);
      allScenes = allScenes.map(scene => {
        if (idKey(scene.id) !== sceneKey) return scene;
        const keeperFile = (scene.files || []).find(file => idKey(file.id) === fileKey);
        if (!keeperFile) return scene;
        return { ...scene, files: [keeperFile] };
      });
      delete multiKeepers[sceneKey];
      multiBatchExcluded.delete(sceneKey);
      refreshDerivedState();
    }

    function refreshMergedGroupState(group, keeperScene) {
      const keeperKey = idKey(keeperScene.id);
      const sourceIds = new Set(group.scenes.filter(scene => idKey(scene.id) !== keeperKey).map(scene => idKey(scene.id)));
      let keeperUpdated = false;
      allScenes = allScenes
        .filter(scene => !sourceIds.has(idKey(scene.id)))
        .map(scene => {
          if (idKey(scene.id) !== keeperKey) return scene;
          keeperUpdated = true;
          return keeperScene;
        });
      if (!keeperUpdated) allScenes.push(keeperScene);
      sourceIds.forEach(sceneId => {
        delete multiKeepers[sceneId];
        multiBatchExcluded.delete(sceneId);
      });
      delete duplicateKeepers[group.key];
      dupBatchExcluded.delete(group.key);
      refreshDerivedState();
    }

    async function executeKeepScene(scene, keeper, extraFiles) {
      await setScenePrimaryFile(scene.id, keeper.id);
      await deleteFiles(extraFiles.map(file => file.id));
      refreshCleanedSceneState(scene.id, keeper.id);
    }

    async function executeMergeGroup(group, keeper, sources) {
      await mergeScenes(sources.map(scene => scene.id), keeper.id);
      const mergedKeeper = await fetchScene(keeper.id);
      refreshMergedGroupState(group, mergedKeeper);
    }

    async function runKeepScene(scene) {
      const keeper = getSelectedMultiFile(scene);
      const extraFiles = (scene.files || []).filter(file => idKey(file.id) !== idKey(keeper.id));
      if (!keeper || !extraFiles.length) {
        toast(`Scene #${scene.id} already only has the selected keep file`, "#56b6c2");
        return;
      }

      if (dryRun) {
        previewAction(`Keep selected file for scene ${sceneName(scene)}`, [
          `Would keep: ${filePathLabel(keeper)}`,
          "",
          `Would delete ${extraFiles.length} other file(s):`,
          ...extraFiles.map(file => `- ${filePathLabel(file)}`),
        ]);
        return;
      }

      if (!confirm(
        `Keep only the selected file for "${sceneName(scene)}"?\n\n` +
        `Keep:\n- ${fileName(keeper)}\n\n` +
        `Delete from disk:\n${extraFiles.map(file => `- ${fileName(file)}`).join("\n")}`
      )) return;

      try {
        await executeKeepScene(scene, keeper, extraFiles);
        showTab(currentTab);
        toast(`Kept selected file for scene #${scene.id}`, "#98c379");
      } catch (e) {
        toast(`Cleanup error: ${e.message}`, "#e06c75");
      }
    }

    async function runMergeGroup(group) {
      const keeper = getSelectedDuplicateScene(group);
      const sources = group.scenes.filter(scene => idKey(scene.id) !== idKey(keeper.id));
      const keepTitle = sceneName(keeper);
      if (!sources.length) {
        toast(`Nothing left to merge for ${keepTitle}`, "#56b6c2");
        return;
      }

      if (dryRun) {
        previewAction(`Merge duplicates into ${keepTitle}`, [
          `Would keep destination scene: ${keeper.title ? `#${keeper.id} ${keepTitle}` : keepTitle}`,
          "",
          `Would merge ${sources.length} source scene(s):`,
          ...sources.map(scene => `- ${scene.title ? `#${scene.id} ${sceneName(scene)}` : sceneName(scene)}`),
        ]);
        return;
      }

      if (!confirm(
        `Merge ${sources.length} scene(s) into the selected keep scene "${keepTitle}"?\n\n` +
        `Source scenes will be removed after merge. Metadata will be combined.`
      )) return;

      try {
        await executeMergeGroup(group, keeper, sources);
        showTab(currentTab);
        toast(`Merged ${sources.length} scene(s) into #${keeper.id}`, "#61afef");
      } catch (e) {
        toast(`Merge error: ${e.message}`, "#e06c75");
      }
    }

    async function runMultiBatch() {
      const plans = multiFileScenes
        .filter(scene => isSceneIncluded(scene))
        .map(scene => {
          const keeper = getSelectedMultiFile(scene);
          return {
            scene,
            keeper,
            extraFiles: (scene.files || []).filter(file => keeper && idKey(file.id) !== idKey(keeper.id)),
          };
        })
        .filter(plan => plan.keeper && plan.extraFiles.length);

      if (!plans.length) {
        toast("No multi-file scenes are currently included in the batch", "#56b6c2");
        return;
      }

      if (dryRun) {
        const lines = [];
        plans.forEach(plan => {
          lines.push(`Scene #${plan.scene.id} ${sceneName(plan.scene)}`);
          lines.push(`Keep: ${filePathLabel(plan.keeper)}`);
          lines.push(`Delete ${plan.extraFiles.length} file(s):`);
          plan.extraFiles.forEach(file => lines.push(`- ${filePathLabel(file)}`));
          lines.push("");
        });
        previewAction(`Batch keep for ${plans.length} scene(s)`, lines);
        return;
      }

      const totalDeleted = plans.reduce((count, plan) => count + plan.extraFiles.length, 0);
      if (!confirm(
        `Apply keep to ${plans.length} multi-file scene(s)?\n\n` +
        `This will keep the selected file for each scene and delete ${totalDeleted} other file(s) from disk.`
      )) return;

      try {
        for (const plan of plans) {
          await executeKeepScene(plan.scene, plan.keeper, plan.extraFiles);
        }
        showTab(currentTab);
        toast(`Kept selected files for ${plans.length} scene(s)`, "#98c379");
      } catch (e) {
        showTab(currentTab);
        toast(`Batch keep error: ${e.message}`, "#e06c75");
      }
    }

    async function runDuplicateBatch() {
      const includedGroupKeys = dupGroups
        .filter(group => isGroupIncluded(group))
        .map(group => group.key);

      const previewPlans = includedGroupKeys
        .map(groupKey => dupGroups.find(group => group.key === groupKey))
        .filter(Boolean)
        .map(group => {
          const keeper = getSelectedDuplicateScene(group);
          return {
            group,
            keeper,
            sources: group.scenes.filter(scene => keeper && idKey(scene.id) !== idKey(keeper.id)),
          };
        })
        .filter(plan => plan.keeper && plan.sources.length);

      if (!previewPlans.length) {
        toast("No duplicate groups are currently included in the batch", "#56b6c2");
        return;
      }

      if (dryRun) {
        const lines = [];
        previewPlans.forEach(plan => {
          lines.push(`Keep: #${plan.keeper.id} ${sceneName(plan.keeper)}`);
          lines.push(`Merge ${plan.sources.length} source scene(s):`);
          plan.sources.forEach(scene => lines.push(`- #${scene.id} ${sceneName(scene)}`));
          lines.push("");
        });
        previewAction(`Batch merge for ${previewPlans.length} duplicate group(s)`, lines);
        return;
      }

      const totalSources = previewPlans.reduce((count, plan) => count + plan.sources.length, 0);
      if (!confirm(
        `Merge ${previewPlans.length} duplicate group(s) into their selected keep scenes?\n\n` +
        `${totalSources} source scene(s) will be removed after merge and metadata will be combined.`
      )) return;

      try {
        let mergedCount = 0;
        for (const groupKey of includedGroupKeys) {
          const currentGroup = dupGroups.find(group => group.key === groupKey);
          if (!currentGroup) continue;
          const keeper = getSelectedDuplicateScene(currentGroup);
          const sources = currentGroup.scenes.filter(scene => idKey(scene.id) !== idKey(keeper.id));
          if (!keeper || !sources.length) continue;
          await executeMergeGroup(currentGroup, keeper, sources);
          mergedCount++;
        }
        showTab(currentTab);
        toast(`Merged ${mergedCount} duplicate group(s)`, "#61afef");
      } catch (e) {
        showTab(currentTab);
        toast(`Batch merge error: ${e.message}`, "#e06c75");
      }
    }

    function renderBatchBar(config) {
      const { totalCount, includedCount, itemLabel, actionLabel, actionColor, onRun, isDisabled = () => includedCount === 0 } = config;
      const bar = el("div", STYLE.batchBar);
      const summary = includedCount
        ? `${includedCount} of ${totalCount} ${itemLabel} in the batch`
        : `No ${itemLabel} included in the batch`;
      bar.appendChild(el("div", "color:#abb2bf;font-size:0.85em;font-weight:600;", summary));
      bar.appendChild(el("div", "color:#5c6370;font-size:0.8em;", "Exclude items you want to skip, then run the batch action."));
      bar.appendChild(el("span", "flex:1;"));

      const runBtn = mkBtn(actionLabel, actionColor, async () => {
        const originalLabel = runBtn.textContent;
        runBtn.disabled = true;
        runBtn.textContent = "Running…";
        try {
          await onRun();
        } finally {
          if (document.body.contains(runBtn)) {
            runBtn.textContent = originalLabel;
            runBtn.disabled = isDisabled();
          }
        }
      });
      if (isDisabled()) runBtn.disabled = true;
      bar.appendChild(runBtn);
      return bar;
    }

    function showTab(tab) {
      currentTab = tab;
      updateTitle();
      tabBar.innerHTML = "";
      tabBar.appendChild(tabBtn(`Multi-file (${multiFileScenes.length})`, tab === "multi", () => showTab("multi")));
      tabBar.appendChild(tabBtn(`Duplicates (${dupGroups.length})`, tab === "dupes", () => showTab("dupes")));
      body.innerHTML = "";

      if (tab === "multi") {
        if (batchMode) {
          const includedCount = multiFileScenes.filter(scene => isSceneIncluded(scene)).length;
          body.appendChild(renderBatchBar({
            totalCount: multiFileScenes.length,
            includedCount,
            itemLabel: `scene${multiFileScenes.length === 1 ? "" : "s"}`,
            actionLabel: dryRun ? "👁 Preview batch keep" : "🧹 Keep selected in batch",
            actionColor: "#98c379",
            onRun: runMultiBatch,
            isDisabled: () => multiFileScenes.filter(scene => isSceneIncluded(scene)).length === 0,
          }));
        }

        body.appendChild(renderMultiFileTable(multiFileScenes, {
          dryRun,
          batchMode,
          isSceneIncluded,
          getSelectedFile: getSelectedMultiFile,
          onSelectFile(sceneId, fileId) {
            multiKeepers[idKey(sceneId)] = idKey(fileId);
            showTab(currentTab);
          },
          onToggleSceneBatch(sceneId) {
            const key = idKey(sceneId);
            if (multiBatchExcluded.has(key)) multiBatchExcluded.delete(key);
            else multiBatchExcluded.add(key);
            showTab(currentTab);
          },
          onKeepScene: runKeepScene,
          onSceneDeleted(sceneId) {
            removeSceneFromState(sceneId);
            showTab(currentTab);
          },
        }));
      } else {
        if (batchMode) {
          const includedCount = dupGroups.filter(group => isGroupIncluded(group)).length;
          body.appendChild(renderBatchBar({
            totalCount: dupGroups.length,
            includedCount,
            itemLabel: `group${dupGroups.length === 1 ? "" : "s"}`,
            actionLabel: dryRun ? "👁 Preview batch merge" : "⚡ Merge selected in batch",
            actionColor: "#61afef",
            onRun: runDuplicateBatch,
            isDisabled: () => dupGroups.filter(group => isGroupIncluded(group)).length === 0,
          }));
        }

        body.appendChild(renderDuplicatesTable(dupGroups, {
          dryRun,
          batchMode,
          isGroupIncluded,
          getSelectedScene: getSelectedDuplicateScene,
          onSelectScene(groupKey, sceneId) {
            duplicateKeepers[groupKey] = idKey(sceneId);
            showTab(currentTab);
          },
          onToggleGroupBatch(groupKey) {
            if (dupBatchExcluded.has(groupKey)) dupBatchExcluded.delete(groupKey);
            else dupBatchExcluded.add(groupKey);
            showTab(currentTab);
          },
          onMergeGroup: runMergeGroup,
          onSceneDeleted(sceneId) {
            removeSceneFromState(sceneId);
            showTab(currentTab);
          },
        }));
      }
    }

    const dryRunLabel = el("label", "display:flex;align-items:center;gap:6px;color:#abb2bf;font-size:0.85em;cursor:pointer;");
    const dryRunBox = document.createElement("input");
    dryRunBox.type = "checkbox";
    dryRunBox.addEventListener("change", () => {
      dryRun = dryRunBox.checked;
      if (loaded) showTab(currentTab);
    });
    dryRunLabel.appendChild(dryRunBox);
    dryRunLabel.appendChild(document.createTextNode("Dry run / preview mode"));

    const batchModeLabel = el("label", "display:flex;align-items:center;gap:6px;color:#abb2bf;font-size:0.85em;cursor:pointer;");
    const batchModeBox = document.createElement("input");
    batchModeBox.type = "checkbox";
    batchModeBox.addEventListener("change", () => {
      batchMode = batchModeBox.checked;
      updateTitle();
      if (loaded) showTab(currentTab);
    });
    batchModeLabel.appendChild(batchModeBox);
    batchModeLabel.appendChild(document.createTextNode("Batch mode"));

    controls.appendChild(dryRunLabel);
    controls.appendChild(batchModeLabel);
    controls.appendChild(closeBtn);
    header.appendChild(controls);
    updateTitle();

    fetchAllScenes((loadedCount, total) => {
      if (!loaded && loadingEl.isConnected) loadingEl.textContent = `Loading scenes… ${loadedCount} / ${total}`;
    }).then(scenes => {
      allScenes = scenes;
      refreshDerivedState();
      loaded = true;
      showTab("multi");
    }).catch(err => {
      body.innerHTML = "";
      body.appendChild(el("div", "color:#e06c75;padding:20px 0;", `Error: ${err.message}`));
      console.error("[DupeFinder]", err);
    });
  }

  // ── Floating button ────────────────────────────────────────────────────────

  function injectButton() {
    if (document.getElementById(BTN_ID)) return;
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.textContent = "🔍 Dupes";
    btn.style.cssText = [
      "position:fixed;bottom:80px;left:24px;z-index:9990;",
      "background:#c678dd;color:#fff;border:none;border-radius:20px;",
      "padding:9px 16px;font-size:0.85em;font-weight:600;cursor:pointer;",
      "box-shadow:0 2px 8px rgba(0,0,0,0.4);",
    ].join("");
    btn.addEventListener("click", openModal);
    btn.addEventListener("mouseenter", () => btn.style.background = "#d896e8");
    btn.addEventListener("mouseleave", () => btn.style.background = "#c678dd");
    document.body.appendChild(btn);
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  function schedule() {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      injectButton();
    } else {
      document.addEventListener("DOMContentLoaded", injectButton);
    }
    const obs = new MutationObserver(() => {
      if (!document.getElementById(BTN_ID)) injectButton();
    });
    obs.observe(document.body, { childList: true, subtree: false });
  }

  schedule();

})();
