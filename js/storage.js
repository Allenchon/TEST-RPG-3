(function (R, root) {
  "use strict";
  const key = "test_rpg3_save_v1";
  const defaultGambits = ["heal", "interrupt", "skill", "attack"];
  const injuries = () => ({ head: 0, torso: 0, arm: 0, leg: 0 });

  function fresh() {
    return {
      schemaVersion: 3, seed: 12345, difficulty: "standard", gold: 450,
      supplies: 10, torches: 4, fireSeeds: 0, townScrolls: 1,
      unlockedCampFloors: [1], clearedFloors: [], clearedZones: [],
      party: [], roster: [], inventory: [], codex: {}, commonSense: [],
      dungeonState: null, stats: { runs: 0, steps: 0, kills: 0, deaths: 0 },
      relics: [], pouch: {}, stash: [], hiddenClears: [], claimed: [],
      nextId: 0, preferences: { mute: false, auto: false, difficultyChosen: false }
    };
  }

  function migrate(raw) {
    const defaults = fresh();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
    const migrated = { ...defaults, ...raw, schemaVersion: 3 };
    for (const name of ["party", "roster"]) {
      migrated[name] = Array.isArray(raw[name]) ? raw[name].filter(Boolean).map((actor) => ({
        ...actor,
        soulScars: actor.soulScars ?? 0,
        injuries: { ...injuries(), ...actor.injuries },
        gambits: Array.isArray(actor.gambits) ? actor.gambits : [...defaultGambits]
      })) : [];
    }
    for (const name of ["unlockedCampFloors", "clearedFloors", "clearedZones", "inventory", "commonSense", "relics", "stash", "hiddenClears", "claimed"]) {
      if (!Array.isArray(migrated[name])) migrated[name] = defaults[name];
    }
    for (const name of ["codex", "pouch"]) {
      if (!migrated[name] || typeof migrated[name] !== "object" || Array.isArray(migrated[name])) migrated[name] = defaults[name];
    }
    if (!Number.isSafeInteger(migrated.nextId) || migrated.nextId < 0) migrated.nextId = 0;
    migrated.stats = { ...defaults.stats, ...raw.stats };
    migrated.preferences = { ...defaults.preferences, ...raw.preferences };
    return migrated;
  }

  function save(state) {
    try {
      root.localStorage.setItem(key, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }

  function load() {
    let raw = null;
    try { raw = JSON.parse(root.localStorage.getItem(key)); } catch { /* storage is optional */ }
    const state = migrate(raw);
    if (raw && (raw.schemaVersion ?? 0) < 3) save(state);
    return state;
  }

  function hash(bytes) {
    let value = 0x811c9dc5;
    for (const byte of bytes) value = Math.imul(value ^ byte, 0x01000193);
    return (value >>> 0).toString(16).padStart(8, "0");
  }

  function base64(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return root.btoa(binary);
  }

  function exportString(state) {
    const bytes = new TextEncoder().encode(JSON.stringify(state));
    return base64(bytes) + "." + hash(bytes);
  }

  function importString(text) {
    try {
      const parts = text.match(/^([A-Za-z0-9+/]+={0,2})\.([a-f0-9]{8})$/);
      if (!parts || parts[0] !== text) return null;
      const bytes = Uint8Array.from(root.atob(parts[1]), (char) => char.charCodeAt(0));
      if (base64(bytes) !== parts[1] || hash(bytes) !== parts[2]) return null;
      const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      const version = raw.schemaVersion ?? (Array.isArray(raw.party) ? 1 : 0);
      if (!Number.isInteger(version) || version < 1 || version > 3) return null;
      return migrate(raw);
    } catch {
      return null;
    }
  }

  R.Storage = { key, fresh, injuries, defaultGambits, migrate, load, save, exportString, importString };
}(globalThis.RPG3, globalThis));
