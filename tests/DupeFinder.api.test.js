const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadApi(fetch) {
  const source = fs.readFileSync(path.join(__dirname, "..", "DupeFinder.api.js"), "utf8");
  const context = { window: {}, fetch, FileReader: class {} };
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
  assert.match(requests[0].body.query, /paths\s*\{\s*screenshot\s+stream\s*\}/);
  assert.doesNotMatch(requests[0].body.query, /cover_image/);
  assert.match(requests[0].body.query, /fingerprints\s*\{\s*type\s+value\s*\}/);
});

test("isSceneStreamAvailable checks the destination without downloading it", async () => {
  const requests = [];
  const api = loadApi(async (url, options) => {
    requests.push({ url, options });
    return { ok: false, status: 404 };
  });

  assert.equal(await api.isSceneStreamAvailable("/scene/10/stream"), false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, "HEAD");
});

test("fetchImageDataUrl downloads an image and returns a data URL", async () => {
  class MockFileReader {
    readAsDataURL(blob) {
      this.result = `data:${blob.type};base64,bW9jaw==`;
      this.onload();
    }
  }
  const source = fs.readFileSync(path.join(__dirname, "..", "DupeFinder.api.js"), "utf8");
  const context = {
    window: {},
    FileReader: MockFileReader,
    fetch: async (url, options) => {
      assert.equal(url, "/scene/11/screenshot");
      assert.equal(options.cache, "no-store");
      return {
        ok: true,
        status: 200,
        async blob() { return { type: "image/jpeg", size: 4 }; },
      };
    },
  };
  vm.runInNewContext(source, context, { filename: "DupeFinder.api.js" });

  const result = await context.window.DupeFinder.api.fetchImageDataUrl("/scene/11/screenshot");

  assert.equal(result, "data:image/jpeg;base64,bW9jaw==");
});

test("fetchImageDataUrl rejects a successful non-image response", async () => {
  const api = loadApi(async () => ({
    ok: true,
    status: 200,
    async blob() { return { type: "text/html", size: 20 }; },
  }));

  await assert.rejects(api.fetchImageDataUrl("/scene/11/screenshot"), /not an image/);
});

test("fetchImageDataUrl rejects Stash's SVG scene placeholder", async () => {
  const api = loadApi(async () => ({
    ok: true,
    status: 200,
    async blob() { return { type: "image/svg+xml", size: 1024 }; },
  }));

  await assert.rejects(api.fetchImageDataUrl("/scene/10/screenshot"), /SVG placeholder/);
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
