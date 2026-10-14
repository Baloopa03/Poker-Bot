"use strict";
(() => {
  // src/engine/cards.ts
  var RANKS = "23456789TJQKA";
  var SUITS = "cdhs";
  var rankOf = (c) => c >> 2;
  var suitOf = (c) => c & 3;
  var makeCard = (rank, suit) => rank * 4 + suit;
  var SUIT_WORDS = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 };
  function parseCard(text) {
    const t = text.trim();
    const rankText = t.slice(0, -1).toUpperCase();
    const suitText = t.slice(-1).toLowerCase();
    const rank = rankText === "10" ? 8 : RANKS.indexOf(rankText);
    const suit = SUITS.indexOf(suitText);
    if (rankText.length !== 1 && rankText !== "10") throw new Error(`Bad card: ${text}`);
    if (rank < 0 || suit < 0) throw new Error(`Bad card: ${text}`);
    return makeCard(rank, suit);
  }
  function parseSiteCard(suite, value) {
    const suit = SUIT_WORDS[suite.toLowerCase()];
    if (suit === void 0) throw new Error(`Bad suite: ${suite}`);
    return parseCard(`${value}${SUITS[suit]}`);
  }
  function parseCards(text) {
    const t = text.replace(/[\s,]/g, "");
    const out = [];
    for (let i = 0; i < t.length; ) {
      const len = t.startsWith("10", i) ? 3 : 2;
      out.push(parseCard(t.slice(i, i + len)));
      i += len;
    }
    return out;
  }
  var cardToString = (c) => RANKS[rankOf(c)] + SUITS[suitOf(c)];
  var cardsToString = (cs) => cs.map(cardToString).join(" ");

  // src/engine/evaluator.ts
  var CATEGORY_NAMES = [
    "high card",
    "pair",
    "two pair",
    "three of a kind",
    "straight",
    "flush",
    "full house",
    "four of a kind",
    "straight flush"
  ];
  var score = (cat, r1 = 0, r2 = 0, r3 = 0, r4 = 0, r5 = 0) => cat << 20 | r1 << 16 | r2 << 12 | r3 << 8 | r4 << 4 | r5;
  function straightHigh(mask) {
    for (let hi = 12; hi >= 4; hi--) {
      const need = 31 << hi - 4;
      if ((mask & need) === need) return hi;
    }
    return (mask & 4111) === 4111 ? 3 : -1;
  }
  function topRanks(mask, n) {
    const out = [];
    for (let r = 12; r >= 0 && out.length < n; r--) if (mask & 1 << r) out.push(r);
    return out;
  }
  var suitMasks = new Int32Array(4);
  var counts = new Int32Array(13);
  function evaluate(cards, len = cards.length) {
    suitMasks.fill(0);
    counts.fill(0);
    let rankMask = 0;
    for (let i = 0; i < len; i++) {
      const c2 = cards[i];
      const r = c2 >> 2;
      suitMasks[c2 & 3] |= 1 << r;
      counts[r]++;
      rankMask |= 1 << r;
    }
    for (let s = 0; s < 4; s++) {
      const m = suitMasks[s];
      if (popcount(m) >= 5) {
        const sf = straightHigh(m);
        if (sf >= 0) return score(8 /* StraightFlush */, sf);
        const [a2, b2, c2, d2, e2] = topRanks(m, 5);
        return score(5 /* Flush */, a2, b2, c2, d2, e2);
      }
    }
    let quad = -1;
    let trip1 = -1;
    let trip2 = -1;
    let pair1 = -1;
    let pair2 = -1;
    for (let r = 12; r >= 0; r--) {
      const n = counts[r];
      if (n === 4) quad = r;
      else if (n === 3) {
        if (trip1 < 0) trip1 = r;
        else if (trip2 < 0) trip2 = r;
      } else if (n === 2) {
        if (pair1 < 0) pair1 = r;
        else if (pair2 < 0) pair2 = r;
      }
    }
    if (quad >= 0) return score(7 /* Quads */, quad, topRanks(rankMask & ~(1 << quad), 1)[0]);
    if (trip1 >= 0 && (trip2 >= 0 || pair1 >= 0)) return score(6 /* FullHouse */, trip1, Math.max(trip2, pair1));
    const st = straightHigh(rankMask);
    if (st >= 0) return score(4 /* Straight */, st);
    if (trip1 >= 0) {
      const [a2, b2] = topRanks(rankMask & ~(1 << trip1), 2);
      return score(3 /* Trips */, trip1, a2, b2);
    }
    if (pair2 >= 0) {
      const [k] = topRanks(rankMask & ~(1 << pair1) & ~(1 << pair2), 1);
      return score(2 /* TwoPair */, pair1, pair2, k);
    }
    if (pair1 >= 0) {
      const [a2, b2, c2] = topRanks(rankMask & ~(1 << pair1), 3);
      return score(1 /* Pair */, pair1, a2, b2, c2);
    }
    const [a, b, c, d, e] = topRanks(rankMask, 5);
    return score(0 /* HighCard */, a, b, c, d, e);
  }
  function popcount(x) {
    x -= x >> 1 & 1431655765;
    x = (x & 858993459) + (x >> 2 & 858993459);
    return (x + (x >> 4) & 252645135) * 16843009 >>> 24;
  }
  var categoryOf = (s) => s >> 20;

  // src/engine/range.ts
  var NUM_COMBOS = 1326;
  var COMBOS = (() => {
    const out = [];
    for (let a = 51; a >= 0; a--) for (let b = a - 1; b >= 0; b--) out.push([a, b]);
    return out;
  })();
  var INDEX = new Int16Array(52 * 52).fill(-1);
  COMBOS.forEach(([a, b], i) => {
    INDEX[a * 52 + b] = i;
    INDEX[b * 52 + a] = i;
  });
  var comboIndex = (a, b) => INDEX[a * 52 + b];
  function classOf(a, b) {
    const ra = rankOf(a);
    const rb = rankOf(b);
    const hi = Math.max(ra, rb);
    const lo = Math.min(ra, rb);
    if (hi === lo) return RANKS[hi] + RANKS[lo];
    return RANKS[hi] + RANKS[lo] + (suitOf(a) === suitOf(b) ? "s" : "o");
  }
  var CLASS_OF_COMBO = COMBOS.map(([a, b]) => classOf(a, b));
  var ALL_CLASSES = (() => {
    const out = [];
    for (let i = 12; i >= 0; i--)
      for (let j = 12; j >= 0; j--) {
        if (i === j) out.push(RANKS[i] + RANKS[j]);
        else if (j < i) out.push(RANKS[i] + RANKS[j] + "s");
        else out.push(RANKS[j] + RANKS[i] + "o");
      }
    return out;
  })();
  var CLASS_INDEX = (() => {
    const m = /* @__PURE__ */ new Map();
    CLASS_OF_COMBO.forEach((c, i) => {
      if (!m.has(c)) m.set(c, []);
      m.get(c).push(i);
    });
    return m;
  })();
  var Range = class _Range {
    w;
    constructor(weights) {
      this.w = weights ?? new Float64Array(NUM_COMBOS);
    }
    static full() {
      return new _Range(new Float64Array(NUM_COMBOS).fill(1));
    }
    static parse(text) {
      return parseRange(text);
    }
    clone() {
      return new _Range(Float64Array.from(this.w));
    }
    setClass(cls, weight) {
      for (const i of CLASS_INDEX.get(cls) ?? []) this.w[i] = weight;
      return this;
    }
    classWeight(cls) {
      const idx = CLASS_INDEX.get(cls) ?? [];
      let s = 0;
      for (const i of idx) s += this.w[i];
      return idx.length ? s / idx.length : 0;
    }
    /** Zero out combos that use any of these (dead) cards. */
    removeCards(dead) {
      if (!dead.length) return this;
      const isDead = new Uint8Array(52);
      for (const c of dead) isDead[c] = 1;
      COMBOS.forEach(([a, b], i) => {
        if (isDead[a] || isDead[b]) this.w[i] = 0;
      });
      return this;
    }
    /** Sum of weights (number of weighted combos). */
    size() {
      let s = 0;
      for (let i = 0; i < NUM_COMBOS; i++) s += this.w[i];
      return s;
    }
    /** Fraction of all 1326 combos, 0..1. */
    fraction() {
      return this.size() / NUM_COMBOS;
    }
  };
  function pairRanks(from, to) {
    const out = [];
    for (let r = Math.min(from, to); r <= Math.max(from, to); r++) out.push(RANKS[r] + RANKS[r]);
    return out;
  }
  var rankIdx = (ch) => {
    const r = RANKS.indexOf(ch.toUpperCase());
    if (r < 0) throw new Error(`Bad rank: ${ch}`);
    return r;
  };
  function expandToken(tok) {
    const t = tok.trim();
    if (!t) return {};
    if (/^(any|random|100%)$/i.test(t)) return { classes: [...ALL_CLASSES] };
    if (/^([2-9TJQKA]|10)[cdhs]([2-9TJQKA]|10)[cdhs]$/i.test(t)) {
      const [a3, b3] = parseCards(t);
      return { combos: [comboIndex(a3, b3)] };
    }
    const m = /^([2-9TJQKA])([2-9TJQKA])([so]?)(\+)?(?:-([2-9TJQKA])([2-9TJQKA])([so]?))?$/i.exec(t);
    if (!m) throw new Error(`Bad range token: ${tok}`);
    const [, a, b, kind, plus, a2, b2] = m;
    const ra = rankIdx(a);
    const rb = rankIdx(b);
    const suffixes = kind ? [kind.toLowerCase()] : ["s", "o"];
    if (ra === rb) {
      if (a2) return { classes: pairRanks(ra, rankIdx(a2)) };
      return { classes: plus ? pairRanks(ra, 12) : [RANKS[ra] + RANKS[ra]] };
    }
    const hi = Math.max(ra, rb);
    const lo = Math.min(ra, rb);
    let kickers;
    if (a2) {
      const lo2 = Math.min(rankIdx(a2), rankIdx(b2));
      kickers = [];
      for (let k = Math.min(lo, lo2); k <= Math.max(lo, lo2); k++) kickers.push(k);
    } else if (plus) {
      kickers = [];
      for (let k = lo; k < hi; k++) kickers.push(k);
    } else kickers = [lo];
    const classes = [];
    for (const k of kickers) for (const s of suffixes) classes.push(RANKS[hi] + RANKS[k] + s);
    return { classes };
  }
  function parseRange(text) {
    const r = new Range();
    for (const raw of text.split(/[,\s]+/)) {
      if (!raw) continue;
      const [tok, wText] = raw.split(":");
      const weight = wText === void 0 ? 1 : Number(wText);
      const { classes, combos } = expandToken(tok);
      for (const c of classes ?? []) r.setClass(c, weight);
      for (const i of combos ?? []) r.w[i] = weight;
    }
    return r;
  }

  // src/engine/equity.ts
  function rng(seed = Date.now()) {
    let a = seed >>> 0;
    return () => {
      a = a + 1831565813 >>> 0;
      let t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var ComboSampler = class {
    idx;
    cum;
    total;
    constructor(range, dead) {
      const idx = [];
      const cum = [];
      let s = 0;
      for (let i = 0; i < NUM_COMBOS; i++) {
        const w = range.w[i];
        if (w <= 0) continue;
        const [a, b] = COMBOS[i];
        if (dead[a] || dead[b]) continue;
        s += w;
        idx.push(i);
        cum.push(s);
      }
      this.idx = Int32Array.from(idx);
      this.cum = Float64Array.from(cum);
      this.total = s;
    }
    sample(r) {
      const x = r * this.total;
      let lo = 0;
      let hi = this.cum.length - 1;
      while (lo < hi) {
        const mid = lo + hi >> 1;
        if (this.cum[mid] > x) hi = mid;
        else lo = mid + 1;
      }
      return this.idx[lo];
    }
  };
  function equity(input) {
    const { hero, board, villains } = input;
    const iterations = input.iterations ?? 2e4;
    const random = rng(input.seed ?? Date.now() ^ 2654435769);
    const dead = new Uint8Array(52);
    for (const c of [...hero, ...board, ...input.dead ?? []]) dead[c] = 1;
    const samplers = villains.map((v) => new ComboSampler(v, dead));
    if (samplers.some((s) => s.total <= 0)) throw new Error("A villain range is empty after removing dead cards");
    const stub = [];
    for (let c = 0; c < 52; c++) if (!dead[c]) stub.push(c);
    const seven = new Int32Array(7);
    const used = new Uint8Array(52);
    let won = 0;
    let tied = 0;
    let share = 0;
    let samples = 0;
    const villainCards = new Array(villains.length * 2);
    for (let it = 0; it < iterations; it++) {
      used.fill(0);
      let ok = true;
      for (let v = 0; v < samplers.length; v++) {
        let tries = 0;
        for (; ; ) {
          const [a, b] = COMBOS[samplers[v].sample(random())];
          if (!used[a] && !used[b]) {
            used[a] = used[b] = 1;
            villainCards[2 * v] = a;
            villainCards[2 * v + 1] = b;
            break;
          }
          if (++tries > 100) {
            ok = false;
            break;
          }
        }
        if (!ok) break;
      }
      if (!ok) continue;
      const runout = board.slice();
      let guard = 0;
      while (runout.length < 5 && guard++ < 1e3) {
        const c = stub[random() * stub.length | 0];
        if (used[c]) continue;
        used[c] = 1;
        runout.push(c);
      }
      if (runout.length < 5) continue;
      for (let i = 0; i < 5; i++) seven[2 + i] = runout[i];
      seven[0] = hero[0];
      seven[1] = hero[1];
      const heroScore = evaluate(seven);
      let best = heroScore;
      let tiesAtBest = 1;
      let heroBest = true;
      for (let v = 0; v < samplers.length; v++) {
        seven[0] = villainCards[2 * v];
        seven[1] = villainCards[2 * v + 1];
        const s = evaluate(seven);
        if (s > best) {
          best = s;
          tiesAtBest = 1;
          heroBest = false;
        } else if (s === best) tiesAtBest++;
      }
      samples++;
      if (heroBest && best === heroScore) {
        if (tiesAtBest === 1) {
          won++;
          share += 1;
        } else {
          tied++;
          share += 1 / tiesAtBest;
        }
      }
    }
    return { equity: share / samples, win: won / samples, tie: tied / samples, samples };
  }
  function riverEquityExact(hero, board, villain) {
    if (board.length !== 5) throw new Error("riverEquityExact needs a full board");
    const dead = new Uint8Array(52);
    for (const c of [...hero, ...board]) dead[c] = 1;
    const seven = Int32Array.from([hero[0], hero[1], ...board]);
    const heroScore = evaluate(seven);
    let total = 0;
    let win = 0;
    let tie = 0;
    for (let i = 0; i < NUM_COMBOS; i++) {
      const w = villain.w[i];
      if (w <= 0) continue;
      const [a, b] = COMBOS[i];
      if (dead[a] || dead[b]) continue;
      seven[0] = a;
      seven[1] = b;
      const s = evaluate(seven);
      total += w;
      if (heroScore > s) win += w;
      else if (heroScore === s) tie += w;
    }
    if (total <= 0) throw new Error("Villain range is empty");
    return { equity: (win + tie / 2) / total, win: win / total, tie: tie / total, samples: total };
  }

  // src/engine/preflop-equity.json
  var preflop_equity_default = { "22": [0.5044, 0.3087], "33": [0.5358, 0.338], "44": [0.5669, 0.3682], "55": [0.6045, 0.4047], "66": [0.6315, 0.4337], "77": [0.6633, 0.4613], "88": [0.6938, 0.498], "99": [0.7188, 0.5364], AA: [0.852, 0.7347], AKs: [0.6686, 0.4997], AQs: [0.665, 0.4904], AJs: [0.6571, 0.4767], ATs: [0.6477, 0.4688], A9s: [0.6248, 0.4456], A8s: [0.6182, 0.4325], A7s: [0.6101, 0.4263], A6s: [0.5991, 0.4119], A5s: [0.5925, 0.414], A4s: [0.5883, 0.4061], A3s: [0.5831, 0.397], A2s: [0.5762, 0.389], AKo: [0.6578, 0.4847], KK: [0.8275, 0.689], KQs: [0.6337, 0.471], KJs: [0.6266, 0.461], KTs: [0.6177, 0.4505], K9s: [0.5999, 0.425], K8s: [0.5812, 0.4023], K7s: [0.5751, 0.3887], K6s: [0.5655, 0.3875], K5s: [0.556, 0.3751], K4s: [0.5509, 0.3657], K3s: [0.5441, 0.3507], K2s: [0.5345, 0.3489], AQo: [0.6439, 0.4651], KQo: [0.6178, 0.4455], QQ: [0.8008, 0.6525], QJs: [0.6014, 0.4414], QTs: [0.5973, 0.4278], Q9s: [0.5754, 0.4081], Q8s: [0.5623, 0.3869], Q7s: [0.5413, 0.3639], Q6s: [0.5329, 0.3594], Q5s: [0.528, 0.3485], Q4s: [0.5167, 0.3437], Q3s: [0.5078, 0.3341], Q2s: [0.5001, 0.3254], AJo: [0.6283, 0.4547], KJo: [0.6062, 0.4332], QJo: [0.5817, 0.4107], JJ: [0.7731, 0.615], JTs: [0.5713, 0.4206], J9s: [0.5538, 0.3928], J8s: [0.5419, 0.3705], J7s: [0.5213, 0.3499], J6s: [0.5069, 0.3382], J5s: [0.4972, 0.3305], J4s: [0.4924, 0.3162], J3s: [0.484, 0.3108], J2s: [0.4739, 0.3071], ATo: [0.6276, 0.4468], KTo: [0.5956, 0.4179], QTo: [0.5749, 0.4075], JTo: [0.5503, 0.3916], TT: [0.7439, 0.5762], T9s: [0.5436, 0.3923], T8s: [0.5208, 0.3704], T7s: [0.5061, 0.3462], T6s: [0.4898, 0.3291], T5s: [0.4706, 0.3113], T4s: [0.4659, 0.3015], T3s: [0.4547, 0.2938], T2s: [0.4472, 0.2872], A9o: [0.6071, 0.4167], K9o: [0.5799, 0.3932], Q9o: [0.5506, 0.3752], J9o: [0.5345, 0.363], T9o: [0.5175, 0.3518], "98s": [0.5069, 0.3557], "97s": [0.4924, 0.3462], "96s": [0.4716, 0.3267], "95s": [0.4571, 0.3018], "94s": [0.4406, 0.2821], "93s": [0.4277, 0.2758], "92s": [0.4233, 0.2729], A8o: [0.5976, 0.4048], K8o: [0.5682, 0.3692], Q8o: [0.5319, 0.3523], J8o: [0.5141, 0.3397], T8o: [0.496, 0.3338], "98o": [0.4814, 0.3304], "87s": [0.4779, 0.3368], "86s": [0.4642, 0.3163], "85s": [0.4453, 0.304], "84s": [0.4218, 0.2818], "83s": [0.405, 0.2635], "82s": [0.4045, 0.2568], A7o: [0.5898, 0.3929], K7o: [0.5536, 0.361], Q7o: [0.5165, 0.3221], J7o: [0.494, 0.3217], T7o: [0.4756, 0.31], "97o": [0.4615, 0.3078], "87o": [0.4503, 0.3064], "76s": [0.454, 0.319], "75s": [0.4347, 0.2971], "74s": [0.418, 0.2859], "73s": [0.3978, 0.2643], "72s": [0.3891, 0.247], A6o: [0.5748, 0.3775], K6o: [0.5494, 0.3509], Q6o: [0.5212, 0.3192], J6o: [0.4754, 0.2965], T6o: [0.4637, 0.2945], "96o": [0.4489, 0.288], "86o": [0.4313, 0.2826], "76o": [0.4198, 0.2876], "65s": [0.4294, 0.3018], "64s": [0.4122, 0.2853], "63s": [0.3948, 0.2633], "62s": [0.377, 0.2459], A5o: [0.5791, 0.3823], K5o: [0.5367, 0.3428], Q5o: [0.5053, 0.3126], J5o: [0.4717, 0.2945], T5o: [0.4395, 0.2725], "95o": [0.4257, 0.2677], "85o": [0.4147, 0.2622], "75o": [0.4009, 0.2638], "65o": [0.3962, 0.2633], "54s": [0.413, 0.2923], "53s": [0.3983, 0.2691], "52s": [0.3752, 0.2545], A4o: [0.5703, 0.3681], K4o: [0.5259, 0.3306], Q4o: [0.4931, 0.3038], J4o: [0.4596, 0.2769], T4o: [0.4355, 0.264], "94o": [0.4032, 0.2511], "84o": [0.3949, 0.2428], "74o": [0.3884, 0.243], "64o": [0.3824, 0.2507], "54o": [0.3789, 0.2526], "43s": [0.3894, 0.2646], "42s": [0.3727, 0.243], A3o: [0.5616, 0.3622], K3o: [0.5153, 0.3145], Q3o: [0.4887, 0.295], J3o: [0.4495, 0.2726], T3o: [0.4274, 0.2616], "93o": [0.3978, 0.2409], "83o": [0.3768, 0.2231], "73o": [0.3644, 0.2239], "63o": [0.3625, 0.2287], "53o": [0.3641, 0.2367], "43o": [0.3521, 0.225], "32s": [0.3575, 0.2347], A2o: [0.5455, 0.3549], K2o: [0.504, 0.3131], Q2o: [0.4713, 0.2868], J2o: [0.4482, 0.2691], T2o: [0.4167, 0.2469], "92o": [0.3906, 0.2322], "82o": [0.3688, 0.2143], "72o": [0.3438, 0.2005], "62o": [0.3387, 0.2077], "52o": [0.3431, 0.216], "42o": [0.3312, 0.2044], "32o": [0.3245, 0.1933] };

  // src/engine/preflop-vs-top.json
  var preflop_vs_top_default = { widths: [0.03, 0.06, 0.1, 0.15, 0.22, 0.3, 0.45, 0.65, 1], equity: { "22": [0.215, 0.329, 0.391, 0.42, 0.435, 0.459, 0.47, 0.476, 0.498], "33": [0.216, 0.335, 0.394, 0.431, 0.445, 0.468, 0.488, 0.51, 0.541], "44": [0.222, 0.334, 0.403, 0.432, 0.453, 0.473, 0.503, 0.525, 0.577], "55": [0.225, 0.343, 0.409, 0.436, 0.47, 0.5, 0.533, 0.553, 0.605], "66": [0.222, 0.344, 0.407, 0.45, 0.485, 0.521, 0.55, 0.57, 0.637], "77": [0.227, 0.351, 0.415, 0.472, 0.5, 0.541, 0.569, 0.599, 0.663], "88": [0.221, 0.359, 0.453, 0.495, 0.526, 0.565, 0.595, 0.637, 0.69], "99": [0.234, 0.413, 0.488, 0.531, 0.557, 0.596, 0.63, 0.667, 0.724], AA: [0.805, 0.829, 0.844, 0.85, 0.845, 0.853, 0.854, 0.848, 0.85], AKs: [0.419, 0.507, 0.589, 0.631, 0.646, 0.661, 0.671, 0.669, 0.67], AQs: [0.39, 0.443, 0.52, 0.58, 0.609, 0.623, 0.644, 0.657, 0.659], AJs: [0.357, 0.414, 0.456, 0.533, 0.577, 0.602, 0.627, 0.642, 0.656], ATs: [0.332, 0.375, 0.421, 0.493, 0.545, 0.581, 0.608, 0.623, 0.649], A9s: [0.298, 0.352, 0.391, 0.449, 0.498, 0.543, 0.586, 0.602, 0.626], A8s: [0.307, 0.33, 0.389, 0.425, 0.478, 0.524, 0.565, 0.594, 0.619], A7s: [0.301, 0.335, 0.379, 0.414, 0.458, 0.495, 0.544, 0.578, 0.611], A6s: [0.3, 0.339, 0.376, 0.402, 0.451, 0.479, 0.527, 0.56, 0.598], A5s: [0.316, 0.351, 0.389, 0.406, 0.455, 0.479, 0.525, 0.557, 0.595], A4s: [0.316, 0.345, 0.381, 0.409, 0.442, 0.476, 0.518, 0.553, 0.59], A3s: [0.31, 0.339, 0.379, 0.401, 0.446, 0.466, 0.513, 0.547, 0.578], A2s: [0.305, 0.343, 0.374, 0.4, 0.445, 0.467, 0.506, 0.533, 0.574], AKo: [0.391, 0.491, 0.566, 0.605, 0.628, 0.644, 0.651, 0.651, 0.652], KK: [0.681, 0.703, 0.729, 0.737, 0.76, 0.765, 0.783, 0.81, 0.828], KQs: [0.356, 0.388, 0.417, 0.457, 0.506, 0.525, 0.572, 0.607, 0.633], KJs: [0.332, 0.352, 0.375, 0.416, 0.474, 0.505, 0.547, 0.591, 0.626], KTs: [0.304, 0.335, 0.37, 0.394, 0.441, 0.485, 0.53, 0.581, 0.626], K9s: [0.271, 0.307, 0.348, 0.372, 0.413, 0.447, 0.507, 0.557, 0.603], K8s: [0.269, 0.297, 0.337, 0.354, 0.397, 0.419, 0.481, 0.537, 0.583], K7s: [0.274, 0.302, 0.336, 0.359, 0.396, 0.415, 0.471, 0.523, 0.57], K6s: [0.269, 0.3, 0.332, 0.352, 0.392, 0.405, 0.457, 0.51, 0.565], K5s: [0.271, 0.301, 0.334, 0.349, 0.383, 0.402, 0.442, 0.499, 0.557], K4s: [0.268, 0.292, 0.324, 0.345, 0.377, 0.395, 0.449, 0.493, 0.545], K3s: [0.266, 0.291, 0.328, 0.345, 0.376, 0.393, 0.423, 0.483, 0.544], K2s: [0.264, 0.282, 0.312, 0.339, 0.37, 0.391, 0.426, 0.48, 0.537], AQo: [0.346, 0.411, 0.498, 0.56, 0.593, 0.605, 0.629, 0.638, 0.644], KQo: [0.316, 0.348, 0.384, 0.427, 0.473, 0.498, 0.541, 0.585, 0.616], QQ: [0.56, 0.611, 0.651, 0.682, 0.701, 0.709, 0.739, 0.765, 0.794], QJs: [0.321, 0.351, 0.354, 0.394, 0.428, 0.453, 0.499, 0.551, 0.606], QTs: [0.306, 0.344, 0.355, 0.384, 0.399, 0.436, 0.49, 0.539, 0.598], Q9s: [0.264, 0.327, 0.334, 0.368, 0.386, 0.414, 0.467, 0.513, 0.567], Q8s: [0.259, 0.309, 0.326, 0.357, 0.359, 0.39, 0.436, 0.499, 0.558], Q7s: [0.252, 0.295, 0.311, 0.343, 0.353, 0.386, 0.418, 0.476, 0.545], Q6s: [0.255, 0.307, 0.32, 0.34, 0.359, 0.375, 0.414, 0.468, 0.534], Q5s: [0.256, 0.296, 0.31, 0.335, 0.359, 0.375, 0.406, 0.451, 0.534], Q4s: [0.25, 0.291, 0.306, 0.341, 0.349, 0.365, 0.403, 0.447, 0.519], Q3s: [0.248, 0.295, 0.303, 0.334, 0.345, 0.37, 0.394, 0.435, 0.514], Q2s: [0.247, 0.286, 0.301, 0.328, 0.351, 0.366, 0.388, 0.432, 0.501], AJo: [0.32, 0.374, 0.434, 0.513, 0.555, 0.582, 0.604, 0.621, 0.632], KJo: [0.295, 0.315, 0.346, 0.381, 0.443, 0.47, 0.529, 0.577, 0.608], QJo: [0.285, 0.317, 0.322, 0.361, 0.404, 0.421, 0.473, 0.535, 0.58], JJ: [0.451, 0.546, 0.582, 0.626, 0.652, 0.68, 0.694, 0.733, 0.773], JTs: [0.285, 0.336, 0.366, 0.376, 0.396, 0.417, 0.461, 0.515, 0.575], J9s: [0.252, 0.317, 0.342, 0.356, 0.383, 0.396, 0.436, 0.487, 0.557], J8s: [0.245, 0.299, 0.327, 0.35, 0.363, 0.38, 0.41, 0.469, 0.533], J7s: [0.239, 0.296, 0.316, 0.337, 0.357, 0.368, 0.396, 0.445, 0.526], J6s: [0.228, 0.285, 0.308, 0.329, 0.349, 0.356, 0.387, 0.429, 0.508], J5s: [0.232, 0.288, 0.306, 0.326, 0.343, 0.355, 0.379, 0.418, 0.496], J4s: [0.226, 0.28, 0.305, 0.324, 0.339, 0.353, 0.374, 0.415, 0.489], J3s: [0.223, 0.275, 0.304, 0.32, 0.331, 0.349, 0.365, 0.405, 0.486], J2s: [0.221, 0.272, 0.299, 0.316, 0.326, 0.352, 0.364, 0.405, 0.473], ATo: [0.295, 0.337, 0.389, 0.471, 0.521, 0.56, 0.588, 0.605, 0.625], KTo: [0.273, 0.292, 0.331, 0.36, 0.422, 0.445, 0.518, 0.558, 0.599], QTo: [0.264, 0.305, 0.322, 0.352, 0.37, 0.409, 0.453, 0.519, 0.576], JTo: [0.246, 0.303, 0.323, 0.352, 0.364, 0.385, 0.433, 0.483, 0.555], TT: [0.35, 0.479, 0.532, 0.582, 0.604, 0.639, 0.667, 0.698, 0.757], T9s: [0.235, 0.32, 0.352, 0.364, 0.376, 0.398, 0.418, 0.466, 0.54], T8s: [0.237, 0.301, 0.343, 0.355, 0.359, 0.382, 0.409, 0.446, 0.521], T7s: [0.23, 0.291, 0.324, 0.35, 0.355, 0.372, 0.392, 0.428, 0.508], T6s: [0.226, 0.281, 0.316, 0.33, 0.341, 0.364, 0.38, 0.408, 0.487], T5s: [0.209, 0.275, 0.305, 0.322, 0.323, 0.338, 0.365, 0.392, 0.47], T4s: [0.21, 0.276, 0.302, 0.319, 0.327, 0.342, 0.357, 0.389, 0.462], T3s: [0.206, 0.268, 0.302, 0.316, 0.326, 0.343, 0.357, 0.38, 0.456], T2s: [0.196, 0.268, 0.292, 0.314, 0.318, 0.339, 0.355, 0.378, 0.449], A9o: [0.258, 0.307, 0.354, 0.414, 0.474, 0.514, 0.561, 0.579, 0.61], K9o: [0.231, 0.276, 0.307, 0.328, 0.377, 0.415, 0.491, 0.531, 0.577], Q9o: [0.225, 0.29, 0.296, 0.329, 0.349, 0.372, 0.431, 0.492, 0.552], J9o: [0.216, 0.29, 0.307, 0.323, 0.344, 0.362, 0.406, 0.458, 0.529], T9o: [0.198, 0.283, 0.322, 0.333, 0.346, 0.368, 0.393, 0.438, 0.517], "98s": [0.221, 0.301, 0.342, 0.367, 0.368, 0.386, 0.403, 0.438, 0.509], "97s": [0.219, 0.3, 0.334, 0.349, 0.359, 0.388, 0.397, 0.418, 0.489], "96s": [0.204, 0.287, 0.323, 0.338, 0.352, 0.371, 0.38, 0.4, 0.473], "95s": [0.199, 0.28, 0.31, 0.321, 0.342, 0.352, 0.367, 0.386, 0.457], "94s": [0.185, 0.258, 0.298, 0.313, 0.321, 0.335, 0.349, 0.368, 0.433], "93s": [0.179, 0.266, 0.299, 0.31, 0.324, 0.334, 0.347, 0.373, 0.433], "92s": [0.174, 0.259, 0.296, 0.307, 0.32, 0.334, 0.345, 0.369, 0.426], A8o: [0.265, 0.3, 0.349, 0.39, 0.446, 0.501, 0.534, 0.565, 0.596], K8o: [0.228, 0.258, 0.298, 0.324, 0.359, 0.382, 0.459, 0.51, 0.561], Q8o: [0.217, 0.267, 0.289, 0.319, 0.324, 0.356, 0.403, 0.467, 0.535], J8o: [0.208, 0.267, 0.297, 0.316, 0.328, 0.347, 0.377, 0.436, 0.51], T8o: [0.2, 0.266, 0.304, 0.327, 0.33, 0.341, 0.367, 0.417, 0.503], "98o": [0.184, 0.269, 0.312, 0.328, 0.339, 0.355, 0.371, 0.406, 0.479], "87s": [0.23, 0.296, 0.335, 0.362, 0.368, 0.383, 0.396, 0.416, 0.481], "86s": [0.223, 0.291, 0.325, 0.348, 0.362, 0.371, 0.382, 0.398, 0.46], "85s": [0.21, 0.28, 0.321, 0.339, 0.352, 0.358, 0.37, 0.388, 0.446], "84s": [0.194, 0.265, 0.306, 0.32, 0.327, 0.338, 0.355, 0.369, 0.43], "83s": [0.18, 0.245, 0.292, 0.311, 0.318, 0.324, 0.339, 0.356, 0.411], "82s": [0.181, 0.251, 0.292, 0.312, 0.324, 0.333, 0.34, 0.354, 0.4], A7o: [0.267, 0.302, 0.34, 0.379, 0.429, 0.474, 0.522, 0.549, 0.59], K7o: [0.229, 0.261, 0.295, 0.318, 0.362, 0.374, 0.436, 0.493, 0.55], Q7o: [0.215, 0.259, 0.273, 0.31, 0.32, 0.343, 0.371, 0.449, 0.521], J7o: [0.2, 0.256, 0.273, 0.304, 0.322, 0.333, 0.361, 0.417, 0.499], T7o: [0.191, 0.256, 0.29, 0.305, 0.323, 0.339, 0.359, 0.399, 0.476], "97o": [0.177, 0.261, 0.293, 0.316, 0.331, 0.344, 0.357, 0.382, 0.469], "87o": [0.188, 0.254, 0.304, 0.327, 0.336, 0.355, 0.363, 0.381, 0.454], "76s": [0.234, 0.299, 0.33, 0.352, 0.368, 0.382, 0.394, 0.403, 0.443], "75s": [0.226, 0.287, 0.328, 0.343, 0.359, 0.365, 0.372, 0.391, 0.434], "74s": [0.208, 0.274, 0.305, 0.333, 0.342, 0.35, 0.362, 0.374, 0.419], "73s": [0.197, 0.26, 0.298, 0.32, 0.327, 0.339, 0.347, 0.356, 0.396], "72s": [0.175, 0.246, 0.283, 0.301, 0.313, 0.329, 0.331, 0.342, 0.384], A6o: [0.258, 0.301, 0.338, 0.365, 0.416, 0.457, 0.503, 0.541, 0.581], K6o: [0.238, 0.256, 0.295, 0.314, 0.355, 0.369, 0.428, 0.489, 0.549], Q6o: [0.217, 0.259, 0.276, 0.301, 0.318, 0.338, 0.376, 0.434, 0.509], J6o: [0.188, 0.247, 0.27, 0.28, 0.305, 0.32, 0.35, 0.392, 0.481], T6o: [0.187, 0.249, 0.283, 0.295, 0.307, 0.322, 0.347, 0.377, 0.46], "96o": [0.168, 0.254, 0.286, 0.299, 0.313, 0.326, 0.34, 0.361, 0.442], "86o": [0.184, 0.25, 0.291, 0.311, 0.334, 0.339, 0.348, 0.363, 0.43], "76o": [0.2, 0.26, 0.299, 0.32, 0.329, 0.349, 0.358, 0.359, 0.418], "65s": [0.239, 0.3, 0.33, 0.35, 0.366, 0.371, 0.381, 0.387, 0.433], "64s": [0.221, 0.283, 0.32, 0.338, 0.349, 0.358, 0.373, 0.38, 0.411], "63s": [0.204, 0.275, 0.306, 0.327, 0.335, 0.35, 0.358, 0.362, 0.395], "62s": [0.188, 0.257, 0.299, 0.313, 0.332, 0.334, 0.344, 0.351, 0.378], A5o: [0.278, 0.307, 0.346, 0.374, 0.425, 0.448, 0.5, 0.539, 0.579], K5o: [0.231, 0.265, 0.294, 0.307, 0.349, 0.363, 0.414, 0.473, 0.534], Q5o: [0.216, 0.265, 0.277, 0.302, 0.317, 0.337, 0.374, 0.426, 0.502], J5o: [0.193, 0.249, 0.267, 0.294, 0.307, 0.318, 0.345, 0.39, 0.469], T5o: [0.17, 0.236, 0.269, 0.288, 0.291, 0.304, 0.326, 0.361, 0.444], "95o": [0.156, 0.24, 0.271, 0.287, 0.301, 0.319, 0.331, 0.353, 0.426], "85o": [0.171, 0.242, 0.29, 0.301, 0.312, 0.322, 0.331, 0.352, 0.414], "75o": [0.188, 0.252, 0.288, 0.31, 0.32, 0.34, 0.346, 0.35, 0.408], "65o": [0.198, 0.264, 0.294, 0.314, 0.33, 0.346, 0.349, 0.355, 0.404], "54s": [0.235, 0.3, 0.338, 0.35, 0.363, 0.366, 0.376, 0.385, 0.413], "53s": [0.226, 0.281, 0.314, 0.334, 0.345, 0.355, 0.366, 0.372, 0.399], "52s": [0.202, 0.272, 0.305, 0.324, 0.334, 0.348, 0.347, 0.358, 0.378], A4o: [0.27, 0.31, 0.345, 0.372, 0.417, 0.447, 0.488, 0.525, 0.571], K4o: [0.23, 0.255, 0.29, 0.314, 0.346, 0.353, 0.408, 0.459, 0.524], Q4o: [0.212, 0.257, 0.266, 0.298, 0.315, 0.328, 0.37, 0.417, 0.492], J4o: [0.188, 0.243, 0.267, 0.29, 0.304, 0.307, 0.338, 0.374, 0.456], T4o: [0.164, 0.232, 0.267, 0.287, 0.291, 0.299, 0.323, 0.356, 0.438], "94o": [0.141, 0.222, 0.26, 0.273, 0.287, 0.297, 0.306, 0.334, 0.408], "84o": [0.153, 0.222, 0.27, 0.288, 0.294, 0.302, 0.319, 0.337, 0.4], "74o": [0.17, 0.235, 0.27, 0.294, 0.303, 0.318, 0.329, 0.335, 0.387], "64o": [0.185, 0.25, 0.283, 0.304, 0.313, 0.322, 0.339, 0.345, 0.383], "54o": [0.204, 0.263, 0.295, 0.312, 0.329, 0.338, 0.345, 0.35, 0.386], "43s": [0.218, 0.281, 0.317, 0.334, 0.344, 0.351, 0.359, 0.372, 0.386], "42s": [0.202, 0.272, 0.305, 0.313, 0.322, 0.332, 0.347, 0.352, 0.367], A3o: [0.271, 0.309, 0.338, 0.369, 0.408, 0.439, 0.481, 0.523, 0.56], K3o: [0.23, 0.253, 0.283, 0.312, 0.337, 0.353, 0.399, 0.454, 0.513], Q3o: [0.212, 0.252, 0.269, 0.294, 0.312, 0.33, 0.366, 0.404, 0.483], J3o: [0.184, 0.239, 0.263, 0.291, 0.294, 0.311, 0.339, 0.373, 0.449], T3o: [0.167, 0.234, 0.263, 0.281, 0.287, 0.302, 0.321, 0.351, 0.429], "93o": [0.138, 0.225, 0.264, 0.275, 0.286, 0.302, 0.313, 0.331, 0.401], "83o": [0.143, 0.212, 0.252, 0.267, 0.28, 0.294, 0.308, 0.321, 0.373], "73o": [0.153, 0.221, 0.256, 0.281, 0.294, 0.297, 0.31, 0.323, 0.367], "63o": [0.169, 0.231, 0.271, 0.289, 0.3, 0.316, 0.322, 0.326, 0.362], "53o": [0.186, 0.251, 0.285, 0.301, 0.31, 0.318, 0.334, 0.334, 0.358], "43o": [0.183, 0.249, 0.282, 0.3, 0.305, 0.311, 0.322, 0.333, 0.35], "32s": [0.201, 0.263, 0.3, 0.316, 0.318, 0.335, 0.341, 0.344, 0.359], A2o: [0.261, 0.302, 0.342, 0.363, 0.412, 0.437, 0.479, 0.514, 0.55], K2o: [0.223, 0.245, 0.283, 0.307, 0.345, 0.353, 0.394, 0.454, 0.506], Q2o: [0.204, 0.248, 0.264, 0.294, 0.304, 0.318, 0.36, 0.41, 0.472], J2o: [0.181, 0.236, 0.257, 0.283, 0.292, 0.307, 0.329, 0.367, 0.442], T2o: [0.158, 0.228, 0.26, 0.275, 0.283, 0.299, 0.316, 0.343, 0.416], "92o": [0.134, 0.222, 0.258, 0.27, 0.283, 0.292, 0.303, 0.328, 0.393], "82o": [0.141, 0.21, 0.256, 0.275, 0.278, 0.294, 0.305, 0.318, 0.366], "72o": [0.136, 0.211, 0.244, 0.262, 0.281, 0.289, 0.299, 0.307, 0.346], "62o": [0.154, 0.222, 0.25, 0.268, 0.288, 0.299, 0.302, 0.316, 0.343], "52o": [0.165, 0.237, 0.27, 0.282, 0.294, 0.311, 0.319, 0.32, 0.341], "42o": [0.166, 0.235, 0.265, 0.283, 0.292, 0.299, 0.308, 0.313, 0.335], "32o": [0.158, 0.23, 0.26, 0.28, 0.289, 0.293, 0.307, 0.307, 0.322] } };

  // src/engine/strength.ts
  function comboStrengths(board, dead = [], runouts = 48, seed = 7) {
    const out = new Float64Array(NUM_COMBOS).fill(-1);
    const isDead = new Uint8Array(52);
    for (const c of [...board, ...dead]) isDead[c] = 1;
    const live = [];
    for (let i = 0; i < NUM_COMBOS; i++) {
      const [a, b] = COMBOS[i];
      if (!isDead[a] && !isDead[b]) live.push(i);
    }
    for (const i of live) out[i] = 0;
    const need = 5 - board.length;
    const samples = need === 0 ? 1 : runouts;
    const random = rng(seed);
    const stub = [];
    for (let c = 0; c < 52; c++) if (!isDead[c]) stub.push(c);
    const seven = new Int32Array(7);
    const scores = new Float64Array(NUM_COMBOS);
    const blocked = new Int32Array(NUM_COMBOS);
    const order = [];
    for (let s = 0; s < samples; s++) {
      const runout = board.slice();
      const used = new Uint8Array(52);
      while (runout.length < 5) {
        const c = stub[random() * stub.length | 0];
        if (used[c]) continue;
        used[c] = 1;
        runout.push(c);
      }
      for (let k = 0; k < 5; k++) seven[2 + k] = runout[k];
      order.length = 0;
      for (const i of live) {
        const [a, b] = COMBOS[i];
        if (used[a] || used[b]) continue;
        seven[0] = a;
        seven[1] = b;
        scores[i] = evaluate(seven);
        order.push(i);
      }
      order.sort((x, y) => scores[x] - scores[y]);
      const n = order.length;
      for (let lo = 0; lo < n; ) {
        let hi = lo;
        while (hi + 1 < n && scores[order[hi + 1]] === scores[order[lo]]) hi++;
        const pct3 = (lo + hi) / 2 / Math.max(1, n - 1);
        for (let k = lo; k <= hi; k++) out[order[k]] += pct3;
        lo = hi + 1;
      }
      for (const i of live) {
        const [a, b] = COMBOS[i];
        if (used[a] || used[b]) blocked[i]++;
      }
    }
    for (const i of live) {
      const valid = samples - blocked[i];
      out[i] = valid > 0 ? out[i] / valid : 0.5;
    }
    return out;
  }
  var preflopCache;
  var PREFLOP_EQUITY = preflop_equity_default;
  function preflopScores() {
    if (preflopCache) return preflopCache;
    const raw = /* @__PURE__ */ new Map();
    for (const cls of ALL_CLASSES) {
      const [e1, e2] = PREFLOP_EQUITY[cls];
      let score2 = (e1 + 1.5 * e2) / 2.5;
      if (cls.endsWith("s")) score2 += 0.01;
      if (cls.length === 3) {
        const gap = RANK_ORDER.indexOf(cls[0]) - RANK_ORDER.indexOf(cls[1]);
        score2 += gap === 1 ? 0.012 : gap === 2 ? 6e-3 : 0;
      }
      raw.set(cls, score2);
    }
    const sorted = [...raw.entries()].sort((x, y) => y[1] - x[1]);
    let cum = 0;
    preflopCache = /* @__PURE__ */ new Map();
    for (const [cls] of sorted) {
      const n = CLASS_INDEX.get(cls).length;
      preflopCache.set(cls, 1 - (cum + n / 2) / NUM_COMBOS);
      cum += n;
    }
    return preflopCache;
  }
  var RANK_ORDER = "23456789TJQKA";
  function preflopComboStrengths() {
    const s = preflopScores();
    return Float64Array.from(CLASS_OF_COMBO, (c) => s.get(c));
  }
  var VS_TOP = preflop_vs_top_default;
  var vsTopCache = /* @__PURE__ */ new Map();
  function preflopEquityVsTop(width) {
    const ws = VS_TOP.widths;
    const w = Math.min(ws[ws.length - 1], Math.max(ws[0], width));
    const key = Math.round(w * 200);
    let out = vsTopCache.get(key);
    if (out) return out;
    let j = 0;
    while (j < ws.length - 2 && ws[j + 1] < w) j++;
    const f = (w - ws[j]) / (ws[j + 1] - ws[j]);
    const byClass = /* @__PURE__ */ new Map();
    for (const cls of ALL_CLASSES) {
      const e = VS_TOP.equity[cls];
      byClass.set(cls, e[j] + f * (e[j + 1] - e[j]));
    }
    out = Float64Array.from(CLASS_OF_COMBO, (c) => byClass.get(c));
    if (vsTopCache.size > 64) vsTopCache.clear();
    vsTopCache.set(key, out);
    return out;
  }
  function equityVsRange(board, range, flopRunouts = 16, seed = 11) {
    const out = new Float64Array(NUM_COMBOS);
    const isDead = new Uint8Array(52);
    for (const c of board) isDead[c] = 1;
    const runouts = [];
    if (board.length === 5) runouts.push([]);
    else if (board.length === 4) {
      const live = [];
      for (let c = 0; c < 52; c++) if (!isDead[c]) live.push(c);
      for (let k = 0; k < live.length; k += 3) runouts.push([live[k]]);
    } else {
      const random = rng(seed);
      const stub = [];
      for (let c = 0; c < 52; c++) if (!isDead[c]) stub.push(c);
      for (let k = 0; k < flopRunouts; k++) {
        const a = stub[random() * stub.length | 0];
        let b = a;
        while (b === a) b = stub[random() * stub.length | 0];
        runouts.push([a, b]);
      }
    }
    const seven = new Int32Array(7);
    const scores = new Float64Array(NUM_COMBOS);
    const counted = new Float64Array(NUM_COMBOS);
    for (const extra of runouts) {
      const full = [...board, ...extra];
      for (let k = 0; k < 5; k++) seven[2 + k] = full[k];
      const used = new Uint8Array(52);
      for (const c of full) used[c] = 1;
      const heroIdx = [];
      for (let i = 0; i < NUM_COMBOS; i++) {
        const [a, b] = COMBOS[i];
        if (used[a] || used[b]) {
          scores[i] = -1;
          continue;
        }
        seven[0] = a;
        seven[1] = b;
        scores[i] = evaluate(seven);
        if (range.w[i] > 0) heroIdx.push(i);
      }
      heroIdx.sort((x, y) => scores[x] - scores[y]);
      const sc = heroIdx.map((i) => scores[i]);
      const cum = [];
      let total = 0;
      for (const i of heroIdx) cum.push(total += range.w[i]);
      if (total <= 0) continue;
      const byCard = Array.from({ length: 52 }, () => []);
      for (const i of heroIdx) {
        const [a, b] = COMBOS[i];
        byCard[a].push(i);
        byCard[b].push(i);
      }
      const below = (v, strict) => {
        let lo = 0;
        let hi = sc.length;
        while (lo < hi) {
          const mid = lo + hi >> 1;
          if (strict ? sc[mid] < v : sc[mid] <= v) lo = mid + 1;
          else hi = mid;
        }
        return lo === 0 ? 0 : cum[lo - 1];
      };
      for (let i = 0; i < NUM_COMBOS; i++) {
        const v = scores[i];
        if (v < 0) continue;
        let lt = below(v, true);
        let le = below(v, false);
        let tot = total;
        const [a, b] = COMBOS[i];
        for (const card of [a, b])
          for (const j of byCard[card]) {
            if (card === b && (COMBOS[j][0] === a || COMBOS[j][1] === a)) continue;
            const w = range.w[j];
            tot -= w;
            if (scores[j] < v) lt -= w;
            if (scores[j] <= v) le -= w;
          }
        if (tot <= 1e-9) continue;
        out[i] += (lt + (le - lt) / 2) / tot;
        counted[i]++;
      }
    }
    for (let i = 0; i < NUM_COMBOS; i++) out[i] = counted[i] > 0 ? out[i] / counted[i] : 0;
    return out;
  }

  // src/engine/texture.ts
  var SUIT_NAMES = ["clubs", "diamonds", "hearts", "spades"];
  var SUIT_SYMBOL = ["\u2663", "\u2666", "\u2665", "\u2660"];
  var pretty = (c) => `${RANKS[rankOf(c)] === "T" ? "10" : RANKS[rankOf(c)]}${SUIT_SYMBOL[suitOf(c)]}`;
  function features(board) {
    const counts2 = new Array(13).fill(0);
    const suits = new Array(4).fill(0);
    let mask = 0;
    for (const c of board) {
      counts2[rankOf(c)]++;
      suits[suitOf(c)]++;
      mask |= 1 << rankOf(c);
    }
    let straightPossible = false;
    const low = (mask & 1 << 12 ? 1 : 0) | (mask & 8191) << 1;
    for (let start = 0; start <= 9; start++) {
      let n = 0;
      for (let k = 0; k < 5; k++) if (low & 1 << start + k) n++;
      if (n >= 3) straightPossible = true;
    }
    const maxSuit = Math.max(...suits);
    return {
      paired: counts2.some((n) => n >= 2),
      trips: counts2.some((n) => n >= 3),
      maxSuit,
      flushSuit: suits.indexOf(maxSuit),
      straightPossible
    };
  }
  function boardNotes(board) {
    if (board.length < 3) return [];
    const f = features(board);
    const notes = [];
    const prev = board.length > 3 ? features(board.slice(0, -1)) : void 0;
    const last = board[board.length - 1];
    if (prev) {
      if (f.maxSuit >= 3 && prev.maxSuit < 3) notes.push(`The ${pretty(last)} made a flush possible`);
      else if (f.maxSuit === 4 && prev.maxSuit === 3) notes.push(`The ${pretty(last)} put four ${SUIT_NAMES[f.flushSuit]} out: one ${SUIT_SYMBOL[f.flushSuit]} makes a flush`);
      if (f.paired && !prev.paired) notes.push(`The ${pretty(last)} paired the board: full houses are now possible`);
      if (f.straightPossible && !prev.straightPossible) notes.push(`The ${pretty(last)} made a straight possible`);
    }
    if (!notes.length) {
      if (f.maxSuit >= 3) notes.push(`${f.maxSuit} ${SUIT_NAMES[f.flushSuit]} on board: flush possible`);
      if (f.trips) notes.push("Trips on the board: everyone shares them, kickers and full houses decide");
      else if (f.paired) notes.push("Paired board: full houses and trips are possible");
      if (f.straightPossible && f.maxSuit < 3) notes.push("Straight possible");
    }
    return notes;
  }
  function boardCategory(board) {
    if (board.length === 5) return categoryOf(evaluate(board));
    const counts2 = new Array(13).fill(0);
    for (const c of board) counts2[rankOf(c)]++;
    const pairs = counts2.filter((n) => n === 2).length;
    if (counts2.some((n) => n === 4)) return 7 /* Quads */;
    if (counts2.some((n) => n === 3)) return 3 /* Trips */;
    if (pairs >= 2) return 2 /* TwoPair */;
    if (pairs === 1) return 1 /* Pair */;
    return 0 /* HighCard */;
  }
  function playingTheBoard(hero, board) {
    if (board.length < 3) return void 0;
    const heroScore = evaluate([...hero, ...board]);
    const cat = categoryOf(heroScore);
    if (board.length === 5 && heroScore === evaluate(board)) return "You're playing the board: your cards don't improve it, so everyone left at least ties";
    const bcat = boardCategory(board);
    if (cat === bcat && (cat === 1 /* Pair */ || cat === 2 /* TwoPair */ || cat === 3 /* Trips */)) {
      const kicker = Math.max(rankOf(hero[0]), rankOf(hero[1]));
      const shared = cat === 1 /* Pair */ ? "pair" : cat === 2 /* TwoPair */ ? "two pair" : "trips";
      return `The ${shared} is on the board, so everyone has it: your real hand is just ${RANKS[kicker] === "T" ? "10" : RANKS[kicker]}-high kicker`;
    }
    return void 0;
  }
  function rangeComposition(range, board, dead = []) {
    if (board.length < 3) return [];
    const isDead = new Uint8Array(52);
    for (const c of [...board, ...dead]) isDead[c] = 1;
    const seven = Int32Array.from([0, 0, ...board]);
    const totals = /* @__PURE__ */ new Map();
    let sum = 0;
    const bcat = boardCategory(board);
    for (let i = 0; i < NUM_COMBOS; i++) {
      const w = range.w[i];
      if (w <= 0) continue;
      const [a, b] = COMBOS[i];
      if (isDead[a] || isDead[b]) continue;
      seven[0] = a;
      seven[1] = b;
      const cat = categoryOf(evaluate(seven, 2 + board.length));
      let label;
      if (cat <= bcat && cat <= 1 /* Pair */) {
        label = board.length < 5 && hasDraw([a, b], board) ? "draw" : "no pair";
      } else if (cat === 1 /* Pair */) label = pairKind([a, b], board);
      else if (cat === 3 /* Trips */) label = rankCount([a, b], board) ? "set" : "trips";
      else label = CATEGORY_NAMES[cat];
      totals.set(label, (totals.get(label) ?? 0) + w);
      sum += w;
    }
    if (sum <= 0) return [];
    return [...totals.entries()].map(([k, v]) => [k, v / sum]).sort((x, y) => y[1] - x[1]);
  }
  function pairKind(hole, board) {
    const top = Math.max(...board.map(rankOf));
    const [r1, r2] = hole.map(rankOf);
    if (r1 === r2) return r1 > top ? "overpair" : "weaker pair";
    const paired = board.some((c) => rankOf(c) === r1) ? r1 : r2;
    return paired === top ? "top pair" : "weaker pair";
  }
  function rankCount(hole, board) {
    return rankOf(hole[0]) === rankOf(hole[1]) && board.some((c) => rankOf(c) === rankOf(hole[0]));
  }
  function hasDraw(hole, board) {
    const cards = [...hole, ...board];
    for (let s = 0; s < 4; s++) {
      const n = cards.filter((c) => suitOf(c) === s).length;
      if (n === 4 && hole.some((c) => suitOf(c) === s)) return true;
    }
    const ranks = new Set(cards.map(rankOf));
    if (ranks.has(12)) ranks.add(-1);
    const holeRanks = hole.map(rankOf);
    for (let start = -1; start <= 8; start++) {
      const window2 = [0, 1, 2, 3, 4].map((k) => start + k);
      const have = window2.filter((r) => ranks.has(r)).length;
      const usesHole = window2.some((r) => holeRanks.includes(r) || r === -1 && holeRanks.includes(12));
      if (have === 4 && usesHole) return true;
    }
    return false;
  }

  // src/opponents/model.ts
  var bucketOf = (players) => players <= 2 ? "hu" : players <= 4 ? "3" : "6";
  var PREFLOP_STATS = /* @__PURE__ */ new Set(["vpip", "pfr", "limp", "steal", "foldToSteal", "threeBet", "foldTo3Bet", "callOpen"]);
  var PREFLOP_PRIORS = {
    hu: { vpip: 0.75, pfr: 0.5, limp: 0.1, steal: 0.8, foldToSteal: 0.33, threeBet: 0.15, foldTo3Bet: 0.4, callOpen: 0.5 },
    "3": { vpip: 0.47, pfr: 0.36, limp: 0.08, steal: 0.55, foldToSteal: 0.45, threeBet: 0.13, foldTo3Bet: 0.45, callOpen: 0.3 },
    "6": { vpip: 0.25, pfr: 0.2, limp: 0.05, steal: 0.4, foldToSteal: 0.6, threeBet: 0.08, foldTo3Bet: 0.5, callOpen: 0.2 }
  };
  var PRIORS = {
    vpip: [0.47, 25],
    pfr: [0.36, 25],
    limp: [0.08, 25],
    steal: [0.55, 25],
    foldToSteal: [0.45, 30],
    threeBet: [0.13, 40],
    foldTo3Bet: [0.45, 30],
    callOpen: [0.3, 30],
    cbet: [0.55, 30],
    foldToCbet: [0.4, 30],
    foldToBetFlop: [0.4, 35],
    foldToBetTurn: [0.4, 35],
    foldToBetRiver: [0.4, 35],
    raiseVsBet: [0.1, 40],
    betWhenCheckedTo: [0.4, 30],
    // Betting out into the previous street's aggressor ("donk"/lead): rare.
    lead: [0.1, 30],
    wtsd: [0.3, 40],
    wonAtShowdown: [0.5, 40],
    bluffShare: [0.3, 25],
    // Per bet size (small < 0.6 pot ≤ big). Theory says bigger bets carry more
    // bluffs, coaching experience says recreational players' big bets carry
    // fewer; with no consensus, size starts neutral and is learned per player.
    bluffShareSmall: [0.3, 25],
    bluffShareBig: [0.3, 25]
  };
  function prior(stat, bucket) {
    const [mean, k] = PRIORS[stat];
    return [PREFLOP_PRIORS[bucket][stat] ?? mean, k];
  }
  var countKey = (stat, bucket) => PREFLOP_STATS.has(stat) ? `${stat}@${bucket}` : stat;
  var POSTFLOP = ["flop", "turn", "river"];
  var norm = (n) => n.trim().toLowerCase();
  var OpponentModel = class _OpponentModel {
    players = /* @__PURE__ */ new Map();
    /** Merged accounts: alias key → the profile it now feeds. */
    aliases = /* @__PURE__ */ new Map();
    static fromJSON(data) {
      const m = new _OpponentModel();
      const d = data;
      const players = Array.isArray(d) ? d : d?.players ?? [];
      for (const p of players) {
        if (!p?.key) continue;
        for (const k of Object.keys(p.counts ?? {}))
          if (PREFLOP_STATS.has(k)) {
            p.counts[`${k}@3`] = p.counts[k];
            delete p.counts[k];
          }
        m.players.set(p.key, p);
      }
      if (!Array.isArray(d)) for (const [a, b] of Object.entries(d?.aliases ?? {})) m.aliases.set(a, b);
      return m;
    }
    toJSON() {
      return { players: [...this.players.values()], aliases: Object.fromEntries(this.aliases) };
    }
    /**
     * The profile key a player's hands are recorded under. Follows merges, and
     * (because guests get a fresh account whenever they like) links an unknown
     * account to an existing profile that has played under the same name.
     */
    resolve(key, name) {
      let k = key;
      for (let i = 0; i < 10 && this.aliases.has(k); i++) k = this.aliases.get(k);
      if (this.players.has(k) || !name) return k;
      const owner = this.findByName(name);
      if (owner && owner !== k) {
        this.aliases.set(k, owner);
        return owner;
      }
      return k;
    }
    /** Profile that uses this name (person name, current name or a known alias), case-insensitive. */
    findByName(name) {
      const n = norm(name);
      if (!n) return void 0;
      for (const p of this.players.values())
        if (p.me) continue;
        else if (norm(p.label ?? "") === n || norm(p.name) === n || p.aliasNames?.some((a) => norm(a) === n)) return p.key;
      return void 0;
    }
    /** Display name: your label for the person if set, else their latest in-game name. */
    displayName(key) {
      const p = this.players.get(this.resolve(key));
      return p?.label || p?.name || key;
    }
    /** Name a person (e.g. "Isaiah"). Also merges any other profile already using that name. */
    setLabel(key, label) {
      const k = this.resolve(key);
      const p = this.players.get(k);
      if (!p) return;
      const clean = label.trim();
      p.label = clean || void 0;
      if (clean) this.addName(k, clean);
    }
    /** Tie another in-game name to this person: past profiles with it merge in, future accounts with it join automatically. */
    addName(key, name) {
      const k = this.resolve(key);
      const p = this.players.get(k);
      const clean = name.trim();
      if (!p || !clean) return;
      for (const other of [...this.players.values()])
        if (other.key !== k && (norm(other.name) === norm(clean) || norm(other.label ?? "") === norm(clean) || other.aliasNames?.some((a) => norm(a) === norm(clean))))
          this.merge(other.key, k);
      if (norm(p.name) !== norm(clean) && !p.aliasNames?.some((a) => norm(a) === norm(clean))) p.aliasNames = [...p.aliasNames ?? [], clean];
    }
    /** Stop treating a name as this person (e.g. two mates both used "Test" once). Past stats stay. */
    removeName(key, name) {
      const p = this.players.get(this.resolve(key));
      if (!p) return;
      p.aliasNames = p.aliasNames?.filter((a) => norm(a) !== norm(name));
      if (norm(p.name) === norm(name)) p.name = p.label || p.aliasNames?.[0] || p.name;
    }
    /**
     * Merge `fromKey`'s history into `intoKey` (same mate, different account or
     * device). Future hands from either account go to `intoKey`.
     */
    merge(fromKey, intoKey) {
      const from = this.resolve(fromKey);
      const into = this.resolve(intoKey);
      if (from === into) return;
      const a = this.players.get(from);
      const b = this.stats(into, this.players.get(into)?.name ?? into);
      if (a) {
        b.hands += a.hands;
        for (const [stat, [hits, opps]] of Object.entries(a.counts)) {
          const c = b.counts[stat] ??= [0, 0];
          c[0] += hits;
          c[1] += opps;
        }
        b.aliasNames = [.../* @__PURE__ */ new Set([...b.aliasNames ?? [], a.name, ...a.aliasNames ?? []])].filter((n) => n !== b.name);
        this.players.delete(from);
      }
      this.aliases.set(from, into);
    }
    // ---------- people management ----------
    /** Create an (empty) person you can assign names to. Returns their key, or the existing one. */
    createPerson(label) {
      const clean = label.trim();
      const existing = this.findByName(clean);
      if (existing) {
        const p = this.players.get(existing);
        if (!p.label) p.label = clean;
        return existing;
      }
      let key = `person:${norm(clean).replace(/\s+/g, "-")}`;
      while (this.players.has(key)) key += "_";
      this.players.set(key, { key, name: clean, label: clean, hands: 0, counts: {} });
      return key;
    }
    /** People you've named, alphabetically. */
    people() {
      return [...this.players.values()].filter((p) => p.label && !p.me).sort((a, b) => a.label.localeCompare(b.label));
    }
    /** Opponent names not yet assigned to a person, most-played first. */
    unassigned() {
      return [...this.players.values()].filter((p) => !p.label && !p.me).sort((a, b) => b.hands - a.hands);
    }
    /** Every in-game name a profile has played under. */
    namesOf(key) {
      const p = this.players.get(this.resolve(key));
      if (!p) return [];
      return [.../* @__PURE__ */ new Set([...p.label && norm(p.name) === norm(p.label) ? [] : [p.name], ...p.aliasNames ?? []])].filter(
        (n) => n && norm(n) !== norm(p.label ?? "")
      );
    }
    /** Delete a person or name and everything learned about them. */
    forget(key) {
      const k = this.resolve(key);
      this.players.delete(k);
      for (const [a, b] of [...this.aliases]) if (b === k || a === k) this.aliases.delete(a);
    }
    /** Mark a profile as yours so it never shows up as an opponent. */
    markMe(key, name) {
      const k = this.resolve(key, name);
      const p = this.players.get(k) ?? this.stats(k, name ?? k);
      p.me = true;
    }
    stats(key, name) {
      let s = this.players.get(key);
      if (!s) {
        s = { key, name, hands: 0, counts: {} };
        this.players.set(key, s);
      }
      if (s.name !== name) {
        s.aliasNames = [.../* @__PURE__ */ new Set([...s.aliasNames ?? [], s.name])].filter((n) => n !== name);
        s.name = name;
      }
      return s;
    }
    bucket = "3";
    bump(s, stat, hit) {
      const c = s.counts[countKey(stat, this.bucket)] ??= [0, 0];
      c[1]++;
      if (hit) c[0]++;
    }
    /** Smoothed tendencies; `tablePlayers` = how many were dealt in (preflop stats depend on it). */
    profile(key, name = key, tablePlayers = 3) {
      key = this.resolve(key, name);
      const bucket = bucketOf(tablePlayers);
      const s = this.players.get(key) ?? { key, name, hands: 0, counts: {} };
      const stat = (n) => {
        const [mean, k] = prior(n, bucket);
        const [hits, opps] = s.counts[countKey(n, bucket)] ?? [0, 0];
        return (hits + mean * k) / (opps + k);
      };
      const foldToBet = (street) => street === "turn" ? stat("foldToBetTurn") : street === "river" ? stat("foldToBetRiver") : stat("foldToBetFlop");
      const vpip = stat("vpip");
      const pfr = stat("pfr");
      const fold = (stat("foldToBetFlop") + stat("foldToBetTurn") + stat("foldToBetRiver")) / 3;
      let style = "unknown (few hands)";
      if (s.hands >= 40) {
        const [nv] = prior("vpip", bucket);
        const loose = vpip - nv;
        const aggr = pfr / Math.max(0.01, vpip);
        if (loose > 0.1 && aggr > 0.65) style = "maniac";
        else if (loose > 0.12 && fold < 0.3) style = "calling station";
        else if (loose < -0.12) style = aggr > 0.6 ? "tight-aggressive" : "nit";
        else if (loose > 0.08) style = aggr > 0.55 ? "loose-aggressive" : "loose-passive";
        else style = aggr < 0.45 ? "passive" : "solid";
      }
      return {
        key,
        name: s.label || s.name || name,
        hands: s.hands,
        stat,
        raw: (n) => s.counts[countKey(n, bucket)] ?? [0, 0],
        foldToBet,
        bluffFor: (ratio) => {
          const big = ratio >= 0.6;
          const overall = stat("bluffShare");
          const mean = overall;
          const [hits, opps] = s.counts[big ? "bluffShareBig" : "bluffShareSmall"] ?? [0, 0];
          const k = PRIORS.bluffShareBig[1];
          return (hits + mean * k) / (opps + k);
        },
        style
      };
    }
    resolveHistory(h) {
      const names = new Map(h.players.map((p) => [p.key, p.name]));
      const r = (k) => this.resolve(k, names.get(k));
      const remap = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [r(k), v]));
      return {
        ...h,
        heroKey: h.heroKey && r(h.heroKey),
        players: h.players.map((p) => ({ ...p, key: r(p.key) })),
        actions: h.actions.map((a) => ({ ...a, key: r(a.key) })),
        result: h.result && {
          ...h.result,
          won: remap(h.result.won),
          refunded: remap(h.result.refunded),
          shown: remap(h.result.shown),
          descriptions: remap(h.result.descriptions)
        }
      };
    }
    /** Learn from one finished hand. */
    update(hand) {
      const h = this.resolveHistory(hand);
      this.bucket = bucketOf(h.players.length);
      const pos = new Map(h.players.map((p) => [p.key, p.position]));
      const stats = new Map(h.players.map((p) => [p.key, this.stats(p.key, p.name)]));
      for (const s of stats.values()) s.hands++;
      const pre = h.actions.filter((a) => a.street === "preflop" && a.type !== "post");
      let raises = 0;
      let opener;
      let lastRaiser;
      const acted = /* @__PURE__ */ new Set();
      const vpip = /* @__PURE__ */ new Set();
      const pfr = /* @__PURE__ */ new Set();
      for (const a of pre) {
        const s = stats.get(a.key);
        if (!s) continue;
        const first = !acted.has(a.key);
        acted.add(a.key);
        const aggressive = a.type === "raise" || a.type === "bet";
        if (a.type === "call" || aggressive) vpip.add(a.key);
        if (aggressive) pfr.add(a.key);
        if (raises === 0 && first) {
          const limpOpp = pos.get(a.key) !== "BB";
          if (limpOpp) this.bump(s, "limp", a.type === "call");
          const p = pos.get(a.key);
          if ((p === "BTN" || p === "SB") && pre.slice(0, pre.indexOf(a)).every((x) => x.type === "fold"))
            this.bump(s, "steal", aggressive);
        } else if (raises === 1 && a.key !== opener) {
          this.bump(s, "threeBet", aggressive);
          if (!aggressive) this.bump(s, "callOpen", a.type === "call");
          const op = opener ? pos.get(opener) : void 0;
          const me = pos.get(a.key);
          if ((op === "BTN" || op === "SB") && (me === "SB" || me === "BB") && first) this.bump(s, "foldToSteal", a.type === "fold");
        } else if (raises === 2 && a.key === opener) {
          this.bump(s, "foldTo3Bet", a.type === "fold");
        }
        if (aggressive) {
          raises++;
          if (raises === 1) opener = a.key;
          lastRaiser = a.key;
        }
      }
      for (const [key, s] of stats) {
        if (!acted.has(key)) continue;
        this.bump(s, "vpip", vpip.has(key));
        this.bump(s, "pfr", pfr.has(key));
      }
      const foldedPre = new Set(pre.filter((a) => a.type === "fold").map((a) => a.key));
      const sawFlop = h.board.length >= 3 ? [...stats.keys()].filter((k) => !foldedPre.has(k) && h.actions.some((a) => a.key === k)) : [];
      for (const street of POSTFLOP) {
        const acts = h.actions.filter((a) => a.street === street);
        let betSeen = false;
        let cbetMade = false;
        for (const a of acts) {
          const s = stats.get(a.key);
          if (!s) continue;
          const aggressive = a.type === "bet" || a.type === "raise";
          if (!betSeen) {
            const spot = betSpot(h.actions, a);
            this.bump(s, spot === "cbet" ? "cbet" : spot === "lead" ? "lead" : "betWhenCheckedTo", aggressive);
            if (aggressive && spot === "cbet") cbetMade = true;
          } else {
            const fs = street === "flop" ? "foldToBetFlop" : street === "turn" ? "foldToBetTurn" : "foldToBetRiver";
            this.bump(s, fs, a.type === "fold");
            this.bump(s, "raiseVsBet", a.type === "raise");
            if (cbetMade && street === "flop") this.bump(s, "foldToCbet", a.type === "fold");
          }
          if (aggressive) betSeen = true;
        }
      }
      const shown = h.result?.shown ?? {};
      const atShowdown = new Set(Object.keys(shown));
      if (h.heroKey && h.heroCards?.length === 2 && Object.keys(shown).length) atShowdown.add(h.heroKey);
      for (const k of sawFlop) {
        const s = stats.get(k);
        const went = atShowdown.has(k);
        this.bump(s, "wtsd", went);
        if (went) this.bump(s, "wonAtShowdown", (h.result?.won[k] ?? 0) > 0);
      }
      for (const [key, cards] of Object.entries(shown)) this.bluffEvidence(h, key, cards);
    }
    /** Learn from cards a player showed after the hand (folded or uncontested). */
    learnShown(hand, key) {
      const h = this.resolveHistory(hand);
      const k = this.resolve(key, hand.players.find((p) => p.key === key)?.name);
      const cards = h.result?.shown[k];
      if (cards) this.bluffEvidence(h, k, cards);
    }
    bluffEvidence(h, key, cards) {
      this.bucket = bucketOf(h.players.length);
      const s = this.players.get(key);
      if (!s || cards.length !== 2) return;
      for (const street of POSTFLOP) {
        const bets = h.actions.filter((a) => a.key === key && a.street === street && (a.type === "bet" || a.type === "raise"));
        if (!bets.length) continue;
        const board = h.board.slice(0, street === "flop" ? 3 : street === "turn" ? 4 : 5);
        if (board.length < 3) continue;
        const strength = handStrength(cards, board);
        for (const b of bets) {
          const bluff = strength < 0.45;
          this.bump(s, "bluffShare", bluff);
          this.bump(s, sizeRatio(b) >= 0.6 ? "bluffShareBig" : "bluffShareSmall", bluff);
        }
      }
    }
  };
  function betSpot(actions, a) {
    const order = ["preflop", "flop", "turn", "river"];
    const idx = order.indexOf(a.street);
    if (idx <= 0) return "checkedTo";
    const prev = order[idx - 1];
    const before = actions.slice(0, actions.indexOf(a));
    const aggressor = [...before].reverse().find((x) => x.street === prev && (x.type === "bet" || x.type === "raise"))?.key;
    if (!aggressor) return "checkedTo";
    if (aggressor === a.key) return a.street === "flop" ? "cbet" : "barrel";
    const aggressorActed = before.some((x) => x.street === a.street && x.key === aggressor);
    const aggressorFolded = before.some((x) => x.key === aggressor && x.type === "fold");
    return aggressorActed || aggressorFolded ? "checkedTo" : "lead";
  }
  function sizeRatio(a) {
    const before = a.toTotal - a.added;
    const callPart = Math.max(0, a.facing - before);
    const raisePart = Math.max(0, a.toTotal - a.facing);
    const potAfterCall = a.potBefore + callPart;
    return raisePart / Math.max(1, potAfterCall);
  }
  var strengthCache = /* @__PURE__ */ new Map();
  function handStrength(cards, board) {
    const k = board.join(",");
    let st = strengthCache.get(k);
    if (!st) {
      st = comboStrengths(board);
      if (strengthCache.size > 64) strengthCache.clear();
      strengthCache.set(k, st);
    }
    return st[comboIndex(cards[0], cards[1])];
  }

  // src/opponents/ranges.ts
  var SOFT = 0.045;
  var sigmoid = (x) => 1 / (1 + Math.exp(-x));
  var soft = (frac) => Math.min(SOFT, Math.max(0.012, 0.25 * frac));
  var inTop = (q, frac) => {
    const f = Math.min(Math.max(frac, 5e-3), 1);
    return sigmoid((q - (1 - f)) / soft(f));
  };
  var inBottom = (q, frac) => {
    const f = Math.min(Math.max(frac, 0), 1);
    return sigmoid((f - q) / soft(f));
  };
  var strengthCache2 = /* @__PURE__ */ new Map();
  function boardStrengths(board) {
    const k = board.join(",");
    let s = strengthCache2.get(k);
    if (!s) {
      s = comboStrengths(board, [], board.length === 5 ? 1 : 40);
      if (strengthCache2.size > 32) strengthCache2.clear();
      strengthCache2.set(k, s);
    }
    return s;
  }
  function rangePercentiles(range, strengths) {
    const idx = [];
    for (let i = 0; i < NUM_COMBOS; i++) if (range.w[i] > 0 && strengths[i] >= 0) idx.push(i);
    idx.sort((a, b) => strengths[a] - strengths[b]);
    const total = idx.reduce((s, i) => s + range.w[i], 0);
    const q = new Float64Array(NUM_COMBOS);
    let cum = 0;
    for (let k = 0; k < idx.length; ) {
      let j = k;
      let w = 0;
      while (j < idx.length && strengths[idx[j]] === strengths[idx[k]]) w += range.w[idx[j++]];
      const mid = total > 0 ? (cum + w / 2) / total : 0.5;
      for (let t = k; t < j; t++) q[idx[t]] = mid;
      cum += w;
      k = j;
    }
    return q;
  }
  function reweight(range, fn) {
    for (let i = 0; i < NUM_COMBOS; i++) if (range.w[i] > 0) range.w[i] *= Math.max(0, Math.min(1, fn(i)));
  }
  var boardAt = (board, street) => board.slice(0, street === "flop" ? 3 : street === "turn" ? 4 : street === "river" || street === "showdown" ? 5 : 0);
  var OPEN_FACTOR = {
    "3": { BTN: 1.3, SB: 1.1, BB: 0.9 },
    "6": { UTG: 0.7, MP: 0.85, CO: 1.35, BTN: 2.1, SB: 1.6, BB: 0.9 }
  };
  function openFraction(profile, position, players) {
    const pfr = profile.stat("pfr");
    if (players <= 2) return Math.min(0.95, pfr * 1.6);
    const factor = OPEN_FACTOR[players <= 4 ? "3" : "6"][position ?? "BB"] ?? 1;
    return Math.min(0.95, pfr * factor);
  }
  function sizeNarrowing(ratio) {
    return Math.min(1.15, Math.max(0.4, Math.pow(1.66 / (1 + Math.max(0, ratio)), 0.4)));
  }
  function sizeAdjustedContinue(base, ratio, refRatio = 0.66) {
    const mdf = (r) => 1 / (1 + r);
    return Math.min(0.97, Math.max(0.03, base * Math.pow(mdf(ratio) / mdf(refRatio), 0.85)));
  }
  function estimateRange(ctx) {
    const { profile, key } = ctx;
    const range = Range.full().removeCards([...ctx.dead, ...ctx.board]);
    const pre = preflopComboStrengths();
    const vpip = profile.stat("vpip");
    const pfr = profile.stat("pfr");
    const threeBet = profile.stat("threeBet");
    const bluff = profile.stat("bluffShare");
    const preRaisers = ctx.actions.filter((a) => a.street === "preflop" && (a.type === "raise" || a.type === "bet"));
    const opener = preRaisers[0]?.key;
    const lastPreRaiser = preRaisers[preRaisers.length - 1]?.key;
    for (const a of ctx.actions) {
      if (a.key !== key || a.type === "post" || a.type === "fold") continue;
      if (a.street === "preflop") {
        const r = a.raisesBefore;
        switch (a.type) {
          case "call":
            if (r === 0) reweight(range, (i) => inTop(pre[i], vpip) * (1 - 0.6 * inTop(pre[i], pfr * 0.6)));
            else if (a.allIn || r >= 2) {
              const frac = opener === key ? pfr * (1 - profile.stat("foldTo3Bet")) : Math.max(0.05, threeBet * 0.8);
              reweight(range, (i) => inTop(pre[i], frac) * (1 - 0.4 * inTop(pre[i], frac * 0.3)));
            } else reweight(range, (i) => inTop(pre[i], Math.min(0.9, vpip * 0.85)) * (1 - 0.5 * inTop(pre[i], threeBet)));
            break;
          case "check":
            reweight(range, (i) => 1 - 0.7 * inTop(pre[i], pfr * 0.5));
            break;
          case "raise":
          case "bet":
            if (r === 0) reweight(range, (i) => inTop(pre[i], openFraction(profile, ctx.position, ctx.players ?? (ctx.headsUp ? 2 : 3))));
            else if (r === 1) reweight(range, (i) => Math.max(inTop(pre[i], Math.max(threeBet, 0.04)), 0.06 * bluff));
            else reweight(range, (i) => Math.max(inTop(pre[i], 0.035), 0.02));
            break;
        }
        continue;
      }
      const board = boardAt(ctx.board, a.street);
      if (board.length < 3) continue;
      const q = rangePercentiles(range, boardStrengths(board));
      const spot = betSpot(ctx.actions, a);
      const betFreq = spot === "cbet" ? profile.stat("cbet") : spot === "lead" ? profile.stat("lead") : profile.stat("betWhenCheckedTo");
      const raiseFreq = profile.stat("raiseVsBet");
      if (a.facing === 0 || a.type === "check" || a.type === "bet") {
        const ratio = a.type === "bet" ? sizeRatio(a) : 0.66;
        const b = a.type === "bet" ? profile.bluffFor(ratio) : bluff;
        const freq = betFreq * sizeNarrowing(ratio);
        const polar = (i) => inTop(q[i], freq * (1 - b)) + 0.8 * inBottom(q[i], freq * b);
        const pLead = (i) => Math.min(1, freq * (0.15 + 2.4 * q[i] ** 3) / 0.75);
        if (spot === "lead") reweight(range, (i) => a.type === "check" ? 1 - pLead(i) : Math.max(0.01, pLead(i)));
        else if (a.type === "check") reweight(range, (i) => Math.max(0.25, 1 - polar(i)));
        else reweight(range, (i) => Math.max(0.01, polar(i)));
      } else {
        const facingBet = a.type === "call" ? a.added : a.facing - (a.toTotal - a.added);
        const ratio = facingBet / Math.max(1, a.potBefore - facingBet);
        const cont = sizeAdjustedContinue(1 - profile.foldToBet(a.street), ratio);
        if (a.type === "call") reweight(range, (i) => 0.01 + inTop(q[i], cont) * (1 - 0.5 * inTop(q[i], raiseFreq * 0.5)));
        else {
          const ratio2 = sizeRatio(a);
          const b = profile.bluffFor(ratio2);
          const freq = Math.max(0.05, raiseFreq) * sizeNarrowing(ratio2);
          reweight(range, (i) => Math.max(0.01, inTop(q[i], freq * (1 - b)) + 0.5 * inBottom(q[i], freq * b)));
        }
      }
    }
    return range;
  }
  function respondToBet(range, board, profile, ratio, baseContinue2, opts = {}) {
    const preflop = board.length < 3;
    const strengths = preflop ? preflopComboStrengths() : boardStrengths(board);
    const raiseFreq = Math.min(0.5, profile.stat("raiseVsBet"));
    const continuing = new Range();
    const raising = new Range();
    let total = 0;
    let kept = 0;
    const q = rangePercentiles(range, strengths);
    const cont = sizeAdjustedContinue(baseContinue2, ratio, opts.refRatio);
    const sticky = (baseContinue2 - 0.6) * 0.25;
    const rel = opts.refRatio !== void 0 ? Math.max(0, ratio / Math.max(0.05, opts.refRatio) - 1) : ratio;
    const tau = preflop ? Math.min(0.97, 0.8 + 0.05 * Math.log2(1 + rel) - sticky) : Math.min(0.93, 0.6 + 0.1 * Math.log2(1 + ratio) - sticky);
    const byFreq = (i) => 1 - (1 - inTop(q[i], cont)) * (1 - sigmoid((strengths[i] - tau) / 0.04));
    const hasPrice = opts.vsBettor !== void 0 && opts.need !== void 0;
    const rational = !preflop && hasPrice;
    const shift = (baseContinue2 - 0.6) * 0.5;
    const eqQ = rational ? rangePercentiles(range, opts.vsBettor) : q;
    const commit = hasPrice ? Math.min(1, Math.max(0, ((opts.committed ?? 0) - 0.2) / 0.3)) : 0;
    for (let i = 0; i < NUM_COMBOS; i++) {
      const w = range.w[i];
      if (w <= 0) continue;
      total += w;
      let c = rational ? 0.5 * byFreq(i) + 0.5 * sigmoid((opts.vsBettor[i] - opts.need + shift) / 0.06) : byFreq(i);
      if (commit > 0) c += commit * Math.max(0, sigmoid((opts.vsBettor[i] - opts.need) / 0.04) - c);
      continuing.w[i] = w * c;
      kept += w * c;
      raising.w[i] = w * Math.min(c, inTop(eqQ[i], raiseFreq * Math.max(cont, 0.3)));
    }
    return { fold: total > 0 ? 1 - kept / total : 1, continuing, raising, continueFreq: total > 0 ? kept / total : 0 };
  }
  function bettingSplit(range, board, profile, isCbet) {
    const q = rangePercentiles(range, boardStrengths(board));
    const betFreq = isCbet ? profile.stat("cbet") : profile.stat("betWhenCheckedTo");
    const bluff = profile.stat("bluffShare");
    const betting = new Range();
    const checking = new Range();
    let total = 0;
    let bet = 0;
    for (let i = 0; i < NUM_COMBOS; i++) {
      const w = range.w[i];
      if (w <= 0) continue;
      const pBet = Math.min(1, inTop(q[i], betFreq * (1 - bluff)) + 0.8 * inBottom(q[i], betFreq * bluff));
      betting.w[i] = w * pBet;
      checking.w[i] = w * (1 - pBet);
      total += w;
      bet += w * pBet;
    }
    return { betProb: total > 0 ? bet / total : 0, betting, checking };
  }
  function rangeWidth(range) {
    let s = 0;
    for (let i = 0; i < NUM_COMBOS; i++) s += range.w[i];
    return s / NUM_COMBOS;
  }

  // src/engine/advisor.ts
  var POSTFLOP_ORDER = { SB: 0, BB: 1, UTG: 2, MP: 3, CO: 4, BTN: 5 };
  var fmt = (n) => Math.abs(n) >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, "");
  var pct = (x) => `${Math.round(x * 100)}%`;
  function advise(s, learned, opts = {}) {
    const useReads2 = opts.useReads ?? true;
    const model2 = useReads2 ? learned : new OpponentModel();
    const hero = s.players.find((p) => p.seat === s.heroSeat);
    if (!hero || s.heroCards.length !== 2 || hero.folded || !s.handActive || s.street === "showdown") return null;
    if (hero.stack <= 0) return null;
    const heroCards = s.heroCards;
    const villains = s.players.filter((p) => p.key !== hero.key && p.inHand && !p.folded);
    if (!villains.length) return null;
    const dealt = s.players.filter((p) => p.inHand).length;
    const headsUp = dealt === 2;
    const profiles = villains.map((v) => model2.profile(v.key, v.name, dealt));
    const displayName = (i) => profiles[i].name || villains[i].name;
    const ranges = villains.map(
      (v, i) => estimateRange({ key: v.key, profile: profiles[i], position: v.position, headsUp, players: dealt, actions: s.actions, board: s.board, dead: heroCards })
    );
    ranges.forEach((r, i) => {
      if (r.size() < 1) ranges[i] = Range.full().removeCards([...heroCards, ...s.board]);
    });
    const order = (p) => headsUp ? p.position === "SB" ? 1 : 0 : POSTFLOP_ORDER[p.position ?? "BB"];
    const heroInPosition = villains.every((v) => order(hero) > order(v));
    const preflopRaisers = s.actions.filter((a) => a.street === "preflop" && (a.type === "raise" || a.type === "bet"));
    const ctx = {
      s,
      hero,
      heroCards,
      villains,
      profiles,
      ranges,
      headsUp,
      heroInPosition,
      toCall: Math.min(s.currentBet - hero.committedStreet, hero.stack),
      bb: s.bb || 1,
      iterations: opts.iterations ?? 2500,
      seed: opts.seed ?? s.handNumber * 7919 + s.board.length * 31 + s.actions.length,
      preflop: s.street === "preflop",
      raises: s.actions.filter((a) => a.street === s.street && (a.type === "raise" || a.type === "bet")).length,
      heroWasPreflopAggressor: preflopRaisers.length > 0 && preflopRaisers[preflopRaisers.length - 1].key === hero.key,
      heroProfile: model2.profile(hero.key, hero.name, dealt),
      dealt
    };
    const eqAll = equityVs(ctx, ranges);
    const options = buildOptions(ctx, eqAll);
    const T = opts.riskTolerance;
    for (const o of options) o.score = T ? o.ev - (o.variance ?? 0) / (2 * T) : o.ev;
    options.sort((a, b) => b.score - a.score);
    const best = options[0];
    const bestByEv = options.reduce((x, y) => y.ev > x.ev ? y : x);
    const carefulNote = T && bestByEv !== best ? [`Careful mode: ${best.label} instead of ${bestByEv.label} (${bestByEv.ev >= 0 ? "+" : ""}${fmt(bestByEv.ev)} chips) to avoid a big swing`] : [];
    const limpSpot = ctx.preflop && ctx.raises === 0;
    const potOdds = ctx.toCall > 0 && !limpSpot ? ctx.toCall / (s.pot + ctx.toCall) : 0;
    const villainViews = villains.map((v, i) => ({
      key: v.key,
      name: displayName(i),
      position: v.position,
      rangeWidth: rangeWidth(ranges[i]),
      style: profiles[i].style,
      hands: profiles[i].hands,
      likely: likelyClasses(ranges[i], s.board.length >= 3 ? boardStrengths(s.board) : preflopComboStrengths()),
      composition: rangeComposition(ranges[i], s.board, heroCards)
    }));
    const notes = boardNotes(s.board);
    return {
      street: s.street,
      best,
      options,
      equity: eqAll,
      toCall: ctx.toCall,
      pot: s.pot,
      potOdds,
      reasons: [
        ...carefulNote,
        ...useReads2 ? [] : ["Reads off: everyone treated as a typical player"],
        ...boardReasons(ctx, villainViews, notes),
        ...explain(ctx, best, options, eqAll, potOdds)
      ],
      boardNotes: notes,
      villains: villainViews,
      heroCards: cardsToString(heroCards),
      confident: !useReads2 || profiles.every((p) => p.hands >= 100),
      usedReads: useReads2
    };
  }
  function equityVs(ctx, ranges, salt = 0) {
    const live = ranges.filter((r) => r.size() > 1e-6);
    if (!live.length) return 1;
    if (live.length === 1 && ctx.s.board.length === 5) return riverEquityExact(ctx.heroCards, ctx.s.board, live[0]).equity;
    try {
      return equity({ hero: ctx.heroCards, board: ctx.s.board, villains: live, iterations: ctx.iterations, seed: ctx.seed + salt }).equity;
    } catch {
      return 0.5;
    }
  }
  function realization(ctx, allInNow, eq = 0.5) {
    if (allInNow || ctx.s.street === "river") return 1;
    let base;
    if (ctx.preflop) base = ctx.heroInPosition ? 1.02 : ctx.hero.position === "SB" ? 0.7 : 0.84;
    else base = ctx.heroInPosition ? 1 : 0.85;
    const byStrength = ctx.preflop ? Math.min(1.15, Math.max(0.72, 0.55 + 0.9 * eq)) : Math.min(1.12, Math.max(0.8, 0.75 + 0.5 * eq));
    return Math.min(1.15, base * byStrength);
  }
  function baseContinue(ctx, i) {
    const p = ctx.profiles[i];
    const v = ctx.villains[i];
    if (ctx.preflop) {
      if (ctx.raises === 0) {
        const blindDefend = 1 - p.stat("foldToSteal");
        const defend = v.position === "BB" ? Math.min(0.9, blindDefend * (ctx.headsUp ? 1 : 1.1)) : v.position === "SB" && !ctx.headsUp ? blindDefend * 0.55 : v.position === "SB" ? blindDefend : p.stat("callOpen") + p.stat("threeBet");
        return Math.min(0.9, Math.max(0.1, defend));
      }
      if (ctx.raises === 1) return Math.min(0.9, Math.max(0.15, 1 - p.stat("foldTo3Bet")));
      return 0.45;
    }
    const cbet = ctx.s.street === "flop" && ctx.heroWasPreflopAggressor && ctx.raises === 0;
    return 1 - (cbet ? p.stat("foldToCbet") : p.foldToBet(ctx.s.street));
  }
  function callEV(ctx, eqAll) {
    if (ctx.preflop && ctx.raises === 0) return limpEV(ctx, eqAll);
    const { s, hero, villains, toCall } = ctx;
    const allIn = toCall >= hero.stack;
    const pending = villains.map((v, i) => i).filter((i) => !villains[i].allIn && villains[i].committedStreet < s.currentBet);
    const behind = hero.stack - toCall;
    const noMoreBetting = (pot) => allIn || behind <= 0.1 * pot;
    if (!pending.length) {
      const R = realization(ctx, noMoreBetting(s.pot + toCall) || villains.every((v) => v.allIn), eqAll);
      return R * eqAll * (s.pot + toCall) - toCall;
    }
    const heroTo = hero.committedStreet + toCall;
    const resp = pending.map((i) => {
      const v = villains[i];
      const callAmt = Math.max(0, Math.min(s.currentBet, v.committedStreet + v.stack) - v.committedStreet);
      const ratio = callAmt / Math.max(1, s.pot + toCall - callAmt);
      const base = ctx.preflop ? ctx.raises <= 1 ? ctx.profiles[i].stat("callOpen") + ctx.profiles[i].stat("threeBet") : 0.3 : 1 - ctx.profiles[i].foldToBet(s.street);
      return { i, callAmt, ...respondToBet(ctx.ranges[i], s.board, ctx.profiles[i], ratio, Math.min(0.9, base)) };
    });
    let ev = 0;
    for (const { mask, prob } of continueScenarios(resp.map((r) => 1 - r.fold))) {
      const ranges = villains.map((_, i) => {
        const k = resp.findIndex((r) => r.i === i);
        if (k < 0) return ctx.ranges[i];
        return mask & 1 << k ? resp[k].continuing : null;
      });
      const live = ranges.filter((r) => r !== null);
      const extra = resp.reduce((sum, r, k) => sum + (mask & 1 << k ? Math.min(r.callAmt, Math.max(0, heroTo - villains[r.i].committedStreet)) : 0), 0);
      const eq = live.length === villains.length ? eqAll : equityVs(ctx, live, 101 + mask);
      const othersAllIn = villains.every((v, i) => {
        if (ranges[i] === null) return true;
        const k = resp.findIndex((r) => r.i === i);
        return k < 0 ? v.allIn : v.committedStreet + v.stack <= heroTo;
      });
      const R = realization(ctx, noMoreBetting(s.pot + toCall + extra) || othersAllIn, eq);
      ev += prob * (R * eq * (s.pot + toCall + extra) - toCall);
    }
    return ev;
  }
  function limpEV(ctx, eqAll) {
    const { s, villains, toCall } = ctx;
    const pre = preflopComboStrengths();
    let pNoRaise = 1;
    const passive = [];
    villains.forEach((v, i) => {
      const acted = s.actions.some((a) => a.key === v.key && a.street === "preflop" && a.type !== "post");
      if (acted || v.allIn) {
        passive.push(ctx.ranges[i]);
        return;
      }
      const frac = Math.min(0.5, ctx.profiles[i].stat("pfr") * 0.9);
      const q = rangePercentiles(ctx.ranges[i], pre);
      const checks = new Range(Float64Array.from(ctx.ranges[i].w, (w, k) => w * (1 - inTop(q[k], frac))));
      const total = ctx.ranges[i].size();
      pNoRaise *= total > 0 ? checks.size() / total : 1;
      passive.push(checks);
    });
    const eq = passive.every((r, i) => r === ctx.ranges[i]) ? eqAll : equityVs(ctx, passive, 307);
    const noRaise = realization(ctx, false, eq) * eq * (s.pot + toCall) - toCall;
    return pNoRaise * noRaise + (1 - pNoRaise) * -toCall;
  }
  function buildOptions(ctx, eqAll) {
    const { s, hero, toCall } = ctx;
    const out = [];
    const maxTo = hero.committedStreet + hero.stack;
    const allInNow = (added) => added >= hero.stack;
    if (toCall <= 0) {
      out.push({ action: "check", added: 0, allIn: false, ev: checkEV(ctx, eqAll), label: "Check", variance: eqAll * (1 - eqAll) * s.pot ** 2 * 0.5 });
    } else {
      out.push({ action: "fold", added: 0, allIn: false, ev: 0, label: "Fold" });
      const limp = ctx.preflop && ctx.raises === 0;
      const label = allInNow(toCall) ? `Call all-in (${toCall})` : limp ? hero.position === "SB" && s.currentBet - hero.committedStreet < ctx.bb ? `Complete ${toCall}` : `Limp ${toCall}` : `Call ${toCall}`;
      out.push({ action: "call", added: toCall, allIn: allInNow(toCall), ev: callEV(ctx, eqAll), label, variance: eqAll * (1 - eqAll) * (s.pot + toCall) ** 2 });
    }
    const canRaise = hero.stack > toCall && ctx.villains.some((v) => !v.allIn && v.stack > 0);
    if (!canRaise) return out;
    const minTo = s.currentBet > 0 ? s.currentBet + Math.max(s.lastRaiseSize, ctx.bb) : ctx.bb;
    const targets = /* @__PURE__ */ new Set();
    const step = ctx.bb >= 10 ? 5 : 1;
    const tidy = (t) => {
      let to = s.currentBet + Math.round((t - s.currentBet) / step) * step;
      if (to < minTo) to = s.currentBet + Math.ceil((minTo - s.currentBet) / step) * step;
      return Math.min(maxTo, to);
    };
    for (const t of sizeTargets(ctx)) {
      const to = tidy(t);
      if (to > s.currentBet) targets.add(to);
    }
    targets.add(maxTo);
    for (const t of [...targets]) if (t !== maxTo && maxTo - t < 0.12 * maxTo) targets.delete(t);
    const biggestVillain = Math.max(...ctx.villains.map((v) => v.committedStreet + v.stack));
    for (const to of [...targets].sort((a, b) => a - b)) {
      const o = aggressiveEV(ctx, to);
      const risk = Math.min(to, biggestVillain) - hero.committedStreet;
      const overPot = Math.max(0, risk - (s.pot + toCall));
      const streetsLeft = s.street === "flop" ? 2 : s.street === "turn" ? 1 : 0;
      o.ev -= 0.015 * Math.max(0, risk) + 0.04 * overPot + 0.03 * streetsLeft * Math.max(0, overPot - (s.pot + toCall));
      const action = s.currentBet > 0 ? "raise" : "bet";
      const isAllIn = to >= maxTo;
      const sizeNote = ctx.preflop ? `${fmt(to / ctx.bb)} BB` : `${Math.round((to - s.currentBet) / Math.max(1, s.pot + toCall) * 100)}% pot`;
      out.push({
        action,
        toTotal: to,
        added: to - hero.committedStreet,
        allIn: isAllIn,
        ev: o.ev,
        foldProb: o.foldProb,
        equityWhenCalled: o.eqCalled,
        variance: (1 - o.foldProb) * o.eqCalled * (1 - o.eqCalled) * (s.pot + 2 * Math.max(0, risk)) ** 2 + o.foldProb * (1 - o.foldProb) * (s.pot + Math.max(0, risk)) ** 2,
        label: isAllIn ? `All-in (${to})` : `${action === "bet" ? "Bet" : "Raise to"} ${to} (${sizeNote})`
      });
    }
    return out;
  }
  function sizeTargets(ctx) {
    const { s, bb } = ctx;
    if (ctx.preflop) {
      if (ctx.raises === 0) {
        const limpers = s.actions.filter((a) => a.street === "preflop" && a.type === "call").length;
        if (limpers > 0) return [bb * (3.5 + limpers), bb * (4.5 + limpers)];
        const open = ctx.hero.position === "SB" && !ctx.headsUp ? 3 : 2.5;
        return [bb * open, bb * (open + 1)];
      }
      const mult = ctx.heroInPosition ? 3 : 3.8;
      return [s.currentBet * mult, s.currentBet * (mult + 1)];
    }
    const potAfterCall = s.pot + ctx.toCall;
    if (s.currentBet === 0) return [0.33, 0.5, 0.75, 1, 1.5].map((f) => f * s.pot);
    return [0.75, 1.1].map((f) => s.currentBet + f * potAfterCall);
  }
  function checkEV(ctx, eqAll) {
    const { s, hero } = ctx;
    if (s.street === "river" && ctx.heroInPosition) return eqAll * s.pot;
    if (ctx.preflop) return realization(ctx, false, eqAll) * eqAll * s.pot;
    const v = ctx.villains[0];
    if (ctx.villains.length === 1 && !ctx.heroInPosition && !v.allIn && v.stack > 0) {
      const lastPreRaiser = [...s.actions].reverse().find((a) => a.street === "preflop" && (a.type === "raise" || a.type === "bet"))?.key;
      const isCbet = s.street === "flop" && lastPreRaiser === v.key;
      const split = bettingSplit(ctx.ranges[0], s.board, ctx.profiles[0], isCbet);
      const bet = Math.min(Math.round(0.66 * s.pot), v.stack, hero.stack);
      const eqVsBet = split.betting.size() > 1e-6 ? equityVs(ctx, [split.betting], 211) : 0;
      const eqVsCheck = split.checking.size() > 1e-6 ? equityVs(ctx, [split.checking], 223) : eqAll;
      const facingBet = Math.max(0, realization(ctx, bet >= hero.stack, eqVsBet) * eqVsBet * (s.pot + 2 * bet) - bet);
      const checkedThrough = (s.street === "river" ? 1 : realization(ctx, false, eqVsCheck)) * eqVsCheck * s.pot;
      return split.betProb * facingBet + (1 - split.betProb) * checkedThrough;
    }
    const R = realization(ctx, false, eqAll) * (ctx.heroInPosition ? 1 : 0.93);
    return R * eqAll * s.pot;
  }
  var heroEqCache = /* @__PURE__ */ new WeakMap();
  function heroRangeEquity(ctx, to) {
    const { s, hero } = ctx;
    const allIn = to >= hero.committedStreet + hero.stack;
    const ratio = (to - s.currentBet) / Math.max(1, s.pot + ctx.toCall);
    const band = allIn ? "allin" : ratio < 0.45 ? "small" : ratio < 0.9 ? "medium" : "large";
    let cache = heroEqCache.get(ctx);
    if (!cache) heroEqCache.set(ctx, cache = /* @__PURE__ */ new Map());
    let eq = cache.get(band);
    if (!eq) {
      const rep = band === "allin" ? to : Math.round(s.currentBet + (band === "small" ? 0.33 : band === "medium" ? 0.66 : 1.25) * (s.pot + ctx.toCall));
      eq = equityVsRange(s.board, perceivedHeroRange(ctx, Math.min(rep, hero.committedStreet + hero.stack)));
      cache.set(band, eq);
    }
    return eq;
  }
  function perceivedHeroRange(ctx, to) {
    const { s, hero } = ctx;
    const facing = s.currentBet;
    const raisesBefore = s.actions.filter((a) => a.street === s.street && (a.type === "bet" || a.type === "raise")).length;
    const action = {
      key: hero.key,
      seat: hero.seat,
      street: s.street,
      type: facing > 0 ? "raise" : "bet",
      added: to - hero.committedStreet,
      toTotal: to,
      facing,
      potBefore: s.pot,
      allIn: to >= hero.committedStreet + hero.stack,
      raisesBefore,
      auto: false
    };
    const r = estimateRange({
      key: hero.key,
      profile: ctx.heroProfile,
      position: hero.position,
      headsUp: ctx.headsUp,
      players: ctx.dealt,
      actions: [...s.actions, action],
      board: s.board,
      dead: []
    });
    return r.size() >= 1 ? r : Range.full().removeCards(s.board);
  }
  function aggressiveEV(ctx, to) {
    const { s, hero, villains } = ctx;
    const added = to - hero.committedStreet;
    const ratioAt = (target, v) => {
      const capTo = Math.min(target, v.committedStreet + v.stack);
      const callAmt = Math.max(0, capTo - v.committedStreet);
      const potBeforeBet = s.pot + (capTo - hero.committedStreet) - callAmt;
      return callAmt / Math.max(1, potBeforeBet);
    };
    const ratioFor = (v) => ratioAt(to, v);
    const vsHero = ctx.preflop ? preflopEquityVsTop(perceivedHeroRange(ctx, to).fraction()) : heroRangeEquity(ctx, to);
    const stdTo = ctx.preflop ? Math.min(hero.committedStreet + hero.stack, Math.max(s.currentBet + ctx.bb, sizeTargets(ctx)[0])) : to;
    const resp = villains.map((v, i) => {
      if (v.allIn || v.stack === 0) return { fold: 0, continuing: ctx.ranges[i], raising: new Range(), canAct: false };
      const capTo = Math.min(to, v.committedStreet + v.stack);
      const callAmt = Math.max(0, capTo - v.committedStreet);
      const need = callAmt / Math.max(1, s.pot + (capTo - hero.committedStreet) + callAmt);
      const refRatio = ctx.preflop ? ratioAt(stdTo, v) : void 0;
      const committed = v.committedHand / Math.max(1, v.committedHand + v.stack);
      const r = respondToBet(ctx.ranges[i], s.board, ctx.profiles[i], ratioFor(v), baseContinue(ctx, i), { refRatio, vsBettor: vsHero, need, committed });
      return { ...r, canAct: true };
    });
    let ev = 0;
    let allFold = 0;
    let eqCalledSum = 0;
    let eqCalledW = 0;
    for (const { mask, prob } of continueScenarios(resp.map((r) => 1 - r.fold))) {
      if (mask === 0) {
        allFold = prob;
        ev += prob * s.pot;
        continue;
      }
      const callers = villains.map((v, i) => i).filter((i) => mask & 1 << i);
      const cap = Math.max(...callers.map((i) => villains[i].committedStreet + villains[i].stack));
      const heroTo = Math.min(to, cap);
      const heroAdded = heroTo - hero.committedStreet;
      const callerAdds = callers.reduce((sum, i) => sum + Math.max(0, Math.min(heroTo, villains[i].committedStreet + villains[i].stack) - villains[i].committedStreet), 0);
      const finalPot = s.pot + heroAdded + callerAdds;
      const heroAllIn = heroAdded >= hero.stack || hero.stack - heroAdded <= 0.1 * finalPot;
      const everyoneAllIn = heroAllIn || callers.every((i) => villains[i].committedStreet + villains[i].stack <= heroTo);
      const multiway = 1 - 0.04 * (callers.length - 1);
      const R = (eq) => realization(ctx, everyoneAllIn, eq) * multiway;
      let scenarioEV;
      if (callers.length === 1 && resp[callers[0]].canAct && !everyoneAllIn) {
        const i = callers[0];
        const v = villains[i];
        const contW = resp[i].continuing.size();
        const raiseW = Math.min(contW, resp[i].raising.size());
        const pRaise = contW > 0 ? raiseW / contW : 0;
        const flatRange = new Range(Float64Array.from(resp[i].continuing.w, (w, k) => Math.max(0, w - resp[i].raising.w[k])));
        const eqFlat = flatRange.size() > 1e-6 ? equityVs(ctx, [flatRange], mask * 13 + to) : 0.5;
        const callEV2 = R(eqFlat) * eqFlat * finalPot - heroAdded;
        let raisedEV = -heroAdded;
        if (pRaise > 0.01) {
          const villainMax = v.committedStreet + v.stack;
          const reraiseTo = Math.min(villainMax, Math.max(heroTo * 3, heroTo + s.pot));
          const jam = reraiseTo >= villainMax * 0.6 ? villainMax : reraiseTo;
          const heroTotal = Math.min(jam, hero.committedStreet + hero.stack);
          const eqVsRaise = equityVs(ctx, [resp[i].raising], mask * 17 + to);
          const potIfCalled = s.pot + (heroTotal - hero.committedStreet) + (Math.min(heroTotal, villainMax) - v.committedStreet);
          const Rr = realization(ctx, heroTotal >= hero.committedStreet + hero.stack || jam >= villainMax, eqVsRaise);
          raisedEV = Math.max(-heroAdded, Rr * eqVsRaise * potIfCalled - (heroTotal - hero.committedStreet));
        }
        scenarioEV = (1 - pRaise) * callEV2 + pRaise * raisedEV;
        eqCalledSum += prob * eqFlat;
      } else {
        const eq = equityVs(ctx, callers.map((i) => resp[i].continuing), mask * 19 + to);
        scenarioEV = R(eq) * eq * finalPot - heroAdded;
        eqCalledSum += prob * eq;
      }
      eqCalledW += prob;
      ev += prob * scenarioEV;
    }
    return { ev, foldProb: allFold, eqCalled: eqCalledW > 0 ? eqCalledSum / eqCalledW : 0 };
  }
  function continueScenarios(cont) {
    const n = cont.length;
    const probOf = (mask) => {
      let p = 1;
      for (let i = 0; i < n; i++) p *= mask & 1 << i ? cont[i] : 1 - cont[i];
      return p;
    };
    const out = [];
    if (n <= 4) {
      for (let mask = 0; mask < 1 << n; mask++) {
        const prob = probOf(mask);
        if (prob >= 1e-4) out.push({ mask, prob });
      }
      return out;
    }
    let covered = 0;
    const push = (mask) => {
      const prob = probOf(mask);
      covered += prob;
      if (prob >= 1e-4) out.push({ mask, prob });
    };
    push(0);
    for (let i = 0; i < n; i++) push(1 << i);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) push(1 << i | 1 << j);
    const rest = 1 - covered;
    if (rest >= 1e-4) {
      const order = cont.map((c, i) => [c, i]).sort((a, b) => b[0] - a[0]);
      let mask = 0;
      order.forEach(([c, i], k) => {
        if (k < 3 || c >= 0.3) mask |= 1 << i;
      });
      out.push({ mask, prob: rest });
    }
    return out;
  }
  function likelyClasses(range, strengths) {
    const agg = /* @__PURE__ */ new Map();
    for (let i = 0; i < NUM_COMBOS; i++) {
      const w = range.w[i];
      if (w <= 0) continue;
      const [a, b] = COMBOS[i];
      const c = classOf(a, b);
      const e = agg.get(c) ?? { w: 0, n: 0, st: 0 };
      e.w += w;
      e.n++;
      e.st += strengths[i] * w;
      agg.set(c, e);
    }
    const rows = [...agg.entries()].map(([c, e]) => ({ c, avg: e.w / e.n, st: e.st / e.w }));
    const maxAvg = Math.max(0, ...rows.map((r) => r.avg));
    if (rows.length > 120 && rows.every((r) => r.avg > 0.9 * maxAvg)) return ["any two cards"];
    return rows.filter((r) => r.avg >= 0.5 * maxAvg).sort((x, y) => y.st - x.st).slice(0, 8).map((r) => r.c);
  }
  function boardReasons(ctx, villains, notes) {
    const out = [];
    const board = playingTheBoard(ctx.heroCards, ctx.s.board);
    if (board) out.push(board);
    if (ctx.preflop) return out;
    const aggressor = [...ctx.s.actions].reverse().find((a) => a.street === ctx.s.street && (a.type === "bet" || a.type === "raise"));
    if (aggressor && ctx.toCall > 0) {
      const v = villains.find((x) => x.key === aggressor.key);
      if (v?.composition.length) {
        const top = v.composition.filter(([, share]) => share >= 0.08).slice(0, 4);
        const what = top.map(([k, share]) => `${k} ${pct(share)}`).join(", ");
        const last = ctx.s.board[ctx.s.board.length - 1];
        const lastText = cardsToString([last]).replace(/^T/, "10").replace(/[cdhs]$/, (x) => ({ c: "\u2663", d: "\u2666", h: "\u2665", s: "\u2660" })[x]);
        const card = ctx.s.board.length > 3 ? `After the ${lastText}, ` : "";
        out.push(`${card}${v.name}'s ${aggressor.type} most likely means: ${what}`);
      }
    }
    if (notes[0] && !out.some((r) => r.includes(notes[0]))) out.push(notes[0]);
    return out;
  }
  function explain(ctx, best, options, eqAll, potOdds) {
    const reasons = [];
    const names = ctx.profiles.map((p, i) => p.name || ctx.villains[i].name).join(" & ");
    reasons.push(`Win chance ${pct(eqAll)} vs ${names}'s likely hands`);
    if (ctx.toCall > 0 && !(ctx.preflop && ctx.raises === 0)) reasons.push(`Calling ${ctx.toCall} into ${ctx.s.pot} needs ${pct(potOdds)}`);
    if (ctx.preflop) {
      const cls = classOf(ctx.heroCards[0], ctx.heroCards[1]);
      const rank = preflopScores().get(cls) ?? 0;
      reasons.push(`${cls} is a top ${pct(1 - rank + 5e-3)} starting hand`);
    }
    if (best.action === "bet" || best.action === "raise") {
      if (best.foldProb !== void 0) reasons.push(`They fold about ${pct(best.foldProb)} of the time to this size`);
      const eqc = best.equityWhenCalled;
      if (eqc !== void 0) {
        if (ctx.preflop) reasons.push(`When called you have ${pct(eqc)} equity${ctx.heroInPosition ? " and position" : ""}`);
        else if (eqc >= 0.5) reasons.push(`Value: ${pct(eqc)} vs the hands that call`);
        else if (eqc >= 0.25) reasons.push(`Semi-bluff: ${pct(eqc)} when called, plus fold equity`);
        else reasons.push(`Bluff: profit comes from folds (${pct(eqc)} when called)`);
      }
    }
    for (let i = 0; i < ctx.villains.length; i++) {
      const p = ctx.profiles[i];
      if (p.hands < 10) continue;
      const street = ctx.s.street;
      const f = ctx.preflop ? null : p.foldToBet(street);
      if (f !== null && (f > 0.6 || f < 0.3)) reasons.push(`${p.name} folds to ${street} bets ${pct(f)} (${p.style})`);
      else if (p.style !== "balanced" && !p.style.startsWith("unknown")) reasons.push(`${p.name}: ${p.style}`);
    }
    const second = options.find((o) => o !== best);
    if (second) reasons.push(`Expected ${best.ev >= 0 ? "+" : ""}${fmt(best.ev)} chips, next best is ${second.label} at ${second.ev >= 0 ? "+" : ""}${fmt(second.ev)}`);
    return reasons;
  }

  // src/overlay/overlay.ts
  var CSS = `
:host { all: initial; }
.panel { position: fixed; top: 72px; right: 16px; width: 320px; max-height: calc(100vh - 96px); overflow: auto;
  z-index: 2147483646; font: 13px/1.4 system-ui, -apple-system, Segoe UI, sans-serif; color: #e8eaed;
  background: rgba(22, 24, 29, 0.94); border: 1px solid #3a3f4b; border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.45); }
.panel.min .body { display: none; }
.head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: move; user-select: none; border-bottom: 1px solid #2c313b; }
.title { font-weight: 700; letter-spacing: .2px; }
.status { margin-left: auto; font-size: 11px; color: #9aa0a6; }
.btn { background: #2c313b; color: #e8eaed; border: 1px solid #3a3f4b; border-radius: 6px; padding: 2px 8px; font: inherit; font-size: 12px; cursor: pointer; }
.btn:hover { background: #363c48; }
.tabs { display: flex; gap: 4px; padding: 8px 10px 0; }
.tab { flex: 1; text-align: center; padding: 4px 0; border-radius: 6px 6px 0 0; cursor: pointer; color: #9aa0a6; border-bottom: 2px solid transparent; }
.tab.on { color: #e8eaed; border-bottom-color: #8ab4f8; }
.pane { padding: 10px; display: none; }
.pane.on { display: block; }
.cards { font-size: 20px; font-weight: 700; letter-spacing: 1px; }
.board { color: #9aa0a6; margin-top: 2px; }
.s, .c { color: #e8eaed; } .h, .d { color: #f28b82; }
.d { color: #8ab4f8; } .c { color: #81c995; }
.rec { margin: 10px 0 6px; padding: 10px; border-radius: 8px; font-size: 18px; font-weight: 800; text-align: center; }
.rec.fold { background: #3c1f1f; color: #f28b82; }
.rec.check, .rec.call { background: #1f2c3c; color: #8ab4f8; }
.rec.bet, .rec.raise { background: #1f3527; color: #81c995; }
.rec.wait { background: #24272e; color: #9aa0a6; font-size: 14px; font-weight: 600; }
.kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 6px 0; }
.kpi { background: #24272e; border-radius: 6px; padding: 6px; text-align: center; }
.kpi b { display: block; font-size: 16px; }
.kpi span { font-size: 11px; color: #9aa0a6; }
ul { margin: 6px 0; padding-left: 18px; } li { margin: 2px 0; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
td, th { padding: 3px 4px; text-align: right; border-bottom: 1px solid #2c313b; white-space: nowrap; }
td:first-child, th:first-child { text-align: left; }
tr.best td { color: #81c995; font-weight: 700; }
.muted { color: #9aa0a6; font-size: 11px; }
.pos { color: #81c995; } .neg { color: #f28b82; }
.villain { margin: 4px 0; }
.row { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.toggle { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #9aa0a6; margin-bottom: 8px; cursor: pointer; }
.scroll { overflow-x: auto; }
.hint { font-size: 12px; font-weight: 500; opacity: .85; margin-top: 2px; }
.hint b { font-weight: 800; }
details.more { margin-top: 4px; }
details.more summary { cursor: pointer; color: #8ab4f8; font-size: 12px; margin-bottom: 4px; }
.btn.danger { color: #f28b82; }
.head .btn { padding: 2px 7px; }
.addrow { display: flex; gap: 6px; margin-bottom: 8px; }
.addrow input { flex: 1; background: #24272e; color: #e8eaed; border: 1px solid #3a3f4b; border-radius: 6px; padding: 4px 8px; font: inherit; }
.sect { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: #9aa0a6; margin: 10px 0 4px; }
.person { border: 1px dashed #3a3f4b; border-radius: 8px; padding: 6px 8px; margin: 6px 0; }
.person.over { border-color: #8ab4f8; background: #1f2c3c; }
.phead { display: flex; align-items: center; gap: 6px; }
.phead .muted { margin-left: auto; }
.icon { background: none; border: 0; color: #9aa0a6; cursor: pointer; font-size: 13px; padding: 0 2px; }
.icon:hover { color: #e8eaed; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.chip { display: inline-flex; align-items: center; gap: 2px; background: #2c313b; border-radius: 12px; padding: 1px 4px 1px 8px; font-size: 12px; }
.x { background: none; border: 0; color: #9aa0a6; cursor: pointer; font-size: 13px; line-height: 1; }
.x:hover { color: #f28b82; }
.loose { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 4px 6px; margin: 3px 0; background: #24272e; border-radius: 6px; cursor: grab; }
.loose > span:first-child { flex: 1; min-width: 0; }
select { background: #2c313b; color: #e8eaed; border: 1px solid #3a3f4b; border-radius: 4px; font: inherit; font-size: 11px; max-width: 90px; }
`;
  var SUIT_CLASS = ["c", "d", "h", "s"];
  var SUIT_SYMBOL2 = ["\u2663", "\u2666", "\u2665", "\u2660"];
  var pct2 = (x) => `${Math.round(x * 100)}%`;
  var esc = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function cardHtml(cards) {
    return cards.map((c) => {
      const s = cardsToString([c]);
      return `<span class="${SUIT_CLASS[c & 3]}">${s[0] === "T" ? "10" : s[0]}${SUIT_SYMBOL2[c & 3]}</span>`;
    }).join(" ");
  }
  var Overlay = class {
    constructor(actions) {
      this.actions = actions;
      const host = document.createElement("div");
      host.id = "pokerbot-overlay";
      this.root = host.attachShadow({ mode: "open" });
      this.root.innerHTML = `<style>${CSS}</style>
      <div class="panel">
        <div class="head"><span class="title">\u2660 Poker Bot</span><span class="status">waiting for game\u2026</span>
          <button class="btn" data-act="settings" title="Settings">\u2699</button>
          <button class="btn" data-act="min" title="Minimise (Alt+B)">\u2013</button></div>
        <div class="body">
          <div class="tabs"><div class="tab on" data-tab="advice">Advice</div><div class="tab" data-tab="players">Stats</div><div class="tab" data-tab="people">People</div><div class="tab" data-tab="ledger">Ledger</div></div>
          <div class="pane on" data-pane="advice"></div>
          <div class="pane" data-pane="players"></div>
          <div class="pane" data-pane="people"></div>
          <div class="pane" data-pane="settings"></div>
          <div class="pane" data-pane="ledger"></div>
        </div>
      </div>`;
      this.panel = this.root.querySelector(".panel");
      const mount = () => (document.body ?? document.documentElement).appendChild(host);
      if (document.body) mount();
      else document.addEventListener("DOMContentLoaded", mount);
      this.root.addEventListener("click", (e) => {
        const t = e.target;
        const tab = t.closest("[data-tab]")?.dataset.tab;
        if (tab) this.showTab(tab);
        const act = t.closest("[data-act]")?.dataset.act;
        if (act === "min") {
          this.panel.classList.toggle("min");
          this.saveLayout();
        }
        if (act === "reset" && confirm("Reset the ledger for this lobby?")) this.actions.resetLedger();
        if (act === "capture") this.actions.saveCapture();
        const el = t.closest("[data-act]");
        if (act === "add-person") this.addPerson();
        if (act === "settings") {
          if (this.tab === "settings") this.showTab(this.lastTab);
          else {
            this.renderSettings();
            this.showTab("settings");
          }
        }
        if (act === "close-settings") this.showTab(this.lastTab);
        if (act === "export") this.actions.exportData();
        if (act === "import") this.root.querySelector("#pb-import")?.click();
        if (act === "reset-all" && confirm("Forget everything learned about every player? Make a backup first if you might want it back.")) this.actions.forgetEveryone();
        if (act === "remove-name") this.actions.removeName(el.dataset.key, el.dataset.name);
        if (act === "rename") {
          const label = prompt("Rename this person:", el.dataset.label ?? "");
          if (label?.trim()) this.actions.renamePerson(el.dataset.key, label.trim());
        }
        if (act === "forget" && confirm(`Forget ${el.dataset.label} and everything learned about them?`)) this.actions.forget(el.dataset.key);
      });
      this.root.addEventListener("change", (e) => {
        const t = e.target;
        if (t.dataset.act === "reads") this.actions.setUseReads(t.checked);
        if (t.dataset.act === "careful") this.actions.setCareful(t.checked);
        if (t.id === "pb-import") {
          const file = t.files?.[0];
          if (file) void file.text().then((txt) => this.actions.importData(txt));
        }
        if (t.dataset.act === "assign" && t.value) {
          let person = t.value;
          if (person === "__new") {
            const label = prompt(`Who is ${t.dataset.name}? (e.g. Isaiah)`, "");
            if (!label?.trim()) {
              t.value = "";
              return;
            }
            person = this.actions.createPerson(label.trim());
          }
          this.actions.assign(t.dataset.key, person);
        }
      });
      this.root.addEventListener("keydown", (e) => {
        const ke = e;
        if (ke.target.id === "pb-new-person" && ke.key === "Enter") this.addPerson();
        ke.stopPropagation();
      });
      this.root.addEventListener("dragstart", (e) => {
        const key = e.target.closest("[data-drag]")?.dataset.drag;
        if (key) e.dataTransfer?.setData("text/plain", key);
      });
      this.root.addEventListener("dragover", (e) => {
        const drop = e.target.closest("[data-drop]");
        if (drop) {
          e.preventDefault();
          drop.classList.add("over");
        }
      });
      this.root.addEventListener("dragleave", (e) => e.target.closest("[data-drop]")?.classList.remove("over"));
      this.root.addEventListener("drop", (e) => {
        const drop = e.target.closest("[data-drop]");
        const key = e.dataTransfer?.getData("text/plain");
        if (!drop || !key) return;
        e.preventDefault();
        drop.classList.remove("over");
        if (key !== drop.dataset.drop) this.actions.assign(key, drop.dataset.drop);
      });
      window.addEventListener("keydown", (e) => {
        if (e.altKey && e.key.toLowerCase() === "b") {
          this.panel.classList.toggle("min");
          this.saveLayout();
        }
      });
      this.makeDraggable();
      this.restoreLayout();
    }
    root;
    panel;
    tab = "advice";
    advice = null;
    thinking = false;
    useReads = true;
    careful = false;
    detailsOpen = false;
    saveLayout() {
      try {
        localStorage.setItem(
          "pokerbot:layout",
          JSON.stringify({ left: this.panel.style.left, top: this.panel.style.top, min: this.panel.classList.contains("min"), tab: this.lastTab, details: this.detailsOpen })
        );
      } catch {
      }
    }
    restoreLayout() {
      try {
        const l = JSON.parse(localStorage.getItem("pokerbot:layout") ?? "null");
        if (!l) return;
        if (l.left && l.top && parseInt(l.left) < window.innerWidth - 60 && parseInt(l.top) < window.innerHeight - 40) {
          this.panel.style.left = l.left;
          this.panel.style.top = l.top;
          this.panel.style.right = "auto";
        }
        if (l.min) this.panel.classList.add("min");
        if (l.tab && l.tab !== "settings") this.showTab(l.tab);
        this.detailsOpen = !!l.details;
      } catch {
      }
    }
    addPerson() {
      const input = this.root.querySelector("#pb-new-person");
      const label = input?.value.trim();
      if (!label) return;
      this.actions.createPerson(label);
      input.value = "";
    }
    makeDraggable() {
      const head = this.root.querySelector(".head");
      let dx = 0;
      let dy = 0;
      let dragging = false;
      head.addEventListener("mousedown", (e) => {
        if (e.target.closest("button")) return;
        dragging = true;
        const r = this.panel.getBoundingClientRect();
        dx = e.clientX - r.left;
        dy = e.clientY - r.top;
        e.preventDefault();
      });
      window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        this.panel.style.left = `${Math.max(0, e.clientX - dx)}px`;
        this.panel.style.top = `${Math.max(0, e.clientY - dy)}px`;
        this.panel.style.right = "auto";
      });
      window.addEventListener("mouseup", () => {
        if (dragging) this.saveLayout();
        dragging = false;
      });
    }
    lastTab = "advice";
    showTab(tab) {
      if (tab !== "settings") this.lastTab = tab;
      this.tab = tab;
      if (this.panel) this.saveLayout();
      this.root.querySelectorAll("[data-tab]").forEach((el) => el.classList.toggle("on", el.dataset.tab === tab));
      this.root.querySelectorAll("[data-pane]").forEach((el) => el.classList.toggle("on", el.dataset.pane === tab));
    }
    pane(name) {
      return this.root.querySelector(`[data-pane="${name}"]`);
    }
    setStatus(text) {
      this.root.querySelector(".status").textContent = text;
    }
    setThinking(on) {
      this.thinking = on;
    }
    setAdvice(a) {
      this.advice = a;
    }
    setUseReads(on) {
      this.useReads = on;
    }
    setCareful(on) {
      this.careful = on;
    }
    render(s, model2, ledger) {
      this.setStatus(s.handActive ? `hand ${s.handNumber} \xB7 ${s.street} \xB7 ${s.sb}/${s.bb}${s.paused ? " \xB7 paused" : ""}` : s.players.length ? "between hands" : "waiting for game\u2026");
      this.renderAdvice(s);
      this.renderPlayers(s, model2);
      this.renderPeople(model2);
      this.renderLedger(ledger.map((r) => {
        const person = model2.displayName(model2.resolve(r.key, r.name));
        return { ...r, name: person && person !== r.key && person !== r.name ? `${person} (${r.name})` : r.name };
      }));
    }
    renderAdvice(s) {
      const hero = s.players.find((p) => p.seat === s.heroSeat);
      const heroTurn = !!hero && s.toActSeat === s.heroSeat;
      const a = heroTurn ? this.advice : null;
      let html = "";
      if (s.heroCards.length) html += `<div class="cards">${cardHtml(s.heroCards)}</div>`;
      html += `<div class="board">${s.board.length ? `Board ${cardHtml(s.board)}` : s.handActive ? "Preflop" : ""}${s.handActive ? ` \xB7 Pot ${s.pot}` : ""}</div>`;
      if (!s.handActive) html += `<div class="rec wait">Waiting for the next hand</div>`;
      else if (hero?.folded) html += `<div class="rec wait">Folded</div>`;
      else if (!heroTurn) html += `<div class="rec wait">Waiting for your turn</div>`;
      else if (!a) html += `<div class="rec wait">${this.thinking ? "Thinking\u2026" : "Your turn"}</div>`;
      else {
        const b = a.best;
        let hint = "";
        if ((b.action === "bet" || b.action === "raise") && b.toTotal !== void 0)
          hint = b.allIn ? "Use the all-in button" : `Enter <b>${b.toTotal - s.currentBet}</b> in the raise box`;
        html += `<div class="rec ${b.action}">${esc(b.label)}${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
        html += `<div class="kpis">
        <div class="kpi"><b>${pct2(a.equity)}</b><span>win chance</span></div>
        <div class="kpi"><b>${a.potOdds ? pct2(a.potOdds) : "\u2013"}</b><span>needed to call</span></div>
        <div class="kpi"><b>${a.toCall || 0}</b><span>to call</span></div></div>`;
        const key = a.reasons.filter((r) => !r.startsWith("Expected ") && !r.startsWith("Win chance "));
        html += `<ul>${key.slice(0, 3).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`;
        html += `<details class="more" ${this.detailsOpen ? "open" : ""}><summary>Details</summary>`;
        html += `<table><tr><th>Option</th><th>Expected chips</th></tr>${a.options.slice(0, 6).map((o, i) => `<tr class="${i === 0 ? "best" : ""}"><td>${esc(o.label)}</td><td>${o.ev >= 0 ? "+" : ""}${o.ev.toFixed(1)}</td></tr>`).join("")}</table>`;
        html += a.villains.map((v) => {
          const width = v.likely[0] === "any two cards" ? "any hand" : `top ${pct2(v.rangeWidth)} of hands`;
          const style = v.style.startsWith("unknown") ? "still learning" : v.style;
          const comp = v.composition.filter(([, x]) => x >= 0.05).slice(0, 4).map(([k, x]) => `${k} ${pct2(x)}`).join(" \xB7 ");
          const likely = v.likely[0] === "any two cards" ? "" : `<br><span class="muted">${comp ? `Holding: ${esc(comp)}<br>` : ""}Likely: ${esc(v.likely.join(" "))}</span>`;
          return `<div class="villain"><b>${esc(v.name)}</b> <span class="muted">${v.position ?? ""} \xB7 ${width} \xB7 ${esc(style)}</span>${likely}</div>`;
        }).join("");
        const rest = a.reasons.filter((r) => !key.slice(0, 3).includes(r));
        if (rest.length) html += `<ul class="muted">${rest.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`;
        html += `</details>`;
        if (!a.usedReads) html += `<div class="muted">Reads are off (\u2699): advice assumes typical opponents.</div>`;
        else if (!a.confident) html += `<div class="muted">Still learning your mates; reads sharpen as you play.</div>`;
      }
      this.pane("advice").innerHTML = html;
      this.pane("advice").querySelector("details")?.addEventListener("toggle", (e) => {
        this.detailsOpen = e.target.open;
        this.saveLayout();
      });
    }
    renderSettings() {
      this.pane("settings").innerHTML = `
      <div class="sect">Advice</div>
      <label class="toggle"><input type="checkbox" data-act="reads" ${this.useReads ? "checked" : ""}> Use reads on mates</label>
      <div class="muted">Off: ignore what's been learned and treat everyone as a typical player.</div>
      <label class="toggle" style="margin-top:8px"><input type="checkbox" data-act="careful" ${this.careful ? "checked" : ""}> Careful with big pots</label>
      <div class="muted">Small pots play as normal; a big all-in or coin flip needs a clear edge before it's suggested. Costs a little in the long run, keeps nights steadier.</div>
      <div class="sect">Your data</div>
      <div class="muted">Everything the bot learns is stored in this browser. Back it up before reinstalling Chrome or clearing site data.</div>
      <div class="row"><button class="btn" data-act="export">Back up</button><button class="btn" data-act="import">Restore\u2026</button>
        <button class="btn danger" data-act="reset-all">Forget everyone</button></div>
      <input type="file" id="pb-import" accept=".json,application/json" hidden>
      <div class="sect">Shortcuts</div>
      <div class="muted"><b>Alt+B</b> hide or show the panel \xB7 drag the title bar to move it</div>
      <div class="row"><button class="btn" data-act="close-settings">Done</button></div>`;
    }
    renderPlayers(s, model2) {
      const heroKey = s.heroKey ? model2.resolve(s.heroKey, s.players.find((p) => p.key === s.heroKey)?.name) : void 0;
      const keys = [];
      const add = (k, name) => {
        const r = model2.resolve(k, name);
        if (r !== heroKey && !model2.players.get(r)?.me && !keys.includes(r)) keys.push(r);
      };
      for (const p of s.players) if (p.seat !== s.heroSeat) add(p.key, p.name);
      for (const p of model2.players.values()) add(p.key);
      const rows = [
        ["VPIP", "vpip"],
        ["Raise preflop", "pfr"],
        ["3-bet", "threeBet"],
        ["Fold to steal", "foldToSteal"],
        ["C-bet", "cbet"],
        ["Fold to c-bet", "foldToCbet"],
        ["Fold to flop bet", "foldToBetFlop"],
        ["Fold to turn bet", "foldToBetTurn"],
        ["Fold to river bet", "foldToBetRiver"],
        ["Raise vs bet", "raiseVsBet"],
        ["Bets when checked to", "betWhenCheckedTo"],
        ["Bluff share (shown)", "bluffShare"],
        ["Went to showdown", "wtsd"]
      ];
      if (!keys.length) {
        this.pane("players").innerHTML = `<div class="muted">No opponents seen yet.</div>`;
        return;
      }
      const dealt = Math.max(2, s.players.filter((p) => p.inHand).length || s.players.length);
      const profiles = keys.map((k) => model2.profile(k, s.players.find((p) => p.key === k)?.name ?? k, dealt));
      const allNames = (k) => {
        const p = model2.players.get(k);
        return p ? [.../* @__PURE__ */ new Set([p.name, ...p.aliasNames ?? []])].filter((n) => n && n !== p.label) : [];
      };
      const aka = (k) => {
        const p = model2.players.get(k);
        return allNames(k).filter((n) => p?.label || n !== p?.name);
      };
      let html = `<div class="scroll"><table><tr><th></th>${profiles.map((p) => `<th>${esc(p.name)}${aka(p.key).length ? `<br><span class="muted">${model2.players.get(p.key)?.label ? "plays as" : "aka"} ${esc(aka(p.key).join(", "))}</span>` : ""}</th>`).join("")}</tr>`;
      html += `<tr><td>Hands</td>${profiles.map((p) => `<td>${p.hands}</td>`).join("")}</tr>`;
      for (const [label, stat] of rows)
        html += `<tr><td>${label}</td>${profiles.map((p) => {
          const [, n] = p.raw(stat);
          return `<td title="${n} samples">${pct2(p.stat(stat))}${n < 5 ? "*" : ""}</td>`;
        }).join("")}</tr>`;
      html += `<tr><td>Style</td>${profiles.map((p) => `<td>${esc(p.style.split(" (")[0])}</td>`).join("")}</tr>`;
      html += `</table></div>`;
      html += `<div class="muted">Preflop numbers are for ${dealt <= 2 ? "heads-up" : dealt <= 4 ? "3\u20134 player" : "5+ player"} games. * fewer than 5 samples: mostly the default assumption. Use the People tab to put each mate's names under one person.</div>`;
      this.pane("players").innerHTML = html;
    }
    peopleSig = "";
    renderPeople(model2) {
      const people = model2.people();
      const loose = model2.unassigned();
      const sig = JSON.stringify([people.map((p) => [p.key, p.label, p.hands, model2.namesOf(p.key)]), loose.map((p) => [p.key, p.name, p.hands])]);
      if (sig === this.peopleSig) return;
      this.peopleSig = sig;
      const options = people.map((p) => `<option value="${esc(p.key)}">${esc(p.label)}</option>`).join("");
      let html = `<div class="addrow"><input id="pb-new-person" placeholder="Add a person, e.g. Isaiah" autocomplete="off"><button class="btn" data-act="add-person">Add</button></div>`;
      html += `<div class="sect">People</div>`;
      if (!people.length) html += `<div class="muted">No people yet. Add your mates above, then drag their names onto them.</div>`;
      for (const p of people) {
        const names = model2.namesOf(p.key);
        html += `<div class="person" data-drop="${esc(p.key)}">
        <div class="phead"><b>${esc(p.label)}</b><span class="muted">${p.hands} hands</span>
          <button class="icon" title="Rename" data-act="rename" data-key="${esc(p.key)}" data-label="${esc(p.label)}">\u270E</button>
          <button class="icon" title="Forget" data-act="forget" data-key="${esc(p.key)}" data-label="${esc(p.label)}">\u{1F5D1}</button></div>
        <div class="chips">${names.length ? names.map((n) => `<span class="chip">${esc(n)}<button class="x" title="Not ${esc(p.label)}" data-act="remove-name" data-key="${esc(p.key)}" data-name="${esc(n)}">\xD7</button></span>`).join("") : `<span class="muted">Drag names here</span>`}</div></div>`;
      }
      html += `<div class="sect">Names not assigned yet</div>`;
      if (!loose.length) html += `<div class="muted">Every opponent name is assigned.</div>`;
      for (const p of loose)
        html += `<div class="loose" draggable="true" data-drag="${esc(p.key)}"><span>\u283F ${esc(p.name)} <span class="muted">${p.hands} hands</span></span>
        <select data-act="assign" data-key="${esc(p.key)}" data-name="${esc(p.name)}"><option value="">Add to\u2026</option>${options}<option value="__new">New person\u2026</option></select>
        <button class="icon" title="Forget this name" data-act="forget" data-key="${esc(p.key)}" data-label="${esc(p.name)}">\u{1F5D1}</button></div>`;
      html += `<div class="muted">A name you've assigned is recognised automatically on future nights. Removing a name stops future games counting towards that person; stats already combined stay.</div>`;
      this.pane("people").innerHTML = html;
    }
    renderLedger(rows) {
      let html = `<table><tr><th>Player</th><th>In</th><th>Out</th><th>Stack</th><th>Net</th></tr>`;
      for (const r of rows)
        html += `<tr><td>${esc(r.name)}</td><td>${r.buyIns}</td><td>${r.cashOuts}</td><td>${r.stack}</td><td class="${r.net >= 0 ? "pos" : "neg"}">${r.net >= 0 ? "+" : ""}${r.net}</td></tr>`;
      html += `</table><div class="muted">Net = cash-outs + stack \u2212 buy-ins. Re-buys and stack edits are picked up automatically.</div>
      <div class="row"><button class="btn" data-act="reset">Reset ledger</button><button class="btn" data-act="capture" title="Saves tonight's game data so a misread hand can be checked">Save capture</button></div>`;
      this.pane("ledger").innerHTML = html;
    }
  };

  // src/tracker/tracker.ts
  var STREET_OF_STAGE = {
    pre_flop: "preflop",
    flop: "flop",
    turn: "turn",
    river: "river",
    showdown: "showdown"
  };
  var seatNumber = (seat) => Number(/^s(\d+)/.exec(seat)?.[1] ?? 99);
  var validUid = (u) => typeof u === "string" && u.length > 0 && u !== "[redacted]";
  var Tracker = class {
    state = {
      handNumber: 0,
      handActive: false,
      street: "idle",
      sb: 0,
      bb: 0,
      board: [],
      players: [],
      heroCards: [],
      currentBet: 0,
      lastRaiseSize: 0,
      pot: 0,
      actions: [],
      paused: false
    };
    nameToUid = /* @__PURE__ */ new Map();
    uidToName = /* @__PURE__ */ new Map();
    cardSeat = /* @__PURE__ */ new Map();
    seenCardIds = /* @__PURE__ */ new Set();
    pendingAcks = /* @__PURE__ */ new Map();
    ledgerRows = /* @__PURE__ */ new Map();
    playState = /* @__PURE__ */ new Map();
    boardIds = /* @__PURE__ */ new Set();
    heroCardIds = /* @__PURE__ */ new Set();
    descriptions = {};
    serverPot;
    listeners = {
      update: [],
      heroTurn: [],
      handComplete: [],
      handShown: []
    };
    lastHistory;
    /** We started watching part-way through a hand: ignore it for stats and the ledger. */
    joinedMidHand = false;
    on(event, fn) {
      this.listeners[event].push(fn);
    }
    emit(event, arg) {
      for (const fn of this.listeners[event]) fn(arg);
    }
    // ---------- identity ----------
    learn(name, uid) {
      if (typeof name !== "string" || !validUid(uid)) return;
      if (this.nameToUid.get(name) === uid) return;
      this.nameToUid.set(name, uid);
      this.uidToName.set(uid, name);
      const oldKey = `name:${name}`;
      const row = this.ledgerRows.get(oldKey);
      if (row && !this.ledgerRows.has(uid)) {
        this.ledgerRows.delete(oldKey);
        this.ledgerRows.set(uid, { ...row, key: uid });
      }
      for (const p of this.state.players)
        if (p.key === oldKey) {
          p.key = uid;
          p.userId = uid;
        }
      for (const a of this.state.actions) if (a.key === oldKey) a.key = uid;
    }
    keyFor(name, uid) {
      if (validUid(uid)) {
        this.learn(name, uid);
        return uid;
      }
      const known = this.nameToUid.get(name);
      return known ?? `name:${name}`;
    }
    playerBySeat(seat) {
      return seat ? this.state.players.find((p) => p.seat === seat) : void 0;
    }
    playerById(id) {
      return this.state.players.find((p) => p.id === id);
    }
    playerByKey(key) {
      return this.state.players.find((p) => p.key === key || p.userId === key);
    }
    // ---------- ledger ----------
    ledgerRow(key, name) {
      let row = this.ledgerRows.get(key);
      if (!row) {
        row = { key, name, buyIns: 0, cashOuts: 0, stack: 0, net: 0 };
        this.ledgerRows.set(key, row);
      }
      row.name = name;
      return row;
    }
    adjust(row, diff) {
      if (diff > 0) row.buyIns += diff;
      else if (diff < 0) row.cashOuts -= diff;
    }
    /** Compare a stack seen between hands with what we expected; the difference is a re-buy, top-up or cash-out. */
    reconcile(p) {
      const row = this.ledgerRow(p.key, p.name);
      const total = p.stack + p.committedHand;
      if (row.expected === void 0) {
        if (row.buyIns === 0 && row.cashOuts === 0) row.buyIns = total;
        else this.adjust(row, total - row.stack);
      } else if (total !== row.expected) this.adjust(row, total - row.expected);
      row.expected = total;
      row.stack = total;
    }
    /** Room id from our own `room:join`, used to keep a ledger per lobby. */
    roomId;
    /** Full ledger rows (including expected stacks) so a reload can carry on. */
    exportLedger() {
      return [...this.ledgerRows.values()].map((r) => ({ ...r }));
    }
    restoreLedger(rows) {
      for (const r of rows) if (r?.key) this.ledgerRows.set(r.key, { ...r });
    }
    resetLedger() {
      this.ledgerRows.clear();
      for (const p of this.state.players) this.reconcile(p);
    }
    ledger() {
      for (const p of this.state.players) {
        const row = this.ledgerRows.get(p.key);
        if (row) row.stack = p.stack + p.committedHand;
      }
      return [...this.ledgerRows.values()].map(({ expected: _e, ...r }) => ({ ...r, net: r.cashOuts + r.stack - r.buyIns }));
    }
    // ---------- packet entry point ----------
    handle(p) {
      if (p.dir === "out") {
        if (p.ack !== void 0 && p.event) this.pendingAcks.set(p.ack, p.event);
        if (p.event === "player:game:perform_action") this.setHero(p.args?.[0]?.playerPos);
        if (p.event === "room:join") this.roomId = p.args?.[0]?.roomId ?? this.roomId;
        return;
      }
      if (p.dir !== "in") return;
      if (p.sio === "ACK" && p.ack !== void 0) {
        const ev = this.pendingAcks.get(p.ack);
        this.pendingAcks.delete(p.ack);
        if (ev) this.onAck(ev, p.data ?? []);
        return;
      }
      if (!p.event) return;
      this.onEvent(p.event, p.args?.[0] ?? {});
    }
    onAck(event, data) {
      if (event === "player:room:get_game_state") {
        const gm = data[0]?.gmState;
        if (!gm) return;
        this.applyBlinds(gm.gameSettings?.small_blind, gm.gameSettings?.big_blind);
        if (Array.isArray(gm.players)) this.syncPlayers(gm.players);
      } else if (event === "player:room:get_this_player_full_cards_data") {
        const info = data.find((d) => d && typeof d === "object");
        if (!info) return;
        this.setHero(info.playerPos);
        for (const cd of info.playerCardsData ?? []) {
          const c = this.siteCard(cd?.cardData ?? cd);
          if (c !== void 0 && !this.state.heroCards.includes(c)) this.state.heroCards.push(c);
        }
        for (const cd of info.communityCardsData ?? []) {
          const c = this.siteCard(cd?.cardData ?? cd);
          if (c !== void 0 && !this.state.board.includes(c)) this.state.board.push(c);
        }
      }
    }
    siteCard(cd) {
      if (!cd?.suite || cd.value === void 0) return void 0;
      try {
        return parseSiteCard(String(cd.suite), String(cd.value));
      } catch {
        return void 0;
      }
    }
    setHero(seat) {
      if (typeof seat !== "string" || !seat) return;
      this.state.heroSeat = seat;
      this.state.heroKey = this.playerBySeat(seat)?.key ?? this.state.heroKey;
    }
    applyBlinds(sb, bb) {
      if (typeof sb === "number" && sb > 0) this.state.sb = sb;
      if (typeof bb === "number" && bb > 0) this.state.bb = bb;
    }
    onEvent(ev, a) {
      const s = this.state;
      switch (ev) {
        case "room:player_username_updated":
          this.learn(a?.username, a?.userId);
          break;
        case "room:get":
          for (const u of Object.values(a?.data?.players ?? {})) this.learn(u.username, u.userId);
          break;
        case "admin:room:settings_updated": {
          const b = a?.settings?.blind_sizes?.[0];
          if (b && !s.handActive) this.applyBlinds(b.sb, b.bb);
          break;
        }
        case "admin:game:new_hand_started":
          this.applyBlinds(a?.gameSettings?.small_blind, a?.gameSettings?.big_blind);
          break;
        case "room:lobby_stats_updated":
          if (Array.isArray(a?.playerStates)) this.syncPlayers(a.playerStates);
          break;
        case "player:game:player_play_state_changed": {
          const p = this.playerByKey(a.userId);
          if (validUid(a.userId)) this.playState.set(a.userId, a.newPlayState);
          if (p && a.newPlayState === "folded") p.folded = true;
          break;
        }
        case "admin:room:seat_request_approved": {
          const name = this.uidToName.get(a.userId) ?? String(a.userId);
          const key = this.keyFor(name, a.userId);
          const existing = this.playerBySeat(a.seatPos);
          if (existing && existing.key !== key) s.players.splice(s.players.indexOf(existing), 1);
          const p = existing?.key === key ? existing : this.newPlayer(key, name, -1, a.seatPos, a.stack);
          if (!s.players.includes(p)) s.players.push(p);
          p.stack = a.stack;
          this.reconcile(p);
          break;
        }
        case "player:game:was_unseated": {
          const p = this.playerByKey(a.userId);
          if (p) {
            this.ledgerRow(p.key, p.name).expected = p.stack;
            s.players.splice(s.players.indexOf(p), 1);
          }
          break;
        }
        case "admin:room:player_edited":
          this.stackEdited(a.userId, a.stack);
          break;
        case "admin:game:game_paused":
          s.paused = true;
          break;
        case "admin:game:game_unpaused":
          s.paused = false;
          break;
        case "game:stage_began":
          this.stageBegan(a.stageType);
          break;
        case "game:dealer_updated":
          s.buttonSeat = a.dealerSeatPos;
          s.sbSeat = a.smallBlindSeatPos;
          s.bbSeat = a.bigBlindSeatPos;
          this.assignPositions();
          break;
        case "game:small_blind_paid":
        case "game:big_blind_paid": {
          const p = this.playerById(a.playerId);
          if (!p) break;
          this.commit(p, a.amount, "post", false);
          const isBig = ev === "game:big_blind_paid";
          if (p.stack > 0) this.applyBlinds(isBig ? void 0 : a.amount, isBig ? a.amount : void 0);
          if (isBig) {
            s.currentBet = Math.max(s.currentBet, p.committedStreet);
            s.lastRaiseSize = Math.max(s.bb, a.amount);
          } else s.currentBet = Math.max(s.currentBet, p.committedStreet);
          break;
        }
        case "game:cards_dealt_to_player":
          for (const d of Array.isArray(a) ? a : []) {
            this.cardSeat.set(d.cardData?.uniqueID, d.playerPos);
            const p = this.playerBySeat(d.playerPos);
            if (p) p.inHand = true;
          }
          break;
        case "game:update_card_data":
          this.cardRevealed(a.cardData);
          break;
        case "game:cards_deal_to_stack":
          for (const d of Array.isArray(a) ? a : []) {
            if (d?.emitData?.stackID !== "community_stack") continue;
            const cd = d.emitData.cardData;
            if (this.boardIds.has(cd?.uniqueID)) continue;
            const c = this.siteCard(cd);
            if (c === void 0) continue;
            this.boardIds.add(cd.uniqueID);
            if (!s.board.includes(c)) s.board.push(c);
          }
          break;
        case "game:player_turn_started":
          s.toActSeat = a.playerPos;
          this.emit("update", s);
          if (s.heroSeat && a.playerPos === s.heroSeat) this.emit("heroTurn", s);
          return;
        case "game:player_turn_ended":
          s.toActSeat = void 0;
          break;
        case "player:game:action_taken":
          this.actionTaken(a);
          break;
        case "game:game_ended":
          this.handEnded(a);
          return;
        case "chat_message":
          this.chat(a);
          break;
        case "historical_messages":
          for (const m of Array.isArray(a) ? a : []) {
            this.learn(m?.username, m?.userId);
            this.learn(m?.log?.nick, m?.log?.pid);
          }
          break;
      }
      this.emit("update", s);
    }
    chat(m) {
      this.learn(m?.username, m?.userId);
      const log = m?.log;
      if (m?.msgType !== "game_log" || !log) return;
      this.learn(log.nick, log.pid);
      switch (log.e) {
        case "pss":
          this.stackEdited(log.pid, log.amt);
          break;
        case "shc": {
          const p = this.playerByKey(this.keyFor(log.nick ?? "", log.pid));
          if (p && Array.isArray(log.cds) && p.cards.length < 2) {
            for (const t of log.cds) {
              const c = parseCard(String(t));
              if (!p.cards.includes(c)) p.cards.push(c);
            }
            this.maybeLateShow(p);
          }
          break;
        }
        case "hei":
          this.serverPot = log.tp;
          break;
        case "w":
          if (typeof log.hnd === "string") this.descriptions[this.keyFor(log.nick ?? "", log.pid)] = log.hnd;
          break;
        case "sc":
          try {
            const nv = typeof log.new === "string" ? JSON.parse(log.new) : log.new;
            if (!this.state.handActive && nv?.[0]) this.applyBlinds(nv[0].sb, nv[0].bb);
          } catch {
          }
          break;
        case "df":
        case "dt":
        case "dr":
          if (this.state.handActive && Array.isArray(log.cds)) {
            const expected = log.e === "df" ? 3 : log.e === "dt" ? 4 : 5;
            if (this.state.board.length < expected)
              for (const t of log.cds) {
                const c = parseCard(String(t));
                if (!this.state.board.includes(c)) this.state.board.push(c);
              }
          }
          break;
      }
    }
    stackEdited(uid, amount) {
      if (!validUid(uid) || typeof amount !== "number") return;
      const p = this.playerByKey(uid);
      if (!p) return;
      const diff = amount - p.stack;
      if (diff === 0) return;
      const row = this.ledgerRow(p.key, p.name);
      this.adjust(row, diff);
      p.stack = amount;
      row.expected = p.stack + p.committedHand;
      if (p.stack > 0) p.allIn = false;
    }
    newPlayer(key, name, id, seat, stack) {
      return {
        key,
        userId: validUid(key) && !key.startsWith("name:") ? key : void 0,
        name,
        id,
        seat,
        stack,
        startStack: stack,
        committedStreet: 0,
        committedHand: 0,
        inHand: false,
        folded: false,
        allIn: false,
        cards: []
      };
    }
    /** Authoritative list of seated players (from lobby stats or a game-state snapshot). */
    syncPlayers(list) {
      const s = this.state;
      if (!s.handActive && list.some((ps) => (ps?.totalBetsMade ?? 0) > 0)) this.joinedMidHand = true;
      const seen = /* @__PURE__ */ new Set();
      for (const ps of list) {
        if (!ps?.posType || typeof ps.name !== "string") continue;
        const key = this.keyFor(ps.name, ps.authUserId);
        seen.add(ps.posType);
        let p = this.playerBySeat(ps.posType);
        if (p && p.key !== key) {
          s.players.splice(s.players.indexOf(p), 1);
          p = void 0;
        }
        if (!p) {
          p = this.newPlayer(key, ps.name, ps.id, ps.posType, ps.stack);
          s.players.push(p);
        }
        p.id = ps.id;
        p.name = ps.name;
        if (s.handActive && typeof ps.totalBetsMade === "number") {
          const diff = ps.stack + ps.totalBetsMade - (p.stack + p.committedHand);
          if (diff !== 0) {
            const row = this.ledgerRow(p.key, p.name);
            this.adjust(row, diff);
            row.expected = (row.expected ?? 0) + diff;
          }
          p.committedHand = ps.totalBetsMade;
        }
        p.stack = ps.stack;
        if (ps.playState) this.playState.set(key, ps.playState);
        if (ps.revealedCardsToAll && Array.isArray(ps.cards) && p.cards.length < 2) {
          for (const cd of ps.cards) {
            const c = this.siteCard(cd?.cardData ?? cd);
            if (c !== void 0 && !p.cards.includes(c)) p.cards.push(c);
          }
          this.maybeLateShow(p);
        }
        if (!s.handActive) {
          p.committedHand = 0;
          p.committedStreet = 0;
          p.startStack = p.stack;
          if (!this.joinedMidHand) this.reconcile(p);
        }
      }
      for (const p of [...s.players]) if (!seen.has(p.seat)) s.players.splice(s.players.indexOf(p), 1);
      s.players.sort((x, y) => seatNumber(x.seat) - seatNumber(y.seat));
      if (s.heroSeat) s.heroKey = this.playerBySeat(s.heroSeat)?.key ?? s.heroKey;
      this.recomputePot();
    }
    // ---------- hand flow ----------
    stageBegan(stageType) {
      const s = this.state;
      if (stageType === "set_blinds") return this.startHand();
      if (!s.handActive) this.joinedMidHand = true;
      const street = STREET_OF_STAGE[stageType];
      if (!street) return;
      if (street !== "preflop" && street !== "showdown") {
        for (const p of s.players) p.committedStreet = 0;
        s.currentBet = 0;
        s.lastRaiseSize = s.bb;
      }
      s.street = street;
      s.toActSeat = void 0;
    }
    startHand() {
      const s = this.state;
      if (this.joinedMidHand) {
        this.joinedMidHand = false;
        for (const p of s.players) this.reconcile(p);
      }
      s.handNumber++;
      s.handActive = true;
      s.street = "preflop";
      s.board = [];
      s.heroCards = [];
      s.actions = [];
      s.currentBet = 0;
      s.lastRaiseSize = s.bb;
      s.toActSeat = void 0;
      s.lastResult = void 0;
      this.descriptions = {};
      this.serverPot = void 0;
      this.cardSeat.clear();
      this.seenCardIds.clear();
      this.boardIds.clear();
      this.heroCardIds.clear();
      for (const p of s.players) {
        p.startStack = p.stack;
        p.committedHand = 0;
        p.committedStreet = 0;
        p.folded = false;
        p.allIn = false;
        p.cards = [];
        const ps = this.playState.get(p.key);
        p.inHand = p.stack > 0 && (ps === void 0 || ps === "playing");
      }
      this.recomputePot();
    }
    assignPositions() {
      const s = this.state;
      const live = s.players.filter((p) => p.inHand || p.seat === s.sbSeat || p.seat === s.bbSeat || p.seat === s.buttonSeat);
      for (const p of s.players) p.position = void 0;
      if (!s.buttonSeat || live.length < 2) return;
      const sorted = live.slice().sort((a, b) => seatNumber(a.seat) - seatNumber(b.seat));
      const btn = sorted.findIndex((p) => p.seat === s.buttonSeat);
      if (btn < 0) return;
      const order = [...sorted.slice(btn + 1), ...sorted.slice(0, btn + 1)];
      if (order.length === 2) {
        const btnP = order[1];
        btnP.position = "SB";
        order[0].position = "BB";
        return;
      }
      const labels = ["SB", "BB"];
      const middle = order.length - 3;
      const mids = middle <= 0 ? [] : middle === 1 ? ["UTG"] : middle === 2 ? ["UTG", "CO"] : ["UTG", ...Array(middle - 2).fill("MP"), "CO"];
      labels.push(...mids, "BTN");
      order.forEach((p, i) => p.position = labels[i]);
    }
    commit(p, amount, type, auto) {
      const s = this.state;
      const facing = s.currentBet;
      const potBefore = s.pot;
      const raisesBefore = s.actions.filter((a) => a.street === s.street && (a.type === "bet" || a.type === "raise")).length;
      const added = Math.max(0, Math.min(amount, p.stack));
      p.stack -= added;
      p.committedStreet += added;
      p.committedHand += added;
      if (p.stack === 0 && added > 0) p.allIn = true;
      const action = {
        key: p.key,
        seat: p.seat,
        street: s.street === "idle" ? "preflop" : s.street,
        type,
        added,
        toTotal: p.committedStreet,
        facing,
        potBefore,
        allIn: p.allIn && added > 0,
        raisesBefore,
        auto
      };
      s.actions.push(action);
      this.recomputePot();
      return action;
    }
    actionTaken(a) {
      const s = this.state;
      const p = this.playerBySeat(a.playerPos) ?? this.playerById(a.playerID);
      if (!p) return;
      const raw = String(a.actionType);
      const amount = Number(a.makeBetValue) || 0;
      const facing = s.currentBet;
      let type;
      if (raw === "fold") type = "fold";
      else if (raw === "check") type = "check";
      else if (raw === "call") type = "call";
      else {
        const toTotal = p.committedStreet + amount;
        type = toTotal <= facing ? "call" : facing === 0 ? "bet" : "raise";
      }
      const action = this.commit(p, type === "fold" || type === "check" ? 0 : amount, type, Boolean(a.wasServerAutoAction));
      if (type === "fold") p.folded = true;
      if (type === "bet" || type === "raise") {
        const raiseSize = action.toTotal - facing;
        if (raiseSize >= s.lastRaiseSize) s.lastRaiseSize = raiseSize;
        s.currentBet = Math.max(s.currentBet, action.toTotal);
      }
    }
    cardRevealed(cd) {
      const s = this.state;
      const uid = cd?.uniqueID;
      const seat = this.cardSeat.get(uid);
      const card = this.siteCard(cd);
      if (!seat || card === void 0) return;
      const p = this.playerBySeat(seat);
      if (s.handActive && s.street !== "showdown") {
        if (!s.heroSeat) this.setHero(seat);
        if (seat === s.heroSeat && !this.heroCardIds.has(uid)) {
          this.heroCardIds.add(uid);
          s.heroCards.push(card);
        }
      }
      if (p && !this.seenCardIds.has(uid)) {
        this.seenCardIds.add(uid);
        p.cards.push(card);
        this.maybeLateShow(p);
      }
    }
    /** A player chose to show their hand after it ended (e.g. after folding or winning uncontested). */
    maybeLateShow(p) {
      const h = this.lastHistory;
      if (this.state.handActive || !h?.result || p.seat === this.state.heroSeat || p.cards.length !== 2) return;
      if (h.result.shown[p.key]) return;
      h.result.shown[p.key] = p.cards.slice();
      this.emit("handShown", { history: h, key: p.key });
    }
    handEnded(a) {
      const s = this.state;
      if (!s.handActive) {
        this.joinedMidHand = true;
        s.street = "idle";
        s.toActSeat = void 0;
        this.emit("update", s);
        return;
      }
      const res = a?.endPopupData?.gameResults;
      const result = { won: {}, refunded: {}, pot: 0, shown: {}, descriptions: this.descriptions };
      for (const [uid, info] of Object.entries(res?.winnersInfo ?? {})) {
        const p = this.playerBySeat(info?.playerData?.posType) ?? this.playerByKey(uid);
        if (!p) continue;
        this.learn(p.name, uid);
        const won = Number(info.wonAmount) || 0;
        const refund = Number(info.refundUncalledBetsAmount) || 0;
        result.won[p.key] = (result.won[p.key] ?? 0) + won;
        result.refunded[p.key] = (result.refunded[p.key] ?? 0) + refund;
        p.stack += won + refund;
      }
      let committed = 0;
      for (const p of s.players) {
        committed += p.committedHand;
        if (p.inHand && p.cards.length === 2 && p.seat !== s.heroSeat) result.shown[p.key] = p.cards.slice();
      }
      const refunds = Object.values(result.refunded).reduce((x, y) => x + y, 0);
      result.pot = committed - refunds;
      if (this.serverPot !== void 0) result.serverPot = this.serverPot;
      s.lastResult = result;
      const history = {
        handNumber: s.handNumber,
        sb: s.sb,
        bb: s.bb,
        heroKey: s.heroSeat ? this.playerBySeat(s.heroSeat)?.key : void 0,
        heroCards: s.heroCards.slice(),
        board: s.board.slice(),
        players: s.players.filter((p) => p.committedHand > 0 || p.inHand).map(({ key, name, seat, startStack, position }) => ({ key, name, seat, startStack, position })),
        actions: s.actions.slice(),
        result
      };
      for (const p of s.players) {
        p.committedHand = 0;
        p.committedStreet = 0;
        const row = this.ledgerRow(p.key, p.name);
        row.expected = p.stack;
        row.stack = p.stack;
      }
      s.handActive = false;
      s.street = "idle";
      s.toActSeat = void 0;
      s.currentBet = 0;
      this.recomputePot();
      this.lastHistory = history;
      this.emit("handComplete", history);
      this.emit("update", s);
    }
    recomputePot() {
      this.state.pot = this.state.players.reduce((x, p) => x + p.committedHand, 0);
    }
  };

  // src/extension/content.ts
  var MODEL_KEY = "pb:model";
  var SETTINGS_KEY = "pb:settings";
  var LEDGER_PREFIX = "pb:ledger:";
  var LEDGER_MAX_AGE_MS = 16 * 3600 * 1e3;
  var CAPTURE_LIMIT = 2e4;
  var tracker = new Tracker();
  var model = new OpponentModel();
  var capture = [];
  var started = Date.now();
  var ledgerRestored = false;
  var useReads = true;
  var careful = false;
  var CAREFUL_TOLERANCE = 2e3;
  var overlay = new Overlay({
    resetLedger() {
      tracker.resetLedger();
      saveLedger();
      render();
    },
    saveCapture() {
      const redact = (k, v) => /token|^auth$|authorization|pass|secret|cookie|session|jwt|email|^sid$/i.test(k) ? "[redacted]" : v;
      const blob = new Blob([JSON.stringify({ recorder: "extension", startedAt: new Date(started).toISOString(), entries: capture }, redact, 1)], {
        type: "application/json"
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `pokerpatio-capture-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1e3);
    },
    setUseReads(on) {
      useReads = on;
      overlay.setUseReads(on);
      storage?.set({ [SETTINGS_KEY]: { useReads, careful } });
      recomputeAdvice();
    },
    setCareful(on) {
      careful = on;
      overlay.setCareful(on);
      storage?.set({ [SETTINGS_KEY]: { useReads, careful } });
      recomputeAdvice();
    },
    createPerson(label) {
      const key = model.createPerson(label);
      peopleChanged();
      return key;
    },
    assign(nameKey, personKey) {
      model.merge(nameKey, personKey);
      peopleChanged();
    },
    removeName(personKey, name) {
      model.removeName(personKey, name);
      peopleChanged();
    },
    renamePerson(personKey, label) {
      model.setLabel(personKey, label);
      peopleChanged();
    },
    forget(key) {
      model.forget(key);
      peopleChanged();
    },
    exportData() {
      const data = { app: "poker-bot", version: 1, savedAt: (/* @__PURE__ */ new Date()).toISOString(), model: model.toJSON(), settings: { useReads, careful } };
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
      a.download = `poker-bot-backup-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1e3);
    },
    importData(json) {
      try {
        const data = JSON.parse(json);
        if (data?.app !== "poker-bot" || !data.model) throw new Error("not a Poker Bot backup");
        model = OpponentModel.fromJSON(data.model);
        peopleChanged();
        alert("Backup restored.");
      } catch (e) {
        alert(`Couldn't restore: ${e.message}`);
      }
    },
    forgetEveryone() {
      model = new OpponentModel();
      peopleChanged();
    }
  });
  var storage = typeof chrome !== "undefined" ? chrome.storage?.local : void 0;
  storage?.get([MODEL_KEY, SETTINGS_KEY]).then((v) => {
    if (v[MODEL_KEY]) model = OpponentModel.fromJSON(v[MODEL_KEY]);
    const settings = v[SETTINGS_KEY];
    if (settings?.useReads === false) {
      useReads = false;
      overlay.setUseReads(false);
    }
    if (settings?.careful) {
      careful = true;
      overlay.setCareful(true);
    }
    render();
  });
  function peopleChanged() {
    saveModel();
    recomputeAdvice();
    render();
  }
  var saveTimer;
  function saveModel() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => storage?.set({ [MODEL_KEY]: model.toJSON() }), 1e3);
  }
  function saveLedger() {
    if (!tracker.roomId) return;
    storage?.set({ [LEDGER_PREFIX + tracker.roomId]: { savedAt: Date.now(), rows: tracker.exportLedger() } });
  }
  async function restoreLedger() {
    if (ledgerRestored || !tracker.roomId || !storage) return;
    ledgerRestored = true;
    const key = LEDGER_PREFIX + tracker.roomId;
    const v = await storage.get(key);
    const saved = v[key];
    if (saved && Date.now() - saved.savedAt < LEDGER_MAX_AGE_MS) tracker.restoreLedger(saved.rows);
  }
  var renderQueued = false;
  function render() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      overlay.render(tracker.state, model, tracker.ledger());
    });
  }
  var adviceToken = 0;
  function recomputeAdvice() {
    const s = tracker.state;
    if (!s.heroSeat || s.toActSeat !== s.heroSeat) return;
    const token = ++adviceToken;
    overlay.setAdvice(null);
    overlay.setThinking(true);
    render();
    setTimeout(() => {
      if (token !== adviceToken) return;
      try {
        overlay.setAdvice(advise(tracker.state, model, { useReads, riskTolerance: careful ? CAREFUL_TOLERANCE : void 0 }));
      } catch (e) {
        console.warn("[poker-bot] advice failed", e);
      }
      overlay.setThinking(false);
      render();
    }, 30);
  }
  tracker.on("heroTurn", recomputeAdvice);
  tracker.on("handComplete", (h) => {
    model.update(h);
    if (h.heroKey) model.markMe(h.heroKey, h.players.find((p) => p.key === h.heroKey)?.name);
    saveModel();
    saveLedger();
  });
  tracker.on("handShown", ({ history, key }) => {
    model.learnShown(history, key);
    saveModel();
  });
  tracker.on("update", () => render());
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "pokerbot-page") return;
    const packet = e.data.packet;
    if (capture.length < CAPTURE_LIMIT) capture.push({ ...packet, t: Date.now() - started });
    const hadRoom = tracker.roomId;
    tracker.handle(packet);
    if (!hadRoom && tracker.roomId) void restoreLedger().then(render);
    if (packet.event === "player:game:action_taken" || packet.event === "game:player_turn_ended") adviceToken++;
  });
})();
