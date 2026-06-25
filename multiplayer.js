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
  peer: null,
  connections: [],     // host: array of { conn, profile, peerId }
  hostConn: null,      // guest: connection to host
  roomCode: '',
  myPeerId: '',
  players: [],         // { peerId, profile: {name, symbol, color}, isHost, connected }
  settings: { decks: 1, maxPlayers: 4 },
  gameStarted: false,
  turnTimer: null,
  turnTimerValue: 30,
  chatMessages: [],
  unreadChat: 0,
};

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
  avatar.style.background = hexToRGBA(profile.color, 0.2);
  avatar.style.color = profile.color;
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
    destroyPeer();
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
    await initPeer(peerId);
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

    // Listen for incoming connections
    MP.peer.on('connection', conn => handleHostIncoming(conn));

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
    destroyPeer();
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

  const hostPeerId = ROOM_PREFIX + code;

  try {
    await initPeer(null); // random ID for guest
    MP.isHost = false;
    MP.isMultiplayer = true;
    MP.roomCode = code;
    MP.gameStarted = false;

    // Connect to host
    const conn = MP.peer.connect(hostPeerId, { reliable: true });

    conn.on('open', () => {
      MP.hostConn = conn;
      // Send join request
      const profile = ProfileMgr.get();
      conn.send({
        type: 'join',
        profile,
        peerId: MP.myPeerId
      });
    });

    conn.on('data', data => handleGuestData(data));

    conn.on('close', () => {
      if (!MP.gameStarted) {
        showToast('❌ Koneksi terputus');
        showScreen('menu-screen');
      } else {
        showDisconnectOverlay();
      }
    });

    conn.on('error', err => {
      spinner.classList.add('hidden');
      $mp('btn-join-go').disabled = false;
      $mp('join-error').textContent = 'Room tidak ditemukan';
      console.error('Join error:', err);
    });

    // Timeout
    setTimeout(() => {
      if (!MP.hostConn) {
        spinner.classList.add('hidden');
        $mp('btn-join-go').disabled = false;
        $mp('join-error').textContent = 'Room tidak ditemukan atau sudah penuh';
        destroyPeer();
      }
    }, 8000);
  } catch (err) {
    spinner.classList.add('hidden');
    $mp('btn-join-go').disabled = false;
    $mp('join-error').textContent = 'Gagal terhubung';
    console.error('Join error:', err);
  }
}

/* ============================================================
 *  7. PEERJS MANAGEMENT
 * ============================================================ */
function initPeer(id) {
  return new Promise((resolve, reject) => {
    destroyPeer();
    try {
      MP.peer = id ? new Peer(id) : new Peer();
    } catch (e) {
      reject(e);
      return;
    }

    MP.peer.on('open', peerId => {
      MP.myPeerId = peerId;
      resolve(peerId);
    });

    MP.peer.on('error', err => {
      if (err.type === 'unavailable-id') {
        reject(new Error('Room code sudah digunakan'));
      } else {
        reject(err);
      }
    });

    // Timeout for peer opening
    setTimeout(() => reject(new Error('Timeout')), 10000);
  });
}

function destroyPeer() {
  if (MP.peer) {
    try { MP.peer.destroy(); } catch (e) { /* ignore */ }
    MP.peer = null;
  }
  MP.connections = [];
  MP.hostConn = null;
  MP.players = [];
  MP.gameStarted = false;
  clearTurnTimer();
}

/* ============================================================
 *  8. HOST — CONNECTION HANDLING
 * ============================================================ */
function handleHostIncoming(conn) {
  conn.on('open', () => {
    // Wait for join message
    conn.on('data', data => handleHostData(conn, data));

    conn.on('close', () => {
      handlePlayerDisconnect(conn.peer);
    });
  });
}

function handleHostData(conn, data) {
  switch (data.type) {
    case 'join': {
      // Check if room is full
      const activePlayers = MP.players.filter(p => p.connected);
      if (activePlayers.length >= MP.settings.maxPlayers) {
        conn.send({ type: 'error', message: 'Room penuh' });
        conn.close();
        return;
      }
      if (MP.gameStarted) {
        conn.send({ type: 'error', message: 'Game sudah dimulai' });
        conn.close();
        return;
      }

      // Add player
      const playerInfo = {
        peerId: data.peerId,
        profile: data.profile,
        isHost: false,
        connected: true
      };
      MP.players.push(playerInfo);
      MP.connections.push({ conn, peerId: data.peerId, profile: data.profile });

      // Send lobby state to new player
      conn.send({
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

      // Broadcast player joined to all
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
      }, conn.peer);
      break;
    }

    case 'game_action': {
      handleMultiplayerAction(data);
      break;
    }
  }
}

