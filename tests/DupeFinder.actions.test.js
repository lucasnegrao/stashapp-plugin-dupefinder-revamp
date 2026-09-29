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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("duplicate merge deletes only source file IDs after scene merge", async () => {
  const actions = loadActions();
  const calls = [];
  const api = {
    async mergeScenes(sourceIds, keeperId, values) {
      calls.push(["mergeScenes", Array.from(sourceIds), keeperId, values]);
    },
    async deleteFiles(fileIds) {
      calls.push(["deleteFiles", Array.from(fileIds)]);
    },
    async fetchScene(sceneId) {
      calls.push(["fetchScene", sceneId]);
      return { id: sceneId, files: [{ id: "keep-file" }] };
    },
  };
  const keeper = {
    id: "keep-scene",
    files: [{ id: "keep-file" }],
    organized: false,
  };
  const sources = [
    { id: "source-1", files: [{ id: "delete-1" }, { id: "delete-2" }] },
    { id: "source-2", files: [{ id: "delete-3" }] },
  ];

  const mergedKeeper = await actions.mergeDuplicateGroup(api, keeper, sources);

  assert.deepEqual(clone(calls), [
    ["mergeScenes", ["source-1", "source-2"], "keep-scene", {
      id: "keep-scene",
      organized: false,
    }],
    ["deleteFiles", ["delete-1", "delete-2", "delete-3"]],
    ["fetchScene", "keep-scene"],
  ]);
  assert.equal(mergedKeeper.id, "keep-scene");
  assert.deepEqual(Array.from(mergedKeeper.files, file => file.id), ["keep-file"]);
});

test("buildMergedSceneValues preserves keeper scalars when sources conflict", () => {
  const { buildMergedSceneValues } = loadActions();
  const values = buildMergedSceneValues(
    {
      id: "10",
      title: "Keeper title",
      code: "K-1",
      details: "Keeper details",
      director: "Keeper director",
      date: "2020-01-01",
      rating100: 80,
      studio: { id: "1" },
      organized: true,
    },
    [{
      id: "11",
      title: "Source title",
      code: "S-1",
      details: "Source details",
      director: "Source director",
      date: "2021-01-01",
      rating100: 40,
      studio: { id: "2" },
      organized: false,
    }]
  );

  assert.equal(values.title, "Keeper title");
  assert.equal(values.code, "K-1");
  assert.equal(values.details, "Keeper details");
  assert.equal(values.director, "Keeper director");
  assert.equal(values.date, "2020-01-01");
  assert.equal(Object.prototype.hasOwnProperty.call(values, "production_date"), false);
  assert.equal(values.rating100, 80);
  assert.equal(values.studio_id, "1");
  assert.equal(values.organized, true);
});

test("buildMergedSceneValues fills empty keeper scalars from first populated source", () => {
  const { buildMergedSceneValues } = loadActions();
  const values = buildMergedSceneValues(
    {
      id: "10",
      title: "",
      details: null,
      studio: null,
      organized: false,
    },
    [
      {
        id: "11",
        title: "",
        details: "First details",
        studio: null,
      },
      {
        id: "12",
        title: "Second title",
        details: "Second details",
        studio: { id: 3 },
      },
    ]
  );

  assert.equal(values.title, "Second title");
  assert.equal(values.details, "First details");
  assert.equal(values.studio_id, "3");
  assert.equal(values.organized, false);
});

test("buildMergedSceneValues treats whitespace-only strings as empty without rewriting chosen values", () => {
  const { buildMergedSceneValues } = loadActions();
  const spaced = "  Source title  ";
  const values = buildMergedSceneValues(
    { id: "10", title: "   ", organized: false },
    [{ id: "11", title: spaced }]
  );

  assert.equal(values.title, spaced);
});

test("buildMergedSceneValues preserves rating100 of 0", () => {
  const { buildMergedSceneValues } = loadActions();
  const values = buildMergedSceneValues(
    { id: "10", rating100: 0, organized: false },
    [{ id: "11", rating100: 90 }]
  );

  assert.equal(values.rating100, 0);
});

