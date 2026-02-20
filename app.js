const WORDS_PATH = "freevocabulary_words.json";
const SYNONYMS_DIR = "synonyms";
const STORAGE_PREFIX = "biblioBuddy.v1";
const MAX_ACTIVE_NON_MASTERED = 50;

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
  questionCard: document.querySelector(".question-card"),
  modeButtons: Array.from(document.querySelectorAll(".mode-button")),
  modeCapsule: document.getElementById("modeCapsule"),
  capNotice: document.getElementById("capNotice"),
  reviewMastered: document.getElementById("reviewMastered"),
  resetMode: document.getElementById("resetMode"),
  settingsPanel: document.getElementById("settingsPanel"),
  saveData: document.getElementById("saveData"),
  loadData: document.getElementById("loadData"),
  loadInput: document.getElementById("loadInput"),
  questionMeta: document.getElementById("questionMeta"),
  questionTitle: document.getElementById("questionTitle"),
  questionPrompt: document.getElementById("questionPrompt"),
  posBadge: document.getElementById("posBadge"),
  options: document.getElementById("options"),
  answerDetails: document.getElementById("answerDetails"),
  detailWord: document.getElementById("detailWord"),
  detailPos: document.getElementById("detailPos"),
  detailDefinition: document.getElementById("detailDefinition"),
  detailSynonyms: document.getElementById("detailSynonyms"),
  detailSentences: document.getElementById("detailSentences"),
  feedback: document.getElementById("feedback"),
  nextButton: document.getElementById("nextButton"),
  statsGrid: document.getElementById("statsGrid"),
  statsAside: document.querySelector('.stats'),
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
      const mode = button.dataset.mode;
      if (mode === "settings") {
        toggleSettings();
      } else {
        setMode(mode);
      }
    });
  });

  elements.reviewMastered.addEventListener("change", () => {
    const modeState = getModeState(state.mode);
    modeState.reviewMastered = elements.reviewMastered.checked;
    saveModeState(state.mode, modeState);
    renderQuestion();
  });

  elements.resetMode.addEventListener("click", () => {
    const confirmed = window.confirm("Are you sure you want to reset?");
    if (!confirmed) {
      return;
    }
    localStorage.removeItem(getStorageKey(state.mode));
    setMode(state.mode);
  });

  elements.saveData.addEventListener("click", () => {
    downloadUserData();
  });

  elements.loadData.addEventListener("click", () => {
    elements.loadInput.click();
  });

  elements.loadInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    readUserData(file);
    event.target.value = "";
  });

  elements.nextButton.addEventListener("click", () => {
    renderQuestion();
  });
}

async function loadData() {
  const wordsResponse = await fetch(WORDS_PATH);
  const words = await wordsResponse.json();
  const letters = getLettersFromWords(words);
  const synonymsData = await loadSynonymsByLetters(letters);

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

function getLettersFromWords(words) {
  const letters = new Set();
  words.forEach((item) => {
    const word = String(item?.word || "").trim();
    const letter = getWordLetter(word);
    if (letter) {
      letters.add(letter);
    }
  });
  return Array.from(letters).sort();
}

function getWordLetter(word) {
  const match = String(word || "").match(/[a-z]/i);
  return match ? match[0].toLowerCase() : null;
}

async function loadSynonymsByLetters(letters) {
  const requests = letters.map((letter) =>
    fetch(`${SYNONYMS_DIR}/${letter}.json`)
      .then((response) => (response.ok ? response.json() : {}))
      .catch(() => ({}))
  );

  const results = await Promise.all(requests);
  return results.reduce((acc, data) => Object.assign(acc, data), {});
}

function setMode(mode) {
  state.mode = mode;
  elements.modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });

  // ensure settings panel is closed and main UI is visible
  elements.settingsPanel.setAttribute("hidden", "");
  elements.questionCard.style.display = "";
  elements.statsAside.style.display = "";
  elements.resetMode.style.display = "";

  const modeState = getModeState(mode);
  elements.reviewMastered.checked = Boolean(modeState.reviewMastered);
  elements.modeCapsule.textContent = MODES[mode].label;
  renderQuestion();
}

function toggleSettings() {
  const isHidden = elements.settingsPanel.hasAttribute("hidden");
  if (isHidden) {
    // show settings, hide main UI
    elements.settingsPanel.removeAttribute("hidden");
    elements.questionCard.style.display = "none";
    elements.statsAside.style.display = "none";
    elements.resetMode.style.display = "none";
    elements.modeButtons.forEach((button) => {
      if (button.dataset.mode !== "settings") {
        button.classList.remove("active");
      } else {
        button.classList.add("active");
      }
    });
  } else {
    // hide settings, restore main UI
    elements.settingsPanel.setAttribute("hidden", "");
    elements.questionCard.style.display = "";
    elements.statsAside.style.display = "";
    elements.resetMode.style.display = "";
    elements.modeButtons.forEach((button) => {
      button.classList.remove("active");
    });
    setMode(state.mode);
  }
}

