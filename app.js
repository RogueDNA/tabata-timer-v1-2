const $ = (id) => document.getElementById(id);

const workInput = $("workInput");
const restInput = $("restInput");
const roundsInput = $("roundsInput");
const prepInput = $("prepInput");
const startBtn = $("startBtn");
const pauseBtn = $("pauseBtn");
const resetBtn = $("resetBtn");
const soundBtn = $("soundBtn");
const voiceBtn = $("voiceBtn");
const timerEl = $("timer");
const phaseLabel = $("phaseLabel");
const roundLabel = $("roundLabel");
const exerciseLabel = $("exerciseLabel");
const progressBar = $("progressBar");
const exerciseList = $("exerciseList");
const presetNameInput = $("presetNameInput");
const savePresetBtn = $("savePresetBtn");
const presetList = $("presetList");
const presetCount = $("presetCount");
const presetMessage = $("presetMessage");

const defaults = {
  work: 20,
  rest: 10,
  rounds: 8,
  prep: 10,
  exercises: [],
  sound: true,
  voice: true
};

let settings = loadSettings();
let phase = "ready";
let round = 1;
let remainingMs = settings.work * 1000;
let phaseDurationMs = remainingMs;
let endTime = null;
let timerId = null;
let running = false;
let soundOn = settings.sound;
let voiceOn = settings.voice;
let audioContext = null;
let getReadyAnnounced = false;
let roundAnnounced = false;
let startVoiceAnnounced = false;

function safeExercises(exercises, rounds) {
  const source = Array.isArray(exercises) ? exercises : [];
  return Array.from({ length: rounds }, (_, index) => String(source[index] || "").trim());
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("tabataTimerV12Settings"));
    const merged = { ...defaults, ...(saved || {}) };
    return { ...merged, exercises: safeExercises(merged.exercises, Number(merged.rounds) || defaults.rounds) };
  } catch {
    return { ...defaults, exercises: safeExercises([], defaults.rounds) };
  }
}

function saveSettings() {
  try {
    localStorage.setItem("tabataTimerV12Settings", JSON.stringify({
      work: settings.work,
      rest: settings.rest,
      rounds: settings.rounds,
      prep: settings.prep,
      exercises: safeExercises(settings.exercises, settings.rounds),
      sound: soundOn,
      voice: voiceOn
    }));
  } catch {
    // Optional browser storage; timer still works without it.
  }
}

function getNumber(input, fallback) {
  const value = Number(input.value);
  return Number.isFinite(value) && value >= Number(input.min) && value <= Number(input.max)
    ? Math.floor(value)
    : fallback;
}

function readSettings() {
  const rounds = getNumber(roundsInput, defaults.rounds);
  return {
    work: getNumber(workInput, defaults.work),
    rest: getNumber(restInput, defaults.rest),
    rounds,
    prep: getNumber(prepInput, defaults.prep),
    exercises: readExerciseNames(rounds)
  };
}

function readExerciseNames(rounds = settings.rounds) {
  return Array.from(exerciseList.querySelectorAll(".exercise-input"))
    .slice(0, rounds)
    .map((input) => input.value.trim());
}

function exerciseForRound(roundNumber) {
  return String(settings.exercises?.[roundNumber - 1] || "").trim();
}

function renderExerciseInputs(preserveExisting = true) {
  const rounds = getNumber(roundsInput, settings.rounds || defaults.rounds);
  const existing = preserveExisting ? readExerciseNames(rounds) : [];
  const source = existing.length ? existing : safeExercises(settings.exercises, rounds);

  exerciseList.innerHTML = "";
  for (let index = 0; index < rounds; index += 1) {
    const row = document.createElement("label");
    row.className = "exercise-row";

    const number = document.createElement("span");
    number.className = "exercise-number";
    number.textContent = String(index + 1);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "exercise-input";
    input.maxLength = 60;
    input.placeholder = `Exercise for round ${index + 1}`;
    input.value = source[index] || "";
    input.setAttribute("aria-label", `Exercise for round ${index + 1}`);

    row.append(number, input);
    exerciseList.appendChild(row);
  }
  setInputsDisabled(running);
}

