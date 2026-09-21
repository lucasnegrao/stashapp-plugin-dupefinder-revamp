const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadPluginCore() {
  const context = {
    window: {},
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
    },
  };
  for (const filename of ["DupeFinder.shared.js", "DupeFinder.analysis.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
    vm.runInNewContext(source, context, { filename });
  }
  return context.window.DupeFinder;
}

test("uses the revamp plugin identity and documentation URL", () => {
  const { constants } = loadPluginCore();

  assert.equal(constants.PLUGIN_ID, "DupeFinderRevamp");
  assert.equal(constants.PRODUCT_NAME, "DupeFinder Revamp");
  assert.equal(constants.README_URL, "https://github.com/lucasnegrao/stashapp-plugin-dupefinder-revamp#readme");
});

test("maximum duration difference accepts only the combobox choices", () => {
  const { settings } = loadPluginCore();

  assert.equal(settings.normalize({ batchDurationDiffSeconds: -1 }).batchDurationDiffSeconds, -1);
  assert.equal(settings.normalize({ batchDurationDiffSeconds: 0 }).batchDurationDiffSeconds, 0);
  assert.equal(settings.normalize({ batchDurationDiffSeconds: 1 }).batchDurationDiffSeconds, 1);
  assert.equal(settings.normalize({ batchDurationDiffSeconds: 5 }).batchDurationDiffSeconds, 5);
  assert.equal(settings.normalize({ batchDurationDiffSeconds: 10 }).batchDurationDiffSeconds, 10);
  assert.equal(settings.normalize({ batchDurationDiffSeconds: 2 }).batchDurationDiffSeconds, 10);
});

test("Any duration difference never marks scenes or duplicate groups unsafe", () => {
  const { analysis } = loadPluginCore();
  const scene = { files: [{ duration: 10 }, { duration: 100 }] };
  const group = {
    method: "legacy",
    scenes: [
      { files: [{ duration: 10 }] },
      { files: [{ duration: 100 }] },
    ],
  };

  assert.equal(analysis.hasLargeDurationMismatch(scene, { batchDurationDiffSeconds: -1 }), false);
  assert.equal(analysis.hasLargeDurationMismatch(scene, { batchDurationDiffSeconds: 0 }), true);
  assert.equal(analysis.hasUnsafeDuplicateGroup(group, { batchDurationDiffSeconds: -1 }), false);
  assert.equal(analysis.hasUnsafeDuplicateGroup(group, {
    batchDurationDiffSeconds: 0,
    bestAlgorithm: "balanced",
    duplicateFinderMode: "legacy",
  }), true);
});