test("buildMergedSceneValues preserves organized false when a source is organized", () => {
  const { buildMergedSceneValues } = loadActions();
  const values = buildMergedSceneValues(
    { id: "10", organized: false },
    [{ id: "11", organized: true }]
  );

  assert.equal(values.organized, false);
});

test("buildMergedSceneValues unions performers tags galleries and urls keeper-first", () => {
  const { buildMergedSceneValues } = loadActions();
  const values = buildMergedSceneValues(
    {
      id: "10",
      performers: [{ id: "1" }],
      tags: [{ id: "8" }],
      galleries: [{ id: "100" }],
      urls: ["https://keeper.example/"],
      organized: false,
    },
    [{
      id: "11",
      performers: [{ id: "1" }, { id: "2" }],
      tags: [{ id: "9" }, { id: "8" }],
      galleries: [{ id: "100" }, { id: "200" }],
      urls: ["https://keeper.example/", "https://source.example/"],
    }]
  );

  assert.deepEqual(clone(values.performer_ids), ["1", "2"]);
  assert.deepEqual(clone(values.tag_ids), ["8", "9"]);
  assert.deepEqual(clone(values.gallery_ids), ["100", "200"]);
  assert.deepEqual(clone(values.urls), ["https://keeper.example/", "https://source.example/"]);
});

test("buildMergedSceneValues deduplicates groups by id and keeps first scene_index", () => {
  const { buildMergedSceneValues } = loadActions();
  const values = buildMergedSceneValues(
    {
      id: "10",
      groups: [{ group: { id: "5" }, scene_index: 1 }],
      organized: false,
    },
    [{
      id: "11",
      groups: [
        { group: { id: "5" }, scene_index: 9 },
        { group: { id: "6" }, scene_index: null },
        { group: { id: "7" } },
      ],
    }]
  );

  assert.deepEqual(clone(values.groups), [
    { group_id: "5", scene_index: 1 },
    { group_id: "6" },
    { group_id: "7" },
  ]);
});

test("buildMergedSceneValues deduplicates stash ids by endpoint and stash_id", () => {
  const { buildMergedSceneValues } = loadActions();
  const values = buildMergedSceneValues(
    {
      id: "10",
      stash_ids: [{ endpoint: "https://stashdb.org", stash_id: "aaa" }],
      organized: false,
    },
    [{
      id: "11",
      stash_ids: [
        { endpoint: "https://stashdb.org", stash_id: "aaa" },
        { endpoint: "https://stashdb.org", stash_id: "bbb" },
        { endpoint: "https://other.example", stash_id: "aaa" },
      ],
    }]
  );

  assert.deepEqual(clone(values.stash_ids), [
    { endpoint: "https://stashdb.org", stash_id: "aaa" },
    { endpoint: "https://stashdb.org", stash_id: "bbb" },
    { endpoint: "https://other.example", stash_id: "aaa" },
  ]);
});

test("buildMergedSceneValues tolerates missing arrays and relationships", () => {
  const { buildMergedSceneValues } = loadActions();
  const values = buildMergedSceneValues({ id: "10" }, [{ id: "11" }]);

  assert.deepEqual(clone(values), { id: "10", organized: false });
});

test("buildMergedSceneValues does not mutate input scene objects or arrays", () => {
  const { buildMergedSceneValues } = loadActions();
  const keeper = {
    id: "10",
    title: "Keeper",
    performers: [{ id: "1" }],
    tags: [{ id: "8" }],
    urls: ["https://keeper.example/"],
    organized: false,
  };
  const sources = [{
    id: "11",
    title: "Source",
    performers: [{ id: "2" }],
    tags: [{ id: "9" }],
    urls: ["https://source.example/"],
    organized: true,
  }];
  const keeperBefore = JSON.parse(JSON.stringify(keeper));
  const sourcesBefore = JSON.parse(JSON.stringify(sources));

  buildMergedSceneValues(keeper, sources);

  assert.deepEqual(keeper, keeperBefore);
  assert.deepEqual(sources, sourcesBefore);
});

