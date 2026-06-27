'use strict';

/* ============================================================
 *  1.  CONSTANTS & CONFIGURATION
 * ============================================================ */
const RANKS   = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const SUITS   = ['♦','♣','♥','♠'];
const RANK_VAL = {};
RANKS.forEach((r, i) => RANK_VAL[r] = i);          // 3→0 … 2→12
const JOKER_BLACK_VAL = 13;
const JOKER_RED_VAL   = 14;

const SUIT_COLOR = { '♥':'red','♦':'red','♠':'black','♣':'black' };

const BOT_AVATARS = ['🤖','🧠','🎯','👾','🦊','🐱','🐼'];

/* Helper: hex color to rgba string */
function hexToRGBA(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}


/* ============================================================
 *  2.  CARD MODEL & DECK
 * ============================================================ */
let _nextId = 0;

function mkCard(rank, suit, jokerColor) {
  const isJoker = !!jokerColor;
  return {
    id   : _nextId++,
    rank, suit, isJoker, jokerColor,
    value: isJoker
      ? (jokerColor === 'red' ? JOKER_RED_VAL : JOKER_BLACK_VAL)
      : RANK_VAL[rank],
    color: isJoker
      ? (jokerColor === 'red' ? 'red' : 'black')
      : SUIT_COLOR[suit]
  };
}