function renderQuestion() {
  const modeState = getModeState(state.mode);
  const selection = selectWordForMode(state.mode, modeState);

  // special cases when user selected "review mastered"
  if (selection && selection.special) {
    elements.questionMeta.textContent = MODES[state.mode].label;
    elements.questionTitle.textContent = "";
    elements.posBadge.textContent = "";
    elements.options.innerHTML = "";
    elements.answerDetails.classList.remove("visible");
    elements.questionCard.classList.remove("correct", "incorrect");
    elements.nextButton.disabled = true;

    if (selection.special === "no-mastered") {
      elements.questionPrompt.textContent = "No mastered words to review.";
    } else if (selection.special === "not-enough-mastered") {
      elements.questionPrompt.textContent = "Not enough mastered words to review.";
    }

    updateStats(modeState, selection.eligible || [], selection.trackedCount || 0, selection.masteredCount || 0);
    return;
  }

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
  elements.answerDetails.classList.remove("visible");
  elements.questionCard.classList.remove("correct", "incorrect");

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

  elements.feedback.textContent = resultLabel;
  elements.nextButton.disabled = false;
  elements.questionCard.classList.add(isCorrect ? "correct" : "incorrect");

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

  renderAnswerDetails(entry);
  elements.answerDetails.classList.add("visible");

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

  // If user opted into reviewing mastered words, restrict to mastered-only
  if (modeState.reviewMastered) {
    if (mastered.length === 0) {
      return { special: "no-mastered" };
    }
    if (mastered.length < 10) {
      return { special: "not-enough-mastered", count: mastered.length };
    }
    const entry = mastered[Math.floor(Math.random() * mastered.length)];
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

  let pool = capReached ? tracked.slice() : tracked.concat(unencountered);

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
    return `<div class="stats-row stats-${key}"><span>${categoryLabels[key]}</span><span>${count}</span></div>`;
  });
  elements.statsGrid.innerHTML = rows.join("");

  elements.limitSummary.textContent = `Active non-mastered: ${trackedCount}/${MAX_ACTIVE_NON_MASTERED}. Mastered: ${masteredCount}.`;
}

function renderAnswerDetails(entry) {
  const data = state.synonymsData[entry.word] || {};
  const synonyms = Array.isArray(data.synonyms) ? data.synonyms : [];
  const sentences = Array.isArray(data.sentences) ? data.sentences : [];
  const limitedSynonyms = pickRandomSubset(synonyms, 10);
  const limitedSentences = pickRandomSubset(sentences, 10);

  elements.detailWord.textContent = entry.word;
  elements.detailPos.textContent = entry.pos.toUpperCase();
  elements.detailDefinition.textContent = entry.definition;
  fillList(elements.detailSynonyms, limitedSynonyms, "No synonyms available.");
  fillList(elements.detailSentences, limitedSentences, "No example sentences available.");
}

function fillList(listEl, items, emptyMessage) {
  listEl.innerHTML = "";
  if (!items || items.length === 0) {
    const item = document.createElement("li");
    item.textContent = emptyMessage;
    listEl.appendChild(item);
    return;
  }

  items.forEach((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    listEl.appendChild(item);
  });
}

function pickRandomSubset(items, maxCount) {
  if (!Array.isArray(items) || items.length <= maxCount) {
    return items || [];
  }
  return shuffle(items.slice()).slice(0, maxCount);
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

function downloadUserData() {
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    data: collectUserData(),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `biblioBuddy-data-${payload.savedAt.slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function collectUserData() {
  const data = {};
  Object.keys(localStorage).forEach((key) => {
    if (key.startsWith(STORAGE_PREFIX)) {
      data[key] = localStorage.getItem(key);
    }
  });
  return data;
}

function readUserData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      const stored = payload?.data || {};
      Object.entries(stored).forEach(([key, value]) => {
        if (key.startsWith(STORAGE_PREFIX) && typeof value === "string") {
          localStorage.setItem(key, value);
        }
      });
      setMode(state.mode);
    } catch (error) {
      console.error("Failed to load user data:", error);
    }
  };
  reader.readAsText(file);
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
  const regex = new RegExp(`\\b${escaped}(?:['’]s|s)?\\b`, "i");
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