test("buildMergedSceneValues omits excluded fields", () => {
  const { buildMergedSceneValues } = loadActions();
  const values = buildMergedSceneValues(
    {
      id: "10",
      title: "Keeper",
      production_date: "2019-01-01",
      cover_image: "data:image/png;base64,aaa",
      custom_fields: { foo: "bar" },
      primary_file_id: "file-1",
      resume_time: 12,
      play_duration: 34,
      o_counter: 1,
      play_count: 2,
      organized: false,
    },
    []
  );

  assert.equal(values.title, "Keeper");
  assert.equal(Object.prototype.hasOwnProperty.call(values, "production_date"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(values, "cover_image"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(values, "custom_fields"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(values, "primary_file_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(values, "resume_time"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(values, "play_duration"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(values, "o_counter"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(values, "play_count"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(values, "clientMutationId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(values, "movies"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(values, "url"), false);
});

test("buildMergedSceneValues matches the documented merge example", () => {
  const { buildMergedSceneValues } = loadActions();
  const values = buildMergedSceneValues(
    {
      id: "10",
      title: "Keeper title",
      details: "",
      studio: null,
      performers: [{ id: "1" }],
      tags: [{ id: "8" }],
      urls: [],
      organized: false,
    },
    [{
      id: "11",
      title: "Source title",
      details: "Source details",
      studio: { id: "3" },
      performers: [{ id: "1" }, { id: "2" }],
      tags: [{ id: "9" }],
      urls: ["https://example.com/scene"],
      organized: true,
    }]
  );

  assert.deepEqual(clone(values), {
    id: "10",
    title: "Keeper title",
    details: "Source details",
    studio_id: "3",
    performer_ids: ["1", "2"],
    tag_ids: ["8", "9"],
    urls: ["https://example.com/scene"],
    organized: false,
  });
});

test("formatMergedScenePreview resolves names for display", () => {
  const { formatMergedScenePreview } = loadActions();
  const preview = formatMergedScenePreview(
    {
      id: "10",
      title: "Keeper title",
      details: "",
      studio: null,
      performers: [{ id: "1", name: "Alex" }],
      tags: [{ id: "8", name: "Tag A" }],
      galleries: [{ id: "100", title: "Gallery A" }],
      groups: [{ group: { id: "5", name: "Group A" }, scene_index: 1 }],
      urls: [],
      organized: false,
      files: [{ id: "keep-file" }],
    },
    [{
      id: "11",
      title: "Source title",
      details: "Source details",
      studio: { id: "3", name: "Studio X" },
      performers: [{ id: "1", name: "Alex" }, { id: "2", name: "Blake" }],
      tags: [{ id: "9", name: "Tag B" }],
      galleries: [{ id: "200", title: "Gallery B" }],
      groups: [{ group: { id: "6", name: "Group B" }, scene_index: null }],
      stash_ids: [{ endpoint: "https://stashdb.org", stash_id: "abc" }],
      urls: ["https://example.com/scene"],
      organized: true,
      files: [{ id: "delete-1" }, { id: "delete-2" }],
    }]
  );

  assert.equal(preview.keeperId, "10");
  assert.equal(preview.keeperTitle, "Keeper title");
  assert.equal(preview.sourceCount, 1);
  assert.equal(preview.sourceFileCount, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(preview, "coverUrl"), false);
  assert.deepEqual(clone(preview.fields), [
    { label: "Title", value: "Keeper title" },
    { label: "Details", value: "Source details" },
    { label: "Studio", value: "Studio X (#3)" },
    { label: "Organized", value: "No" },
    { label: "URLs", value: "https://example.com/scene" },
    { label: "Performers", value: "Alex, Blake" },
    { label: "Tags", value: "Tag A, Tag B" },
    { label: "Galleries", value: "Gallery A, Gallery B" },
    { label: "Groups", value: "Group A (index 1), Group B" },
    { label: "Stash IDs", value: "https://stashdb.org → abc" },
  ]);
});
