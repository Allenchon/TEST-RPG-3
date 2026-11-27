(function (R) {
  "use strict";
  const files = ["balance", "rules", "items", "enemies", "world"];
  let db;
  let pending;
  const index = (entries) => Object.fromEntries(entries.map((entry) => [entry.id, entry]));

  function register(data) {
    db = {
      ...data,
      races: index(data.rules.races),
      classes: index(data.rules.classes),
      actions: index([...data.rules.skills, ...data.rules.spells]),
      statuses: index(data.rules.statusEffects),
      curses: index(data.rules.curses),
      itemsById: index([...data.items.weapons, ...data.items.armors, ...data.items.consumables,
        ...data.items.uniques, ...data.items.relics]),
      enemiesById: index(Object.values(data.enemies).flat()),
      floors: Object.fromEntries(data.world.floors.map((floor) => [floor.floor, floor]))
    };
    return db;
  }

  function init() {
    if (db) return Promise.resolve(db);
    if (!pending) {
      pending = Promise.all(files.map(async (name) => {
        const response = await fetch("data/" + name + ".json");
        if (!response.ok) throw new Error(name + " 資料無法載入");
        return [name, await response.json()];
      })).then((entries) => register(Object.fromEntries(entries))).catch((error) => {
        pending = null;
        throw error;
      });
    }
    return pending;
  }

  R.DataLoader = { init, register, getDB: () => db };
}(globalThis.RPG3));
