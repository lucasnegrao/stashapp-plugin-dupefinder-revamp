(function () {
  "use strict";
  const root = window.DupeFinder = window.DupeFinder || {};
  const { api, actions, analysis, tables, settings: settingsStore, defaults, ui, helpers, constants } = root;
  const STYLE = defaults.style;

  function createController() {
    const state = {
      allScenes: [],
      multiFileScenes: [],
      dupGroups: [],
      currentTab: "multi",
      dryRun: false,
      batchMode: false,
      loaded: false,
      settings: settingsStore.load(),
      multiKeepers: {},
      duplicateKeepers: {},
      multiBatchExcluded: new Set(),
      multiBatchForcedIncluded: new Set(),
      dupBatchExcluded: new Set(),
      dupBatchForcedIncluded: new Set(),
      operation: {
        active: false,
        label: "",
        detail: "",
        completed: 0,
        total: 0,
        abortable: false,
        abortRequested: false,
        warning: "",
      },
      scheduled: false,
      duplicateGroupsDirty: true,
    };

    function refreshMultiDerivedState() {
      state.multiFileScenes = analysis.findMultiFileScenes(state.allScenes);

      const validMultiIds = new Set(state.multiFileScenes.map(scene => helpers.idKey(scene.id)));
      Object.keys(state.multiKeepers).forEach(sceneId => {
        if (!validMultiIds.has(sceneId)) delete state.multiKeepers[sceneId];
      });
      state.multiFileScenes.forEach(scene => {
        const selectedId = state.multiKeepers[helpers.idKey(scene.id)];
        if (selectedId && !(scene.files || []).some(file => helpers.idKey(file.id) === selectedId)) {
          delete state.multiKeepers[helpers.idKey(scene.id)];
        }
      });
      state.multiBatchExcluded = new Set([...state.multiBatchExcluded].filter(sceneId => validMultiIds.has(sceneId)));
      state.multiBatchForcedIncluded = new Set([...state.multiBatchForcedIncluded].filter(sceneId => {
        const scene = state.multiFileScenes.find(item => helpers.idKey(item.id) === sceneId);
        return scene && analysis.hasLargeDurationMismatch(scene, state.settings);
      }));
    }

    function refreshDuplicateSelections() {
      const dupMap = new Map(state.dupGroups.map(group => [group.key, group]));
      Object.keys(state.duplicateKeepers).forEach(groupKey => {
        const group = dupMap.get(groupKey);
        if (!group || !group.scenes.some(scene => helpers.idKey(scene.id) === state.duplicateKeepers[groupKey])) {
          delete state.duplicateKeepers[groupKey];
        }
      });
      state.dupBatchExcluded = new Set([...state.dupBatchExcluded].filter(groupKey => dupMap.has(groupKey)));
      state.dupBatchForcedIncluded = new Set([...state.dupBatchForcedIncluded].filter(groupKey => {
        const group = dupMap.get(groupKey);
        return group && isGroupUnsafe(group);
      }));
    }

    function markDuplicateGroupsDirty() {
      state.duplicateGroupsDirty = true;
    }

    function getSelectedMultiFile(scene) {
      const sceneKey = helpers.idKey(scene.id);
      if (Object.prototype.hasOwnProperty.call(state.multiKeepers, sceneKey)) {
        const selectedId = state.multiKeepers[sceneKey];
        if (selectedId === null) return null;
        return (scene.files || []).find(file => helpers.idKey(file.id) === selectedId) || null;
      }
      return analysis.pickBestFile(scene.files, state.settings);
    }

    function getSelectedDuplicateScene(group) {
      if (Object.prototype.hasOwnProperty.call(state.duplicateKeepers, group.key)) {
        const selectedId = state.duplicateKeepers[group.key];
        if (selectedId === null) return null;
        return group.scenes.find(scene => helpers.idKey(scene.id) === selectedId) || null;
      }
      return analysis.bestScene(group.scenes, state.settings);
    }

    function isSceneBatchIncluded(scene) {
      const sceneKey = helpers.idKey(scene.id);
      if (state.multiBatchExcluded.has(sceneKey)) return false;
      if (analysis.hasLargeDurationMismatch(scene, state.settings)) return state.multiBatchForcedIncluded.has(sceneKey);
      return true;
    }

    function isGroupUnsafe(group) {
      return analysis.hasUnsafeDuplicateGroup(group, state.settings);
    }

    function isGroupIncluded(group) {
      const key = group.key;
      if (state.dupBatchExcluded.has(key)) return false;
      if (state.settings.autoExcludeDuplicateUnsafe && isGroupUnsafe(group)) return state.dupBatchForcedIncluded.has(key);
      return true;
    }

    async function refreshDuplicateGroups(force) {
      if (!force && !state.duplicateGroupsDirty) return;
      if (state.settings.duplicateFinderMode === "legacy") {
        state.dupGroups = analysis.sortDuplicateGroups(
          analysis.findLegacyDuplicateScenes(state.allScenes, state.settings)
        );
      } else {
        let phashGroups = [];
        try {
          const rawGroups = await api.fetchDuplicateSceneGroups(state.settings.phashDistance);
          phashGroups = rawGroups
            .map(cluster => analysis.makeDuplicateGroup(cluster, "phash"))
            .filter(group => group.scenes.length > 1);
        } catch (error) {
          console.warn("[DupeFinder] pHash duplicate lookup failed, falling back to local pHash grouping", error);
          phashGroups = analysis.findPhashDuplicateScenes(state.allScenes, state.settings);
        }

        const fallbackScenes = state.allScenes.filter(scene => !analysis.sceneHasPhash(scene, state.settings));
        const legacyGroups = state.settings.useLegacyWhenNoPhash
          ? analysis.findLegacyDuplicateScenes(fallbackScenes, state.settings)
          : [];
        state.dupGroups = analysis.sortDuplicateGroups(phashGroups.concat(legacyGroups));
      }
      state.duplicateGroupsDirty = false;
      refreshDuplicateSelections();
    }

    async function refreshDerivedState(forceDuplicateRefresh) {
      refreshMultiDerivedState();
      if (forceDuplicateRefresh) await refreshDuplicateGroups(true);
    }

    function removeSceneFromState(sceneId) {
      const sceneKey = helpers.idKey(sceneId);
      state.allScenes = state.allScenes.filter(scene => helpers.idKey(scene.id) !== sceneKey);
      delete state.multiKeepers[sceneKey];
      state.multiBatchExcluded.delete(sceneKey);
      state.multiBatchForcedIncluded.delete(sceneKey);
      state.dupGroups = state.dupGroups
        .map(group => ({ ...group, scenes: group.scenes.filter(scene => helpers.idKey(scene.id) !== sceneKey) }))
        .filter(group => group.scenes.length > 1);
      markDuplicateGroupsDirty();
      refreshMultiDerivedState();
      refreshDuplicateSelections();
    }

    function refreshCleanedSceneState(sceneId, keeperFileId) {
      const sceneKey = helpers.idKey(sceneId);
      const fileKey = helpers.idKey(keeperFileId);
      state.allScenes = state.allScenes.map(scene => {
        if (helpers.idKey(scene.id) !== sceneKey) return scene;
        const keeperFile = (scene.files || []).find(file => helpers.idKey(file.id) === fileKey);
        if (!keeperFile) return scene;
        return { ...scene, files: [keeperFile] };
      });
      delete state.multiKeepers[sceneKey];
      state.multiBatchExcluded.delete(sceneKey);
      state.multiBatchForcedIncluded.delete(sceneKey);
      markDuplicateGroupsDirty();
      refreshMultiDerivedState();
    }

    function refreshMergedGroupState(group, keeperScene) {
      const keeperKey = helpers.idKey(keeperScene.id);
      const sourceIds = new Set(group.scenes.filter(scene => helpers.idKey(scene.id) !== keeperKey).map(scene => helpers.idKey(scene.id)));
      let keeperUpdated = false;
      state.allScenes = state.allScenes
        .filter(scene => !sourceIds.has(helpers.idKey(scene.id)))
        .map(scene => {
          if (helpers.idKey(scene.id) !== keeperKey) return scene;
          keeperUpdated = true;
          return keeperScene;
        });
      if (!keeperUpdated) state.allScenes.push(keeperScene);
      sourceIds.forEach(sceneId => {
        delete state.multiKeepers[sceneId];
        state.multiBatchExcluded.delete(sceneId);
        state.multiBatchForcedIncluded.delete(sceneId);
      });
      delete state.duplicateKeepers[group.key];
      state.dupBatchExcluded.delete(group.key);
      state.dupBatchForcedIncluded.delete(group.key);
      state.dupGroups = state.dupGroups.filter(item => item.key !== group.key);
      refreshMultiDerivedState();
      refreshDuplicateSelections();
    }

    function buildSplitSceneInput(file) {
      return {
        organized: false,
        title: helpers.fileName(file),
      };
    }

    function refreshSplitSceneState(originalSceneId, updatedScene, createdScenes) {
      const sceneKey = helpers.idKey(originalSceneId);
      const createdKeys = new Set((createdScenes || []).map(scene => helpers.idKey(scene.id)));
      const nextScenes = [];
      state.allScenes.forEach(scene => {
        if (createdKeys.has(helpers.idKey(scene.id))) return;
        if (helpers.idKey(scene.id) !== sceneKey) {
          nextScenes.push(scene);
          return;
        }
        if (updatedScene) nextScenes.push(updatedScene);
      });
      state.allScenes = nextScenes.concat(createdScenes || []);
      delete state.multiKeepers[sceneKey];
      state.multiBatchExcluded.delete(sceneKey);
      state.multiBatchForcedIncluded.delete(sceneKey);
      markDuplicateGroupsDirty();
      refreshMultiDerivedState();
    }

    async function executeKeepScene(scene, keeper, extraFiles) {
      await api.setScenePrimaryFile(scene.id, keeper.id);
      await api.deleteFiles(extraFiles.map(file => file.id));
      refreshCleanedSceneState(scene.id, keeper.id);
    }

    async function executeMergeGroup(group, keeper, sources) {
      const mergedKeeper = await actions.mergeDuplicateGroup(api, keeper, sources);
      refreshMergedGroupState(group, mergedKeeper);
    }

    async function executeSplitScene(scene, keeper, splitFiles) {
      if (keeper) {
        await api.setScenePrimaryFile(scene.id, keeper.id);
      } else if (splitFiles.length) {
        // Move the temporary primary file last so the original scene remains valid
        // until every other file has been assigned to its new scene.
        await api.setScenePrimaryFile(scene.id, splitFiles[splitFiles.length - 1].id);
      }
      const createdScenes = [];
      const failures = [];
      let updatedScene = scene;
      let originalRemoved = false;
      for (const file of splitFiles) {
        let createdSceneId = null;
        let assigned = false;
        try {
          const created = await api.createScene(buildSplitSceneInput(file));
          if (!created) throw new Error("Scene creation returned no scene");
          createdSceneId = created.id;
          await api.assignSceneFile(created.id, file.id);
          assigned = true;
          try {
            createdScenes.push(await api.fetchScene(created.id));
          } catch (_) {
            createdScenes.push({ ...created, files: [file] });
          }
        } catch (error) {
          if (createdSceneId && !assigned) {
            try {
              await api.destroyScene(createdSceneId, false);
            } catch (_) {
              // Ignore cleanup failures and surface the original split error below.
            }
          }
          failures.push(`${helpers.fileName(file)}: ${error.message}`);
        }
      }

      if (!keeper && !failures.length) {
        try {
          await api.destroyScene(scene.id, false);
          originalRemoved = true;
          updatedScene = null;
        } catch (error) {
          failures.push(`Original scene cleanup: ${error.message}`);
        }
      }

      if (!originalRemoved) {
        try {
          updatedScene = await api.fetchScene(scene.id);
        } catch (_) {
          updatedScene = keeper ? { ...scene, files: [keeper] } : scene;
        }
      }
      refreshSplitSceneState(scene.id, updatedScene, createdScenes);
      if (failures.length) {
        throw new Error(`Split completed with ${failures.length} failure(s): ${failures.join(" | ")}`);
      }
    }

    async function runKeepScene(scene, withBusyOperation, updateBusyOperation, showTab) {
      const keeper = getSelectedMultiFile(scene);
      const extraFiles = keeper
        ? (scene.files || []).filter(file => helpers.idKey(file.id) !== helpers.idKey(keeper.id))
        : [];
      if (!keeper) {
        ui.toast(`Select a keep file for scene #${scene.id}`, "#56b6c2");
        return;
      }
      if (!extraFiles.length) {
        ui.toast(`Scene #${scene.id} already only has the selected keep file`, "#56b6c2");
        return;
      }

      if (state.dryRun) {
        ui.previewAction(`Keep selected file for scene ${helpers.sceneName(scene)}`, [
          `Would keep: ${helpers.filePathLabel(keeper)}`,
          "",
          `Would delete ${extraFiles.length} other file(s):`,
          ...extraFiles.map(file => `- ${helpers.filePathLabel(file)}`),
        ]);
        return;
      }

      if (!confirm(
        `Keep only the selected file for "${helpers.sceneName(scene)}"?\n\n` +
        `Keep:\n- ${helpers.fileName(keeper)}\n\n` +
        `Delete from disk:\n${extraFiles.map(file => `- ${helpers.fileName(file)}`).join("\n")}`
      )) return;

      try {
        await withBusyOperation({
          label: "Keeping selected file…",
          detail: `Scene #${scene.id} ${helpers.sceneName(scene)}`,
          total: 1,
        }, async () => {
          await executeKeepScene(scene, keeper, extraFiles);
          updateBusyOperation({ completed: 1 });
        });
        showTab(state.currentTab);
        ui.toast(`Kept selected file for scene #${scene.id}`, "#98c379");
      } catch (e) {
        ui.toast(`Cleanup error: ${e.message}`, "#e06c75");
      }
    }

    async function runSplitScene(scene, withBusyOperation, updateBusyOperation, showTab) {
      const keeper = getSelectedMultiFile(scene);
      const splitFiles = keeper
        ? (scene.files || []).filter(file => helpers.idKey(file.id) !== helpers.idKey(keeper.id))
        : [...(scene.files || [])];
      if (!splitFiles.length || (!keeper && splitFiles.length < 2)) {
        ui.toast(`Scene #${scene.id} does not have enough files to split`, "#56b6c2");
        return;
      }

      if (!(await api.canSplitScenes())) {
        ui.toast("Split requires a Stash server that supports sceneCreate and sceneAssignFile.", "#e06c75");
        return;
      }

      if (state.dryRun) {
        const lines = keeper
          ? [
              `Original scene keeps: ${helpers.filePathLabel(keeper)}`,
              "",
              `Would create ${splitFiles.length} new scene(s) without copied metadata:`,
            ]
          : [
              "No keep file selected; the original scene and its metadata would be removed.",
              "",
              `Would create ${splitFiles.length} new scene(s) without copied metadata:`,
            ];
        ui.previewAction(`Split scene ${helpers.sceneName(scene)}`, lines.concat(
          splitFiles.map(file => `- ${helpers.filePathLabel(file)}`)
        ));
        return;
      }

      const confirmation = keeper
        ? `Split "${helpers.sceneName(scene)}" into ${splitFiles.length + 1} scene(s)?\n\n` +
          `The current scene will keep:\n- ${helpers.fileName(keeper)}\n\n` +
          `Each other file will become its own new scene with no copied metadata:\n${splitFiles.map(file => `- ${helpers.fileName(file)}`).join("\n")}`
        : `Split every file from "${helpers.sceneName(scene)}" into ${splitFiles.length} new scenes?\n\n` +
          `No keep file is selected. The original scene and its metadata will be removed, and every file will become a new scene with no copied metadata:\n${splitFiles.map(file => `- ${helpers.fileName(file)}`).join("\n")}`;
      if (!confirm(confirmation)) return;

      try {
        await withBusyOperation({
          label: "Splitting multi-file scene…",
          detail: `Scene #${scene.id} ${helpers.sceneName(scene)}`,
          total: splitFiles.length,
        }, async () => {
          await executeSplitScene(scene, keeper, splitFiles);
          updateBusyOperation({ completed: splitFiles.length });
        });
        await showTab(state.currentTab);
        ui.toast(`Split scene #${scene.id} into ${splitFiles.length + (keeper ? 1 : 0)} scene(s)`, "#c678dd");
      } catch (e) {
        ui.toast(`Split error: ${e.message}`, "#e06c75");
      }
    }

    async function runMergeGroup(group, withBusyOperation, updateBusyOperation, showTab) {
      const keeper = getSelectedDuplicateScene(group);
      const sources = keeper
        ? group.scenes.filter(scene => helpers.idKey(scene.id) !== helpers.idKey(keeper.id))
        : [];
      const sourceFiles = sources.flatMap(scene => scene.files || []);
      const keepTitle = helpers.sceneName(keeper);
      if (!sources.length) {
        ui.toast(`Nothing left to merge for ${keepTitle}`, "#56b6c2");
        return;
      }

      if (state.dryRun) {
        ui.previewAction(`Merge duplicates into ${keepTitle}`, [
          `Would keep destination scene: ${keeper.title ? `#${keeper.id} ${keepTitle}` : keepTitle}`,
          "",
          `Would merge ${sources.length} source scene(s):`,
          ...sources.map(scene => `- ${scene.title ? `#${scene.id} ${helpers.sceneName(scene)}` : helpers.sceneName(scene)}`),
          "",
          `Would delete ${sourceFiles.length} source file(s) from disk:`,
          ...sourceFiles.map(file => `- ${helpers.filePathLabel(file)}`),
        ]);
        return;
      }

      if (!confirm(
        `Merge ${sources.length} scene(s) into the selected keep scene "${keepTitle}"?\n\n` +
        `Metadata will be combined, then ${sourceFiles.length} file(s) from the source scenes will be deleted from disk. ` +
        `Only the selected keep scene and its existing file(s) will remain.`
      )) return;

      try {
        await withBusyOperation({
          label: "Merging duplicate group…",
          detail: `Keep #${keeper.id} ${keepTitle}`,
          total: 1,
        }, async () => {
          await executeMergeGroup(group, keeper, sources);
          updateBusyOperation({ completed: 1 });
        });
        showTab(state.currentTab);
        ui.toast(`Merged ${sources.length} scene(s) into #${keeper.id}`, "#61afef");
      } catch (e) {
        ui.toast(`Merge error: ${e.message}`, "#e06c75");
      }
    }

    function openModal() {
      if (document.getElementById(constants.MODAL_ID)) return;

      const overlay = ui.el("div", STYLE.overlay);
      overlay.id = constants.MODAL_ID;
      overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);

      const modal = ui.el("div", STYLE.modal);
      overlay.appendChild(modal);

      const header = ui.el("div", STYLE.header);
      header.style.display = "grid";
      header.style.gridTemplateColumns = "minmax(0,1fr) auto minmax(0,1fr)";
      header.style.alignItems = "center";
      const titleEl = ui.el("span", "color:#e5c07b;font-weight:700;font-size:1.1em;justify-self:start;align-self:center;white-space:nowrap;", "🔍 DupeFinder");
      const controls = ui.el("div", "display:flex;align-items:center;align-self:center;justify-content:center;gap:18px;flex-wrap:nowrap;");
      const headerActions = ui.el("div", "display:flex;align-items:center;align-self:center;justify-self:end;gap:10px;");
      const headerSelectStyle = "box-sizing:border-box;width:110px;height:38px;background:#2c313a;border:1px solid #3e4451;color:#abb2bf;border-radius:4px;padding:0 10px;font-size:0.8em;";

      const duplicateModeSelect = document.createElement("select");
      [
        { value: "phash", label: "pHash" },
        { value: "legacy", label: "Legacy" },
      ].forEach(option => {
        const opt = document.createElement("option");
        opt.value = option.value;
        opt.textContent = option.label;
        duplicateModeSelect.appendChild(opt);
      });
      duplicateModeSelect.style.cssText = headerSelectStyle;
      duplicateModeSelect.setAttribute("aria-label", "Duplicate finder mode");

      const phashDistanceSelect = document.createElement("select");
      constants.PHASH_DISTANCE_PRESETS.forEach(option => {
        const opt = document.createElement("option");
        opt.value = option.value;
        opt.textContent = option.label;
        phashDistanceSelect.appendChild(opt);
      });
      phashDistanceSelect.style.cssText = headerSelectStyle;
      phashDistanceSelect.setAttribute("aria-label", "pHash distance");

      function syncHeaderSettingsControls() {
        duplicateModeSelect.value = state.settings.duplicateFinderMode;
        phashDistanceSelect.value = state.settings.phashDistanceMode;
        phashDistanceSelect.style.display = state.settings.duplicateFinderMode === "phash" ? "block" : "none";
      }

      async function reloadAfterSettingsChange(message) {
        syncHeaderSettingsControls();
        markDuplicateGroupsDirty();
        if (state.loaded) {
          await refreshDerivedState(true);
          await showTab(state.currentTab);
        }
        ui.toast(message, "#56b6c2");
      }

      async function saveAndReloadSettings(raw, message) {
        state.settings = settingsStore.save({ ...state.settings, ...raw });
        await reloadAfterSettingsChange(message);
      }

      async function changeHeaderSettings(raw) {
        duplicateModeSelect.disabled = true;
        phashDistanceSelect.disabled = true;
        try {
          await saveAndReloadSettings(raw, "Duplicate settings updated");
        } catch (error) {
          ui.toast(`Settings error: ${error.message}`, "#e06c75");
          syncHeaderSettingsControls();
        } finally {
          duplicateModeSelect.disabled = false;
          phashDistanceSelect.disabled = false;
        }
      }

      duplicateModeSelect.addEventListener("change", () => changeHeaderSettings({ duplicateFinderMode: duplicateModeSelect.value }));
      phashDistanceSelect.addEventListener("change", () => changeHeaderSettings({ phashDistanceMode: phashDistanceSelect.value }));
      syncHeaderSettingsControls();

      const closeBtn = ui.mkBtn("✕", "#3e4451", () => overlay.remove());
      closeBtn.setAttribute("aria-label", "Close DupeFinder");
      closeBtn.title = "Close";
      const settingsBtn = ui.mkBtn("⚙", "#56b6c2", () => {
        if (settingsOverlay && settingsOverlay.isConnected) return;
        settingsOverlay = tables.renderSettingsModal({
          settings: state.settings,
          async onSave(raw) {
            await saveAndReloadSettings(raw, "Settings saved");
          },
          async onReset() {
            state.settings = settingsStore.reset();
            await reloadAfterSettingsChange("Settings reset to defaults");
          },
          onClose() {
            if (settingsOverlay && settingsOverlay.parentNode) settingsOverlay.remove();
          },
        });
        modal.appendChild(settingsOverlay);
      });
      settingsBtn.title = "Settings";
      settingsBtn.setAttribute("aria-label", "Open DupeFinder settings");
      [settingsBtn, closeBtn].forEach(btn => {
        btn.style.display = "inline-flex";
        btn.style.alignItems = "center";
        btn.style.justifyContent = "center";
        btn.style.boxSizing = "border-box";
        btn.style.width = "38px";
        btn.style.height = "38px";
        btn.style.padding = "0";
        btn.style.lineHeight = "1";
      });
      settingsBtn.style.fontSize = "1.3em";
      closeBtn.style.fontSize = "1em";
      modal.appendChild(header);
      header.appendChild(titleEl);

      const tabBar = ui.el("div", STYLE.tabs);
      modal.appendChild(tabBar);

      const body = ui.el("div", STYLE.body);
      modal.appendChild(body);
      const loadingEl = ui.el("div", STYLE.hintText + "padding:40px 0;text-align:center;font-size:0.9em;", "Loading scenes… 0 / ?");
      body.appendChild(loadingEl);

      let settingsOverlay = null;
      const busyOverlay = ui.el("div", "position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(33,37,43,0.82);z-index:4;padding:20px;");
      const busyPanel = ui.el("div", "background:#2c313a;border:1px solid #3e4451;border-radius:8px;padding:18px 20px;min-width:320px;max-width:520px;box-shadow:0 8px 32px rgba(0,0,0,0.45);");
      const busyTitleEl = ui.el("div", "color:#e5c07b;font-weight:700;font-size:1em;");
      const busyProgressEl = ui.el("div", "color:#abb2bf;font-size:0.88em;margin-top:8px;");
      const busyWarningEl = ui.el("div", "color:#e5c07b;font-size:0.8em;margin-top:10px;line-height:1.4;");
      busyOverlay.setAttribute("role", "dialog");
      busyOverlay.setAttribute("aria-modal", "true");
      busyOverlay.setAttribute("aria-labelledby", "df-busy-title");
      busyOverlay.setAttribute("aria-describedby", "df-busy-progress df-busy-warning");
      busyTitleEl.id = "df-busy-title";
      busyProgressEl.id = "df-busy-progress";
      busyWarningEl.id = "df-busy-warning";
      busyProgressEl.setAttribute("aria-live", "polite");
      busyWarningEl.setAttribute("aria-live", "assertive");
      const busyAbortBtn = ui.mkBtn("Abort remaining items", "#e5c07b", () => {
        if (!state.operation.abortable || state.operation.abortRequested) return;
        if (!confirm("Abort the remaining batch items after the current item finishes?\n\nAlready completed actions will NOT be undone.")) return;
        state.operation.abortRequested = true;
        renderBusyState();
      });
      busyAbortBtn.style.marginTop = "14px";
      busyAbortBtn.style.color = "#21252b";
      busyPanel.append(busyTitleEl, busyProgressEl, busyWarningEl, busyAbortBtn);
      busyOverlay.appendChild(busyPanel);
      modal.appendChild(busyOverlay);

      function updateTitle() {
        titleEl.textContent = state.batchMode ? `🔍 DupeFinder — ${state.currentTab === "multi" ? "Multi-file" : "Duplicates"} batch mode` : "🔍 DupeFinder";
      }

      function renderBusyState() {
        busyOverlay.style.display = state.operation.active ? "flex" : "none";
        if (!state.operation.active) return;
        busyTitleEl.textContent = state.operation.label || "Working…";
        const progressText = state.operation.total
          ? `${Math.min(state.operation.completed, state.operation.total)} / ${state.operation.total} completed`
          : "Please wait…";
        busyProgressEl.textContent = state.operation.detail ? `${progressText} — ${state.operation.detail}` : progressText;
        const warningText = state.operation.abortRequested
          ? `Abort requested. The current item will finish first, then the batch will stop. ${state.operation.warning || ""}`.trim()
          : (state.operation.warning || "");
        busyWarningEl.textContent = warningText;
        busyWarningEl.style.display = warningText ? "block" : "none";
        busyAbortBtn.style.display = state.operation.abortable ? "inline-block" : "none";
        busyAbortBtn.disabled = state.operation.abortRequested;
        busyAbortBtn.textContent = state.operation.abortRequested ? "Abort requested…" : "Abort remaining items";
      }

      function startBusyOperation(config) {
        state.operation.active = true;
        state.operation.label = config.label || "Working…";
        state.operation.detail = config.detail || "";
        state.operation.completed = config.completed || 0;
        state.operation.total = config.total || 0;
        state.operation.abortable = !!config.abortable;
        state.operation.abortRequested = false;
        state.operation.warning = config.warning || "";
        renderBusyState();
      }

      function updateBusyOperation(next) {
        Object.assign(state.operation, next || {});
        renderBusyState();
      }

      function finishBusyOperation() {
        state.operation.active = false;
        state.operation.abortable = false;
        state.operation.abortRequested = false;
        renderBusyState();
      }

      async function withBusyOperation(config, fn) {
        startBusyOperation(config || {});
        try {
          return await fn();
        } finally {
          finishBusyOperation();
        }
      }

      async function runDeleteScene(scene) {
        if (state.dryRun) {
          ui.previewAction(`Delete scene ${helpers.sceneName(scene)}`, [
            `Would delete scene #${scene.id} and ${(scene.files || []).length} file(s) from disk:`,
            ...(scene.files || []).map(f => `- ${helpers.fileName(f)}`),
          ]);
          return;
        }
        if (!confirm(`Delete scene "${helpers.sceneName(scene)}" and ALL its files from disk?`)) return;
        try {
          await api.destroyScene(scene.id, true);
          removeSceneFromState(scene.id);
          showTab(state.currentTab);
          ui.toast(`Deleted scene #${scene.id}`, "#e06c75");
        } catch (e) {
          ui.toast(`Error: ${e.message}`, "#e06c75");
        }
      }

      function multiKeepBatchPlans() {
        return state.multiFileScenes
          .filter(scene => isSceneBatchIncluded(scene))
          .map(scene => {
            const keeper = getSelectedMultiFile(scene);
            return {
              scene,
              keeper,
              extraFiles: (scene.files || []).filter(file => keeper && helpers.idKey(file.id) !== helpers.idKey(keeper.id)),
            };
          })
          .filter(plan => plan.keeper && plan.extraFiles.length);
      }

      function multiSplitBatchPlans() {
        return state.multiFileScenes
          .filter(scene => isSceneBatchIncluded(scene))
          .map(scene => {
            const keeper = getSelectedMultiFile(scene);
            const splitFiles = keeper
              ? (scene.files || []).filter(file => helpers.idKey(file.id) !== helpers.idKey(keeper.id))
              : [...(scene.files || [])];
            return { scene, keeper, splitFiles };
          })
          .filter(plan => plan.splitFiles.length >= (plan.keeper ? 1 : 2));
      }

      async function runMultiKeepBatch() {
        const plans = multiKeepBatchPlans();

        if (!plans.length) {
          ui.toast("No included multi-file scenes have a selected keep file", "#56b6c2");
          return;
        }

        if (state.dryRun) {
          const lines = [];
          plans.forEach(plan => {
            lines.push(`Scene #${plan.scene.id} ${helpers.sceneName(plan.scene)}`);
            lines.push(`Keep: ${helpers.filePathLabel(plan.keeper)}`);
            lines.push(`Delete ${plan.extraFiles.length} file(s):`);
            plan.extraFiles.forEach(file => lines.push(`- ${helpers.filePathLabel(file)}`));
            lines.push("");
          });
          ui.previewAction(`Batch keep for ${plans.length} scene(s)`, lines);
          return;
        }

        const totalDeleted = plans.reduce((count, plan) => count + plan.extraFiles.length, 0);
        if (!confirm(`Apply keep to ${plans.length} multi-file scene(s)?\n\nThis will keep the selected file for each scene and delete ${totalDeleted} other file(s) from disk.`)) return;

        try {
          let completed = 0;
          let aborted = false;
          await withBusyOperation({
            label: "Running batch keep…",
            total: plans.length,
            abortable: true,
            warning: "Aborting only stops after the current scene finishes. Files already deleted from completed scenes are not restored.",
          }, async () => {
            for (const plan of plans) {
              if (state.operation.abortRequested) break;
              updateBusyOperation({ detail: `Scene #${plan.scene.id} ${helpers.sceneName(plan.scene)}`, completed });
              await executeKeepScene(plan.scene, plan.keeper, plan.extraFiles);
              completed++;
              updateBusyOperation({ completed });
            }
            aborted = state.operation.abortRequested;
          });
          showTab(state.currentTab);
          if (aborted) ui.toast(`Batch keep aborted after ${completed} of ${plans.length} scene(s). Completed actions were not undone.`, "#e5c07b");
          else ui.toast(`Kept selected files for ${completed} scene(s)`, "#98c379");
        } catch (e) {
          showTab(state.currentTab);
          ui.toast(`Batch keep error: ${e.message}`, "#e06c75");
        }
      }

      async function runMultiSplitBatch() {
        const plans = multiSplitBatchPlans();
        if (!plans.length) {
          ui.toast("No multi-file scenes are currently available to split in the batch", "#56b6c2");
          return;
        }

        if (!(await api.canSplitScenes())) {
          ui.toast("Split requires a Stash server that supports sceneCreate and sceneAssignFile.", "#e06c75");
          return;
        }

        if (state.dryRun) {
          const lines = [];
          plans.forEach(plan => {
            lines.push(`Scene #${plan.scene.id} ${helpers.sceneName(plan.scene)}`);
            if (plan.keeper) lines.push(`Original keeps: ${helpers.filePathLabel(plan.keeper)}`);
            else lines.push("No keep selected: remove the original scene and its metadata");
            lines.push(`Create ${plan.splitFiles.length} scene(s) without copied metadata:`);
            plan.splitFiles.forEach(file => lines.push(`- ${helpers.filePathLabel(file)}`));
            lines.push("");
          });
          ui.previewAction(`Batch split for ${plans.length} scene(s)`, lines);
          return;
        }

        const newSceneCount = plans.reduce((count, plan) => count + plan.splitFiles.length, 0);
        const removedOriginalCount = plans.filter(plan => !plan.keeper).length;
        const removalWarning = removedOriginalCount
          ? ` ${removedOriginalCount} original scene(s) with no keep selection and their metadata will be removed.`
          : "";
        if (!confirm(
          `Split ${plans.length} multi-file scene(s) into individual files?\n\n` +
          `This will create ${newSceneCount} new scene(s) without copied metadata.${removalWarning}`
        )) return;

        try {
          let completed = 0;
          let aborted = false;
          await withBusyOperation({
            label: "Running batch split…",
            total: plans.length,
            abortable: true,
            warning: "Aborting only stops after the current scene finishes. Scenes already split are not restored.",
          }, async () => {
            for (const plan of plans) {
              if (state.operation.abortRequested) break;
              updateBusyOperation({ detail: `Scene #${plan.scene.id} ${helpers.sceneName(plan.scene)}`, completed });
              await executeSplitScene(plan.scene, plan.keeper, plan.splitFiles);
              completed++;
              updateBusyOperation({ completed });
            }
            aborted = state.operation.abortRequested;
          });
          showTab(state.currentTab);
          if (aborted) ui.toast(`Batch split aborted after ${completed} of ${plans.length} scene(s). Completed splits were not undone.`, "#e5c07b");
          else ui.toast(`Split ${completed} multi-file scene(s)`, "#c678dd");
        } catch (e) {
          showTab(state.currentTab);
          ui.toast(`Batch split error: ${e.message}`, "#e06c75");
        }
      }

      async function runDuplicateBatch() {
        const includedGroupKeys = state.dupGroups.filter(group => isGroupIncluded(group)).map(group => group.key);
        const previewPlans = includedGroupKeys
          .map(groupKey => state.dupGroups.find(group => group.key === groupKey))
          .filter(Boolean)
          .map(group => {
            const keeper = getSelectedDuplicateScene(group);
            return {
              group,
              keeper,
              sources: group.scenes.filter(scene => keeper && helpers.idKey(scene.id) !== helpers.idKey(keeper.id)),
            };
          })
          .filter(plan => plan.keeper && plan.sources.length);

        if (!previewPlans.length) {
          ui.toast("No duplicate groups are currently included in the batch", "#56b6c2");
          return;
        }

        if (state.dryRun) {
          const lines = [];
          previewPlans.forEach(plan => {
            lines.push(`Keep: #${plan.keeper.id} ${helpers.sceneName(plan.keeper)}`);
            lines.push(`Merge ${plan.sources.length} source scene(s):`);
            plan.sources.forEach(scene => lines.push(`- #${scene.id} ${helpers.sceneName(scene)}`));
            const sourceFiles = plan.sources.flatMap(scene => scene.files || []);
            lines.push(`Delete ${sourceFiles.length} source file(s) from disk:`);
            sourceFiles.forEach(file => lines.push(`- ${helpers.filePathLabel(file)}`));
            lines.push("");
          });
          ui.previewAction(`Batch merge for ${previewPlans.length} duplicate group(s)`, lines);
          return;
        }

        const totalSources = previewPlans.reduce((count, plan) => count + plan.sources.length, 0);
        const totalSourceFiles = previewPlans.reduce(
          (count, plan) => count + plan.sources.reduce((fileCount, scene) => fileCount + (scene.files || []).length, 0),
          0
        );
        if (!confirm(`Merge ${previewPlans.length} duplicate group(s) into their selected keep scenes?\n\nMetadata will be combined, then ${totalSources} source scene(s) and ${totalSourceFiles} source file(s) will be permanently removed. Only each selected keep scene and its existing files will remain.`)) return;

        try {
          let merged = 0;
          let aborted = false;
          await withBusyOperation({
            label: "Running batch merge…",
            total: previewPlans.length,
            abortable: true,
            warning: "Aborting only stops after the current group finishes. Merges and source-file deletions already completed before the abort are not undone.",
          }, async () => {
            for (const groupKey of includedGroupKeys) {
              if (state.operation.abortRequested) break;
              const currentGroup = state.dupGroups.find(group => group.key === groupKey);
              if (!currentGroup) continue;
              const keeper = getSelectedDuplicateScene(currentGroup);
              const sources = currentGroup.scenes.filter(scene => helpers.idKey(scene.id) !== helpers.idKey(keeper.id));
              if (!keeper || !sources.length) continue;
              updateBusyOperation({ detail: `Keep #${keeper.id} ${helpers.sceneName(keeper)}`, completed: merged });
              await executeMergeGroup(currentGroup, keeper, sources);
              merged++;
              updateBusyOperation({ completed: merged });
            }
            aborted = state.operation.abortRequested;
          });
          showTab(state.currentTab);
          if (aborted) ui.toast(`Batch merge aborted after ${merged} of ${previewPlans.length} group(s). Completed merges were not undone.`, "#e5c07b");
          else ui.toast(`Merged ${merged} duplicate group(s)`, "#61afef");
        } catch (e) {
          showTab(state.currentTab);
          ui.toast(`Batch merge error: ${e.message}`, "#e06c75");
        }
      }

      async function showTab(tab) {
        state.currentTab = tab;
        updateTitle();
        tabBar.innerHTML = "";
        tabBar.appendChild(ui.tabBtn(`Multi-file (${state.multiFileScenes.length})`, tab === "multi", () => showTab("multi")));
        tabBar.appendChild(ui.tabBtn(`Duplicates (${state.dupGroups.length})`, tab === "dupes", () => showTab("dupes")));
        body.innerHTML = "";

        if (tab === "multi") {
          if (state.batchMode) {
            const includedCount = state.multiFileScenes.filter(scene => isSceneBatchIncluded(scene)).length;
            body.appendChild(tables.renderBatchBar({
              totalCount: state.multiFileScenes.length,
              includedCount,
              itemLabel: `scene${state.multiFileScenes.length === 1 ? "" : "s"}`,
              actions: [
                {
                  label: state.dryRun ? "👁 Preview keep" : "🧹 Keep",
                  color: "#98c379",
                  onRun: runMultiKeepBatch,
                  isDisabled: () => multiKeepBatchPlans().length === 0,
                },
                {
                  label: state.dryRun ? "👁 Preview split" : "✂ Split",
                  color: "#c678dd",
                  onRun: runMultiSplitBatch,
                  isDisabled: () => multiSplitBatchPlans().length === 0,
                },
              ],
              note: state.multiFileScenes.some(scene => analysis.hasLargeDurationMismatch(scene, state.settings))
                ? `Scenes exceeding the ${helpers.durationDiffLimitLabel(state.settings.batchDurationDiffSeconds)} maximum duration difference start excluded from the batch.`
                : "Exclude items you want to skip, then run the batch action.",
            }));
          }

          body.appendChild(tables.renderMultiFileTable(state.multiFileScenes, {
            settings: state.settings,
            dryRun: state.dryRun,
            batchMode: state.batchMode,
            isSceneIncluded: isSceneBatchIncluded,
            getSelectedFile: getSelectedMultiFile,
            onSelectFile(sceneId, fileId) {
              const sceneKey = helpers.idKey(sceneId);
              const selected = state.multiFileScenes.find(scene => helpers.idKey(scene.id) === sceneKey);
              const current = selected && getSelectedMultiFile(selected);
              state.multiKeepers[sceneKey] = current && helpers.idKey(current.id) === helpers.idKey(fileId)
                ? null
                : helpers.idKey(fileId);
              showTab(state.currentTab);
            },
            onToggleSceneBatch(sceneId) {
              const scene = state.multiFileScenes.find(item => helpers.idKey(item.id) === helpers.idKey(sceneId));
              if (!scene) return;
              const key = helpers.idKey(sceneId);
              const mismatch = analysis.hasLargeDurationMismatch(scene, state.settings);
              const included = isSceneBatchIncluded(scene);
              if (mismatch) {
                if (included) {
                  state.multiBatchExcluded.add(key);
                  state.multiBatchForcedIncluded.delete(key);
                } else {
                  const durationDiffSeconds = Math.round(analysis.sceneDurationDiffSeconds(scene));
                  if (!confirm(`This scene has file durations that differ by about ${durationDiffSeconds}s, so it starts excluded from batch mode.\n\nAdd it to the batch anyway?\n\nThe selected batch action may still delete or reassign files if you continue.`)) return;
                  state.multiBatchExcluded.delete(key);
                  state.multiBatchForcedIncluded.add(key);
                }
              } else if (state.multiBatchExcluded.has(key)) {
                state.multiBatchExcluded.delete(key);
              } else {
                state.multiBatchExcluded.add(key);
              }
              showTab(state.currentTab);
            },
            onKeepScene(scene) {
              return runKeepScene(scene, withBusyOperation, updateBusyOperation, showTab);
            },
            onSplitScene(scene) {
              return runSplitScene(scene, withBusyOperation, updateBusyOperation, showTab);
            },
          }));
        } else {
          body.innerHTML = "";
          body.appendChild(ui.el("div", STYLE.hintText + "padding:20px 0;text-align:center;font-size:0.9em;", "Loading duplicate groups…"));
          await refreshDuplicateGroups();
          if (state.currentTab !== "dupes") return;
          body.innerHTML = "";
          if (state.batchMode) {
            const includedCount = state.dupGroups.filter(group => isGroupIncluded(group)).length;
            body.appendChild(tables.renderBatchBar({
              totalCount: state.dupGroups.length,
              includedCount,
              itemLabel: `group${state.dupGroups.length === 1 ? "" : "s"}`,
              actionLabel: state.dryRun ? "👁 Preview merge" : "⚡ Merge",
              actionColor: "#61afef",
              onRun: runDuplicateBatch,
              note: state.settings.autoExcludeDuplicateUnsafe && state.dupGroups.some(group => isGroupUnsafe(group))
                ? `Duplicate groups exceeding the ${helpers.durationDiffLimitLabel(state.settings.batchDurationDiffSeconds)} maximum duration difference start excluded until confirmed.`
                : "Exclude items you want to skip, then run the batch action.",
              isDisabled: () => state.dupGroups.filter(group => isGroupIncluded(group)).length === 0,
            }));
          }

          body.appendChild(tables.renderDuplicatesTable(state.dupGroups, {
            settings: state.settings,
            dryRun: state.dryRun,
            batchMode: state.batchMode,
            isGroupIncluded,
            isGroupUnsafe,
            getSelectedScene: getSelectedDuplicateScene,
            onSelectScene(groupKey, sceneId) {
              state.duplicateKeepers[groupKey] = helpers.idKey(sceneId);
              showTab(state.currentTab);
            },
            onToggleGroupBatch(groupKey) {
              const group = state.dupGroups.find(item => item.key === groupKey);
              if (!group) return;
              const included = isGroupIncluded(group);
              const unsafe = state.settings.autoExcludeDuplicateUnsafe && isGroupUnsafe(group);
              if (unsafe) {
                if (included) {
                  state.dupBatchExcluded.add(groupKey);
                  state.dupBatchForcedIncluded.delete(groupKey);
                } else {
                  const diff = Math.round(analysis.groupDurationDiffSeconds(group, state.settings));
                  if (!confirm(`This duplicate group has scene durations differing by about ${diff}s and starts excluded from batch mode.\n\nAdd it to the batch anyway?`)) return;
                  state.dupBatchExcluded.delete(groupKey);
                  state.dupBatchForcedIncluded.add(groupKey);
                }
              } else if (state.dupBatchExcluded.has(groupKey)) {
                state.dupBatchExcluded.delete(groupKey);
              } else {
                state.dupBatchExcluded.add(groupKey);
              }
              showTab(state.currentTab);
            },
            onMergeGroup(group) {
              return runMergeGroup(group, withBusyOperation, updateBusyOperation, showTab);
            },
          }));
        }
      }

      function headerToggleButton(label, activeColor, getValue, setValue) {
        const btn = ui.mkBtn(label, "#2c313a", () => {
          setValue(!getValue());
          sync();
        });
        btn.style.border = "1px solid #5c6370";
        btn.style.fontWeight = "700";
        btn.style.letterSpacing = "0.04em";
        btn.style.boxSizing = "border-box";
        btn.style.width = "110px";
        btn.style.height = "38px";
        btn.style.padding = "0 10px";

        function sync() {
          const active = getValue();
          btn.setAttribute("aria-pressed", active ? "true" : "false");
          btn.style.background = active ? activeColor : "#2c313a";
          btn.style.borderColor = active ? activeColor : "#5c6370";
          btn.style.color = active ? "#21252b" : "#abb2bf";
          btn.style.boxShadow = active ? "inset 0 2px 4px rgba(0,0,0,0.35)" : "none";
        }

        sync();
        return btn;
      }

      const previewBtn = headerToggleButton("PREVIEW", "#e5c07b", () => state.dryRun, enabled => {
        state.dryRun = enabled;
        if (state.loaded) showTab(state.currentTab);
      });
      previewBtn.title = "Preview actions without making changes";

      const batchBtn = headerToggleButton("BATCH", "#61afef", () => state.batchMode, enabled => {
        state.batchMode = enabled;
        updateTitle();
        if (state.loaded) showTab(state.currentTab);
      });
      batchBtn.title = "Apply actions to multiple included items";

      controls.appendChild(duplicateModeSelect);
      controls.appendChild(phashDistanceSelect);
      controls.appendChild(previewBtn);
      controls.appendChild(batchBtn);
      headerActions.appendChild(settingsBtn);
      headerActions.appendChild(closeBtn);
      header.appendChild(controls);
      header.appendChild(headerActions);
      updateTitle();

      api.fetchAllScenes((loadedCount, total) => {
        if (!state.loaded && loadingEl.isConnected) loadingEl.textContent = `Loading scenes… ${loadedCount} / ${total}`;
      }).then(async scenes => {
        state.allScenes = scenes;
        await refreshDerivedState(true);
        state.loaded = true;
        await showTab("multi");
      }).catch(err => {
        body.innerHTML = "";
        body.appendChild(ui.el("div", "color:#e06c75;padding:20px 0;", `Error: ${err.message}`));
        console.error("[DupeFinder]", err);
      });
    }

    function reactTreeContainsRoute(React, node, route) {
      if (Array.isArray(node)) {
        return React.Children.toArray(node).some(child => reactTreeContainsRoute(React, child, route));
      }
      if (!React.isValidElement(node)) return false;
      if (node.props && (node.props.to === route || node.props.href === route)) return true;
      return [node.props && node.props.children, node.props && node.props.heading]
        .some(value => React.Children.toArray(value).some(child => reactTreeContainsRoute(React, child, route)));
    }

    function installStashLaunchers() {
      const pluginApi = window.PluginApi;
      if (!pluginApi || !pluginApi.patch || !pluginApi.React) {
        console.error("[DupeFinder] Stash PluginApi is unavailable; launchers were not installed");
        return;
      }

      const React = pluginApi.React;
      const { Button } = pluginApi.libraries.Bootstrap;
      const { FontAwesomeIcon } = pluginApi.libraries.ReactFontAwesome;
      const { faSearch } = pluginApi.libraries.FontAwesomeSolid;
      let defaultInitializationStarted = false;

      function HeaderLauncher() {
        const { data } = pluginApi.GQL.useConfigurationQuery();
        const [configurePlugin] = pluginApi.utils.StashService.useConfigurePlugin();
        const plugins = (data && data.configuration && data.configuration.plugins) || {};
        const pluginSettings = plugins[constants.PLUGIN_ID] || {};

        React.useEffect(() => {
          if (!data || defaultInitializationStarted ||
              Object.prototype.hasOwnProperty.call(pluginSettings, constants.SHOW_HEADER_BUTTON_SETTING)) return;
          defaultInitializationStarted = true;
          configurePlugin({
            variables: {
              plugin_id: constants.PLUGIN_ID,
              input: {
                ...pluginSettings,
                [constants.SHOW_HEADER_BUTTON_SETTING]: true,
              },
            },
          }).catch(error => {
            defaultInitializationStarted = false;
            console.warn("[DupeFinder] Could not initialize plugin settings", error);
          });
        }, [data, configurePlugin, pluginSettings]);

        if (pluginSettings[constants.SHOW_HEADER_BUTTON_SETTING] === false) return null;

        return React.createElement(Button, {
          className: "nav-utility minimal",
          "data-plugin": "dupefinder",
          onClick: openModal,
          title: "Open DupeFinder",
          "aria-label": "Open DupeFinder",
        }, React.createElement(FontAwesomeIcon, { icon: faSearch, className: "fa-icon" }));
      }

      pluginApi.patch.before("MainNavBar.UtilityItems", props => [{
        ...props,
        children: React.createElement(React.Fragment, null, props.children, React.createElement(HeaderLauncher)),
      }]);

      pluginApi.patch.before("SettingsToolsSection", props => {
        if (!reactTreeContainsRoute(React, props.children, "/sceneDuplicateChecker")) return [props];
        const { Setting } = pluginApi.components;
        const launcher = React.createElement(Setting, {
          key: "dupefinder-tools-launcher",
          heading: React.createElement(Button, { onClick: openModal }, "🔍 DupeFinder"),
          subHeading: "Find and manage duplicate and multi-file scenes.",
        });
        return [{
          ...props,
          children: React.createElement(React.Fragment, null, props.children, launcher),
        }];
      });
    }

    function schedule() {
      if (state.scheduled) return;
      state.scheduled = true;
      installStashLaunchers();
    }

    return { schedule };
  }

  root.modal = createController();
})();
