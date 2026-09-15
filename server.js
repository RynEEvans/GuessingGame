import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const SCORE_TO_WIN = 3;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const rooms = new Map();

function randomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
  } while (rooms.has(code));
  return code;
}

function normalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function wordsOf(text) {
  return text.toLowerCase().match(/[a-z0-9]+/g) || [];
}

function isSolve(question, word) {
  const normQ = normalize(question);
  const normWord = normalize(word);
  if (normQ === normWord) return true;
  if (!normQ || !normWord) return false;

  const qt = wordsOf(question);
  const wt = wordsOf(word);
  for (let i = 0; i + wt.length <= qt.length; i++) {
    let ok = true;
    for (let j = 0; j < wt.length; j++) {
      if (qt[i + j] !== wt[j]) { ok = false; break; }
    }
    if (ok) return true;
  }

  if (normWord.length >= 6 && normQ.includes(normWord)) return true;
  return false;
}

function isOnline(player) {
  return player.ws.readyState === 1;
}

function playerOf(room, ws) {
  return room.players.find((p) => p.ws === ws);
}

function onlineInOrder(room) {
  return room.players.filter(isOnline);
}

function publicState(room, forId) {
  const revealAll = room.phase === 'reveal' || room.phase === 'over';
  const order = onlineInOrder(room);
  const deal = {};
  const n = order.length;
  for (let i = 0; i < n; i++) {
    deal[order[i].id] = order[(i + 1) % n].id;
  }
  let poll = null;
  if (room.poll) {
    const votes = Object.values(room.poll.votes);
    const yes = votes.filter(Boolean).length;
    poll = {
      question: room.poll.question,
      askerId: room.poll.askerId,
      voters: votes.length,
      needed: onlineInOrder(room).filter((p) => p.id !== room.poll.askerId).length,
      myVote: room.poll.askerId === forId ? null : (forId in room.poll.votes ? room.poll.votes[forId] : null),
    };
    if (forId !== room.poll.askerId) {
      poll.yesCount = yes;
      poll.noCount = votes.length - yes;
    }
  }

  const state = {
    type: 'state',
    code: room.code,
    phase: room.phase,
    round: room.round,
    log: room.log,
    winnerId: room.winnerId,
    scoresToWin: SCORE_TO_WIN,
    turnId: room.turnId,
    awaitingAnswer: !!room.poll,
    poll,
    submittedCount: room.players.filter(isOnline).filter((p) => p.id in room.submittedSecrets).length,
    players: room.players.map((p) => {
      const s = room.secrets[p.id];
      const visible = s && (revealAll || p.id !== forId);
      return {
        id: p.id,
        name: p.name,
        score: p.score,
        online: isOnline(p),
        card: s ? (visible ? s.word : null) : null,
        giverId: s ? s.giverId : null,
        resolved: s ? s.resolved : false,
      };
    }),
    myHasCard: !!room.secrets[forId],
    mySubmitted: forId in room.submittedSecrets,
    myTargetId: deal[forId] ?? null,
  };

  return state;
}

function broadcast(room) {
  for (const p of room.players) {
    if (isOnline(p)) {
      p.ws.send(JSON.stringify(publicState(room, p.id)));
    }
  }
}

function sendTo(ws, obj) {
  ws.send(JSON.stringify(obj));
}

function pushLog(room, entry) {
  room.log.push(entry);
}

function allResolved(room) {
  return onlineInOrder(room).every((p) => room.secrets[p.id]?.resolved);
}

function advanceTurn(room) {
  const order = onlineInOrder(room);
  if (order.length === 0) return;
  if (room.turnId == null) {
    room.turnId = order[0].id;
    return;
  }
  const idx = order.findIndex((p) => p.id === room.turnId);
  const n = order.length;
  for (let k = 1; k <= n; k++) {
    const next = order[(idx + k) % n];
    if (!room.secrets[next.id]?.resolved) {
      room.turnId = next.id;
      return;
    }
  }
  room.turnId = null;
}

function resolvePlayer(room, receiver) {
  const secret = room.secrets[receiver.id];
  secret.resolved = true;
  receiver.score += 1;
  const giver = room.players.find((p) => p.id === secret.giverId);
  pushLog(room, {
    type: 'win',
    text: `${receiver.name} guessed it! Their word "${secret.word}" (given by ${giver.name}) is solved.`,
  });
}