function applySettingsToInputs() {
  workInput.value = settings.work;
  restInput.value = settings.rest;
  roundsInput.value = settings.rounds;
  prepInput.value = settings.prep;
  renderExerciseInputs(false);
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function updateDisplay() {
  timerEl.textContent = formatTime(remainingMs);

  if (phase === "ready") {
    phaseLabel.textContent = "READY";
    phaseLabel.className = "phase rest";
    roundLabel.textContent = `Round 1 of ${settings.rounds}`;
    exerciseLabel.textContent = exerciseForRound(1);
  } else if (phase === "prep") {
    phaseLabel.textContent = "GET READY";
    phaseLabel.className = "phase prep";
    roundLabel.textContent = `Round 1 of ${settings.rounds}`;
    exerciseLabel.textContent = exerciseForRound(1);
  } else if (phase === "work") {
    phaseLabel.textContent = "WORK";
    phaseLabel.className = "phase work";
    roundLabel.textContent = `Round ${round} of ${settings.rounds}`;
    exerciseLabel.textContent = exerciseForRound(round);
  } else if (phase === "rest") {
    phaseLabel.textContent = "REST";
    phaseLabel.className = "phase rest";
    roundLabel.textContent = `Round ${round} of ${settings.rounds}`;
    exerciseLabel.textContent = exerciseForRound(round + 1) || "";
  } else if (phase === "done") {
    phaseLabel.textContent = "COMPLETE";
    phaseLabel.className = "phase done";
    roundLabel.textContent = `Completed ${settings.rounds} rounds`;
    exerciseLabel.textContent = "";
  }

  const elapsed = phaseDurationMs > 0 ? phaseDurationMs - remainingMs : 0;
  const progress = phaseDurationMs > 0 ? Math.min(100, Math.max(0, elapsed / phaseDurationMs * 100)) : 0;
  progressBar.style.width = `${progress}%`;
}

function setPhase(nextPhase, durationSeconds, nextRound = round) {
  phase = nextPhase;
  round = nextRound;
  phaseDurationMs = Math.max(0, durationSeconds * 1000);
  remainingMs = phaseDurationMs;
  getReadyAnnounced = false;
  roundAnnounced = false;
  startVoiceAnnounced = false;
  updateDisplay();
}

function ensureAudio() {
  if (!soundOn) return;
  if (!audioContext) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    audioContext = new AudioCtx();
  }
  if (audioContext.state === "suspended") audioContext.resume();
}

function beep(frequency = 880, duration = 0.18, volume = 0.30) {
  if (!soundOn) return;
  ensureAudio();
  if (!audioContext) return;

  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + duration);
}

