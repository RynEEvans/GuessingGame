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
  const chatChip = $('#chatChip');
  const notice = $('#notice');

  const devConsole = $('#devConsole');
  const devStatus = $('#devStatus');
  const devRoom = $('#devRoom');
  const devState = $('#devState');
  const devSend = $('#devSend');
  const devSendBtn = $('#devSendBtn');
  const devError = $('#devError');
  const devView = $('#devView');

  let ws = null;
  let myId = null;
  let logoClicks = 0;

  function connect() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
    ws.onopen = () => {
      status.textContent = 'Connected. Create a room or join with a code.';
      createBtn.disabled = joinBtn.disabled = false;
      devStatus.value = 'open';
    };
    ws.onclose = () => { setStatus('Disconnected. Refresh to reconnect.', true); devStatus.value = 'closed'; };
    ws.onerror = () => { setStatus('Connection error.', true); devStatus.value = 'error'; };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'joined') myId = msg.id;
      else if (msg.type === 'state') render(msg);
      else if (msg.type === 'error') showError(msg.message);
      else if (msg.type === 'eye') showDevEye(msg);
      devState.textContent = ev.data;
      devState.classList.remove('fresh');
      void devState.offsetWidth;
      devState.classList.add('fresh');
    };
  }

  function showError(text) {
    if (!roomView.hidden) {
      notice.textContent = text;
      notice.hidden = false;
    } else {
      setStatus(text, true);
    }
  }

  function showDevEye(msg) {
    devView.hidden = false;
    devView.innerHTML = msg.word
      ? `<div class="muted">Your card in <b>${escapeHtml(msg.phase)}</b>:</div>
         <p class="secret">${escapeHtml(msg.word)}</p>`
      : `<div class="muted">No card yet (${escapeHtml(msg.phase || 'unknown')}).</div>`;
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
    notice.hidden = true;
    const me = meOf(s);
    if (me) {
      joinView.hidden = true;
      roomView.hidden = false;
    }

    codeBtn.textContent = s.code;
    devRoom.value = `${s.code} · ${s.phase} · round ${s.round}`;
    chatChip.textContent = s.chat === 'voice' ? 'Voice' : 'Text';
    chatChip.hidden = false;
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
    else if (s.phase === 'assigning') text = s.category
      ? `Round ${s.round} — theme: <b>${escapeHtml(s.category)}</b>. Hand someone any word you like.`
      : 'Each player gives a word to another player. Guess the word given to you!';
    else if (s.phase === 'review') text = 'Words are in — vote on each one. Fair for the guesser or not?';
    else if (s.phase === 'questioning') text = `Theme: <b>${escapeHtml(s.category || '?')}</b> · ` + (s.chat === 'voice'
      ? 'Ask your yes/no questions out loud (voice chat), or guess your word outright.'
      : 'Words on the table. Ask the room yes/no questions, or guess your word outright.');
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
        `<div>Theme: <b>${escapeHtml(s.category || '…')}</b> — just a suggestion. Hand over any word you like.</div>
         <div>You're giving <b>${escapeHtml(target?.name || '……')}</b> a word they'll have to guess.</div>
         <div class="muted" style="margin-top:6px">And <b>${escapeHtml(giver?.name || 'another player')}</b> is giving you yours — guess it using yes/no questions!</div>`;
      return;
    }

    if (s.phase === 'questioning' && me?.resolved) {
      const mine = s.players.find((p) => p.id === myId);
      const giver = s.players.find((p) => p.id === mine?.giverId);
      prompt.hidden = false;
      prompt.innerHTML = `Card solved! ✓ The word was<p class="secret">${escapeHtml(mine?.card || '?')}</p>
        <div class="muted">given by ${escapeHtml(giver?.name || '…')}</div>
        <div class="muted" style="margin-top:4px">You can still vote on other people's polls.</div>`;
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
      controls.innerHTML = `
        <div class="setting">
          <label for="chatModeSelect">Chat mode</label>
          <select id="chatModeSelect">
            <option value="text">Text chat</option>
            <option value="voice">Voice chat</option>
          </select>
        </div>
        <button id="startBtn" class="primary">Start game</button>`;
      $('#chatModeSelect').value = s.chat;
      $('#chatModeSelect').onchange = (e) => send({ type: 'set-chat', chat: e.target.value });
      const btn = $('#startBtn');
      btn.disabled = s.players.filter((p) => p.online).length < 2;
      btn.onclick = () => send({ type: 'start' });
      return;
    }

    if (s.phase === 'assigning') {
      const total = s.players.filter((p) => p.online).length;
      let words = s.categoryWords || [];
      let html = '';
      if (!me || s.mySubmitted || s.myPending) {
        html = `<div class="muted">${s.submittedCount + s.pendingCount} of ${total} handed in a word… the room reviews them all together.</div>`;
      } else {
        const target = s.players.find((p) => p.id === s.myTargetId);
        let shuffleRow = '';
        if (s.submittedCount + s.pendingCount === 0) {
          shuffleRow = `<div class="row" style="margin-bottom:10px">
            <button type="button" id="shuffleBtn">Shuffle the theme</button>
          </div>`;
        }
        html = `
          ${shuffleRow}
          <form class="secretForm">
            <input id="secretInput" type="text" maxlength="24" placeholder="A word for ${escapeHtml(target?.name || 'them')}…" autocomplete="off" />
            <div class="row">
              <button type="button" id="giveBtn" ${words.length === 0 ? 'disabled' : ''}>Give me a word</button>
              <button type="submit" class="primary">Hand it over</button>
            </div>
          </form>`;
      }
      controls.innerHTML = html;
      const form = controls.querySelector('form.secretForm');
      const shuffleBtn = controls.querySelector('#shuffleBtn');
      if (shuffleBtn) shuffleBtn.onclick = () => send({ type: 'shuffle' });
      if (form) {
        const input = $('#secretInput');
        $('#giveBtn').onclick = () => {
          input.value = words[Math.floor(Math.random() * words.length)];
          input.focus();
        };
        form.onsubmit = (e) => {
          e.preventDefault();
          const v = input.value.trim();
          if (v) send({ type: 'set-secret', secret: v });
        };
      }
      return;
    }

    if (s.phase === 'review') {
      const reviews = s.reviews || [];
      const votable = reviews.filter((x) => x.canVote);
      const myDone = votable.filter((r) => r.myVote !== null).length;
      let html = `<div class="muted" style="margin-bottom:8px">${myDone} of ${votable.length} words you've reviewed</div>`;
      for (const r of reviews) {
        if (r.canVote) {
          const giver = s.players.find((p) => p.id === r.giverId);
          const target = s.players.find((p) => p.id === r.targetId);
          const body = r.myVote !== null
            ? `<div class="muted" style="margin-top:6px">You voted ${r.myVote ? 'yes' : 'no'} · ${r.voted} of ${r.votersOut} reviewed</div>`
            : `<div class="row" style="margin-top:8px">
                <button class="good" data-review="${r.id}" data-yes="1">Reasonable</button>
                <button class="bad" data-review="${r.id}" data-yes="0">Not fair</button>
              </div>
              <div class="muted" style="margin-top:6px">${r.voted} of ${r.votersOut} reviewed</div>`;
          html += `
            <div class="reviewCard">
              <div class="muted">${escapeHtml(giver?.name || '?')} wants to give ${escapeHtml(target?.name || '?')}:</div>
              <div class="polltext">“${escapeHtml(r.word || '?')}”</div>
              ${body}
            </div>`;
        } else if (r.iAmGiver) {
          html += `<div class="muted">Your word “${escapeHtml(r.word || '?')}” is waiting on the room…</div>`;
        } else {
          html += `<div class="muted">The room is checking the word coming to you…</div>`;
        }
      }
      controls.innerHTML = html;
      for (const btn of controls.querySelectorAll('[data-review]')) {
        btn.onclick = () => send({ type: 'review-vote', id: btn.dataset.review, yes: btn.dataset.yes === '1' });
      }
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
          <div class="row">
            <button id="qBtn" class="primary">Question?</button>
            <button id="gBtn" class="guess">Guess!</button>
          </div>
          <div class="muted" style="margin-top:8px">Pick one — it locks in how you play this turn.</div>`;
        $('#qBtn').onclick = () => {
          if (s.chat === 'voice') {
            controls.innerHTML = `
              <div class="muted">Ask your yes/no question out loud, then open the vote for the room.</div>
              <button id="voiceDoneBtn" class="primary" style="margin-top:10px">Open the vote</button>`;
            $('#voiceDoneBtn').onclick = () => send({ type: 'question', voice: true });
            return;
          }
          controls.innerHTML = `
            <form class="askForm">
              <input id="askInput" type="text" maxlength="120" placeholder="Is my card…? (the room will vote)" autocomplete="off" />
              <button type="submit" class="primary">Ask</button>
            </form>
            <div class="muted" style="margin-top:8px">Question locked in — the room will vote yes/no.</div>`;
          controls.querySelector('form').onsubmit = (e) => {
            e.preventDefault();
            const v = $('#askInput').value.trim();
            if (v) send({ type: 'question', text: v });
          };
          $('#askInput').focus();
        };
        $('#gBtn').onclick = () => {
          controls.innerHTML = `
            <form class="askForm">
              <input id="guessInput" type="text" maxlength="120" placeholder="Your secret word is…" autocomplete="off" />
              <button type="submit" class="guess">Lock it in</button>
            </form>
            <div class="muted" style="margin-top:8px">Guess locked in — right or wrong, your turn ends.</div>`;
          controls.querySelector('form').onsubmit = (e) => {
            e.preventDefault();
            const v = $('#guessInput').value.trim();
            if (v) send({ type: 'guess', guess: v });
          };
          $('#guessInput').focus();
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
      } else if (entry.type === 'guess') {
        const who = s.players.find((p) => p.id === entry.who);
        li.innerHTML = `<span class="who">${escapeHtml(who?.name || '?')}</span> guessed “${escapeHtml(entry.text)}” — <span class="no">nope, not it.</span>`;
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
    send({ type: 'create', name, chat: $('#chatSelect').value });
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

  $('#logoG').onclick = () => {
    logoClicks += 1;
    if (logoClicks >= 13) {
      logoClicks = 0;
      devConsole.hidden = !devConsole.hidden;
    }
  };

  $('#devClose').onclick = () => { devConsole.hidden = true; };

  function devSendRaw() {
    devError.textContent = '';
    const raw = devSend.value.trim();
    if (!raw) return;
    if (raw.startsWith('/')) {
      const cmd = raw.split(/\s+/)[0].toLowerCase();
      if (cmd === '/eye_open') {
        send({ type: 'dev-eye' });
        devSend.value = '';
      } else {
        devError.textContent = `Unknown command: ${cmd}`;
      }
      return;
    }
    try {
      send(JSON.parse(raw));
      devSend.value = '';
    } catch {
      devError.textContent = 'Not valid JSON.';
    }
  }
  devSendBtn.onclick = devSendRaw;
  devSend.onkeydown = (e) => { if (e.key === 'Enter') devSendRaw(); };

  connect();
})();