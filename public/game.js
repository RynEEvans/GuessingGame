(() => {
  const $ = (sel) => document.querySelector(sel);

  const joinView = $('#joinView');
  const roomView = $('#roomView');
  const nameInput = $('#nameInput');
  const codeInput = $('#codeInput');
  const status = $('#status');
  const createBtn = $('#createBtn');
  const joinBtn = $('#joinBtn');
  const codeBtn = $('#codeBtn');
  const playerList = $('#playerList');
  const banner = $('#banner');
  const prompt = $('#prompt');
  const controls = $('#controls');
  const logEl = $('#log');

  const WORDS = {
    Animals: ['elephant', 'penguin', 'unicorn', 'shark', 'kangaroo', 'octopus', 'owl', 'iguana', 'hedgehog', 'flamingo'],
    Foods: ['pizza', 'taco', 'popcorn', 'sushi', 'waffle', 'chili', 'guacamole', 'toast', 'cupcake', 'ramen'],
    Movies: ['titanic', 'shrek', 'avatar', 'inception', 'the matrix', 'frozen', 'jaws', 'top gun', 'et', 'gladiator'],
    Things: ['toothbrush', 'toaster', 'umbrella', 'keyboard', 'sneaker', 'pillow', 'guitar', 'backpack', 'snowglobe', 'ladder'],
    People: ['santa', 'pirate', 'nurse', 'wizard', 'beekeeper', 'lifeguard', 'chef', 'cowboy', 'dj', 'detective'],
  };
  const ALL_WORDS = Object.values(WORDS).flat();

  let ws = null;
  let myId = null;

  function connect() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
    ws.onopen = () => {
      status.textContent = 'Connected. Create a room or join with a code.';
      createBtn.disabled = joinBtn.disabled = false;
    };
    ws.onclose = () => setStatus('Disconnected. Refresh to reconnect.', true);
    ws.onerror = () => setStatus('Connection error.', true);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'joined') myId = msg.id;
      else if (msg.type === 'state') render(msg);
      else if (msg.type === 'error') {
        setStatus(msg.message, true);
        createBtn.disabled = joinBtn.disabled = false;
      }
    };
  }

  function send(obj) { ws.send(JSON.stringify(obj)); }

  function setStatus(text, isError = false) {
    status.textContent = text;
    status.classList.toggle('err', isError);
  }

  function meOf(s) {
    return s.players.find((p) => p.id === myId);
  }

  function render(s) {
    const me = meOf(s);
    if (me) {
      joinView.hidden = true;
      roomView.hidden = false;
    }

    codeBtn.textContent = s.code;
    renderPlayers(s);
    renderBanner(s);
    renderPrompt(s, me);
    renderControls(s, me);
    renderLog(s);
  }

  function renderPlayers(s) {
    playerList.innerHTML = s.players.map((p) => {
      const classes = ['player'];
      if (myId && p.id === myId) classes.push('me');
      if (!p.online) classes.push('offline');
      if (s.phase === 'questioning' && p.id === s.turnId) classes.push('turn');
      let card = '';
      if (p.card) card = `<span class="cardchip">${escapeHtml(p.card)}</span>`;
      else if (p.id === myId && p.online && s.phase === 'questioning') card = `<span class="cardchip mine">?</span>`;
      const tick = p.resolved ? ' ✓' : '';
      return `<span class="${classes.join(' ')}">${escapeHtml(p.name)}${tick}${card}<span class="score">${p.score}</span></span>`;
    }).join('');
  }

  function renderBanner(s) {
    const winner = s.winnerId ? s.players.find((p) => p.id === s.winnerId) : null;
    let text = '';
    if (s.phase === 'lobby') text = 'Ready when the room has at least 2 players.';
    else if (s.phase === 'assigning') text = 'Each player gives a word to another player. Guess the word given to you!';
    else if (s.phase === 'questioning') text = 'Words on the table. Ask the room yes/no about the word given to you.';
    else if (s.phase === 'reveal') text = `Round ${s.round} over!`;
    else if (s.phase === 'over') text = `🏆 <b>${escapeHtml(winner?.name || '')}</b> wins the game!`;
    if (text) { banner.innerHTML = text; banner.hidden = false; }
    else banner.hidden = true;
  }

  function renderPrompt(s, me) {
    prompt.hidden = true;

    if (s.phase === 'assigning' && me) {
      const target = s.players.find((p) => p.id === s.myTargetId);
      const giver = s.players.find((p) => p.myTargetId === me.id);
      prompt.hidden = false;
      prompt.innerHTML =
        `<div>You're giving <b>${escapeHtml(target?.name || '……')}</b> a word they'll have to guess.</div>
         <div class="muted" style="margin-top:6px">And <b>${escapeHtml(giver?.name || 'another player')}</b> is giving you yours — guess it using yes/no questions!</div>`;
      return;
    }

    if (s.phase === 'questioning' && me?.resolved) {
      prompt.hidden = false;
      prompt.innerHTML = `<div>Card solved! ✓ You can still vote on other people's polls.</div>`;
      return;
    }

    if ((s.phase === 'reveal' || s.phase === 'over') && s.myHasCard) {
      const mine = s.players.find((p) => p.id === myId);
      const giver = s.players.find((p) => p.id === mine?.giverId);
      prompt.hidden = false;
      prompt.innerHTML = `The word you had to guess was<p class="secret">${escapeHtml(mine?.card || '?')}</p>
        <div class="muted">given by ${escapeHtml(giver?.name || '…')}${mine?.resolved ? ' — you got it!' : ''}</div>`;
    }
  }

  function renderControls(s, me) {
    controls.innerHTML = '';
    controls.hidden = false;

    if (s.phase === 'lobby') {
      controls.innerHTML = `<button id="startBtn" class="primary">Start game</button>`;
      const btn = $('#startBtn');
      btn.disabled = s.players.filter((p) => p.online).length < 2;
      btn.onclick = () => send({ type: 'start' });
      return;
    }

    if (s.phase === 'assigning') {
      const total = s.players.filter((p) => p.online).length;
      if (!me || s.mySubmitted) {
        controls.innerHTML = `<div class="muted">${s.submittedCount} of ${total} players handed out a word…</div>`;
        return;
      }
      const target = s.players.find((p) => p.id === s.myTargetId);
      controls.innerHTML = `
        <form class="secretForm">
          <input id="secretInput" type="text" maxlength="24" placeholder="A word for ${escapeHtml(target?.name || 'them')}…" autocomplete="off" />
          <div class="row">
            <button type="button" id="surpriseBtn">Surprise me</button>
            <button type="submit" class="primary">Hand it over</button>
          </div>
        </form>`;
      const input = $('#secretInput');
      $('#surpriseBtn').onclick = () => {
        input.value = ALL_WORDS[Math.floor(Math.random() * ALL_WORDS.length)];
        input.focus();
      };
      controls.querySelector('form').onsubmit = (e) => {
        e.preventDefault();
        const v = input.value.trim();
        if (v) send({ type: 'set-secret', secret: v });
      };
      return;
    }

    if (s.phase === 'questioning') {
      const asker = s.players.find((p) => p.id === s.turnId);
      if (!me || !asker) {
        controls.innerHTML = `<div class="muted">…</div>`;
        return;
      }

      if (s.poll) {
        const poll = s.poll;
        const askerName = s.players.find((p) => p.id === poll.askerId)?.name || '?';
        if (poll.askerId === myId) {
          controls.innerHTML = `<div class="muted">Waiting for votes on your question… (${poll.voters}/${poll.needed})</div>`;
        } else if (poll.myVote !== null) {
          controls.innerHTML = `<div class="muted">${escapeHtml(askerName)} asks: “${escapeHtml(poll.question)}” — you voted. Waiting (${poll.voters}/${poll.needed})…</div>`;
        } else {
          controls.innerHTML = `
            <div class="pollq">${escapeHtml(askerName)} asks:</div>
            <div class="polltext">“${escapeHtml(poll.question)}”</div>
            <div class="row" style="margin-top:10px">
              <button class="good" id="yesBtn">Yes</button>
              <button class="bad" id="noBtn">No</button>
            </div>
            <div class="muted" style="margin-top:8px">${poll.voters}/${poll.needed} voted</div>`;
          $('#yesBtn').onclick = () => send({ type: 'vote', yes: true });
          $('#noBtn').onclick = () => send({ type: 'vote', yes: false });
        }
        return;
      }

      if (myId === s.turnId) {
        controls.innerHTML = `
          <form class="askForm">
            <input id="askInput" type="text" maxlength="120" placeholder="Is my card…? (the room will vote)" autocomplete="off" />
            <button type="submit" class="primary">Ask</button>
          </form>`;
        controls.querySelector('form').onsubmit = (e) => {
          e.preventDefault();
          const v = $('#askInput').value.trim();
          if (v) send({ type: 'question', text: v });
        };
      } else {
        controls.innerHTML = `<div class="muted">Waiting for ${escapeHtml(asker.name)} to ask…</div>`;
      }
      return;
    }

    if (s.phase === 'reveal') {
      controls.innerHTML = `<button id="nextBtn" class="primary">Next round</button>`;
      $('#nextBtn').onclick = () => send({ type: 'next-round' });
      return;
    }

    if (s.phase === 'over') {
      controls.innerHTML = `<button id="restartBtn" class="primary">Play again</button>`;
      $('#restartBtn').onclick = () => send({ type: 'restart' });
      return;
    }

    controls.hidden = true;
  }

  function renderLog(s) {
    logEl.innerHTML = '';
    for (const entry of s.log) {
      const li = document.createElement('li');
      if (entry.type === 'system' || entry.type === 'sys') {
        li.innerHTML = `<span class="sys">${escapeHtml(entry.text)}</span>`;
      } else if (entry.type === 'q') {
        const who = s.players.find((p) => p.id === entry.who);
        li.innerHTML = `<span class="who">${escapeHtml(who?.name || '?')}:</span> ${escapeHtml(entry.text)}`;
      } else if (entry.type === 'poll') {
        const who = s.players.find((p) => p.id === entry.askerId);
        li.innerHTML = `<span class="poll ${entry.yes ? 'yes' : 'no'}">Poll: ${entry.yes ? 'YES' : 'NO'}</span>
          <span class="sys"> (${entry.yesCount} Yes · ${entry.noCount} No) — ${escapeHtml(who?.name || '?')}'s question</span>`;
      } else if (entry.type === 'win') {
        li.innerHTML = `<span class="win">${escapeHtml(entry.text)}</span>`;
      }
      logEl.appendChild(li);
    }
    logEl.scrollTop = logEl.scrollHeight;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  createBtn.onclick = () => {
    const name = nameInput.value.trim();
    if (!name) return setStatus('Enter a name first.', true);
    createBtn.disabled = true;
    codeInput.value = '';
    send({ type: 'create', name });
  };

  joinBtn.onclick = () => {
    const name = nameInput.value.trim();
    const code = codeInput.value.trim().toUpperCase();
    if (!name) return setStatus('Enter a name first.', true);
    if (!code) return setStatus('Enter the room code to join.', true);
    joinBtn.disabled = true;
    send({ type: 'join', name, code });
  };

  codeBtn.onclick = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(codeBtn.textContent);
  };

  connect();
})();