import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const fullScript = readFileSync(new URL('../plugins/cooldowns/plugin.js', import.meta.url), 'utf8');
const script = fullScript.split('// ---- What is happening')[0];
const renderRows = fullScript.slice(fullScript.indexOf('function renderSkills()'), fullScript.indexOf('const showCombatAfter'));
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
function setup() {
  const records = new Map();
  const elements = new Map();
  const fields = [{ disabled: false, setAttribute() {} }, { disabled: false, setAttribute() {} }];
  const storage = {
    get: async key => copy(records.get(key) ?? null),
    set: async (key, value) => { records.set(key, copy(value)); },
  };
  const context = vm.createContext({
    window: { COOLDOWN_DATA: { classes: { 12: { skills: [{ g: 12110000, cd: 20000, n: { en: 'Shield of Protection' } }] } }, buffs: { 1: {}, 2: {} } } }, UI: { en: { classes: { 12: 'Templar', 17: 'Cleric' } } },
    document: { querySelector: key => {
      if (!elements.has(key)) elements.set(key, { textContent: '', value: '', children: [], replaceChildren(...rows) { this.children = rows; } });
      return elements.get(key);
    }, querySelectorAll: selector => selector === '.setupChoices' ? fields : [] },
    a2: { storage }, TextEncoder, setTimeout: () => 1, clearTimeout() {},
    renderSkills() {}, renderAll() {},
    row: options => options, check: (text, on, change) => ({ text, on, change }),
    seconds: () => '20 s', cooldownOf: () => 20000, placeWidgets() {}, changed() {},
    live: { cd: new Map(), used: new Map(), unsure: new Set(), changed: new Set(), charges: new Map(), samples: new Map(), early: new Map(), buffs: new Map(), clock: null },
  });
  vm.runInContext(script + renderRows + `
    globalThis.state = {
      load: loadCharacter, scope: selectSetupScope, refresh: refreshClassSetup,
      flush: storeCurrentSetup, key: charStoreKey,
      mine: () => mine, active: () => activeClassSetup,
      name: () => charName, identity: () => charKey, prefs: () => prefs,
      live: () => live,
      render: () => { renderSkills(); renderBuffs(); },
    };
  `, context);
  return { state: context.state, records, storage, elements, fields };
}
const char = (name, cls = '수호성') => ({ name, serverId: 1001, class: cls });
const saved = (skill, learned, cls = '12') => ({
  cls, skills: { [skill]: { show: true, sound: true } },
  buffs: { [skill]: { show: true, always: true } }, learned: { [skill]: learned }, learnedV: 2,
});

test('character setups remain the default and independent', async () => {
  const { state, records } = setup();
  records.set(state.key('One@1001'), saved(1, 1000));
  records.set(state.key('Two@1001'), saved(2, 2000));
  await state.load(char('One'));
  assert.equal(state.prefs().setupScope, 'character');
  assert.deepEqual(Object.keys(state.mine().skills), ['1']);
  await state.load(char('Two'));
  assert.deepEqual(Object.keys(state.mine().skills), ['2']);
  assert.equal(records.has('class_12'), false);
});

test('class choices are shared but measurements and personal choices survive', async () => {
  const { state, records } = setup();
  records.set(state.key('One@1001'), saved(1, 1000));
  records.set(state.key('Two@1001'), saved(2, 2000));
  await state.load(char('One'));
  await state.scope('class');
  state.mine().skills = { 3: { show: true, voice: true } };
  state.mine().buffs = { 3: { show: true, always: true } };
  state.mine().learned[1] = 1234;
  await state.flush();
  assert.deepEqual(Object.keys(records.get(state.key('One@1001')).skills), ['1']);
  assert.equal(records.get(state.key('One@1001')).learned[1], 1234);
  assert.equal('learned' in records.get('class_12'), false);

  await state.load(char('Two'));
  assert.deepEqual(Object.keys(state.mine().skills), ['3']);
  assert.equal(state.mine().learned[2], 2000);
  assert.equal(state.mine().learned[1], undefined);
  state.mine().skills[4] = { show: true };
  await state.flush();
  await state.load(char('One'));
  assert.deepEqual(Object.keys(state.mine().skills), ['3', '4']);
  assert.equal(state.mine().learned[1], 1234);

  await state.scope('character');
  assert.deepEqual(Object.keys(state.mine().skills), ['1']);
  assert.equal(state.mine().learned[1], 1234);
  await state.load(char('Two'));
  assert.deepEqual(Object.keys(state.mine().skills), ['2']);
  await state.scope('class');
  assert.deepEqual(Object.keys(state.mine().skills), ['3', '4']);
});

