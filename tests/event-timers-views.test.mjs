import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../plugins/event-timers/plugin.js", import.meta.url), "utf8");
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.classes = new Set();
    this.classList = { toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) };
    this.style = { setProperty() {} };
  }
  append(...nodes) {
    for (const node of nodes) if (node instanceof Element) node.parent = this;
    this.children.push(...nodes);
  }
  prepend(...nodes) {
    for (const node of nodes) if (node instanceof Element) node.parent = this;
    this.children.unshift(...nodes);
  }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  contains(node) { return node === this || this.children.some((child) => child instanceof Element && child.contains(node)); }
  closest(selector) {
    return selector.startsWith(".") && (this.className || "").split(" ").includes(selector.slice(1))
      ? this : this.parent?.closest(selector);
  }
  click() { this.listeners.click?.(); }
  focus() { this.onFocus?.(); }
}

function harness(saved = {}) {
  const prefs = { tab: "events", hidden: [], alerts: {}, leads: {}, ...saved };
  const els = {
    views: Object.fromEntries(["events", "bosses", "alerts", "settings"].map((name) => [name, new Element()])),
    tabs: ["events", "bosses", "alerts", "settings"].map((name) => Object.assign(new Element("button"), { dataset: { tab: name } })),
    eventsHead: new Element("h2"), hidden: new Element(), hiddenBosses: new Element(),
    scheduled: new Element("ol"), field: new Element("ol"),
  };
  const words = {
    hide: "Hide", hidden: "Hidden:", now: "now", left: (s) => `${s} left`, in: (s) => `in ${s}`,
    up: "Up", unknown: "Unknown", seen: (s) => `seen ${s}`, upFor: (s) => `for ${s}`, ago: String,
    groupUp: "Up", groupWindow: "Due", groupUpcoming: "Upcoming", groupUnknown: "Unknown",
  };
  const state = { saved: 0, rendered: 0 };
  const document = {
    activeElement: null,
    createElement: (tag) => {
      const element = new Element(tag);
      element.onFocus = () => { document.activeElement = element; };
      return element;
    },
    body: new Element("body"),
  };
  const context = vm.createContext({
    prefs, els, document,
    ui: () => words, rui: () => ({ alertOn: "On", alertOff: "Off", viaAll: "All", settings: "Settings", settingsOff: "Off" }),
    savePrefs: () => state.saved++, render: () => state.rendered++, renderAlerts() {}, openAlert() {},
    timeZone: () => "UTC", clock: () => ({ format: () => "12:00" }), text: (s) => s, span: String, age: String,
    nextOf: (ev) => ({ start: ev.start, end: ev.start + 1000 }), eventName: (ev) => ev.name,
    abyssLive: () => null, defaultLead: () => 5, fieldTimer: (id) => ({
      up: { state: "up", upSince: 1 }, next: { state: "dead", nextSpawn: 1000 },
    })[id] || null,
    ALL_FIELD: "field:all", SOON_MS: 900_000, WINDOW_MS: 900_000,
    BELL_ICON: "bell", GEAR_ICON: "gear", UP_ICON: "up",
  });
  vm.runInContext([
    section("function timerViews()", "// The header:"),
    section("function bossAlert(id)", "// The Bosses tab's buttons"),
    section("for (const list of [els.scheduled, els.field])", "// While a button is held"),
    section("function row({", "// World bosses: up ones first"),
    section("function fieldItems(", "function render()"),
    "globalThis.api = { timerViews, selectTab, renderTabs, rowActions, hideCountdown, renderSchedule, renderHidden, fieldItems };",
  ].join("\n"), context);
  return { prefs, els, state, document, api: context.api };
}

test("events and bosses can be shown together, with separate settings and alerts", () => {
  const h = harness();
  h.api.selectTab("bosses");
  assert.equal(h.els.views.events.hidden, false);
  assert.equal(h.els.views.bosses.hidden, false);
  assert.equal(h.els.eventsHead.hidden, false);
  assert.deepEqual(h.els.tabs.map((b) => b.attributes["aria-pressed"]), ["true", "true", "false", "false"]);
  h.api.selectTab("settings");
  assert.equal(h.els.views.events.hidden, true);
  assert.equal(h.els.views.bosses.hidden, true);
  assert.equal(h.els.views.settings.hidden, false);
  h.api.selectTab("events");
  assert.equal(h.els.views.events.hidden, false);
  assert.equal(h.els.views.bosses.hidden, false);
  h.api.selectTab("alerts");
  assert.equal(h.els.views.alerts.hidden, false);
  assert.equal(h.els.views.settings.hidden, true);
});

