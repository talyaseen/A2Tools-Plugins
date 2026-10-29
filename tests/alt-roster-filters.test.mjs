import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const root = new URL("../plugins/alt-roster/", import.meta.url);
const source = (file) => readFileSync(new URL(file, root), "utf8");
function rules() {
  const context = vm.createContext({});
  vm.runInContext(source("logic.js"), context);
  return context.RosterLogic;
}
const characters = () => Object.fromEntries([
  ["Main@1001", "Main", 1001, 1],
  ["Alt@1001", "Alt", 1001, 2],
  ["Other@2001", "Other", 2001, 0],
].map(([key, name, serverId, duty]) => [key, {
  name, serverId, cap: 560, capSet: true, seen: Date.now(),
  energy: { basic: 560, charged: 0, at: Date.now() },
  counts: { 0: { v: [duty, duty], at: Date.now() } },
}]));

test("old preferences keep all characters visible and warn for every faction", () => {
  const { displayOptions, characterVisible, matchesSelection } = rules();
  const options = displayOptions();
  for (const [key, ch] of Object.entries(characters())) {
    assert.equal(characterVisible(key, ch, null, null, options), true);
    assert.equal(matchesSelection(options.warnings, key, ch), false);
  }
});

test("Never wins over both pinned and current characters", () => {
  const { displayOptions, characterVisible } = rules();
  const chars = characters();
  const options = displayOptions({
    never: { mode: "character", values: ["Main@1001"] },
    always: { mode: "character", values: ["Main@1001"] }, current: "character",
  });
  assert.equal(characterVisible("Main@1001", chars["Main@1001"], "Main@1001", chars["Main@1001"], options), false);
  assert.equal(characterVisible("Alt@1001", chars["Alt@1001"], "Main@1001", chars["Main@1001"], options), false);
});

test("current faction, server and character filters keep pinned exceptions", () => {
  const { displayOptions, characterVisible } = rules();
  const chars = { ...characters(), "Nearby@1002": { name: "Nearby", serverId: 1002 } };
  for (const [mode, expected] of [
    ["faction", ["Main@1001", "Alt@1001", "Other@2001", "Nearby@1002"]],
    ["server", ["Main@1001", "Alt@1001", "Other@2001"]],
    ["character", ["Main@1001", "Other@2001"]],
  ]) {
    const options = displayOptions({ always: { mode: "character", values: ["Other@2001"] }, current: mode });
    assert.deepEqual(Object.entries(chars).filter(([key, ch]) => characterVisible(key, ch, "Main@1001", chars["Main@1001"], options)).map(([key]) => key), expected);
  }
});

test("a missing current identity leaves display visible, with Never still honored", () => {
  const { displayOptions, characterVisible } = rules();
  const options = displayOptions({ never: { mode: "server", values: ["2001"] }, always: { mode: "character", values: [] }, current: "faction" });
  const chars = characters();
  assert.equal(characterVisible("Main@1001", chars["Main@1001"], null, null, options), true);
  assert.equal(characterVisible("Other@2001", chars["Other@2001"], null, null, options), false);
  assert.equal(characterVisible("Main@1001", chars["Main@1001"], "unknown", { name: "Unknown" }, options), true);
  assert.equal(characterVisible("Main@1001", chars["Main@1001"], "Future@3001", { name: "Future", serverId: 3001 }, options), true);
});

test("stored filter values are normalized without sharing mutable defaults", () => {
  const { displayOptions } = rules();
  const options = displayOptions({ never: { mode: "bad", values: [null, 2, "x", "x"] }, current: {}, hiddenContent: [1, "4@char", "4@char"] });
  assert.equal(options.never.mode, "disabled");
  assert.deepEqual(Array.from(options.never.values), ["x"]);
  assert.equal(options.current, "never");
  assert.deepEqual(Array.from(options.hiddenContent), ["4@char"]);
  options.always.values.push("changed");
  assert.equal(displayOptions().always.values.length, 0);
});

