(function () {
  "use strict";
  const root = window.DupeFinder = window.DupeFinder || {};
  const { helpers, constants } = root;

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
    if (hasMetaA && (aDate !== bDate || aStudio !== bStudio)) return false;
    if (!aTitle || !bTitle) return false;
    return levenshtein(aTitle, bTitle) <= settings.defaultDistance;
  }

  function findDuplicateScenes(scenes, settings) {
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
      const used = new Set();
      for (let i = 0; i < bucket.length; i++) {
        if (used.has(i)) continue;
        const cluster = [bucket[i]];
        used.add(i);
        let changed = true;
        while (changed) {
          changed = false;
          for (let j = 0; j < bucket.length; j++) {
            if (used.has(j)) continue;
            if (cluster.some(existing => areScenesDuplicateBySettings(existing, bucket[j], settings))) {
              cluster.push(bucket[j]);
              used.add(j);
              changed = true;
            }
          }
        }
        if (cluster.length > 1) {
          const sample = cluster[0];
          groups.push({
            key: JSON.stringify([helpers.norm(sample.title), helpers.normDate(sample.date), helpers.norm(sample.studio ? sample.studio.name : ""), cluster.map(s => helpers.idKey(s.id)).sort().join(",")]),
            scenes: cluster,
          });
        }
      }
    });

    return groups.sort((a, b) => {
      const sizeDiff = b.scenes.length - a.scenes.length;
      if (sizeDiff) return sizeDiff;
      return a.key.localeCompare(b.key);
    });
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
    findDuplicateScenes,
    findMultiFileScenes,
    groupDurationDiffSeconds,
    hasUnsafeDuplicateGroup,
  };
})();
