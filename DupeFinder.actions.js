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

  function formatMergedScenePreview(keeper, sources) {
    const values = buildMergedSceneValues(keeper, sources);
    const scenes = [keeper].concat(sources || []);
    const fields = [];

    function addField(label, value) {
      if (value === undefined || value === null) return;
      if (Array.isArray(value) && value.length === 0) return;
      fields.push({
        label,
        value: Array.isArray(value) ? value.join(", ") : String(value),
      });
    }

    addField("Title", values.title);
    addField("Code", values.code);
    addField("Details", values.details);
    addField("Director", values.director);
    addField("Date", values.date);
    addField("Rating", values.rating100);

    if (values.studio_id !== undefined) {
      const studioName = lookupName(
        scenes,
        values.studio_id,
        scene => (scene.studio ? [scene.studio] : []),
        studio => studio.id,
        studio => studio.name
      );
      addField("Studio", studioName ? studioName + " (#" + values.studio_id + ")" : "#" + values.studio_id);
    }

    addField("Organized", values.organized ? "Yes" : "No");

    if (values.urls) addField("URLs", values.urls);

    if (values.performer_ids) {
      addField("Performers", values.performer_ids.map(id => {
        const name = lookupName(scenes, id, scene => scene.performers, item => item.id, item => item.name);
        return name || "#" + id;
      }));
    }

    if (values.tag_ids) {
      addField("Tags", values.tag_ids.map(id => {
        const name = lookupName(scenes, id, scene => scene.tags, item => item.id, item => item.name);
        return name || "#" + id;
      }));
    }

    if (values.gallery_ids) {
      addField("Galleries", values.gallery_ids.map(id => {
        const name = lookupName(scenes, id, scene => scene.galleries, item => item.id, item => item.title);
        return name || "#" + id;
      }));
    }

    if (values.groups) {
      addField("Groups", values.groups.map(entry => {
        const name = lookupName(
          scenes,
          entry.group_id,
          scene => scene.groups,
          item => item.group.id,
          item => item.group.name
        );
        const label = name || "#" + entry.group_id;
        return entry.scene_index === undefined || entry.scene_index === null
          ? label
          : label + " (index " + entry.scene_index + ")";
      }));
    }

    if (values.stash_ids) {
      addField("Stash IDs", values.stash_ids.map(entry => entry.endpoint + " → " + entry.stash_id));
    }

    const sourceList = sources || [];
    return {
      values,
      fields,
      keeperId: String(keeper.id),
      keeperTitle: keeper.title || null,
      sourceCount: sourceList.length,
      sourceFileCount: sourceList.reduce((count, scene) => count + ((scene.files || []).length), 0),
    };
  }

  async function mergeDuplicateGroup(api, keeper, sources) {
    const sourceFileIds = sources.flatMap(scene => (scene.files || []).map(file => file.id));
    const values = buildMergedSceneValues(keeper, sources);
    await api.mergeScenes(
      sources.map(scene => scene.id),
      keeper.id,
      values
    );
    if (sourceFileIds.length) await api.deleteFiles(sourceFileIds);
    return api.fetchScene(keeper.id);
  }

  root.actions = {
    buildMergedSceneValues,
    formatMergedScenePreview,
    mergeDuplicateGroup,
  };
})();