test('class choices do not cross class boundaries', async () => {
  const { state, records } = setup();
  records.set(state.key('Guard@1001'), saved(1, 1000));
  records.set(state.key('Healer@1001'), saved(2, 2000, '17'));
  await state.load(char('Guard'));
  await state.scope('class');
  state.mine().skills[3] = { show: true };
  await state.flush();
  await state.load(char('Healer', '치유성'));
  assert.equal(state.active(), '17');
  assert.deepEqual(Object.keys(state.mine().skills), ['2']);
  await state.load(char('Guard'));
  assert.equal(state.active(), '12');
  assert.deepEqual(Object.keys(state.mine().skills), ['1', '3']);
});

test('a late character read cannot replace a newer character setup', async () => {
  const { state, records, storage } = setup();
  records.set(state.key('Two@1001'), saved(2, 2000));
  const original = storage.get;
  let finish;
  storage.get = key => key === state.key('One@1001')
    ? new Promise(resolve => { finish = resolve; }) : original(key);
  const first = state.load(char('One'));
  await state.load(char('Two'));
  finish(saved(1, 1000));
  await first;
  assert.equal(state.name(), 'Two');
  assert.deepEqual(Object.keys(state.mine().skills), ['2']);
});

test('a late class read cannot replace another character measurements', async () => {
  const { state, records, storage } = setup();
  records.set(state.key('One@1001'), saved(1, 1000));
  records.set(state.key('Two@1001'), saved(2, 2000));
  await state.load(char('One'));
  const original = storage.get;
  let finish;
  storage.get = key => key === 'class_12' && !finish
    ? new Promise(resolve => { finish = resolve; }) : original(key);
  const changing = state.scope('class');
  while (!finish) await Promise.resolve();
  await state.load(char('Two'));
  finish({ skills: { 3: { show: true } }, buffs: {} });
  await changing;
  assert.equal(state.name(), 'Two');
  assert.equal(state.mine().learned[2], 2000);
  assert.equal(state.mine().learned[1], undefined);
  assert.deepEqual(Object.keys(state.mine().skills), ['2']);
});

test('class sharing waits for a known class and then preserves character times', async () => {
  const { state, records } = setup();
  records.set(state.key('One@1001'), saved(1, 1000, null));
  await state.load(char('One', 'unknown'));
  await state.scope('class');
  assert.equal(state.active(), null);
  assert.deepEqual(Object.keys(state.mine().skills), ['1']);
  state.mine().cls = '12';
  await state.refresh();
  assert.equal(state.active(), '12');
  assert.equal(state.mine().learned[1], 1000);
  assert.deepEqual(Object.keys(records.get('class_12').skills), ['1']);
});

test('returning to character scope cancels an unfinished switch to class scope', async () => {
  const { state, records, storage } = setup();
  records.set(state.key('One@1001'), saved(1, 1000));
  await state.load(char('One'));
  const original = storage.set;
  let finish;
  storage.set = (key, value) => !finish && key === state.key('One@1001')
    ? new Promise(resolve => { finish = () => { original(key, value); resolve(); }; })
    : original(key, value);
  const changing = state.scope('class');
  await state.scope('character');
  finish();
  await changing;
  assert.equal(state.prefs().setupScope, 'character');
  assert.equal(state.active(), null);
  assert.equal(records.has('class_12'), false);
});

