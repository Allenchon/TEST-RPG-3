(function (root) {
  "use strict";
  function create(seed) {
    let state = seed >>> 0;
    function next() {
      state = (state + 0x6D2B79F5) >>> 0;
      let value = Math.imul(state ^ (state >>> 15), state | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next,
      int(min, max) { return min + Math.floor(next() * (max - min + 1)); },
      range(min, max) { return min + next() * (max - min); },
      snapshot() { return state; }
    };
  }
  root.RPG3 = root.RPG3 || {};
  root.RPG3.RNG = { create };
}(typeof window === "undefined" ? globalThis : window));
