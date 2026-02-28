const STORAGE_KEY = "ticktogether.sharedTimerState";
const CURRENT_GROUP_KEY = "ticktogether.currentGroupCode";

const createForm = document.querySelector("#create-form");
const joinForm = document.querySelector("#join-form");
const groupNameInput = document.querySelector("#group-name");
const groupCodeInput = document.querySelector("#group-code");
const groupList = document.querySelector("#group-list");
const emptyState = document.querySelector("#empty-state");
const statusEl = document.querySelector("#status");

const seedAvailableGroups = [
  { code: "8AC03F", name: "Demo" },
  { code: "E9FE43", name: "Demo Again" }
];

let state = loadState();
render();

createForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const groupName = groupNameInput.value.trim();
  if (!groupName) {
    setStatus("Please enter a group name.");
    return;
  }

  const code = generateUniqueHexCode();
  const group = { code, name: groupName };

  state.availableGroups.unshift(group);
  state.myGroupCodes.unshift(code);
  persistState();
  render();
  createForm.reset();
  setStatus(`Created "${groupName}" with code ${code}.`);
});

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const code = groupCodeInput.value.trim().toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(code)) {
    setStatus("Group code must be a 6-character hex code (0-9, A-F).");
    return;
  }

  const group = state.availableGroups.find((entry) => entry.code === code);
  if (!group) {
    setStatus(`No group found for code ${code}.`);
    return;
  }

  if (state.myGroupCodes.includes(code)) {
    localStorage.setItem(CURRENT_GROUP_KEY, code);
    window.location.href = `group.html?code=${code}`;
    return;
  }

  state.myGroupCodes.unshift(code);
  persistState();
  render();
  joinForm.reset();
  setStatus(`Joined "${group.name}" (${code}).`);
  localStorage.setItem(CURRENT_GROUP_KEY, code);
  window.location.href = `group.html?code=${code}`;
});

function loadState() {
  const fallback = {
    availableGroups: [...seedAvailableGroups],
    myGroupCodes: seedAvailableGroups.map((group) => group.code)
  };

  const fromStorage = localStorage.getItem(STORAGE_KEY);
  if (!fromStorage) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(fromStorage);
    if (!parsed || !Array.isArray(parsed.availableGroups) || !Array.isArray(parsed.myGroupCodes)) {
      return fallback;
    }

    const availableGroups = parsed.availableGroups
      .filter((group) => group && typeof group.code === "string" && typeof group.name === "string")
      .map((group) => ({ code: group.code.toUpperCase(), name: group.name.trim() || "Untitled Group" }));

    const knownCodes = new Set(availableGroups.map((group) => group.code));
    const myGroupCodes = parsed.myGroupCodes
      .filter((code) => typeof code === "string")
      .map((code) => code.toUpperCase())
      .filter((code) => knownCodes.has(code));

    return {
      availableGroups: availableGroups.length ? availableGroups : fallback.availableGroups,
      myGroupCodes
    };
  } catch {
    return fallback;
  }
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  groupList.innerHTML = "";

  const joinedGroups = state.myGroupCodes
    .map((code) => state.availableGroups.find((group) => group.code === code))
    .filter(Boolean);

  joinedGroups.forEach((group) => {
    const li = document.createElement("li");

    const left = document.createElement("div");
    const name = document.createElement("h3");
    name.textContent = group.name;
    const code = document.createElement("span");
    code.textContent = group.code;
    left.append(name, code);

    const actions = document.createElement("div");

    const open = document.createElement("a");
    open.href = `group.html?code=${group.code}`;
    open.className = "arrow";
    open.setAttribute("aria-label", `Open ${group.name}`);
    open.textContent = "→";
    open.addEventListener("click", () => {
      localStorage.setItem(CURRENT_GROUP_KEY, group.code);
    });

    const leave = document.createElement("button");
    leave.type = "button";
    leave.className = "arrow";
    leave.textContent = "Leave";
    leave.setAttribute("aria-label", `Leave ${group.name}`);
    leave.addEventListener("click", () => {
      leaveGroup(group.code);
    });

    actions.append(open, leave);
    li.append(left, actions);
    groupList.append(li);
  });

  emptyState.hidden = joinedGroups.length > 0;
}

function leaveGroup(code) {
  const group = state.availableGroups.find((entry) => entry.code === code);
  state.myGroupCodes = state.myGroupCodes.filter((entry) => entry !== code);
  persistState();
  render();
  setStatus(`Left "${group ? group.name : code}".`);
}

function generateUniqueHexCode() {
  const takenCodes = new Set(state.availableGroups.map((group) => group.code));
  let candidate = "";

  do {
    candidate = randomHexCode();
  } while (takenCodes.has(candidate));

  return candidate;
}

function randomHexCode() {
  let code = "";
  const alphabet = "0123456789ABCDEF";

  for (let index = 0; index < 6; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return code;
}

function setStatus(message) {
  statusEl.textContent = message;
}
