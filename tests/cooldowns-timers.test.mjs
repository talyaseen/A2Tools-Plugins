import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = (file) => readFileSync(new URL(`../plugins/cooldowns/${file}`, import.meta.url), "utf8");

function parser() {
  const context = vm.createContext({
    window: {}, TextEncoder, Date,
    document: { querySelector: () => ({ textContent: "" }), querySelectorAll: () => [] },
    a2: { storage: { set: async () => {}, get: async () => null } },
    setTimeout: () => 1, clearTimeout() {}, setInterval() {},
    renderSkills() {}, renderBuffs() {}, renderAll() {},
  });
  for (const file of ["skills.js", "selfbuffs.js", "i18n.js"]) vm.runInContext(source(file), context);
  const code = source("plugin.js").split("// ---- The page")[0];
  vm.runInContext(`${code}\nglobalThis.api = { onSkill, onCooldowns, onBuffAdded, onBuffChanged, live, loadCharacter, selectSetupScope, storage: a2.storage, mine: () => mine }; mine.cls = "12";`, context);
  return context.api;
}

class Element {
  className = "";
  children = [];
  hidden = false;
  textContent = "";
  style = { setProperty(key, value) { this[key] = value; } };
  classList = {
    toggle: (name, on) => {
      const classes = new Set(this.className.split(/\s+/).filter(Boolean));
      if (on) classes.add(name); else classes.delete(name);
      this.className = [...classes].join(" ");
    },
    add: (name) => this.classList.toggle(name, true),
    remove: (name) => this.classList.toggle(name, false),
    contains: (name) => this.className.split(/\s+/).includes(name),
  };
  append(child) {
    child.remove();
    child.parent = this;
    this.children.push(child);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  querySelector(selector) { return this.children.find((child) => child.classList.contains(selector.slice(1))); }
  addEventListener() {}
  getBoundingClientRect() { return { left: 0, top: 0, right: 42, bottom: 42 }; }
}

function widget(at = 1000) {
  const grid = new Element();
  const body = new Element();
  const handlers = new Map();
  let now = at;
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({
    window: {}, Date: Clock, setInterval() {},
    document: { body, documentElement: new Element(), querySelector: () => grid, createElement: () => new Element(), addEventListener() {} },
    a2: { on: (event, fn) => handlers.set(event, fn), ready() {}, widget: { area: async () => {}, post: async () => {} } },
  });
  vm.runInContext(`${source("widget.js")}\nglobalThis.api = {tick, nodes};`, context);
  return {
    body,
    show: (slots, look = {}) => handlers.get("widget")({ slots, look }),
    lock: (on) => handlers.get("locked")(on),
    at: (value) => { now = value; context.api.tick(); },
    node: (key) => context.api.nodes.get(key).el,
  };
}

test("Shield of Protection starts recharging after its first spent charge", () => {
  const p = parser();
  p.onSkill({ skill: 12110010 }, 1000);
  const charge = p.live.charges.get(12110000);
  assert.equal(charge.max, 2);
  assert.equal(charge.full, 21000);
  const w = widget();
  w.show([{ key: "shield", chMax: charge.max, chPer: charge.per, chFull: charge.full }]);
  const el = w.node("shield");
  assert.equal(el.hidden, false);
  assert.equal(el.classList.contains("recharging"), true);
  assert.equal(el.classList.contains("cooling"), false);
  assert.equal(el.querySelector(".chNum").textContent, "1");
  assert.equal(el.querySelector(".cdNum").textContent, "20");
  w.at(11000);
  assert.equal(el.querySelector(".cdNum").textContent, "10");
  assert.equal(el.style["--p"], "180deg");
  w.at(21000);
  assert.equal(el.hidden, true);
});

test("two spent charges count down to the next one, not the full recharge", () => {
  const p = parser();
  p.onSkill({ skill: 12110010 }, 1000);
  p.onSkill({ skill: 12110010 }, 3000);
  p.onCooldowns({ skills: [{ group: 12110000, ms: 17500 }] }, 3500);
  const charge = p.live.charges.get(12110000);
  assert.equal(charge.full, 41000);
  const w = widget(11000);
  w.show([{ key: "shield", chMax: charge.max, chPer: charge.per, chFull: charge.full }]);
  assert.equal(w.node("shield").querySelector(".cdNum").textContent, "10");
});

test("a recharging usable skill and its active buff keep both timers distinct", () => {
  const w = widget(1000);
  w.show([{ key: "shield", chMax: 2, chPer: 20000, chFull: 21000, buffStart: 1000, buffEnd: 11000 }]);
  assert.equal(w.node("shield").classList.contains("both"), true);
  assert.equal(w.node("shield").querySelector(".cdNum").textContent, "20");
  assert.equal(w.node("shield").querySelector(".buffNum").textContent, "10");
});

test("authoritative server corrections still update a charge after the estimate expires", () => {
  const p = parser();
  p.onSkill({ skill: 12110010 }, 1000);
  p.onCooldowns({ skills: [{ group: 12110000, ms: 19000 }] }, 2000);
  assert.equal(p.live.charges.get(12110000).full, 21000);
  p.onCooldowns({ skills: [{ group: 12110000, ms: 5000 }] }, 22000);
  assert.equal(p.live.charges.get(12110000).full, 27000);
});

test("buff refresh resets its visual interval together with its countdown", () => {
  const p = parser();
  p.onBuffAdded({ instance: 1, abnormal: 42, flags: 0, length: 10000, end: 1000011000 }, 1000);
  p.onBuffChanged({ instance: 1, abnormal: 42, length: 10000, end: 1000016000 }, 6000);
  const buff = p.live.buffs.get(1);
  assert.equal(buff.start, 6000);
  assert.equal(buff.end, 16000);
  const w = widget(6000);
  w.show([{ key: "fury", buff: true, buffStart: buff.start, buffEnd: buff.end }], { ring: true });
  assert.equal(w.node("fury").style["--r"], "360deg");
  w.at(11000);
  assert.equal(w.node("fury").style["--r"], "180deg");
});

test("ready icons hide while unlocked unless inactive preview is explicitly enabled", () => {
  const w = widget();
  w.show([{ key: "ready" }]);
  assert.equal(w.node("ready").hidden, true);
  w.show([{ key: "ready" }], { preview: true });
  assert.equal(w.node("ready").hidden, false);
  w.lock(true);
  assert.equal(w.node("ready").hidden, true);
  w.show([{ key: "ready", always: true }]);
  assert.equal(w.node("ready").hidden, false);
});

test("a buff change received without its add still uses the server's interval", () => {
  const p = parser();
  p.live.clock = 1000000000;
  p.onBuffChanged({ instance: 2, abnormal: 42, length: 15000, end: 1000016000 }, 6000);
  assert.equal(p.live.buffs.get(2).start, 1000);
  assert.equal(p.live.buffs.get(2).end, 16000);
});

test("clockwise buff fade follows elapsed time independently of the cooldown sweep", () => {
  const w = widget(3500);
  w.show([{ key: "buff", buff: true, buffStart: 1000, buffEnd: 11000 }], { buffStyle: "sweep" });
  assert.equal(w.body.classList.contains("buffSweepMode"), true);
  assert.equal(w.node("buff").style["--bp"], "90deg");
  assert.ok(w.node("buff").querySelector(".buffSweep"));
});

for (const explicitlyDisabled of [false, true]) {
  test(`casts during a class read preserve every new icon${explicitlyDisabled ? ' while respecting a disabled skill' : ''}`, async () => {
    const p = parser();
    await p.loadCharacter({ name: 'Guard', serverId: 1001, class: '수호성' });
    await p.selectSetupScope('class');
    let finish;
    p.storage.get = (key) => key === 'class_17' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(null);
    const loading = p.loadCharacter({ name: 'Healer', serverId: 1001, class: '치유성' });
    while (!finish) await Promise.resolve();
    p.onSkill({ skill: 17100010 }, 1000);
    p.onSkill({ skill: 17120010 }, 1100);
    finish({ skills: explicitlyDisabled ? { 17100000: { show: false } } : {}, buffs: {} });
    await loading;
    assert.equal(p.mine().skills[17100000].show, !explicitlyDisabled);
    assert.equal(p.mine().skills[17120000].show, true);
  });
}
