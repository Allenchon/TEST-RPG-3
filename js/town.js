(function (R) {
  "use strict";
  const db = () => R.DataLoader.getDB();
  const ok = (text, extra) => ({ ok: true, text, ...extra });
  const fail = (text) => ({ ok: false, text });
  const all = (state) => [...state.party, ...state.roster];
  const find = (state, id) => all(state).find((actor) => actor.id === id);
  const parts = ["head", "torso", "arm", "leg"];
  const alignment = ["good", "neutral", "evil"];
  const active = (actor) => !actor.isDead && !actor.isDying;

  function slotCaps(actor, data) {
    const base = data.classes[actor.classId].base || actor.classId;
    if (!["mage", "cleric"].includes(base) && !["lord"].includes(actor.classId)) return [0, 0, 0];
    return [Math.min(9, 4 + Math.floor((actor.level - 1) / 2)),
      actor.level >= 4 ? Math.min(7, 2 + Math.floor((actor.level - 4) / 2)) : 0,
      actor.level >= 7 ? Math.min(6, 2 + Math.floor((actor.level - 7) / 3)) : 0];
  }

  function refresh(actor, fill = false, data = db()) {
    actor.derived = R.Formulas.calcDerivedStats(actor, data);
    const oldHp = actor.maxHp ?? (actor.hp == null ? 0 : actor.derived.maxHp);
    actor.maxHp = actor.derived.maxHp;
    actor.maxSlots = slotCaps(actor, data);
    const job = data.classes[actor.classId];
    const learn = [data.classes[job.base], job].filter(Boolean);
    actor.learned = [...new Set(learn.flatMap((entry) => Object.entries(entry.learnTable)
      .filter(([level]) => Number(level) <= actor.level).flatMap(([, ids]) => ids)))];
    if (fill) {
      actor.hp = actor.isDead ? 0 : actor.maxHp;
      actor.slots = [...actor.maxSlots];
    } else {
      if (active(actor)) actor.hp = Math.max(1, Math.min(actor.maxHp, (actor.hp ?? oldHp) + Math.max(0, actor.maxHp - oldHp)));
      actor.slots = actor.maxSlots.map((cap, i) => Math.min(cap, actor.slots?.[i] ?? cap));
    }
    return actor;
  }

  function makeActor(state, input, data = db()) {
    const job = data.classes[input.classId];
    const id = "pc-" + (++state.nextId);
    const actor = {
      id, uid: id, name: input.name, race: input.race, classId: input.classId, alignment: input.alignment,
      slot: input.slot ?? null, level: 1, exp: 0, points: 0,
      attributes: { ...data.races[input.race].stats },
      equipment: { weapon: job.starter, ...input.equipment }, soulScars: 0, injuries: R.Storage.injuries(),
      gambits: [...R.Storage.defaultGambits], statuses: [], cooldowns: {}, isPlayer: true,
      isDead: false, isDying: false
    };
    return refresh(actor, true, data);
  }

  function initialize(state, data = db()) {
    if (!state.party.length) state.party = data.world.defaultParty.map((entry) => makeActor(state, entry, data));
    const actors = all(state);
    for (const actor of actors) {
      const suffix = /^pc-(\d+)$/.exec(actor.id);
      if (suffix) state.nextId = Math.max(state.nextId, Number(suffix[1]));
    }
    const ids = new Set();
    for (const actor of actors) {
      if (!actor.id || ids.has(actor.id)) actor.id = "pc-" + (++state.nextId);
      ids.add(actor.id);
      if (!data.races[actor.race]) actor.race = "human";
      if (!data.classes[actor.classId]) actor.classId = "fighter";
      if (!alignment.includes(actor.alignment)) actor.alignment = "neutral";
      actor.level ??= 1;
      actor.exp ??= 0;
      actor.points ??= 0;
      actor.attributes = { ...data.races[actor.race].stats, ...actor.attributes };
      actor.equipment ??= { weapon: data.classes[actor.classId].starter || data.classes[data.classes[actor.classId].base]?.starter };
      actor.uid = actor.id;
      actor.isPlayer = true;
      actor.isDead = Boolean(actor.isDead);
      actor.isDying = Boolean(actor.isDying);
      actor.statuses = actor.statuses || [];
      actor.cooldowns = actor.cooldowns || {};
      refresh(actor, false, data);
    }
    for (const [slot, actor] of state.party.entries()) actor.slot = slot;
    for (const actor of state.roster) actor.slot = null;
    return state;
  }

  function gainExp(actor, amount, data) {
    if (actor.isDead || actor.level >= 30) return false;
    actor.exp += Math.floor(amount * (data.races[actor.race].passive.exp || 1));
    const previous = actor.level;
    const previousSlots = [...actor.maxSlots];
    while (actor.level < 30 && actor.exp >= R.Formulas.nextExp(actor.level)) {
      actor.exp -= R.Formulas.nextExp(actor.level);
      actor.level += 1;
      actor.points += 2;
    }
    if (actor.level === 30) actor.exp = 0;
    if (actor.level === previous) return false;
    refresh(actor, false, data);
    actor.slots = actor.slots.map((count, i) => count + Math.max(0, actor.maxSlots[i] - previousSlots[i]));
    return true;
  }

  function restAtInn(state) {
    if (state.dungeonState) return fail("旅店在地面上。");
    const cost = db().balance.innPrice;
    if (state.gold < cost) return fail("金幣不足。");
    state.gold -= cost;
    for (const actor of state.party) {
      if (actor.isDead) continue;
      actor.isDying = false;
      actor.dyingTimer = 0;
      for (const part of parts) if (actor.injuries[part] === 1) actor.injuries[part] = 0;
      refresh(actor, true);
    }
    return ok("睡了一夜，壁爐還有餘溫。");
  }

  function limit(state, id) {
    const data = db();
    if (id === "supplies" && state.clearedZones.includes(1)) return data.world.zones[0].supplyLimit;
    return data.balance.carryLimits[id] ?? data.itemsById[id]?.limit ?? 0;
  }

  function stock(state) {
    const data = db();
    const standard = [...data.items.consumables, ...data.items.weapons, ...data.items.armors].filter((item) => item.tier == null || item.tier < 3);
    return state.clearedZones.includes(1) ? [...standard, ...data.world.zones[0].magicStock.map((id) => data.itemsById[id])] : standard;
  }

  function addLoot(state, id, identified = true, guaranteed = false) {
    if (db().items.relics.some((item) => item.id === id)) {
      if (!state.relics.includes(id)) state.relics.push(id);
      return true;
    }
    if (state.inventory.length >= limit(state, "bag")) {
      if (!guaranteed) return false;
      state.stash.push({ id, identified });
      return true;
    }
    state.inventory.push({ id, identified });
    return true;
  }

  function buyItem(state, itemId, qty = 1) {
    const item = stock(state).find((entry) => entry.id === itemId);
    if (state.dungeonState || !item || !Number.isInteger(qty) || qty < 1) return fail("這筆交易無法成交。");
    const cost = qty * R.Formulas.price(item);
    if (state.gold < cost) return fail("金幣不足。");
    if (item.field) {
      if (state[item.field] + qty > limit(state, itemId)) return fail("攜帶量已滿。");
      state[item.field] += qty;
    } else if (item.limit) {
      const count = state.pouch[itemId] || 0;
      if (count + qty > limit(state, itemId)) return fail("攜帶量已滿。");
      state.pouch[itemId] = count + qty;
    } else {
      if (state.inventory.length + qty > limit(state, "bag")) return fail("裝備背包已滿。");
      for (let i = 0; i < qty; i += 1) addLoot(state, itemId);
    }
    state.gold -= cost;
    return ok("已收入行囊。");
  }

  function sell(state, index) {
    const entry = state.inventory[index];
    const item = db().itemsById[R.Formulas.itemId(entry)];
    if (state.dungeonState || !item || entry.identified === false) return fail("先鑑定這件物品。");
    state.gold += R.Formulas.price(item, true);
    state.inventory.splice(index, 1);
    return ok("商人收下了裝備。");
  }

  function identify(state, index, rng) {
    const entry = state.inventory[index];
    if (state.dungeonState || !entry || entry.identified !== false) return fail("這件裝備已經辨明。");
    const candidates = state.party.filter(active);
    const free = candidates.some((actor) => db().classes[actor.classId].passive.freeIdentify);
    if (free) {
      entry.identified = true;
      return ok("主教辨出裝備上的刻記。");
    }
    if (state.gold < 20) return fail("鑑定需要二十枚金幣。");
    const advantage = Math.max(0, ...candidates.map((actor) => db().races[actor.race].passive.identify || 0));
    state.gold -= 20;
    entry.identified = rng.next() < 0.82 + advantage;
    return entry.identified ? ok("記號與舊帳冊相符。") : fail("刻痕太淺，商人沒能辨出來。");
  }

  function reviveChar(state, charId) {
    const actor = find(state, charId);
    if (state.dungeonState || !actor?.isDead) return fail("神殿無需為此人喚魂。");
    const cost = 150 * actor.level;
    if (state.gold < cost) return fail("金幣不足。");
    state.gold -= cost;
    actor.soulScars = Math.min(db().balance.soulScarMax, actor.soulScars + 1);
    actor.isDead = false;
    actor.isDying = false;
    actor.dyingTimer = 0;
    refresh(actor, true);
    return ok("氣息回來了，傷痕留在魂上。");
  }

  function treat(state, charId) {
    const actor = find(state, charId);
    if (state.dungeonState || !actor || actor.isDead || !Object.values(actor.injuries).some(Boolean)) return fail("此人無需縫傷。");
    const cost = db().balance.injuryTreatment;
    if (state.gold < cost) return fail("金幣不足。");
    state.gold -= cost;
    actor.injuries = R.Storage.injuries();
    refresh(actor);
    return ok("傷處重新包紮過了。");
  }

  function removeCurse(state, charId) {
    const actor = find(state, charId);
    if (state.dungeonState || !actor || actor.isDead) return fail("神殿無法在這裡施術。");
    const cursed = Object.entries(actor.equipment).filter(([, entry]) => db().itemsById[R.Formulas.itemId(entry)]?.curse && !entry.uncursed);
    if (!cursed.length) return fail("此人身上沒有詛咒。");
    if (state.gold < db().balance.curseRemoval) return fail("金幣不足。");
    state.gold -= db().balance.curseRemoval;
    for (const [slot, entry] of cursed) actor.equipment[slot] = { id: R.Formulas.itemId(entry), uncursed: true };
    refresh(actor);
    return ok("鐵圈鬆開，再無脈動。");
  }

  function advanceClass(state, charId, targetClassId) {
    const actor = find(state, charId);
    const target = db().classes[targetClassId];
    if (state.dungeonState || !actor || !active(actor) || !target || actor.level < 10 ||
        !db().classes[actor.classId].advancements.includes(targetClassId) || !state.relics.includes("trial_badge")) {
      return fail("進階需要足夠的歷練與試煉徽記。");
    }
    state.relics.splice(state.relics.indexOf("trial_badge"), 1);
    actor.classId = targetClassId;
    refresh(actor);
    return ok(actor.name + "踏上了新的修行。");
  }

  function allocate(state, id, stat) {
    const actor = find(state, id);
    if (state.dungeonState || !actor || !actor.points || !R.Formulas.stats.includes(stat)) return fail("沒有可分配的屬性點。");
    actor.attributes[stat] += 1;
    actor.points -= 1;
    refresh(actor);
    return ok("修練留下了痕跡。");
  }

  function fits(actor, slot) {
    const job = db().classes[actor.classId];
    const base = job.base || actor.classId;
    if (base === "fighter") return slot < db().balance.frontSlots;
    if (base === "mage" || base === "ranger") return slot >= db().balance.frontSlots;
    return true;
  }

  function recruit(state, input) {
    const name = String(input.name || "").trim();
    const race = db().races[input.race];
    const job = db().classes[input.classId];
    if (state.dungeonState || !name || Array.from(name).length > 8 || !race || job?.tier !== 1 ||
        !alignment.includes(input.alignment)) return fail("請填妥姓名、出身與陣營。");
    const equipment = { body: "ar_quilt" };
    if (job.id === "fighter") equipment.offhand = "ar_wood_shield";
    state.roster.push(makeActor(state, { ...input, name, equipment }));
    return ok(name + "在酒館候命。");
  }

  function place(state, id, slot) {
    const actor = find(state, id);
    const old = state.party[slot];
    if (state.dungeonState || !actor || !old || !fits(actor, slot)) return fail("這個職業無法站在該列。");
    if (actor === old) return ok("站位維持原樣。");
    const current = state.party.indexOf(actor);
    if (current >= 0) {
      if (!fits(old, current)) return fail("換位後有人無法站在該列。");
      state.party[current] = old;
      old.slot = current;
    } else {
      state.roster.splice(state.roster.indexOf(actor), 1, old);
      old.slot = null;
    }
    actor.slot = slot;
    state.party[slot] = actor;
    return ok("隊形已整頓。");
  }

  function equip(state, id, index) {
    const actor = find(state, id);
    const entry = state.inventory[index];
    const item = db().itemsById[R.Formulas.itemId(entry)];
    if (!actor || !item || entry.identified === false || !active(actor)) return fail("此裝備無法使用。");
    const slot = item.slot || "weapon";
    const old = actor.equipment[slot];
    if (db().itemsById[R.Formulas.itemId(old)]?.curse && !old.uncursed) return fail("詛咒鎖住了原本的裝備。");
    if (slot === "weapon" && !db().classes[actor.classId].allowedWeapons.includes(item.category)) return fail("此職業無法使用這類武器。");
    if (actor.injuries.arm === 2 && (slot === "offhand" || item.hands === 2)) return fail("手部重傷，無法握緊裝備。");
    if ((item.hands === 2 && actor.equipment.offhand) ||
        (slot === "offhand" && db().itemsById[R.Formulas.itemId(actor.equipment.weapon)]?.hands === 2)) {
      return fail("請先卸下佔用另一隻手的裝備。");
    }
    state.inventory.splice(index, 1);
    if (old) state.inventory.push(typeof old === "string" ? { id: old, identified: true } : old);
    actor.equipment[slot] = entry;
    refresh(actor);
    return ok("裝備換好了。");
  }

  function unequip(state, id, slot) {
    const actor = find(state, id);
    const entry = actor?.equipment[slot];
    const item = db().itemsById[R.Formulas.itemId(entry)];
    if (!item || !active(actor)) return fail("這個位置沒有可卸下的裝備。");
    if (item.curse && !entry.uncursed) return fail("詛咒鎖住了這件裝備。");
    if (state.inventory.length >= limit(state, "bag")) return fail("裝備背包已滿。");
    state.inventory.push(typeof entry === "string" ? { id: entry, identified: true } : entry);
    delete actor.equipment[slot];
    refresh(actor);
    return ok("裝備已卸下。");
  }

  function drink(pouch, actor, id, data = db()) {
    const item = data.itemsById[id];
    if (!item?.heal || !(pouch[id] > 0) || !actor || actor.isDead) return fail("這份藥無法使用。");
    pouch[id] -= 1;
    const factor = actor.injuries.torso === 1 && !item.cure ? 0.75 : 1;
    actor.hp = Math.min(actor.maxHp, actor.hp + Math.floor(actor.maxHp * item.heal * factor));
    actor.isDying = false;
    actor.dyingTimer = 0;
    if (item.cure) actor.injuries = R.Storage.injuries();
    return ok(actor.name + "的氣息平穩了。");
  }

  R.Town = { active, all, find, initialize, makeActor, refresh, gainExp, restAtInn, limit, stock, addLoot, buyItem,
    sell, identify, reviveChar, treat, removeCurse, advanceClass, allocate, recruit, place, equip, unequip, drink };
}(globalThis.RPG3));