function createDeck(numDecks) {
  const d = [];
  for (let n = 0; n < numDecks; n++) {
    for (const s of SUITS)
      for (const r of RANKS)
        d.push(mkCard(r, s, null));
    // 4 jokers per deck: 2 black, 2 red
    d.push(mkCard(null, null, 'black'));
    d.push(mkCard(null, null, 'black'));
    d.push(mkCard(null, null, 'red'));
    d.push(mkCard(null, null, 'red'));
  }
  return d;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function sortHand(h) {
  const so = { '♦':0,'♣':1,'♥':2,'♠':3 };
  h.sort((a, b) => {
    if (a.value !== b.value) return a.value - b.value;
    if (a.isJoker && b.isJoker)
      return (a.jokerColor === 'black' ? 0 : 1) - (b.jokerColor === 'black' ? 0 : 1);
    return (so[a.suit] || 0) - (so[b.suit] || 0);
  });
}

/* ============================================================
 *  3.  PATTERN DETECTION
 * ============================================================ */
function detectPattern(cards) {
  if (!cards || cards.length === 0) return null;
  const n = cards.length;
  const sorted = [...cards].sort((a, b) => a.value - b.value);

  /* ---- Joker Bombs (exactly 4 jokers of one color) ---- */
  if (n === 4) {
    if (cards.every(c => c.isJoker && c.jokerColor === 'red'))
      return { type:'RED_JOKER_BOMB', cards: sorted };
    if (cards.every(c => c.isJoker && c.jokerColor === 'black'))
      return { type:'BLACK_JOKER_BOMB', cards: sorted };
  }

  /* ---- Regular Bomb (4 of same rank, including jokers if not caught above) ---- */
  if (n === 4 && cards.every(c => c.value === cards[0].value))
    return { type:'BOMB', value: cards[0].value, cards: sorted };

  /* ---- Single ---- */
  if (n === 1)
    return { type:'SINGLE', value: cards[0].value, isJoker: cards[0].isJoker,
             jokerColor: cards[0].jokerColor, cards: sorted };

  /* ---- Double ---- */
  if (n === 2 && cards[0].value === cards[1].value)
    return { type:'DOUBLE', value: cards[0].value, cards: sorted };

  /* ---- Double Triple ---- */
  if (n === 6) {
    const vals = sorted.map(c => c.value);
    const unique = [...new Set(vals)];
    if (unique.length === 2) {
      const count1 = vals.filter(v => v === unique[0]).length;
      const count2 = vals.filter(v => v === unique[1]).length;
      if (count1 === 3 && count2 === 3) {
         const highValue = Math.max(unique[0], unique[1]);
         return { type: 'DOUBLE_TRIPLE', highValue, cards: sorted };
      }
    }
  }

  /* ---- Double Straight ---- */
  if (n >= 10 && n % 2 === 0) {
    const vals = sorted.map(c => c.value);
    let isPairs = true;
    const pairs = [];
    for(let i=0; i<n; i+=2) {
      if (vals[i] !== vals[i+1]) { isPairs = false; break; }
      pairs.push(vals[i]);
    }
    if (isPairs) {
      let isConsecutive = true;
      for (let i = 1; i < pairs.length; i++) {
        if (pairs[i] !== pairs[i-1] + 1) { isConsecutive = false; break; }
      }
      if (isConsecutive) {
        return { type: 'DOUBLE_STRAIGHT', length: n, highValue: pairs[pairs.length - 1], cards: sorted };
      }
    }
  }

  /* ---- Kawal (Full House 3+2) ---- */
  if (n === 5) {
    const cnt = {};
    cards.forEach(c => cnt[c.value] = (cnt[c.value] || 0) + 1);
    const entries = Object.entries(cnt);
    if (entries.length === 2) {
      const tri  = entries.find(([, c]) => c === 3);
      const pair = entries.find(([, c]) => c === 2);
      if (tri && pair)
        return { type:'KAWAL', tripleValue: +tri[0], pairValue: +pair[0], cards: sorted };
    }
  }

  /* ---- Straight (≥5 consecutive) ---- */
  if (n >= 5) {
    const vals = sorted.map(c => c.value);
    const unique = [...new Set(vals)].sort((a, b) => a - b);
    if (unique.length === n) {
      let ok = true;
      for (let i = 1; i < unique.length; i++)
        if (unique[i] !== unique[i - 1] + 1) { ok = false; break; }
      if (ok)
        return { type:'STRAIGHT', length: n,
                 highValue: unique[unique.length - 1], lowValue: unique[0], cards: sorted };
    }
  }

  return null;                                     // invalid combination
}

/* ============================================================
 *  4.  PATTERN COMPARISON   ( canBeat )
 * ============================================================ */
function canBeat(np, ep) {
  if (!np || !ep) return false;

  // Red Joker Bomb — absolute king
  if (np.type === 'RED_JOKER_BOMB') return true;
  if (ep.type === 'RED_JOKER_BOMB') return false;

  // Black Joker Bomb beaten only by RJB (handled above)
  if (ep.type === 'BLACK_JOKER_BOMB') return false;

  // Existing is a regular BOMB → need higher bomb / BJB / RJB
  if (ep.type === 'BOMB') {
    if (np.type === 'BOMB')             return np.value > ep.value;
    if (np.type === 'BLACK_JOKER_BOMB') return true;
    return false;                                  // RJB already handled
  }

  // A BOMB can beat a NON-BOMB pattern ONLY IF the non-bomb pattern is a Single Joker or a Double Joker
  if (ep.type !== 'BOMB' && ep.type !== 'BLACK_JOKER_BOMB' && ep.type !== 'RED_JOKER_BOMB') {
    if (np.type === 'BOMB' || np.type === 'BLACK_JOKER_BOMB' || np.type === 'RED_JOKER_BOMB') {
      const isSingleJoker = ep.type === 'SINGLE' && ep.value >= 13;
      const isDoubleJoker = ep.type === 'DOUBLE' && ep.value >= 13;
      if (isSingleJoker || isDoubleJoker) return true;
      return false;
    }
  }

  // Normal pattern — must match type
  if (np.type !== ep.type) return false;
  switch (np.type) {
    case 'SINGLE':   return np.value > ep.value;
    case 'DOUBLE':   return np.value > ep.value;
    case 'DOUBLE_TRIPLE': return np.highValue > ep.highValue;
    case 'DOUBLE_STRAIGHT': return np.length === ep.length && np.highValue > ep.highValue;
    case 'STRAIGHT': return np.length === ep.length && np.highValue > ep.highValue;
    case 'KAWAL':    return np.tripleValue > ep.tripleValue || (np.tripleValue === ep.tripleValue && np.pairValue > ep.pairValue);
    default:         return false;
  }
}

/* ============================================================
 *  5.  GAME STATE
 * ============================================================ */
const G = {
  players        : [],     // { name, hand[], isHuman, avatar, profile, peerId }
  numPlayers     : 4,
  numDecks       : 1,
  currentIdx     : 0,      // whose turn
  roundLeaderIdx : 0,      // who played last valid pattern
  currentPattern : null,   // pattern on the table
  tableCards     : [],     // cards currently on the table
  passedPlayers  : null,   // Set<int>
  roundNum       : 1,
  gameOver       : false,
  winner         : -1,
  selectedIds    : null,   // Set<int> (human card selection)
  logs           : [],     // string[]
  busy           : false,  // prevents double-clicks while AI plays
  difficulty     : 'normal', // easy | normal | hard
  isFirstGame    : true,
  previousWinnerIdx : 0,
  myIndex        : 0,      // multiplayer: this player's index
};

let aiTimeoutId = null;

/* ---------- Init ---------- */
function initGame() {
  _nextId = 0;
  G.gameOver    = false;
  G.winners     = [];
  G.roundNum    = 1;
  G.currentPattern = null;
  G.tableCards  = [];
  G.passedPlayers = new Set();
  G.selectedIds   = new Set();
  G.logs          = [];
  G.busy          = false;
  G.roundTransition = false;
  
  if (aiTimeoutId) {
    clearTimeout(aiTimeoutId);
    aiTimeoutId = null;
  }

  // Create players
  G.players = [];
  const profile = (typeof ProfileMgr !== 'undefined') ? ProfileMgr.get() : null;
  for (let i = 0; i < G.numPlayers; i++) {
    G.players.push({
      name   : i === 0 ? (profile ? profile.name : 'Kamu') : `Bot ${i}`,
      hand   : [],
      isHuman: i === 0,
      avatar : i === 0 ? (profile ? profile.symbol : '🙂') : BOT_AVATARS[(i - 1) % BOT_AVATARS.length],
      profile: i === 0 ? profile : null,
      peerId : null,
      handCount: 0
    });
  }

  // Deck, shuffle, deal
  const deck = createDeck(G.numDecks);
  shuffle(deck);
  const perPlayer = Math.floor(deck.length / G.numPlayers);
  for (let i = 0; i < G.numPlayers; i++) {
    G.players[i].hand = deck.slice(i * perPlayer, (i + 1) * perPlayer);
    sortHand(G.players[i].hand);
  }

  // First player determined later by 3-dump (first game) or previous winner (next game)
  G.currentIdx      = 0;
  G.roundLeaderIdx  = 0;

  if (G.isFirstGame) {
    addLog('Game baru! Semua pemain mengeluarkan kartu 3...');
  } else {
    addLog(`Game baru! ${G.players[G.previousWinnerIdx].name} jalan duluan (Juara 1 sebelumnya).`);
    G.currentIdx = G.previousWinnerIdx;
    G.roundLeaderIdx = G.previousWinnerIdx;
  }
}

/* ---------- 3-Dump: opening showdown ---------- */
const SUIT_RANK_3 = { '♠':3, '♥':2, '♣':1, '♦':0 };

async function performThreeDump() {
  // Collect all 3s from each player
  const playerThrees = [];
  let allThrees = [];
  
  for (let i = 0; i < G.numPlayers; i++) {
    const threes = G.players[i].hand.filter(c => !c.isJoker && c.rank === '3');
    playerThrees.push(threes);
    allThrees = allThrees.concat(threes);
  }
  
  // If nobody has any 3s (very unlikely), just pick player 0
  if (allThrees.length === 0) {
    G.currentIdx = 0;
    G.roundLeaderIdx = 0;
    addLog('Tidak ada kartu 3! Kamu bermain pertama.');
    renderGame();
    return;
  }
  
  // Show the 3s on the table
  G.tableCards = allThrees;
  
  // Build label showing who has how many
  const summaries = [];
  for (let i = 0; i < G.numPlayers; i++) {
    if (playerThrees[i].length > 0) {
      const suits = playerThrees[i].map(c => c.suit).join('');
      summaries.push(`${G.players[i].name}: ${playerThrees[i].length}× (${suits})`);
    }
  }
  
  // Determine winner
  let startIdx = 0;
  let bestCount = 0;
  let bestMaxSuit = -1;
  for (let i = 0; i < G.numPlayers; i++) {
    const count = playerThrees[i].length;
    const maxSuit = playerThrees[i].reduce((mx, c) => Math.max(mx, SUIT_RANK_3[c.suit] || 0), -1);
    if (count > bestCount || (count === bestCount && maxSuit > bestMaxSuit)) {
      bestCount = count;
      bestMaxSuit = maxSuit;
      startIdx = i;
    }
  }
  
  // Remove all 3s from all hands
  for (let i = 0; i < G.numPlayers; i++) {
    const threeIds = new Set(playerThrees[i].map(c => c.id));
    G.players[i].hand = G.players[i].hand.filter(c => !threeIds.has(c.id));
  }
  
  // Update display
  $('table-label').textContent = 'Pembukaan: Semua kartu 3 dibuang!';
  $('table-pattern').textContent = summaries.join(' | ');
  $('game-status').textContent = `${G.players[startIdx].name} menang pembukaan!`;
  
  renderOpponents();
  renderPlayerHand();
  
  // Animate the 3s onto the table
  const cardsEl = $('table-cards');
  cardsEl.innerHTML = '';
  const sorted = [...allThrees].sort((a, b) => a.value - b.value || (SUIT_RANK_3[a.suit]||0) - (SUIT_RANK_3[b.suit]||0));
  for (const c of sorted) {
    cardsEl.appendChild(renderCardElement(c, false, false));
  }
  
  playSound('play');
  addLog(`Pembukaan kartu 3 — ${G.players[startIdx].name} menang! (${bestCount} kartu 3)`);
  
  if (typeof window.mpThreeDumpHook === 'function') {
    window.mpThreeDumpHook(allThrees, startIdx, summaries.join(' | '));
  }
  
  // Wait so player can see the showdown
  await _delay(2500);
  
  // Clear the table and start the real game
  G.tableCards = [];
  G.currentPattern = null;
  G.currentIdx = startIdx;
  G.roundLeaderIdx = startIdx;
  
  addLog(`— Putaran 1: ${G.players[startIdx].name} memulai —`);
  renderGame();
}

/* ============================================================
 *  6.  AI  PLAYER
 * ============================================================ */

/* --- helpers --- */
function groupByValue(cards) {
  const m = new Map();
  for (const c of cards) {
    if (!m.has(c.value)) m.set(c.value, []);
    m.get(c.value).push(c);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

function findStraightsOfLength(hand, len) {
  const elig = hand;
  const byVal = {};
  elig.forEach(c => { if (!byVal[c.value]) byVal[c.value] = []; byVal[c.value].push(c); });
  const vals = Object.keys(byVal).map(Number).sort((a, b) => a - b);
  const res = [];
  for (let s = 0; s <= vals.length - len; s++) {
    let ok = true;
    for (let i = 1; i < len; i++)
      if (vals[s + i] !== vals[s] + i) { ok = false; break; }
    if (ok) {
      const cards = [];
      for (let i = 0; i < len; i++) cards.push(byVal[vals[s + i]][0]);
      res.push(cards);
    }
  }
  return res;
}

function findAllStraights(hand) {
  const elig = hand;
  const byVal = {};
  elig.forEach(c => { if (!byVal[c.value]) byVal[c.value] = []; byVal[c.value].push(c); });
  const vals = Object.keys(byVal).map(Number).sort((a, b) => a - b);
  const res = [];
  // find maximal runs first, then extract 5+ length subsets
  let rs = 0;
  for (let i = 1; i <= vals.length; i++) {
    if (i === vals.length || vals[i] !== vals[i - 1] + 1) {
      const runLen = i - rs;
      if (runLen >= 5) {
        for (let len = 5; len <= runLen; len++) {
          for (let start = rs; start <= rs + runLen - len; start++) {
            const cards = [];
            for (let j = start; j < start + len; j++) cards.push(byVal[vals[j]][0]);
            res.push(cards);
          }
        }
      }
      rs = i;
    }
  }
  return res;
}

function findAllKawals(hand) {
  const groups = groupByValue(hand);
  const triples = groups.filter(([, cs]) => cs.length >= 3);
  const pairs   = groups.filter(([, cs]) => cs.length >= 2);
  const res = [];
  for (const [tv, tc] of triples) {
    for (const [pv, pc] of pairs) {
      if (tv !== pv)
        res.push([...tc.slice(0, 3), ...pc.slice(0, 2)]);
    }
  }
  return res;
}

function findAllDoubleTriples(hand) {
  const groups = groupByValue(hand);
  const triples = groups.filter(([, cs]) => cs.length >= 3);
  const res = [];
  for (let i = 0; i < triples.length; i++) {
    for (let j = i + 1; j < triples.length; j++) {
      res.push([...triples[i][1].slice(0, 3), ...triples[j][1].slice(0, 3)]);
    }
  }
  return res;
}

function findDoubleStraightsOfLength(hand, numPairs) {
  const elig = hand;
  const byVal = {};
  elig.forEach(c => { if (!byVal[c.value]) byVal[c.value] = []; byVal[c.value].push(c); });
  
  const pairVals = Object.keys(byVal).map(Number).filter(v => byVal[v].length >= 2).sort((a,b) => a-b);
  const res = [];
  
  for (let s = 0; s <= pairVals.length - numPairs; s++) {
    let ok = true;
    for (let i = 1; i < numPairs; i++) {
      if (pairVals[s + i] !== pairVals[s] + i) { ok = false; break; }
    }
    if (ok) {
      const cards = [];
      for (let i = 0; i < numPairs; i++) {
        const v = pairVals[s + i];
        cards.push(byVal[v][0], byVal[v][1]);
      }
      res.push(cards);
    }
  }
  return res;
}

function findAllDoubleStraights(hand) {
  const elig = hand;
  const byVal = {};
  elig.forEach(c => { if (!byVal[c.value]) byVal[c.value] = []; byVal[c.value].push(c); });
  
  const vals = Object.keys(byVal).map(Number).filter(v => byVal[v].length >= 2).sort((a,b) => a-b);
  const res = [];
  
  let rs = 0;
  for (let i = 1; i <= vals.length; i++) {
    if (i === vals.length || vals[i] !== vals[i - 1] + 1) {
      const runLen = i - rs;
      if (runLen >= 5) {
        for (let len = 5; len <= runLen; len++) {
          for (let start = rs; start <= rs + runLen - len; start++) {
            const cards = [];
            for (let j = start; j < start + len; j++) {
              cards.push(byVal[vals[j]][0], byVal[vals[j]][1]);
            }
            res.push(cards);
          }
        }
      }
      rs = i;
    }
  }
  return res;
}

/* --- AI: opening play (no current pattern) --- */
function aiOpeningPlay(hand) {
  if (hand.length === 0) return null;

  // If only 1 card, play it
  if (hand.length === 1) return [hand[0]];

  // If 2 cards and they form a valid non-bomb pattern, play them
  if (hand.length === 2) {
    const p = detectPattern(hand);
    if (p && p.type !== 'BOMB' && p.type !== 'BLACK_JOKER_BOMB' && p.type !== 'RED_JOKER_BOMB')
      return [...hand];
  }

  const diff = G.difficulty;
  const groups = groupByValue(hand);

  /* ===== EASY: bot sangat bodoh, selalu main kartu kecil satu-satu ===== */
  if (diff === 'easy') {
    // 90% main kartu terendah satu-satu (buang perlahan)
    if (Math.random() < 0.90) return [hand[0]];
    // 10% coba pair terendah saja
    for (const [, cs] of groups) {
      if (cs.length >= 2 && cs[0].value <= 6) return cs.slice(0, 2);
    }
    return [hand[0]];
  }

  /* ===== HARD: bot super cerdas, habiskan kartu secepat mungkin ===== */
  if (diff === 'hard') {
    // Prioritas: combo terbesar dulu agar kartu cepat habis
    // 1. Double Straight (buang 10+ kartu sekaligus)
    const ds = findAllDoubleStraights(hand);
    if (ds.length > 0) {
      ds.sort((a, b) => b.length - a.length || a[0].value - b[0].value);
      return ds[0];
    }
    // 2. Straight (buang 5+ kartu)
    const ss = findAllStraights(hand);
    if (ss.length > 0) {
      ss.sort((a, b) => b.length - a.length || a[0].value - b[0].value);
      return ss[0];
    }
    // 3. Double Triple (buang 6 kartu)
    const dt = findAllDoubleTriples(hand);
    if (dt.length > 0) {
      dt.sort((a, b) => Math.max(a[0].value, a[3].value) - Math.max(b[0].value, b[3].value));
      return dt[0];
    }
    // 4. Kawal (buang 5 kartu)
    const kw = findAllKawals(hand);
    if (kw.length > 0) {
      kw.sort((a, b) => a.reduce((s, c) => s + c.value, 0) - b.reduce((s, c) => s + c.value, 0));
      return kw[0];
    }
    // 5. Pair paling rendah
    for (const [, cs] of groups) {
      if (cs.length >= 2) return cs.slice(0, 2);
    }
    // 6. Single terendah
    return [hand[0]];
  }

  /* ===== NORMAL: balanced random ===== */
  const r = Math.random();
  if (r < 0.15) {
    const ds = findAllDoubleStraights(hand);
    if (ds.length > 0) { ds.sort((a, b) => a[0].value - b[0].value); return ds[0]; }
  }
  if (r < 0.25) {
    const ss = findAllStraights(hand);
    if (ss.length > 0) { ss.sort((a, b) => a[0].value - b[0].value); return ss[0]; }
  }
  if (r < 0.35) {
    const dt = findAllDoubleTriples(hand);
    if (dt.length > 0) {
      dt.sort((a, b) => Math.max(a[0].value, a[3].value) - Math.max(b[0].value, b[3].value));
      return dt[0];
    }
  }
  if (r < 0.45) {
    const kw = findAllKawals(hand);
    if (kw.length > 0) {
      kw.sort((a, b) => a.reduce((s,c) => s+c.value, 0) - b.reduce((s,c) => s+c.value, 0));
      return kw[0];
    }
  }
  if (r < 0.65) {
    for (const [, cs] of groups) {
      if (cs.length === 2 && cs[0].value <= 9) return cs.slice(0, 2);
    }
  }
  return [hand[0]];
}

/* --- AI: responding to a pattern --- */
function aiResponsePlay(hand, ep) {
  const validPlays = [];

  /* -- SINGLE -- */
  if (ep.type === 'SINGLE') {
    // higher singles
    for (const c of hand) {
      if (c.value > ep.value) validPlays.push([c]);
    }
  }

  /* -- DOUBLE -- */
  else if (ep.type === 'DOUBLE') {
    const groups = groupByValue(hand);
    for (const [, cs] of groups)
      if (cs.length >= 2 && cs[0].value > ep.value)
        validPlays.push(cs.slice(0, 2));
  }

  /* -- DOUBLE TRIPLE -- */
  else if (ep.type === 'DOUBLE_TRIPLE') {
    const dts = findAllDoubleTriples(hand);
    for (const dt of dts) {
      const vals = [...new Set(dt.map(c => c.value))];
      const high = Math.max(vals[0], vals[1]);
      if (high > ep.highValue) validPlays.push(dt);
    }
  }

  /* -- STRAIGHT -- */
  else if (ep.type === 'STRAIGHT') {
    const ss = findStraightsOfLength(hand, ep.length);
    for (const s of ss)
      if (s[s.length - 1].value > ep.highValue)
        validPlays.push(s);
  }

  /* -- DOUBLE STRAIGHT -- */
  else if (ep.type === 'DOUBLE_STRAIGHT') {
    const pairsNeeded = ep.length / 2;
    const dss = findDoubleStraightsOfLength(hand, pairsNeeded);
    for (const ds of dss)
      if (ds[ds.length - 1].value > ep.highValue)
        validPlays.push(ds);
  }

  /* -- KAWAL -- */
  else if (ep.type === 'KAWAL') {
    const kw = findAllKawals(hand);
    for (const k of kw) {
      const kp = detectPattern(k);
      if (kp && kp.tripleValue > ep.tripleValue && kp.pairValue > ep.pairValue)
        validPlays.push(k);
    }
  }

  /* -- BOMB (in bomb battle) -- */
  else if (ep.type === 'BOMB') {
    const groups = groupByValue(hand);
    for (const [, cs] of groups)
      if (cs.length >= 4 && cs[0].value > ep.value)
        validPlays.push(cs.slice(0, 4));
    // BJB / RJB
    _addJokerBombPlays(hand, validPlays);
  }

  /* -- BLACK_JOKER_BOMB — only RJB beats it -- */
  else if (ep.type === 'BLACK_JOKER_BOMB') {
    const rj = hand.filter(c => c.isJoker && c.jokerColor === 'red');
    if (rj.length >= 4) validPlays.push(rj.slice(0, 4));
  }

  // If existing pattern is NOT a bomb, AI can ONLY try using a bomb if the pattern is Single/Double Joker!
  if (ep.type !== 'BOMB' && ep.type !== 'BLACK_JOKER_BOMB' && ep.type !== 'RED_JOKER_BOMB') {
    const isSingleJoker = ep.type === 'SINGLE' && ep.value >= 13;
    const isDoubleJoker = ep.type === 'DOUBLE' && ep.value >= 13;
    if (isSingleJoker || isDoubleJoker) {
      _addBombPlays(hand, validPlays);
    }
  }

  if (validPlays.length === 0) return null;

  // Pick cheapest (lowest total value). Penalize bombs heavily so they are played as a last resort.
  validPlays.sort((a, b) => {
    const isBombA = (a.length >= 4 && detectPattern(a)?.type.includes('BOMB'));
    const isBombB = (b.length >= 4 && detectPattern(b)?.type.includes('BOMB'));
    
    const sa = a.reduce((s, c) => s + c.value, 0) + (isBombA ? 1000 : 0);
    const sb = b.reduce((s, c) => s + c.value, 0) + (isBombB ? 1000 : 0);
    return sa - sb;
  });

  // AI strategic pass / selection based on difficulty
  const diff = G.difficulty;
  const best = validPlays[0];

  if (diff === 'easy') {
    // Easy: 60% pass walau bisa main → bot lambat habiskan kartu
    if (hand.length > 2 && Math.random() < 0.60) return null;
    // Saat main, pilih kartu paling mahal (buang kartu bagus, simpan jelek)
    return validPlays[validPlays.length - 1];
  }

  if (diff === 'hard') {
    // Hard: SELALU main jika bisa, pilih paling efisien (cheapest)
    // Jangan pernah pass — dominasi total
    return best;
  }

  // Normal: 30% pass kalau cuma punya kartu tinggi
  const avgVal = best.reduce((s, c) => s + c.value, 0) / best.length;
  if (avgVal >= 12 && hand.length > 4 && Math.random() < 0.30) return null;
  return best;
}

function _addBombPlays(hand, out) {
  const groups = groupByValue(hand);
  for (const [, cs] of groups)
    if (cs.length >= 4) out.push(cs.slice(0, 4));
  _addJokerBombPlays(hand, out);
}

function _addJokerBombPlays(hand, out) {
  const bj = hand.filter(c => c.isJoker && c.jokerColor === 'black');
  if (bj.length >= 4) out.push(bj.slice(0, 4));
  const rj = hand.filter(c => c.isJoker && c.jokerColor === 'red');
  if (rj.length >= 4) out.push(rj.slice(0, 4));
}

/* ============================================================
 *  7.  GAME LOGIC  (play, pass, advance, end-round)
 * ============================================================ */

function checkGameOver() {
  const activeUnfinished = G.players.map((p, i) => i).filter(i => !G.winners.includes(i) && !G.players[i].isKicked);
  if (activeUnfinished.length <= 1) {
    // Put the last active unfinished player(s) into G.winners
    for (const idx of activeUnfinished) {
      G.winners.push(idx);
    }
    // Put any kicked players at the very end
    for (let i = 0; i < G.numPlayers; i++) {
      if (!G.winners.includes(i)) {
        G.winners.push(i);
      }
    }
    G.gameOver = true;

    // Multiplayer: broadcast game over then show overlay
    const isMP = typeof MP !== 'undefined' && MP.isMultiplayer;
    if (isMP && MP.isHost) {
      broadcastGameState();
      handleMultiplayerGameOver({ winners: G.winners });
      return true;
    }

    renderGame();
    showGameOver();
    return true;
  }
  return false;
}

function executePlay(playerIdx, cards) {
  G.busy = true; // Lock immediately to prevent double-play
  const player  = G.players[playerIdx];
  const pattern = detectPattern(cards);

  // Remove played cards from hand
  const playedIds = new Set(cards.map(c => c.id));
  player.hand = player.hand.filter(c => !playedIds.has(c.id));

  // Update state
  G.roundLeaderIdx = playerIdx;
  G.currentPattern = pattern;
  G.tableCards     = pattern.cards;  // use sorted cards for consistent display

  // "Soft pass" rule: if someone makes a valid play, anyone who passed previously gets another chance
  G.passedPlayers.clear();

  playSound(pattern.type.includes('BOMB') ? 'bomb' : 'play');
  addLog(`<strong>${player.name}</strong> ${patternLabel(pattern, pattern.cards)}`);

  // Check for win
  if (player.hand.length === 0) {
    if (!G.winners.includes(playerIdx)) {
      G.winners.push(playerIdx);
      addLog(`<strong>${player.name}</strong> selesai! (Juara ${G.winners.length})`);
    }

    if (checkGameOver()) return;

    const isMP = typeof MP !== 'undefined' && MP.isMultiplayer;
    const myIdx = isMP ? G.myIndex : 0;
    // Show mid-game win overlay if human finished but game isn't over yet
    if (playerIdx === myIdx && !isMP) {
       showHumanWinOverlay(G.winners.indexOf(myIdx) + 1);
    }
  }

  renderGame();

  // Broadcast state in multiplayer after every play
  if (typeof MP !== 'undefined' && MP.isMultiplayer && MP.isHost) {
    broadcastGameState();
  }

  // Red Joker Bomb → instant round end
  if (pattern.type === 'RED_JOKER_BOMB') {
    showToast('💥 BOM JOKER MERAH! Putaran berakhir!');
    setTimeout(() => startNewRound(playerIdx), 1500);
    return;
  }

  advanceAndContinue(playerIdx);
}

function executePass(playerIdx) {
  G.busy = true; // Lock immediately to prevent spam-clicks
  G.passedPlayers.add(playerIdx);
  playSound('pass');
  addLog(`<strong>${G.players[playerIdx].name}</strong> pass`);

  // Check if round is over
  if (isRoundOver()) {
    renderGame();
    if (typeof MP !== 'undefined' && MP.isMultiplayer && MP.isHost) broadcastGameState();
    setTimeout(() => startNewRound(G.roundLeaderIdx), 900);
    return;
  }

  if (typeof MP !== 'undefined' && MP.isMultiplayer && MP.isHost) broadcastGameState();
  advanceAndContinue(playerIdx);
}

/* Helper: get effective hand count for a player (works in both solo and MP guest mode) */
function getPlayerHandCount(idx) {
  const p = G.players[idx];
  if (!p) return 0;
  if (p.hand && p.hand.length > 0) return p.hand.length;
  if (typeof p.handCount === 'number') return p.handCount;
  return p.hand ? p.hand.length : 0;
}

function isRoundOver() {
  for (let i = 0; i < G.numPlayers; i++) {
    if (i === G.roundLeaderIdx) continue;
    if (getPlayerHandCount(i) === 0) continue;  // already finished/out
    if (G.players[i] && G.players[i].isKicked) continue; // kicked players don't count
    if (!G.passedPlayers.has(i)) return false;   // someone still active
  }
  return true;
}

function advanceAndContinue(fromIdx) {
  // find next active player
  for (let step = 1; step < G.numPlayers; step++) {
    const idx = (fromIdx + step) % G.numPlayers;
    
    if (idx === G.roundLeaderIdx) {
      // circled back → round over
      G.busy = true; // lock during transition window
      renderGame();
      setTimeout(() => startNewRound(G.roundLeaderIdx), 900);
      return;
    }
    
    if (getPlayerHandCount(idx) === 0) continue; // skip finished players
    if (G.players[idx] && G.players[idx].isKicked) continue; // skip kicked players
    
    if (!G.passedPlayers.has(idx)) {
      G.currentIdx = idx;
      renderGame();
      scheduleTurn();
      return;
    }
  }
  // safety: nobody found → end round
  G.busy = true; // lock during transition window
  renderGame();
  setTimeout(() => startNewRound(G.roundLeaderIdx), 900);
}

function startNewRound(leaderIdx) {
  if (G.gameOver) return;             // don't start new round if game ended
  if (G.roundTransition) return;      // re-entrancy guard: prevent double-increment from spam
  G.roundTransition = true;
  
  let actualLeader = leaderIdx;
  if (getPlayerHandCount(actualLeader) === 0) {
    for (let step = 1; step < G.numPlayers; step++) {
      const idx = (actualLeader + step) % G.numPlayers;
      if (getPlayerHandCount(idx) > 0) {
        actualLeader = idx;
        break;
      }
    }
  }

  G.roundNum++;
  G.passedPlayers.clear();
  G.currentPattern = null;
  G.tableCards     = [];
  G.currentIdx     = actualLeader;
  G.roundLeaderIdx = actualLeader;
  G.selectedIds.clear();
  G.roundTransition = false; // clear guard after state is set

  addLog(`— Putaran ${G.roundNum}: ${G.players[actualLeader].name} memulai —`);
  renderGame();
  scheduleTurn();
}

function scheduleTurn() {
  if (G.gameOver) return;

  // In multiplayer, the host handles turn scheduling
  if (typeof MP !== 'undefined' && MP.isMultiplayer && MP.isHost) {
    hostScheduleTurn();
    return;
  }
  // Guest in multiplayer: do nothing, wait for host's messages
  if (typeof MP !== 'undefined' && MP.isMultiplayer && !MP.isHost) {
    return;
  }

  const p = G.players[G.currentIdx];
  if (!p.isHuman) {
    G.busy = true;
    G.selectedIds.clear(); // clear any stale human selections during bot turn
    updateButtons();
    renderPlayerHand(); // re-render so cards are non-selectable during bot turn
    $('game-status').innerHTML = `Giliran: ${p.name} <span class="thinking">Memilih kartu</span>`;
    const aiDelay = 1500 + Math.floor(Math.random() * 1500);
    
    if (aiTimeoutId) clearTimeout(aiTimeoutId);
    aiTimeoutId = setTimeout(() => {
      G.busy = false;
      performAITurn();
    }, aiDelay);
  } else {
    G.busy = false;
    G.selectedIds.clear(); // fresh selection each turn
    renderPlayerHand(); // re-render hand NOW with G.busy=false so click listeners are attached
    updateButtons();
    
    // Play "Your Turn" animation
    const anim = $('your-turn-anim');
    anim.classList.remove('play');
    void anim.offsetWidth; // trigger reflow
    anim.classList.add('play');
    playSound('yourTurn');
  }
}

function performAITurn() {
  if (G.gameOver) return;
  const hand = G.players[G.currentIdx].hand;
  let play;
  if (!G.currentPattern) {
    play = aiOpeningPlay(hand);
  } else {
    play = aiResponsePlay(hand, G.currentPattern);
  }
  if (play) {
    executePlay(G.currentIdx, play);
  } else {
    executePass(G.currentIdx);
  }
}

/* ============================================================
 *  8.  UI  RENDERING
 * ============================================================ */

/* --- refs (cached once) --- */
const $ = id => document.getElementById(id);

function renderGame() {
  renderOpponents();
  renderTable();
  renderPlayerHand();
  renderLog();
  updateStatus();
  updateButtons();
}

/* --- Opponents --- */
function renderOpponents() {
  const el = $('opponents');
  if (!el) return;
  el.innerHTML = '';
  const isMP = typeof MP !== 'undefined' && MP.isMultiplayer;
  const myIdx = isMP ? G.myIndex : 0;
  if (isMP && G.myIndex === undefined) return; // waiting player

  for (let i = 0; i < G.numPlayers; i++) {
    const p = G.players[i];
    
    const winRank = G.winners ? G.winners.indexOf(i) : -1;
    const isWinner = winRank !== -1;
    
    const mpPlayer = isMP ? MP.players.find(x => x.peerId === p.peerId) : null;
    const isDisconnected = mpPlayer && !mpPlayer.connected;
    
    const isKicked = p.isKicked === true;
    const div = document.createElement('div');
    div.className = 'opp-card'
      + (G.currentIdx === i && !G.gameOver && !isWinner && !isKicked ? ' active-turn' : '')
      + (G.passedPlayers.has(i) ? ' passed' : '')
      + (isWinner ? ' winner' : '')
      + (isDisconnected ? ' disconnected' : '')
      + (isKicked ? ' kicked' : '');
      
    const isMe = (i === myIdx);
    let avatar, name, avatarStyle = '';

    if (isMP && p.profile) {
      avatar = p.profile.symbol;
      name = isMe ? `${p.name} (Kamu)` : p.name;
      if (isDisconnected && !isKicked) {
        name = `${p.name} (Bot)`;
      }
      if (isKicked) {
        name = `${p.name} (Kicked)`;
      }
      const c = p.profile.color;
      avatarStyle = `background:${hexToRGBA(c,0.2)};color:${c};`;
    } else {
      avatar = isMe ? '👤' : p.avatar;
      name = isMe ? 'Kamu' : p.name;
    }

    // Card count: use hand.length if available (and > 0), else handCount
    const cardCount = getPlayerHandCount(i);
    
    let countHtml = `<span class="opp-count">${cardCount} kartu</span>`;
    if (isWinner) {
       countHtml = `<span class="opp-count" style="color:#30D158; font-weight:bold;">Juara ${winRank + 1}</span>`;
    }
    if (isKicked) {
       countHtml = `<span class="opp-count" style="color:#FF3B30; font-weight:bold;">❌ Dikeluarkan</span>`;
    }

    div.innerHTML = `
      <div class="opp-avatar" style="${avatarStyle}">${avatar}</div>
      <div class="opp-info">
        <span class="opp-name">${name}</span>
        ${countHtml}
      </div>`;
    el.appendChild(div);
  }
}

/* --- Table --- */
function renderTable() {
  const cardsEl   = $('table-cards');
  const labelEl   = $('table-label');
  const patternEl = $('table-pattern');

  cardsEl.innerHTML = '';

  if (G.tableCards.length === 0) {
    labelEl.textContent = G.currentPattern
      ? 'Meja kosong'
      : 'Meja kosong — mainkan kartu bebas';
    patternEl.textContent = '';
    return;
  }

  labelEl.textContent = `Dikeluarkan oleh ${G.players[G.roundLeaderIdx].name}`;
  patternEl.textContent = patternLabel(G.currentPattern, G.tableCards);

  // Sort for consistent display
  const displayCards = [...G.tableCards].sort((a, b) => a.value - b.value);
  for (const c of displayCards)
    cardsEl.appendChild(renderCardElement(c, false, false));
}

/* --- Player Hand --- */
let dragSrcIndex = null;

function renderPlayerHand() {
  const el = $('player-hand');
  if (!el) return;
  el.innerHTML = '';
  const isMP = typeof MP !== 'undefined' && MP.isMultiplayer;
  const myIdx = isMP ? G.myIndex : 0;
  if (isMP && G.myIndex === undefined) return; // waiting player
  const hand = G.players[myIdx].hand;
  $('hand-count').textContent = `${hand.length} kartu`;

  const isMyTurn = G.currentIdx === myIdx && !G.gameOver && !G.busy;

  for (let i = 0; i < hand.length; i++) {
    const c = hand[i];
    const sel = G.selectedIds.has(c.id);
    const cardEl = renderCardElement(c, isMyTurn, sel);
    
    // Setup drag and drop
    cardEl.dataset.index = i;
    cardEl.draggable = true;
    cardEl.addEventListener('dragstart', handleDragStart);
    cardEl.addEventListener('dragenter', handleDragEnter);
    cardEl.addEventListener('dragover', handleDragOver);
    cardEl.addEventListener('dragleave', handleDragLeave);
    cardEl.addEventListener('drop', handleDrop);
    cardEl.addEventListener('dragend', handleDragEnd);

    if (isMyTurn) {
      cardEl.addEventListener('click', () => toggleCard(c.id));
    }
    el.appendChild(cardEl);
  }
}

function handleDragStart(e) {
  dragSrcIndex = parseInt(this.dataset.index);
  e.dataTransfer.effectAllowed = 'move';
  this.classList.add('dragging');
}

function handleDragEnter(e) {
  e.preventDefault();
  this.classList.add('drag-over');
}

function handleDragOver(e) {
  e.preventDefault(); // Necessary to allow dropping
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDragLeave(e) {
  this.classList.remove('drag-over');
}

function handleDrop(e) {
  e.stopPropagation();
  this.classList.remove('drag-over');
  const dropTargetIndex = parseInt(this.dataset.index);
  if (dragSrcIndex !== null && dragSrcIndex !== dropTargetIndex) {
    const isMP = typeof MP !== 'undefined' && MP.isMultiplayer;
    const myIdx = isMP ? G.myIndex : 0;
    const hand = G.players[myIdx].hand;
    const movedCard = hand.splice(dragSrcIndex, 1)[0];
    hand.splice(dropTargetIndex, 0, movedCard);
    renderPlayerHand();
  }
  return false;
}

function handleDragEnd(e) {
  this.classList.remove('dragging');
  const cards = document.querySelectorAll('#player-hand .card');
  cards.forEach(c => c.classList.remove('drag-over'));
}

function toggleCard(id) {
  const isMP = typeof MP !== 'undefined' && MP.isMultiplayer;
  const myIdx = isMP ? G.myIndex : 0;
  if (G.currentIdx !== myIdx || G.busy || G.gameOver) return;
  if (G.selectedIds.has(id)) G.selectedIds.delete(id);
  else G.selectedIds.add(id);
  renderPlayerHand();
  updateButtons();
}

/* --- Card element --- */
function renderCardElement(card, selectable, selected) {
  const div = document.createElement('div');
  let cls = 'card c-' + card.color;
  if (selectable) cls += ' selectable';
  if (selected)   cls += ' selected';
  if (card.isJoker) cls += (card.jokerColor === 'red' ? ' joker-red' : ' joker-black');
  div.className = cls;
  div.dataset.cardId = card.id;

  if (card.isJoker) {
    const label = card.jokerColor === 'red' ? 'JOKER' : 'JOKER';
    const star  = '★';
    div.innerHTML = `
      <div class="card-tl"><span class="joker-label">${label}</span></div>
      <div class="card-mid">${star}</div>
      <div class="card-br"><span class="joker-label">${label}</span></div>`;
  } else {
    div.innerHTML = `
      <div class="card-tl">${card.rank}<br><span class="card-suit-sm">${card.suit}</span></div>
      <div class="card-mid">${card.suit}</div>
      <div class="card-br">${card.rank}<br><span class="card-suit-sm">${card.suit}</span></div>`;
  }
  return div;
}

/* --- Log --- */
function renderLog() {
  const el = $('game-log');
  el.innerHTML = '';
  const recent = G.logs.slice(-8);
  for (const msg of recent) {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML = msg;
    el.appendChild(div);
  }
  el.scrollTop = el.scrollHeight;
}

/* --- Status bar --- */
function updateStatus() {
  const statusEl = $('game-status');
  const badgeEl  = $('round-badge');
  const isMP = typeof MP !== 'undefined' && MP.isMultiplayer;
  const myIdx = isMP ? G.myIndex : 0;

  if (G.gameOver) {
    if (G.winners && G.winners.length > 0) {
      const winnerName = G.players[G.winners[0]].name;
      statusEl.textContent = `Game selesai! Juara 1: ${winnerName}`;
    } else {
      statusEl.textContent = 'Game selesai!';
    }
  } else {
    const p = G.players[G.currentIdx];
    if (G.currentIdx === myIdx && !G.busy) {
      statusEl.textContent = `⚡ Giliranmu!`;
    } else if (!p.isHuman && !isMP) {
      // Solo mode: bot thinking
      statusEl.innerHTML = `${p.name} <span class="thinking">Memilih kartu</span>`;
    } else {
      // Multiplayer: other player thinking
      statusEl.innerHTML = `🤔 ${p.name} <span class="thinking">sedang memilih</span>`;
    }
  }
  badgeEl.textContent = `Putaran ${G.roundNum}`;
}

/* --- Buttons --- */
function updateButtons() {
  const btnPlay = $('btn-play');
  const btnPass = $('btn-pass');
  const btnSkip = $('btn-skip');
  const isMP = typeof MP !== 'undefined' && MP.isMultiplayer;
  const myIdx = isMP ? G.myIndex : 0;
  
  // Default state: show play/pass, hide skip
  btnSkip.classList.add('hidden');
  btnPlay.classList.remove('hidden');
  btnPass.classList.remove('hidden');

  if (G.gameOver) {
    btnPlay.disabled = true; btnPass.disabled = true; return;
  }
  
  const myHand = G.players[myIdx]?.hand;
  if (myHand && myHand.length === 0) {
    // human finished their cards
    if (!isMP) {
      // Solo: show skip button
      btnPlay.classList.add('hidden');
      btnPass.classList.add('hidden');
      btnSkip.classList.remove('hidden');
    } else {
      // Multiplayer: disable but keep visible (spectating)
      btnPlay.disabled = true;
      btnPass.disabled = true;
    }
    return;
  }

  const isMyTurn   = G.currentIdx === myIdx && !G.gameOver && !G.busy;
  const hasCurrent = G.currentPattern !== null;
  const hasSelect  = G.selectedIds.size > 0;

  btnPlay.disabled = !(isMyTurn && hasSelect);
  btnPass.disabled = !(isMyTurn && hasCurrent);
}

/* --- Card rank label helper (safe for jokers) --- */
function cardRankLabel(card) {
  if (card.isJoker) return card.jokerColor === 'red' ? 'JkR' : 'JkH';
  return card.rank;
}

/* --- Pattern label --- */
function patternLabel(pattern, cards) {
  if (!pattern) return '';
  switch (pattern.type) {
    case 'SINGLE': {
      const c = cards[0];
      if (c.isJoker) return `Single ${c.jokerColor === 'red' ? 'Joker Merah ★' : 'Joker Hitam ★'}`;
      return `Single ${c.rank}${c.suit}`;
    }
    case 'DOUBLE': {
      const c = cards[0];
      if (c.isJoker) return `Double ${c.jokerColor === 'red' ? 'Joker Merah' : 'Joker Hitam'}`;
      return `Double ${c.rank}`;
    }
    case 'DOUBLE_TRIPLE': {
      const ranks = [...new Set(cards.map(c => cardRankLabel(c)))];
      return `Double Triple ${ranks[0]} & ${ranks[1]}`;
    }
    case 'DOUBLE_STRAIGHT':
      return `Seri Double ${cards.length / 2} pasang`;
    case 'STRAIGHT':
      return `Seri ${cards.map(c => cardRankLabel(c)).join('-')}`;
    case 'KAWAL': {
      const triCard = cards.find(c => c.value === pattern.tripleValue);
      const pairCard = cards.find(c => c.value === pattern.pairValue);
      return `Kawal ${cardRankLabel(triCard)}×3 + ${cardRankLabel(pairCard)}×2`;
    }
    case 'BOMB': {
      const c = cards[0];
      return `💣 Bom ${cardRankLabel(c)}×4`;
    }
    case 'BLACK_JOKER_BOMB':
      return '💣💣 Bom Joker Hitam!';
    case 'RED_JOKER_BOMB':
      return '💥 Bom Joker Merah!';
    default:
      return '?';
  }
}

/* ============================================================
 *  9.  EVENT HANDLERS
 * ============================================================ */

/* --- Player Play --- */
function playerPlay() {
  // Route to multiplayer handler
  if (typeof MP !== 'undefined' && MP.isMultiplayer) {
    multiplayerPlayerPlay();
    return;
  }

  if (G.currentIdx !== 0 || G.busy || G.gameOver) return;
  const hand = G.players[0].hand;
  const sel  = hand.filter(c => G.selectedIds.has(c.id));
  if (sel.length === 0) { showToast('Pilih kartu terlebih dahulu'); return; }

  const pattern = detectPattern(sel);
  if (!pattern) { showToast('Kombinasi kartu tidak valid'); return; }

  if (G.currentPattern) {
    if (!canBeat(pattern, G.currentPattern)) {
      showToast('Kartu tidak cukup kuat untuk menimpa'); return;
    }
  } else {
    // Opening a round — bombs cannot be used as openers
    if (pattern.type === 'BOMB' || pattern.type === 'BLACK_JOKER_BOMB' || pattern.type === 'RED_JOKER_BOMB') {
      showToast('💣 Bom hanya bisa dimainkan untuk melawan Joker atau Bom!');
      return;
    }
  }

  G.selectedIds.clear();
  executePlay(0, sel);
}

/* --- Player Pass --- */
function playerPass() {
  // Route to multiplayer handler
  if (typeof MP !== 'undefined' && MP.isMultiplayer) {
    multiplayerPlayerPass();
    return;
  }

  if (G.currentIdx !== 0 || G.busy || G.gameOver) return;
  if (!G.currentPattern) { showToast('Kamu harus memainkan kartu untuk memulai'); return; }
  G.selectedIds.clear();
  executePass(0);
}

/* ============================================================
 *  10. TOAST, DEAL ANIMATION & GAME-OVER
 * ============================================================ */

function showToast(msg) {
  playSound('error');
  const container = $('toast-container');
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => { t.classList.add('out'); }, 2000);
  setTimeout(() => { t.remove(); }, 2300);
}

function addLog(msg) {
  G.logs.push(msg);
}

function showHumanWinOverlay(rank) {
  const isLoser = rank === G.numPlayers; // last place = loser
  const isGameOver = G.gameOver;
  
  if (isLoser) {
    $('human-win-title').textContent = 'Kamu Kalah!';
    $('human-win-title').style.color = '#E5342E';
    $('human-win-desc').textContent = 'Kamu adalah pemain terakhir yang masih memegang kartu. Coba lagi!';
    playSound('error');
  } else {
    $('human-win-title').textContent = `Kamu Juara ${rank}!`;
    $('human-win-title').style.color = '#30D158';
    playSound('win');
    if (isGameOver) {
      $('human-win-desc').textContent = 'Selamat, kartumu telah habis! Kamu berhasil memenangkan permainan.';
    } else {
      $('human-win-desc').textContent = 'Selamat, kartumu telah habis! Para Bot masih bertarung memperebutkan sisa posisi.';
    }
  }
  
  if (isGameOver) {
    $('btn-watch').style.display = 'none';
  } else {
    $('btn-watch').style.display = 'block';
  }
  
  $('human-win-overlay').classList.remove('hidden');
}

function showGameOver() {
  $('human-win-overlay').classList.add('hidden');
  $('gameover-overlay').classList.remove('hidden');
  const title = $('gameover-title');
  const desc  = $('gameover-desc');

  let html = '';
  for(let i=0; i<G.winners.length; i++) {
    const pIdx = G.winners[i];
    const p = G.players[pIdx];
    if (i === G.winners.length - 1) {
       html += `<div style="margin-top: 8px;"><strong>Loser:</strong> ${p.name} 😢</div>`;
    } else {
       html += `<div><strong>Juara ${i+1}:</strong> ${p.name} 🏆</div>`;
    }
  }

  const myIdx = (typeof MP !== 'undefined' && MP.isMultiplayer) ? G.myIndex : 0;
  if (G.winners[0] === myIdx) {
    title.textContent = 'Menang!';
    title.style.color = '#30D158';
    playSound('win');
  } else if (G.winners[G.winners.length - 1] === myIdx) {
    title.textContent = 'Kalah!';
    title.style.color = '#E5342E';
  } else {
    title.textContent = 'Game Selesai!';
    title.style.color = '#0A84FF';
    playSound('win');
  }

  desc.innerHTML = html;
}

/* ============================================================
 *  11. SETUP SCREEN & INIT
 * ============================================================ */

function updateSettingInfo() {
  const total    = G.numDecks * 56;  // 52 + 4 jokers per deck
  const perPlayer = Math.floor(total / G.numPlayers);
  $('val-players').textContent = G.numPlayers;
  $('val-decks').textContent   = G.numDecks;
  $('setting-info').textContent = `${total} kartu · ${perPlayer} kartu/pemain`;
}

/* ---------- Deal Animation ---------- */
function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function showDealAnimation() {
  const overlay = $('deal-overlay');
  const deck    = $('deal-deck');
  const text    = $('deal-text');

  overlay.classList.remove('hidden', 'fading');
  deck.innerHTML = '';

  const STACK = 14;

  // Build the visual stack of card-backs
  for (let i = 0; i < STACK; i++) {
    const el = document.createElement('div');
    el.className = 'deal-card-back';
    el.style.setProperty('--i', i);
    deck.appendChild(el);
  }

  // Phase 1 — shuffle wiggle
  text.textContent = 'Mengocok kartu…';
  deck.classList.add('shuffling');
  playSound('shuffle');
  await _delay(1300);

  // Phase 2 — deal out (cards fly radially)
  deck.classList.remove('shuffling');
  text.textContent = 'Membagikan kartu…';

  const cards = deck.querySelectorAll('.deal-card-back');
  cards.forEach((el, i) => {
    const angle = (i / STACK) * Math.PI * 2 - Math.PI / 2;
    const radius = 140 + Math.random() * 60;
    const dx = Math.cos(angle) * radius;
    const dy = Math.sin(angle) * radius;
    const rot = (Math.random() - 0.5) * 120;
    el.style.setProperty('--dx', dx + 'px');
    el.style.setProperty('--dy', dy + 'px');
    el.style.setProperty('--rot', rot + 'deg');
    setTimeout(() => {
      el.classList.add('dealt');
      if (i % 3 === 0) playSound('deal'); // play tick sound for some cards
    }, i * 70);
  });

  await _delay(STACK * 70 + 500);

  // Phase 3 — fade out overlay
  overlay.classList.add('fading');
  await _delay(450);
  overlay.classList.add('hidden');
  overlay.classList.remove('fading');
  deck.innerHTML = '';
}

/* ============================================================
 *  12. AUDIO & SOUND EFFECTS
 * ============================================================ */
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function playSound(type) {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    const now = audioCtx.currentTime;
    
    switch(type) {
      case 'deal':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.05);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.05);
        break;
      case 'shuffle':
        // A noise-like rustle using rapid frequency changes
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, now);
        for(let i=1; i<20; i++) {
          osc.frequency.setValueAtTime(100 + Math.random()*800, now + (i*0.05));
        }
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.linearRampToValueAtTime(0, now + 1.0);
        osc.start(now);
        osc.stop(now + 1.0);
        break;
      case 'play':
        osc.type = 'square';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.1);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
        break;
      case 'pass':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(100, now);
        osc.frequency.exponentialRampToValueAtTime(20, now + 0.2);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
        break;
      case 'win':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now); // A4
        osc.frequency.setValueAtTime(554, now + 0.1); // C#5
        osc.frequency.setValueAtTime(659, now + 0.2); // E5
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.2, now + 0.05);
        gain.gain.linearRampToValueAtTime(0, now + 0.5);
        osc.start(now);
        osc.stop(now + 0.5);
        break;
      case 'error':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, now);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
        break;
      case 'yourTurn':
        // Ascending two-note chime
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523, now);  // C5
        osc.frequency.setValueAtTime(784, now + 0.12); // G5
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.25, now + 0.03);
        gain.gain.setValueAtTime(0.2, now + 0.12);
        gain.gain.linearRampToValueAtTime(0, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.4);
        break;
      case 'bomb':
        osc.type = 'square';
        osc.frequency.setValueAtTime(100, now);
        osc.frequency.exponentialRampToValueAtTime(10, now + 0.4);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.4);
        break;
    }
  } catch (e) {
    console.error('Audio playback failed', e);
  }
}

