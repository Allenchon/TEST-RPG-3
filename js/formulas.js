(function (R) {
  "use strict";
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const nextExp = (lv) => Math.floor(100 * lv ** 1.85);
  const stats = ["STR", "AGI", "VIT", "INT", "PIE", "LUK"];
  const hasStatus = (actor, id) => Boolean(actor.statuses?.some((status) => status.id === id && status.turns > 0));
  const itemId = (value) => typeof value === "string" ? value : value?.id;
  const gear = (char, slot, db) => {
    const record = char.equipment?.[slot];
    if (!record) return null;
    const item = db.itemsById[itemId(record)];
    if (char.injuries?.arm >= 2 && (slot === "offhand" || item?.hands === 2)) return null;
    return item || null;
  };

  function calcDerivedStats(char, db) {
    const race = db.races[char.race] || db.races.human;
    const job = db.classes[char.classId] || db.classes.fighter;
    const scars = char.soulScars || 0;
    const wounds = char.injuries || {};
    const weapon = gear(char, "weapon", db);
    const equipment = Object.keys(char.equipment || {}).map((slot) => gear(char, slot, db)).filter(Boolean);
    const curses = Object.entries(char.equipment || {}).map(([slot, entry]) =>
      entry?.uncursed ? null : db.curses[gear(char, slot, db)?.curse]).filter(Boolean);
    const sum = (key) => equipment.reduce((total, item) => total + (item[key] || 0), 0);
    const affixes = equipment.flatMap((item) => item.affixes || []);
    const base = Object.fromEntries(stats.map((key) => {
      const penalty = curses.reduce((total, curse) => total + (curse.modifiers?.[key] || 0), 0);
      return [key, Math.max(1, (char.attributes?.[key] ?? race.stats[key]) - scars + penalty)];
    }));
    const { STR, AGI, VIT, INT, PIE, LUK } = base;
    const weight = sum("weight");
    const focus = sum("focus");
    const rawPdef = sum("def") + Math.floor(VIT * 0.6);
    const blind = hasStatus(char, "blind") ? 40 : 0;
    const head = wounds.head === 2 ? 15 : 0;
    const arm = wounds.arm === 2 ? 25 : 0;
    const unarmored = equipment.every((item) => !item.def) ? (job.passive.unarmoredEva || 0) : 0;
    return {
      ...base,
      maxHp: Math.floor((25 + VIT * 4 + (char.level || 1) * job.hpGrowth) * (1 - db.balance.soulScarHpPen * scars)),
      patk: (weapon?.atk || 0) + (weapon?.mainStat === "AGI" ? AGI : STR) * 1.5,
      matk: focus + INT * 1.6,
      hatk: focus + PIE * 1.6,
      pdef: rawPdef * (wounds.torso === 2 ? 0.8 : 1) * (hasStatus(char, "armor_break") ? 0.65 : 1),
      mdef: (sum("mdef") + Math.floor((INT + PIE) * 0.4)) * (race.passive.mdef || 1),
      acc: 85 + AGI * 0.8 + (weapon?.acc || 0) - head - blind,
      physicalAccPenalty: arm,
      eva: wounds.leg === 2 ? 0 : 5 + AGI * 0.7 - weight + unarmored,
      crit: 5 + LUK * 0.6 + 5 * affixes.filter((id) => id === "keen").length,
      spellCrit: race.passive.spellCrit || 0,
      spd: (10 + AGI + Math.floor(LUK * 0.3) - weight) * (wounds.leg === 1 ? 0.8 : 1),
      resistStatus: race.passive.statusResist || 0,
      thick: Math.min(0.12, affixes.filter((id) => id === "thick").length * 0.04),
      damageMult: wounds.arm === 1 ? 0.85 : 1,
      healingReceived: wounds.torso === 1 ? 0.75 : 1,
      armorPen: affixes.includes("pierce") ? 0.18 : 0,
      range: weapon?.range || "short",
      immunity: equipment.flatMap((item) => item.special?.immunity || [])
    };
  }

  function finalHit(atk, def, act) {
    const physicalPenalty = act.element ? 0 : atk.physicalAccPenalty || 0;
    return clamp(atk.acc - def.eva - physicalPenalty + (act.acc || 0), 15, 98);
  }

  function calcDamage(atk, def, act, rng, diffMult = 1) {
    if (rng.next() * 100 >= finalHit(atk, def, act)) return { hit: false, crit: false, dmg: 0 };
    const crit = rng.next() * 100 < (atk.crit || 0) + (act.crit || 0) + (act.element ? atk.spellCrit || 0 : 0);
    const variance = rng.range(...(act.variance || [0.85, 1.15]));
    const power = (act.mult ?? 1) * (act.power || 1);
    const critDefense = crit ? 0.7 : 1;
    let raw;
    if (act.element) {
      const affinity = def.immunity?.includes(act.element) ? 0 : def.weakness?.includes(act.element) ? 1.4 : def.resistance?.includes(act.element) ? 0.6 : 1;
      const force = act.element === "holy" ? (atk.hatk ?? atk.matk) : atk.matk;
      raw = Math.max(1, force * power - def.mdef * 0.7 * critDefense) * affinity;
    } else {
      const pen = clamp((act.armorPen || 0) + (atk.armorPen || 0), 0, 1);
      raw = Math.max(1, atk.patk * power - def.pdef * (1 - pen) * critDefense) * (atk.damageMult || 1);
    }
    const damage = raw * (crit ? 1.5 : 1) * (1 - (def.thick || 0)) * variance * diffMult * (act.finalMult ?? 1);
    return { hit: true, crit, dmg: raw === 0 ? 0 : Math.max(1, Math.floor(damage)) };
  }

  function mapDamageVerb(dmg, maxHp) {
    const ratio = dmg / maxHp;
    if (dmg <= 0) return "被側身閃開";
    if (ratio < 0.10) return "僅擦破了表皮";
    if (ratio < 0.25) return "穩穩砍中了要害";
    if (ratio < 0.45) return "重重劈開血肉";
    return "造成毀滅性的重創";
  }

  function calcRetreatRate(party, enemies, db) {
    const active = party.filter((actor) => !actor.isDead && !actor.isDying);
    const foes = enemies.filter((actor) => !actor.isDead);
    const mean = (actors) => actors.reduce((sum, actor) => sum + actor.derived.spd, 0) / Math.max(1, actors.length);
    const rogue = active.some((actor) => actor.classId === "rogue" || db.classes[actor.classId]?.base === "rogue");
    const hobbit = active.some((actor) => db.races[actor.race]?.passive.retreat);
    const badLeg = active.some((actor) => actor.injuries.leg === 2);
    const gearBonus = active.reduce((sum, actor) => sum + (gear(actor, "head", db)?.special?.retreatBonus || 0), 0);
    return clamp(45 + (mean(active) - mean(foes)) * 2 + (rogue ? 15 : 0) + (hobbit ? 10 : 0) - (badLeg ? 30 : 0) + gearBonus * 100, 15, 90);
  }

  function price(item, selling = false) {
    return selling ? Math.max(1, Math.floor(item.price * 0.5)) : item.price;
  }

  R.Formulas = { clamp, stats, nextExp, hasStatus, itemId, gear, calcDerivedStats, finalHit, calcDamage, mapDamageVerb, calcRetreatRate, price };
}(globalThis.RPG3));