test('a first cast remains auto-added after its class setup finishes loading', async () => {
  const { state, records } = setup();
  records.set(state.key('One@1001'), saved(1, 1000, null));
  records.set('class_12', { skills: { 2: { show: true } }, buffs: {} });
  await state.load(char('One', 'unknown'));
  await state.scope('class');
  state.mine().cls = '12';
  const loading = state.refresh(12110000);
  state.mine().skills[12110000] = { show: true };
  await loading;
  assert.equal(state.mine().skills[12110000].show, true);
  assert.equal(state.mine().skills[2].show, true);
  assert.equal(state.mine().learned[1], 1000);
});

test('class setup loading preserves a skill explicitly turned off', async () => {
  const { state, records } = setup();
  records.set(state.key('One@1001'), saved(1, 1000, null));
  records.set('class_12', { skills: { 12110000: { show: false } }, buffs: {} });
  await state.load(char('One', 'unknown'));
  await state.scope('class');
  state.mine().cls = '12';
  await state.refresh(12110000);
  assert.equal(state.mine().skills[12110000].show, false);
});

test('changing characters clears live measurements and the prior server clock', async () => {
  const { state } = setup();
  await state.load(char('One'));
  for (const value of Object.values(state.live())) {
    if (value instanceof Map) value.set(12110000, { at: 1 });
    else if (value instanceof Set) value.add(12110000);
  }
  state.live().clock = 9876;
  await state.load(char('Two'));
  for (const value of Object.values(state.live())) if (value && typeof value.size === 'number') assert.equal(value.size, 0);
  assert.equal(state.live().clock, null);
});

test('returning to the displayed character cancels another character loading', async () => {
  const { state, records, storage } = setup();
  records.set(state.key('One@1001'), saved(1, 1000));
  await state.load(char('One'));
  const original = storage.get;
  let finish;
  storage.get = key => key === state.key('Two@1001')
    ? new Promise(resolve => { finish = resolve; }) : original(key);
  const second = state.load(char('Two'));
  while (!finish) await Promise.resolve();
  await state.load(char('One'));
  finish(saved(2, 2000));
  await second;
  assert.equal(state.name(), 'One');
  assert.deepEqual(Object.keys(state.mine().skills), ['1']);
  assert.equal(state.mine().learned[1], 1000);
});

test('a metadata refresh does not cancel an unfinished class setup selection', async () => {
  const { state, records, storage } = setup();
  records.set(state.key('One@1001'), saved(1, 1000));
  await state.load(char('One'));
  const original = storage.get;
  let finish;
  storage.get = key => key === 'class_12'
    ? new Promise(resolve => { finish = resolve; }) : original(key);
  const changing = state.scope('class');
  while (!finish) await Promise.resolve();
  await state.load(char('One'));
  finish({ skills: { 3: { show: true } }, buffs: {} });
  await changing;
  assert.equal(state.active(), '12');
  assert.deepEqual(Object.keys(state.mine().skills), ['3']);
});

test('an obsolete character request does not make a metadata refresh cancel class selection', async () => {
  const { state, records, storage } = setup();
  records.set(state.key('One@1001'), saved(1, 1000));
  await state.load(char('One'));
  const original = storage.get;
  let finishCharacter;
  let finishClass;
  storage.get = key => key === state.key('Two@1001')
    ? new Promise(resolve => { finishCharacter = resolve; })
    : key === 'class_12' ? new Promise(resolve => { finishClass = resolve; }) : original(key);
  const second = state.load(char('Two'));
  while (!finishCharacter) await Promise.resolve();
  const changing = state.scope('class');
  while (!finishClass) await Promise.resolve();
  await state.load(char('One'));
  finishClass({ skills: { 3: { show: true } }, buffs: {} });
  await changing;
  finishCharacter(saved(2, 2000));
  await second;
  assert.equal(state.name(), 'One');
  assert.equal(state.active(), '12');
  assert.deepEqual(Object.keys(state.mine().skills), ['3']);
});

