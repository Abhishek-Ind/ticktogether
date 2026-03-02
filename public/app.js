const memberNameInput = document.getElementById('member-name');
const joinBtn = document.getElementById('join-btn');
const memberStatus = document.getElementById('member-status');
const minutesInput = document.getElementById('minutes');
const secondsInput = document.getElementById('seconds');
const instructionInput = document.getElementById('instruction');
const memberSelect = document.getElementById('member-select');
const startBtn = document.getElementById('start-btn');
const timerStatus = document.getElementById('timer-status');
const membersList = document.getElementById('members-list');
const activeTimersList = document.getElementById('active-timers');

const clientIdKey = 'ticktogether-client-id';
const clientId = localStorage.getItem(clientIdKey) || crypto.randomUUID();
localStorage.setItem(clientIdKey, clientId);

let activeTimers = [];
let lastEventTs = 0;
let joined = false;

const formatRemaining = (ms) => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

const beep = () => {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  oscillator.connect(gain);
  gain.connect(audioCtx.destination);
  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
  oscillator.start();
  oscillator.stop(audioCtx.currentTime + 0.2);
};

const renderTimers = () => {
  const now = Date.now();
  activeTimers = activeTimers.filter((timer) => {
    const remaining = timer.startAt + timer.seconds * 1000 - now;
    if (remaining <= 0 && !timer.finished) {
      timer.finished = true;
      alert(`Timer ended: ${timer.instruction}`);
      beep();
    }
    return now - timer.startAt < timer.seconds * 1000 + 5000;
  });

  activeTimersList.innerHTML = '';

  if (activeTimers.length === 0) {
    activeTimersList.innerHTML = '<li>No active timers yet.</li>';
    return;
  }

  activeTimers.forEach((timer) => {
    const li = document.createElement('li');
    const remaining = timer.finished ? 'DONE' : formatRemaining(timer.startAt + timer.seconds * 1000 - now);
    li.textContent = `${remaining} • ${timer.instruction} (by ${timer.startedBy})`;
    activeTimersList.appendChild(li);
  });
};

const refreshMembers = async () => {
  const response = await fetch('/api/members');
  const data = await response.json();
  membersList.innerHTML = '';
  memberSelect.innerHTML = '';

  if (data.members.length === 0) {
    membersList.innerHTML = '<li>No members connected.</li>';
    return;
  }

  data.members.forEach((member) => {
    const listItem = document.createElement('li');
    listItem.textContent = member.name;
    membersList.appendChild(listItem);

    const option = document.createElement('option');
    option.value = member.id;
    option.textContent = member.name;
    memberSelect.appendChild(option);
  });
};

const sendPresence = async () => {
  if (!joined) return;
  await fetch('/api/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, name: memberNameInput.value.trim() })
  });
};

const pollEvents = async () => {
  if (!joined) return;
  const response = await fetch(`/api/events?clientId=${encodeURIComponent(clientId)}&since=${lastEventTs}`);
  const data = await response.json();
  lastEventTs = data.now;

  data.timers.forEach((timer) => {
    activeTimers.push({ ...timer, finished: false });
    timerStatus.textContent = `Received timer from ${timer.startedBy} for ${timer.targetMemberNames.join(', ')}.`;
  });

  renderTimers();
};

setInterval(() => {
  renderTimers();
  sendPresence().catch(() => {
    memberStatus.textContent = 'Unable to update presence right now.';
  });
  refreshMembers().catch(() => {
    memberStatus.textContent = 'Unable to refresh members right now.';
  });
  pollEvents().catch(() => {
    timerStatus.textContent = 'Unable to fetch timer updates right now.';
  });
}, 2000);

joinBtn.addEventListener('click', async () => {
  const name = memberNameInput.value.trim();

  const response = await fetch('/api/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, name })
  });
  const data = await response.json();

  if (!response.ok) {
    memberStatus.textContent = data.error || 'Unable to join.';
    return;
  }

  joined = true;
  memberStatus.textContent = `Joined as ${data.member.name}.`;
  await refreshMembers();
  await pollEvents();
});

startBtn.addEventListener('click', async () => {
  if (!joined) {
    timerStatus.textContent = 'Join as a member before starting a timer.';
    return;
  }

  const minutes = Number(minutesInput.value) || 0;
  const seconds = Number(secondsInput.value) || 0;
  const totalSeconds = minutes * 60 + seconds;
  const instruction = instructionInput.value.trim();

  if (totalSeconds <= 0) {
    timerStatus.textContent = 'Please enter a duration greater than zero.';
    return;
  }

  const selectedOptions = Array.from(memberSelect.selectedOptions);
  const memberIds = selectedOptions.map((option) => option.value);

  const response = await fetch('/api/timers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId,
      name: memberNameInput.value.trim(),
      seconds: totalSeconds,
      instruction,
      memberIds
    })
  });

  const data = await response.json();
  if (!response.ok) {
    timerStatus.textContent = data.error || 'Unable to start timer.';
    return;
  }

  timerStatus.textContent = `Started timer (${Math.round(data.timer.seconds)}s) for ${data.timer.targetMemberNames.join(', ')}.`;
  await pollEvents();
});

renderTimers();
refreshMembers();
