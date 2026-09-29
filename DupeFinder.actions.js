(function () {
  "use strict";
  const root = window.DupeFinder = window.DupeFinder || {};

  function isEmptyScalar(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === "string" && value.trim() === "") return true;
    return false;
  }

  function firstPopulated(scenes, readValue) {
    for (let i = 0; i < scenes.length; i++) {
      const value = readValue(scenes[i]);
      if (!isEmptyScalar(value)) return value;
    }
    return undefined;
  }

  function unionBy(items, keyFor) {
    const seen = new Set();
    const result = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const key = keyFor(item);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
    return result;
  }

  function buildMergedSceneValues(keeper, sources) {
    const scenes = [keeper].concat(sources || []);
    const values = { id: String(keeper.id) };

    const title = firstPopulated(scenes, scene => scene.title);
    if (title !== undefined) values.title = title;

    const code = firstPopulated(scenes, scene => scene.code);
    if (code !== undefined) values.code = code;

    const details = firstPopulated(scenes, scene => scene.details);
    if (details !== undefined) values.details = details;

    const director = firstPopulated(scenes, scene => scene.director);
    if (director !== undefined) values.director = director;

    const date = firstPopulated(scenes, scene => scene.date);
    if (date !== undefined) values.date = date;

    const rating100 = firstPopulated(scenes, scene => scene.rating100);
    if (rating100 !== undefined) values.rating100 = rating100;

    const studioId = firstPopulated(scenes, scene => {
      if (!scene.studio || scene.studio.id === null || scene.studio.id === undefined) return null;
      return String(scene.studio.id);
    });
    if (studioId !== undefined) values.studio_id = studioId;

    values.organized = !!keeper.organized;

    const urls = unionBy(
      scenes.flatMap(scene => scene.urls || []),
      url => String(url).trim()
    );
    if (urls.length) values.urls = urls;

    const galleryIds = unionBy(
      scenes.flatMap(scene => (scene.galleries || []).map(gallery => String(gallery.id))),
      id => id
    );
    if (galleryIds.length) values.gallery_ids = galleryIds;

    const performerIds = unionBy(
      scenes.flatMap(scene => (scene.performers || []).map(performer => String(performer.id))),
      id => id
    );
    if (performerIds.length) values.performer_ids = performerIds;

    const groups = unionBy(
      scenes.flatMap(scene => scene.groups || []),
      entry => String(entry.group.id)
    ).map(entry => {
      const group = { group_id: String(entry.group.id) };
      if (entry.scene_index !== null && entry.scene_index !== undefined) {
        group.scene_index = entry.scene_index;
      }
      return group;
    });
    if (groups.length) values.groups = groups;

    const tagIds = unionBy(
      scenes.flatMap(scene => (scene.tags || []).map(tag => String(tag.id))),
      id => id
    );
    if (tagIds.length) values.tag_ids = tagIds;

    const stashIds = unionBy(
      scenes.flatMap(scene => scene.stash_ids || []),
      entry => String(entry.endpoint) + "\0" + String(entry.stash_id)
    ).map(entry => ({
      endpoint: entry.endpoint,
      stash_id: entry.stash_id,
    }));
    if (stashIds.length) values.stash_ids = stashIds;

    return values;
  }

  function lookupName(scenes, matchId, readEntries, readId, readName) {
    for (let i = 0; i < scenes.length; i++) {
      const entries = readEntries(scenes[i]) || [];
      for (let j = 0; j < entries.length; j++) {
        if (String(readId(entries[j])) === String(matchId)) {
          const name = readName(entries[j]);
          if (!isEmptyScalar(name)) return name;
        }
      }
    }
    return null;
  }

  function sceneLetter(index) {
    let n = Number(index);
    if (!Number.isFinite(n) || n < 0) return "?";
    let label = "";
    do {
      label = String.fromCharCode(65 + (n % 26)) + label;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return label;
  }

  function uniqueSourceLabels(indexes) {
    const seen = new Set();
    const labels = [];
    (indexes || []).forEach(index => {
      const label = sceneLetter(index);
      if (seen.has(label)) return;
      seen.add(label);
      labels.push(label);
    });
    return labels;
  }

  function firstPopulatedEntry(scenes, readValue) {
    for (let i = 0; i < scenes.length; i++) {
      const value = readValue(scenes[i]);
      if (!isEmptyScalar(value)) return { value, sceneIndex: i };
    }
    return undefined;
  }

  function unionEntries(scenes, readItems, keyFor) {
    const seen = new Set();
    const result = [];
    scenes.forEach((scene, sceneIndex) => {
      (readItems(scene) || []).forEach(item => {
        const key = keyFor(item);
        if (seen.has(key)) return;
        seen.add(key);
        result.push({ item, sceneIndex });
      });
    });
    return result;
  }

  function findFileAcrossScenes(scenes, fileId) {
    if (fileId === null || fileId === undefined) return null;
    for (let i = 0; i < scenes.length; i++) {
      const files = scenes[i].files || [];
      for (let j = 0; j < files.length; j++) {
        if (String(files[j].id) === String(fileId)) {
          return { file: files[j], scene: scenes[i], sceneIndex: i };
        }
      }
    }
    return null;
  }

  function formatMergedScenePreview(keeper, sources) {
    const values = buildMergedSceneValues(keeper, sources);
    const scenes = [keeper].concat(sources || []);
    const fields = [];
    const sceneRefs = scenes.map((scene, index) => ({
      label: sceneLetter(index),
      id: String(scene.id),
      title: scene.title || null,
      role: index === 0 ? "keeper" : "source",
    }));

    function addScalarField(label, readValue, formatValue) {
      const entry = firstPopulatedEntry(scenes, readValue);
      if (!entry) return;
      const display = formatValue ? formatValue(entry.value, entry.sceneIndex) : String(entry.value);
      fields.push({
        label,
        value: display,
        items: [{ text: display, sources: [sceneLetter(entry.sceneIndex)] }],
        sources: [sceneLetter(entry.sceneIndex)],
      });
    }

    function addFixedField(label, display, sceneIndex) {
      fields.push({
        label,
        value: display,
        items: [{ text: display, sources: [sceneLetter(sceneIndex)] }],
        sources: [sceneLetter(sceneIndex)],
      });
    }

    function addUnionField(label, entries, formatItem) {
      if (!entries.length) return;
      const items = entries.map(entry => ({
        text: formatItem(entry.item, entry.sceneIndex),
        sources: [sceneLetter(entry.sceneIndex)],
      }));
      fields.push({
        label,
        value: items.map(item => item.text).join(", "),
        items,
        sources: uniqueSourceLabels(entries.map(entry => entry.sceneIndex)),
      });
    }

    addScalarField("Title", scene => scene.title);
    addScalarField("Code", scene => scene.code);
    addScalarField("Details", scene => scene.details);
    addScalarField("Director", scene => scene.director);
    addScalarField("Date", scene => scene.date);
    addScalarField("Rating", scene => scene.rating100);

    if (values.studio_id !== undefined) {
      addScalarField(
        "Studio",
        scene => {
          if (!scene.studio || scene.studio.id === null || scene.studio.id === undefined) return null;
          return String(scene.studio.id);
        },
        studioId => {
          const studioName = lookupName(
            scenes,
            studioId,
            scene => (scene.studio ? [scene.studio] : []),
            studio => studio.id,
            studio => studio.name
          );
          return studioName ? studioName + " (#" + studioId + ")" : "#" + studioId;
        }
      );
    }

    addFixedField("Organized", values.organized ? "Yes" : "No", 0);

    addUnionField(
      "URLs",
      unionEntries(scenes, scene => scene.urls || [], url => String(url).trim()),
      url => String(url)
    );

    addUnionField(
      "Performers",
      unionEntries(scenes, scene => scene.performers || [], item => String(item.id)),
      item => lookupName(scenes, item.id, scene => scene.performers, entry => entry.id, entry => entry.name) || "#" + item.id
    );

    addUnionField(
      "Tags",
      unionEntries(scenes, scene => scene.tags || [], item => String(item.id)),
      item => lookupName(scenes, item.id, scene => scene.tags, entry => entry.id, entry => entry.name) || "#" + item.id
    );

    addUnionField(
      "Galleries",
      unionEntries(scenes, scene => scene.galleries || [], item => String(item.id)),
      item => lookupName(scenes, item.id, scene => scene.galleries, entry => entry.id, entry => entry.title) || "#" + item.id
    );

    addUnionField(
      "Groups",
      unionEntries(scenes, scene => scene.groups || [], item => String(item.group.id)),
      item => {
        const name = lookupName(
          scenes,
          item.group.id,
          scene => scene.groups,
          entry => entry.group.id,
          entry => entry.group.name
        );
        const groupLabel = name || "#" + item.group.id;
        return item.scene_index === undefined || item.scene_index === null
          ? groupLabel
          : groupLabel + " (index " + item.scene_index + ")";
      }
    );

    addUnionField(
      "Stash IDs",
      unionEntries(
        scenes,
        scene => scene.stash_ids || [],
        entry => String(entry.endpoint) + "\0" + String(entry.stash_id)
      ),
      entry => entry.endpoint + " → " + entry.stash_id
    );

    const sourceList = sources || [];
    return {
      values,
      fields,
      scenes: sceneRefs,
      keeperId: String(keeper.id),
      keeperTitle: keeper.title || null,
      sourceCount: sourceList.length,
      sourceFileCount: sourceList.reduce((count, scene) => count + ((scene.files || []).length), 0),
    };
  }

  async function prepareMergedSceneCover(api, keeper, sources) {
    const keeperPath = keeper && keeper.paths && keeper.paths.screenshot;
    let keeperError = null;
    if (!isEmptyScalar(keeperPath)) {
      try {
        const dataUrl = await api.fetchImageDataUrl(keeperPath);
        return { status: "kept", sceneId: String(keeper.id), dataUrl };
      } catch (error) {
        // A screenshot path can exist even when the image is missing.
        keeperError = error.message;
      }
    }

    const errors = [];
    for (const source of sources || []) {
      const path = source && source.paths && source.paths.screenshot;
      if (isEmptyScalar(path)) continue;
      try {
        const dataUrl = await api.fetchImageDataUrl(path);
        return { status: "copy", sceneId: String(source.id), dataUrl, keeperError };
      } catch (error) {
        errors.push(`#${source.id}: ${error.message}`);
      }
    }
    return {
      status: "unavailable",
      message: [
        keeperError ? `Keeper #${keeper.id}: ${keeperError}` : null,
        errors.length ? errors.join("; ") : "No source scene has an available image.",
      ].filter(Boolean).join("; "),
    };
  }

  function describeKeptFile(file, scene, sceneIndex) {
    if (!file) {
      return {
        keptFileId: null,
        keptFilePath: null,
        keptSceneId: scene ? String(scene.id) : null,
        keptSceneLabel: sceneIndex === null || sceneIndex === undefined ? null : sceneLetter(sceneIndex),
      };
    }
    return {
      keptFileId: file.id,
      keptFilePath: file.path || file.basename || null,
      keptSceneId: scene ? String(scene.id) : null,
      keptSceneLabel: sceneIndex === null || sceneIndex === undefined ? null : sceneLetter(sceneIndex),
    };
  }

  async function prepareMergeFilePlan(api, keeper, sources) {
    const scenes = [keeper].concat(sources || []);
    const keeperFiles = keeper.files || [];
    if (keeperFiles.length && keeper.paths && keeper.paths.stream &&
        await api.isSceneStreamAvailable(keeper.paths.stream)) {
      return {
        deleteSourceFiles: true,
        replacementFileId: null,
        ...describeKeptFile(keeperFiles[0], keeper, 0),
      };
    }

    const firstSourceFile = (sources || []).flatMap(scene => scene.files || [])[0];
    let replacementFileId = firstSourceFile ? firstSourceFile.id : null;
    for (const source of sources || []) {
      const sourceFiles = source.files || [];
      if (!sourceFiles.length || !source.paths || !source.paths.stream) continue;
      if (await api.isSceneStreamAvailable(source.paths.stream)) {
        replacementFileId = sourceFiles[0].id;
        break;
      }
    }
    const replacementFileIdFinal = keeperFiles.length || (firstSourceFile && replacementFileId !== firstSourceFile.id)
      ? replacementFileId
      : null;
    const keptMatch = findFileAcrossScenes(
      scenes,
      replacementFileIdFinal !== null ? replacementFileIdFinal : (firstSourceFile && firstSourceFile.id)
    ) || (keeperFiles[0] ? { file: keeperFiles[0], scene: keeper, sceneIndex: 0 } : null);

    return {
      deleteSourceFiles: false,
      replacementFileId: replacementFileIdFinal,
      ...describeKeptFile(
        keptMatch && keptMatch.file,
        keptMatch && keptMatch.scene,
        keptMatch ? keptMatch.sceneIndex : null
      ),
    };
  }

  async function mergeDuplicateGroup(api, keeper, sources) {
    const sourceFileIds = sources.flatMap(scene => (scene.files || []).map(file => file.id));
    const filePlan = await prepareMergeFilePlan(api, keeper, sources);
    const values = buildMergedSceneValues(keeper, sources);
    const cover = await prepareMergedSceneCover(api, keeper, sources);
    if (cover.status === "copy") values.cover_image = cover.dataUrl;
    await api.mergeScenes(
      sources.map(scene => scene.id),
      keeper.id,
      values
    );
    if (filePlan.replacementFileId !== null) {
      await api.setScenePrimaryFile(keeper.id, filePlan.replacementFileId);
    }
    if (filePlan.deleteSourceFiles && sourceFileIds.length) await api.deleteFiles(sourceFileIds);
    return api.fetchScene(keeper.id);
  }

  root.actions = {
    buildMergedSceneValues,
    formatMergedScenePreview,
    prepareMergedSceneCover,
    prepareMergeFilePlan,
    mergeDuplicateGroup,
  };
})();