test('a new identity clears old live state before a superseded class read', async () => {
  const { state, records, storage, elements } = setup();
  records.set(state.key('One@1001'), saved(1, 1000));
  records.set(state.key('Two@1001'), saved(2, 2000, '17'));
  await state.load(char('One'));
  await state.scope('class');
  state.live().cd.set(1, { start: 1, end: 10000 });
  state.live().used.set(1, 1);
  state.live().clock = 100;
  const original = storage.get;
  let finish;
  storage.get = key => key === 'class_17'
    ? new Promise(resolve => { finish = resolve; }) : original(key);
  const changing = state.load(char('Two', '치유성'));
  while (!finish) await Promise.resolve();
  assert.equal(state.name(), 'Two');
  assert.equal(elements.get('.char').textContent, 'Two');
  assert.equal(state.live().cd.size, 0);
  assert.equal(state.live().used.size, 0);
  assert.equal(state.live().clock, null);
  await state.scope('character');
  finish({ skills: { 3: { show: true } }, buffs: {} });
  await changing;
  assert.equal(state.name(), 'Two');
  assert.equal(elements.get('.char').textContent, 'Two');
  assert.deepEqual(Object.keys(state.mine().skills), ['2']);
});

test('a fresh cast survives while its character class setup is loading', async () => {
  const { state, records, storage } = setup();
  records.set(state.key('One@1001'), saved(1, 1000));
  records.set(state.key('Two@1001'), saved(2, 2000, '17'));
  await state.load(char('One'));
  await state.scope('class');
  const original = storage.get;
  let finish;
  storage.get = key => key === 'class_17'
    ? new Promise(resolve => { finish = resolve; }) : original(key);
  const changing = state.load(char('Two', '치유성'));
  while (!finish) await Promise.resolve();
  state.live().cd.set(2, { start: 100, end: 10100 });
  state.live().used.set(2, 100);
  finish({ skills: { 2: { show: true } }, buffs: {} });
  await changing;
  assert.equal(state.live().cd.get(2).end, 10100);
  assert.equal(state.live().used.get(2), 100);
});

for (const scope of ['class', 'character']) {
  test(`a ${scope} scope change cannot cancel the latest pending game character`, async () => {
    const { state, records, storage } = setup();
    records.set(state.key('One@1001'), saved(1, 1000));
    records.set(state.key('Two@1001'), saved(2, 2000, '17'));
    records.set('class_17', { skills: { 3: { show: true } }, buffs: {} });
    await state.load(char('One'));
    if (scope === 'character') await state.scope('class');
    const original = storage.get;
    let finish;
    storage.get = key => key === state.key('Two@1001')
      ? new Promise(resolve => { finish = resolve; }) : original(key);
    const changing = state.load(char('Two', '치유성'));
    while (!finish) await Promise.resolve();
    await state.scope(scope);
    finish(saved(2, 2000, '17'));
    await changing;
    assert.equal(state.name(), 'Two');
    assert.equal(state.prefs().setupScope, scope);
    assert.equal(state.active(), scope === 'class' ? '17' : null);
    assert.deepEqual(Object.keys(state.mine().skills), [scope === 'class' ? '3' : '2']);
    assert.equal(state.mine().learned[2], 2000);
    assert.equal(state.mine().learned[1], undefined);
  });
}

test('a pending scope save does not lose the choice when another identity commits first', async () => {
  const { state, records, storage } = setup();
  records.set(state.key('One@1001'), saved(1, 1000));
  records.set(state.key('Two@1001'), saved(2, 2000, '17'));
  records.set('class_17', { skills: { 3: { show: true } }, buffs: {} });
  await state.load(char('One'));
  const original = storage.set;
  let finish;
  storage.set = (key, value) => !finish && key === state.key('One@1001')
    ? new Promise(resolve => { finish = () => { original(key, value); resolve(); }; }) : original(key, value);
  const selecting = state.scope('class');
  await state.load(char('Two', '치유성'));
  assert.equal(state.name(), 'Two');
  assert.equal(state.active(), '17');
  finish();
  await selecting;
  assert.equal(state.name(), 'Two');
  assert.equal(state.prefs().setupScope, 'class');
  assert.deepEqual(Object.keys(state.mine().skills), ['3']);
});