function speak(text) {
  if (!voiceOn || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-NZ";
  utterance.rate = 0.95;
  utterance.pitch = 1;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
}

function announceGetReady() {
  if (!running || (phase !== "prep" && phase !== "rest") || getReadyAnnounced) return;
  if (phase === "prep" && remainingMs <= 5000 && remainingMs > 0) {
    getReadyAnnounced = true;
    speak("Right, Get Ready to Work");
  } else if (phase === "rest" && remainingMs <= 5000 && remainingMs > 0 && round < settings.rounds) {
    getReadyAnnounced = true;
    speak("Right, Get Ready to Work");
  }
}

function announceRound() {
  if (!running || roundAnnounced || phase !== "prep" && phase !== "rest") return;
  if (remainingMs <= 3000 && remainingMs > 0) {
    roundAnnounced = true;
    const exercise = exerciseForRound(round === 1 && phase === "prep" ? 1 : round + 1);
    speak(exercise ? `Round ${round === 1 && phase === "prep" ? 1 : round + 1} — ${exercise}` : `Round ${round === 1 && phase === "prep" ? 1 : round + 1}`);
  }
}

function announceWorkStart() {
  if (startVoiceAnnounced) return;
  startVoiceAnnounced = true;
  speak("Work");
}

function transitionToNextPhase() {
  if (phase === "prep") {
    setPhase("work", settings.work, 1);
    beep(1000, 0.30, 0.32);
    announceWorkStart();
    return;
  }

  if (phase === "work") {
    if (round >= settings.rounds) {
      finishWorkout();
    } else {
      setPhase("rest", settings.rest, round);
      beep(600, 0.30, 0.32);
      speak("Time for a Rest");
    }
    return;
  }

  if (phase === "rest") {
    setPhase("work", settings.work, round + 1);
    beep(1000, 0.30, 0.32);
    announceWorkStart();
  }
}

function tick() {
  if (!running || endTime === null) return;

  remainingMs = endTime - performance.now();
  announceGetReady();
  announceRound();

  if (remainingMs <= 0) {
    remainingMs = 0;
    updateDisplay();
    transitionToNextPhase();
    if (phase === "done") return;
    endTime = performance.now() + phaseDurationMs;
  }

  updateDisplay();
}

function startTimer() {
  if (running) return;

  if (phase === "ready" || phase === "done") {
    settings = readSettings();
    saveSettings();
    round = 1;
    if (settings.prep > 0) {
      setPhase("prep", settings.prep, 1);
    } else {
      setPhase("work", settings.work, 1);
    }
  } else {
    // Resume current phase after pause.
    getReadyAnnounced = false;
    roundAnnounced = false;
    startVoiceAnnounced = false;
  }

  ensureAudio();
  running = true;
  endTime = performance.now() + remainingMs;
  timerId = window.setInterval(tick, 100);
  startBtn.disabled = true;
  pauseBtn.disabled = false;
  setInputsDisabled(true);

  if (phase === "prep" && settings.prep <= 5) announceGetReady();
  if (phase === "work") {
    const exercise = exerciseForRound(round);
    speak(exercise ? `Round ${round} — ${exercise}` : `Round ${round}`);
    roundAnnounced = true;
    announceWorkStart();
  }
}

function pauseTimer() {
  if (!running) return;
  remainingMs = Math.max(0, endTime - performance.now());
  running = false;
  endTime = null;
  clearInterval(timerId);
  timerId = null;
  window.speechSynthesis?.cancel();
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  setInputsDisabled(false);
  updateDisplay();
}

function resetTimer() {
  running = false;
  endTime = null;
  clearInterval(timerId);
  timerId = null;
  window.speechSynthesis?.cancel();
  settings = readSettings();
  saveSettings();
  round = 1;
  phase = "ready";
  getReadyAnnounced = false;
  roundAnnounced = false;
  startVoiceAnnounced = false;
  phaseDurationMs = settings.work * 1000;
  remainingMs = phaseDurationMs;
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  setInputsDisabled(false);
  updateDisplay();
}

function finishWorkout() {
  running = false;
  endTime = null;
  clearInterval(timerId);
  timerId = null;
  phase = "done";
  remainingMs = 0;
  phaseDurationMs = 1;
  startBtn.disabled = false;
  pauseBtn.disabled = true;
  setInputsDisabled(false);
  beep(1100, 0.25, 0.32);
  window.setTimeout(() => beep(1450, 0.35, 0.32), 180);
  speak("Great workout, you're all done");
  updateDisplay();
}

function setInputsDisabled(disabled) {
  [workInput, restInput, roundsInput, prepInput].forEach((input) => input.disabled = disabled);
  exerciseList.querySelectorAll("input").forEach((input) => input.disabled = disabled);
  presetNameInput.disabled = disabled;
  savePresetBtn.disabled = disabled;
  document.querySelectorAll(".preset-load, .preset-delete").forEach((button) => button.disabled = disabled);
}

function toggleSound() {
  soundOn = !soundOn;
  soundBtn.textContent = soundOn ? "🔊 Beep on" : "🔇 Beep off";
  soundBtn.setAttribute("aria-pressed", String(soundOn));
  saveSettings();
  if (soundOn) {
    ensureAudio();
    beep(850, 0.18, 0.30);
  }
}

function toggleVoice() {
  voiceOn = !voiceOn;
  voiceBtn.textContent = voiceOn ? "🗣️ Voice on" : "🔇 Voice off";
  voiceBtn.setAttribute("aria-pressed", String(voiceOn));
  saveSettings();
  if (!voiceOn) window.speechSynthesis?.cancel();
  else speak("Voice on");
}

function loadPresets() {
  try {
    const presets = JSON.parse(localStorage.getItem("tabataTimerV12Presets"));
    return Array.isArray(presets) ? presets : [];
  } catch {
    return [];
  }
}

function savePresets(presets) {
  try {
    localStorage.setItem("tabataTimerV12Presets", JSON.stringify(presets));
    return true;
  } catch {
    return false;
  }
}

function showPresetMessage(message, isError = false) {
  presetMessage.textContent = message;
  presetMessage.className = `preset-message${isError ? " error" : ""}`;
  window.clearTimeout(showPresetMessage.timeoutId);
  showPresetMessage.timeoutId = window.setTimeout(() => { presetMessage.textContent = ""; }, 3000);
}

function saveCurrentPreset() {
  const name = presetNameInput.value.trim();
  if (!name) {
    showPresetMessage("Enter a name for the workout first.", true);
    presetNameInput.focus();
    return;
  }

  settings = readSettings();
  settings.exercises = safeExercises(settings.exercises, settings.rounds);
  const presets = loadPresets();
  const existingIndex = presets.findIndex((preset) => preset.name.toLowerCase() === name.toLowerCase());
  const preset = {
    id: existingIndex >= 0 ? presets[existingIndex].id : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    work: settings.work,
    rest: settings.rest,
    rounds: settings.rounds,
    prep: settings.prep,
    exercises: settings.exercises
  };

  if (existingIndex >= 0) presets[existingIndex] = preset;
  else presets.push(preset);

  if (!savePresets(presets)) {
    showPresetMessage("The browser could not save this workout.", true);
    return;
  }

  saveSettings();
  presetNameInput.value = "";
  renderPresets();
  showPresetMessage(existingIndex >= 0 ? "Workout updated." : "Workout saved.");
}

function loadPreset(id) {
  const preset = loadPresets().find((item) => item.id === id);
  if (!preset) return;

  settings = {
    work: preset.work,
    rest: preset.rest,
    rounds: preset.rounds,
    prep: preset.prep,
    exercises: safeExercises(preset.exercises, preset.rounds)
  };
  applySettingsToInputs();
  saveSettings();
  resetTimer();
  showPresetMessage(`Loaded “${preset.name}”.`);
}

function deletePreset(id) {
  const presets = loadPresets();
  const preset = presets.find((item) => item.id === id);
  if (!preset) return;
  if (!window.confirm(`Delete “${preset.name}”?`)) return;
  savePresets(presets.filter((item) => item.id !== id));
  renderPresets();
  showPresetMessage("Workout deleted.");
}

function renderPresets() {
  const presets = loadPresets();
  presetList.innerHTML = "";
  presetCount.textContent = `${presets.length} saved`;

  if (presets.length === 0) {
    presetList.innerHTML = '<p class="empty-presets">No saved workouts yet. Add your exercise names above and save it here.</p>';
    return;
  }

  presets.forEach((preset) => {
    const row = document.createElement("div");
    row.className = "preset-row";

    const info = document.createElement("div");
    info.className = "preset-info";
    const name = document.createElement("strong");
    name.textContent = preset.name;
    const details = document.createElement("span");
    const exerciseCount = safeExercises(preset.exercises, preset.rounds).filter(Boolean).length;
    details.textContent = `${preset.work}s work • ${preset.rest}s rest • ${preset.rounds} rounds • ${exerciseCount} exercises`;
    info.append(name, details);

    const actions = document.createElement("div");
    actions.className = "preset-actions";

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.className = "preset-load";
    loadBtn.textContent = "Load";
    loadBtn.addEventListener("click", () => loadPreset(preset.id));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "preset-delete";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => deletePreset(preset.id));

    actions.append(loadBtn, deleteBtn);
    row.append(info, actions);
    presetList.appendChild(row);
  });

  setInputsDisabled(running);
}

