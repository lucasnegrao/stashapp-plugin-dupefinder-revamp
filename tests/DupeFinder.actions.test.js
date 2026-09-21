const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadActions() {
  const source = fs.readFileSync(path.join(__dirname, "..", "DupeFinder.actions.js"), "utf8");
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: "DupeFinder.actions.js" });
  return context.window.DupeFinder.actions;
}

test("duplicate merge deletes only source file IDs after scene merge", async () => {
  const actions = loadActions();
  const calls = [];
  const api = {
    async mergeScenes(sourceIds, keeperId) {
      calls.push(["mergeScenes", Array.from(sourceIds), keeperId]);
    },
    async deleteFiles(fileIds) {
      calls.push(["deleteFiles", Array.from(fileIds)]);
    },
    async fetchScene(sceneId) {
      calls.push(["fetchScene", sceneId]);
      return { id: sceneId, files: [{ id: "keep-file" }] };
    },
  };
  const keeper = { id: "keep-scene", files: [{ id: "keep-file" }] };
  const sources = [
    { id: "source-1", files: [{ id: "delete-1" }, { id: "delete-2" }] },
    { id: "source-2", files: [{ id: "delete-3" }] },
  ];

  const mergedKeeper = await actions.mergeDuplicateGroup(api, keeper, sources);

  assert.deepEqual(calls, [
    ["mergeScenes", ["source-1", "source-2"], "keep-scene"],
    ["deleteFiles", ["delete-1", "delete-2", "delete-3"]],
    ["fetchScene", "keep-scene"],
  ]);
  assert.equal(mergedKeeper.id, "keep-scene");
  assert.deepEqual(Array.from(mergedKeeper.files, file => file.id), ["keep-file"]);
});
