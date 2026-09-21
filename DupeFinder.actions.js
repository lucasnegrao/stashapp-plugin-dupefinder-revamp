(function () {
  "use strict";
  const root = window.DupeFinder = window.DupeFinder || {};

  async function mergeDuplicateGroup(api, keeper, sources) {
    const sourceFileIds = sources.flatMap(scene => (scene.files || []).map(file => file.id));
    await api.mergeScenes(sources.map(scene => scene.id), keeper.id);
    if (sourceFileIds.length) await api.deleteFiles(sourceFileIds);
    return api.fetchScene(keeper.id);
  }

  root.actions = {
    mergeDuplicateGroup,
  };
})();
