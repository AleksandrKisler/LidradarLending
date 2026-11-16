import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { init, scenes } = require("../assets/slideshow.js");
function fixture({ fail = -1 } = {}) {
  const images = scenes.map((_, i) => ({
    hidden: i !== 0,
    decode: () =>
      i === fail ? Promise.reject(Error("image")) : Promise.resolve(),
  }));
  const title = {},
    caption = {},
    handlers = new Map(),
    timers = new Map();
  let nextId = 0;
  const element = {
    querySelectorAll: () => images,
    querySelector: (q) => (q === "#scene-title" ? title : caption),
  };
  const doc = {
    hidden: false,
    addEventListener: (t, f) => handlers.set(t, f),
    removeEventListener: (t) => handlers.delete(t),
  };
  const clock = {
    setTimeout: (fn, ms) => {
      const id = ++nextId;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  async function tick() {
    assert.equal(timers.size, 1);
    const [id, t] = [...timers][0];
    timers.delete(id);
    assert.equal(t.ms, 7000);
    t.fn();
    await Promise.resolve();
    await Promise.resolve();
  }
  return {
    images,
    title,
    caption,
    handlers,
    timers,
    element,
    doc,
    clock,
    tick,
  };
}
test("7000ms sequence loops 1→2→3→4→5→1 and changes title, image and caption together", async () => {
  const f = fixture();
  const api = init(f.element, f.doc, f.clock);
  for (let i = 0; i <= 5; i++) {
    const n = i % 5;
    assert.equal(f.title.textContent, scenes[n].title);
    assert.equal(f.caption.textContent, scenes[n].caption);
    assert.deepEqual(
      f.images.map((x) => x.hidden),
      scenes.map((_, j) => j !== n),
    );
    await f.tick();
  }
  api.destroy();
  assert.equal(f.timers.size, 0);
});
test("repeated init keeps one timer; hidden tab resumes after a fresh 7000ms interval", async () => {
  const f = fixture(),
    api = init(f.element, f.doc, f.clock);
  assert.equal(init(f.element, f.doc, f.clock), api);
  assert.equal(f.timers.size, 1);
  f.doc.hidden = true;
  f.handlers.get("visibilitychange")();
  assert.equal(f.timers.size, 0);
  f.doc.hidden = false;
  f.handlers.get("visibilitychange")();
  assert.equal(f.timers.size, 1);
  assert.equal(f.title.textContent, scenes[0].title);
  await f.tick();
  assert.equal(f.title.textContent, scenes[1].title);
  api.destroy();
  api.destroy();
  assert.equal(f.handlers.size, 0);
  assert.equal(f.timers.size, 0);
  const again = init(f.element, f.doc, f.clock);
  assert.notEqual(again, api);
  assert.equal(f.title.textContent, scenes[0].title);
  again.destroy();
});
test("failed decode retains current complete scene; destruction cancels a pending render", async () => {
  const f = fixture({ fail: 1 }),
    api = init(f.element, f.doc, f.clock);
  await f.tick();
  assert.equal(f.title.textContent, scenes[0].title);
  assert.equal(f.images[0].hidden, false);
  const [{ fn }] = f.timers.values();
  f.timers.clear();
  fn();
  api.destroy();
  await Promise.resolve();
  assert.equal(f.title.textContent, scenes[0].title);
  assert.equal(f.timers.size, 0);
});