test('learning the same character server keeps choices changed while its setup was loading', async () => {
  const { state, records, storage } = setup();
  records.set(state.key('One@'), saved(1, 1000));
  await state.load({ ...char('One'), serverId: 0 });
  const original = storage.get;
  let finish;
  storage.get = key => key === state.key('One@1001')
    ? new Promise(resolve => { finish = resolve; }) : original(key);
  const changing = state.load(char('One'));
  while (!finish) await Promise.resolve();
  state.mine().learned[1] = 1234;
  state.mine().skills[2] = { show: true };
  finish(null);
  await changing;
  assert.equal(state.mine().learned[1], 1234);
  assert.deepEqual(Object.keys(state.mine().skills), ['1', '2']);
});

const sameName = serverId => ({ name: 'SharedName', serverId, class: '수호성' });

test('same-name characters on known servers select separate saved profiles and clear live timers', async () => {
  const { state, records } = setup();
  records.set(state.key('SharedName@2101'), saved(1, 1000));
  records.set(state.key('SharedName@2109'), saved(2, 2000));
  await state.load(sameName(2101));
  state.live().cd.set(1, { start: 1, end: 10000 });
  state.live().used.set(1, 1);
  state.live().clock = 100;
  await state.load(sameName(2109));
  assert.equal(state.identity(), 'SharedName@2109');
  assert.deepEqual(Object.keys(state.mine().skills), ['2']);
  assert.equal(state.mine().learned[2], 2000);
  assert.equal(state.mine().learned[1], undefined);
  assert.equal(state.live().cd.size, 0);
  assert.equal(state.live().used.size, 0);
  assert.equal(state.live().clock, null);
  await state.flush();
  assert.deepEqual(Object.keys(records.get(state.key('SharedName@2101')).skills), ['1']);
  assert.equal(records.get(state.key('SharedName@2101')).learned[1], 1000);
});

test('a different known server without a saved profile starts fresh', async () => {
  const { state, records } = setup();
  records.set(state.key('SharedName@2101'), saved(1, 1000));
  await state.load(sameName(2101));
  await state.load(sameName(2109));
  assert.equal(state.identity(), 'SharedName@2109');
  assert.deepEqual(Object.keys(state.mine().skills), []);
  assert.deepEqual(Object.keys(state.mine().buffs), []);
  assert.deepEqual(Object.keys(state.mine().learned), []);
  assert.deepEqual(Object.keys(records.get(state.key('SharedName@2101')).skills), ['1']);
});

test('temporary server zero metadata preserves a known identity and its live state', async () => {
  const { state, records } = setup();
  records.set(state.key('SharedName@2101'), saved(1, 1000));
  await state.load(sameName(2101));
  state.live().cd.set(1, { start: 1, end: 10000 });
  await state.load(sameName(0));
  assert.equal(state.identity(), 'SharedName@2101');
  assert.deepEqual(Object.keys(state.mine().skills), ['1']);
  assert.equal(state.live().cd.get(1).end, 10000);
});

test('a saved real-server profile takes precedence over the provisional same-name setup', async () => {
  const { state, records } = setup();
  records.set(state.key('SharedName@'), saved(1, 1000));
  records.set(state.key('SharedName@2109'), saved(2, 2000));
  await state.load(sameName(0));
  await state.load(sameName(2109));
  assert.equal(state.identity(), 'SharedName@2109');
  assert.deepEqual(Object.keys(state.mine().skills), ['2']);
  assert.equal(state.mine().learned[2], 2000);
  assert.equal(state.mine().learned[1], undefined);
});

