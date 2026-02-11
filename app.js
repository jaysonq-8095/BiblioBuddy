const WORDS_PATH = "freevocabulary_words.json";
const SYNONYMS_PATH = "synonyms.json";
const STORAGE_PREFIX = "biblioBuddy.v1";
const MAX_ACTIVE_NON_MASTERED = 75;

const MODES = {
  definitions: {
    label: "Definitions",
    prompt: "Choose the correct definition.",
  },
  synonyms: {
    label: "Synonyms",
    prompt: "Choose the closest synonym.",
  },
  fitb: {
    label: "Fill in the Blank",
    prompt: "Choose the word that best fits the sentence.",
  },
};

const elements = {
  modeButtons: Array.from(document.querySelectorAll(".mode-button")),
  modeCapsule: document.getElementById("modeCapsule"),
  capNotice: document.getElementById("capNotice"),
  reviewMastered: document.getElementById("reviewMastered"),
  resetMode: document.getElementById("resetMode"),
  questionMeta: document.getElementById("questionMeta"),
  questionTitle: document.getElementById("questionTitle"),
  questionPrompt: document.getElementById("questionPrompt"),
  posBadge: document.getElementById("posBadge"),
  options: document.getElementById("options"),
  feedback: document.getElementById("feedback"),
  nextButton: document.getElementById("nextButton"),
  statsGrid: document.getElementById("statsGrid"),
  limitSummary: document.getElementById("limitSummary"),
};

const state = {
  entries: [],
  entriesByPos: new Map(),
  synonymsData: {},
  mode: "definitions",
  current: null,
};

const categoryLabels = {
  "not-encountered": "Not encountered yet",
  "work-needed": "Work needed",
  "keep-trying": "Keep trying",
  "getting-there": "Getting there",
  "nearly-mastered": "Nearly mastered",
  mastered: "Mastered",
};

init();

async function init() {
  await loadData();
  bindEvents();
  setMode("definitions");
}

function bindEvents() {
  elements.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setMode(button.dataset.mode);
    });
  });

  elements.reviewMastered.addEventListener("change", () => {
    const modeState = getModeState(state.mode);
    modeState.reviewMastered = elements.reviewMastered.checked;
    saveModeState(state.mode, modeState);
    renderQuestion();
  });

  elements.resetMode.addEventListener("click", () => {
    localStorage.removeItem(getStorageKey(state.mode));
    setMode(state.mode);
  });

  elements.nextButton.addEventListener("click", () => {
    renderQuestion();
  });
}

async function loadData() {
  const [wordsResponse, synonymsResponse] = await Promise.all([
    fetch(WORDS_PATH),
    fetch(SYNONYMS_PATH),
  ]);

  const words = await wordsResponse.json();
  const synonymsData = synonymsResponse.ok ? await synonymsResponse.json() : {};

  state.synonymsData = synonymsData || {};
  state.entries = words
    .filter((item) => item && item.word && item.definition)
    .map((item) => ({
      word: item.word.trim(),
      definition: item.definition.trim(),
      pos: normalizePos(item.type || ""),
      rawType: item.type || "",
    }));

  state.entriesByPos = state.entries.reduce((map, entry) => {
    if (!map.has(entry.pos)) {
      map.set(entry.pos, []);
    }
    map.get(entry.pos).push(entry);
    return map;
  }, new Map());
}

function setMode(mode) {
  state.mode = mode;
  elements.modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });

  const modeState = getModeState(mode);
  elements.reviewMastered.checked = Boolean(modeState.reviewMastered);
  elements.modeCapsule.textContent = MODES[mode].label;
  renderQuestion();
}

function renderQuestion() {
  const modeState = getModeState(state.mode);
  const selection = selectWordForMode(state.mode, modeState);

  if (!selection) {
    elements.questionMeta.textContent = "No words available";
    elements.questionTitle.textContent = "";
    elements.questionPrompt.textContent = "";
    elements.posBadge.textContent = "";
    elements.options.innerHTML = "";
    elements.feedback.textContent = "";
    elements.nextButton.disabled = true;
    updateStats(modeState, [], 0, 0);
    return;
  }

  state.current = selection;
  const { entry, question } = selection;

  elements.questionMeta.textContent = MODES[state.mode].label;
  elements.questionTitle.textContent =
    state.mode === "fitb" ? "Complete the sentence" : entry.word;
  elements.questionPrompt.textContent = question.prompt;
  elements.posBadge.textContent = entry.pos.toUpperCase();
  elements.feedback.textContent = "";
  elements.nextButton.disabled = true;

  renderOptions(question.options, entry, modeState);
  updateStats(modeState, selection.eligible, selection.trackedCount, selection.masteredCount);
}

