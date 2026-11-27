(function (R) {
  "use strict";
  const size = 24;
  const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const parts = ["head", "torso", "arm", "leg"];
  const key = (x, y) => x + "," + y;
  const cell = (state, x, y) => state.grid[y]?.[x] || 0;
  const featureAt = (state, x = state.x, y = state.y) => state.features[key(x, y)];
  const passable = (state, x, y) => cell(state, x, y) === 1 || state.revealed.includes(key(x, y));
  const here = (state) => key(state.x, state.y);

  function generateFloor(floorNum, seed, db) {
    const floor = db.floors[floorNum];
    if (!floor) throw new RangeError("Unknown floor");
    const rng = R.RNG.create((seed + Math.imul(floorNum, 3571)) >>> 0);
    const grid = Array.from({ length: size }, () => Array(size).fill(0));
    const route = [];
    for (const [index, [x, y]] of floor.path.entries()) {
      if (index === 0) {
        route.push([x, y]);
        continue;
      }
      let [a, b] = floor.path[index - 1];
      while (a !== x || b !== y) {
        a += Math.sign(x - a);
        b += Math.sign(y - b);
        route.push([a, b]);
      }
    }
    for (const [x, y] of route) grid[y][x] = 1;
    const features = {};
    const [x, y] = route[0];
    features[key(x, y)] = ["entry"];
    const [bossX, bossY] = route.at(-1);
    features[key(bossX, bossY)] = ["boss"];
    for (const [kind, [a, b]] of Object.entries(floor.features)) {
      const k = key(a, b);
      features[k] = [...(features[k] || []), kind];
      if (kind === "secret") grid[b][a] = 2;
      if (kind === "stairs" || kind === "rubble") grid[b][a] = 1;
    }
    // Grow branches from the route without breaking the main corridor into shortcuts.
    const fringe = [...route];
    let carved = 0;
    while (fringe.length && carved < 84) {
      const index = rng.int(0, fringe.length - 1);
      const [a, b] = fringe[index];
      const options = dirs.map(([dx, dy]) => [a + dx, b + dy]).filter(([nx, ny]) =>
        nx > 1 && nx < size - 2 && ny > 1 && ny < size - 2 && !grid[ny][nx] &&
        dirs.filter(([dx, dy]) => grid[ny + dy][nx + dx] !== 0).length === 1);
      if (!options.length) {
        fringe.splice(index, 1);
        continue;
      }
      const [nx, ny] = options[rng.int(0, options.length - 1)];
      grid[ny][nx] = 1;
      fringe.push([nx, ny]);
      carved += 1;
    }
    const trapTiles = [key(...floor.features.trap)];
    const branch = fringe.filter(([a, b]) => !route.some(([cx, cy]) => a === cx && b === cy));
    const randomTrap = branch[rng.int(0, Math.max(0, branch.length - 1))];
    if (randomTrap) trapTiles.push(key(...randomTrap));
    const state = {
      floor: floorNum, seed, grid, features, route, x, y, facing: 0,
      torch: 0, hazard: 0, seen: [], revealed: [], hints: [], defeated: [],
      traps: trapTiles, spentTraps: [], bonfireUsed: false, steps: 0
    };
    reveal(state);
    return state;
  }

  function reveal(state) {
    const seen = new Set(state.seen);
    seen.add(here(state));
    for (const [dx, dy] of dirs) {
      const x = state.x + dx;
      const y = state.y + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) seen.add(key(x, y));
    }
    state.seen = [...seen];
  }

  function scout(party) {
    const db = R.DataLoader.getDB();
    return Math.max(0, ...party.filter(standing).map((actor) =>
      (db.races[actor.race]?.passive.trap || 0) + (db.classes[actor.classId]?.passive.scout ? 0.25 : 0)));
  }

  function move(state, dir, party, rng) {
    const db = R.DataLoader.getDB();
    if (dir === "left" || dir === "right") {
      state.facing = (state.facing + (dir === "left" ? 3 : 1)) % 4;
      return { ok: true, turned: true };
    }
    const index = typeof dir === "number" ? dir : (state.facing + (dir === "back" ? 2 : 0)) % 4;
    if (!dirs[index]) return { ok: false, text: "方向不明。" };
    const [dx, dy] = dirs[index];
    const x = state.x + dx;
    const y = state.y + dy;
    if (!passable(state, x, y)) return { ok: false, text: "石壁擋住了去路。" };
    state.x = x;
    state.y = y;
    if (typeof dir === "number") state.facing = index;
    state.steps += 1;
    state.torch = Math.max(0, state.torch - 1);
    reveal(state);
    const spot = here(state);
    const features = featureAt(state) || [];
    const event = { ok: true, features, at: spot };
    if (state.traps.includes(spot) && !state.spentTraps.includes(spot)) {
      if (state.hints.includes(spot) || rng.next() < db.balance.trapNotice + scout(party)) {
        if (!state.hints.includes(spot)) state.hints.push(spot);
        event.text = "腳下有繃緊的細線。調查可嘗試解除。";
      } else {
        event.text = triggerTrap(state, party, spot, rng).text;
      }
    }
    const hasScout = party.some((actor) => standing(actor) && db.classes[actor.classId]?.passive.scout);
    if (!event.text && hasScout && dirs.some(([sx, sy]) => cell(state, x + sx, y + sy) === 2 && !passable(state, x + sx, y + sy))) {
      event.text = "馴獸遊俠察覺附近有一面空心石壁。";
    }
    state.hazard += rng.int(...db.balance.hazardPerStep);
    if (state.hazard >= db.balance.hazardThreshold) {
      state.hazard = 0;
      if (!state.defeated.includes("normal:" + spot)) event.encounter = "normal";
    }
    return event;
  }

  function triggerTrap(state, party, spot, rng) {
    state.spentTraps.push(spot);
    const candidates = party.filter(standing);
    const actor = candidates[rng.int(0, Math.max(0, candidates.length - 1))];
    if (!actor) return { ok: false, text: "舊機關已經落下。" };
    actor.hp = Math.max(1, actor.hp - Math.floor(actor.maxHp * 0.22));
    actor.injuries.leg = Math.max(1, actor.injuries.leg);
    return { ok: true, text: actor.name + "踩中機關，腳上見血。" };
  }

  function inspect(state, party, save, rng) {
    const db = R.DataLoader.getDB();
    const floor = db.floors[state.floor];
    const spot = here(state);
    const features = featureAt(state) || [];
    if (state.hints.includes(spot) && !state.spentTraps.includes(spot)) {
      if (rng.next() >= db.balance.trapDisarm + scout(party)) return triggerTrap(state, party, spot, rng);
      state.spentTraps.push(spot);
      return { ok: true, text: "你剪斷細線，機關鬆開。" };
    }
    if (features.includes("hearth") && save.relics.includes(floor.triggerRelicId) && !save.hiddenClears.includes(floor.hiddenBossId)) {
      return { ok: true, encounter: "hidden", at: spot };
    }
    if (features.includes("boss") && !save.clearedFloors.includes(state.floor)) return { ok: true, encounter: "boss", at: spot };
    if (features.includes("elite") && !state.defeated.includes("elite:" + spot)) return { ok: true, encounter: "elite", at: spot };
    const [dx, dy] = dirs[state.facing];
    const hidden = key(state.x + dx, state.y + dy);
    if (cell(state, state.x + dx, state.y + dy) === 2 && !state.revealed.includes(hidden)) {
      state.revealed.push(hidden);
      return { ok: true, text: "鬆磚後有條暗道。" };
    }
    if (features.includes("camp")) return { ok: true, overlay: "bonfire" };
    if (features.includes("stairs")) return { ok: true, overlay: "stairs" };
    if (features.includes("shortcut")) return { ok: true, overlay: "shortcut" };
    if (features.includes("entry")) return { ok: true, overlay: "retreat" };
    if (features.includes("inscription")) {
      return { ok: true, text: db.world.inscriptions.find((item) => item.floor === state.floor).text, common: "poise" };
    }
    if (features.includes("hearth")) return { ok: true, text: db.world.landmarks.find((item) => item.id === "hearth").desc, common: "relic" };
    if (features.includes("secret")) {
      if (floor.secretRelicId && save.clearedFloors.includes(state.floor)) return { ok: true, loot: floor.secretRelicId, text: "石縫裡躺著一只焦黑的小木碗。", common: "relic" };
      if (floor.secretRelicId) return { ok: true, text: "鼓還在響，壁龕被鐵扣鎖著。" };
      return { ok: true, loot: "ar_bead", text: "凹槽裡留著一串靜心木珠。" };
    }
    if (features.includes("rubble")) {
      if (save.clearedZones.includes(1)) return { ok: true, loot: "ar_watch_coat", text: "塌牆後露出一只木箱。" };
      return { ok: true, text: "倒牆壓住了一只木箱。" };
    }
    return { ok: false, text: "石縫裡只有冷氣。" };
  }

  const standing = (actor) => !actor.isDead && !actor.isDying;
  function recover(actor, pct, perRing, clearLight = false, slotFactor = 1) {
    if (!standing(actor)) return;
    const factor = actor.injuries.torso === 1 ? 0.75 : 1;
    actor.hp = Math.min(actor.maxHp, actor.hp + Math.floor(actor.maxHp * pct * factor));
    actor.slots = actor.slots.map((slots, i) => {
      const recovered = Math.min(perRing, actor.maxSlots[i] - slots);
      return slots + Math.round(recovered * slotFactor);
    });
    if (clearLight) for (const part of parts) if (actor.injuries[part] === 1) actor.injuries[part] = 0;
  }

  function fireFactor(party, rng) {
    const alignments = new Set(party.filter(standing).map((actor) => actor.alignment));
    return alignments.has("good") && alignments.has("evil") && !alignments.has("neutral") && rng.next() < 0.35 ? 0.85 : 1;
  }

  function useCamp(state, party, rng, resources = state) {
    const db = R.DataLoader.getDB();
    if (resources.supplies < 1 || !Number.isInteger(resources.supplies)) return { ok: false, text: "補給袋空了。" };
    resources.supplies -= 1;
    const factor = fireFactor(party, rng);
    for (const actor of party) recover(actor, db.balance.campHealPct * factor, 1, true, factor);
    const ambush = rng.next() < db.balance.campAmbushChance;
    return { ok: true, encounter: ambush ? "normal" : null, text: factor < 1 ? "火邊起了爭執，睡得很淺。" : "分過乾糧，石道仍冷。" };
  }

  function useBonfire(state, party, mode, rng, resources = state) {
    if (!(featureAt(state) || []).includes("camp")) return { ok: false, text: "附近沒有營火。" };
    if (state.bonfireUsed) return { ok: false, text: "這趟已在營火旁休息過。" };
    if (mode !== "small" && mode !== "full") return { ok: false, text: "火堆還在等人添柴。" };
    if (mode === "full" && !(resources.supplies > 0)) return { ok: false, text: "補給袋空了。" };
    const factor = fireFactor(party, rng);
    if (mode === "full") resources.supplies -= 1;
    state.bonfireUsed = true;
    for (const actor of party) {
      recover(actor, (mode === "full" ? 1 : 0.5) * factor, mode === "full" ? Infinity : 1, mode === "full", factor);
      if (mode === "full" && factor === 1 && standing(actor)) actor.hp = actor.maxHp;
    }
    const story = mode === "full" ? R.DataLoader.getDB().world.fireStory.find((entry) => entry.floor === state.floor)?.lines : null;
    return { ok: true, story, text: factor < 1 ? "火邊的爭執擾了睡意。" : "火光把潮氣逼出衣袖。" };
  }

  function relocate(state, position) {
    [state.x, state.y] = position;
    state.facing = 0;
    reveal(state);
  }

  R.Dungeon = { size, dirs, key, cell, featureAt, passable, here, generateFloor, move, inspect, useCamp, useBonfire, relocate };
}(globalThis.RPG3));
