'use strict';

/* ============================================================
 *  MULTIPLAYER.JS — PeerJS Room System, Profile, Lobby, Sync
 * ============================================================ */

/* ============================================================
 *  1. PROFILE MANAGER
 * ============================================================ */
const PROFILE_KEY = 'setsot_profile';

const ProfileMgr = {
  _data: null,

  load() {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (raw) this._data = JSON.parse(raw);
    } catch (e) { /* ignore */ }
    if (!this._data) {
      this._data = {
        name: 'Pemain',
        symbol: '♠',
        color: '#E5342E'
      };
    }
    return this._data;
  },

  save(name, symbol, color) {
    this._data = { name: name || 'Pemain', symbol, color };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(this._data));
    return this._data;
  },

  get() {
    if (!this._data) this.load();
    return this._data;
  }
};

/* ============================================================
 *  2. MULTIPLAYER STATE
 * ============================================================ */
const MP = {
  isMultiplayer: false,
  isHost: false,
  channel: null,       // Supabase Realtime Channel
  connections: [],     // Not strictly needed in same way, but kept for logic compat
  roomCode: '',
  myPeerId: '',        // We will generate a random ID for ourselves
  players: [],         // { peerId, profile, isHost, connected }
  settings: { decks: 1, maxPlayers: 4 },
  gameStarted: false,
  turnTimer: null,
  turnTimerValue: 30,
  chatMessages: [],
  unreadChat: 0,
};

const SUPABASE_URL = 'https://uciohbcjtranikvcufhh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_mm8NP_zIDLfk6bmlwXmIxQ_oIDf6C_U';
const supabaseClient = typeof window.supabase !== 'undefined' 
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) 
  : null;

const ROOM_PREFIX = 'setsot-';
const TURN_TIME = 30; // seconds

/* ============================================================
 *  3. HELPER FUNCTIONS
 * ============================================================ */
const $mp = id => document.getElementById(id);

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function renderAvatarStyle(el, profile) {
  el.textContent = profile.symbol;
  el.style.background = hexToRGBA(profile.color, 0.2);
  el.style.color = profile.color;
  el.style.boxShadow = `0 2px 12px ${hexToRGBA(profile.color, 0.25)}`;
}

function mergeHandPreservingOrder(localHand, hostHand) {
  if (!hostHand) return [];
  const hostCardIds = new Set(hostHand.map(c => c.id));
  const updatedHand = localHand.filter(c => hostCardIds.has(c.id));
  const localCardIds = new Set(updatedHand.map(c => c.id));
  for (const c of hostHand) {
    if (!localCardIds.has(c.id)) {
      updatedHand.push(c);
    }
  }
  return updatedHand;
}

/* ============================================================
 *  4. PROFILE UI
 * ============================================================ */
function initProfileUI() {
  const profile = ProfileMgr.load();

  // Update menu badge
  updateMenuProfileBadge(profile);

  // Profile editor
  const nameInput = $mp('profile-name-input');
  const symbolBtns = document.querySelectorAll('.psym-btn');
  const colorBtns = document.querySelectorAll('.pcolor-btn');

  let selSymbol = profile.symbol;
  let selColor = profile.color;

  nameInput.value = profile.name;

  // Set active states
  symbolBtns.forEach(b => {
    b.classList.toggle('active', b.dataset.symbol === profile.symbol);
  });
  colorBtns.forEach(b => {
    b.classList.toggle('active', b.dataset.color === profile.color);
  });

  updateProfilePreview(profile.name, selSymbol, selColor);

  // Symbol selection
  symbolBtns.forEach(b => {
    b.addEventListener('click', () => {
      symbolBtns.forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      selSymbol = b.dataset.symbol;
      updateProfilePreview(nameInput.value, selSymbol, selColor);
    });
  });

  // Color selection
  colorBtns.forEach(b => {
    b.addEventListener('click', () => {
      colorBtns.forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      selColor = b.dataset.color;
      updateProfilePreview(nameInput.value, selSymbol, selColor);
    });
  });

  // Name input live preview
  nameInput.addEventListener('input', () => {
    updateProfilePreview(nameInput.value, selSymbol, selColor);
  });

  // Save
  $mp('profile-save').addEventListener('click', () => {
    const p = ProfileMgr.save(nameInput.value.trim() || 'Pemain', selSymbol, selColor);
    updateMenuProfileBadge(p);
    showScreen('menu-screen');
    showToast('✅ Profil tersimpan!');
  });

  // Back
  $mp('profile-back').addEventListener('click', () => showScreen('menu-screen'));
}

function updateProfilePreview(name, symbol, color) {
  const avatar = $mp('profile-preview-avatar');
  avatar.textContent = symbol;
  avatar.style.background = hexToRGBA(color, 0.2);
  avatar.style.color = color;
  avatar.style.boxShadow = `0 4px 20px ${hexToRGBA(color, 0.25)}`;
  $mp('profile-preview-name').textContent = name || 'Pemain';
}

function updateMenuProfileBadge(profile) {
  const avatar = $mp('menu-profile-avatar');
  avatar.textContent = profile.symbol;
  avatar.style.background = hexToRGBA(profile.color, 0.18);
  avatar.style.color = profile.color;
  avatar.style.border = `2px solid ${hexToRGBA(profile.color, 0.3)}`;
  $mp('menu-profile-name').textContent = profile.name;
}


/* ============================================================
 *  5. ROOM CREATION (HOST)
 * ============================================================ */
function initCreateRoomUI() {
  MP.settings.decks = 1;
  MP.settings.maxPlayers = 4;

  $mp('val-mp-decks').textContent = '1';
  $mp('val-mp-max').textContent = '4';
  updateMpSettingInfo();

  $mp('stepper-mp-decks').addEventListener('click', e => {
    const btn = e.target.closest('.stepper-btn');
    if (!btn) return;
    MP.settings.decks = Math.max(1, Math.min(4, MP.settings.decks + (+btn.dataset.dir)));
    $mp('val-mp-decks').textContent = MP.settings.decks;
    updateMpSettingInfo();
  });

  $mp('stepper-mp-max').addEventListener('click', e => {
    const btn = e.target.closest('.stepper-btn');
    if (!btn) return;
    MP.settings.maxPlayers = Math.max(2, Math.min(8, MP.settings.maxPlayers + (+btn.dataset.dir)));
    $mp('val-mp-max').textContent = MP.settings.maxPlayers;
    updateMpSettingInfo();
  });

  $mp('btn-create-go').addEventListener('click', () => createRoom());
  $mp('create-back').addEventListener('click', () => {
    localStorage.removeItem('setsot_active_room');
    destroyChannel();
    showScreen('menu-screen');
  });
}

function updateMpSettingInfo() {
  const total = MP.settings.decks * 56;
  const per = Math.floor(total / MP.settings.maxPlayers);
  $mp('mp-setting-info').textContent = `${total} kartu · ${per} kartu/pemain`;
}

async function createRoom() {
  const spinner = $mp('create-spinner');
  spinner.classList.remove('hidden');
  $mp('btn-create-go').disabled = true;

  MP.roomCode = generateRoomCode();
  const peerId = ROOM_PREFIX + MP.roomCode;

  try {
    await initChannel(MP.roomCode, true);
    MP.isHost = true;
    MP.isMultiplayer = true;
    MP.gameStarted = false;

    const profile = ProfileMgr.get();
    MP.players = [{
      peerId: MP.myPeerId,
      profile,
      isHost: true,
      connected: true
    }];

    spinner.classList.add('hidden');
    $mp('btn-create-go').disabled = false;

    // Go to lobby
    showLobby();
  } catch (err) {
    spinner.classList.add('hidden');
    $mp('btn-create-go').disabled = false;
    showToast('❌ Gagal membuat room. Coba lagi.');
    console.error('Create room error:', err);
  }
}

