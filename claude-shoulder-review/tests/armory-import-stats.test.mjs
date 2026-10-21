import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeArmoryImport } from '../src/wf-armory-import.mjs';

const exportV1 = (extra = {}) => ({
  schema: 'wfa-armory-export-v1',
  addon_version: '0.1.2',
  client: { version: '1.60.1', build: '70425' },
  character: { name: 'Мертвая', realm: 'Classic Beta PvP', level: 23, race: 'Нежить', race_token: 'Scourge', class: 'Чернокнижник', class_token: 'WARLOCK', faction: 'Horde' },
  equipment: { shoulder: { slot_id: 3, item_id: 271754, quality: 4 } },
  ...extra
});

test('addon character stats are passed through unchanged', () => {
  const stats = {
    health_max: 812,
    primary: { strength: { base: 30, effective: 32, bonus: 2, penalty: 0 } },
    armor: { base: 300, effective: 412, bonus: 112, penalty: 0 },
    spell: { crit_chance: { shadow: 3.6 } }
  };
  const profile = normalizeArmoryImport(exportV1({ stats }));
  assert.deepEqual(profile.stats, stats);
  assert.equal(profile.__wfaArmoryPilot.addonVersion, '0.1.2');
  assert.equal(profile.gear.items.shoulder.item_id, 271754);
});

test('exports from addon 0.1.1 without stats still import', () => {
  const profile = normalizeArmoryImport(exportV1());
  assert.equal(profile.stats, null);
  assert.equal(profile.name, 'Мертвая');
});

test('item quality falls back to the WoW Forever link colour code', () => {
  const profile = normalizeArmoryImport(exportV1({
    equipment: {
      chest: { slot_id: 5, item_id: 57, item_link: "|cnIQ0:|Hitem:57::::::::1:1490::75:::::::|h[Acolyte's Robe]|h|r" },
      feet: { slot_id: 8, item_id: 59, item_link: "|cnIQ1:|Hitem:59::::::::1:1490::75:::::::|h[Acolyte's Shoes]|h|r", quality: 2 }
    }
  }));
  assert.equal(profile.gear.items.chest.quality, 0);
  assert.equal(profile.gear.items.chest.name, "Acolyte's Robe");
  assert.equal(profile.gear.items.feet.quality, 2, 'explicit quality wins');
});