function endRound(room) {
  for (const p of onlineInOrder(room)) {
    const giver = room.players.find((g) => g.id === room.secrets[p.id].giverId);
    pushLog(room, {
      type: 'sys',
      text: `${p.name}${room.secrets[p.id].resolved ? ' solved' : ' missed'} "${room.secrets[p.id].word}" (given by ${giver.name}).`,
    });
  }
  const winner = onlineInOrder(room).find((p) => p.score >= SCORE_TO_WIN);
  if (winner) {
    room.winnerId = winner.id;
    room.phase = 'over';
  } else {
    room.phase = 'reveal';
  }
}

function closePoll(room) {
  const p = room.poll;
  const votes = Object.values(p.votes);
  const yes = votes.filter(Boolean).length;
  const no = votes.length - yes;
  const result = yes > no ? true : no > yes ? false : Math.random() < 0.5;
  room.poll = null;
  pushLog(room, { type: 'poll', askerId: p.askerId, yes: result, yesCount: yes, noCount: no });
  advanceTurn(room);
}

function startAssignmentRound(room, msg) {
  room.round += 1;
  room.submittedSecrets = {};
  room.secrets = {};
  room.poll = null;
  room.log = [];
  room.winnerId = null;
  room.turnId = null;
  room.phase = 'assigning';
  pushLog(room, { type: 'system', text: msg || `Round ${room.round}: give a word to another player.` });
}

function distributeCards(room) {
  const order = onlineInOrder(room);
  const n = order.length;
  room.secrets = {};
  for (let i = 0; i < n; i++) {
    const receiver = order[i];
    const giver = order[(i + n - 1) % n];
    room.secrets[receiver.id] = { word: room.submittedSecrets[giver.id], giverId: giver.id, resolved: false };
  }
  room.submittedSecrets = {};
  room.phase = 'questioning';
  room.poll = null;
  room.turnId = order[0].id;
  pushLog(room, { type: 'system', text: `Words handed out — each of you is guessing the word someone gave you. ${order[0].name} asks first.` });
}