/* ============================================================
 *  6. JOIN ROOM (GUEST)
 * ============================================================ */
function initJoinRoomUI() {
  const input = $mp('join-code-input');
  input.value = '';
  $mp('join-error').textContent = '';

  input.addEventListener('input', () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  $mp('btn-join-go').addEventListener('click', () => joinRoom());
  $mp('join-back').addEventListener('click', () => {
    localStorage.removeItem('setsot_active_room');
    destroyChannel();
    showScreen('menu-screen');
  });

  // Enter key
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') joinRoom();
  });
}

async function joinRoom() {
  const code = $mp('join-code-input').value.trim().toUpperCase();
  if (code.length !== 6) {
    $mp('join-error').textContent = 'Kode harus 6 karakter';
    return;
  }

  const spinner = $mp('join-spinner');
  spinner.classList.remove('hidden');
  $mp('btn-join-go').disabled = true;
  $mp('join-error').textContent = '';

  try {
    await initChannel(code, false);
    MP.isHost = false;
    MP.isMultiplayer = true;
    MP.roomCode = code;
    MP.gameStarted = false;
    localStorage.setItem('setsot_active_room', code);
    
    // Send join request via broadcast
    const profile = ProfileMgr.get();
    MP.channel.send({
      type: 'broadcast',
      event: 'guest_msg',
      payload: {
        senderId: MP.myPeerId,
        data: {
          type: 'join',
          profile: profile
        }
      }
    });

  } catch (err) {
    spinner.classList.add('hidden');
    $mp('btn-join-go').disabled = false;
    $mp('join-error').textContent = 'Gagal terhubung';
    console.error('Join error:', err);
  }
}

/* ============================================================
 *  7. SUPABASE CHANNEL MANAGEMENT
 * ============================================================ */
function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

function initChannel(roomCode, isHost = false, preserveState = false) {
  return new Promise((resolve, reject) => {
    destroyChannel(preserveState);
    
    let storedId = localStorage.getItem('setsot_client_id');
    if (!storedId) {
      storedId = generateId();
      localStorage.setItem('setsot_client_id', storedId);
    }
    MP.myPeerId = storedId;
    
    MP.channel = supabaseClient.channel('room-' + roomCode, {
      config: { presence: { key: MP.myPeerId } }
    });

    if (isHost) {
      MP.channel.on('broadcast', { event: 'guest_msg' }, ({ payload }) => {
        handleHostData(payload.senderId, payload.data);
      });
      MP.channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
        for (const presence of leftPresences) {
           handlePlayerDisconnect(presence.peerId);
        }
      });
    } else {
      MP.channel.on('broadcast', { event: 'host_msg' }, ({ payload }) => {
        if (payload.target && payload.target !== MP.myPeerId) return;
        if (payload.exclude && payload.exclude === MP.myPeerId) return;
        handleGuestData(payload.data);
      });
      MP.channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
        for (const presence of leftPresences) {
          handleHostDisconnect(presence.peerId);
        }
      });
    }

    let hasResolved = false;
    MP.channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        if (!isHost) {
           await MP.channel.track({ peerId: MP.myPeerId });
        }
        hasResolved = true;
        resolve(MP.myPeerId);
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (!hasResolved) {
          reject(new Error('Koneksi gagal atau timeout'));
        } else if (MP.isMultiplayer && MP.gameStarted) {
          showDisconnectOverlay();
          // Attempt auto-reconnection after a delay
          if (!MP.isHost && MP.roomCode) {
            setTimeout(() => {
              if (MP.isMultiplayer && MP.gameStarted) {
                autoRejoinRoom(MP.roomCode);
              }
            }, 3000);
          }
        }
      }
    });

    setTimeout(() => {
       if (MP.channel && MP.channel.state !== 'joined') {
         reject(new Error('Timeout'));
       }
    }, 10000);
  });
}

function destroyChannel(preserveState = false) {
  if (MP.channel) {
    try { supabaseClient.removeChannel(MP.channel); } catch(e){}
    MP.channel = null;
  }
  if (!preserveState) {
    MP.connections = [];
    MP.players = [];
    MP.gameStarted = false;
    clearTurnTimer();
  }
}

function handleHostData(senderId, data) {
  switch (data.type) {
    case 'join': {
      // Check if this player is rejoining an active game
      const existingPlayerIdx = MP.players.findIndex(p => p.peerId === senderId);
      if (MP.gameStarted && existingPlayerIdx !== -1) {
        // Rejoining player!
        MP.players[existingPlayerIdx].connected = true;
        
        // If they were the host but we are now the host, demote them to guest
        if (MP.players[existingPlayerIdx].isHost) {
          MP.players[existingPlayerIdx].isHost = false;
        }
        
        // Find corresponding G.player
        const gPlayerIdx = G.players.findIndex(p => p.peerId === senderId);
        if (gPlayerIdx !== -1) {
          G.players[gPlayerIdx].isBot = false; // Stop bot play
          G.players[gPlayerIdx].replacedByBot = false;
        }

        addChatMessage('system', `${data.profile.name} terhubung kembali!`);
        hideVoteOverlay(senderId);
        
        // Notify others
        broadcastFromHost({
          type: 'player_reconnected',
          peerId: senderId,
          playerName: data.profile.name
        });

        // Send current lobby state & game state to the rejoining player
        const personalState = {
          type: 'game_state_update',
          currentIdx: G.currentIdx,
          roundLeaderIdx: G.roundLeaderIdx,
          currentPattern: G.currentPattern,
          tableCards: G.tableCards,
          roundNum: G.roundNum,
          gameOver: G.gameOver,
          winners: G.winners || [],
          passedPlayers: [...G.passedPlayers],
          players: G.players.map(p => ({
            name: p.name,
            handCount: p.hand.length,
            avatar: p.avatar,
            profile: p.profile,
            peerId: p.peerId
          })),
          logs: G.logs.slice(-8),
          myHand: G.players[gPlayerIdx].hand,
          allHands: G.players.map(p => p.hand),
          myIndex: gPlayerIdx
        };
        sendToPlayer(senderId, personalState);
        
        // If it is currently their turn, trigger 'your_turn' to wake them up
        if (G.currentIdx === gPlayerIdx && !G.gameOver) {
          sendToPlayer(senderId, {
            type: 'your_turn',
            currentPattern: G.currentPattern,
            tableCards: G.tableCards,
            hand: G.players[gPlayerIdx].hand,
            roundNum: G.roundNum,
            currentIdx: G.currentIdx
          });
        }
        
        if (typeof renderOpponents === 'function') renderOpponents();
        return;
      }

      const activePlayers = MP.players.filter(p => p.connected);
      if (activePlayers.length >= MP.settings.maxPlayers) {
        sendToPlayer(senderId, { type: 'error', message: 'Room penuh' });
        return;
      }
      if (MP.gameStarted) {
        sendToPlayer(senderId, { type: 'error', message: 'Game sudah dimulai' });
        return;
      }

      const playerInfo = {
        peerId: senderId,
        profile: data.profile,
        isHost: false,
        connected: true
      };
      MP.players.push(playerInfo);

      sendToPlayer(senderId, {
        type: 'lobby_state',
        players: MP.players.map(p => ({
          peerId: p.peerId,
          profile: p.profile,
          isHost: p.isHost,
          connected: p.connected
        })),
        settings: MP.settings,
        roomCode: MP.roomCode
      });

      broadcastFromHost({
        type: 'player_joined',
        player: playerInfo,
        players: MP.players
      });

      addChatMessage('system', `${data.profile.name} bergabung`);
      renderLobbyPlayers();
      break;
    }

    case 'chat': {
      addChatMessage(data.senderName, data.message, data.senderProfile);
      broadcastFromHost({
        type: 'chat',
        senderName: data.senderName,
        senderProfile: data.senderProfile,
        message: data.message
      }, senderId);
      break;
    }

    case 'game_action': {
      handleMultiplayerAction(data);
      break;
    }
  }
}