function renderOptions(options, entry, modeState) {
  elements.options.innerHTML = "";

  options.forEach((option) => {
    const button = document.createElement("button");
    button.className = "option-button";
    button.textContent = option.text;
    button.dataset.correct = option.isCorrect ? "true" : "false";
    button.addEventListener("click", () => {
      handleAnswer(button, option.isCorrect, entry, modeState);
    });
    elements.options.appendChild(button);
  });
}

function handleAnswer(button, isCorrect, entry, modeState) {
  const score = updateScore(entry.word, isCorrect, modeState);
  const category = getCategory(score);
  const resultLabel = isCorrect ? "Correct" : "Incorrect";

  elements.feedback.textContent = `${resultLabel}. Score: ${score} (${categoryLabels[category]}).`;
  elements.nextButton.disabled = false;

  Array.from(elements.options.children).forEach((child) => {
    child.disabled = true;
    const isCorrectOption = child.dataset.correct === "true";
    if (isCorrectOption) {
      child.classList.add("correct");
    }
    if (child === button && !isCorrect) {
      child.classList.add("incorrect");
    }
  });

  saveModeState(state.mode, modeState);
  updateStats(modeState, getEligibleEntries(state.mode), countTrackedNonMastered(modeState, state.mode), countMastered(modeState, state.mode));
}

function updateScore(word, isCorrect, modeState) {
  if (modeState.scores[word] === undefined) {
    modeState.scores[word] = 0;
  }

  modeState.scores[word] += isCorrect ? 1 : -1;
  modeState.lastSeen[word] = Date.now();
  return modeState.scores[word];
}

function selectWordForMode(mode, modeState) {
  const eligible = getEligibleEntries(mode);
  const tracked = eligible.filter((entry) => isTrackedNonMastered(entry.word, modeState));
  const mastered = eligible.filter((entry) => isMastered(entry.word, modeState));
  const unencountered = eligible.filter((entry) => modeState.scores[entry.word] === undefined);

  const capReached = tracked.length >= MAX_ACTIVE_NON_MASTERED;
  let pool = capReached ? tracked.slice() : tracked.concat(unencountered);

  if (modeState.reviewMastered) {
    pool = pool.concat(mastered);
  }

  if (pool.length === 0) {
    return null;
  }

  const entry = pool[Math.floor(Math.random() * pool.length)];
  const question = buildQuestion(mode, entry);
  if (!question) {
    return null;
  }

  elements.capNotice.textContent = capReached
    ? "Cap reached: new words paused"
    : "";

  return {
    entry,
    question,
    eligible,
    trackedCount: tracked.length,
    masteredCount: mastered.length,
  };
}

function buildQuestion(mode, entry) {
  if (mode === "definitions") {
    return buildDefinitionQuestion(entry);
  }
  if (mode === "synonyms") {
    return buildSynonymQuestion(entry);
  }
  return buildFitbQuestion(entry);
}

function buildDefinitionQuestion(entry) {
  const samePos = state.entriesByPos.get(entry.pos) || [];
  const options = buildUniqueOptions(
    entry.definition,
    samePos.map((item) => item.definition),
    5
  );

  return {
    prompt: MODES.definitions.prompt,
    options: shuffle(options).map((text) => ({
      text,
      isCorrect: text === entry.definition,
    })),
  };
}

function buildSynonymQuestion(entry) {
  const data = state.synonymsData[entry.word];
  const synonyms = data?.synonyms || [];
  if (synonyms.length === 0) {
    return null;
  }

  const correct = synonyms[Math.floor(Math.random() * synonyms.length)];
  const samePosEntries = state.entriesByPos.get(entry.pos) || [];
  const distractorWords = samePosEntries
    .map((item) => item.word)
    .filter((word) => word !== entry.word && word !== correct && !synonyms.includes(word));

  const options = buildUniqueOptions(correct, distractorWords, 5);

  return {
    prompt: MODES.synonyms.prompt,
    options: shuffle(options).map((text) => ({
      text,
      isCorrect: text === correct,
    })),
  };
}

