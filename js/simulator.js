(function (R) {
  "use strict";
  const percent = (part, total) => Number((100 * part / total).toFixed(2));
  const standing = (actor) => R.Town.active(actor);

  const potionOrder = ["potion_large", "potion_small"];
  const medicineFor = (state, ids = potionOrder) => ids.find((id) => state.pouch[id] > 0);

  function reviveWithMedicine(state, db) {
    for (const actor of state.party.filter((entry) => entry.isDying)) {
      const potion = medicineFor(state, [...potionOrder].reverse());
      if (potion) R.Town.drink(state.pouch, actor, potion, db);
    }
  }

  function play(floor, type, state, db, rng, options = {}) {
    const battle = R.Combat.createEncounter(floor, type, state.party, db, rng, {
      autoMode: true, difficulty: state.difficulty, gold: state.gold, pouch: state.pouch, ...options
    });
    let potionTurns = 0;
    while (!battle.result) {
      if (options.fieldMedicine) {
        const medic = battle.party.filter(standing).sort((a, b) => b.derived.spd - a.derived.spd)[0];
        const injured = battle.party.filter((actor) => !actor.isDead)
          .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
        const potion = medicineFor(state);
        if (medic && injured && potion && injured.hp < injured.maxHp * 0.48) {
          const commands = Object.fromEntries(battle.party.filter(standing).map((actor) =>
            [actor.id, R.Combat.evalGambit(actor, battle, db)]));
          commands[medic.id] = { type: "item", itemId: potion, targetId: injured.uid };
          battle.autoMode = false;
          R.Combat.resolveTurn(battle, commands, db, rng);
          battle.autoMode = true;
          potionTurns += 1;
          continue;
        }
      }
      R.Combat.resolveTurn(battle, {}, db, rng);
    }
    const wins = battle.result === "victory";
    if (wins && options.progression) {
      const exp = battle.enemies.reduce((total, foe) => total + db.enemiesById[foe.id].xp, 0);
      for (const actor of state.party) R.Town.gainExp(actor, exp, db);
    }
    return { wins, turns: battle.turn, potionTurns, battle };
  }

  function trialSeed(rng) { return Math.floor(rng.next() * 4294967296); }

  function checkTrials(trials) {
    if (!Number.isSafeInteger(trials) || trials < 1) throw new RangeError("Trials must be a positive integer");
  }

  function runSingleTest(floor, type, trials = 1000, seed = 12345) {
    checkTrials(trials);
    const db = R.DataLoader.getDB();
    const series = R.RNG.create(seed);
    let wins = 0;
    let intact = 0;
    let turns = 0;
    for (let i = 0; i < trials; i += 1) {
      const state = R.Town.initialize(R.Storage.fresh(), db);
      const result = play(floor, type, state, db, R.RNG.create(trialSeed(series)));
      wins += Number(result.wins);
      intact += Number(result.wins && state.party.every(standing));
      turns += result.turns;
    }
    return { floor, type, seed, trials, wins, winRate: percent(wins, trials), intactRate: percent(intact, trials),
      meanTurns: Number((turns / trials).toFixed(2)) };
  }

  const sum = (items) => items.reduce((total, value) => total + value, 0);
  const health = (party) => sum(party.map((actor) => actor.hp)) / sum(party.map((actor) => actor.maxHp));
  const ringTotal = (party, key) => sum(party.map((actor) => sum(actor[key])));
  const spells = (party) => ringTotal(party, "slots") / Math.max(1, ringTotal(party, "maxSlots"));

  function prepareExpedition(db) {
    const state = R.Town.initialize(R.Storage.fresh(), db);
    state.supplies = db.balance.carryLimits.supplies;
    state.torches = db.balance.carryLimits.torches - 1;
    state.pouch = { potion_small: db.itemsById.potion_small.limit, potion_large: db.itemsById.potion_large.limit };
    const focus = { fighter: "STR", rogue: "AGI", cleric: "PIE", mage: "INT", ranger: "AGI" };
    const equipment = {
      fighter: { body: "ar_chain", offhand: "ar_iron_shield" },
      rogue: { offhand: "ar_wood_shield" },
      cleric: { weapon: "wp_votive" },
      ranger: { weapon: "wp_yew_bow" }
    };
    for (const actor of state.party) {
      actor.level = 4;
      actor.attributes.VIT += 4;
      actor.attributes[focus[actor.classId]] += 2;
      Object.assign(actor.equipment, equipment[actor.classId]);
      if (actor.classId === "cleric") actor.gambits = ["heal", "interrupt", "attack", "skill"];
      R.Town.refresh(actor, true, db);
    }
    return state;
  }

  function measureResources(state, run, db) {
    const { party } = state;
    const limits = db.balance.carryLimits;
    const medicine = Object.keys(state.pouch);
    return {
      hp: [sum(party.map((actor) => actor.hp / actor.maxHp)), party.length],
      spells: [ringTotal(party, "slots"), ringTotal(party, "maxSlots")],
      supplies: [state.supplies, limits.supplies],
      light: [state.torches + Math.max(0, run.torch) / db.balance.torchSteps, limits.torches],
      medicine: [sum(Object.values(state.pouch)), sum(medicine.map((id) => db.itemsById[id].limit))],
      scroll: [state.townScrolls, limits.townScrolls]
    };
  }

  function runGauntletTest(floor, trials = 1000, seed = 12345) {
    checkTrials(trials);
    const db = R.DataLoader.getDB();
    const series = R.RNG.create(seed);
    const resources = {};
    let unitsLeft = 0;
    let unitsFull = 0;
    let arrived = 0;
    let intact = 0;
    let ambushes = 0;
    let medicineTurns = 0;
    for (let i = 0; i < trials; i += 1) {
      const rng = R.RNG.create(trialSeed(series));
      const state = prepareExpedition(db);
      const run = { torch: db.balance.torchSteps, hazard: 0 };
      let completed = true;
      for (let stage = 0; stage < 7; stage += 1) {
        while (run.hazard < db.balance.hazardThreshold) {
          run.hazard += rng.int(...db.balance.hazardPerStep);
          run.torch -= 1;
          if (run.torch <= 0 && state.torches) {
            state.torches -= 1;
            run.torch = db.balance.torchSteps;
          }
        }
        run.hazard = 0;
        const type = stage === 6 ? "elite" : "normal";
        if (stage > 0 && stage < 6 && (health(state.party) < 0.82 || spells(state.party) < 0.50)) {
          const camp = R.Dungeon.useCamp(run, state.party, rng, state);
          // An ambush fills this leg's normal encounter slot.
          if (camp.encounter) ambushes += 1;
        }
        const result = play(floor, type, state, db, rng, { fieldMedicine: true, progression: true, dark: run.torch <= 0 });
        medicineTurns += result.potionTurns;
        if (!result.wins) {
          completed = false;
          break;
        }
        reviveWithMedicine(state, db);
      }
      if (!completed) continue;
      arrived += 1;
      if (state.party.every(standing)) intact += 1;
      for (const [key, [left, full]] of Object.entries(measureResources(state, run, db))) {
        resources[key] = (resources[key] || 0) + left / Math.max(1, full);
        unitsLeft += left;
        unitsFull += full;
      }
    }
    return { floor, seed, trials, arrived, intact, arrivalRate: percent(arrived, trials), intactRate: percent(intact, trials),
      remainingResources: percent(unitsLeft, Math.max(1, unitsFull)),
      breakdown: Object.fromEntries(Object.entries(resources).map(([key, value]) => [key, percent(value, Math.max(1, arrived))])),
      meanAmbushes: Number((ambushes / trials).toFixed(2)), meanMedicineTurns: Number((medicineTurns / trials).toFixed(2)) };
  }

  R.Simulator = { runSingleTest, runGauntletTest };
}(globalThis.RPG3 || (globalThis.RPG3 = {})));