function broadcastFromHost(data, excludePeerId) {
  if (MP.channel) {
    MP.channel.send({
      type: 'broadcast',
      event: 'host_msg',
      payload: { exclude: excludePeerId, data }
    });
  }
}

function sendToPlayer(peerId, data) {
  if (MP.channel) {
    MP.channel.send({
      type: 'broadcast',
      event: 'host_msg',
      payload: { target: peerId, data }
    });
  }
}

function handlePlayerDisconnect(peerId) {
  const idx = MP.players.findIndex(p => p.peerId === peerId);
  if (idx === -1) return;

  if (!MP.gameStarted) {
    const name = MP.players[idx]?.profile?.name || 'Pemain';
    MP.players.splice(idx, 1);
    addChatMessage('system', `${name} keluar`);
    broadcastFromHost({ type: 'lobby_state', players: MP.players, settings: MP.settings, roomCode: MP.roomCode });
    renderLobbyPlayers();
  } else {
    MP.players[idx].connected = false;
    addChatMessage('system', `${MP.players[idx].profile.name} terputus (Menunggu voting...)`);
    broadcastFromHost({
      type: 'player_disconnected',
      peerId,
      playerName: MP.players[idx].profile.name
    });
    if (typeof renderOpponents === 'function') renderOpponents();

    // Set up voting state on host
    if (!MP.votes) MP.votes = {};
    MP.votes[peerId] = { bot: new Set(), kick: new Set() };
    
    // Show voting UI locally for the host (if host is still in the game)
    showVoteOverlay(peerId, MP.players[idx].profile.name);
  }
}

/* ============================================================
 *  9. GUEST — DATA HANDLING
 * ============================================================ */
function handleGuestData(data) {
  switch (data.type) {
    case 'error': {
      showToast(`❌ ${data.message}`);
      $mp('join-spinner')?.classList.add('hidden');
      const joinBtn = $mp('btn-join-go');
      if (joinBtn) joinBtn.disabled = false;
      $mp('join-error').textContent = data.message;
      destroyChannel();
      showScreen('join-room-screen');
      break;
    }

    case 'lobby_state': {
      $mp('join-spinner')?.classList.add('hidden');
      const joinBtn = $mp('btn-join-go');
      if (joinBtn) joinBtn.disabled = false;
      MP.players = data.players;
      MP.settings = data.settings;
      MP.roomCode = data.roomCode;
      showLobby();
      break;
    }

    case 'player_joined': {
      MP.players = data.players;
      addChatMessage('system', `${data.player.profile.name} bergabung`);
      renderLobbyPlayers();
      break;
    }

    case 'player_disconnected': {
      addChatMessage('system', `${data.playerName} terputus (Menunggu voting...)`);
      const p = MP.players.find(x => x.peerId === data.peerId);
      if (p) p.connected = false;
      if (typeof renderOpponents === 'function') renderOpponents();
      showVoteOverlay(data.peerId, data.playerName);
      break;
    }

    case 'player_reconnected': {
      addChatMessage('system', `${data.playerName} terhubung kembali!`);
      const p = MP.players.find(x => x.peerId === data.peerId);
      if (p) p.connected = true;
      hideVoteOverlay(data.peerId);
      if (typeof renderOpponents === 'function') renderOpponents();
      break;
    }

    case 'vote_resolved': {
      applyVoteResult(data.targetPeerId, data.actionType);
      break;
    }

    case 'settings_update': {
      MP.settings = data.settings;
      renderLobbySettings();
      break;
    }

    case 'chat': {
      addChatMessage(data.senderName, data.message, data.senderProfile);
      break;
    }

    case 'kicked': {
      showToast('❌ Kamu dikeluarkan dari room');
      localStorage.removeItem('setsot_active_room');
      destroyChannel();
      showScreen('menu-screen');
      break;
    }

    case 'game_start': {
      $mp('gameover-overlay').classList.add('hidden');
      $mp('human-win-overlay').classList.add('hidden');
      startMultiplayerGame(data);
      break;
    }

    case 'three_dump':
      G.tableCards = data.tableCards;
      G.currentIdx = data.startIdx;
      G.roundLeaderIdx = data.startIdx;
      
      // Update hands
      for (let i = 0; i < data.players.length; i++) {
         G.players[i].handCount = data.players[i].handCount;
      }
      if (data.myHand) G.players[G.myIndex].hand = data.myHand;
      
      // UI update for 3-dump
      const tableLabel = document.getElementById('table-label');
      const tablePattern = document.getElementById('table-pattern');
      const gameStatus = document.getElementById('game-status');
      
      if (tableLabel) tableLabel.textContent = 'Pembukaan: Semua kartu 3 dibuang!';
      if (tablePattern) tablePattern.textContent = data.summary;
      if (gameStatus) gameStatus.textContent = `${G.players[data.startIdx].name} menang pembukaan!`;
      
      if (typeof renderOpponents === 'function') renderOpponents();
      if (typeof renderPlayerHand === 'function') renderPlayerHand();
      
      const cardsEl = document.getElementById('table-cards');
      if (cardsEl) {
        cardsEl.innerHTML = '';
        for (const c of data.tableCards) {
          if (typeof renderCardElement === 'function') {
            cardsEl.appendChild(renderCardElement(c, false, false));
          }
        }
      }
      if (typeof playSound === 'function') playSound('play');
      if (typeof mpThreeDumpHook === 'function') mpThreeDumpHook();
      break;

    case 'game_state_update': {
      applyGameStateUpdate(data);
      break;
    }

    case 'your_turn': {
      handleYourTurn(data);
      break;
    }

    case 'turn_info': {
      handleTurnInfo(data);
      break;
    }

    case 'game_over': {
      handleMultiplayerGameOver(data);
      break;
    }
  }
}

/* ============================================================
 *  10. LOBBY UI
 * ============================================================ */
function showLobby() {
  showScreen('lobby-screen');
  $mp('lobby-code-text').textContent = MP.roomCode;
  renderLobbyPlayers();
  renderLobbySettings();

  // Show/hide host controls
  if (MP.isHost) {
    $mp('lobby-settings').classList.remove('hidden');
    $mp('lobby-settings-guest').classList.add('hidden');
    $mp('btn-lobby-start').classList.remove('hidden');
    $mp('lobby-wait-msg').classList.add('hidden');
  } else {
    $mp('lobby-settings').classList.add('hidden');
    $mp('lobby-settings-guest').classList.remove('hidden');
    $mp('btn-lobby-start').classList.add('hidden');
    $mp('lobby-wait-msg').classList.remove('hidden');
  }
}