function broadcastFromHost(data, excludePeerId) {
  for (const c of MP.connections) {
    if (c.peerId !== excludePeerId && c.conn.open) {
      try { c.conn.send(data); } catch (e) { /* ignore */ }
    }
  }
}

function sendToPlayer(peerId, data) {
  const c = MP.connections.find(x => x.peerId === peerId);
  if (c && c.conn.open) {
    try { c.conn.send(data); } catch (e) { /* ignore */ }
  }
}

function handlePlayerDisconnect(peerId) {
  const idx = MP.players.findIndex(p => p.peerId === peerId);
  if (idx === -1) return;

  if (!MP.gameStarted) {
    // Remove from lobby
    MP.players.splice(idx, 1);
    MP.connections = MP.connections.filter(c => c.peerId !== peerId);
    const name = MP.players[idx]?.profile?.name || 'Pemain';
    addChatMessage('system', `${name} keluar`);
    broadcastFromHost({ type: 'lobby_state', players: MP.players, settings: MP.settings, roomCode: MP.roomCode });
    renderLobbyPlayers();
  } else {
    // Mark as disconnected, replace with bot
    MP.players[idx].connected = false;
    addChatMessage('system', `${MP.players[idx].profile.name} terputus (diganti Bot)`);
    broadcastFromHost({
      type: 'player_disconnected',
      peerId,
      playerName: MP.players[idx].profile.name
    });

    // If it was this player's turn, auto-pass
    if (G.currentIdx === idx && !G.gameOver) {
      setTimeout(() => {
        if (G.currentIdx === idx) {
          performAITurn();
        }
      }, 1000);
    }
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
      destroyPeer();
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
      addChatMessage('system', `${data.playerName} terputus (diganti Bot)`);
      const p = MP.players.find(x => x.peerId === data.peerId);
      if (p) p.connected = false;
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
      destroyPeer();
      showScreen('menu-screen');
      break;
    }

    case 'game_start': {
      MP.gameStarted = true;
      startMultiplayerGame(data);
      break;
    }

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
  const c = MP.connections.find(x => x.peerId === peerId);
  if (c) {
    c.conn.send({ type: 'kicked' });
    setTimeout(() => c.conn.close(), 200);
  }
  const name = MP.players.find(p => p.peerId === peerId)?.profile?.name || 'Pemain';
  MP.players = MP.players.filter(p => p.peerId !== peerId);
  MP.connections = MP.connections.filter(c => c.peerId !== peerId);
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
    destroyPeer();
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
    } else if (MP.hostConn) {
      MP.hostConn.send({
        type: 'chat',
        senderName: profile.name,
        senderProfile: profile,
        message: msg
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
    } else if (MP.hostConn) {
      MP.hostConn.send({
        type: 'chat',
        senderName: profile.name,
        senderProfile: profile,
        message: msg
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
function hostStartGame() {
  MP.gameStarted = true;

  const activePlayers = MP.players.filter(p => p.connected);
  const numPlayers = activePlayers.length;
  const numDecks = MP.settings.decks;

  // Initialize game state on host
  G.numPlayers = numPlayers;
  G.numDecks = numDecks;
  G.isFirstGame = true;
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

  // Find host's player index
  const hostIdx = activePlayers.findIndex(p => p.peerId === MP.myPeerId);

  // Build the game start payload for guests
  // Each guest gets their own hand, other hands are hidden
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

  showDealAnimation().then(() => {
    renderGame();
    // Skip 3-dump in multiplayer for simplicity, just start
    addLog(`Game mulai! ${G.players[G.currentIdx].name} jalan duluan.`);
    renderGame();
    hostScheduleTurn();
  });
}

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
    startTurnTimer(() => {
      // Auto pass on timeout
      if (G.currentPattern) {
        executePass(G.currentIdx);
      } else {
        // Must play, play smallest card
        const hand = G.players[G.currentIdx].hand;
        if (hand.length > 0) {
          executePlay(G.currentIdx, [hand[0]]);
        }
      }
    });

    // Your turn animation
    const anim = $mp('your-turn-anim');
    anim.classList.remove('play');
    void anim.offsetWidth;
    anim.classList.add('play');
    playSound('yourTurn');

    // Notify all guests whose turn it is
    broadcastGameState();
  } else if (isDisconnected) {
    // Bot plays for disconnected player
    G.busy = true;
    renderGame();
    broadcastGameState();
    setTimeout(() => {
      G.busy = false;
      performAITurn();
    }, 1500 + Math.random() * 1000);
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

    // Start timer for this player
    startTurnTimer(() => {
      // Player timeout — auto pass or play
      if (G.currentPattern) {
        executePass(G.currentIdx);
      } else {
        const hand = G.players[G.currentIdx].hand;
        if (hand.length > 0) {
          executePlay(G.currentIdx, [hand[0]]);
        }
      }
    });
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
    logs: G.logs.slice(-8)
  };

  // Send to each guest with their own hand
  for (const c of MP.connections) {
    if (!c.conn.open) continue;
    const playerIdx = G.players.findIndex(p => p.peerId === c.peerId);
    const personalState = { ...state };
    if (playerIdx !== -1) {
      personalState.myHand = G.players[playerIdx].hand;
      personalState.myIndex = playerIdx;
    }
    try { c.conn.send(personalState); } catch (e) { /* ignore */ }
  }
}

/* ============================================================
 *  15. GUEST — HANDLE TURNS
 * ============================================================ */
function handleYourTurn(data) {
  // Update my hand
  G.players[G.myIndex].hand = data.hand;
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

  // Start local timer display
  startTurnTimer(() => {
    // Auto pass on timeout (send to host)
    if (G.currentPattern) {
      sendActionToHost({ action: 'pass' });
    } else {
      const hand = G.players[G.myIndex].hand;
      if (hand.length > 0) {
        sendActionToHost({ action: 'play', cardIds: [hand[0].id] });
      }
    }
  });
}

function handleTurnInfo(data) {
  G.currentIdx = data.currentIdx;
  G.busy = true;
  renderGame();
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

  // Update player hand counts
  for (let i = 0; i < data.players.length && i < G.players.length; i++) {
    G.players[i].handCount = data.players[i].handCount;
    G.players[i].name = data.players[i].name;
  }

  // Update own hand if provided
  if (data.myHand) {
    G.players[data.myIndex].hand = data.myHand;
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

function sendActionToHost(action) {
  if (!MP.hostConn || !MP.hostConn.open) return;
  MP.hostConn.send({
    type: 'game_action',
    ...action,
    playerPeerId: MP.myPeerId
  });
}

/* ============================================================
 *  16. HOST — HANDLE GAME ACTIONS FROM GUESTS
 * ============================================================ */
function handleMultiplayerAction(data) {
  if (!MP.isHost) return;
  const playerIdx = G.players.findIndex(p => p.peerId === data.playerPeerId);
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
function startTurnTimer(onTimeout) {
  clearTurnTimer();

  if (!MP.isMultiplayer) return;

  MP.turnTimerValue = TURN_TIME;
  const timerBar = $mp('turn-timer-bar');
  const timerFill = $mp('turn-timer-fill');
  const timerText = $mp('turn-timer-text');

  if (timerBar) timerBar.classList.remove('hidden');
  if (timerText) {
    timerText.classList.remove('hidden');
    timerText.textContent = `${TURN_TIME}s`;
    timerText.classList.remove('urgent');
  }
  if (timerFill) timerFill.style.width = '100%';

  MP.turnTimer = setInterval(() => {
    MP.turnTimerValue--;
    const pct = (MP.turnTimerValue / TURN_TIME) * 100;
    if (timerFill) timerFill.style.width = `${pct}%`;
    if (timerText) {
      timerText.textContent = `${MP.turnTimerValue}s`;
      if (MP.turnTimerValue <= 5) timerText.classList.add('urgent');
    }

    if (MP.turnTimerValue <= 0) {
      clearTurnTimer();
      if (onTimeout) onTimeout();
    }
  }, 1000);
}

function clearTurnTimer() {
  if (MP.turnTimer) {
    clearInterval(MP.turnTimer);
    MP.turnTimer = null;
  }
  const timerBar = $mp('turn-timer-bar');
  const timerText = $mp('turn-timer-text');
  if (timerBar) timerBar.classList.add('hidden');
  if (timerText) timerText.classList.add('hidden');
}

/* ============================================================
 *  18. MULTIPLAYER GAME OVER
 * ============================================================ */
function handleMultiplayerGameOver(data) {
  G.gameOver = true;
  clearTurnTimer();

  const myIdx = MP.isHost
    ? G.players.findIndex(p => p.peerId === MP.myPeerId)
    : G.myIndex;

  const winners = data.winners || G.winners || [];
  const myRank = winners.indexOf(myIdx) + 1;

  if (myRank === 1) {
    showHumanWinOverlay(1);
  } else if (myRank === G.numPlayers) {
    showHumanWinOverlay(G.numPlayers);
  } else if (myRank > 0) {
    showHumanWinOverlay(myRank);
  } else {
    showGameOver();
  }
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
    $mp('disconnect-overlay')?.classList.add('hidden');
    destroyPeer();
    MP.isMultiplayer = false;
    showScreen('menu-screen');
  });
});
