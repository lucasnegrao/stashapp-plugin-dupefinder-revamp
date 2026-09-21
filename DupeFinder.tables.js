(function () {
  "use strict";
  const root = window.DupeFinder = window.DupeFinder || {};
  const { ui, helpers, defaults, analysis, constants } = root;
  const STYLE = defaults.style;

  function headerTable(columns) {
    const table = ui.el("table", STYLE.table);
    table.appendChild(ui.renderColgroup(columns));
    return table;
  }

  function td(text, extraStyle) {
    return ui.el("td", STYLE.td + (extraStyle || ""), helpers.placeholder(text));
  }

  function appendLinesAsText(container, lines) {
    lines.forEach((line, index) => {
      if (index > 0) container.appendChild(document.createElement("br"));
      container.appendChild(document.createTextNode(line));
    });
  }

  function renderBatchBar(config) {
    const {
      totalCount,
      includedCount,
      itemLabel,
      note,
    } = config;
    const actions = config.actions || [{
      label: config.actionLabel,
      color: config.actionColor,
      onRun: config.onRun,
      isDisabled: config.isDisabled,
    }];

    const bar = ui.el("div", STYLE.batchBar);
    const summary = includedCount
      ? `${includedCount} of ${totalCount} ${itemLabel} in the batch`
      : `No ${itemLabel} included in the batch`;
    bar.appendChild(ui.el("div", "color:#abb2bf;font-size:0.85em;font-weight:600;", summary));
    bar.appendChild(ui.el("div", STYLE.hintText + "font-size:0.8em;", note || "Exclude items you want to skip, then run the batch action."));
    bar.appendChild(ui.el("span", "flex:1;"));

    actions.forEach(action => {
      const runBtn = ui.mkBtn(action.label, action.color, async () => {
        const original = runBtn.textContent;
        runBtn.textContent = "Running…";
        runBtn.disabled = true;
        try {
          await action.onRun();
        } finally {
          if (document.body.contains(runBtn)) {
            runBtn.textContent = original;
            runBtn.disabled = action.isDisabled();
          }
        }
      });
      runBtn.disabled = action.isDisabled();
      bar.appendChild(runBtn);
    });
    return bar;
  }

  function renderSettingsModal({ settings, onSave, onReset, onClose }) {
    const overlay = ui.el("div", "position:absolute;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:6;");
    const panel = ui.el("div", "width:560px;max-width:92%;background:#2c313a;border:1px solid #3e4451;border-radius:8px;padding:14px;");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "df-settings-title");
    const title = ui.el("div", "color:#e5c07b;font-weight:700;margin-bottom:10px;", "Settings");
    title.id = "df-settings-title";
    panel.appendChild(title);

    const form = ui.el("div", "display:grid;grid-template-columns:1fr 1fr;gap:10px;");
    const controlStyle = "width:100%;background:#21252b;border:1px solid #3e4451;color:#abb2bf;border-radius:4px;padding:6px;";

    const legacyDistanceInput = document.createElement("input");
    legacyDistanceInput.type = "number";
    legacyDistanceInput.min = "0";
    legacyDistanceInput.max = "10";
    legacyDistanceInput.value = String(settings.legacyDistance);
    legacyDistanceInput.style.cssText = controlStyle;

    const algoSelect = document.createElement("select");
    ["balanced", "quality", "size"].forEach(option => {
      const opt = document.createElement("option");
      opt.value = option;
      opt.textContent = option.charAt(0).toUpperCase() + option.slice(1);
      if (option === settings.bestAlgorithm) opt.selected = true;
      algoSelect.appendChild(opt);
    });
    algoSelect.style.cssText = controlStyle;

    const batchDiffSelect = document.createElement("select");
    root.constants.BATCH_DURATION_DIFF_OPTIONS.forEach(option => {
      const opt = document.createElement("option");
      opt.value = String(option.value);
      opt.textContent = option.label;
      if (option.value === settings.batchDurationDiffSeconds) opt.selected = true;
      batchDiffSelect.appendChild(opt);
    });
    batchDiffSelect.style.cssText = controlStyle;

    const unsafeBox = document.createElement("input");
    unsafeBox.type = "checkbox";
    unsafeBox.checked = !!settings.autoExcludeDuplicateUnsafe;

    const organizedBox = document.createElement("input");
    organizedBox.type = "checkbox";
    organizedBox.checked = !!settings.preferOrganizedInBest;

    const fallbackLegacyBox = document.createElement("input");
    fallbackLegacyBox.type = "checkbox";
    fallbackLegacyBox.checked = !!settings.useLegacyWhenNoPhash;

    function field(label, control, hint) {
      const wrap = ui.el("label", "display:flex;flex-direction:column;gap:4px;color:#abb2bf;font-size:0.82em;");
      wrap.appendChild(ui.el("span", "font-weight:600;", label));
      wrap.appendChild(control);
      if (hint) wrap.appendChild(ui.el("span", STYLE.hintText + "font-size:0.78em;", hint));
      return wrap;
    }

    const legacyDistanceField = field("Legacy title distance", legacyDistanceInput, "Used in legacy mode or as the fallback pass only for scenes without pHash. 0 means strict title matching; higher values broaden title-only and same-meta title matching.");

    form.appendChild(legacyDistanceField);
    form.appendChild(field("Automatic keep selection", algoSelect, `Choose how ${constants.PRODUCT_NAME} automatically selects the file or scene to keep: Balanced, Quality, or Size.`));
    form.appendChild(field("Maximum duration difference", batchDiffSelect, "Any allows every duration difference. Equal requires matching durations; the other choices set the maximum allowed difference."));

    const unsafeLabel = ui.el("label", "display:flex;align-items:center;gap:8px;color:#abb2bf;font-size:0.82em;");
    unsafeLabel.appendChild(unsafeBox);
    unsafeLabel.appendChild(ui.el("span", "", "Auto-exclude unsafe duplicate groups in batch mode"));
    form.appendChild(unsafeLabel);

    const fallbackLegacyLabel = ui.el("label", "display:flex;align-items:center;gap:8px;color:#abb2bf;font-size:0.82em;");
    fallbackLegacyLabel.appendChild(fallbackLegacyBox);
    fallbackLegacyLabel.appendChild(ui.el("span", "", "Use legacy when files have no pHash"));
    form.appendChild(fallbackLegacyLabel);

    const organizedLabel = ui.el("label", "display:flex;align-items:center;gap:8px;color:#abb2bf;font-size:0.82em;");
    organizedLabel.appendChild(organizedBox);
    organizedLabel.appendChild(ui.el("span", "", "Prefer organized scenes in best selection tie-break"));
    form.appendChild(organizedLabel);

    panel.appendChild(form);

    const errEl = ui.el("div", "color:#e06c75;font-size:0.78em;margin-top:8px;display:none;");
    panel.appendChild(errEl);

    const actions = ui.el("div", "display:flex;gap:8px;justify-content:flex-end;margin-top:12px;");
    const cancelBtn = ui.mkBtn("Close", "#5c6370", onClose);
    const resetBtn = ui.mkBtn("Reset defaults", "#e5c07b", async () => {
      await onReset();
      onClose();
    });
    resetBtn.style.color = "#21252b";
    const saveBtn = ui.mkBtn("Save", "#98c379", async () => {
      errEl.style.display = "none";
      try {
        await onSave({
          useLegacyWhenNoPhash: fallbackLegacyBox.checked,
          legacyDistance: Number(legacyDistanceInput.value),
          bestAlgorithm: algoSelect.value,
          batchDurationDiffSeconds: Number(batchDiffSelect.value),
          autoExcludeDuplicateUnsafe: unsafeBox.checked,
          preferOrganizedInBest: organizedBox.checked,
        });
        onClose();
      } catch (error) {
        errEl.textContent = error.message || "Invalid settings";
        errEl.style.display = "block";
      }
    });
    actions.append(cancelBtn, resetBtn, saveBtn);
    panel.appendChild(actions);

    overlay.appendChild(panel);
    return overlay;
  }

  function renderMultiFileTable(scenes, opts) {
    const {
      settings,
      dryRun,
      batchMode,
      isSceneIncluded,
      getSelectedFile,
      onSelectFile,
      onToggleSceneBatch,
      onKeepScene,
      onSplitScene,
    } = opts;

    if (!scenes.length) return ui.el("div", STYLE.hintText + "padding:20px 0;text-align:center;", "No multi-file scenes found ✓");

    const wrap = document.createElement("div");
    wrap.appendChild(ui.el("div", STYLE.hintText + "font-size:0.83em;margin-bottom:6px;", `${scenes.length} scene${scenes.length !== 1 ? "s" : ""} with multiple files`));
    wrap.appendChild(ui.el("div", STYLE.rowHint, "Click a row to choose which file to keep; click the selected row again to clear it."));

    for (const scene of scenes) {
      const sceneWrap = document.createElement("div");
      const sorted = [...scene.files].sort((a, b) => analysis.compareFiles(a, b, settings));
      const keeper = getSelectedFile(scene);
      const extraFiles = keeper
        ? sorted.filter(f => helpers.idKey(f.id) !== helpers.idKey(keeper.id))
        : sorted;
      const included = isSceneIncluded(scene);
      const hasDurationMismatch = analysis.hasLargeDurationMismatch(scene, settings);
      const durationDiffSeconds = Math.round(analysis.sceneDurationDiffSeconds(scene));

      const hdr = ui.el("div", STYLE.groupHdr);
      const link = document.createElement("a");
      link.href = helpers.sceneUrl(scene.id);
      link.target = "_blank";
      link.style.cssText = STYLE.link + "font-size:1em;font-weight:600;color:#e5c07b;";
      link.textContent = scene.title || "(untitled)";
      link.addEventListener("click", ui.stopRowSelection);
      hdr.appendChild(link);
      const headingDetails = [scene.date, scene.studio && scene.studio.name].filter(Boolean);
      if (headingDetails.length) {
        hdr.appendChild(ui.el("span", "color:#e5c07b;font-size:1em;font-weight:600;", `— ${headingDetails.join(" — ")}`));
      }
      hdr.appendChild(ui.el("span", STYLE.badge + "background:#e06c75;color:#fff;", `${scene.files.length} files`));
      if (hasDurationMismatch) hdr.appendChild(ui.el("span", STYLE.badge + "background:#e5c07b;color:#21252b;", `Duration diff ${durationDiffSeconds}s`));
      if (batchMode) hdr.appendChild(ui.el("span", STYLE.badge + `${included ? "background:#98c379;color:#21252b;" : "background:#5c6370;color:#fff;"}`, included ? "In batch" : "Excluded"));
      hdr.appendChild(ui.el("span", "flex:1;"));
      if (batchMode) {
        const toggleBtn = ui.mkBtn(included ? "➖ Exclude from batch" : "➕ Include in batch", included ? "#5c6370" : "#56b6c2", () => onToggleSceneBatch(scene.id));
        toggleBtn.setAttribute("aria-pressed", included ? "true" : "false");
        hdr.appendChild(toggleBtn);
      } else {
        const keepBtn = ui.mkBtn(dryRun ? "👁 Preview keep" : "🧹 Keep", "#98c379", async () => onKeepScene(scene));
        keepBtn.disabled = !keeper || !extraFiles.length;
        keepBtn.style.opacity = keepBtn.disabled ? "0.6" : "1";
        hdr.appendChild(keepBtn);
        const splitBtn = ui.mkBtn(dryRun ? "👁 Preview split" : "✂ Split", "#c678dd", async () => onSplitScene(scene));
        splitBtn.disabled = extraFiles.length < (keeper ? 1 : 2);
        splitBtn.style.opacity = splitBtn.disabled ? "0.6" : "1";
        hdr.appendChild(splitBtn);
      }
      sceneWrap.appendChild(hdr);

      const table = headerTable(root.defaults.columns.multi);
      const tbody = document.createElement("tbody");

      sorted.forEach(file => {
        const selected = keeper && helpers.idKey(file.id) === helpers.idKey(keeper.id);
        const tr = document.createElement("tr");
        tr.style.cssText = `background:${selected ? "rgba(152,195,121,0.16)" : "rgba(224,108,117,0.06)"};cursor:pointer;`;
        tr.title = selected ? "Click again to clear the keep selection" : "Click to keep this file";
        tr.addEventListener("click", () => onSelectFile(scene.id, file.id));

        const actionsTd = ui.el("td", STYLE.td + "white-space:nowrap;");
        if (selected) actionsTd.appendChild(ui.el("span", STYLE.keepBadge, "keep"));

        const basename = helpers.fileName(file);
        const dir = file.path ? file.path.replace(/[/\\][^/\\]+$/, "") : "";
        const tdPath = ui.el("td", STYLE.td + "white-space:normal;");
        const nameWrap = ui.el("div", `color:${selected ? "#98c379" : "#abb2bf"};font-size:0.9em;`);
        nameWrap.appendChild(document.createTextNode(basename));
        const dirWrap = ui.el("div", "color:#5c6370;font-size:0.78em;margin-top:2px;", helpers.placeholder(dir));
        tdPath.append(nameWrap, dirWrap);

        tr.appendChild(actionsTd);
        tr.appendChild(tdPath);
        tr.appendChild(td(file.height ? `${file.height}p` : "—", "color:#abb2bf;"));
        tr.appendChild(td(file.video_codec || "—", "color:#abb2bf;"));
        tr.appendChild(td(helpers.readPhash(file), "color:#abb2bf;font-family:monospace;font-size:0.78em;"));
        tr.appendChild(td(helpers.formatDuration(file.duration), "color:#abb2bf;"));
        tr.appendChild(td(helpers.formatBytes(file.size), "color:#abb2bf;"));
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      sceneWrap.appendChild(table);
      wrap.appendChild(sceneWrap);
    }

    return wrap;
  }

  function renderDuplicatesTable(groups, opts) {
    const {
      settings,
      dryRun,
      batchMode,
      isGroupIncluded,
      isGroupUnsafe,
      getSelectedScene,
      onSelectScene,
      onToggleGroupBatch,
      onMergeGroup,
    } = opts;

    if (!groups.length) return ui.el("div", STYLE.hintText + "padding:20px 0;text-align:center;", "No duplicate scenes found ✓");

    const wrap = document.createElement("div");
    wrap.appendChild(ui.el("div", STYLE.hintText + "font-size:0.83em;margin-bottom:6px;", `${groups.length} group${groups.length !== 1 ? "s" : ""} of duplicates (${groups.reduce((n, g) => n + g.scenes.length, 0)} scenes total)`));
    wrap.appendChild(ui.el("div", STYLE.rowHint, "Click a scene row to choose which scene to keep."));

    for (const group of groups) {
      const groupWrap = document.createElement("div");
      groupWrap.style.marginBottom = "16px";
      const first = group.scenes[0];
      const keeper = getSelectedScene(group);
      const included = isGroupIncluded(group);
      const unsafe = isGroupUnsafe(group);
      const diff = Math.round(analysis.groupDurationDiffSeconds(group, settings));

      const hdr = ui.el("div", STYLE.groupHdr);
      const headingText = [
        (first.title || "(untitled)").trim(),
        first.date,
        first.studio && first.studio.name,
      ].filter(Boolean).join(" — ");
      hdr.appendChild(ui.el("span", "font-size:1em;color:#e5c07b;font-weight:700;", headingText));
      hdr.appendChild(ui.el("span", STYLE.badge + "background:#c678dd;color:#fff;", `${group.scenes.length} scenes`));
      hdr.appendChild(ui.el("span", STYLE.badge + `${group.method === "legacy" ? "background:#d19a66;color:#21252b;" : "background:#61afef;color:#21252b;"}`, group.method === "legacy" ? "Legacy" : "pHash"));
      if (unsafe) hdr.appendChild(ui.el("span", STYLE.badge + "background:#e5c07b;color:#21252b;", `Duration diff ${diff}s`));
      if (batchMode) hdr.appendChild(ui.el("span", STYLE.badge + `${included ? "background:#98c379;color:#21252b;" : "background:#5c6370;color:#fff;"}`, included ? "In batch" : "Excluded"));
      hdr.appendChild(ui.el("span", "flex:1;"));
      if (batchMode) {
        const toggleBtn = ui.mkBtn(included ? "➖ Exclude from batch" : "➕ Include in batch", included ? "#5c6370" : "#56b6c2", () => onToggleGroupBatch(group.key));
        toggleBtn.setAttribute("aria-pressed", included ? "true" : "false");
        hdr.appendChild(toggleBtn);
      } else {
        const mergeBtn = ui.mkBtn(dryRun ? "👁 Preview merge" : "⚡ Merge", "#61afef", async () => onMergeGroup(group));
        mergeBtn.disabled = !keeper || group.scenes.length < 2;
        mergeBtn.style.opacity = mergeBtn.disabled ? "0.6" : "1";
        hdr.appendChild(mergeBtn);
      }
      groupWrap.appendChild(hdr);

      const table = headerTable(root.defaults.columns.dupes);
      const tbody = document.createElement("tbody");

      for (const scene of group.scenes) {
        const isKeeper = keeper && helpers.idKey(scene.id) === helpers.idKey(keeper.id);
        const bestFile = analysis.pickBestFile(scene.files, settings) || {};
        const totalSize = (scene.files || []).reduce((n, f) => n + (f.size || 0), 0);
        const perfs = (scene.performers || []).map(p => p.name).join(", ") || "—";
        const filenames = (scene.files || []).map(helpers.fileName);

        const tr = document.createElement("tr");
        tr.style.cssText = `background:${isKeeper ? "rgba(152,195,121,0.16)" : "transparent"};cursor:pointer;`;
        tr.title = "Click to keep this scene";
        tr.addEventListener("click", () => onSelectScene(group.key, scene.id));

        const actionsTd = ui.el("td", STYLE.td + "white-space:nowrap;");
        if (isKeeper) actionsTd.appendChild(ui.el("span", STYLE.keepBadge, "keep"));

        const sceneTd = ui.el("td", STYLE.td);
        const link = document.createElement("a");
        link.href = helpers.sceneUrl(scene.id);
        link.target = "_blank";
        link.style.cssText = STYLE.link;
        link.textContent = `#${scene.id}`;
        link.addEventListener("click", ui.stopRowSelection);
        sceneTd.appendChild(link);

        const filesTd = ui.el("td", STYLE.td + "color:#5c6370;font-size:0.78em;white-space:normal;");
        if (!filenames.length) {
          filesTd.textContent = "—";
        } else {
          appendLinesAsText(filesTd, filenames);
        }

        tr.appendChild(actionsTd);
        tr.appendChild(sceneTd);
        tr.appendChild(filesTd);
        tr.appendChild(td(bestFile.height ? `${bestFile.height}p` : "—", "color:#abb2bf;"));
        tr.appendChild(td(bestFile.video_codec || "—", "color:#abb2bf;"));
        tr.appendChild(td(helpers.readPhash(bestFile), "color:#abb2bf;font-family:monospace;font-size:0.78em;"));
        tr.appendChild(td(helpers.formatDuration(bestFile.duration), "color:#abb2bf;"));
        tr.appendChild(td(helpers.formatBytes(totalSize), "color:#abb2bf;"));
        tr.appendChild(td(scene.organized ? "✓" : "—", "text-align:center;color:#98c379;"));
        tr.appendChild(td(perfs, "color:#abb2bf;white-space:normal;"));
        tbody.appendChild(tr);
      }

      table.appendChild(tbody);
      groupWrap.appendChild(table);
      wrap.appendChild(groupWrap);
    }

    return wrap;
  }

  root.tables = {
    renderBatchBar,
    renderSettingsModal,
    renderMultiFileTable,
    renderDuplicatesTable,
  };
})();
