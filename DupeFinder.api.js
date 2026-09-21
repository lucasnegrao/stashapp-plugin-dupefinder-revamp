(function () {
  "use strict";
  const root = window.DupeFinder = window.DupeFinder || {};

  const runtime = { supportsFingerprints: true };
  root.runtime = runtime;

  async function gql(query, variables) {
    const res = await fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: variables || {} }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.errors && data.errors.length) throw new Error(data.errors.map(e => e.message).join(", "));
    return data.data;
  }

  function sceneFragment(includeFingerprints) {
    return `
      id title date organized
      studio { name }
      performers { name }
      files {
        id path basename size video_codec height duration
        ${includeFingerprints ? "fingerprints { type value }" : ""}
      }
    `;
  }

  async function queryScenesPage(filter, includeFingerprints) {
    const fragment = sceneFragment(includeFingerprints);
    return gql(`
      query($filter: FindFilterType!) {
        findScenes(filter: $filter) {
          count
          scenes { ${fragment} }
        }
      }
    `, { filter });
  }

  async function fetchAllScenes(onProgress) {
    const PER_PAGE = 500;
    let page = 1;
    let all = [];
    let total = null;

    while (true) {
      let data;
      try {
        data = await queryScenesPage({ per_page: PER_PAGE, page, sort: "title" }, runtime.supportsFingerprints);
      } catch (error) {
        if (runtime.supportsFingerprints && /fingerprints/i.test(String(error && error.message))) {
          runtime.supportsFingerprints = false;
          data = await queryScenesPage({ per_page: PER_PAGE, page, sort: "title" }, false);
        } else {
          throw error;
        }
      }

      const { count, scenes } = data.findScenes;
      if (total === null) total = count;
      all = all.concat(scenes || []);
      if (onProgress) onProgress(all.length, total);
      if (all.length >= total) break;
      page++;
    }

    return all;
  }

  async function fetchScene(id) {
    const fragment = sceneFragment(runtime.supportsFingerprints);
    try {
      const d = await gql(`
        query FindScene($id: ID!) {
          findScene(id: $id) { ${fragment} }
        }
      `, { id: String(id) });
      return d.findScene;
    } catch (error) {
      if (runtime.supportsFingerprints && /fingerprints/i.test(String(error && error.message))) {
        runtime.supportsFingerprints = false;
        const d = await gql(`
          query FindScene($id: ID!) {
            findScene(id: $id) { ${sceneFragment(false)} }
          }
        `, { id: String(id) });
        return d.findScene;
      }
      throw error;
    }
  }

  root.api = {
    gql,
    fetchAllScenes,
    fetchScene,
    async destroyScene(id, deleteFile) {
      return gql(`
        mutation SceneDestroy($input: SceneDestroyInput!) {
          sceneDestroy(input: $input)
        }
      `, { input: { id: String(id), delete_file: deleteFile } });
    },
    async mergeScenes(sourceIds, destinationId) {
      return gql(`
        mutation MergeScenes($source: [ID!]!, $destination: ID!) {
          sceneMerge(input: { source: $source, destination: $destination }) { id }
        }
      `, { source: sourceIds.map(String), destination: String(destinationId) });
    },
    async deleteFiles(fileIds) {
      return gql(`
        mutation DeleteFiles($ids: [ID!]!) {
          deleteFiles(ids: $ids)
        }
      `, { ids: fileIds.map(String) });
    },
    async setScenePrimaryFile(sceneId, fileId) {
      return gql(`
        mutation SceneSetPrimaryFile($input: SceneUpdateInput!) {
          sceneUpdate(input: $input) { id }
        }
      `, { input: { id: String(sceneId), primary_file_id: String(fileId) } });
    },
  };
})();
