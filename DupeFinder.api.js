(function () {
  "use strict";
  const root = window.DupeFinder = window.DupeFinder || {};

  const runtime = {
    supportsFingerprints: true,
    supportsSceneSplit: null,
  };
  root.runtime = runtime;

  async function gql(query, variables) {
    const res = await fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: variables || {} }),
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = null;
      }
    }
    if (data && data.errors && data.errors.length) {
      const error = new Error(data.errors.map(e => e.message).join(", "));
      error.status = res.status;
      error.graphQLErrors = data.errors;
      throw error;
    }
    if (!res.ok) {
      const detail = (text || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
      const error = new Error(detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`);
      error.status = res.status;
      error.responseText = text;
      throw error;
    }
    if (!text.trim()) return {};
    if (!data || typeof data !== "object") throw new Error("Invalid GraphQL response");
    return Object.prototype.hasOwnProperty.call(data, "data") ? data.data : null;
  }

  function sceneFragment(includeFingerprints) {
    return `
      id
      title
      code
      details
      director
      urls
      date
      rating100
      organized
      studio { id name }
      galleries { id title }
      performers { id name }
      groups { group { id name } scene_index }
      tags { id name }
      stash_ids { endpoint stash_id }
      paths { screenshot stream }
      files {
        id path basename size video_codec height duration
        ${includeFingerprints ? "fingerprints { type value }" : ""}
      }
    `;
  }

  function supportsFingerprintFallback(error) {
    const message = String((error && error.message) || "");
    if (!runtime.supportsFingerprints) return false;
    if (!/(Cannot query field|Unknown field|Unknown argument|does not exist)/i.test(message)) return false;
    return /fingerprints/i.test(message);
  }

  async function withSceneCompatibility(runQuery) {
    let includeFingerprints = runtime.supportsFingerprints;

    for (let i = 0; i < 2; i++) {
      try {
        return await runQuery(includeFingerprints);
      } catch (error) {
        if (includeFingerprints && supportsFingerprintFallback(error)) {
          includeFingerprints = false;
          runtime.supportsFingerprints = false;
          continue;
        }
        throw error;
      }
    }
    throw new Error("Unable to complete scene query with compatible fields");
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
      const data = await withSceneCompatibility(includeFingerprints =>
        queryScenesPage({ per_page: PER_PAGE, page, sort: "title" }, includeFingerprints)
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
    return withSceneCompatibility(async includeFingerprints => {
      const d = await gql(`
        query FindScene($id: ID!) {
          findScene(id: $id) { ${sceneFragment(includeFingerprints)} }
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
      return withSceneCompatibility(async includeFingerprints => {
        const d = await gql(`
          query FindDuplicateScenes($distance: Int) {
            findDuplicateScenes(distance: $distance) {
              ${sceneFragment(includeFingerprints)}
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
    async mergeScenes(sourceIds, destinationId, values) {
      return gql(`
        mutation MergeScenes($input: SceneMergeInput!) {
          sceneMerge(input: $input) { id }
        }
      `, {
        input: {
          source: sourceIds.map(String),
          destination: String(destinationId),
          values,
        },
      });
    },
    async fetchImageDataUrl(url) {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Unable to load scene cover: HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob.type.startsWith("image/") || !blob.size) {
        throw new Error(`Scene cover response is not an image (${blob.type || "unknown type"})`);
      }
      if (blob.type.toLowerCase().split(";")[0] === "image/svg+xml") {
        throw new Error("Stash returned its SVG placeholder instead of a scene cover");
      }
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string" && /^data:image\/[^;,]+;base64,/.test(reader.result)) {
            resolve(reader.result);
          } else {
            reject(new Error("Unable to encode scene cover as an image data URL"));
          }
        };
        reader.onerror = () => reject(reader.error || new Error("Unable to read scene cover"));
        reader.readAsDataURL(blob);
      });
    },
    async isSceneStreamAvailable(url) {
      if (!url) return false;
      try {
        let res = await fetch(url, { method: "HEAD", cache: "no-store" });
        if (res.status === 405) {
          res = await fetch(url, {
            headers: { Range: "bytes=0-0" },
            cache: "no-store",
          });
          if (res.body) await res.body.cancel();
        }
        return res.ok;
      } catch (_) {
        return false;
      }
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
      return withSceneCompatibility(async includeFingerprints => {
        const d = await gql(`
          mutation SceneCreate($input: SceneCreateInput!) {
            sceneCreate(input: $input) {
              ${sceneFragment(includeFingerprints)}
            }
          }
        `, { input });
        return d.sceneCreate;
      });
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
