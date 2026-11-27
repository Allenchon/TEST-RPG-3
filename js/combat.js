(function (R) {
  "use strict";
  const { clamp, hasStatus, calcDamage, mapDamageVerb } = R.Formulas;
  const standing = (actor) => R.Town.active(actor);
  const attack = { id: "attack", type: "attack", name: "普攻", mult: 1, target: "single_enemy" };
  const defense = { id: "defend", type: "defend", name: "防禦", target: "self", effect: "guard" };
  const parts = ["head", "torso", "arm", "leg"];
  const ratio = (actor) => actor.hp / actor.maxHp;
  const weakest = (actors) => [...actors].sort((a, b) => ratio(a) - ratio(b))[0];

  function report(logs, text) {
    logs.push(Array.from(text.replace(/[0-9]/g, "")).slice(0, 18).join(""));
  }

  function createEncounter(floor, type, party, db, rng, options = {}) {
    const info = db.floors[floor];
    if (!info || !["normal", "elite", "boss", "hidden"].includes(type)) throw new RangeError("Unknown encounter");
    const profile = db.balance.encounters[floor];
    let ids;
    if (type === "normal") ids = profile.normal[rng.int(0, profile.normal.length - 1)];
    if (type === "elite") ids = [info.elitePool[rng.int(0, info.elitePool.length - 1)], ...profile.eliteSupport];
    if (type === "boss") ids = [info.bossId, ...(profile.bossSupport || [])];
    if (type === "hidden") ids = [info.hiddenBossId];
    if (ids.some((id) => !db.enemiesById[id])) throw new RangeError("Unknown enemy");
    const enemies = ids.map((id, i) => {
      const data = db.enemiesById[id];
      const isBoss = i === 0 && (type === "boss" || type === "hidden");
      let maxHp = data.hp;
      if (type === "elite" && i === 0) maxHp = Math.floor(data.hp * db.balance.eliteHpMult);
      if (isBoss && data.baseHp) maxHp = Math.floor(data.baseHp * db.balance.bossHpMult);
      return {
        uid: "enemy-" + i, id, name: data.name, maxHp, hp: maxHp, slot: i,
        row: data.row || "front", isBoss, isElite: i === 0 && type === "elite",
        isDead: false, isDying: false, isPlayer: false, statuses: [], cooldowns: {},
        phase: 1, isCharging: false, poise: 0, poiseMax: 0, boost: 0, buffUntil: 0
      };
    });
    for (const actor of party) {
      actor.statuses = [];
      actor.cooldowns = {};
      delete actor.guardUntil;
      delete actor.riposteUntil;
      delete actor.evadeUntil;
      delete actor.weakenUntil;
    }
    const battle = {
      party, enemies, floor, type, turn: 0, result: null,
      autoMode: options.autoMode ?? false, dark: Boolean(options.dark),
      diffMult: db.balance.difficultyMult[options.difficulty] || 1,
      gold: options.gold ?? 0, pouch: options.pouch || {}, townScrolls: options.townScrolls || 0,
      stolen: 0, stolenUntil: 0, wasStolen: false, logs: [], event: options.event || null,
      manual: {}, selected: null, prepared: false, retreat: false
    };
    prepareTurn(battle, db);
    return battle;
  }

  function currentStats(actor, battle, db) {
    const round = battle.turn;
    let output;
    if (actor.isPlayer) {
      output = R.Formulas.calcDerivedStats(actor, db);
      if (battle.dark && round <= db.balance.darkRounds) output.acc -= db.balance.darkAccPenalty;
    } else {
      const data = db.enemiesById[actor.id];
      output = {
        maxHp: actor.maxHp, patk: data.patk, matk: data.matk, hatk: data.matk,
        pdef: data.pdef * (hasStatus(actor, "armor_break") ? 0.65 : 1),
        mdef: data.mdef, acc: data.acc - (hasStatus(actor, "blind") ? 40 : 0),
        eva: data.eva, spd: data.spd, crit: data.crit ?? 8,
        weakness: actor.revealedWeakness && !data.weakness.length ? ["fire", "cold", "holy"] : data.weakness,
        resistance: data.resistance, immunity: data.immunity
      };
    }
    if (actor.armSealedUntil >= round) output.damageMult = (output.damageMult || 1) * 0.70;
    if ((actor.evadeUntil || 0) >= round && round > 0) output.eva += 30;
    return output;
  }

  function phaseCheck(enemy, db, logs) {
    if (!enemy.isBoss || enemy.isDead || enemy.phase !== 1 || enemy.hp > enemy.maxHp * 0.5) return;
    enemy.phase = 2;
    enemy.statuses = [];
    delete enemy.weakenUntil;
    delete enemy.armSealedUntil;
    enemy.isCharging = false;
    enemy.poise = 0;
    report(logs, enemy.name + "的氣息變得狂暴。");
  }

  function prepareTurn(battle, db) {
    if (battle.result || battle.prepared) return;
    for (const enemy of battle.enemies) {
      if (enemy.isDead) continue;
      phaseCheck(enemy, db, battle.logs);
      if (enemy.isBoss && !enemy.isCharging && (battle.turn + 1) % 4 === 0) {
        enemy.isCharging = true;
        enemy.poise = Math.floor(enemy.maxHp * db.balance.bossPoisePct);
        enemy.poiseMax = enemy.poise;
      }
    }
    battle.prepared = true;
  }

  function actionFor(id, actor, db) {
    if (id === "attack") return { ...attack, range: R.Formulas.gear(actor, "weapon", db)?.range || "short" };
    if (id === "defend") return defense;
    return db.actions[id];
  }

  function actionReady(actor, action, battle, db) {
    if (!action || !standing(actor)) return false;
    const turn = battle.turn + (battle.prepared ? 1 : 0);
    if (hasStatus(actor, "fear") && !["attack", "defend"].includes(action.type)) return false;
    if (action.type === "spell" && (hasStatus(actor, "silence") || actor.injuries.head === 2 ||
        (actor.slots[action.ring - 1] || 0) < action.costSp + (actor.injuries.head === 1 ? 1 : 0))) return false;
    if ((actor.cooldowns[action.id] || 0) > turn) return false;
    const weapon = R.Formulas.gear(actor, "weapon", db);
    if (action.requires === "shield" && !R.Formulas.gear(actor, "offhand", db)?.shield) return false;
    if (action.requires === "bow" && !["shortbow", "longbow", "crossbow"].includes(weapon?.category)) return false;
    if (action.requires === "blunt" && !["mace", "warhammer"].includes(weapon?.category)) return false;
    return true;
  }

  function fronts(actors, isParty, db) {
    const live = actors.filter(standing);
    const front = live.filter((target) => isParty ? target.slot < db.balance.frontSlots : target.row !== "back");
    return front.length ? front : live;
  }

  function candidates(actor, action, battle, db) {
    const allies = actor.isPlayer ? battle.party : battle.enemies;
    const foes = actor.isPlayer ? battle.enemies : battle.party;
    if (action.target === "self") return [actor];
    if (["party", "single_ally"].includes(action.target)) {
      return allies.filter((target) => !target.isDead && (action.heal || !target.isDying));
    }
    const front = fronts(foes, !actor.isPlayer, db);
    if (!actor.isPlayer) {
      if (action.target === "front_all" || action.target === "front_single") return front;
      return foes.filter(standing);
    }
    const isFront = fronts(allies, true, db).some((target) => target.uid === actor.uid);
    if (action.range === "short" && !isFront) return [];
    if (action.range === "short" || (action.range === "medium" && !isFront) || action.target === "front_enemy") return front;
    return foes.filter(standing);
  }

  function available(actor, battle, db) {
    return ["attack", "defend", ...actor.learned].map((id) => actionFor(id, actor, db))
      .filter((action) => actionReady(actor, action, battle, db) && candidates(actor, action, battle, db).length);
  }

  function evalGambit(actor, battle, db) {
    const actions = available(actor, battle, db);
    const front = fronts(battle.enemies, false, db);
    const needsHeal = weakest(battle.party.filter((ally) => !ally.isDead));
    const charge = battle.enemies.find((enemy) => !enemy.isDead && enemy.isCharging);
    const weakestEnemy = weakest(front);
    const focused = (action) => {
      const targets = candidates(actor, action, battle, db);
      return targets.includes(weakestEnemy) ? weakestEnemy : weakest(targets);
    };
    for (const condition of actor.gambits) {
      if (condition === "heal" && needsHeal && ratio(needsHeal) < 0.57) {
        const action = actions.find((item) => item.heal);
        if (action) return { type: "spell", actionId: action.id, targetId: needsHeal.uid };
      }
      if (condition === "interrupt" && charge) {
        const action = actions.find((item) => item.interrupt && candidates(actor, item, battle, db).includes(charge));
        if (action) return { type: action.type, actionId: action.id, targetId: charge.uid };
      }
      if (condition === "skill") {
        const offensive = actions.filter((item) => ["spell", "active"].includes(item.type) && !item.heal &&
          !["party", "self", "single_ally"].includes(item.target) &&
          !(item.interrupt && battle.enemies.some((enemy) => enemy.isBoss) && !charge));
        const score = (item) => {
          const target = focused(item);
          const foe = db.enemiesById[target?.id];
          const affinity = foe?.weakness.includes(item.element) ? 1.4 : foe?.resistance.includes(item.element) ? 0.6 : 1;
          return item.mult * affinity * (item.target === "all_enemy" ? 1.35 : 1) + (item.stunChance || 0) * 0.35;
        };
        offensive.sort((a, b) => score(b) - score(a));
        const action = offensive[0];
        if (action) return { type: action.type, actionId: action.id, targetId: focused(action)?.uid };
      }
      if (condition === "attack") {
        const action = actions.find((item) => item.type === "attack");
        if (action) return { type: "attack", actionId: "attack", targetId: focused(action)?.uid };
      }
    }
    return { type: "defend", actionId: "defend", targetId: actor.uid };
  }

  function enemyAction(actor, battle, db) {
    const data = db.enemiesById[actor.id];
    if (actor.isCharging) return { action: data.chargeSkill, charge: true };
    const skills = actor.phase === 2 ? [...data.skills, ...data.phase2Skills] : data.skills;
    const allowed = skills.filter((skill) => (!skill.stealGoldPct || !battle.wasStolen) &&
      (!hasStatus(actor, "silence") || !skill.element) && (!hasStatus(actor, "fear") || skill === data.skills[0]));
    return { action: allowed[(battle.turn - 1 + actor.slot) % allowed.length] ||
      { ...attack, target: "front_single" } };
  }

  function selectTargets(actor, action, targetId, battle, db, rng) {
    const targets = candidates(actor, action, battle, db);
    if (["all", "all_enemy", "front_all", "front_enemy", "party"].includes(action.target)) return targets;
    if (!targets.length) return [];
    const target = targets.find((entry) => entry.uid === targetId);
    if (target) return [target];
    if (action.target === "random") return [targets[rng.int(0, targets.length - 1)]];
    if (action.target === "injured") return [weakest(targets.filter((entry) => Object.values(entry.injuries || {}).some(Boolean))) || weakest(targets)];
    return [weakest(targets)];
  }

  function damage(target, amount, battle, logs) {
    if (!amount || target.isDead) return;
    const overflow = amount - target.hp;
    target.hp = Math.max(0, target.hp - amount);
    if (target.hp > 0) return;
    if (!target.isPlayer || overflow > target.maxHp * 1.5) {
      target.isDead = true;
      target.isDying = false;
      report(logs, target.name + "倒下了。");
    } else if (!target.isDying) {
      target.isDying = true;
      target.dyingTimer = 3 + Math.floor(target.derived.VIT / 6);
      report(logs, target.name + "只餘一線氣息。");
    }
  }

  function addStatus(target, id, duration, db, battle) {
    if (target.isDead || !db.statuses[id]) return false;
    const immunity = db.races[target.race]?.passive;
    if ((id === "sleep" && immunity?.sleepImmune) || (id === "poison" && immunity?.poisonImmune) ||
        target.derived.immunity?.includes(id)) return false;
    const timer = duration ?? db.statuses[id].duration;
    const current = target.statuses.find((entry) => entry.id === id);
    const startsNext = ["stun", "sleep"].includes(id) && target.actedTurn === battle.turn;
    if (current) {
      current.turns = Math.max(current.turns, timer);
      current.skipTick = startsNext;
    } else {
      target.statuses.push({ id, turns: timer, skipTick: startsNext });
    }
    return true;
  }

  function interrupt(target, battle, db, logs) {
    if (!target.isCharging) return;
    target.isCharging = false;
    target.poise = 0;
    addStatus(target, "stun", 1, db, battle);
    report(logs, target.name + "的架勢被擊潰。");
  }

  function applyHit(actor, target, action, battle, db, rng, logs) {
    const spell = Boolean(action.element);
    const attacker = currentStats(actor, battle, db);
    const defender = currentStats(target, battle, db);
    const guard = (target.guardUntil || 0) >= battle.turn ? 0.55 : 1;
    const aura = target.isPlayer ? Math.max(0, ...battle.party.filter(standing).map((pc) => db.classes[pc.classId].passive.aura || 0)) : 0;
    const sleeping = !spell && hasStatus(target, "sleep");
    const hurt = action.injuryMult && Object.values(target.injuries || {}).some(Boolean) ? action.injuryMult : 1;
    const boosted = actor.buffUntil >= battle.turn ? 1 + actor.boost : 1;
    const phasePower = actor.phase === 2 ? db.balance.bossPhase2DmgMult : 1;
    const weakened = (actor.weakenUntil || 0) >= battle.turn ? 0.78 : 1;
    const modifiers = {
      ...action, variance: db.balance.dmgVariance, power: boosted * weakened,
      finalMult: phasePower * guard * (1 - aura) * hurt * (sleeping ? 1.3 : 1)
    };
    const result = calcDamage(attacker, defender, modifiers, rng, actor.isPlayer ? 1 : battle.diffMult);
    if (!result.hit) {
      report(logs, actor.name + "的攻擊被側身閃開。");
      return;
    }
    if (result.dmg === 0) {
      report(logs, target.name + "未被術式所傷。");
      return;
    }
    if (sleeping) target.statuses = target.statuses.filter((item) => item.id !== "sleep");
    let amount = result.dmg;
    if (action.execute && !target.isBoss && ratio(target) < 0.23) amount = Math.max(amount, target.hp);
    damage(target, amount, battle, logs);
    report(logs, actor.name + mapDamageVerb(amount, target.maxHp) + "。");
    if (target.isCharging) {
      target.poise = Math.max(0, target.poise - amount);
      if (!target.poise || action.interrupt) interrupt(target, battle, db, logs);
    }
    if (target.isPlayer && !target.isDead && (action.inflictInjury || amount > target.maxHp * 0.35)) {
      const part = action.inflictInjury || parts[rng.int(0, parts.length - 1)];
      const level = target.injuries[part];
      const dwarf = db.races[target.race].passive.heavyThreshold || 0;
      const threshold = level === 1 && !action.inflictInjury ? 0.35 + dwarf : 0;
      if (level < 2 && amount > target.maxHp * threshold) {
        target.injuries[part] += 1;
        report(logs, target.name + "留下了傷勢。");
      }
    }
    const status = action.stunChance ? "stun" : action.status;
    if (status) {
      const chance = Math.max(0, (action.stunChance ?? action.chance ?? 1) - (defender.resistStatus || 0));
      if ((chance >= 1 || rng.next() < chance) && addStatus(target, status, action.duration, db, battle)) {
        if (status === "stun") interrupt(target, battle, db, logs);
        report(logs, target.name + "陷入" + db.statuses[status].name + "。");
      }
    }
    if (action.effect === "weaken") target.weakenUntil = battle.turn + 2;
    if (action.effect === "sealArm") target.armSealedUntil = battle.turn + 2;
    if (action.effect === "expose") target.revealedWeakness = true;
    phaseCheck(target, db, logs);

    if (target.isDead && actor.isPlayer && spell && db.classes[actor.classId].passive.slotOnKill) {
      const ring = action.ring - 1;
      actor.slots[ring] = Math.min(actor.maxSlots[ring], actor.slots[ring] + 1);
    }
    if (db.enemiesById[target.id]?.counterBurn && (action.element === "fire" || (!spell && action.range !== "long"))) {
      damage(actor, Math.ceil(actor.maxHp * 0.16 * battle.diffMult), battle, logs);
      report(logs, "餘火回捲，燙傷了" + actor.name + "。");
    }
    if (!spell && target.riposteUntil >= battle.turn && standing(target)) {
      damage(actor, Math.max(1, Math.floor(defender.patk * 0.7 - attacker.pdef)), battle, logs);
      report(logs, target.name + "沿著刃口反擊。");
    }
  }

  function heal(actor, target, action, battle, db, logs) {
    const power = currentStats(actor, battle, db).hatk;
    const factor = target.injuries.torso === 1 ? 0.75 : 1;
    target.hp = Math.min(target.maxHp, target.hp + Math.max(1, Math.floor(power * action.mult * factor)));
    target.isDying = false;
    target.dyingTimer = 0;
    if (action.lightCure) for (const part of parts) if (target.injuries[part] === 1) target.injuries[part] = 0;
    report(logs, target.name + "的傷口止住血。");
  }

  function resolveTurn(battle, playerCommands = {}, db, rng) {
    if (battle.result) return [];
    prepareTurn(battle, db);
    battle.turn += 1;
    battle.prepared = false;
    const logs = [];
    for (const enemy of battle.enemies.filter((target) => target.isCharging)) report(logs, enemy.name + "開始蓄力。");
    const actors = [...battle.party, ...battle.enemies].filter((actor) => !actor.isDead);
    const orders = new Map();
    for (const actor of actors) {
      actor.derived = currentStats(actor, battle, db);
      if (actor.isDying) continue;
      orders.set(actor.uid, actor.isPlayer ?
        (battle.retreat === actor.uid ? { type: "retreat" } : battle.autoMode ? evalGambit(actor, battle, db) : playerCommands[actor.id] || { type: "defend" }) :
        enemyAction(actor, battle, db));
    }
    for (const actor of actors) actor.turnInit = actor.derived.spd * rng.range(0.85, 1.15);
    actors.sort((a, b) => b.turnInit - a.turnInit);
    for (const actor of actors) {
      if (!standing(actor)) continue;
      if (battle.enemies.every((enemy) => enemy.isDead)) break;
      if (hasStatus(actor, "stun") || hasStatus(actor, "sleep")) {
        actor.actedTurn = battle.turn;
        if (actor.isCharging) actor.isCharging = false;
        report(logs, actor.name + "無法動彈。");
        continue;
      }
      const order = orders.get(actor.uid);
      if (!order) continue;
      actor.actedTurn = battle.turn;
      if (order.type === "retreat" && !["boss", "hidden"].includes(battle.type)) {
        for (const participant of actors) participant.derived = currentStats(participant, battle, db);
        if (rng.next() * 100 < R.Formulas.calcRetreatRate(battle.party, battle.enemies, db)) {
          battle.result = "retreated";
          report(logs, "全隊趁亂退出了戰場。");
          break;
        }
        report(logs, "退路被封死，撤退失敗。");
        continue;
      }
      if (order.type === "item") {
        if (!hasStatus(actor, "fear")) {
          const target = battle.party.find((entry) => entry.uid === order.targetId);
          const outcome = R.Town.drink(battle.pouch, target, order.itemId, db);
          report(logs, outcome.text);
        }
        afterAction(actor, battle, logs);
        continue;
      }
      let action = actor.isPlayer ? actionFor(order.actionId || order.type, actor, db) : order.action;
      if (actor.isPlayer && ((!["attack", "defend"].includes(action?.id) && !actor.learned.includes(action?.id)) ||
          !actionReady(actor, action, battle, db))) action = defense;
      if (!actor.isPlayer && ((order.charge && !actor.isCharging) ||
          (hasStatus(actor, "silence") && action.element) || (hasStatus(actor, "fear") && action !== db.enemiesById[actor.id].skills[0]))) continue;
      if (order.charge) {
        actor.isCharging = false;
        actor.poise = 0;
      }
      if (action.type === "spell" && actor.isPlayer) actor.slots[action.ring - 1] -= action.costSp + (actor.injuries.head === 1 ? 1 : 0);
      if (action.cooldown) actor.cooldowns[action.id] = battle.turn + action.cooldown + 1;
      if (action.target === "buff") {
        for (const ally of battle.enemies.filter(standing)) {
          ally.boost = action.boost;
          ally.buffUntil = battle.turn + 2;
        }
        report(logs, actor.name + "敲響了戰鼓。");
      } else {
        for (let hit = 0; hit < (action.hits || 1) && standing(actor); hit += 1) {
          const targets = selectTargets(actor, action, order.targetId, battle, db, rng);
          for (const target of targets) {
            if (!standing(actor)) break;
            if (action.heal) heal(actor, target, action, battle, db, logs);
            else if (action.effect === "guard" || action.effect === "riposte" || action.effect === "evade") {
              if (action.effect === "guard") target.guardUntil = battle.turn + (action.type === "defend" ? 0 : 1);
              if (action.effect === "riposte") target.riposteUntil = battle.turn + 1;
              if (action.effect === "evade") target.evadeUntil = battle.turn + 1;
              report(logs, target.name + "收緊了防線。");
            } else {
              applyHit(actor, target, action, battle, db, rng, logs);
            }
          }
        }
      }
      if (action.stealGoldPct && !battle.wasStolen) {
        battle.stolen = Math.floor(battle.gold * action.stealGoldPct);
        battle.gold -= battle.stolen;
        battle.stolenUntil = battle.turn + 2;
        battle.wasStolen = true;
        report(logs, "葛里克扯走了錢袋。");
      }
      afterAction(actor, battle, logs);
    }
    if (battle.result !== "retreated") finishRound(battle, actors, db, logs);
    battle.retreat = false;
    battle.logs.push(...logs);
    battle.logs = battle.logs.slice(-30);
    prepareTurn(battle, db);
    return logs;
  }

  function afterAction(actor, battle, logs) {
    if (hasStatus(actor, "bleed")) damage(actor, Math.max(1, Math.floor(actor.maxHp * 0.08)), battle, logs);
  }

  function finishRound(battle, actors, db, logs) {
    const erosion = battle.turn >= db.balance.stallStartTurn;
    if (erosion) report(logs, "深淵的寒意吞沒石室。");
    for (const actor of actors) {
      if (actor.isDead) continue;
      if (hasStatus(actor, "poison")) damage(actor, Math.max(1, Math.floor(actor.maxHp * 0.06)), battle, logs);
      if (actor.injuries?.torso === 2) damage(actor, Math.max(1, Math.floor(actor.maxHp * 0.05)), battle, logs);
      if (erosion) {
        const pct = (battle.turn - db.balance.stallStartTurn + 1) * db.balance.stallDmgPctPerTurn;
        damage(actor, Math.max(1, Math.floor(actor.maxHp * pct)), battle, logs);
      }
      if (actor.isDying && --actor.dyingTimer <= 0) {
        actor.isDead = true;
        actor.isDying = false;
        report(logs, actor.name + "停止了呼吸。");
      }
      actor.statuses = actor.statuses.filter((status) => {
        if (!status.skipTick) status.turns -= 1;
        status.skipTick = false;
        return status.turns > 0;
      });
      phaseCheck(actor, db, logs);
    }
    if (battle.enemies.every((enemy) => enemy.isDead)) battle.result = "victory";
    else if (battle.party.every((actor) => !standing(actor))) battle.result = "wipe";
    if (battle.stolen && battle.result === "victory" && battle.turn <= battle.stolenUntil) {
      battle.gold += battle.stolen;
      battle.stolen = 0;
      report(logs, "錢袋從屍身下找回。");
    }
    if (battle.stolen && battle.turn >= battle.stolenUntil) battle.stolen = 0;
  }

  function scrollUser(battle) {
    return battle.party.find((actor) => standing(actor) && actor.injuries.head < 2);
  }

  function useScroll(battle) {
    if (battle.result || !battle.townScrolls || !scrollUser(battle)) return false;
    battle.townScrolls -= 1;
    battle.gold -= Math.floor(battle.gold * 0.5);
    battle.result = "scroll";
    return true;
  }

  R.Combat = { createEncounter, prepareTurn, evalGambit, resolveTurn, candidates, available, actionFor, scrollUser, useScroll };
}(globalThis.RPG3));