// Node runs the same modules and JSON as the browser without a DOM.
if (typeof module !== "undefined" && typeof require === "function" && require.main === module) {
  const fs = require("node:fs");
  const path = require("node:path");
  const assert = require("node:assert/strict");
  for (const file of ["rng", "storage", "data_loader", "formulas", "dungeon", "combat", "town"]) require("./" + file + ".js");
  const R = globalThis.RPG3;
  const files = ["balance", "rules", "items", "enemies", "world"];
  const db = R.DataLoader.register(Object.fromEntries(files.map((file) => [
    file, JSON.parse(fs.readFileSync(path.join(__dirname, "../data", file + ".json"), "utf8"))
  ])));
  const trials = 1000;
  const seed = 12345;

  function fightTrace() {
    const state = R.Town.initialize(R.Storage.fresh(), db);
    const rng = R.RNG.create(seed);
    const battle = R.Combat.createEncounter(1, "boss", state.party, db, rng, { autoMode: true });
    const turns = [];
    while (!battle.result) turns.push(R.Combat.resolveTurn(battle, {}, db, rng));
    return { turns, result: battle.result, rng: rng.snapshot() };
  }

  const verifyText = (entries, max) => {
    for (const value of entries) assert(Array.from(value).length <= max, value);
  };
  const trace = fightTrace();
  assert.deepEqual(trace, fightTrace());
  verifyText(trace.turns.flat(), 18);
  assert(trace.turns.flat().every((line) => !/[0-9]/.test(line)));
  const descriptions = [...Object.values(db.actions), ...Object.values(db.itemsById)].map((item) => item.desc);
  verifyText(descriptions, 32);
  assert(descriptions.every((desc) => !/\d+\s*d\s*\d+|[%％]/i.test(desc)));
  verifyText(db.world.inscriptions.map((entry) => entry.text), 55);
  verifyText(db.world.fireStory.flatMap((entry) => entry.lines), 28);
  verifyText(db.world.rumors.map((entry) => entry.text), 65);
  verifyText(db.world.codex.map((entry) => entry.text), 60);
  verifyText(db.world.commonSense.map((entry) => entry.text), 48);

  const storage = R.Storage;
  const token = storage.exportString(storage.fresh());
  assert.deepEqual(storage.importString(token), storage.fresh());
  for (let i = 0; i < token.length; i += 1) {
    const changed = token[i] === "A" ? "B" : "A";
    assert.equal(storage.importString(token.slice(0, i) + changed + token.slice(i + 1)), null);
  }
  const old = storage.importString(storage.exportString({ schemaVersion: 2, party: [{ name: "雷恩" }] }));
  assert.equal(old.schemaVersion, 3);
  assert.deepEqual(old.party[0].injuries, storage.injuries());
  assert.equal(old.party[0].soulScars, 0);
  assert.deepEqual(old.party[0].gambits, storage.defaultGambits);

  const state = R.Town.initialize(storage.fresh(), db);
  const floor = R.Dungeon.generateFloor(1, seed, db);
  const rng = R.RNG.create(seed);
  for (const data of db.world.floors) {
    const map = R.Dungeon.generateFloor(data.floor, seed, db);
    assert.equal(map.grid.length, 24);
    assert(map.grid.every((row) => row.length === 24));
    const pathLength = map.route.length - 1;
    assert(pathLength >= data.targetSteps[0] && pathLength <= data.targetSteps[1]);
  }
  const features = db.floors[1].features;
  const elite = "elite:" + features.elite.join(",");
  floor.defeated.push(elite);
  R.Dungeon.relocate(floor, features.camp);
  assert(R.Dungeon.useBonfire(floor, state.party, "full", rng, state).ok);
  assert.deepEqual(floor.defeated, [elite]);
  assert(!R.Dungeon.useBonfire(floor, state.party, "small", rng, state).ok);
  R.Dungeon.relocate(floor, features.elite);
  assert(!R.Dungeon.inspect(floor, state.party, state, rng).encounter);

  const lower = R.Dungeon.generateFloor(2, seed, db);
  const [secretX, secretY] = db.floors[2].features.secret;
  R.Dungeon.relocate(lower, [secretX, secretY - 1]);
  lower.facing = 2;
  assert(R.Dungeon.inspect(lower, state.party, state, rng).ok);
  assert(R.Dungeon.move(lower, "forward", state.party, rng).ok);
  assert(!R.Dungeon.inspect(lower, state.party, state, rng).loot);
  state.clearedFloors.push(2);
  const relic = R.Dungeon.inspect(lower, state.party, state, rng).loot;
  assert.equal(relic, "rel_charred_bowl");
  R.Dungeon.relocate(floor, features.hearth);
  assert(!R.Dungeon.inspect(floor, state.party, state, rng).encounter);
  assert(R.Town.addLoot(state, relic));
  const hidden = R.Dungeon.inspect(floor, state.party, state, rng).encounter;
  assert.equal(hidden, "hidden");
  assert.equal(R.Combat.createEncounter(1, hidden, state.party, db, rng).enemies[0].id, "hb_1_fire_child");

  const single = ["normal", "elite", "boss"].map((type) => R.Simulator.runSingleTest(1, type, trials, seed));
  const expedition = R.Simulator.runGauntletTest(1, trials, seed);
  const inRange = (num, min, max) => num >= min && num <= max;
  const passed = inRange(single[0].winRate, 88, 96) && inRange(single[1].winRate, 68, 78) &&
    inRange(single[2].winRate, 75, 82) && expedition.intactRate >= 85 && inRange(expedition.remainingResources, 30, 45);
  console.log(JSON.stringify({
    single, expedition,
    checks: { determinism: true, saveChecksumAndMigration: true, copyLimits: true, maps: true, bonfire: true, hiddenBoss: true, balance: passed }
  }, null, 2));
  if (!passed) process.exitCode = 1;
}
