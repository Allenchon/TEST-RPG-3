(function (R, root) {
  "use strict";
  const dungeon = R.Dungeon;
  const html = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const db = () => R.DataLoader.getDB();
  const actorFor = (state, id) => R.Town.find(state, id);
  const names = {
    fighter: "劍", rogue: "刃", cleric: "燭", mage: "焰", ranger: "弓",
    samurai: "刃", lord: "盾", ninja: "影", assassin: "刃", paladin: "盾", bishop: "燭",
    archmage: "焰", warlock: "咒", marksman: "弓", beastmaster: "獸"
  };
  const alignment = { good: "善", neutral: "中立", evil: "惡" };
  const injury = { head: "頭部", torso: "軀幹", arm: "手部", leg: "腳部" };
  const slots = { weapon: "武器", head: "頭", body: "身", hands: "手", feet: "腳", offhand: "副手", neck: "項鍊", ring: "戒指" };
  const statNames = { STR: "力量", AGI: "敏捷", VIT: "體質", INT: "智力", PIE: "虔誠", LUK: "幸運" };
  const gambits = { heal: "療癒危急同伴", interrupt: "打斷首領蓄力", skill: "使用攻擊技能", attack: "使用普通攻擊" };
  const features = {
    entry: "入口石階", camp: "前廳營火", boss: "首領石門", elite: "精英巢口",
    hearth: "熄滅的火塘", inscription: "石壁刻字", secret: "暗室", stairs: "向下石階",
    rubble: "倒塌的營牆", shortcut: "單向捷門"
  };
  const townFacilities = [
    ["inn", "旅店", "休息與補充法術", "▰"],
    ["shop", "行腳商店", "採買與鑑定", "◇"],
    ["temple", "神殿", "治傷與喚魂", "✚"],
    ["training", "修練場", "屬性與進階", "⚔︎"],
    ["tavern", "酒館", "招募與傳聞", "♜"],
    ["codex", "圖鑑", "所見異類", "▤"]
  ];
  const icon = (symbol, css = "") => `<span class="icon ${css}" aria-hidden="true">${symbol}</span>`;
  const binding = (act, arg, extra, third) => `data-act="${act}"` +
    (arg == null ? "" : ` data-arg="${html(arg)}"`) +
    (extra == null ? "" : ` data-extra="${html(extra)}"`) +
    (third == null ? "" : ` data-third="${html(third)}"`);
  function button(text, act, arg, { extra, third, css = "", disabled = false, label, title } = {}) {
    const aria = label ? ` aria-label="${html(label)}"` : "";
    return `<button type="button" class="button ${css}" ${binding(act, arg, extra, third)}${aria}${title ? ` title="${html(title)}"` : ""}${disabled ? " disabled" : ""}>${text}</button>`;
  }
  function meter(fraction, css, label) {
    const pct = R.Formulas.clamp(fraction || 0, 0, 1) * 100;
    return `<span class="meter ${css}" role="img" aria-label="${html(label)}"><i style="width:${pct}%"></i></span>`;
  }
  function healthText(actor) {
    if (actor.isDead) return "亡故";
    if (actor.isDying) return "瀕死";
    const ratio = actor.hp / actor.maxHp;
    if (ratio >= 0.85) return "安穩";
    if (ratio >= 0.55) return "有傷";
    if (ratio >= 0.25) return "重創";
    return "危急";
  }
  const actionName = (order) => !order ? "" : ({ attack: "普攻", defend: "防禦", item: "道具", retreat: "撤退" })[order.type] || db().actions[order.actionId]?.name || "";
  const resource = (symbol, label, count) => `<span class="resource" title="${label}" aria-label="${label} ${count}">${icon(symbol)}<b>${count}</b></span>`;
  function sound(state) {
    const label = state.preferences.mute ? "開啟音效" : "靜音";
    return button(icon(state.preferences.mute ? "◖×" : "◖))"), "mute", null, { css: "icon-button", label, title: label });
  }
  function partyCards(state, combat) {
    return `<div class="party-strip ${combat ? "battle-party" : ""}" aria-label="小隊">${state.party.map((actor, index) => {
      const selected = combat?.selected === actor.id;
      const health = healthText(actor);
      const cmd = combat ? actionName(combat.manual[actor.id]) : `Lv.${actor.level}`;
      const status = combat?.party[index]?.statuses.map((entry) => db().statuses[entry.id]?.name).filter(Boolean)[0];
      const tag = actor.isDead || actor.isDying ? health : status || cmd || (combat ? (combat.autoMode ? "自動" : "待令") : health);
      return `<button type="button" class="party-card ${selected ? "selected" : ""} ${index === 3 ? "rear-start" : ""} ${!R.Town.active(actor) ? "fallen" : ""}" ${combat && R.Town.active(actor) ? binding("select", actor.id) : binding("panel", "actor", actor.id)} aria-label="${html(actor.name + "，" + (index < 3 ? "前排" : "後排") + "，" + health + "，" + tag)}" ${combat ? `aria-pressed="${Boolean(selected)}"` : ""}>
        <span class="class-mark mark-${html(actor.classId)}">${names[actor.classId] || "紋"}</span>
        <strong>${html(actor.name)}</strong>${meter(actor.hp / actor.maxHp, "hp", health)}
        <small>${html(tag)}</small>
      </button>`;
    }).join("")}</div>`;
  }

  function town(state) {
    return `<section class="screen town" aria-label="城鎮">
      <header class="status-bar town-bar">
        <div class="resource-list">${resource("◈", "金幣", state.gold)}${resource("▧", "補給", state.supplies)}${resource("♨", "火把", state.torches)}</div>
        <div class="header-actions">${sound(state)}${button(icon("⚙︎"), "home", null, { css: "icon-button", label: "設定" })}</div>
      </header>
      <div class="town-scene">
        <div class="town-title"><p>TEST RPG3</p><h1>北境地窟</h1></div>
        ${button(icon("▤") + "<span>窮鬼的生活常識</span>", "panel", "common", { css: "ledger" })}
      </div>
      <div class="town-body">
        <div class="section-head"><h2>冒險小隊</h2>${button("整頓隊形", "panel", "roster", { css: "text-button" })}</div>
        ${partyCards(state)}
        <div class="facility-grid">${townFacilities.map(([id, name, detail, glyph]) =>
          button(icon(glyph) + `<span><strong>${name}</strong><small>${detail}</small></span>`, "panel", id, { css: "facility" })).join("")}</div>
        <div class="town-entry">
          ${button(icon("▾") + "<span>踏入石階</span>", "enter", 1, { css: "primary town-primary" })}
          ${button("營火傳送", "panel", "travel", { css: "travel-button" })}
        </div>
      </div>
    </section>`;
  }

  function dungeonScreen(state) {
    const d = state.dungeonState;
    const floor = db().floors[d.floor];
    const on = dungeon.featureAt(d) || [];
    const spot = on.find((id) => id !== "shortcut" && (id !== "boss" || !state.clearedFloors.includes(d.floor))) || on[0];
    const place = spot ? features[spot] : "";
    const dirs = [["forward", "前進", "▲"], ["left", "左轉", "◀"], ["back", "後退", "▼"], ["right", "右轉", "▶"]];
    return `<section class="screen dungeon" aria-label="探索">
      <header class="status-bar dungeon-bar">
        <div class="floor-title"><b>${d.floor}F</b><span>${html(floor.name)}</span></div>
        <div class="light-status">
          ${button(icon("♨"), "light", null, { css: "icon-button torch-icon", label: "點火把" })}
          ${meter(d.torch / db().balance.torchSteps, "torch", d.torch ? "火把尚有餘光" : "火把已熄")}
          <span class="danger-light" role="img" aria-label="遇敵危險度" style="--danger:${d.hazard / 100}"></span>
        </div>
        ${sound(state)}
      </header>
      <div class="scene exploration">
        <canvas id="first-person" aria-label="第一人稱迷宮景象"></canvas>
        <canvas id="minimap" width="176" height="176" aria-label="已探索小地圖"></canvas>
        ${!d.torch ? '<span class="dark-tag">火把已熄</span>' : ""}
        ${place ? `<div class="place-marker">${icon("◇")}${html(place)}</div>` : ""}
      </div>
      ${partyCards(state)}
      <div class="explore-controls">
        <div class="section-head"><h2>探索</h2><span>${html(["北", "東", "南", "西"][d.facing])}向</span></div>
        <div class="thumb-controls">
          <div class="d-pad" aria-label="方向鍵">${dirs.map(([id, label, glyph]) =>
            button(icon(glyph), "move", id, { css: "direction " + id, label, title: label })).join("")}<span class="d-center" aria-hidden="true">◆</span></div>
          <div class="action-grid">
            ${button(icon("◇") + "調查", "inspect", null, { css: "field-action investigate" })}
            ${button(icon("♨") + "紮營", "panel", "camp", { css: "field-action" })}
            ${button(icon("▧") + "背包", "panel", "bag", { css: "field-action" })}
            ${button(icon("⊣") + "撤退", "retreat", null, { css: "field-action" })}
          </div>
        </div>
      </div>
    </section>`;
  }

  function enemyCards(battle, lane) {
    const foes = battle.enemies.filter((enemy) => enemy.row === lane);
    if (!foes.length) return "";
    return `<div class="encounter-lane lane-${lane}">${foes.map((enemy) => {
      const data = db().enemiesById[enemy.id];
      const desc = healthText(enemy);
      const statuses = enemy.statuses.map((entry) => db().statuses[entry.id]?.name).filter(Boolean);
      return `<div class="enemy-card ${enemy.isBoss ? "boss" : ""} ${enemy.isDead ? "defeated" : ""}" aria-label="${html(enemy.name + "，" + desc)}">
        <div title="${html(data.appearance)}" class="enemy-art art-${html(data.art)}" aria-hidden="true"></div>
        <div class="enemy-label"><strong>${html(enemy.name)}</strong>${meter(enemy.hp / enemy.maxHp, "enemy-hp", desc)}
        ${enemy.isDead || statuses.length ? `<small>${enemy.isDead ? "倒地" : html(statuses.join("・"))}</small>` : ""}</div>
      </div>`;
    }).join("")}</div>`;
  }

  function combatScreen(state) {
    const battle = state.dungeonState.battle;
    const charge = battle.enemies.find((enemy) => enemy.isCharging);
    const message = charge ? db().enemiesById[charge.id].chargeSkill.telegraph :
      battle.enemies.some((enemy) => enemy.isBoss && enemy.phase === 2) ? "首領已陷入狂怒。" :
      battle.dark && battle.turn < db().balance.darkRounds ? "火把已熄，攻勢難辨。" : "石室裡只剩兵刃與呼吸聲。";
    const actor = battle.party.find((entry) => entry.id === battle.selected);
    const actions = actor ? R.Combat.available(actor, battle, db()) : [];
    const auto = battle.autoMode;
    const log = battle.logs.length ? battle.logs.slice(-3) : ["敵影從石道圍近。"];
    return `<section class="screen combat" aria-label="戰鬥">
      <header class="telegraph ${charge ? "charging" : ""}">
        <div class="telegraph-copy"><div>${icon(charge ? "◈" : "◇")}<strong>${charge ? "蓄力預兆" : "交戰"}</strong></div>
        <span>${html(message)}</span></div>
        ${charge ? meter(charge.poise / charge.poiseMax, "poise", "首領韌性") : ""}
      </header>
      <div class="scene battle-scene ${battle.dark ? "unlit" : ""}"><canvas id="battle-space" aria-hidden="true"></canvas>${enemyCards(battle, "back")}${enemyCards(battle, "front")}</div>
      <div class="battle-log" aria-live="polite"><span>戰報</span><ol>${log.map((entry) => `<li>${html(entry)}</li>`).join("")}</ol></div>
      ${partyCards(state, battle)}
      <div class="combat-controls">
        <div class="combat-mode"><div><strong>${html(actor?.name || "全隊")}</strong><small>${auto ? "依戰術順序行動" : "點選隊員編排指令"}</small></div>
          ${button(auto ? "自動・開" : "手動下令", "auto", null, { css: "mode-button " + (auto ? "is-auto" : ""), label: auto ? "切換為手動下令" : "啟用自動戰術" })}</div>
        <div class="action-grid combat-actions">
          ${button(icon("⚔︎") + "普攻", "requestAction", "attack", { disabled: auto || !actions.some((action) => action.type === "attack") })}
          ${button(icon("◇") + "技能・法術", "panel", "skills", { disabled: auto || !actor })}
          ${button(icon("◈") + "防禦", "requestAction", "defend", { disabled: auto || !actor })}
          ${button(icon("▧") + "道具・撤離", "panel", "combatBag")}
        </div>
        ${button("執行本回合行動", "turn", null, { css: "primary turn-button" })}
      </div>
    </section>`;
  }

  const blank = (text) => `<p class="empty">${html(text)}</p>`;
  const heading = (title) => `<h3 class="sheet-subtitle">${html(title)}</h3>`;
  const link = (text, panel, arg) => button(html(text), "panel", panel, { extra: arg, css: "wide" });
  const rows = (entries, content) => entries.length ? entries.map(content).join("") : blank("目前沒有紀錄。");
  function row(title, description, controls = "", css = "") {
    return `<div class="sheet-row ${css}"><div><strong>${html(title)}</strong>${description ? `<small>${html(description)}</small>` : ""}</div>${controls}</div>`;
  }
  function switcher(chosen, entries, panel) {
    return `<div class="sheet-tabs">${entries.map(([id, text]) => button(text, "panel", panel, { css: id === chosen ? "selected" : "", extra: id })).join("")}</div>`;
  }
  function options(entries) {
    return Object.entries(entries).map(([id, title]) => `<option value="${html(id)}">${html(title.name || title)}</option>`).join("");
  }
  const qualityName = (item) => item?.quality === "unique" ? "獨特" : ["", "普通", "精良", "魔法", "獨特", "詛咒"][item?.tier] || "";
  const itemTitle = (entry) => entry?.identified === false ? "未鑑定裝備" : db().itemsById[R.Formulas.itemId(entry)]?.name || "裝備";

  function shop(state, segment = "consumables") {
    let content = "";
    if (segment === "sell") {
      content = rows(state.inventory, (entry, i) => {
        const item = db().itemsById[R.Formulas.itemId(entry)];
        return row(itemTitle(entry), entry.identified === false ? "鑑定費 20 金幣" : `賣價 ${R.Formulas.price(item, true)} 金幣`,
          button(entry.identified === false ? "鑑定" : "出售", entry.identified === false ? "identify" : "sell", i));
      });
    } else {
      const goods = R.Town.stock(state).filter((item) => segment === "consumables" ? item.limit : !item.limit);
      content = rows(goods, (item) => {
        const price = R.Formulas.price(item);
        const count = item.field ? state[item.field] : state.pouch[item.id] || 0;
        const limit = R.Town.limit(state, item.id);
        return row(item.name, item.desc, `<div class="row-actions">${item.limit ? `<small>${count} / ${limit}</small>` : ""}
          ${button(price + " 金幣", "buy", item.id, { disabled: price > state.gold || Boolean(limit && count >= limit), label: "購買" + item.name + "，" + price + "金幣" })}</div>`);
      });
    }
    return `<p class="sheet-balance">持有 ${state.gold} 金幣</p>${switcher(segment, [["consumables", "補給"], ["gear", "裝備"], ["sell", "出售・鑑定"]], "shop")}${content}`;
  }

  function actorSheet(state, actor) {
    if (!actor) return blank("找不到此人。");
    const classData = db().classes[actor.classId];
    const canGear = !state.dungeonState?.battle && R.Town.active(actor);
    return `<p class="sheet-balance">${db().races[actor.race].name}・${classData.name}・${alignment[actor.alignment]}・Lv.${actor.level}</p>
      <div class="actor-summary">${row("生命", healthText(actor), `<strong>${actor.hp} / ${actor.maxHp}</strong>`)}
      ${row("法術位", actor.slots.some((value, i) => value || actor.maxSlots[i]) ? actor.slots.map((count, i) => count + "/" + actor.maxSlots[i]).join("・") : "無法術")}${row("靈魂傷痕", "", `<strong>${actor.soulScars}</strong>`)}</div>
      ${heading("傷勢")}${Object.values(actor.injuries).some(Boolean) ?
        Object.entries(actor.injuries).filter(([, level]) => level).map(([id, level]) => row(injury[id], level === 1 ? "輕傷" : "重傷")).join("") : blank("沒有部位傷勢。")}
      ${heading("裝備")}${Object.entries(slots).map(([slot, name]) => {
        const entry = actor.equipment[slot];
        const item = db().itemsById[R.Formulas.itemId(entry)];
        return row(name + "・" + (item?.name || "空"), item?.desc, canGear && entry ? button("卸下", "unequip", actor.id, { extra: slot }) : "");
      }).join("")}
      ${canGear ? link("開啟裝備背包", "bag", actor.id) : ""}
      ${heading("自動戰術優先序")}${actor.gambits.map((id, i) => row(gambits[id], "", `<div class="pair">
        ${button("↑", "gambit", actor.id, { extra: i, third: -1, disabled: i === 0, label: "提高優先序" })}
        ${button("↓", "gambit", actor.id, { extra: i, third: 1, disabled: i === actor.gambits.length - 1, label: "降低優先序" })}</div>`)).join("")}`;
  }

  function bag(state, actorId) {
    return `${heading("消耗品")}
      ${row("火把", `餘 ${state.torches} 把`, state.dungeonState ? button("點燃", "light", null, { disabled: state.dungeonState.torch > 0 || !state.torches }) : "")}
      ${row("補給", `${state.supplies} / ${R.Town.limit(state, "supplies")}`)}
      ${row("回城卷軸", `餘 ${state.townScrolls} 張`, state.dungeonState ? link("使用", "retreat") : "")}
      ${db().items.consumables.filter((item) => item.heal && state.pouch[item.id]).map((item) =>
        row(item.name, item.desc + `　餘 ${state.pouch[item.id]} 份`, link("使用", "potion", item.id))).join("")}
      ${heading("裝備背包・" + state.inventory.length + " / " + R.Town.limit(state, "bag"))}
      ${rows(state.inventory, (entry, i) => row(itemTitle(entry), entry.identified === false ? "商店可鑑定。" :
        db().itemsById[R.Formulas.itemId(entry)].desc, entry.identified === false ? "" :
        button("比較", "panel", "compare", { extra: i, third: actorId })))}
      ${state.stash.length ? heading("回城保管") + state.stash.map((entry, i) =>
        row(itemTitle(entry), "裝備滿時由城鎮保管。", state.dungeonState ? "" : button("取出", "stash", i, { disabled: state.inventory.length >= R.Town.limit(state, "bag") }))).join("") : ""}
      ${heading("遺物")}${rows(state.relics, (id) => row(db().itemsById[id]?.name, db().itemsById[id]?.desc))}`;
  }

  function comparison(state, index, actorId) {
    const item = db().itemsById[R.Formulas.itemId(state.inventory[index])];
    if (!item) return blank("找不到此裝備。");
    const slot = item.slot || "weapon";
    return `<p>${html(item.name)}・${html(qualityName(item))}</p><p>${html(item.desc)}</p>${rows(actorId ? [actorFor(state, actorId)].filter(Boolean) : state.party, (actor) => {
      const now = actor.derived;
      const after = R.Formulas.calcDerivedStats({ ...actor, equipment: { ...actor.equipment, [slot]: item.id } }, db());
      const statDiff = [["patk", "物攻"], ["matk", "法強"], ["hatk", "神聖"], ["pdef", "物防"], ["mdef", "魔抗"], ["spd", "速度"]]
        .flatMap(([key, label]) => Math.abs(after[key] - now[key]) < 0.01 ? [] :
          [`${label} ${Number(now[key].toFixed(1))} → ${Number(after[key].toFixed(1))}`]);
      const old = db().itemsById[R.Formulas.itemId(actor.equipment[slot])]?.name || "空";
      return row(actor.name + "・" + old, statDiff.join("，") || "數值相同。",
        button("裝備", "equip", actor.id, { extra: index, disabled: !R.Town.active(actor) }));
    })}`;
  }

  function dialog(panel, state) {
    if (!panel) return "";
    const { name, arg, extra } = panel;
    const b = state.dungeonState?.battle;
    const actor = b?.party.find((entry) => entry.id === b.selected);
    let title;
    let content;
    switch (name) {
      case "settings":
        title = "設定與存檔";
        content = `${heading("難度")}
          ${row("標準", "按原有規則交戰。", button(state.difficulty === "standard" ? "使用中" : "選擇", "difficulty", "standard", { disabled: state.difficulty === "standard" || Boolean(state.dungeonState) }))}
          ${row("無情", "敵人的攻擊更加致命。", button(state.difficulty === "ruthless" ? "使用中" : "選擇", "difficulty", "ruthless", { disabled: state.difficulty === "ruthless" || Boolean(state.dungeonState) }))}
          ${row("音效", state.preferences.mute ? "關閉" : "開啟", button(state.preferences.mute ? "開啟" : "靜音", "mute"))}
          ${heading("瀏覽器自動存檔")}${button("匯出文字存檔", "export", null, { css: "wide" })}${button("匯入文字存檔", "import", null, { css: "wide" })}`;
        break;
      case "export":
        title = "匯出存檔";
        content = `<textarea id="save-token" readonly aria-label="存檔文字">${html(R.Storage.exportString(state))}</textarea>${button("複製存檔", "copy", null, { css: "wide" })}`;
        break;
      case "import":
        title = "匯入存檔";
        content = `<form id="import-form"><label>貼上存檔文字<textarea name="token" required></textarea></label><p>匯入會覆蓋目前進度。</p><button class="button primary wide" type="submit">匯入並覆蓋</button></form>`;
        break;
      case "inn":
        title = "旅店";
        content = row("壁爐旁的通鋪", "回復生命、法術位與輕傷。", button(db().balance.innPrice + " 金幣", "inn", null, { disabled: state.gold < db().balance.innPrice })) + link("整理背包", "bag");
        break;
      case "shop": title = "行腳商店"; content = shop(state, arg); break;
      case "temple":
        title = "神殿";
        content = rows(R.Town.all(state), (pc) => {
          const cursed = Object.values(pc.equipment).some((entry) => db().itemsById[R.Formulas.itemId(entry)]?.curse && !entry.uncursed);
          return row(pc.name + "・" + healthText(pc), "靈魂傷痕 " + pc.soulScars, `<div class="row-actions">` +
            (pc.isDead ? button("喚魂・" + 150 * pc.level, "revive", pc.id, { disabled: state.gold < 150 * pc.level }) :
              button("治傷・" + db().balance.injuryTreatment, "treat", pc.id, { disabled: !Object.values(pc.injuries).some(Boolean) || state.gold < db().balance.injuryTreatment }) +
              (cursed ? button("破咒・" + db().balance.curseRemoval, "uncurse", pc.id, { disabled: state.gold < db().balance.curseRemoval }) : "")) + "</div>");
        });
        break;
      case "training":
        title = "修練場";
        content = arg ? (() => {
          const pc = actorFor(state, arg);
          if (!pc) return blank("找不到此人。");
          const rules = db().classes[pc.classId];
          return `<p>${html(pc.name)}・可分配 ${pc.points} 點</p>
            <div class="stat-grid">${Object.entries(statNames).map(([id, text]) =>
              button(`${text} ${pc.attributes[id]} ＋`, "allocate", pc.id, { extra: id, disabled: !pc.points })).join("")}</div>
            ${heading("職業進階")}${rules.advancements.length ? rows(rules.advancements, (id) =>
              row(db().classes[id].name, "達 Lv.10 並交付試煉徽記。", button("進階", "advance", pc.id,
                { extra: id, disabled: pc.level < 10 || !state.relics.includes("trial_badge") }))) : blank("已走上進階道路。")}`;
        })() : rows(R.Town.all(state), (pc) => row(pc.name, `Lv.${pc.level}・${pc.points} 點待分配`,
          button("修練", "panel", "training", { extra: pc.id })));
        break;
      case "tavern":
        title = "酒館";
        content = link("免費招募", "recruit") + link("整頓隊形", "roster") + heading("酒館傳聞") +
          db().world.rumors.map((rumor, i) => link(["瘸腿的王", "營寨戰鼓", "熄火之後", "空心石壁"][i], "rumor", rumor.id)).join("");
        break;
      case "rumor":
        title = "酒館傳聞";
        content = "<blockquote>" + html(db().world.rumors.find((rumor) => rumor.id === arg)?.text) + "</blockquote>" + link("回酒館", "tavern");
        break;
      case "recruit":
        title = "招募冒險者";
        content = `<form id="recruit-form"><label>姓名<input name="name" required maxlength="8" autocomplete="off"></label>
          <label>種族<select name="race">${options(db().races)}</select></label><label>職業<select name="classId">${options(Object.fromEntries(Object.entries(db().classes).filter(([, job]) => job.tier === 1)))}</select></label>
          <label>陣營<select name="alignment">${options({ neutral: "中立", good: "善", evil: "惡" })}</select></label>
          <button type="submit" class="button wide primary">錄用</button></form>`;
        break;
      case "roster":
        title = "隊伍編制";
        content = `${heading("前排三人・後排兩人")}${rows(state.party, (pc, i) => row(pc.name,
          (i < 3 ? "前排" : "後排") + "・" + db().classes[pc.classId].name,
          button("調整", "panel", "place", { extra: pc.id })))}
          ${heading("候命隊員")}${rows(state.roster, (pc) => row(pc.name, db().classes[pc.classId].name, button("編入", "panel", "place", { extra: pc.id })))}
          ${link("招募冒險者", "recruit")}`;
        break;
      case "place":
        title = "安排站位";
        content = rows(state.party, (pc, i) => row(pc.name, (i < 3 ? "前排" : "後排") + "・" + db().classes[pc.classId].name,
          button("安排", "place", arg, { extra: i }))) + link("查看隊伍", "roster");
        break;
      case "codex":
        title = "生態圖鑑";
        content = rows(db().world.codex.filter((entry) => state.codex[entry.id]), (entry) => {
          const data = db().enemiesById[entry.id];
          const record = state.codex[entry.id];
          return row(data.name, record.defeated ? entry.text : "只見過身影。", `<small>擊倒 ${record.defeated}</small>`);
        });
        break;
      case "common":
        title = "窮鬼的生活常識";
        content = rows(db().world.commonSense.filter((entry) => state.commonSense.includes(entry.id) || ["torch", "camp"].includes(entry.id)),
          (entry) => `<blockquote>${html(entry.text)}</blockquote>`);
        break;
      case "travel":
        title = "營火傳送";
        content = rows(db().world.floors, (floor) => row(floor.floor + "F・" + floor.name, state.unlockedCampFloors.includes(floor.floor) ? "前廳火種仍在。" : "營火尚未點亮。",
          button("傳送", "enter", floor.floor, { extra: "camp", disabled: !state.unlockedCampFloors.includes(floor.floor) })));
        break;
      case "actor": {
        const pc = actorFor(state, arg);
        title = pc?.name || "冒險者";
        content = actorSheet(state, pc);
        break;
      }
      case "bag": title = "行囊"; content = bag(state, arg); break;
      case "compare": title = "裝備對比"; content = comparison(state, Number(arg), extra); break;
      case "potion":
      case "combatPotion":
        title = db().itemsById[arg]?.name || "藥水";
        content = rows(state.party.filter((pc) => !pc.isDead), (pc) => row(pc.name, healthText(pc),
          button("給予", name === "potion" ? "drink" : "queueItem", arg, { extra: pc.id })));
        break;
      case "camp":
        title = "紮營";
        content = `<blockquote>分食能回復生命與各環法術位。火光也可能引來敵人。</blockquote>
          ${row("補給・" + state.supplies + " 份", "消耗一份補給。", button("架火紮營", "camp", null, { disabled: !state.supplies }))}`;
        break;
      case "bonfire":
        title = "前廳營火";
        content = `${state.dungeonState.bonfireUsed ? blank("這趟已在營火旁休息過。") :
          row("免費小憩", "回復半數生命與部分法術位。", button("小憩", "bonfire", "small")) +
          row("添柴休整", "回滿生命與法術位，解除輕傷。", button("長歇", "bonfire", "full", { disabled: !state.supplies }))}`;
        break;
      case "story": title = "火光裡"; content = arg.map((line) => `<blockquote>${html(line)}</blockquote>`).join(""); break;
      case "reading": title = "石壁刻字"; content = `<blockquote>${html(arg)}</blockquote>`; break;
      case "stairs":
        title = "向下石階";
        content = row("獸人營寨", state.clearedFloors.includes(1) ? "石階通往營寨。" : "首領仍守著石階。", button("下樓", "floor", 2, { disabled: !state.clearedFloors.includes(1) }));
        break;
      case "shortcut":
      case "retreat": {
        const on = dungeon.featureAt(state.dungeonState) || [];
        title = name === "shortcut" ? "單向捷門" : "撤離";
        content = row("循石階回城", on.includes("entry") || on.includes("shortcut") ? "這裡可通往地面。" : "前往入口石階或尋找單向門。",
          on.includes("entry") || on.includes("shortcut") ? button("回城", "retreat") : "") +
          (state.dungeonState.floor === 2 && on.includes("entry") ? row("返回哥布林巢穴", "回到一樓石階。", button("上樓", "floor", 1)) : "") +
          row("回城卷軸", "離開後遺落半數金幣。", button("撕開卷軸", "scroll", null, { disabled: !state.townScrolls }));
        break;
      }
      case "skills":
        title = actor ? actor.name + "的指令" : "指令";
        content = rows(actor?.learned || [], (id) => {
          const action = db().actions[id];
          const canUse = R.Combat.available(actor, b, db()).some((entry) => entry.id === id);
          return row(action.name, action.desc, button(action.type === "spell" ? "施法" : "下令", "requestAction", id, { disabled: !canUse }));
        });
        if (actor) content += row("法術位", actor.slots.map((count, i) => count + "/" + actor.maxSlots[i]).join("・"));
        break;
      case "target": {
        const action = actor && R.Combat.actionFor(arg, actor, db());
        title = action?.name || "選擇目標";
        content = rows(action ? R.Combat.candidates(actor, action, b, db()) : [], (target) =>
          row(target.name, healthText(target), button("選定", "manual", arg, { extra: target.uid })));
        break;
      }
      case "combatBag":
        title = "道具與撤離";
        content = rows(db().items.consumables.filter((item) => item.heal && state.pouch[item.id]), (item) => row(item.name, item.desc,
          button("給予", "panel", "combatPotion", { extra: item.id, disabled: b.autoMode }))) +
          row("撤離交戰", ["boss", "hidden"].includes(b.type) ? "首領封死了退路。" : "安排所選隊員嘗試撤退。",
            button("撤退", "combatRetreat", null, { disabled: ["boss", "hidden"].includes(b.type) })) +
          row("回城卷軸", "離開後遺落半數金幣。", button("撕開卷軸", "scroll", null, { disabled: !b.townScrolls || !R.Combat.scrollUser(b) }));
        break;
      case "aftermath":
        title = arg.result === "victory" ? "交戰落幕" : "逃離交戰";
        content = `<ol class="result-log">${arg.logs.slice(-3).map((log) => `<li>${html(log)}</li>`).join("")}</ol>` +
          button(state.dungeonState ? "繼續探索" : "返回城鎮", "close", null, { css: "primary wide" });
        break;
      default: return "";
    }
    return `<div class="scrim" ${binding("close")}><section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <header><h2 id="sheet-title">${html(title)}</h2>${button("×", "close", null, { css: "icon-button close-sheet", label: "關閉" })}</header>
      <div class="sheet-body" tabindex="0">${content}</div>
    </section></div>`;
  }

  function renderScreen(screen, state, panel) {
    const target = root.document.getElementById("game");
    const prevSheet = target.querySelector(".sheet-body");
    const oldTitle = target.querySelector("#sheet-title")?.textContent;
    const scroll = prevSheet?.scrollTop || 0;
    const current = screen === "DUNGEON" || screen === "DUNGEON_OVERLAY" ? dungeonScreen(state) :
      screen === "COMBAT" ? combatScreen(state) : town(state);
    const overlay = dialog(panel, state);
    target.innerHTML = current + overlay;
    if (overlay) target.querySelector(".screen").inert = true;
    const body = target.querySelector(".sheet-body");
    if (body && oldTitle === target.querySelector("#sheet-title")?.textContent) body.scrollTop = scroll;
    else if (body) target.querySelector(".close-sheet").focus({ preventScroll: true });
    const canvas = target.querySelector("#first-person");
    const room = target.querySelector("#battle-space");
    if (room) renderFirstPerson(room, state.dungeonState);
    if (canvas) {
      renderFirstPerson(canvas, state.dungeonState);
      renderMap(target.querySelector("#minimap"), state.dungeonState);
    }
  }

  function showToast(text) {
    const element = root.document.getElementById("notices");
    if (!element || !text) return;
    const message = root.document.createElement("p");
    message.textContent = text;
    if (element.children.length >= 2) element.firstElementChild.remove();
    element.append(message);
    root.setTimeout(() => message.remove(), 2600);
  }

  function renderFirstPerson(canvas, state) {
    const viewport = canvas.getBoundingClientRect();
    const dpi = Math.min(2, root.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(viewport.width * dpi));
    const h = Math.max(1, Math.round(viewport.height * dpi));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const fog = state.torch ? 5 : 2;
    const warm = state.floor === 1;
    const focal = Math.max(w * 0.75, h * 0.62);
    const [fx, fy] = dungeon.dirs[state.facing];
    const [rx, ry] = dungeon.dirs[(state.facing + 1) % 4];
    const solid = (x, z) => !dungeon.passable(state, state.x + rx * x + fx * z, state.y + ry * x + fy * z);
    const project = ([x, depth, elevation]) => [w / 2 + focal * x / depth, h * 0.48 + focal * (0.5 - elevation) / depth];
    const backdrop = ctx.createLinearGradient(0, 0, 0, h);
    for (const [pos, color] of [[0, "#08080b"], [.44, "#0e0d11"], [.51, "#0b0a0d"], [.56, "#292321"], [1, "#100e12"]]) backdrop.addColorStop(pos, color);
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, w, h);

    const surfaces = [];
    function surface(a, b, c, d, lateral, depth, orientation) {
      surfaces.push({ corners: [a, b, c, d], lateral, depth, orientation,
        distance: (a[1] + b[1] + c[1] + d[1]) / 4 });
    }
    for (let z = 0; z <= fog; z += 1) {
      for (let x = -3; x <= 3; x += 1) {
        if (solid(x, z)) continue;
        const front = Math.max(0.13, z - 0.5);
        const back = z + 0.5;
        const left = x - 0.5;
        const right = x + 0.5;
        surface([left, front, 0], [right, front, 0], [right, back, 0], [left, back, 0], x, z, "floor");
        surface([left, front, 1], [right, front, 1], [right, back, 1], [left, back, 1], x, z, "ceil");
        if (solid(x, z + 1)) surface([left, back, 1], [right, back, 1], [right, back, 0], [left, back, 0], x, z, "front");
        if (solid(x - 1, z)) surface([left, front, 1], [left, back, 1], [left, back, 0], [left, front, 0], x, z, "left");
        if (solid(x + 1, z)) surface([right, back, 1], [right, front, 1], [right, front, 0], [right, back, 0], x, z, "right");
      }
    }
    function poly(points, fill) {
      ctx.beginPath();
      for (const [i, point] of points.entries()) {
        const [x, y] = project(point);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
    const ordered = surfaces.sort((a, b) => b.distance - a.distance || Math.abs(b.lateral) - Math.abs(a.lateral));
    for (const face of ordered) {
      const [a, b, c, d] = face.corners;
      const tileRng = R.RNG.create(state.seed ^ Math.imul(state.x + face.lateral + 17, 1999) ^ Math.imul(state.y + face.depth * 3 + 9, 6673));
      const wall = !["floor", "ceil"].includes(face.orientation);
      const side = ["left", "right"].includes(face.orientation);
      const light = (state.torch ? 1 : 0.35) / (1 + face.depth * 0.29 + Math.abs(face.lateral) * 0.52);
      const base = wall ? (side ? 66 : 77) : (face.orientation === "floor" ? 47 : 31);
      const tint = (value) => warm ? `rgb(${value + 9 * light},${value * 0.87},${value * 0.79})` :
        `rgb(${value + 12 * light},${value * 0.82},${value * 0.72})`;
      const at = (u, v) => a.map((value, i) =>
        (1 - v) * (value + (b[i] - value) * u) + v * (d[i] + (c[i] - d[i]) * u));
      poly(face.corners, tint(base * light * 0.38));
      const rows = wall ? 5 : 3;
      const cols = 3;
      for (let row = 0; row < rows; row += 1) {
        const reset = row % 2 ? -0.14 : 0;
        for (let col = 0; col < cols + 1; col += 1) {
          const left = Math.max(0, col / cols + reset);
          const right = Math.min(1, (col + 1) / cols + reset - 0.012);
          if (left >= 1 || right <= left) continue;
          const top = row / rows + 0.004;
          const bottom = (row + 1) / rows - 0.013;
          const glaze = (base + tileRng.int(-13, 13)) * light;
          poly([at(left, top), at(right, top + 0.003), at(right - 0.005, bottom), at(left + 0.009, bottom - 0.004)],
            tint(glaze));
          poly([at(left, top), at(right, top + 0.003), at(right - 0.018, top + 0.019), at(left + 0.010, top + 0.019)],
            tint(glaze * 1.19));
          for (let grain = 0; grain < 3; grain += 1) {
            const u = tileRng.range(left, right - 0.005);
            const v = tileRng.range(top, bottom - 0.008);
            poly([at(u, v), at(Math.min(right, u + 0.03), v), at(Math.min(right, u + 0.04), v + 0.007),
              at(u, v + 0.006)], tint(glaze * tileRng.range(0.72, 1.14)));
          }
        }
      }
    }
    const landmark = dungeon.featureAt(state);
    if (landmark?.includes("camp") || landmark?.includes("hearth")) {
      const hot = landmark.includes("camp");
      const glow = ctx.createRadialGradient(w * .5, h * .76, 0, w * .5, h * .76, w * .27);
      glow.addColorStop(0, hot ? "#d87837af" : "#8b605130");
      glow.addColorStop(1, "transparent");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#1e1718";
      ctx.beginPath(); ctx.ellipse(w * .5, h * .79, w * .12, h * .035, 0, 0, Math.PI * 2); ctx.fill();
      if (hot) {
        const flame = ctx.createLinearGradient(0, h * .65, 0, h * .8);
        flame.addColorStop(0, "#e38643"); flame.addColorStop(1, "#f2d292");
        ctx.fillStyle = flame;
        ctx.beginPath(); ctx.moveTo(w * .45, h * .79); ctx.quadraticCurveTo(w * .47, h * .72, w * .495, h * .65);
        ctx.quadraticCurveTo(w * .495, h * .73, w * .51, h * .72);
        ctx.quadraticCurveTo(w * .525, h * .68, w * .53, h * .73);
        ctx.quadraticCurveTo(w * .56, h * .77, w * .55, h * .79); ctx.closePath(); ctx.fill();
      }
    }
    const light = ctx.createRadialGradient(w * 0.47, h * 0.51, h * 0.06, w * 0.53, h * 0.52, w * 0.72);
    light.addColorStop(0, state.torch ? "#c07d391c" : "#1d192000");
    light.addColorStop(0.65, "#08070a1e");
    light.addColorStop(1, "#070609f0");
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, w, h);
  }

  function renderMap(canvas, state) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const radius = 5;
    const square = w / (radius * 2 + 1);
    const seen = new Set(state.seen);
    ctx.clearRect(0, 0, w, w);
    ctx.fillStyle = "#131114d9";
    ctx.fillRect(0, 0, w, w);
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const x = state.x + dx;
        const y = state.y + dy;
        if (!seen.has(dungeon.key(x, y))) continue;
        const walk = dungeon.passable(state, x, y);
        const feature = dungeon.featureAt(state, x, y);
        ctx.fillStyle = walk ? feature ? "#886041" : "#63564d" : "#2d2a2d";
        ctx.fillRect((dx + radius) * square + 1, (dy + radius) * square + 1, square - 2, square - 2);
      }
    }
    ctx.save();
    ctx.translate(w / 2, w / 2);
    ctx.rotate(state.facing * Math.PI / 2);
    ctx.fillStyle = "#f5cf98";
    ctx.beginPath(); ctx.moveTo(0, -square * 0.42); ctx.lineTo(square * 0.33, square * 0.32);
    ctx.lineTo(0, square * 0.15); ctx.lineTo(-square * 0.33, square * 0.32); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  R.UI = { renderScreen, renderFirstPerson, showToast };
}(globalThis.RPG3, globalThis));