test("warning selections match only the chosen faction, server or character", () => {
  const { displayOptions, matchesSelection } = rules();
  const chars = characters();
  for (const [mode, values, expected] of [
    ["faction", ["elyos"], ["Main@1001", "Alt@1001"]],
    ["server", ["2001"], ["Other@2001"]],
    ["character", ["Alt@1001"], ["Alt@1001"]],
  ]) {
    const options = displayOptions({ warnings: { mode, values } });
    assert.deepEqual(Object.entries(chars).filter(([key, ch]) => matchesSelection(options.warnings, key, ch)).map(([key]) => key), expected);
  }
});

class Element {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.listeners = {};
    this.style = { setProperty() {} }; this.value = ""; this._text = "";
    const classes = new Set();
    this.classList = { add: (...v) => v.forEach((x) => classes.add(x)), remove: (...v) => v.forEach((x) => classes.delete(x)),
      contains: (v) => classes.has(v), toggle: (v, on = !classes.has(v)) => on ? classes.add(v) : classes.delete(v) };
  }
  append(...values) { for (const value of values) { value.parent = this; this.children.push(value); } }
  replaceChildren(...values) { this.children = []; this._text = ""; this.append(...values); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); }
  setAttribute(key, value) { this[key] = value; }
  addEventListener(kind, callback) { this.listeners[kind] = callback; }
  get options() { return this.children.filter((x) => x.tagName === "OPTION"); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map((x) => x.textContent).join(""); }
  fire(kind) { this.listeners[kind]?.({ target: this }); }
  focus() { this.focused = true; }
}

async function page(prefs = {}) {
  const selectors = new Map();
  const byId = (element, id) => element.id === id ? element : element.children.map((child) => byId(child, id)).find(Boolean);
  const node = (selector) => {
    if (selector.startsWith("#")) return [...selectors.values()].map((element) => byId(element, selector.slice(1))).find(Boolean);
    if (!selectors.has(selector)) selectors.set(selector, new Element());
    return selectors.get(selector);
  };
  const tabs = ["roster", "content", "other"].map((tab) => { const button = new Element("button"); button.dataset.tab = tab; return button; });
  const heads = Array.from({ length: 6 }, () => new Element("span"));
  const document = {
    body: new Element("body"), documentElement: {},
    createElement: (tag) => new Element(tag), createTextNode: (text) => { const n = new Element("#text"); n.textContent = text; return n; },
    querySelector: (selector) => selector === ".remove.confirm" ? null : node(selector),
    querySelectorAll: (selector) => selector === ".tabs button" ? tabs : selector === ".head span" ? heads : [],
  };
  const handlers = new Map(); const timers = new Map(); const saved = {}; let next = 0; let ready = false;
  const stored = { chars: characters(), prefs, servers: {} };
  const a2 = { on: (kind, callback) => handlers.set(kind, callback), ready: () => { ready = true; },
    storage: { get: (key) => Promise.resolve(structuredClone(stored[key])), set: (key, value) => { saved[key] = structuredClone(value); return Promise.resolve(); } } };
  const context = vm.createContext({ document, a2, console, Intl, Date,
    setTimeout: (callback) => { const id = ++next; timers.set(id, callback); return id; }, clearTimeout: (id) => timers.delete(id), setInterval: () => 0 });
  for (const file of ["servers.js", "i18n.js", "logic.js", "plugin.js"]) vm.runInContext(source(file), context, { filename: fileURLToPath(new URL(file, root)) });
  for (let i = 0; i < 4 && !ready; i++) await Promise.resolve();
  assert.equal(ready, true);
  return { node, context, saved, emit: (kind, value) => handlers.get(kind)?.(value),
    flush: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((fn) => fn()); },
    mode: (key) => node(".filterRules").children.find((row) => row.children.some((child) => child.id === `display-${key}`)).children.find((child) => child.tagName === "SELECT"),
    rows: () => node(".list").children.map((li) => li.dataset.key),
  };
}

