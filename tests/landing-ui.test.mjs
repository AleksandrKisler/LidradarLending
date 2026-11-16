import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const V = require("../assets/validate.js");
const source = readFileSync(
  new URL("../assets/app.js", import.meta.url),
  "utf8",
);
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
function setup(responses = []) {
  const nodes = new Map(),
    requests = [],
    events = new Map();
  const state = { focus: null };
  function node(id) {
    if (nodes.has(id)) return nodes.get(id);
    const classes = new Set(),
      handlers = new Map();
    const n = {
      id,
      value: "",
      checked: false,
      hidden: false,
      disabled: false,
      textContent: "",
      attrs: {},
      handlers,
      classList: {
        contains: (v) => classes.has(v),
        add: (v) => classes.add(v),
        remove: (v) => classes.delete(v),
        toggle: (v, enabled) => (enabled ? classes.add(v) : classes.delete(v)),
      },
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
      getAttribute(k) {
        return this.attrs[k];
      },
      addEventListener(t, f) {
        handlers.set(t, f);
      },
      focus() {
        state.focus = id;
      },
      scrollIntoView() {},
      closest(q) {
        return q.includes(".field") ? node(id + "-wrapper") : null;
      },
      querySelector() {
        return node(id.replace("-wrapper", ""));
      },
      querySelectorAll() {
        return [];
      },
    };
    if (id.endsWith("-wrapper")) classes.add("field");
    nodes.set(id, n);
    return n;
  }
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) node(id);
  const form = node("beta-form");
  form.querySelectorAll = () =>
    ["name", "company", "business", "contact", "locations", "consent"].map(
      (k) => node("f-" + k),
    );
  node("f-name").value = "  Елена  ";
  node("f-company").value = " Мастерская ";
  node("f-business").value = "Детейлинг";
  node("f-contact").value = "https://t.me/elena_demo";
  node("f-locations").value = "2";
  node("f-consent").checked = true;
  node("form-error").hidden = true;
  node("form-done").hidden = true;
  node("mobile-nav").hidden = true;
  const document = {
    getElementById: node,
    referrer: "https://referral.test/path",
    addEventListener: (t, f) => events.set(t, f),
  };
  let id = 0;
  const window = {
    LidRadarValidate: V,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    crypto: { randomUUID: () => "id-" + ++id },
    location: {
      search: "?utm_source=test&utm_medium=unit",
      hostname: "localhost",
    },
    setTimeout,
    clearTimeout,
  };
  class FormData {
    constructor() {}
    get(k) {
      return k === "website" ? node("website").value : node("f-" + k).value;
    }
  }
  const fetch = (url, options) => {
    requests.push({ url, ...options, payload: JSON.parse(options.body) });
    const response = responses.shift() || {
      ok: true,
      json: async () => ({ ok: true }),
    };
    return response instanceof Error
      ? Promise.reject(response)
      : Promise.resolve(response);
  };
  vm.runInNewContext(source, {
    window,
    document,
    FormData,
    URL,
    URLSearchParams,
    AbortController,
    fetch,
    console,
  });
  async function submit() {
    form.handlers.get("submit")({ preventDefault() {} });
    await new Promise((resolve) => setImmediate(resolve));
  }
  function edit(id, value) {
    node(id).value = value;
    form.handlers.get("input")({ target: node(id) });
  }
  return { node, requests, submit, edit, events, state, form };
}
test("new markup supplies all form controls, original business options and 12 native FAQ answers", () => {
  for (const id of [
    "name",
    "company",
    "business",
    "contact",
    "locations",
    "consent",
  ])
    assert.match(html, new RegExp('id="f-' + id + '"'));
  assert.match(html, /<select[^>]*name="business"/);
  assert.deepEqual(
    [...html.matchAll(/<option>(.*?)<\/option>/g)].map((x) => x[1]),
    ["Автосервис", "Детейлинг", "Салон красоты", "Другое"],
  );
  assert.equal((html.match(/<details /g) || []).length, 12);
  assert.equal((html.match(/<summary>/g) || []).length, 12);
  for (const path of ["privacy", "consent", "terms"])
    assert.ok(html.includes("/legal/" + path + ".html"));
});
test("validation focuses native select, rejects phone/locations/consent without a request", async () => {
  const f = setup();
  f.node("f-business").value = "";
  f.node("f-contact").value = "+7 900 000 00 00";
  f.node("f-locations").value = "0";
  f.node("f-consent").checked = false;
  await f.submit();
  assert.equal(f.requests.length, 0);
  assert.equal(f.state.focus, "f-business");
  assert.equal(f.node("f-business").attrs["aria-invalid"], "true");
  assert.match(f.node("e-contact").textContent, /Телефон не принимается/);
  assert.match(f.node("e-locations").textContent, /от 1 до 999/);
  f.node("f-consent").checked = true;
  f.edit("f-consent", "");
  assert.equal(f.node("e-consent").textContent, "");
});
test("network/HTTP failure keeps input and same id; confirmed retry shows exact success", async () => {
  const f = setup([
    new Error("network"),
    { ok: false, status: 429 },
    { ok: true, json: async () => ({ ok: true }) },
  ]);
  await f.submit();
  assert.equal(f.node("form-error").hidden, false);
  assert.equal(f.node("f-name").value, "  Елена  ");
  assert.equal(f.node("submit-label").textContent, "Повторить отправку");
  await f.submit();
  await f.submit();
  assert.equal(f.requests.length, 3);
  for (const req of f.requests) {
    assert.equal(req.url, "/api/lead");
    assert.equal(req.method, "POST");
    assert.equal(req.payload.id, "id-1");
    assert.equal(req.payload.contact, "@elena_demo");
    assert.equal(req.payload.name, "Елена");
    assert.equal(req.payload.locations, 2);
    assert.equal(req.payload.consent, true);
  }
  assert.equal(f.form.hidden, true);
  assert.equal(f.node("form-done").hidden, false);
  assert.equal(f.state.focus, "form-done");
  assert.equal(
    f.node("done-text").textContent,
    "Спасибо! Свяжемся с вами по указанному контакту, чтобы обсудить задачу и согласовать демонстрацию.",
  );
});
test("resolved fetch without server ok:true is failure; changed input creates a new id", async () => {
  const f = setup([
    { ok: true, json: async () => ({ ok: false }) },
    { ok: true, json: async () => ({ ok: true }) },
  ]);
  await f.submit();
  assert.equal(f.node("form-done").hidden, true);
  assert.equal(f.node("form-error").hidden, false);
  f.edit("f-locations", "");
  await f.submit();
  assert.notEqual(f.requests[0].payload.id, f.requests[1].payload.id);
  assert.equal(f.requests[1].payload.locations, null);
});
test("submitting blocks duplicate clicks and fields until response; honeypot sends nothing", async () => {
  let resolve;
  const wait = new Promise((r) => {
    resolve = r;
  });
  const f = setup([{ ok: true, json: () => wait }]);
  const first = f.submit();
  assert.equal(f.node("submit-btn").disabled, true);
  assert.equal(f.node("f-name").disabled, true);
  assert.equal(f.node("submit-label").textContent, "Отправляем заявку…");
  await f.submit();
  assert.equal(f.requests.length, 1);
  resolve({ ok: true });
  await first;
  await new Promise((r) => setImmediate(r));
  assert.equal(f.node("submit-btn").disabled, false);
  const bot = setup();
  bot.node("website").value = "spam";
  await bot.submit();
  assert.equal(bot.requests.length, 0);
  assert.equal(bot.node("form-done").hidden, false);
});
test("menu expands, closes on Escape with focus restoration, and closes on anchor selection", () => {
  const f = setup(),
    toggle = f.node("menu-toggle"),
    menu = f.node("mobile-nav");
  toggle.handlers.get("click")();
  assert.equal(menu.hidden, false);
  assert.equal(toggle.attrs["aria-expanded"], "true");
  f.events.get("keydown")({ key: "Escape" });
  assert.equal(menu.hidden, true);
  assert.equal(f.state.focus, "menu-toggle");
  toggle.handlers.get("click")();
  menu.handlers.get("click")({ target: { closest: () => ({}) } });
  assert.equal(menu.hidden, true);
  assert.equal(toggle.attrs["aria-expanded"], "false");
  toggle.handlers.get("click")();
  f.node("menu-close").handlers.get("click")();
  assert.equal(menu.hidden, true);
  assert.equal(f.state.focus, "menu-toggle");
});

test("422/429/5xx and timeout keep the form retryable without reporting success", async () => {
  const timeout = new Error("timeout");
  timeout.name = "AbortError";
  for (const response of [
    timeout,
    ...[422, 429, 500].map((status) => ({ ok: false, status })),
  ]) {
    const f = setup([response]);
    await f.submit();
    assert.equal(f.form.hidden, false);
    assert.equal(f.node("form-done").hidden, true);
    assert.equal(f.node("form-error").hidden, false);
    assert.equal(f.node("submit-btn").disabled, false);
    assert.equal(f.node("f-contact").value, "https://t.me/elena_demo");
    assert.equal(f.state.focus, "form-error");
  }
});