test('returning to the displayed full identity cancels a same-name other-server read', async () => {
  const { state, records, storage } = setup();
  records.set(state.key('SharedName@2101'), saved(1, 1000));
  await state.load(sameName(2101));
  const original = storage.get;
  let finish;
  storage.get = key => key === state.key('SharedName@2109')
    ? new Promise(resolve => { finish = resolve; }) : original(key);
  const switching = state.load(sameName(2109));
  for (let turn = 0; turn < 12 && !finish; turn++) await Promise.resolve();
  assert.equal(typeof finish, 'function', 'another known server must read its own profile');
  await state.load(sameName(2101));
  finish(saved(2, 2000));
  await switching;
  assert.equal(state.identity(), 'SharedName@2101');
  assert.deepEqual(Object.keys(state.mine().skills), ['1']);
  assert.equal(state.mine().learned[1], 1000);
});

test('class scope deliberately shares choices across servers while measurements remain personal', async () => {
  const { state, records } = setup();
  records.set(state.key('SharedName@2101'), saved(1, 1000));
  records.set(state.key('SharedName@2109'), saved(2, 2000));
  await state.load(sameName(2101));
  await state.scope('class');
  state.mine().skills = { 3: { show: true } };
  await state.flush();
  await state.load(sameName(2109));
  assert.equal(state.identity(), 'SharedName@2109');
  assert.equal(state.active(), '12');
  assert.deepEqual(Object.keys(state.mine().skills), ['3']);
  assert.equal(state.mine().learned[2], 2000);
  assert.equal(state.mine().learned[1], undefined);
  await state.scope('character');
  assert.deepEqual(Object.keys(state.mine().skills), ['2']);
  await state.load(sameName(2101));
  assert.deepEqual(Object.keys(state.mine().skills), ['1']);
  assert.equal(state.mine().learned[1], 1000);
});

const assertEditing = (fields, enabled) => {
  for (const field of fields) assert.equal(field.disabled, !enabled);
};
const waitFor = async ready => {
  for (let turn = 0; turn < 30 && !ready(); turn++) await Promise.resolve();
  assert.ok(ready(), 'the expected storage boundary must be reached');
};
const editRows = elements => {
  for (const selector of ['.skillList', '.buffList']) {
    for (const row of elements.get(selector).children) {
      row.onShow(true);
      for (const option of row.options) option.change(true);
    }
  }
};

test('profile loading disables row choices and rejects queued edits before and after a scope change', async () => {
  const { state, records, storage, elements, fields } = setup();
  records.set(state.key('One@1001'), saved(1, 1000));
  await state.load(char('One'));
  state.render();
  assertEditing(fields, true);
  const original = storage.get;
  let finish;
  storage.get = key => key === 'class_12'
    ? new Promise(resolve => { finish = resolve; }) : original(key);
  const changing = state.scope('class');
  await waitFor(() => finish);
  assertEditing(fields, false);
  const personal = copy(state.mine());
  editRows(elements);
  assert.deepEqual(copy(state.mine()), personal, 'show, always, sound and voice callbacks must reject pending edits');
  finish({ skills: { 2: { show: true } }, buffs: { 2: { show: true } } });
  await changing;
  assertEditing(fields, true);
  const shared = copy(state.mine());
  editRows(elements);
  assert.deepEqual(copy(state.mine()), shared, 'callbacks from the former scope must stay inert after loading');
  state.render();
  elements.get('.skillList').children[0].onShow(true);
  assert.equal(state.mine().skills[12110000].show, true, 'fresh row choices are available after loading');
  await state.scope('character');
  assert.deepEqual(Object.keys(state.mine().skills), ['1']);
});

test('row choices lock before the setup save and unlock when the scope change is cancelled', async () => {
  const { state, records, storage, elements, fields } = setup();
  records.set(state.key('One@1001'), saved(1, 1000));
  await state.load(char('One'));
  state.render();
  const original = storage.set;
  let finish;
  storage.set = (key, value) => key === state.key('One@1001') && !finish
    ? new Promise(resolve => { finish = () => { original(key, value); resolve(); }; }) : original(key, value);
  const changing = state.scope('class');
  assertEditing(fields, false);
  editRows(elements);
  assert.deepEqual(Object.keys(state.mine().skills), ['1']);
  await state.scope('character');
  assertEditing(fields, true);
  finish();
  await changing;
  assertEditing(fields, true);
  assert.equal(state.active(), null);
});

