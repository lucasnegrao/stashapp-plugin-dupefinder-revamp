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

test("scene loading does not query unsupported extended metadata fields", async () => {
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
  assert.doesNotMatch(requests[0].body.query, /rating100/);
  assert.match(requests[0].body.query, /fingerprints\s*\{\s*type\s+value\s*\}/);
});