test("native filter controls persist pinned characters and follow a character switch", async () => {
  const ui = await page();
  let select = ui.mode("always"); select.value = "character"; select.fire("change");
  assert.equal(ui.mode("always").focused, true, "keyboard focus follows the recreated control");
  const rule = ui.node(".filterRules").children.find((row) => row.children.some((child) => child.id === "display-always"));
  const main = rule.children.find((child) => child.tagName === "FIELDSET").children
    .filter((child) => child.tagName === "LABEL").flatMap((label) => label.children).find((child) => child.value === "Main@1001");
  main.checked = true; main.fire("change");
  select = ui.mode("current"); select.value = "character"; select.fire("change");
  ui.emit("character", { name: "Other", serverId: 2001 });
  assert.deepEqual(ui.rows().sort(), ["Main@1001", "Other@2001"]);
  ui.flush();
  assert.deepEqual(ui.saved.prefs.filters.always.values, ["Main@1001"]);
  assert.equal(ui.saved.prefs.filters.current, "character");
  assert.equal(vm.runInContext("Object.keys(state.chars).length", ui.context), 3);
});

test("warning exclusions silence only selected full characters", async () => {
  const ui = await page({ filters: { warnings: { mode: "character", values: ["Main@1001"] } } });
  ui.emit("character", { name: "Other", serverId: 2001 });
  assert.equal(ui.node(".capped").hidden, false);
  assert.match(ui.node(".capped").textContent, /Alt/);
  assert.doesNotMatch(ui.node(".capped").textContent, /Main|Other/);
  assert.equal(ui.rows().length, 3);
});

test("Always All explains why a selected current filter keeps every row", async () => {
  const ui = await page({ filters: { current: "character" } });
  assert.match(ui.node(".filterNote").textContent, /Always show is set to All/);
  ui.emit("character", { name: "Main", serverId: 1001 });
  assert.equal(ui.rows().length, 3);
});

test("hiding a character preserves its contribution to shared server counts", async () => {
  const ui = await page({ tab: "content", filters: { never: { mode: "character", values: ["Alt@1001"] }, hiddenContent: ["4@char"] } });
  ui.emit("character", { name: "Main", serverId: 1001 });
  const [head, body] = ui.node(".contentTable").children;
  assert.equal(head.children[0].children.length, 3, "content, server and visible Main columns");
  assert.doesNotMatch(head.textContent, /Alt/);
  assert.doesNotMatch(body.textContent, /Nightmare/);
  const duty = body.children.find((row) => row.children[0]?.textContent.startsWith("Daily Duty"));
  assert.match(duty.children[1].textContent, /^3 \/ 5/);
});

test("reset restores display options without removing character data or changing tabs", async () => {
  const ui = await page({ tab: "other", sort: "cp", filters: { never: { mode: "faction", values: ["elyos"] } } });
  ui.node(".resetDisplay").fire("click"); ui.flush();
  assert.equal(ui.saved.prefs.filters.never.mode, "disabled");
  assert.equal(ui.saved.prefs.tab, "other");
  assert.equal(ui.saved.prefs.sort, "cp");
  assert.equal(vm.runInContext("Object.keys(state.chars).length", ui.context), 3);
});

test("every supported language provides all new controls", () => {
  const context = vm.createContext({}); vm.runInContext(source("i18n.js"), context);
  assert.equal(Object.keys(context.ROSTER_UI).length, 10);
  for (const words of Object.values(context.ROSTER_UI)) {
    for (const key of ["title", "never", "always", "current", "warnings", "hiddenContent", "note", "allOverridesCurrent", "selectValues", "noChoices", "reset"]) assert.equal(typeof words.filters[key], "string", key);
    assert.equal(Object.keys(words.filters.modes).length, 7);
    assert.equal(Object.keys(words.filters.factions).length, 2);
  }
});
