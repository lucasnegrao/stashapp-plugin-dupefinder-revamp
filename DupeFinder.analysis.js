(function () {
  "use strict";
  const root = window.DupeFinder = window.DupeFinder || {};
  const { helpers, constants } = root;
  const BIT_COUNTS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

  function codecScore(sceneOrFile) {
    const file = sceneOrFile && sceneOrFile.video_codec !== undefined
      ? sceneOrFile
      : ((((sceneOrFile || {}).files) || [])[0] || {});
    const codec = (file.video_codec || "").toLowerCase();
    const idx = constants.CODEC_RANK.indexOf(codec);
    return idx === -1 ? constants.CODEC_RANK.length : idx;
  }

  function compareFiles(a, b, settings) {
    const algo = settings.bestAlgorithm;
    const aHeight = a && a.height ? a.height : 0;
    const bHeight = b && b.height ? b.height : 0;
    const aSize = a && a.size ? a.size : 0;
    const bSize = b && b.size ? b.size : 0;

    if (algo === "size") {
      const sizeDiff = aSize - bSize;
      if (sizeDiff) return sizeDiff;
      const resDiff = bHeight - aHeight;
      if (resDiff) return resDiff;
      return codecScore(a) - codecScore(b);
    }

    const resDiff = bHeight - aHeight;
    if (resDiff) return resDiff;

    if (algo === "quality") {
      const codecDiff = codecScore(a) - codecScore(b);
      if (codecDiff) return codecDiff;
      return aSize - bSize;
    }

    const sizeDiff = aSize - bSize;
    if (sizeDiff) return sizeDiff;
    return codecScore(a) - codecScore(b);
  }

  function pickBestFile(files, settings) {
    return [...(files || [])].sort((a, b) => compareFiles(a, b, settings))[0];
  }

  function sceneFileDurations(scene) {
    return (scene.files || [])
      .map(file => helpers.toFiniteNumber(file && file.duration))
      .filter(duration => duration !== null);
  }

  function sceneDurationDiffSeconds(scene) {
    const durations = sceneFileDurations(scene);
    if (durations.length < 2) return 0;
    return Math.max(...durations) - Math.min(...durations);
  }

  function hasLargeDurationMismatch(scene, settings) {
    return sceneDurationDiffSeconds(scene) > settings.batchDurationDiffSeconds;
  }

  function bestScene(groupScenes, settings) {
    return [...groupScenes].sort((a, b) => {
      const aBest = pickBestFile(a.files, settings) || {};
      const bBest = pickBestFile(b.files, settings) || {};
      const aRes = aBest.height || 0;
      const bRes = bBest.height || 0;
      if (bRes !== aRes) return bRes - aRes;
      const aSize = (a.files || []).reduce((n, f) => n + (f.size || 0), 0);
      const bSize = (b.files || []).reduce((n, f) => n + (f.size || 0), 0);
      if (aSize !== bSize) return aSize - bSize;
      const codecDiff = codecScore(aBest) - codecScore(bBest);
      if (codecDiff) return codecDiff;
      if (settings.preferOrganizedInBest && !!b.organized !== !!a.organized) return b.organized ? 1 : -1;
      return 0;
    })[0];
  }

  function phashForScene(scene, settings) {
    const sorted = [...(scene.files || [])].sort((a, b) => compareFiles(a, b, settings));
    const withPhash = sorted.find(file => !!helpers.rawPhash(file));
    return withPhash ? helpers.rawPhash(withPhash) : null;
  }

  function sceneHasPhash(scene, settings) {
    return !!phashForScene(scene, settings);
  }

  function hammingDistance(a, b) {
    const left = (a || "").trim().toLowerCase();
    const right = (b || "").trim().toLowerCase();
    if (!left || !right || left.length !== right.length) return null;
    let distance = 0;
    for (let i = 0; i < left.length; i++) {
      const leftNibble = parseInt(left[i], 16);
      const rightNibble = parseInt(right[i], 16);
      if (Number.isNaN(leftNibble) || Number.isNaN(rightNibble)) return null;
      distance += BIT_COUNTS[leftNibble ^ rightNibble];
    }
    return distance;
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a) return b.length;
    if (!b) return a.length;
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    return dp[a.length][b.length];
  }

  function duplicateCandidatesByMeta(scene) {
    const title = helpers.norm(scene.title);
    const date = helpers.normDate(scene.date);
    const studio = helpers.norm(scene.studio ? scene.studio.name : "");
    if (date && studio) return `meta:${date}||${studio}`;
    return `title:${title}`;
  }

  function areScenesDuplicateBySettings(a, b, settings) {
    const aTitle = helpers.norm(a.title);
    const bTitle = helpers.norm(b.title);
    const aDate = helpers.normDate(a.date);
    const bDate = helpers.normDate(b.date);
    const aStudio = helpers.norm(a.studio ? a.studio.name : "");
    const bStudio = helpers.norm(b.studio ? b.studio.name : "");

    const hasMetaA = !!(aDate && aStudio);
    const hasMetaB = !!(bDate && bStudio);
    if (hasMetaA !== hasMetaB) return false;
    if (hasMetaA) {
      if (aDate !== bDate || aStudio !== bStudio) return false;
      if (aTitle && bTitle) return levenshtein(aTitle, bTitle) <= settings.legacyDistance;
      return true;
    }
    if (!aTitle || !bTitle) return false;
    return levenshtein(aTitle, bTitle) <= settings.legacyDistance;
  }

  function makeDuplicateGroup(cluster, method) {
    return {
      key: `${method}:${cluster.map(scene => helpers.idKey(scene.id)).sort().join(",")}`,
      scenes: cluster,
      method,
    };
  }

  function sortDuplicateGroups(groups) {
    return [...groups].sort((a, b) => {
      const sizeDiff = b.scenes.length - a.scenes.length;
      if (sizeDiff) return sizeDiff;
      return a.key.localeCompare(b.key);
    });
  }

  function findLegacyDuplicateScenes(scenes, settings) {
    const byMeta = new Map();
    scenes.forEach(scene => {
      const title = helpers.norm(scene.title);
      const date = helpers.normDate(scene.date);
      const studio = helpers.norm(scene.studio ? scene.studio.name : "");
      if (!title && !(date && studio)) return;
      const key = duplicateCandidatesByMeta(scene);
      if (!byMeta.has(key)) byMeta.set(key, []);
      byMeta.get(key).push(scene);
    });

    const groups = [];
    byMeta.forEach(bucket => {
      const n = bucket.length;
      if (n < 2) return;

      const parent = Array.from({ length: n }, (_, index) => index);
      const find = i => {
        while (parent[i] !== i) {
          parent[i] = parent[parent[i]];
          i = parent[i];
        }
        return i;
      };
      const union = (a, b) => {
        const pa = find(a);
        const pb = find(b);
        if (pa !== pb) parent[pb] = pa;
      };

      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (areScenesDuplicateBySettings(bucket[i], bucket[j], settings)) union(i, j);
        }
      }

      const components = new Map();
      for (let i = 0; i < n; i++) {
        const rootId = find(i);
        if (!components.has(rootId)) components.set(rootId, []);
        components.get(rootId).push(bucket[i]);
      }

      components.forEach(cluster => {
        if (cluster.length < 2) return;
        groups.push(makeDuplicateGroup(cluster, "legacy"));
      });
    });

    return sortDuplicateGroups(groups);
  }

  function findPhashDuplicateScenes(scenes, settings) {
    const candidates = scenes
      .map(scene => ({ scene, phash: phashForScene(scene, settings) }))
      .filter(item => !!item.phash);
    const n = candidates.length;
    if (n < 2) return [];

    const parent = Array.from({ length: n }, (_, index) => index);
    const find = i => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const union = (a, b) => {
      const pa = find(a);
      const pb = find(b);
      if (pa !== pb) parent[pb] = pa;
    };

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const distance = hammingDistance(candidates[i].phash, candidates[j].phash);
        if (distance !== null && distance <= settings.phashDistance) union(i, j);
      }
    }

    const components = new Map();
    for (let i = 0; i < n; i++) {
      const rootId = find(i);
      if (!components.has(rootId)) components.set(rootId, []);
      components.get(rootId).push(candidates[i].scene);
    }

    const groups = [];
    components.forEach(cluster => {
      if (cluster.length < 2) return;
      groups.push(makeDuplicateGroup(cluster, "phash"));
    });
    return sortDuplicateGroups(groups);
  }

  function findMultiFileScenes(scenes) {
    return scenes
      .filter(s => s.files && s.files.length > 1)
      .sort((a, b) => b.files.length - a.files.length);
  }

  function groupDurationDiffSeconds(group, settings) {
    const durations = group.scenes
      .map(scene => {
        const file = pickBestFile(scene.files, settings);
        return helpers.toFiniteNumber(file && file.duration);
      })
      .filter(v => v !== null);
    if (durations.length < 2) return 0;
    return Math.max(...durations) - Math.min(...durations);
  }

  function hasUnsafeDuplicateGroup(group, settings) {
    return groupDurationDiffSeconds(group, settings) > settings.batchDurationDiffSeconds;
  }

  root.analysis = {
    compareFiles,
    pickBestFile,
    sceneFileDurations,
    sceneDurationDiffSeconds,
    hasLargeDurationMismatch,
    bestScene,
    phashForScene,
    sceneHasPhash,
    hammingDistance,
    findPhashDuplicateScenes,
    findDuplicateScenes: findLegacyDuplicateScenes,
    findLegacyDuplicateScenes,
    findMultiFileScenes,
    groupDurationDiffSeconds,
    hasUnsafeDuplicateGroup,
    makeDuplicateGroup,
    sortDuplicateGroups,
  };
})();