test("one list can be turned off without leaving an empty timer view", () => {
  const h = harness({ tab: "both", timerViews: ["events", "bosses"] });
  h.api.selectTab("events");
  assert.equal(h.prefs.tab, "bosses");
  assert.equal(h.els.views.events.hidden, true);
  assert.equal(h.els.views.bosses.hidden, false);
  h.api.selectTab("bosses");
  assert.equal(h.prefs.tab, "bosses");
  assert.equal(h.els.views.bosses.hidden, false);
});

test("older boss-only preferences and saved combined preferences retain their selection", () => {
  const old = harness({ tab: "bosses" });
  old.api.renderTabs();
  assert.equal(old.els.views.events.hidden, true);
  assert.equal(old.els.views.bosses.hidden, false);
  const saved = harness({ tab: "both", timerViews: ["events", "bosses"] });
  saved.api.renderTabs();
  assert.equal(saved.els.views.events.hidden, false);
  assert.equal(saved.els.views.bosses.hidden, false);
});

test("the boss row's hide action preserves alert settings and restores from Hidden", () => {
  const h = harness({ alerts: { "boss-kaira": 10, "field:up": 5 } });
  const actions = h.api.rowActions("boss-kaira");
  h.els.scheduled.append(actions);
  const hide = actions.children.find((b) => b.dataset.act === "hide");
  assert.equal(hide.attributes["aria-label"], "Hide");
  h.els.scheduled.listeners.click({ target: hide, preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(Array.from(h.prefs.hidden), ["boss-kaira"]);
  assert.equal(h.prefs.alerts["boss-kaira"], 10);
  h.api.renderHidden([{ ev: { id: "boss-kaira", name: "Kaira" } }], h.els.hiddenBosses);
  h.els.hiddenBosses.children.find((el) => el instanceof Element).click();
  assert.equal(h.prefs.hidden.length, 0);
  assert.equal(h.prefs.alerts["boss-kaira"], 10);
});

test("hidden scheduled and world bosses are left out without changing other rows", () => {
  const h = harness({ hidden: ["boss-hidden", "field:up"], alerts: { "field:up": 5 } });
  h.api.renderSchedule(h.els.scheduled, [
    { id: "boss-visible", name: "Visible", start: 3000, where: ["Map"] },
    { id: "boss-hidden", name: "Hidden", start: 2000, where: ["Map"] },
    { id: "boss-earlier", name: "Earlier", start: 1000, where: ["Map"] },
  ], 0, { hideable: true, actions: true });
  assert.deepEqual(h.els.scheduled.children.map((el) => el.dataset.id), ["boss-earlier", "boss-visible"]);
  const rows = h.api.fieldItems([
    { id: "up", name: "Up", where: "Map" },
    { id: "next", name: "Next", where: "Map" },
    { id: "unknown", name: "Unknown", where: "Map" },
  ], 100, true);
  assert.deepEqual(Array.from(rows).filter((el) => el.dataset.id).map((el) => el.dataset.id), ["field:next", "field:unknown"]);
  assert.equal(h.prefs.alerts["field:up"], 5);
});

test("hidden boss and event restore controls keep keyboard focus across timer redraws", () => {
  const h = harness({ hidden: ["boss-kaira", "festival"] });
  for (const [id, list] of [["boss-kaira", h.els.hiddenBosses], ["festival", h.els.hidden]]) {
    const shown = [{ ev: { id, name: id } }];
    h.api.renderHidden(shown, list);
    const original = list.children.find((el) => el instanceof Element);
    original.focus();
    h.api.renderHidden(shown, list);
    const replacement = list.children.find((el) => el instanceof Element);
    assert.notEqual(replacement, original);
    assert.equal(h.document.activeElement, replacement);
    assert.equal(replacement.dataset.restoreId, id);
    h.api.renderHidden(shown, list);
    assert.equal(h.document.activeElement.dataset.restoreId, id);
    assert.equal(list.contains(h.document.activeElement), true);
  }
});