function renderLobbyPlayers() {
  const list = $mp('lobby-player-list');
  list.innerHTML = '';
  const activePlayers = MP.players.filter(p => p.connected);

  for (const p of MP.players) {
    if (!p.connected) continue;
    const item = document.createElement('div');
    item.className = 'lobby-player-item';

    const avatarEl = document.createElement('div');
    avatarEl.className = 'lobby-player-avatar';
    renderAvatarStyle(avatarEl, p.profile);

    const nameEl = document.createElement('span');
    nameEl.className = 'lobby-player-name';
    nameEl.textContent = p.profile.name;

    item.appendChild(avatarEl);
    item.appendChild(nameEl);

    // Host badge
    if (p.isHost) {
      const badge = document.createElement('span');
      badge.className = 'lobby-player-host-badge';
      badge.textContent = 'HOST';
      item.appendChild(badge);
    }

    // You badge
    if (p.peerId === MP.myPeerId) {
      const badge = document.createElement('span');
      badge.className = 'lobby-player-you-badge';
      badge.textContent = 'KAMU';
      item.appendChild(badge);
    }

    // Kick button (host only, not self)
    if (MP.isHost && p.peerId !== MP.myPeerId) {
      const kickBtn = document.createElement('button');
      kickBtn.className = 'lobby-kick-btn';
      kickBtn.textContent = 'Kick';
      kickBtn.addEventListener('click', () => kickPlayer(p.peerId));
      item.appendChild(kickBtn);
    }

    list.appendChild(item);
  }

  $mp('lobby-player-count').textContent = `${activePlayers.length} / ${MP.settings.maxPlayers}`;

  // Enable/disable start button
  const startBtn = $mp('btn-lobby-start');
  if (startBtn && MP.isHost) {
    startBtn.disabled = activePlayers.length < 2;
  }
}

function renderLobbySettings() {
  if (MP.isHost) {
    $mp('val-lobby-decks').textContent = MP.settings.decks;
    const total = MP.settings.decks * 56;
    const activePlayers = MP.players.filter(p => p.connected).length;
    const per = activePlayers > 0 ? Math.floor(total / activePlayers) : total;
    $mp('lobby-setting-info').textContent = `${total} kartu · ~${per} kartu/pemain`;
  } else {
    $mp('lobby-guest-decks').textContent = MP.settings.decks;
    $mp('lobby-guest-max').textContent = MP.settings.maxPlayers;
  }
}

function kickPlayer(peerId) {
  sendToPlayer(peerId, { type: 'kicked' });
  const name = MP.players.find(p => p.peerId === peerId)?.profile?.name || 'Pemain';
  MP.players = MP.players.filter(p => p.peerId !== peerId);
  addChatMessage('system', `${name} dikeluarkan`);
  broadcastFromHost({ type: 'lobby_state', players: MP.players, settings: MP.settings, roomCode: MP.roomCode });
  renderLobbyPlayers();
}

function initLobbyUI() {
  // Copy room code
  $mp('lobby-code-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(MP.roomCode).then(() => {
      showToast('📋 Kode disalin!');
    }).catch(() => {
      showToast(`Kode: ${MP.roomCode}`);
    });
  });

  // Leave
  $mp('lobby-leave').addEventListener('click', () => {
    localStorage.removeItem('setsot_active_room');
    destroyChannel();
    MP.isMultiplayer = false;
    showScreen('menu-screen');
  });

  // Lobby deck stepper
  $mp('stepper-lobby-decks').addEventListener('click', e => {
    if (!MP.isHost) return;
    const btn = e.target.closest('.stepper-btn');
    if (!btn) return;
    MP.settings.decks = Math.max(1, Math.min(4, MP.settings.decks + (+btn.dataset.dir)));
    renderLobbySettings();
    broadcastFromHost({ type: 'settings_update', settings: MP.settings });
  });

  // Start game
  $mp('btn-lobby-start').addEventListener('click', () => {
    if (!MP.isHost) return;
    const activePlayers = MP.players.filter(p => p.connected);
    if (activePlayers.length < 2) {
      showToast('Minimal 2 pemain untuk mulai');
      return;
    }
    const total = MP.settings.decks * 56;
    const per = Math.floor(total / activePlayers.length);
    if (per < 5) {
      showToast('Kartu terlalu sedikit per pemain. Tambah dek.');
      return;
    }
    hostStartGame();
  });

  // Chat
  const sendChat = () => {
    const input = $mp('lobby-chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';

    const profile = ProfileMgr.get();
    addChatMessage(profile.name, msg, profile);

    if (MP.isHost) {
      broadcastFromHost({
        type: 'chat',
        senderName: profile.name,
        senderProfile: profile,
        message: msg
      });
    } else {
      MP.channel.send({
        type: 'broadcast', event: 'guest_msg', payload: {
          senderId: MP.myPeerId,
          data: {
            type: 'chat',
            senderName: profile.name,
            senderProfile: profile,
            message: msg
          }
        }
      });
    }
  };

  $mp('lobby-chat-send').addEventListener('click', sendChat);
  $mp('lobby-chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendChat();
  });
}

/* ============================================================
 *  11. CHAT SYSTEM
 * ============================================================ */
function addChatMessage(sender, message, senderProfile) {
  const msg = { sender, message, senderProfile, time: Date.now() };
  MP.chatMessages.push(msg);
  if (MP.chatMessages.length > 100) MP.chatMessages.shift();

  // Render in lobby chat
  renderChatLog('lobby-chat-log');

  // Render in game chat if visible
  if (MP.gameStarted) {
    renderChatLog('ingame-chat-log');
    // Show badge if panel closed
    const panel = $mp('ingame-chat-panel');
    if (panel && panel.classList.contains('hidden')) {
      MP.unreadChat++;
      const badge = $mp('ingame-chat-badge');
      if (badge) {
        badge.textContent = MP.unreadChat;
        badge.classList.remove('hidden');
      }
    }
  }
}