function buildFitbQuestion(entry) {
  const data = state.synonymsData[entry.word];
  const sentences = data?.sentences || [];
  if (sentences.length === 0) {
    return null;
  }

  const sentence = sentences[Math.floor(Math.random() * sentences.length)];
  const blanked = blankSentence(sentence, entry.word);
  const samePosEntries = state.entriesByPos.get(entry.pos) || [];
  const distractors = samePosEntries
    .map((item) => item.word)
    .filter((word) => word !== entry.word);

  const options = buildUniqueOptions(entry.word, distractors, 5);

  return {
    prompt: blanked,
    options: shuffle(options).map((text) => ({
      text,
      isCorrect: text === entry.word,
    })),
  };
}

function buildUniqueOptions(correct, pool, count) {
  const unique = new Set();
  unique.add(correct);

  const shuffled = shuffle(pool.slice());
  for (const item of shuffled) {
    if (unique.size >= count) {
      break;
    }
    if (!unique.has(item)) {
      unique.add(item);
    }
  }

  return Array.from(unique).slice(0, count);
}

function updateStats(modeState, eligible, trackedCount, masteredCount) {
  const counts = countCategories(modeState, eligible);
  const rows = Object.keys(categoryLabels).map((key) => {
    const count = counts[key] || 0;
    return `<div class="stats-row"><span>${categoryLabels[key]}</span><span>${count}</span></div>`;
  });
  elements.statsGrid.innerHTML = rows.join("");

  elements.limitSummary.textContent = `Active non-mastered: ${trackedCount}/${MAX_ACTIVE_NON_MASTERED}. Mastered: ${masteredCount}.`;
}

function countCategories(modeState, eligible) {
  return eligible.reduce((acc, entry) => {
    const score = modeState.scores[entry.word];
    const category = getCategory(score);
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});
}

function countTrackedNonMastered(modeState, mode) {
  return getEligibleEntries(mode).filter((entry) => isTrackedNonMastered(entry.word, modeState)).length;
}

function countMastered(modeState, mode) {
  return getEligibleEntries(mode).filter((entry) => isMastered(entry.word, modeState)).length;
}

function getEligibleEntries(mode) {
  if (mode === "definitions") {
    return state.entries;
  }

  if (mode === "synonyms") {
    return state.entries.filter((entry) => {
      const data = state.synonymsData[entry.word];
      return Array.isArray(data?.synonyms) && data.synonyms.length > 0;
    });
  }

  return state.entries.filter((entry) => {
    const data = state.synonymsData[entry.word];
    return Array.isArray(data?.sentences) && data.sentences.length > 0;
  });
}

function isTrackedNonMastered(word, modeState) {
  const score = modeState.scores[word];
  return score !== undefined && score <= 10;
}

function isMastered(word, modeState) {
  const score = modeState.scores[word];
  return score !== undefined && score > 10;
}

function getCategory(score) {
  if (score === undefined) {
    return "not-encountered";
  }
  if (score < 0) {
    return "work-needed";
  }
  if (score <= 2) {
    return "keep-trying";
  }
  if (score <= 5) {
    return "getting-there";
  }
  if (score <= 10) {
    return "nearly-mastered";
  }
  return "mastered";
}

function getModeState(mode) {
  const stored = localStorage.getItem(getStorageKey(mode));
  if (stored) {
    const parsed = JSON.parse(stored);
    return {
      scores: parsed.scores || {},
      lastSeen: parsed.lastSeen || {},
      reviewMastered: parsed.reviewMastered || false,
    };
  }
  return { scores: {}, lastSeen: {}, reviewMastered: false };
}

function saveModeState(mode, modeState) {
  localStorage.setItem(getStorageKey(mode), JSON.stringify(modeState));
}

function getStorageKey(mode) {
  return `${STORAGE_PREFIX}.${mode}`;
}

function normalizePos(type) {
  const value = String(type).toLowerCase();
  if (value.includes("v.")) return "verb";
  if (value.includes("n.")) return "noun";
  if (value.includes("adj.")) return "adj";
  if (value.includes("adv.")) return "adv";
  return "other";
}

function blankSentence(sentence, word) {
  const escaped = escapeRegExp(word);
  const regex = new RegExp(`\\b${escaped}\\b`, "i");
  if (regex.test(sentence)) {
    return sentence.replace(regex, "____");
  }
  return `${sentence} ____`;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
