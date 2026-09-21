(function () {
  "use strict";
  const root = window.DupeFinder = window.DupeFinder || {};
  const { api, analysis, tables, settings: settingsStore, defaults, ui, helpers, constants } = root;
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
      observer: null,
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
      const selectedId = state.multiKeepers[helpers.idKey(scene.id)];
      return (scene.files || []).find(file => helpers.idKey(file.id) === selectedId) || analysis.pickBestFile(scene.files, state.settings);
    }

    function getSelectedDuplicateScene(group) {
      const selectedId = state.duplicateKeepers[group.key];
      return group.scenes.find(scene => helpers.idKey(scene.id) === selectedId) || analysis.bestScene(group.scenes, state.settings);
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
        state.dupGroups = analysis.findLegacyDuplicateScenes(state.allScenes, state.settings);
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
        const legacyGroups = analysis.findLegacyDuplicateScenes(fallbackScenes, state.settings);
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

    function buildSplitSceneInput(scene) {
      const input = {
        organized: !!scene.organized,
      };
      if (scene.title) input.title = scene.title;
      if (scene.code) input.code = scene.code;
      if (scene.details) input.details = scene.details;
      if (scene.director) input.director = scene.director;
      if (scene.date) input.date = scene.date;
      if (scene.production_date) input.production_date = scene.production_date;
      if (Array.isArray(scene.urls) && scene.urls.length) input.urls = scene.urls.filter(Boolean);
      const rating100 = helpers.toFiniteNumber(scene.rating100);
      if (rating100 !== null) input.rating100 = rating100;
      if (scene.studio && scene.studio.id) input.studio_id = String(scene.studio.id);
      if ((scene.galleries || []).length) input.gallery_ids = scene.galleries.map(gallery => String(gallery.id));
      if ((scene.performers || []).length) input.performer_ids = scene.performers.map(performer => String(performer.id));
      if ((scene.tags || []).length) input.tag_ids = scene.tags.map(tag => String(tag.id));
      if ((scene.groups || []).length) {
        input.groups = scene.groups
          .filter(item => item && item.group && item.group.id)
          .map(item => {
            const groupInput = { group_id: String(item.group.id) };
            const sceneIndex = helpers.toFiniteNumber(item.scene_index);
            if (sceneIndex !== null) groupInput.scene_index = sceneIndex;
            return groupInput;
          });
      }
      return input;
    }

    function refreshSplitSceneState(updatedScene, createdScenes) {
      const sceneKey = helpers.idKey(updatedScene.id);
      const createdKeys = new Set((createdScenes || []).map(scene => helpers.idKey(scene.id)));
      const nextScenes = [];
      state.allScenes.forEach(scene => {
        if (createdKeys.has(helpers.idKey(scene.id))) return;
        if (helpers.idKey(scene.id) !== sceneKey) {
          nextScenes.push(scene);
          return;
        }
        nextScenes.push(updatedScene);
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
      await api.mergeScenes(sources.map(scene => scene.id), keeper.id);
      const mergedKeeper = await api.fetchScene(keeper.id);
      refreshMergedGroupState(group, mergedKeeper);
    }

    async function executeSplitScene(scene, keeper, extraFiles) {
      await api.setScenePrimaryFile(scene.id, keeper.id);
      const createdScenes = [];
      const failures = [];
      let updatedScene = scene;
      for (const file of extraFiles) {
        let createdSceneId = null;
        let assigned = false;
        try {
          const created = await api.createScene(buildSplitSceneInput(scene));
          if (!created) throw new Error("Scene creation returned no scene");
          createdSceneId = created.id;
          await api.assignSceneFile(created.id, file.id);
          assigned = true;
          createdScenes.push(await api.fetchScene(created.id));
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
      try {
        updatedScene = await api.fetchScene(scene.id);
      } catch (error) {
        updatedScene = { ...scene, files: [keeper] };
      }
      refreshSplitSceneState(updatedScene, createdScenes);
      if (failures.length) {
        throw new Error(`Split completed with ${failures.length} failure(s): ${failures.join(" | ")}`);
      }
    }

    async function runKeepScene(scene, withBusyOperation, updateBusyOperation, showTab) {
      const keeper = getSelectedMultiFile(scene);
      const extraFiles = (scene.files || []).filter(file => helpers.idKey(file.id) !== helpers.idKey(keeper.id));
      if (!keeper || !extraFiles.length) {
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
      const extraFiles = (scene.files || []).filter(file => helpers.idKey(file.id) !== helpers.idKey(keeper.id));
      if (!keeper || !extraFiles.length) {
        ui.toast(`Scene #${scene.id} already only has the selected keep file`, "#56b6c2");
        return;
      }

      if (!(await api.canSplitScenes())) {
        ui.toast("Split requires a Stash server that supports sceneCreate and sceneAssignFile.", "#e06c75");
        return;
      }

      if (state.dryRun) {
        ui.previewAction(`Split scene ${helpers.sceneName(scene)}`, [
          `Original scene keeps: ${helpers.filePathLabel(keeper)}`,
          "",
          `Would create ${extraFiles.length} new scene(s):`,
          ...extraFiles.map(file => `- ${helpers.filePathLabel(file)}`),
        ]);
        return;
      }

      if (!confirm(
        `Split "${helpers.sceneName(scene)}" into ${extraFiles.length + 1} scene(s)?\n\n` +
        `The current scene will keep:\n- ${helpers.fileName(keeper)}\n\n` +
        `Each other file will become its own new scene with copied metadata:\n${extraFiles.map(file => `- ${helpers.fileName(file)}`).join("\n")}`
      )) return;

      try {
        await withBusyOperation({
          label: "Splitting multi-file scene…",
          detail: `Scene #${scene.id} ${helpers.sceneName(scene)}`,
          total: extraFiles.length,
        }, async () => {
          await executeSplitScene(scene, keeper, extraFiles);
          updateBusyOperation({ completed: extraFiles.length });
        });
        await showTab(state.currentTab);
        ui.toast(`Split scene #${scene.id} into ${extraFiles.length + 1} scene(s)`, "#c678dd");
      } catch (e) {
        ui.toast(`Split error: ${e.message}`, "#e06c75");
      }
    }

    async function runMergeGroup(group, withBusyOperation, updateBusyOperation, showTab) {
      const keeper = getSelectedDuplicateScene(group);
      const sources = group.scenes.filter(scene => helpers.idKey(scene.id) !== helpers.idKey(keeper.id));
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
        ]);
        return;
      }

      if (!confirm(
        `Merge ${sources.length} scene(s) into the selected keep scene "${keepTitle}"?\n\n` +
        `Source scenes will be removed after merge. Metadata will be combined.`
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
      const titleEl = ui.el("span", "color:#e5c07b;font-weight:700;font-size:1.1em;", "🔍 DupeFinder");
      const closeBtn = ui.mkBtn("✕", "#3e4451", () => overlay.remove());
      closeBtn.setAttribute("aria-label", "Close DupeFinder");
      const settingsBtn = ui.mkBtn("⚙", "#56b6c2", () => {
        if (settingsOverlay && settingsOverlay.isConnected) return;
        settingsOverlay = tables.renderSettingsModal({
          settings: state.settings,
          async onSave(raw) {
            state.settings = settingsStore.save(raw);
            markDuplicateGroupsDirty();
            refreshMultiDerivedState();
            if (state.loaded) await showTab(state.currentTab);
            ui.toast("Settings saved", "#56b6c2");
          },
          async onReset() {
            state.settings = settingsStore.reset();
            markDuplicateGroupsDirty();
            refreshMultiDerivedState();
            if (state.loaded) await showTab(state.currentTab);
            ui.toast("Settings reset to defaults", "#56b6c2");
          },
          onClose() {
            if (settingsOverlay && settingsOverlay.parentNode) settingsOverlay.remove();
          },
        });
        modal.appendChild(settingsOverlay);
      });
      settingsBtn.title = "Settings";
      settingsBtn.setAttribute("aria-label", "Open DupeFinder settings");
      const controls = ui.el("div", "display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-left:auto;");
      modal.appendChild(header);
      header.appendChild(titleEl);

      const tabBar = ui.el("div", STYLE.tabs);
      modal.appendChild(tabBar);

      const body = ui.el("div", STYLE.body);
      modal.appendChild(body);
      const loadingEl = ui.el("div", "color:#5c6370;padding:40px 0;text-align:center;font-size:0.9em;", "Loading scenes… 0 / ?");
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

      async function runMultiBatch() {
        const plans = state.multiFileScenes
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

        if (!plans.length) {
          ui.toast("No multi-file scenes are currently included in the batch", "#56b6c2");
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
            lines.push("");
          });
          ui.previewAction(`Batch merge for ${previewPlans.length} duplicate group(s)`, lines);
          return;
        }

        const totalSources = previewPlans.reduce((count, plan) => count + plan.sources.length, 0);
        if (!confirm(`Merge ${previewPlans.length} duplicate group(s) into their selected keep scenes?\n\n${totalSources} source scene(s) will be removed after merge and metadata will be combined.`)) return;

        try {
          let merged = 0;
          let aborted = false;
          await withBusyOperation({
            label: "Running batch merge…",
            total: previewPlans.length,
            abortable: true,
            warning: "Aborting only stops after the current group finishes. Merges already completed before the abort are not undone.",
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
              actionLabel: state.dryRun ? "👁 Preview batch keep" : "🧹 Keep selected in batch",
              actionColor: "#98c379",
              onRun: runMultiBatch,
              note: state.multiFileScenes.some(scene => analysis.hasLargeDurationMismatch(scene, state.settings))
                ? `Scenes with file durations differing by more than ${state.settings.batchDurationDiffSeconds}s start excluded from the batch.`
                : "Exclude items you want to skip, then run the batch action.",
              isDisabled: () => state.multiFileScenes.filter(scene => isSceneBatchIncluded(scene)).length === 0,
            }));
          }

          body.appendChild(tables.renderMultiFileTable(state.multiFileScenes, {
            settings: state.settings,
            dryRun: state.dryRun,
            batchMode: state.batchMode,
            isSceneIncluded: isSceneBatchIncluded,
            getSelectedFile: getSelectedMultiFile,
            onSelectFile(sceneId, fileId) {
              state.multiKeepers[helpers.idKey(sceneId)] = helpers.idKey(fileId);
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
                  if (!confirm(`This scene has file durations that differ by about ${durationDiffSeconds}s, so it starts excluded from batch mode.\n\nAdd it to the batch anyway?\n\nBatch keep will still delete the non-selected files if you continue.`)) return;
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
            onDeleteScene(scene) {
              return runDeleteScene(scene);
            },
          }));
        } else {
          body.innerHTML = "";
          body.appendChild(ui.el("div", "color:#5c6370;padding:20px 0;text-align:center;font-size:0.9em;", "Loading duplicate groups…"));
          await refreshDuplicateGroups();
          if (state.currentTab !== "dupes") return;
          body.innerHTML = "";
          if (state.batchMode) {
            const includedCount = state.dupGroups.filter(group => isGroupIncluded(group)).length;
            body.appendChild(tables.renderBatchBar({
              totalCount: state.dupGroups.length,
              includedCount,
              itemLabel: `group${state.dupGroups.length === 1 ? "" : "s"}`,
              actionLabel: state.dryRun ? "👁 Preview batch merge" : "⚡ Merge selected in batch",
              actionColor: "#61afef",
              onRun: runDuplicateBatch,
              note: state.settings.autoExcludeDuplicateUnsafe && state.dupGroups.some(group => isGroupUnsafe(group))
                ? `Duplicate groups with duration diffs over ${state.settings.batchDurationDiffSeconds}s start excluded until confirmed.`
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
            onDeleteScene(scene) {
              return runDeleteScene(scene);
            },
          }));
        }
      }

      const dryRunLabel = ui.el("label", "display:flex;align-items:center;gap:6px;color:#abb2bf;font-size:0.85em;cursor:pointer;");
      const dryRunBox = document.createElement("input");
      dryRunBox.type = "checkbox";
      dryRunBox.addEventListener("change", () => {
        state.dryRun = dryRunBox.checked;
        if (state.loaded) showTab(state.currentTab);
      });
      dryRunLabel.appendChild(dryRunBox);
      dryRunLabel.appendChild(document.createTextNode("Dry run / preview mode"));

      const batchModeLabel = ui.el("label", "display:flex;align-items:center;gap:6px;color:#abb2bf;font-size:0.85em;cursor:pointer;");
      const batchModeBox = document.createElement("input");
      batchModeBox.type = "checkbox";
      batchModeBox.addEventListener("change", () => {
        state.batchMode = batchModeBox.checked;
        updateTitle();
        if (state.loaded) showTab(state.currentTab);
      });
      batchModeLabel.appendChild(batchModeBox);
      batchModeLabel.appendChild(document.createTextNode("Batch mode"));

      controls.appendChild(dryRunLabel);
      controls.appendChild(batchModeLabel);
      controls.appendChild(settingsBtn);
      controls.appendChild(closeBtn);
      header.appendChild(controls);
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

    function injectButton() {
      if (document.getElementById(constants.BTN_ID)) return;
      const btn = document.createElement("button");
      btn.id = constants.BTN_ID;
      btn.textContent = "🔍 Dupes";
      btn.style.cssText = [
        "position:fixed;bottom:80px;left:24px;z-index:9990;",
        "background:#c678dd;color:#fff;border:none;border-radius:20px;",
        "padding:9px 16px;font-size:0.85em;font-weight:600;cursor:pointer;",
        "box-shadow:0 2px 8px rgba(0,0,0,0.4);",
      ].join("");
      btn.addEventListener("click", openModal);
      btn.addEventListener("mouseenter", () => { btn.style.background = "#d896e8"; });
      btn.addEventListener("mouseleave", () => { btn.style.background = "#c678dd"; });
      document.body.appendChild(btn);
    }

    function schedule() {
      if (state.scheduled) return;
      state.scheduled = true;

      const startObserver = () => {
        if (!document.body || state.observer) return;
        state.observer = new MutationObserver(() => {
          if (!document.getElementById(constants.BTN_ID)) injectButton();
        });
        state.observer.observe(document.body, { childList: true, subtree: true });
      };

      if (document.readyState === "complete" || document.readyState === "interactive") injectButton();
      else document.addEventListener("DOMContentLoaded", injectButton, { once: true });

      if (document.body) startObserver();
      else document.addEventListener("DOMContentLoaded", startObserver, { once: true });
    }

    return { schedule };
  }

  root.modal = createController();
})();