const httpServer = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.normalize(path.join(__dirname, 'public', rel));
    if (!file.startsWith(path.join(__dirname, 'public') + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'create': {
        const name = String(msg.name || '').trim().slice(0, 20);
        if (!name) return sendTo(ws, { type: 'error', message: 'Enter a name.' });
        const player = { id: crypto.randomUUID(), name, score: 0, ws };
        const room = {
          code: randomCode(),
          players: [player],
          phase: 'lobby',
          round: 0,
          log: [],
          winnerId: null,
          turnId: null,
          poll: null,
          submittedSecrets: {},
          secrets: {},
        };
        rooms.set(room.code, room);
        sendTo(ws, { type: 'joined', id: player.id });
        sendTo(ws, publicState(room, player.id));
        break;
      }

      case 'join': {
        const name = String(msg.name || '').trim().slice(0, 20);
        const code = String(msg.code || '').trim().toUpperCase();
        const room = rooms.get(code);
        if (!name) return sendTo(ws, { type: 'error', message: 'Enter a name.' });
        if (!room) return sendTo(ws, { type: 'error', message: 'No room with that code.' });
        if (room.players.length >= 4) return sendTo(ws, { type: 'error', message: 'Room is full (max 4 players).' });
        const player = { id: crypto.randomUUID(), name, score: 0, ws };
        room.players.push(player);
        pushLog(room, { type: 'system', text: `${name} joined.` });
        sendTo(ws, { type: 'joined', id: player.id });
        broadcast(room);
        break;
      }

      case 'start': {
        const room = findRoom(ws);
        if (!room) return;
        if (room.phase !== 'lobby') return sendTo(ws, { type: 'error', message: 'Game already started.' });
        const online = onlineInOrder(room);
        if (online.length < 2) return sendTo(ws, { type: 'error', message: 'Need at least 2 players.' });
        startAssignmentRound(room, 'Round 1: give a word to another player.');
        broadcast(room);
        break;
      }

      case 'set-secret': {
        const room = findRoom(ws);
        if (!room) return;
        const player = playerOf(room, ws);
        if (!player) return;
        if (room.phase !== 'assigning') return sendTo(ws, { type: 'error', message: 'Not choosing secrets right now.' });
        if (player.id in room.submittedSecrets) return sendTo(ws, { type: 'error', message: 'Already picked. Waiting for others.' });
        const secret = String(msg.secret || '').trim().slice(0, 60);
        if (!secret) return sendTo(ws, { type: 'error', message: 'Enter a secret.' });
        room.submittedSecrets[player.id] = secret;
        pushLog(room, { type: 'system', text: `${player.name} handed out a word.` });
        const online = onlineInOrder(room);
        if (Object.keys(room.submittedSecrets).length >= online.length) {
          distributeCards(room);
        }
        broadcast(room);
        break;
      }

      case 'question': {
        const room = findRoom(ws);
        if (!room) return;
        const player = playerOf(room, ws);
        if (!player) return;
        if (room.phase !== 'questioning') return sendTo(ws, { type: 'error', message: 'Not taking questions.' });
        const my = room.secrets[player.id];
        if (!my) return sendTo(ws, { type: 'error', message: 'You have no card.' });
        if (my.resolved) return sendTo(ws, { type: 'error', message: 'Your card is already solved.' });
        if (room.poll) return sendTo(ws, { type: 'error', message: 'Wait for the current poll to close.' });
        if (player.id !== room.turnId) return sendTo(ws, { type: 'error', message: 'Not your turn.' });
        const text = String(msg.text || '').trim().slice(0, 120);
        if (!text) return sendTo(ws, { type: 'error', message: 'Enter a question.' });
        if (isSolve(text, my.word)) {
          resolvePlayer(room, player);
          advanceTurn(room);
          if (allResolved(room)) endRound(room);
          broadcast(room);
          return;
        }
        pushLog(room, { type: 'q', who: player.id, text });
        room.poll = { askerId: player.id, question: text, votes: {} };
        broadcast(room);
        break;
      }

      case 'vote': {
        const room = findRoom(ws);
        if (!room) return;
        const player = playerOf(room, ws);
        if (!player) return;
        if (room.phase !== 'questioning' || !room.poll) return sendTo(ws, { type: 'error', message: 'No poll is open.' });
        if (player.id === room.poll.askerId) return sendTo(ws, { type: 'error', message: 'You are the one asking.' });
        if (player.id in room.poll.votes) return sendTo(ws, { type: 'error', message: 'You already voted.' });
        room.poll.votes[player.id] = !!msg.yes;
        const viewers = onlineInOrder(room).filter((p) => p.id !== room.poll.askerId);
        if (viewers.every((v) => v.id in room.poll.votes)) closePoll(room);
        broadcast(room);
        break;
      }

      case 'next-round': {
        const room = findRoom(ws);
        if (!room) return;
        if (room.phase !== 'reveal') return;
        startAssignmentRound(room);
        broadcast(room);
        break;
      }

      case 'restart': {
        const room = findRoom(ws);
        if (!room) return;
        if (room.phase !== 'over') return;
        for (const p of room.players) p.score = 0;
        startAssignmentRound(room, 'Fresh match! Round 1: pick your secrets.');
        broadcast(room);
        break;
      }
    }
  });

  ws.on('close', () => {
    const room = findRoom(ws);
    if (!room) return;
    const player = playerOf(room, ws);
    if (!player) return;

    room.players = room.players.filter((p) => p !== player);
    if (room.players.length === 0) {
      rooms.delete(room.code);
      return;
    }

    const online = onlineInOrder(room);
    pushLog(room, { type: 'system', text: `${player.name} left.` });

    if (room.phase === 'assigning' || room.phase === 'questioning') {
      if (online.length < 2) {
        room.phase = 'lobby';
        room.submittedSecrets = {};
        room.secrets = {};
        room.poll = null;
        room.log = [];
        pushLog(room, { type: 'system', text: 'Not enough players. Waiting for more.' });
      } else {
        startAssignmentRound(room, `${player.name} left — pick your cards again.`);
      }
    } else if (online.length < 2 && room.phase !== 'lobby') {
      room.phase = 'lobby';
      room.log = [];
      pushLog(room, { type: 'system', text: 'Not enough players. Waiting for more.' });
    }
    broadcast(room);
  });
});

function findRoom(ws) {
  for (const room of rooms.values()) {
    if (room.players.some((p) => p.ws === ws)) return room;
  }
  return null;
}

httpServer.listen(PORT, () => {
  console.log(`Guessing game running at http://localhost:${PORT}`);
});