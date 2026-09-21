(function () {
  "use strict";
  const root = window.DupeFinder = window.DupeFinder || {};

  const runtime = {
    supportsFingerprints: true,
    supportsExtendedSceneFields: true,
    supportsSceneSplit: null,
  };
  const extendedSceneFields = [
    "code",
    "details",
    "director",
    "urls",
    "production_date",
    "rating100",
    "galleries { id }",
    "groups { scene_index group { id name } }",
  ];
  const extendedSceneFieldNames = ["code", "details", "director", "urls", "production_date", "rating100", "galleries", "groups", "scene_index"];
  const quotedExtendedSceneFieldPatterns = extendedSceneFieldNames.map(fieldName =>
    new RegExp(`["'\`]${fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`, "i")
  );
  root.runtime = runtime;

  async function gql(query, variables) {
    const res = await fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: variables || {} }),
    });
    const data = await res.json().catch(() => null);
    if (data && data.errors && data.errors.length) {
      const error = new Error(data.errors.map(e => e.message).join(", "));
      error.status = res.status;
      error.graphQLErrors = data.errors;
      throw error;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!data) throw new Error("Invalid GraphQL response");
    if (data.errors && data.errors.length) throw new Error(data.errors.map(e => e.message).join(", "));
    return data.data;
  }

  function sceneFragment(includeFingerprints, includeExtendedFields) {
    const extendedFields = includeExtendedFields ? extendedSceneFields.join("\n") : "";
    return `
      id title date organized
      studio { id name }
      performers { id name }
      tags { id name }
      ${extendedFields}
      files {
        id path basename size video_codec height duration
        ${includeFingerprints ? "fingerprints { type value }" : ""}
      }
    `;
  }

  function supportsExtendedFieldFallback(error) {
    const message = String((error && error.message) || "");
    if (!runtime.supportsExtendedSceneFields) return false;
    if (!/(Cannot query field|Unknown field|Unknown argument|does not exist)/i.test(message)) return false;
    return quotedExtendedSceneFieldPatterns.some(pattern => pattern.test(message));
  }

  function supportsFingerprintFallback(error) {
    const message = String((error && error.message) || "");
    if (!runtime.supportsFingerprints) return false;
    if (!/(Cannot query field|Unknown field|Unknown argument|does not exist)/i.test(message)) return false;
    return /fingerprints/i.test(message);
  }

  async function withSceneCompatibility(runQuery, options) {
    let includeFingerprints = runtime.supportsFingerprints;
    let includeExtendedFields = runtime.supportsExtendedSceneFields;
    const updateExtendedRuntime = !options || options.updateExtendedRuntime !== false;

    for (let i = 0; i < 4; i++) {
      try {
        return await runQuery(includeFingerprints, includeExtendedFields);
      } catch (error) {
        if (includeFingerprints && supportsFingerprintFallback(error)) {
          includeFingerprints = false;
          runtime.supportsFingerprints = false;
          continue;
        }
        if (includeExtendedFields && supportsExtendedFieldFallback(error)) {
          includeExtendedFields = false;
          if (updateExtendedRuntime) runtime.supportsExtendedSceneFields = false;
          continue;
        }
        throw error;
      }
    }
    throw new Error("Unable to complete scene query with compatible fields");
  }

  async function queryScenesPage(filter, includeFingerprints, includeExtendedFields) {
    const fragment = sceneFragment(includeFingerprints, includeExtendedFields);
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
      const data = await withSceneCompatibility((includeFingerprints, includeExtendedFields) =>
        queryScenesPage({ per_page: PER_PAGE, page, sort: "title" }, includeFingerprints, includeExtendedFields)
      );

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
    return withSceneCompatibility(async (includeFingerprints, includeExtendedFields) => {
      const d = await gql(`
        query FindScene($id: ID!) {
          findScene(id: $id) { ${sceneFragment(includeFingerprints, includeExtendedFields)} }
        }
      `, { id: String(id) });
      return d.findScene;
    });
  }

  async function canSplitScenes() {
    if (runtime.supportsSceneSplit !== null) return runtime.supportsSceneSplit;
    try {
      const d = await gql(`
        query SplitSupport {
          __type(name: "Mutation") {
            fields { name }
          }
        }
      `);
      const names = (((d || {}).__type || {}).fields || []).map(field => field.name);
      runtime.supportsSceneSplit = names.includes("sceneCreate") && names.includes("sceneAssignFile");
    } catch (_) {
      runtime.supportsSceneSplit = false;
    }
    return runtime.supportsSceneSplit;
  }

  root.api = {
    gql,
    fetchAllScenes,
    fetchScene,
    canSplitScenes,
    async fetchDuplicateSceneGroups(distance) {
      return withSceneCompatibility(async (includeFingerprints, includeExtendedFields) => {
        const d = await gql(`
          query FindDuplicateScenes($distance: Int) {
            findDuplicateScenes(distance: $distance) {
              ${sceneFragment(includeFingerprints, includeExtendedFields)}
            }
          }
        `, { distance: Number(distance) });
        const groups = d.findDuplicateScenes || [];
        return groups.map(group => Array.isArray(group) ? group : [group]);
      });
    },
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
    async createScene(input) {
      return withSceneCompatibility(async (includeFingerprints, includeExtendedFields) => {
        const d = await gql(`
          mutation SceneCreate($input: SceneCreateInput!) {
            sceneCreate(input: $input) {
              ${sceneFragment(includeFingerprints, includeExtendedFields)}
            }
          }
        `, { input });
        return d.sceneCreate;
      }, { updateExtendedRuntime: false });
    },
    async assignSceneFile(sceneId, fileId) {
      return gql(`
        mutation SceneAssignFile($input: AssignSceneFileInput!) {
          sceneAssignFile(input: $input)
        }
      `, { input: { scene_id: String(sceneId), file_id: String(fileId) } });
    },
  };
})();