test('an obsolete setup read cannot unlock choices while a newer read is pending', async () => {
  const { state, records, storage, fields } = setup();
  records.set(state.key('One@1001'), saved(1, 1000));
  await state.load(char('One'));
  const original = storage.get;
  const finish = [];
  storage.get = key => key === 'class_12'
    ? new Promise(resolve => { finish.push(resolve); }) : original(key);
  const first = state.scope('class');
  await waitFor(() => finish.length === 1);
  const second = state.scope('class');
  await waitFor(() => finish.length === 2);
  finish[0]({ skills: { 2: { show: true } }, buffs: {} });
  await first;
  assertEditing(fields, false);
  finish[1]({ skills: { 3: { show: true } }, buffs: {} });
  await second;
  assertEditing(fields, true);
  assert.deepEqual(Object.keys(state.mine().skills), ['3']);
});

test('class discovery locks choices during its save and read and then allows fresh edits', async () => {
  const { state, records, storage, elements, fields } = setup();
  records.set(state.key('One@1001'), saved(1, 1000, null));
  await state.load(char('One', 'unknown'));
  await state.scope('class');
  state.mine().cls = '12';
  state.render();
  const originalSet = storage.set, originalGet = storage.get;
  let finishSave, finishRead;
  storage.set = (key, value) => key === state.key('One@1001') && !finishSave
    ? new Promise(resolve => { finishSave = () => { originalSet(key, value); resolve(); }; }) : originalSet(key, value);
  storage.get = key => key === 'class_12'
    ? new Promise(resolve => { finishRead = resolve; }) : originalGet(key);
  const refreshing = state.refresh();
  assertEditing(fields, false);
  editRows(elements);
  assert.deepEqual(Object.keys(state.mine().skills), ['1']);
  finishSave();
  await waitFor(() => finishRead);
  assertEditing(fields, false);
  finishRead({ skills: { 2: { show: true } }, buffs: {} });
  await refreshing;
  assertEditing(fields, true);
  state.render();
  elements.get('.skillList').children[0].options[1].change(true);
  assert.equal(state.mine().skills[12110000].sound, true);
});

test('character loading locks old choices through its save and class read but scope cancellation stays usable', async () => {
  const { state, records, storage, elements, fields } = setup();
  records.set(state.key('One@1001'), saved(1, 1000));
  records.set(state.key('Two@1001'), saved(2, 2000));
  await state.load(char('One'));
  await state.scope('class');
  state.render();
  const originalSet = storage.set, originalGet = storage.get;
  let finishSave, finishRead;
  storage.set = (key, value) => key === state.key('One@1001') && !finishSave
    ? new Promise(resolve => { finishSave = () => { originalSet(key, value); resolve(); }; }) : originalSet(key, value);
  storage.get = key => key === 'class_12'
    ? new Promise(resolve => { finishRead = resolve; }) : originalGet(key);
  const changing = state.load(char('Two'));
  assertEditing(fields, false);
  const previous = copy(state.mine());
  editRows(elements);
  assert.deepEqual(copy(state.mine()), previous);
  finishSave();
  await waitFor(() => finishRead);
  assert.equal(state.name(), 'Two');
  assertEditing(fields, false);
  await state.scope('character');
  assertEditing(fields, true);
  const current = copy(state.mine());
  editRows(elements);
  assert.deepEqual(copy(state.mine()), current, 'rows from another character cannot change this one');
  state.render();
  elements.get('.skillList').children[0].onShow(true);
  finishRead({ skills: { 3: { show: true } }, buffs: {} });
  await changing;
  assertEditing(fields, true);
  assert.equal(state.name(), 'Two');
  assert.equal(state.mine().skills[12110000].show, true);
  assert.equal(state.mine().skills[3], undefined);
});
