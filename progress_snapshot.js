const WORDS_PATH = "freevocabulary_words.json";
const SYNONYMS_DIR = "synonyms";
const STORAGE_PREFIX = "biblioBuddy.v1";

const MODES = {
  definitions: {
    label: "Definitions",
  },
  synonyms: {
    label: "Synonyms",
  },
  fitb: {
    label: "Fill in the Blank",
  },
};

const categoryLabels = {
  "not-encountered": "Not encountered yet",
  "work-needed": "Work needed",
  "keep-trying": "Keep trying",
  "getting-there": "Getting there",
  "nearly-mastered": "Nearly mastered",
  mastered: "Mastered",
};

const elements = {
  modeButtons: Array.from(document.querySelectorAll(".mode-button")),
  modeCapsule: document.getElementById("modeCapsule"),
  categoryColumn: document.getElementById("categoryColumn"),
  cardWord: document.getElementById("cardWord"),
  cardPos: document.getElementById("cardPos"),
  cardDefinition: document.getElementById("cardDefinition"),
  cardSynonyms: document.getElementById("cardSynonyms"),
  cardSentences: document.getElementById("cardSentences"),
};

const state = {
  entries: [],
  entryMap: new Map(),
  synonymsData: {},
  mode: "definitions",
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

  state.entryMap = state.entries.reduce((map, entry) => {
    map.set(entry.word, entry);
    return map;
  }, new Map());
}

function setMode(mode) {
  state.mode = mode;
  elements.modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  elements.modeCapsule.textContent = MODES[mode].label;
  renderCategories();
}

function renderCategories() {
  const modeState = getModeState(state.mode);
  const eligible = getEligibleEntries(state.mode);
  const categories = Object.keys(categoryLabels).reduce((acc, key) => {
    acc[key] = [];
    return acc;
  }, {});

  eligible.forEach((entry) => {
    const score = modeState.scores[entry.word];
    const category = getCategory(score);
    categories[category].push(entry.word);
  });

  elements.categoryColumn.innerHTML = "";
  Object.entries(categories).forEach(([key, words]) => {
    const details = document.createElement("details");
    details.className = "category-block";
    details.open = key === "work-needed";

    details.addEventListener("toggle", () => {
      if (!details.open) {
        renderWordCard(null);
      }
    });

    const summary = document.createElement("summary");
    summary.textContent = `${categoryLabels[key]} (${words.length})`;
    details.appendChild(summary);

    const list = document.createElement("ul");
    list.className = "word-list";

    words.sort().forEach((word) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.className = "word-chip";
      button.textContent = word;
      button.addEventListener("click", () => {
        renderWordCard(word);
      });
      item.appendChild(button);
      list.appendChild(item);
    });

    details.appendChild(list);
    elements.categoryColumn.appendChild(details);
  });
}

function renderWordCard(word) {
  if (!word) {
    elements.cardWord.textContent = "Select a word";
    elements.cardPos.textContent = "";
    elements.cardDefinition.textContent = "";
    fillList(elements.cardSynonyms, [], "");
    fillList(elements.cardSentences, [], "");
    return;
  }

  const entry = state.entryMap.get(word);
  if (!entry) {
    return;
  }
  const data = state.synonymsData[word] || {};
  const synonyms = Array.isArray(data.synonyms) ? data.synonyms : [];
  const sentences = Array.isArray(data.sentences) ? data.sentences : [];

  elements.cardWord.textContent = entry.word;
  elements.cardPos.textContent = entry.pos.toUpperCase();
  elements.cardDefinition.textContent = entry.definition;
  fillList(elements.cardSynonyms, pickRandomSubset(synonyms, 10), "No synonyms available.");
  fillList(elements.cardSentences, pickRandomSubset(sentences, 10), "No example sentences available.");
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

function getModeState(mode) {
  const stored = localStorage.getItem(getStorageKey(mode));
  if (stored) {
    const parsed = JSON.parse(stored);
    return {
      scores: parsed.scores || {},
    };
  }
  return { scores: {} };
}

function getStorageKey(mode) {
  return `${STORAGE_PREFIX}.${mode}`;
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

function normalizePos(type) {
  const value = String(type).toLowerCase();
  if (value.includes("v.")) return "verb";
  if (value.includes("n.")) return "noun";
  if (value.includes("adj.")) return "adj";
  if (value.includes("adv.")) return "adv";
  return "other";
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
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