function renderChatLog(elementId) {
  const el = $mp(elementId);
  if (!el) return;

  el.innerHTML = '';
  const recent = MP.chatMessages.slice(-30);
  for (const msg of recent) {
    const div = document.createElement('div');
    if (msg.sender === 'system') {
      div.className = 'chat-msg chat-msg-system';
      div.textContent = `— ${msg.message} —`;
    } else {
      div.className = 'chat-msg';
      div.innerHTML = `<strong>${escapeHtml(msg.sender)}</strong>: ${escapeHtml(msg.message)}`;
    }
    el.appendChild(div);
  }
  el.scrollTop = el.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function initIngameChatUI() {
  const toggle = $mp('ingame-chat-toggle');
  const panel = $mp('ingame-chat-panel');
  const closeBtn = $mp('ingame-chat-close');

  if (toggle) {
    toggle.addEventListener('click', () => {
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) {
        MP.unreadChat = 0;
        $mp('ingame-chat-badge').classList.add('hidden');
        renderChatLog('ingame-chat-log');
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => panel.classList.add('hidden'));
  }

  // Send chat in game
  const sendIngameChat = () => {
    const input = $mp('ingame-chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';

    const profile = ProfileMgr.get();
    addChatMessage(profile.name, msg, profile);

    if (MP.isHost) {
      broadcastFromHost({
        type: 'chat',
        senderName: profile.name,
        senderProfile: profile,
        message: msg
      });
    } else {
      MP.channel.send({
        type: 'broadcast', event: 'guest_msg', payload: {
          senderId: MP.myPeerId,
          data: {
            type: 'chat',
            senderName: profile.name,
            senderProfile: profile,
            message: msg
          }
        }
      });
    }
  };

  $mp('ingame-chat-send')?.addEventListener('click', sendIngameChat);
  $mp('ingame-chat-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendIngameChat();
  });
}

/* ============================================================
 *  12. HOST — START GAME
 * ============================================================ */
function hostStartGame(isRestart = false) {
  MP.gameStarted = true;

  const activePlayers = MP.players.filter(p => p.connected);
  const numPlayers = activePlayers.length;
  const numDecks = MP.settings.decks;

  if (isRestart && G.winners && G.winners.length > 0) {
    G.previousWinnerIdx = G.winners[0];
  }

  // Initialize game state on host
  G.numPlayers = numPlayers;
  G.numDecks = numDecks;
  G.isFirstGame = !isRestart;
  G.difficulty = 'normal';
  initGame();

  // Assign players: map MP.players indices to G.players indices
  for (let i = 0; i < numPlayers; i++) {
    const mp = activePlayers[i];
    G.players[i].name = mp.profile.name;
    G.players[i].isHuman = (mp.peerId === MP.myPeerId);
    G.players[i].avatar = mp.profile.symbol;
    G.players[i].peerId = mp.peerId;
    G.players[i].profile = mp.profile;
    G.players[i].isBot = false;
  }

  // Build the game start payload for guests
  for (let i = 0; i < numPlayers; i++) {
    const mp = activePlayers[i];
    if (mp.peerId === MP.myPeerId) continue; // host handles self

    const payload = {
      type: 'game_start',
      myIndex: i,
      numPlayers,
      numDecks,
      players: G.players.map((p, idx) => ({
        name: p.name,
        avatar: p.avatar,
        profile: p.profile,
        handCount: p.hand.length,
        peerId: p.peerId,
        hand: idx === i ? p.hand : null // only send their own hand
      })),
      currentIdx: G.currentIdx,
      roundLeaderIdx: G.roundLeaderIdx,
      roomCode: MP.roomCode
    };

    sendToPlayer(mp.peerId, payload);
  }

  // Show game screen for host
  MP.isMultiplayer = true;
  showScreen('game-screen');
  $mp('ingame-chat-toggle')?.classList.remove('hidden');

  showDealAnimation().then(async () => {
    renderGame();
    if (G.isFirstGame) {
      // 3-dump check for the first game
      await performThreeDump();
    } else {
      addLog(`Game mulai! ${G.players[G.currentIdx].name} jalan duluan.`);
    }
    renderGame();
    hostScheduleTurn();
  });
}

window.mpThreeDumpHook = function(allThrees, startIdx, summary) {
  if (MP.isHost) {
    for (const p of MP.players) {
      if (p.peerId === MP.myPeerId) continue;
      const pIdx = G.players.findIndex(x => x.peerId === p.peerId);
      sendToPlayer(p.peerId, {
        type: 'three_dump',
        tableCards: allThrees,
        startIdx: startIdx,
        summary: summary,
        myHand: pIdx >= 0 ? G.players[pIdx].hand : null,
        players: G.players.map(p => ({ handCount: p.hand.length }))
      });
    }
  }
};

/* ============================================================
 *  13. GUEST — START GAME
 * ============================================================ */
function startMultiplayerGame(data) {
  MP.gameStarted = true;
  const { myIndex, numPlayers, numDecks, players, currentIdx, roundLeaderIdx } = data;

  G.numPlayers = numPlayers;
  G.numDecks = numDecks;
  G.isFirstGame = true;
  G.gameOver = false;
  G.winners = [];
  G.roundNum = 1;
  G.currentPattern = null;
  G.tableCards = [];
  G.passedPlayers = new Set();
  G.selectedIds = new Set();
  G.logs = [];
  G.busy = false;
  G.currentIdx = currentIdx;
  G.roundLeaderIdx = roundLeaderIdx;

  // Create players
  G.players = [];
  for (let i = 0; i < numPlayers; i++) {
    const pd = players[i];
    G.players.push({
      name: pd.name,
      hand: pd.hand || [],  // only own hand has cards
      isHuman: (i === myIndex),
      avatar: pd.avatar,
      profile: pd.profile,
      peerId: pd.peerId,
      handCount: pd.handCount,
      isBot: false
    });
  }

  // Store my index
  G.myIndex = myIndex;

  showScreen('game-screen');
  $mp('ingame-chat-toggle')?.classList.remove('hidden');

  showDealAnimation().then(() => {
    addLog(`Game mulai! ${G.players[G.currentIdx].name} jalan duluan.`);
    renderGame();
  });
}

/* ============================================================
 *  14. HOST — GAME TURN MANAGEMENT
 * ============================================================ */
function hostScheduleTurn() {
  if (G.gameOver) return;

  const p = G.players[G.currentIdx];

  // Check if this player is disconnected — treat as bot
  const mpPlayer = MP.players.find(x => x.peerId === p.peerId);
  const isDisconnected = mpPlayer && !mpPlayer.connected;

  if (p.peerId === MP.myPeerId && !isDisconnected) {
    // Host's turn
    G.busy = false;
    G.selectedIds.clear();
    renderGame();

    // Your turn animation
    const anim = $mp('your-turn-anim');
    anim.classList.remove('play');
    void anim.offsetWidth;
    anim.classList.add('play');
    playSound('yourTurn');

    // Notify all guests whose turn it is
    broadcastGameState();
  } else if (isDisconnected && p.replacedByBot) {
    // Bot plays for disconnected player who has been voted to be replaced
    G.busy = true;
    renderGame();
    broadcastGameState();
    const targetIdx = G.currentIdx;
    setTimeout(() => {
      G.busy = false;
      if (G.currentIdx === targetIdx && p.replacedByBot) {
        performAITurn();
      }
    }, 1500 + Math.random() * 1000);
  } else if (isDisconnected && !p.replacedByBot) {
    // Disconnected player who has NOT been voted to be replaced yet:
    // Game waits, do nothing (wait for voting)
    G.busy = true;
    renderGame();
    broadcastGameState();
  } else {
    // Another player's turn — notify them
    G.busy = true;
    renderGame();

    sendToPlayer(p.peerId, {
      type: 'your_turn',
      currentPattern: G.currentPattern,
      tableCards: G.tableCards,
      hand: G.players[G.currentIdx].hand,
      roundNum: G.roundNum,
      currentIdx: G.currentIdx
    });

    // Broadcast turn info to all others
    broadcastGameState();
  }
}

function broadcastGameState() {
  const state = {
    type: 'game_state_update',
    currentIdx: G.currentIdx,
    roundLeaderIdx: G.roundLeaderIdx,
    currentPattern: G.currentPattern,
    tableCards: G.tableCards,
    roundNum: G.roundNum,
    gameOver: G.gameOver,
    winners: G.winners || [],
    passedPlayers: [...G.passedPlayers],
    players: G.players.map((p, idx) => ({
      name: p.name,
      handCount: p.hand.length,
      avatar: p.avatar,
      profile: p.profile,
      peerId: p.peerId
    })),
    allHands: G.players.map(p => p.hand),
    logs: G.logs.slice(-8)
  };

  // Send to each guest with their own hand
  for (const p of MP.players) {
    if (p.peerId === MP.myPeerId) continue;
    const playerIdx = G.players.findIndex(x => x.peerId === p.peerId);
    const personalState = { ...state };
    if (playerIdx !== -1) {
      personalState.myHand = G.players[playerIdx].hand;
      personalState.myIndex = playerIdx;
    }
    sendToPlayer(p.peerId, personalState);
  }
}

/* ============================================================
 *  15. GUEST — HANDLE TURNS
 * ============================================================ */
function handleYourTurn(data) {
  // Update my hand, preserving local drag-and-drop order
  G.players[G.myIndex].hand = mergeHandPreservingOrder(G.players[G.myIndex].hand, data.hand);
  G.currentPattern = data.currentPattern;
  G.tableCards = data.tableCards;
  G.roundNum = data.roundNum;
  G.currentIdx = data.currentIdx;
  G.busy = false;
  G.selectedIds.clear();
  renderGame();

  // Your turn animation
  const anim = $mp('your-turn-anim');
  anim.classList.remove('play');
  void anim.offsetWidth;
  anim.classList.add('play');
  playSound('yourTurn');
}

function handleTurnInfo(data) {
  G.currentIdx = data.currentIdx;
  G.busy = true;
  if (G.players && G.players.length > 0) {
    renderGame();
  }
}

function applyGameStateUpdate(data) {
  G.currentIdx = data.currentIdx;
  G.roundLeaderIdx = data.roundLeaderIdx;
  G.currentPattern = data.currentPattern;
  G.tableCards = data.tableCards;
  G.roundNum = data.roundNum;
  G.gameOver = data.gameOver;
  G.winners = data.winners || [];
  G.passedPlayers = new Set(data.passedPlayers || []);
  G.logs = data.logs || G.logs;

  if (data.players) {
    G.numPlayers = data.players.length;
  }

  // Safely initialize G.players if it doesn't exist or is empty
  if ((!G.players || G.players.length === 0) && data.players) {
    G.players = data.players.map((pd, idx) => ({
      name: pd.name,
      hand: (idx === data.myIndex) ? (data.myHand || []) : [],
      isHuman: (idx === data.myIndex),
      avatar: pd.avatar,
      profile: pd.profile,
      peerId: pd.peerId,
      handCount: pd.handCount,
      isBot: false
    }));
    G.myIndex = data.myIndex;
  }

  // Safely initialize MP.players if it doesn't exist or is empty
  if ((!MP.players || MP.players.length === 0) && data.players) {
    MP.players = data.players.map(pd => ({
      peerId: pd.peerId,
      profile: pd.profile || { name: pd.name, symbol: pd.avatar },
      isHost: false,
      connected: true
    }));
  }

  // Ensure game is marked started and game-screen is visible
  if (!MP.gameStarted) {
    MP.gameStarted = true;
    showScreen('game-screen');
    const badge = $mp('ingame-chat-toggle');
    if (badge) badge.classList.remove('hidden');
  }

  // Update player hand counts
  for (let i = 0; i < data.players.length && i < G.players.length; i++) {
    G.players[i].handCount = data.players[i].handCount;
    G.players[i].name = data.players[i].name;
  }

  // Update own hand if provided, preserving local drag-and-drop order
  if (data.myHand) {
    G.players[data.myIndex].hand = mergeHandPreservingOrder(G.players[data.myIndex].hand, data.myHand);
  }

  // Am I the current player?
  if (data.myIndex !== undefined) {
    G.myIndex = data.myIndex;
    G.players[G.myIndex].isHuman = true;
  }

  const isMyTurn = (G.currentIdx === G.myIndex) && !G.gameOver;
  G.busy = !isMyTurn;

  renderGame();

  if (G.gameOver && G.winners.length > 0) {
    handleMultiplayerGameOver(data);
  }
}

function sendActionToHost(action, payload) {
  if (!MP.channel) return;
  
  let actionStr = action;
  let finalPayload = payload || {};
  if (typeof action === 'object' && action !== null) {
    actionStr = action.action;
    finalPayload = { ...action };
    delete finalPayload.action;
  }

  MP.channel.send({
    type: 'broadcast', event: 'guest_msg', payload: { senderId: MP.myPeerId, data: {
      type: 'game_action',
      action: actionStr,
      ...finalPayload,
      playerPeerId: MP.myPeerId
    }}
  });
}

/* ============================================================
 *  16. HOST — HANDLE GAME ACTIONS FROM GUESTS
 * ============================================================ */
function handleMultiplayerAction(data) {
  if (!MP.isHost) return;
  
  if (data.action === 'vote') {
    handleVoteCast(data.playerPeerId, data.targetPeerId, data.voteType);
    return;
  }

  const playerIdx = G.players.findIndex(p => p.playerPeerId === data.playerPeerId || p.peerId === data.playerPeerId);
  if (playerIdx === -1 || playerIdx !== G.currentIdx) return;

  clearTurnTimer();

  if (data.action === 'pass') {
    executePass(playerIdx);
  } else if (data.action === 'play') {
    const hand = G.players[playerIdx].hand;
    const cards = data.cardIds.map(id => hand.find(c => c.id === id)).filter(Boolean);
    if (cards.length === 0) return;

    const pattern = detectPattern(cards);
    if (!pattern) {
      sendToPlayer(data.playerPeerId, { type: 'action_error', message: 'Kombinasi tidak valid' });
      return;
    }

    if (G.currentPattern && !canBeat(pattern, G.currentPattern)) {
      sendToPlayer(data.playerPeerId, { type: 'action_error', message: 'Kartu tidak cukup kuat' });
      return;
    }

    // Check bomb opening rule
    if (!G.currentPattern) {
      if (pattern.type === 'BOMB' || pattern.type === 'BLACK_JOKER_BOMB' || pattern.type === 'RED_JOKER_BOMB') {
        sendToPlayer(data.playerPeerId, { type: 'action_error', message: 'Bom tidak bisa untuk membuka' });
        return;
      }
    }

    executePlay(playerIdx, cards);
  }
}

/* ============================================================
 *  17. TURN TIMER
 * ============================================================ */
function startTurnTimer(onTimeout, isMyTurn = true) {
  // Timer dihapus secara total sesuai permintaan
}

function clearTurnTimer() {
  // Timer dihapus secara total sesuai permintaan
}

/* ============================================================
 *  18. MULTIPLAYER GAME OVER
 * ============================================================ */
function handleMultiplayerGameOver(data) {
  G.gameOver = true;
  clearTurnTimer();
  showGameOver();
}

/* ============================================================
 *  19. DISCONNECT HANDLING
 * ============================================================ */
function showDisconnectOverlay() {
  $mp('disconnect-overlay')?.classList.remove('hidden');
}

/* ============================================================
 *  20. MULTIPLAYER-AWARE GAME HOOKS
 *  These override/hook into game.js functions
 * ============================================================ */

// Store original functions
const _origExecutePlay = typeof executePlay !== 'undefined' ? executePlay : null;
const _origExecutePass = typeof executePass !== 'undefined' ? executePass : null;
const _origAdvanceAndContinue = typeof advanceAndContinue !== 'undefined' ? advanceAndContinue : null;

// Override advanceAndContinue for multiplayer
const _origScheduleTurn = typeof scheduleTurn !== 'undefined' ? scheduleTurn : null;

// Patch scheduleTurn for multiplayer
function patchGameForMultiplayer() {
  // We'll use a flag check approach instead of overriding
  // The game.js functions are already defined and will check MP.isMultiplayer
}

// Player play handler for multiplayer
function multiplayerPlayerPlay() {
  if (G.gameOver || G.busy) return;

  const myIdx = MP.isHost
    ? G.players.findIndex(p => p.peerId === MP.myPeerId)
    : G.myIndex;

  if (G.currentIdx !== myIdx) return;

  const hand = G.players[myIdx].hand;
  const sel = hand.filter(c => G.selectedIds.has(c.id));
  if (sel.length === 0) { showToast('Pilih kartu terlebih dahulu'); return; }

  const pattern = detectPattern(sel);
  if (!pattern) { showToast('Kombinasi kartu tidak valid'); return; }

  if (G.currentPattern) {
    if (!canBeat(pattern, G.currentPattern)) {
      showToast('Kartu tidak cukup kuat untuk menimpa'); return;
    }
  } else {
    if (pattern.type === 'BOMB' || pattern.type === 'BLACK_JOKER_BOMB' || pattern.type === 'RED_JOKER_BOMB') {
      showToast('Bom hanya bisa digunakan untuk melawan Joker atau Bom lain');
      return;
    }
  }

  clearTurnTimer();
  G.selectedIds.clear();

  if (MP.isHost) {
    executePlay(myIdx, sel);
  } else {
    // Send to host
    sendActionToHost({
      action: 'play',
      cardIds: sel.map(c => c.id)
    });
    G.busy = true;
    renderGame();
  }
}

function multiplayerPlayerPass() {
  if (G.gameOver || G.busy) return;

  const myIdx = MP.isHost
    ? G.players.findIndex(p => p.peerId === MP.myPeerId)
    : G.myIndex;

  if (G.currentIdx !== myIdx) return;
  if (!G.currentPattern) { showToast('Kamu harus memainkan kartu untuk memulai'); return; }

  clearTurnTimer();
  G.selectedIds.clear();

  if (MP.isHost) {
    executePass(myIdx);
  } else {
    sendActionToHost({ action: 'pass' });
    G.busy = true;
    renderGame();
  }
}

/* ============================================================
 *  21. INITIALIZATION
 * ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  ProfileMgr.load();
  initProfileUI();
  initCreateRoomUI();
  initJoinRoomUI();
  initLobbyUI();
  initIngameChatUI();

  // Auto rejoin if active room exists
  const activeRoom = localStorage.getItem('setsot_active_room');
  if (activeRoom) {
    autoRejoinRoom(activeRoom);
  }

  // Menu buttons
  $mp('btn-solo').addEventListener('click', () => {
    MP.isMultiplayer = false;
    G.myIndex = 0;
    $mp('ingame-chat-toggle')?.classList.add('hidden');
    $mp('ingame-chat-panel')?.classList.add('hidden');
    showScreen('setup-screen');
  });

  $mp('btn-create-room').addEventListener('click', () => showScreen('create-room-screen'));
  $mp('btn-join-room').addEventListener('click', () => showScreen('join-room-screen'));

  // Profile
  $mp('menu-profile-btn').addEventListener('click', () => {
    // Sync current profile to editor
    const profile = ProfileMgr.get();
    $mp('profile-name-input').value = profile.name;
    document.querySelectorAll('.psym-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.symbol === profile.symbol);
    });
    document.querySelectorAll('.pcolor-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.color === profile.color);
    });
    updateProfilePreview(profile.name, profile.symbol, profile.color);
    showScreen('profile-screen');
  });

  // Solo back button
  $mp('solo-back')?.addEventListener('click', () => showScreen('menu-screen'));

  // Back to menu from disconnect
  $mp('btn-back-menu')?.addEventListener('click', () => {
    localStorage.removeItem('setsot_active_room');
    $mp('disconnect-overlay')?.classList.add('hidden');
    destroyChannel();
    MP.isMultiplayer = false;
    showScreen('menu-screen');
  });
});

/* ============================================================
 *  22. VOTING & RECONNECT SYSTEM
 * ============================================================ */
function showVoteOverlay(peerId, playerName) {
  if (document.getElementById('vote-overlay-' + peerId)) return;

  const div = document.createElement('div');
  div.id = 'vote-overlay-' + peerId;
  div.className = 'overlay';
  div.style.zIndex = '140';

  div.innerHTML = `
    <div class="overlay-card" style="padding: 24px;">
      <div class="overlay-icon" style="font-size: 40px; margin-bottom: 8px;">🗳️</div>
      <h3 style="margin-bottom: 8px; font-size: 18px; font-weight: 700; color: #1D1D1F;">Pemain Terputus</h3>
      <p style="font-size: 14px; margin-bottom: 16px; color: #636366;">
        <strong>${playerName}</strong> terputus. Pilih tindakan untuk melanjutkan permainan:
      </p>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <button class="btn-primary vote-btn-bot" style="height: 40px; font-size: 14px;">🤖 Gantikan dengan Bot</button>
        <button class="btn-primary vote-btn-kick" style="height: 40px; font-size: 14px; background: #FF3B30; box-shadow: 0 2px 8px rgba(255,59,48,0.25);">❌ Kick Pemain</button>
        <button class="btn-primary vote-btn-wait" style="height: 40px; font-size: 14px; background: #E5E5EA; color: #1D1D1F; box-shadow: none;">⏳ Tunggu Pemain</button>
      </div>
    </div>
  `;

  div.querySelector('.vote-btn-bot').addEventListener('click', () => submitVote(peerId, 'bot'));
  div.querySelector('.vote-btn-kick').addEventListener('click', () => submitVote(peerId, 'kick'));
  div.querySelector('.vote-btn-wait').addEventListener('click', () => submitVote(peerId, 'wait'));

  document.body.appendChild(div);
}

function hideVoteOverlay(peerId) {
  const el = document.getElementById('vote-overlay-' + peerId);
  if (el) el.remove();
}

function submitVote(peerId, voteType) {
  // Update UI to highlight selected vote type instead of hiding immediately
  const overlay = document.getElementById('vote-overlay-' + peerId);
  if (overlay) {
    overlay.querySelectorAll('.btn-primary').forEach(btn => {
      btn.style.opacity = '0.6';
      btn.style.border = 'none';
    });
    const activeBtn = overlay.querySelector('.vote-btn-' + voteType);
    if (activeBtn) {
      activeBtn.style.opacity = '1';
      activeBtn.style.border = '2px solid #007AFF';
    }
    let statusEl = overlay.querySelector('.vote-status');
    if (!statusEl) {
      statusEl = document.createElement('p');
      statusEl.className = 'vote-status';
      statusEl.style.fontSize = '13px';
      statusEl.style.color = '#8E8E93';
      statusEl.style.marginTop = '12px';
      statusEl.style.marginBottom = '0';
      overlay.querySelector('.overlay-card').appendChild(statusEl);
    }
    const label = voteType === 'bot' ? 'Gantikan Bot' : voteType === 'kick' ? 'Kick' : 'Tunggu';
    statusEl.textContent = `Pilihan kamu: ${label}. Menunggu pilihan pemain lain...`;
  }
  
  if (MP.isHost) {
    handleVoteCast(MP.myPeerId, peerId, voteType);
  } else {
    sendActionToHost({
      action: 'vote',
      targetPeerId: peerId,
      voteType: voteType
    });
  }
}

function handleVoteCast(voterPeerId, targetPeerId, voteType) {
  if (!MP.isHost) return;
  if (!MP.votes) MP.votes = {};
  if (!MP.votes[targetPeerId]) {
    MP.votes[targetPeerId] = { bot: new Set(), kick: new Set(), wait: new Set() };
  }

  MP.votes[targetPeerId].bot.delete(voterPeerId);
  MP.votes[targetPeerId].kick.delete(voterPeerId);
  MP.votes[targetPeerId].wait.delete(voterPeerId);

  if (voteType === 'bot') {
    MP.votes[targetPeerId].bot.add(voterPeerId);
  } else if (voteType === 'kick') {
    MP.votes[targetPeerId].kick.add(voterPeerId);
  } else {
    MP.votes[targetPeerId].wait.add(voterPeerId);
  }

  const activeConnected = MP.players.filter(p => p.connected && p.peerId !== targetPeerId);
  const totalVoters = activeConnected.length;

  const botVotes = MP.votes[targetPeerId].bot.size;
  const kickVotes = MP.votes[targetPeerId].kick.size;
  const waitVotes = MP.votes[targetPeerId].wait.size;

  const majority = Math.floor(totalVoters / 2) + 1;

  if (botVotes >= majority) {
    executeVoteAction(targetPeerId, 'bot');
  } else if (kickVotes >= majority) {
    executeVoteAction(targetPeerId, 'kick');
  } else if (waitVotes >= majority) {
    executeVoteAction(targetPeerId, 'wait');
  }
}

function executeVoteAction(targetPeerId, actionType) {
  if (!MP.isHost) return;
  
  if (MP.votes) delete MP.votes[targetPeerId];

  broadcastFromHost({
    type: 'vote_resolved',
    targetPeerId,
    actionType
  });

  applyVoteResult(targetPeerId, actionType);
}

function applyVoteResult(targetPeerId, actionType) {
  hideVoteOverlay(targetPeerId);

  const idx = G.players.findIndex(p => p.peerId === targetPeerId);
  if (idx === -1) return;

  const playerName = G.players[idx].name;

  if (actionType === 'bot') {
    G.players[idx].isBot = true;
    G.players[idx].replacedByBot = true;
    addLog(`Voting selesai: <strong>${playerName}</strong> digantikan oleh Bot.`);
    
    if (G.currentIdx === idx && !G.gameOver) {
      const targetIdx = G.currentIdx;
      setTimeout(() => {
        if (G.currentIdx === targetIdx && G.players[targetIdx].replacedByBot) {
          performAITurn();
        }
      }, 1000);
    }
  } else if (actionType === 'kick') {
    addLog(`Voting selesai: <strong>${playerName}</strong> di-kick dari permainan.`);
    
    G.players[idx].hand = [];
    G.players[idx].handCount = 0;
    
    if (G.currentIdx === idx && !G.gameOver) {
      executePass(idx);
    } else {
      if (typeof isRoundOver === 'function' && isRoundOver()) {
        setTimeout(() => startNewRound(G.roundLeaderIdx), 900);
      }
    }
  } else if (actionType === 'wait') {
    addLog(`Voting selesai: Menunggu <strong>${playerName}</strong> kembali.`);
  }

  if (typeof renderOpponents === 'function') renderOpponents();
}

async function autoRejoinRoom(code) {
  if (MP.reconnecting) return;
  MP.reconnecting = true;
  try {
    showDisconnectOverlay();
    
    await initChannel(code, false);
    MP.isHost = false;
    MP.isMultiplayer = true;
    MP.roomCode = code;
    MP.gameStarted = false;
    
    $mp('disconnect-overlay')?.classList.add('hidden');
    
    const profile = ProfileMgr.get();
    MP.channel.send({
      type: 'broadcast',
      event: 'guest_msg',
      payload: {
        senderId: MP.myPeerId,
        data: {
          type: 'join',
          profile: profile
        }
      }
    });
  } catch (err) {
    console.error('Auto rejoin failed:', err);
    $mp('disconnect-overlay')?.classList.add('hidden');
    showScreen('menu-screen');
  } finally {
    MP.reconnecting = false;
  }
}

function handleHostDisconnect(peerId) {
  const hostPlayer = MP.players.find(p => p.isHost);
  if (hostPlayer && hostPlayer.peerId === peerId) {
    // Mark host as disconnected in MP.players
    hostPlayer.connected = false;
    hostPlayer.isHost = false; // They are no longer host
    
    // Choose new host: the first active connected player
    const nextHost = MP.players.find(p => p.connected);
    if (nextHost) {
      nextHost.isHost = true;
      addChatMessage('system', `${nextHost.profile.name} sekarang menjadi Host baru!`);
      
      if (nextHost.peerId === MP.myPeerId) {
        // I am the new host!
        promoteToHost();
      } else {
        // Someone else is the new host
        addChatMessage('system', `Peralihan Host ke ${nextHost.profile.name}...`);
      }
    } else {
      // No one else is connected, terminate
      showHostDisconnectOverlay();
    }
  }
}

async function promoteToHost() {
  MP.isHost = true;
  
  try {
    // Re-initialize channel as host, preserving state
    await initChannel(MP.roomCode, true, true);
    
    // Track presence as host
    await MP.channel.track({ peerId: MP.myPeerId });

    // Update G.players to set peerId flags or local parameters
    const myGIdx = G.players.findIndex(p => p.peerId === MP.myPeerId);
    if (myGIdx !== -1) {
      G.myIndex = myGIdx;
    }
    
    // Broadcast the new host state to everyone
    broadcastGameState();
    
    // If it is currently our turn or the AI bot's turn, trigger it!
    hostScheduleTurn();
    
    addChatMessage('system', 'Anda sekarang adalah Host permainan.');
  } catch (err) {
    console.error('Promotion to host failed:', err);
    showHostDisconnectOverlay();
  }
}

function showHostDisconnectOverlay() {
  if (document.getElementById('host-disconnect-overlay')) return;
  
  $mp('disconnect-overlay')?.classList.add('hidden');
  document.querySelectorAll('[id^="vote-overlay-"]').forEach(el => el.remove());

  const div = document.createElement('div');
  div.id = 'host-disconnect-overlay';
  div.className = 'overlay';
  div.style.zIndex = '150';

  div.innerHTML = `
    <div class="overlay-card" style="padding: 24px; text-align: center;">
      <div class="overlay-icon" style="font-size: 40px; margin-bottom: 8px;">🏠</div>
      <h3 style="margin-bottom: 8px; font-size: 18px; font-weight: 700; color: #1D1D1F;">Host Terputus</h3>
      <p style="font-size: 14px; margin-bottom: 24px; color: #636366;">
        Host telah meninggalkan room atau terputus. Permainan dihentikan.
      </p>
      <button class="btn-primary btn-exit-menu" style="height: 40px; font-size: 14px;">Kembali ke Menu</button>
    </div>
  `;

  div.querySelector('.btn-exit-menu').addEventListener('click', () => {
    div.remove();
    localStorage.removeItem('setsot_active_room');
    destroyChannel();
    MP.isMultiplayer = false;
    showScreen('menu-screen');
  });

  document.body.appendChild(div);
}
