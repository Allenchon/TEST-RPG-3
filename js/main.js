(function (R, root) {
  "use strict";
  let db;
  let state;
  let rng;
  let screen = "TOWN";
  let panel = null;

  function battle() { return state.dungeonState?.battle || null; }

  function restore(save) {
    state = R.Town.initialize(save, db);
    rng = R.RNG.create(state.rngState ?? state.seed);
    R.AudioFX.setMute(state.preferences.mute);
    const current = battle();
    if (current) {
      current.party = state.party;
      current.pouch = state.pouch;
    }
    screen = current ? "COMBAT" : state.dungeonState ? "DUNGEON" : "TOWN";
    panel = null;
  }

  function sync() {
    state.rngState = rng.snapshot();
    R.Storage.save(state);
    R.UI.renderScreen(screen, state, panel);
  }

  function toast(text) { if (text) R.UI.showToast(text); }
  function lesson(id) { if (id && !state.commonSense.includes(id)) state.commonSense.push(id); }
  function open(name, arg, extra) { panel = { name, arg, extra }; }

  function enter(floor = 1, travel = "entry") {
    if (screen !== "TOWN" || !state.party.some(R.Town.active)) return toast("隊中無人能踏上石階。");
    if (!db.floors[floor] || (floor !== 1 && !state.clearedFloors.includes(floor - 1)) ||
        (travel === "camp" && !state.unlockedCampFloors.includes(floor))) return toast("通往那裡的路還關著。");
    state.stats.runs += 1;
    state.expeditionFloors = {};
    state.dungeonState = R.Dungeon.generateFloor(floor, state.seed, db);
    if (travel === "camp") R.Dungeon.relocate(state.dungeonState, db.floors[floor].features.camp);
    panel = null;
    screen = "DUNGEON";
    if (state.torches > 0) lightTorch(false);
    R.AudioFX.play("step");
  }

  function town(text) {
    state.dungeonState = null;
    state.expeditionFloors = {};
    panel = null;
    screen = "TOWN";
    toast(text);
  }

  function lightTorch(announce = true) {
    const dungeon = state.dungeonState;
    if (!dungeon || screen !== "DUNGEON") return;
    if (state.torches < 1) return toast("行囊裡沒有火把。");
    if (dungeon.torch > 0) return toast("手上的火把仍亮著。");
    state.torches -= 1;
    dungeon.torch = db.balance.torchSteps;
    if (announce) toast("火光爬上潮濕的石壁。");
  }

  function explore(dir) {
    const dungeon = state.dungeonState;
    if (screen !== "DUNGEON" || panel) return;
    const event = R.Dungeon.move(dungeon, dir, state.party, rng);
    toast(event.text);
    if (!event.ok || event.turned) return;
    state.stats.steps += 1;
    R.AudioFX.play("step");
    if (event.features.includes("camp") && !state.unlockedCampFloors.includes(dungeon.floor)) {
      state.unlockedCampFloors.push(dungeon.floor);
      toast("這座營火已與地面相通。");
    }
    if (event.encounter) startBattle(event.encounter, { at: event.at });
    else if (dungeon.torch === 0) lesson("torch");
  }

  function startBattle(type, event) {
    const dungeon = state.dungeonState;
    dungeon.battle = R.Combat.createEncounter(dungeon.floor, type, state.party, db, rng, {
      autoMode: state.preferences.auto, dark: dungeon.torch === 0, difficulty: state.difficulty,
      gold: state.gold, pouch: state.pouch, townScrolls: state.townScrolls, event
    });
    for (const foe of dungeon.battle.enemies) {
      const entry = state.codex[foe.id] || { seen: 0, defeated: 0 };
      entry.seen += 1;
      state.codex[foe.id] = entry;
    }
    dungeon.battle.selected = state.party.find(R.Town.active)?.id || null;
    screen = "COMBAT";
    panel = null;
    R.AudioFX.play("warn");
  }

  function inspect() {
    if (screen !== "DUNGEON" || panel) return;
    const outcome = R.Dungeon.inspect(state.dungeonState, state.party, state, rng);
    if (outcome.encounter) {
      startBattle(outcome.encounter, { at: outcome.at });
      return;
    }
    if (outcome.overlay) open(outcome.overlay);
    lesson(outcome.common);
    if (outcome.loot) {
      const claim = state.dungeonState.floor + ":" + outcome.loot;
      if (state.claimed.includes(claim)) return toast("這裡已經空了。");
      if (!R.Town.addLoot(state, outcome.loot)) return toast("裝備背包已滿。");
      state.claimed.push(claim);
    }
    if (outcome.text && outcome.text.length > 24) open("reading", outcome.text);
    else toast(outcome.text);
  }

  function changeFloor(next) {
    const current = state.dungeonState;
    if (!current || !state.clearedFloors.includes(1) || !db.floors[next] || Math.abs(next - current.floor) !== 1) return;
    state.expeditionFloors = state.expeditionFloors || {};
    const other = state.expeditionFloors[next] || R.Dungeon.generateFloor(next, state.seed, db);
    delete state.expeditionFloors[next];
    state.expeditionFloors[current.floor] = current;
    other.torch = current.torch;
    other.bonfireUsed = current.bonfireUsed;
    state.dungeonState = other;
    if (next === 2) R.Dungeon.relocate(other, db.floors[next].path[0]);
    else R.Dungeon.relocate(other, db.floors[next].features.stairs);
    panel = null;
    R.AudioFX.play("step");
  }

  function camp(full, mode) {
    if (screen !== "DUNGEON") return;
    const dungeon = state.dungeonState;
    const result = full ? R.Dungeon.useBonfire(dungeon, state.party, mode, rng, state) :
      R.Dungeon.useCamp(dungeon, state.party, rng, state);
    toast(result.text);
    if (!result.ok) return;
    for (const actor of state.party) R.Town.refresh(actor);
    R.AudioFX.play("camp");
    lesson("camp");
    lesson("injury");
    panel = null;
    if (result.story?.length) open("story", result.story);
    if (result.encounter) startBattle(result.encounter, { at: R.Dungeon.here(dungeon), ambush: true });
  }

  function fieldScroll() {
    if (screen === "COMBAT") {
      if (R.Combat.useScroll(battle())) finishBattle();
      else toast("隊中無人能使用卷軸。");
      return;
    }
    if (screen !== "DUNGEON" || state.townScrolls < 1 || !state.party.some((actor) => R.Town.active(actor) && actor.injuries.head < 2)) {
      return toast("目前無法使用回城卷軸。");
    }
    state.townScrolls -= 1;
    state.gold -= Math.floor(state.gold * 0.5);
    town("你循著卷軸的灰光回到地面。");
  }

  function withdraw() {
    const dungeon = state.dungeonState;
    if (!dungeon) return;
    const features = R.Dungeon.featureAt(dungeon) || [];
    if (features.includes("entry") || features.includes("shortcut")) {
      lesson("stairs");
      town("你沿著石階撤回地面。");
    } else {
      open("retreat");
    }
  }

  function runTurn() {
    const current = battle();
    if (!current) return;
    panel = null;
    const commands = { ...current.manual };
    if (!current.autoMode) {
      for (const actor of current.party.filter(R.Town.active)) {
        commands[actor.id] = commands[actor.id] ||
          R.Combat.evalGambit({ ...actor, gambits: ["attack"] }, current, db);
      }
    }
    R.Combat.resolveTurn(current, commands, db, rng);
    current.manual = {};
    if (!current.party.some((actor) => R.Town.active(actor) && actor.id === current.selected)) {
      current.selected = current.party.find(R.Town.active)?.id || null;
    }
    R.AudioFX.play(current.result === "victory" ? "win" : "hit");
    if (current.result) finishBattle();
    else if (current.enemies.some((foe) => foe.isCharging)) R.AudioFX.play("warn");
  }

  function win(current) {
    const dungeon = state.dungeonState;
    const enemies = current.enemies.map((foe) => db.enemiesById[foe.id]);
    let gold = enemies.reduce((total, enemy) => total + enemy.gold, 0);
    const exp = enemies.reduce((total, enemy) => total + enemy.xp, 0);
    for (const actor of state.party) {
      const factor = R.Formulas.gear(actor, "head", db)?.special?.goldDropMult || 1;
      if (!actor.isDead && factor < 1) gold *= factor;
      R.Town.gainExp(actor, exp, db);
    }
    state.gold += Math.floor(gold);
    state.stats.kills += enemies.length;
    for (const enemy of enemies) {
      state.codex[enemy.id].defeated += 1;
      for (const item of [enemy.dropUnique, enemy.relic, enemy.badge].filter(Boolean)) R.Town.addLoot(state, item, true, true);
    }
    const first = enemies[0];
    if (first.drop && rng.next() < (current.type === "elite" ? 1 : 0.40)) R.Town.addLoot(state, first.drop, false, true);
    if (current.event?.at && !current.event.ambush) {
      const marker = current.type + ":" + current.event.at;
      if (!dungeon.defeated.includes(marker)) dungeon.defeated.push(marker);
    }
    if (current.type === "boss") {
      if (!state.clearedFloors.includes(current.floor)) state.clearedFloors.push(current.floor);
      for (const zone of db.world.zones) {
        if (!state.clearedZones.includes(zone.id) && zone.floors.every((floor) => state.clearedFloors.includes(floor))) {
          state.clearedZones.push(zone.id);
        }
      }
    }
    if (current.type === "hidden" && !state.hiddenClears.includes(first.id)) state.hiddenClears.push(first.id);
  }

  function finishBattle() {
    const dungeon = state.dungeonState;
    const current = dungeon.battle;
    state.gold = current.gold;
    state.townScrolls = current.townScrolls;
    if (current.result === "wipe") {
      for (const actor of state.party) {
        if (actor.isDying) {
          actor.isDead = true;
          actor.isDying = false;
        }
      }
    }
    for (const actor of state.party) {
      if (actor.isDead && !actor.deathCounted) {
        state.stats.deaths += 1;
        actor.deathCounted = true;
      }
      actor.statuses = [];
      actor.cooldowns = {};
      R.Town.refresh(actor);
    }
    if (current.result === "victory") win(current);
    delete dungeon.battle;
    panel = null;
    if (current.result === "scroll") return town("你循著卷軸的灰光回到地面。");
    if (current.result === "wipe") return town("拾荒人把小隊帶回了神殿。");
    if (current.result === "victory" && ["boss", "hidden"].includes(current.type)) {
      town(current.type === "boss" ? "首領倒下了。小隊帶著遺物回城。" : "火塘冷了下來。灰中留著一枚護符。");
      open("aftermath", current);
      return;
    }
    screen = "DUNGEON";
    open("aftermath", current);
  }

  function manual(actionId, targetId) {
    const current = battle();
    const actor = current?.party.find((entry) => entry.id === current.selected);
    if (!actor || current.autoMode) return;
    const action = R.Combat.available(actor, current, db).find((entry) => entry.id === actionId);
    if (!action) return toast("現在無法使用這個指令。");
    current.manual[actor.id] = { type: action.type, actionId, targetId };
    if (current.retreat === actor.uid) current.retreat = false;
    panel = null;
    const next = current.party.find((entry) => entry.id !== actor.id && R.Town.active(entry) && !current.manual[entry.id]);
    if (next) current.selected = next.id;
  }

  function requestAction(actionId) {
    const current = battle();
    const actor = current?.party.find((entry) => entry.id === current.selected);
    if (!actor || current.autoMode) return;
    const action = R.Combat.available(actor, current, db).find((entry) => entry.id === actionId);
    if (!action) return toast("現在無法使用這個指令。");
    const targets = R.Combat.candidates(actor, action, current, db);
    if (["single_enemy", "single_ally"].includes(action.target) && targets.length > 1) open("target", actionId);
    else manual(actionId, targets[0]?.uid);
  }

  function queueItem(item, target) {
    const current = battle();
    const actor = current?.party.find((entry) => entry.id === current.selected);
    if (!current || !actor || !(current.pouch[item] > 0) || !R.Town.active(actor) || current.autoMode) return;
    current.manual[actor.id] = { type: "item", itemId: item, targetId: target };
    if (current.retreat === actor.uid) current.retreat = false;
    panel = null;
  }

  function perform(action, a, b, c) {
    const current = battle();
    const inTown = screen === "TOWN";
    const inDungeon = screen === "DUNGEON";
    switch (action) {
      case "panel": open(a, b, c); break;
      case "close": panel = null; break;
      case "home": open("settings"); break;
      case "mute": state.preferences.mute = R.AudioFX.toggleMute(); break;
      case "difficulty":
        if (inTown && db.balance.difficultyMult[a]) {
          state.difficulty = a;
          state.preferences.difficultyChosen = true;
        }
        break;
      case "enter": enter(Number(a || 1), b); break;
      case "move": explore(a); break;
      case "inspect": inspect(); break;
      case "camp": camp(false); break;
      case "bonfire": camp(true, a); break;
      case "light": lightTorch(); break;
      case "floor": changeFloor(Number(a)); break;
      case "retreat": withdraw(); break;
      case "scroll": fieldScroll(); break;
      case "inn": if (inTown) toast(R.Town.restAtInn(state).text); break;
      case "buy": if (inTown) toast(R.Town.buyItem(state, a).text); break;
      case "sell": if (inTown) toast(R.Town.sell(state, Number(a)).text); break;
      case "identify": if (inTown) toast(R.Town.identify(state, Number(a), rng).text); break;
      case "revive":
        if (inTown) {
          const result = R.Town.reviveChar(state, a);
          if (result.ok) {
            R.Town.find(state, a).deathCounted = false;
            lesson("scar");
          }
          toast(result.text);
        }
        break;
      case "treat": if (inTown) toast(R.Town.treat(state, a).text); break;
      case "uncurse": if (inTown) toast(R.Town.removeCurse(state, a).text); break;
      case "advance": if (inTown) toast(R.Town.advanceClass(state, a, b).text); break;
      case "allocate": if (inTown) toast(R.Town.allocate(state, a, b).text); break;
      case "place": if (inTown) toast(R.Town.place(state, a, Number(b)).text); break;
      case "equip":
        if (!current) {
          const result = R.Town.equip(state, a, Number(b));
          if (result.ok) open("actor", a);
          toast(result.text);
        }
        break;
      case "unequip": if (!current) toast(R.Town.unequip(state, a, b).text); break;
      case "stash":
        if (inTown && state.inventory.length < R.Town.limit(state, "bag") && state.stash[Number(a)]) {
          state.inventory.push(...state.stash.splice(Number(a), 1));
          toast("裝備已裝入背包。");
        }
        break;
      case "drink":
        if (inTown || inDungeon) {
          const actor = R.Town.find(state, b);
          const result = R.Town.drink(state.pouch, actor, a, db);
          if (result.ok) R.Town.refresh(actor);
          toast(result.text);
        }
        break;
      case "rumor":
        open("rumor", a);
        if (a === "grik") lesson("poise");
        if (a === "hearth" || a === "wall") lesson("relic");
        break;
      case "select": if (current?.party.some((actor) => actor.id === a && R.Town.active(actor))) current.selected = a; break;
      case "auto":
        if (current) {
          current.autoMode = !current.autoMode;
          state.preferences.auto = current.autoMode;
          panel = null;
        }
        break;
      case "combatRetreat":
        if (current && !["boss", "hidden"].includes(current.type)) {
          const actor = current.party.find((entry) => entry.id === current.selected && R.Town.active(entry));
          if (actor) {
            current.retreat = actor.uid;
            current.manual[actor.id] = { type: "retreat" };
            panel = null;
            toast("已安排撤退。");
          }
        }
        break;
      case "requestAction": requestAction(a); break;
      case "manual": manual(a, b); break;
      case "queueItem": queueItem(a, b); break;
      case "turn": runTurn(); break;
      case "gambit": {
        const actor = R.Town.find(state, a);
        const index = Number(b);
        const next = index + Number(c);
        if (actor && index >= 0 && index < actor.gambits.length && next >= 0 && next < actor.gambits.length) {
          [actor.gambits[index], actor.gambits[next]] = [actor.gambits[next], actor.gambits[index]];
        }
        break;
      }
      case "export": open("export"); break;
      case "import": open("import"); break;
      case "copy": {
        const field = root.document.querySelector("#save-token");
        if (field) {
          field.select();
          if (root.navigator.clipboard?.writeText) root.navigator.clipboard.writeText(field.value)
            .then(() => toast("存檔已複製。"), () => toast("已選取存檔文字。"));
          else toast("已選取存檔文字。");
        }
        return false;
      }
      default: return false;
    }
    return true;
  }

  function dispatch(actionType, payload = {}) {
    if (!state) return;
    const { arg, extra, third } = typeof payload === "string" ? { arg: payload } : payload;
    if (perform(actionType, arg, extra, third) !== false) sync();
  }

  function click(event) {
    const control = event.target.closest("[data-act]");
    if (!control || control.disabled) return;
    if (control.classList.contains("scrim") && event.target !== control) return;
    R.AudioFX.init();
    dispatch(control.dataset.act, { arg: control.dataset.arg, extra: control.dataset.extra, third: control.dataset.third });
  }

  function submit(event) {
    const form = event.target;
    if (!["recruit-form", "import-form"].includes(form.id)) return;
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    if (form.id === "recruit-form") {
      const result = R.Town.recruit(state, values);
      toast(result.text);
      if (!result.ok) return;
      open("roster");
    } else {
      const parsed = R.Storage.importString(values.token);
      if (!parsed) return toast("存檔校驗未通過。");
      restore(parsed);
      toast("舊日紀錄已讀回。");
    }
    sync();
  }

  async function boot() {
    try {
      db = await R.DataLoader.init();
      restore(R.Storage.load());
      sync();
    } catch (error) {
      console.error(error);
      const game = root.document.getElementById("game");
      game.textContent = "遊戲資料無法載入。請透過 HTTP 伺服器開啟遊戲。";
    }
  }

  R.Main = { boot, dispatch, getState: () => state };
  if (root.document) {
    root.document.addEventListener("click", click);
    root.document.addEventListener("submit", submit);
    root.document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && panel) dispatch("close");
      if (screen !== "DUNGEON" || panel || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(event.target.tagName)) return;
      const directions = { ArrowUp: "forward", ArrowDown: "back", ArrowLeft: "left", ArrowRight: "right" };
      if (directions[event.key]) {
        event.preventDefault();
        dispatch("move", directions[event.key]);
      }
    });
    root.document.addEventListener("DOMContentLoaded", boot, { once: true });
  }
}(globalThis.RPG3, globalThis));