function setupListeners() {
  // Steppers
  $('stepper-players').addEventListener('click', e => {
    const btn = e.target.closest('.stepper-btn');
    if (!btn) return;
    const dir = +btn.dataset.dir;
    G.numPlayers = Math.max(2, Math.min(8, G.numPlayers + dir));
    updateSettingInfo();
  });
  $('stepper-decks').addEventListener('click', e => {
    const btn = e.target.closest('.stepper-btn');
    if (!btn) return;
    const dir = +btn.dataset.dir;
    G.numDecks = Math.max(1, Math.min(4, G.numDecks + dir));
    updateSettingInfo();
  });

  // Start
  $('btn-start').addEventListener('click', async () => {
    // Validate: enough cards per player (minimum 5)
    const total = G.numDecks * 56;
    const perPlayer = Math.floor(total / G.numPlayers);
    if (perPlayer < 5) {
      showToast('Kartu terlalu sedikit per pemain. Tambah dek atau kurangi pemain.');
      return;
    }
    // Initialize audio on first user interaction
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    G.myIndex = 0;
    if (typeof showScreen === 'function') showScreen('game-screen');
    else {
      $('setup-screen').classList.remove('active');
      $('game-screen').classList.add('active');
    }
    
    // Hide chat for solo
    const chatToggle = $('ingame-chat-toggle');
    if (chatToggle) chatToggle.classList.add('hidden');
    const chatPanel = $('ingame-chat-panel');
    if (chatPanel) chatPanel.classList.add('hidden');
    
    // Clear the board visually before dealing
    $('player-hand').innerHTML = '';
    $('opponents').innerHTML = '';
    $('table-cards').innerHTML = '';
    $('table-pattern').textContent = '';
    $('table-label').textContent = 'Meja kosong — mainkan kartu';
    $('hand-count').textContent = '0 kartu';
    $('game-status').textContent = 'Mengocok kartu...';

    
    playSound('deal');
    G.isFirstGame = true;
    initGame();
    await showDealAnimation();
    renderGame();
    await performThreeDump();
    scheduleTurn();
  });

  // Menu (back)
  $('btn-menu').addEventListener('click', () => {
    G.gameOver = true;          // stop any pending AI
    if (aiTimeoutId) { clearTimeout(aiTimeoutId); aiTimeoutId = null; }
    if (typeof clearTurnTimer === 'function') clearTurnTimer();
    if (typeof MP !== 'undefined' && MP.isMultiplayer) {
      localStorage.removeItem('setsot_active_room');
      if (typeof destroyChannel === 'function') destroyChannel();
      MP.isMultiplayer = false;
    }
    $('game-screen').classList.remove('active');
    $('gameover-overlay').classList.add('hidden');
    $('human-win-overlay').classList.add('hidden');
    $('disconnect-overlay').classList.add('hidden');
    if (typeof showScreen === 'function') showScreen('menu-screen');
    else $('menu-screen').classList.add('active');
  });

  // Restart (solo only)
  async function restartGame() {
    $('gameover-overlay').classList.add('hidden');
    $('human-win-overlay').classList.add('hidden');
    
    // Save previous winner for next game's first turn
    if (G.winners && G.winners.length > 0) {
      G.previousWinnerIdx = G.winners[0];
    }
    const isFirstGame = G.isFirstGame; // capture before initGame resets it
    G.isFirstGame = false;
    
    // Clear the board visually before dealing
    $('player-hand').innerHTML = '';
    $('opponents').innerHTML = '';
    $('table-cards').innerHTML = '';
    $('table-pattern').textContent = '';
    $('table-label').textContent = 'Meja kosong — mainkan kartu';
    $('hand-count').textContent = '0 kartu';
    $('game-status').textContent = 'Mengocok kartu...';
    
    initGame();
    await showDealAnimation();
    renderGame();
    
    // Only do 3-dump on first game; subsequent games start with previous winner
    if (isFirstGame) {
      await performThreeDump();
    }
    scheduleTurn();
  }

  $('btn-restart').addEventListener('click', () => {
    if (typeof MP !== 'undefined' && MP.isMultiplayer) {
      if (MP.isHost && typeof hostStartGame === 'function') {
        hostStartGame(true);
      } else {
        $('gameover-overlay').classList.add('hidden');
        if (typeof showToast === 'function') showToast('Menunggu Host untuk mulai game baru...');
      }
      return;
    }
    restartGame();
  });
  $('btn-skip').addEventListener('click', restartGame);
  
  // Mid-game human win buttons
  $('btn-watch').addEventListener('click', () => {
    $('human-win-overlay').classList.add('hidden');
  });
  $('btn-next-game').addEventListener('click', () => {
    $('human-win-overlay').classList.add('hidden');
    if (typeof MP !== 'undefined' && MP.isMultiplayer) {
      if (MP.isHost && typeof hostStartGame === 'function') {
        hostStartGame(true);
      } else {
        if (typeof showToast === 'function') showToast('Menunggu Host untuk mulai game baru...');
      }
      return;
    }
    restartGame();
  });

  // Play / Pass
  $('btn-play').addEventListener('click', playerPlay);
  $('btn-pass').addEventListener('click', playerPass);
}

/* --- Boot --- */
document.addEventListener('DOMContentLoaded', () => {
  G.numPlayers = 4;
  G.numDecks   = 1;
  G.difficulty = 'normal';
  updateSettingInfo();
  setupListeners();

  // Difficulty selector
  $('difficulty-selector').addEventListener('click', e => {
    const btn = e.target.closest('.diff-btn');
    if (!btn) return;
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    G.difficulty = btn.dataset.diff;
  });

  // Solo start button — switch from setup-screen to game-screen
  // (multiplayer.js handles its own flow for btn-solo and MP screens)
});
