const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadApi(fetch) {
  const source = fs.readFileSync(path.join(__dirname, "..", "DupeFinder.api.js"), "utf8");
  const context = { window: {}, fetch };
  vm.runInNewContext(source, context, { filename: "DupeFinder.api.js" });
  return context.window.DupeFinder.api;
}

function graphqlResponse(data) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({ data });
    },
  };
}

test("scene loading queries merge metadata fields used by duplicate merge", async () => {
  const requests = [];
  const api = loadApi(async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return graphqlResponse({ findScenes: { count: 0, scenes: [] } });
  });

  const scenes = await api.fetchAllScenes();

  assert.deepEqual(Array.from(scenes), []);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/graphql");
  assert.doesNotMatch(requests[0].body.query, /production_date/);
  assert.match(requests[0].body.query, /\brating100\b/);
  assert.match(requests[0].body.query, /\bcode\b/);
  assert.match(requests[0].body.query, /\bdetails\b/);
  assert.match(requests[0].body.query, /\bdirector\b/);
  assert.match(requests[0].body.query, /\burls\b/);
  assert.match(requests[0].body.query, /galleries\s*\{\s*id\s+title\s*\}/);
  assert.match(requests[0].body.query, /groups\s*\{\s*group\s*\{\s*id\s+name\s*\}\s*scene_index\s*\}/);
  assert.match(requests[0].body.query, /stash_ids\s*\{\s*endpoint\s+stash_id\s*\}/);
  assert.doesNotMatch(requests[0].body.query, /paths\s*\{/);
  assert.doesNotMatch(requests[0].body.query, /cover_image/);
  assert.match(requests[0].body.query, /fingerprints\s*\{\s*type\s+value\s*\}/);
});

test("mergeScenes sends calculated values through SceneMergeInput", async () => {
  const requests = [];
  const api = loadApi(async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return graphqlResponse({ sceneMerge: { id: "10" } });
  });

  const values = { id: "10", title: "Keeper title", organized: false };
  await api.mergeScenes(["11", "12"], "10", values);

  assert.equal(requests.length, 1);
  assert.match(requests[0].body.query, /mutation MergeScenes\(\$input: SceneMergeInput!\)/);
  assert.deepEqual(requests[0].body.variables, {
    input: {
      source: ["11", "12"],
      destination: "10",
      values,
    },
  });
});