[workInput, restInput, prepInput].forEach((input) => {
  input.addEventListener("change", () => {
    if (!running) {
      settings = readSettings();
      saveSettings();
      resetTimer();
    }
  });
});

roundsInput.addEventListener("change", () => {
  if (running) return;
  const oldExercises = readExerciseNames();
  const newRounds = getNumber(roundsInput, defaults.rounds);
  settings = { ...readSettings(), exercises: safeExercises(oldExercises.length ? oldExercises : settings.exercises, newRounds) };
  saveSettings();
  renderExerciseInputs(true);
  resetTimer();
});

exerciseList.addEventListener("input", () => {
  if (running) return;
  settings.exercises = readExerciseNames(settings.rounds);
  saveSettings();
});

startBtn.addEventListener("click", startTimer);
pauseBtn.addEventListener("click", pauseTimer);
resetBtn.addEventListener("click", resetTimer);
soundBtn.addEventListener("click", toggleSound);
voiceBtn.addEventListener("click", toggleVoice);
savePresetBtn.addEventListener("click", saveCurrentPreset);
presetNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveCurrentPreset();
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Space" && event.target.tagName !== "INPUT" && event.target.tagName !== "BUTTON") {
    event.preventDefault();
    running ? pauseTimer() : startTimer();
  }
});

applySettingsToInputs();
soundBtn.textContent = soundOn ? "🔊 Beep on" : "🔇 Beep off";
soundBtn.setAttribute("aria-pressed", String(soundOn));
voiceBtn.textContent = voiceOn ? "🗣️ Voice on" : "🔇 Voice off";
voiceBtn.setAttribute("aria-pressed", String(voiceOn));
renderPresets();
updateDisplay();
