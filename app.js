const questions = Array.isArray(window.QUESTION_BANK) ? window.QUESTION_BANK : [];
const questionById = new Map(questions.map((question) => [question.id, question]));
const singles = questions.filter((question) => question.type === "single");
const multiples = questions.filter((question) => question.type === "multiple");

const storage = {
  mistakes: "maogaiQuiz.mistakes",
  practiceIndex: "maogaiQuiz.practiceIndex",
  removedMistakes: "maogaiQuiz.removedMistakes",
  resetAt: "maogaiQuiz.resetAt",
  sync: "maogaiQuiz.sync",
  updatedAt: "maogaiQuiz.updatedAt",
};

const state = {
  mode: "practice",
  practice: {
    index: clamp(Number(localStorage.getItem(storage.practiceIndex) || 0), 0, Math.max(questions.length - 1, 0)),
    answers: {},
    submitted: {},
  },
  random: {
    question: null,
    selected: [],
    revealed: false,
    answered: 0,
    correct: 0,
    wrong: 0,
  },
  exam: null,
  mistakes: loadMistakes(),
  removedMistakes: loadJson(storage.removedMistakes, {}),
  resetAt: localStorage.getItem(storage.resetAt) || "",
  updatedAt: loadUpdatedAt(),
  sync: loadSyncConfig(),
  toastTimer: null,
};

const mainPanel = document.getElementById("mainPanel");
const sidePanel = document.getElementById("sidePanel");
const bankStats = document.getElementById("bankStats");
const toast = document.getElementById("toast");

function init() {
  updateBankStats();
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });
  document.body.addEventListener("click", handlePageClick);
  document.body.addEventListener("change", handlePageChange);
  render();
  if (state.sync.code && state.sync.auto) {
    window.setTimeout(() => syncNow({ silent: true }), 800);
  }
}

function handlePageClick(event) {
  const optionButton = event.target.closest("[data-option]");
  if (optionButton) {
    handleOption(optionButton.dataset.option);
    return;
  }

  const jumpButton = event.target.closest("[data-jump]");
  if (jumpButton) {
    const index = Number(jumpButton.dataset.jump);
    if (state.exam && !Number.isNaN(index)) {
      state.exam.index = index;
      render();
    }
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;

  const action = actionButton.dataset.action;
  if (action === "practice-prev") movePractice(-1);
  if (action === "practice-next") movePractice(1);
  if (action === "random-confirm") confirmRandomAnswer();
  if (action === "random-next") nextRandomQuestion();
  if (action === "start-exam") startExam();
  if (action === "exam-prev") moveExam(-1);
  if (action === "exam-next") moveExam(1);
  if (action === "submit-exam") submitExam();
  if (action === "new-exam") startExam(true);
  if (action === "show-mistakes") setMode("mistakes");
  if (action === "remove-mistake") removeMistake(actionButton.dataset.id);
  if (action === "reset-all") resetAllRecords();
  if (action === "sync-create") createSyncSpace();
  if (action === "sync-connect") connectSyncSpace();
  if (action === "sync-now") syncNow();
}

function handlePageChange(event) {
  const autoToggle = event.target.closest("[data-sync-auto]");
  if (!autoToggle) return;
  state.sync.auto = autoToggle.checked;
  saveSyncConfig();
  render();
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  render();
}

function render() {
  updateBankStats();
  if (questions.length === 0) {
    mainPanel.innerHTML = renderEmpty("题库为空", "请先运行题库提取脚本。");
    sidePanel.innerHTML = "";
    return;
  }

  if (state.mode === "practice") renderPractice();
  if (state.mode === "random") renderRandom();
  if (state.mode === "exam") renderExam();
  if (state.mode === "mistakes") renderMistakes();
}

function renderPractice() {
  const index = state.practice.index;
  const question = questions[index];
  const progress = Math.round(((index + 1) / questions.length) * 100);

  mainPanel.innerHTML = renderQuestionPanel({
    question,
    titlePrefix: `顺序刷题 ${index + 1}/${questions.length}`,
    selected: [],
    submitted: false,
    correct: false,
    revealAnswer: true,
    interactive: false,
  });

  mainPanel.insertAdjacentHTML(
    "beforeend",
    `<div class="actions">
      <div class="action-group pager-group">
        <button class="pager-button" type="button" data-action="practice-prev" ${index === 0 ? "disabled" : ""}>${icon("left")}上一题</button>
        <button class="pager-button" type="button" data-action="practice-next" ${index === questions.length - 1 ? "disabled" : ""}>下一题${icon("right")}</button>
      </div>
      <span class="status-pill">已显示答案</span>
    </div>`
  );

  sidePanel.innerHTML = `
    <section class="side-card">
      <h2 class="side-title">顺序进度</h2>
      <div class="metric-grid">
        <div class="metric"><strong>${index + 1}</strong><span>当前题号</span></div>
        <div class="metric"><strong>${questions.length}</strong><span>题库总数</span></div>
      </div>
      <div class="progress-bar" aria-label="顺序刷题进度"><div class="progress-fill" style="width:${progress}%"></div></div>
    </section>
    <section class="side-card">
      <h2 class="side-title">当前状态</h2>
      <div class="metric-grid">
        <div class="metric"><strong>${formatQuestionType(question)}</strong><span>题型</span></div>
        <div class="metric"><strong>答案已显示</strong><span>顺序刷题</span></div>
      </div>
    </section>
    ${renderResetCard()}`;
}

function renderRandom() {
  if (!state.random.question) nextRandomQuestion(false);

  const question = state.random.question;
  mainPanel.innerHTML = renderQuestionPanel({
    question,
    titlePrefix: `随机刷题 ${state.random.answered + 1}`,
    selected: state.random.selected,
    submitted: state.random.revealed,
    correct: false,
    revealAnswer: false,
    interactive: !state.random.revealed,
    showStemType: true,
  });

  mainPanel.insertAdjacentHTML(
    "beforeend",
    `<div class="actions">
      <span class="status-pill">${state.random.revealed ? "已显示答案" : question.type === "multiple" ? "多选题选完点确定" : "单选题点选即判"}</span>
      <div class="action-group">
        ${
          state.random.revealed
            ? `<button class="action-button primary" type="button" data-action="random-next">下一题${icon("right")}</button>`
            : question.type === "multiple"
              ? `<button class="action-button primary" type="button" data-action="random-confirm">${icon("check")}确定</button>`
            : ""
        }
      </div>
    </div>`
  );

  const accuracy = state.random.answered
    ? Math.round((state.random.correct / state.random.answered) * 100)
    : 0;

  sidePanel.innerHTML = `
    <section class="side-card">
      <h2 class="side-title">随机统计</h2>
      <div class="metric-grid">
        <div class="metric"><strong>${state.random.answered}</strong><span>已答</span></div>
        <div class="metric"><strong>${state.random.correct}</strong><span>正确</span></div>
        <div class="metric"><strong>${state.random.wrong}</strong><span>错误</span></div>
        <div class="metric"><strong>${accuracy}%</strong><span>正确率</span></div>
      </div>
    </section>
    <section class="side-card">
      <h2 class="side-title">当前题型</h2>
      <div class="metric-grid">
        <div class="metric"><strong>${formatQuestionType(question)}</strong><span>题型</span></div>
        <div class="metric"><strong>${question.number}</strong><span>原题号</span></div>
      </div>
    </section>
    ${renderResetCard()}`;
}

function renderExam() {
  if (!state.exam) {
    mainPanel.innerHTML = `
      <section class="tool-panel question-panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">考试模式</p>
            <h2 class="question-title">随机试卷</h2>
          </div>
          <span class="status-pill">20 单选 + 10 多选</span>
        </div>
        <div class="metric-grid">
          <div class="metric"><strong>${singles.length}</strong><span>单选题</span></div>
          <div class="metric"><strong>${multiples.length}</strong><span>多选题</span></div>
          <div class="metric"><strong>30</strong><span>每套题量</span></div>
          <div class="metric"><strong>${countMistakes()}</strong><span>错题集</span></div>
        </div>
        <div class="actions">
          <div></div>
          <button class="action-button primary" type="button" data-action="start-exam">${icon("play")}开始考试</button>
        </div>
      </section>`;
    sidePanel.innerHTML = renderBankSide();
    return;
  }

  if (state.exam.submitted) {
    renderExamResult();
    return;
  }

  const index = state.exam.index;
  const question = state.exam.questions[index];
  const selected = state.exam.answers[question.id] || [];
  const answered = Object.values(state.exam.answers).filter((answer) => answer.length > 0).length;

  mainPanel.innerHTML = renderQuestionPanel({
    question,
    titlePrefix: `考试模式 ${index + 1}/${state.exam.questions.length}`,
    selected,
    submitted: false,
    correct: false,
  });

  mainPanel.insertAdjacentHTML(
    "beforeend",
    `<div class="actions">
      <div class="action-group pager-group">
        <button class="pager-button" type="button" data-action="exam-prev" ${index === 0 ? "disabled" : ""}>${icon("left")}上一题</button>
        <button class="pager-button" type="button" data-action="exam-next" ${index === state.exam.questions.length - 1 ? "disabled" : ""}>下一题${icon("right")}</button>
      </div>
      <button class="action-button success" type="button" data-action="submit-exam">${icon("check")}交卷</button>
    </div>`
  );

  sidePanel.innerHTML = `
    <section class="side-card">
      <h2 class="side-title">答题卡 <span class="status-pill">${answered}/30</span></h2>
      <div class="question-grid">${renderExamDots()}</div>
    </section>
    <section class="side-card">
      <h2 class="side-title">试卷构成</h2>
      <div class="metric-grid">
        <div class="metric"><strong>20</strong><span>单选</span></div>
        <div class="metric"><strong>10</strong><span>多选</span></div>
      </div>
    </section>
    ${renderResetCard()}`;
}

function renderExamResult() {
  const result = state.exam.result;
  const wrongItems = result.items.filter((item) => !item.correct);
  const score = result.items.length - wrongItems.length;

  mainPanel.innerHTML = `
    <section class="tool-panel question-panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">考试结果</p>
          <h2 class="question-title">${score}/${result.items.length}</h2>
        </div>
        <span class="status-pill">已收集 ${wrongItems.length} 道错题</span>
      </div>
      <div class="metric-grid">
        <div class="metric"><strong>${score}</strong><span>正确</span></div>
        <div class="metric"><strong>${wrongItems.length}</strong><span>错误</span></div>
        <div class="metric"><strong>${Math.round((score / result.items.length) * 100)}%</strong><span>正确率</span></div>
        <div class="metric"><strong>${countMistakes()}</strong><span>错题集</span></div>
      </div>
      <div class="actions">
        <button class="action-button" type="button" data-action="show-mistakes">${icon("alert")}错题集</button>
        <button class="action-button primary" type="button" data-action="new-exam">${icon("play")}再考一套</button>
      </div>
    </section>
    ${wrongItems.length ? `<section class="result-list">${wrongItems.map(renderWrongResult).join("")}</section>` : ""}
  `;

  sidePanel.innerHTML = `
    <section class="side-card">
      <h2 class="side-title">答题卡</h2>
      <div class="question-grid">${renderExamDots()}</div>
    </section>
    <section class="side-card">
      <h2 class="side-title">错题统计</h2>
      <div class="metric-grid">
        <div class="metric"><strong>${countMistakes()}</strong><span>错题数</span></div>
        <div class="metric"><strong>${totalMistakeCount()}</strong><span>累计错次</span></div>
      </div>
    </section>
    ${renderResetCard()}`;
}

function renderMistakes() {
  const entries = Object.entries(state.mistakes)
    .map(([id, record]) => ({ question: questionById.get(id), record }))
    .filter((entry) => entry.question)
    .sort((a, b) => b.record.count - a.record.count || a.question.number - b.question.number);

  if (entries.length === 0) {
    mainPanel.innerHTML = renderEmpty("暂无错题", "考试模式交卷后，答错的题会进入这里。");
  } else {
    mainPanel.innerHTML = `<section class="mistake-list">${entries.map(renderMistakeCard).join("")}</section>`;
  }

  sidePanel.innerHTML = `
    <section class="side-card">
      <h2 class="side-title">错题统计</h2>
      <div class="metric-grid">
        <div class="metric"><strong>${entries.length}</strong><span>错题数</span></div>
        <div class="metric"><strong>${totalMistakeCount()}</strong><span>累计错次</span></div>
      </div>
    </section>
    <section class="side-card">
      <h2 class="side-title">题库</h2>
      <div class="metric-grid">
        <div class="metric"><strong>${questions.length}</strong><span>总题数</span></div>
        <div class="metric"><strong>${multiples.length}</strong><span>多选题</span></div>
      </div>
    </section>
    ${renderResetCard()}`;
}

function renderQuestionPanel({ question, titlePrefix, selected, submitted, correct, revealAnswer = false, interactive = true, showStemType = false }) {
  const selectedLabels = new Set(selected);
  const answerText = answerLine(question, question.answer);
  const userText = answerLine(question, selected);
  const stemType = showStemType ? `<span class="question-type-badge">${formatQuestionType(question)}</span>` : "";
  const feedback = revealAnswer
    ? `<div class="feedback show ok">正确答案：${escapeHtml(answerText)}</div>`
    : submitted
    ? `<div class="feedback show ${correct ? "ok" : "bad"}">
        ${correct ? "回答正确" : `你的答案：${escapeHtml(userText)}<br>正确答案：${escapeHtml(answerText)}`}
      </div>`
    : `<div class="feedback"></div>`;

  return `
    <section class="tool-panel question-panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">${escapeHtml(titlePrefix)} · ${formatQuestionType(question)}</p>
          <h2 class="question-title">${stemType}${escapeHtml(question.stem)}</h2>
        </div>
        <span class="status-pill">第 ${question.number} 题</span>
      </div>
      <div class="options">
        ${question.options
          .map((option) => {
            const isSelected = selectedLabels.has(option.label);
            const isAnswer = question.answer.includes(option.label);
            const className = revealAnswer
              ? isAnswer
                ? "correct"
                : ""
              : submitted
              ? isAnswer
                ? "correct"
                : isSelected
                  ? "wrong"
                  : ""
              : isSelected
                ? "selected"
                : "";
            return `<button class="option-button ${className}" type="button" ${interactive ? `data-option="${option.label}"` : "disabled"}>
              <span class="option-label">${option.label}</span>
              <span class="option-text">${escapeHtml(option.text)}</span>
            </button>`;
          })
          .join("")}
      </div>
      ${feedback}
    </section>`;
}

function renderWrongResult(item) {
  return `
    <article class="mistake-card">
      <div class="mistake-head">
        <h3 class="mistake-title">${escapeHtml(item.question.stem)}</h3>
        <span class="count-badge">${formatQuestionType(item.question)}</span>
      </div>
      <p class="answer-line">你的答案：${escapeHtml(answerLine(item.question, item.selected))}</p>
      <p class="answer-line">正确答案：${escapeHtml(answerLine(item.question, item.question.answer))}</p>
    </article>`;
}

function renderMistakeCard(entry) {
  const { question, record } = entry;
  const lastAnswer = Array.isArray(record.lastAnswer) ? record.lastAnswer : [];
  return `
    <article class="mistake-card">
      <div class="mistake-head">
        <h3 class="mistake-title">${escapeHtml(question.stem)}</h3>
        <span class="count-badge">错 ${record.count} 次</span>
      </div>
      <p class="answer-line">题型：${formatQuestionType(question)} · 第 ${question.number} 题</p>
      <p class="answer-line">上次答案：${escapeHtml(answerLine(question, lastAnswer))}</p>
      <p class="answer-line">正确答案：${escapeHtml(answerLine(question, question.answer))}</p>
      <div class="actions">
        <div></div>
        <button class="action-button danger" type="button" data-action="remove-mistake" data-id="${question.id}">${icon("trash")}移出错题集</button>
      </div>
    </article>`;
}

function renderEmpty(title, text) {
  return `<section class="empty-state"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(text)}</p></section>`;
}

function renderBankSide() {
  return `
    <section class="side-card">
      <h2 class="side-title">题库</h2>
      <div class="metric-grid">
        <div class="metric"><strong>${questions.length}</strong><span>总题数</span></div>
        <div class="metric"><strong>${singles.length}</strong><span>单选题</span></div>
        <div class="metric"><strong>${multiples.length}</strong><span>多选题</span></div>
        <div class="metric"><strong>${countMistakes()}</strong><span>错题数</span></div>
      </div>
    </section>
    ${renderResetCard()}`;
}

function renderResetCard() {
  return `
    <section class="side-card">
      <h2 class="side-title">记录</h2>
      <button class="action-button danger full-width" type="button" data-action="reset-all">${icon("trash")}清空记录</button>
    </section>
    <section class="side-card">
      <h2 class="side-title">云同步 <span class="status-pill">${state.sync.status || (state.sync.code ? "已连接" : "未连接")}</span></h2>
      <input class="sync-input" id="syncCodeInput" type="text" value="${escapeHtml(state.sync.code)}" placeholder="同步码">
      <div class="sync-actions">
        <button class="action-button" type="button" data-action="sync-create">${icon("cloud")}创建</button>
        <button class="action-button" type="button" data-action="sync-connect">${icon("link")}连接</button>
        <button class="action-button primary" type="button" data-action="sync-now">${icon("refresh")}同步</button>
      </div>
      <label class="sync-toggle">
        <input type="checkbox" data-sync-auto ${state.sync.auto ? "checked" : ""}>
        <span>自动同步</span>
      </label>
      <p class="sync-hint">手机和电脑填同一个同步码即可共享顺序进度和错题集。</p>
    </section>`;
}

function renderExamDots() {
  if (!state.exam) return "";
  return state.exam.questions
    .map((question, index) => {
      const selected = state.exam.answers[question.id] || [];
      const resultItem = state.exam.result?.items.find((item) => item.question.id === question.id);
      const classes = [
        "question-dot",
        index === state.exam.index ? "current" : "",
        selected.length ? "answered" : "",
        resultItem ? (resultItem.correct ? "correct" : "wrong") : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<button class="${classes}" type="button" data-jump="${index}">${index + 1}</button>`;
    })
    .join("");
}

function handleOption(label) {
  if (state.mode === "practice") {
    const question = questions[state.practice.index];
    if (state.practice.submitted[question.id]) return;
    state.practice.answers[question.id] = nextSelection(question, state.practice.answers[question.id] || [], label);
    renderPractice();
  }

  if (state.mode === "random" && state.random.question && !state.random.revealed) {
    handleRandomOption(label);
  }

  if (state.mode === "exam" && state.exam && !state.exam.submitted) {
    const question = state.exam.questions[state.exam.index];
    state.exam.answers[question.id] = nextSelection(question, state.exam.answers[question.id] || [], label);
    renderExam();
  }
}

function nextSelection(question, current, label) {
  if (question.type === "single") return [label];
  const selected = new Set(current);
  if (selected.has(label)) selected.delete(label);
  else selected.add(label);
  return [...selected].sort();
}

function handleRandomOption(label) {
  const question = state.random.question;
  const selected = nextSelection(question, state.random.selected, label);
  state.random.selected = selected;

  if (question.type === "single") {
    if (isCorrect(question, selected)) {
      completeRandomCorrect();
      return;
    }
    revealRandomWrong();
    return;
  }

  renderRandom();
}

function confirmRandomAnswer() {
  const question = state.random.question;
  if (!question || question.type !== "multiple" || state.random.revealed) return;
  if (state.random.selected.length === 0) {
    showToast("请先选择答案");
    return;
  }
  if (isCorrect(question, state.random.selected)) {
    completeRandomCorrect();
    return;
  }
  revealRandomWrong();
}

function completeRandomCorrect() {
  state.random.answered += 1;
  state.random.correct += 1;
  showToast("答对了");
  nextRandomQuestion();
}

function revealRandomWrong() {
  state.random.answered += 1;
  state.random.wrong += 1;
  state.random.revealed = true;
  renderRandom();
}

function nextRandomQuestion(shouldRender = true) {
  const currentId = state.random.question?.id;
  state.random.question = pickRandomQuestion(currentId);
  state.random.selected = [];
  state.random.revealed = false;
  if (shouldRender) renderRandom();
}

function pickRandomQuestion(excludeId) {
  if (questions.length <= 1) return questions[0];
  let next = questions[Math.floor(Math.random() * questions.length)];
  while (next.id === excludeId) {
    next = questions[Math.floor(Math.random() * questions.length)];
  }
  return next;
}

function movePractice(delta) {
  state.practice.index = clamp(state.practice.index + delta, 0, questions.length - 1);
  localStorage.setItem(storage.practiceIndex, String(state.practice.index));
  markChanged();
  renderPractice();
}

function startExam(force = false) {
  if (!force && state.exam && !state.exam.submitted && !window.confirm("当前试卷还没交卷，要重新开始吗？")) return;
  if (singles.length < 20 || multiples.length < 10) {
    showToast("题库数量不足，无法生成试卷");
    return;
  }
  const picked = [...shuffle(singles).slice(0, 20), ...shuffle(multiples).slice(0, 10)];
  state.exam = {
    questions: shuffle(picked),
    index: 0,
    answers: {},
    submitted: false,
    result: null,
  };
  renderExam();
}

function moveExam(delta) {
  if (!state.exam) return;
  state.exam.index = clamp(state.exam.index + delta, 0, state.exam.questions.length - 1);
  renderExam();
}

function submitExam() {
  if (!state.exam || state.exam.submitted) return;
  const answered = Object.values(state.exam.answers).filter((answer) => answer.length > 0).length;
  if (answered < state.exam.questions.length && !window.confirm(`还有 ${state.exam.questions.length - answered} 题未作答，确认交卷吗？`)) {
    return;
  }

  const items = state.exam.questions.map((question) => {
    const selected = state.exam.answers[question.id] || [];
    const correct = isCorrect(question, selected);
    if (!correct) recordWrong(question, selected);
    return { question, selected, correct };
  });

  state.exam.submitted = true;
  state.exam.result = { items, submittedAt: new Date().toISOString() };
  saveMistakes();
  showToast("已交卷，错题已更新");
  renderExamResult();
}

function recordWrong(question, selected) {
  const current = state.mistakes[question.id] || { count: 0, lastAnswer: [], lastWrongAt: null };
  current.count += 1;
  current.lastAnswer = [...selected].sort();
  current.lastWrongAt = new Date().toISOString();
  state.mistakes[question.id] = current;
  delete state.removedMistakes[question.id];
  localStorage.setItem(storage.removedMistakes, JSON.stringify(state.removedMistakes));
}

function removeMistake(id) {
  delete state.mistakes[id];
  state.removedMistakes[id] = new Date().toISOString();
  localStorage.setItem(storage.removedMistakes, JSON.stringify(state.removedMistakes));
  saveMistakes();
  showToast("已移出错题集");
  renderMistakes();
}

function resetAllRecords() {
  if (!window.confirm("确认清空顺序刷题进度、随机刷题统计、当前考试和错题集吗？")) return;
  state.practice.index = 0;
  state.practice.answers = {};
  state.practice.submitted = {};
  state.random = {
    question: null,
    selected: [],
    revealed: false,
    answered: 0,
    correct: 0,
    wrong: 0,
  };
  state.exam = null;
  state.mistakes = {};
  state.removedMistakes = {};
  state.resetAt = new Date().toISOString();
  state.updatedAt = state.resetAt;
  localStorage.removeItem(storage.practiceIndex);
  localStorage.removeItem(storage.mistakes);
  localStorage.removeItem(storage.removedMistakes);
  localStorage.setItem(storage.resetAt, state.resetAt);
  localStorage.setItem(storage.updatedAt, state.updatedAt);
  scheduleAutoSync();
  showToast("已清空记录");
  render();
}

function loadMistakes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storage.mistakes) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveMistakes() {
  localStorage.setItem(storage.mistakes, JSON.stringify(state.mistakes));
  markChanged();
  updateBankStats();
}

function loadJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "");
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function loadUpdatedAt() {
  const saved = localStorage.getItem(storage.updatedAt);
  if (saved) return saved;
  const hasProgress = Number(localStorage.getItem(storage.practiceIndex) || 0) > 0;
  const hasMistakes = Object.keys(loadMistakes()).length > 0;
  return hasProgress || hasMistakes ? new Date().toISOString() : "";
}

function loadSyncConfig() {
  const saved = loadJson(storage.sync, {});
  return {
    code: typeof saved.code === "string" ? saved.code : "",
    auto: saved.auto !== false,
    status: "",
    busy: false,
    timer: null,
  };
}

function saveSyncConfig() {
  localStorage.setItem(storage.sync, JSON.stringify({ code: state.sync.code, auto: state.sync.auto }));
}

function markChanged() {
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(storage.updatedAt, state.updatedAt);
  scheduleAutoSync();
}

function scheduleAutoSync() {
  if (!state.sync.code || !state.sync.auto || state.sync.busy) return;
  window.clearTimeout(state.sync.timer);
  state.sync.timer = window.setTimeout(() => syncNow({ silent: true }), 900);
}

async function createSyncSpace() {
  if (state.sync.busy) return;
  const inputCode = readSyncInput();
  if (inputCode && !window.confirm("当前已填写同步码，要改为创建新的同步空间吗？")) return;
  await withSyncStatus("创建中", async () => {
    const response = await fetch("https://jsonblob.com/api/jsonBlob", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSyncSnapshot()),
    });
    if (!response.ok) throw new Error("创建同步空间失败");
    const location = response.headers.get("Location") || response.headers.get("location");
    const code = normalizeSyncCode(location);
    if (!code) throw new Error("没有拿到同步码");
    state.sync.code = code;
    state.sync.auto = true;
    saveSyncConfig();
    showToast("同步码已创建");
  });
}

async function connectSyncSpace() {
  const code = readSyncInput();
  if (!code) {
    showToast("先输入同步码");
    return;
  }
  state.sync.code = code;
  saveSyncConfig();
  await syncNow();
}

async function syncNow(options = {}) {
  if (state.sync.busy) return;
  const code = readSyncInput() || state.sync.code;
  if (!code) {
    if (!options.silent) showToast("先创建或输入同步码");
    return;
  }
  state.sync.code = code;
  saveSyncConfig();

  await withSyncStatus("同步中", async () => {
    const remote = await fetchSyncSnapshot(code);
    const merged = mergeSyncSnapshots(buildSyncSnapshot(), remote);
    applySyncSnapshot(merged);
    await saveSyncSnapshot(code, buildSyncSnapshot());
    if (!options.silent) showToast("同步完成");
  }, options);
}

async function withSyncStatus(status, task, options = {}) {
  state.sync.busy = true;
  state.sync.status = status;
  render();
  try {
    await task();
    state.sync.status = state.sync.code ? "已同步" : "未连接";
  } catch (error) {
    state.sync.status = "同步失败";
    if (!options.silent) showToast(error.message || "同步失败");
  } finally {
    state.sync.busy = false;
    render();
  }
}

async function fetchSyncSnapshot(code) {
  const response = await fetch(syncUrl(code), { cache: "no-store" });
  if (!response.ok) throw new Error("读取云端记录失败");
  const data = await response.json();
  return sanitizeSyncSnapshot(data);
}

async function saveSyncSnapshot(code, snapshot) {
  const response = await fetch(syncUrl(code), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot),
  });
  if (!response.ok) throw new Error("保存云端记录失败");
}

function readSyncInput() {
  const input = document.getElementById("syncCodeInput");
  return normalizeSyncCode(input?.value || "");
}

function syncUrl(code) {
  return `https://jsonblob.com/api/jsonBlob/${encodeURIComponent(normalizeSyncCode(code))}`;
}

function normalizeSyncCode(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/jsonBlob\/([^/?#]+)/i);
  return match ? match[1] : text;
}

function buildSyncSnapshot() {
  return sanitizeSyncSnapshot({
    app: "maogaiQuiz",
    version: 1,
    practiceIndex: state.practice.index,
    mistakes: state.mistakes,
    removedMistakes: state.removedMistakes,
    resetAt: state.resetAt,
    updatedAt: state.updatedAt,
  });
}

function sanitizeSyncSnapshot(snapshot) {
  const rawMistakes = snapshot && typeof snapshot.mistakes === "object" ? snapshot.mistakes : {};
  const mistakes = {};
  Object.entries(rawMistakes).forEach(([id, record]) => {
    if (!questionById.has(id) || !record || typeof record !== "object") return;
    mistakes[id] = {
      count: Math.max(0, Number(record.count || 0)),
      lastAnswer: Array.isArray(record.lastAnswer) ? record.lastAnswer.filter(Boolean).map(String) : [],
      lastWrongAt: typeof record.lastWrongAt === "string" ? record.lastWrongAt : "",
    };
  });

  const rawRemoved = snapshot && typeof snapshot.removedMistakes === "object" ? snapshot.removedMistakes : {};
  const removedMistakes = {};
  Object.entries(rawRemoved).forEach(([id, time]) => {
    if (questionById.has(id) && typeof time === "string") removedMistakes[id] = time;
  });

  return {
    app: "maogaiQuiz",
    version: 1,
    practiceIndex: clamp(Number(snapshot?.practiceIndex || 0), 0, Math.max(questions.length - 1, 0)),
    mistakes,
    removedMistakes,
    resetAt: typeof snapshot?.resetAt === "string" ? snapshot.resetAt : "",
    updatedAt: typeof snapshot?.updatedAt === "string" ? snapshot.updatedAt : "",
  };
}

function mergeSyncSnapshots(local, remote) {
  const localEffective = remote.resetAt && timestamp(remote.resetAt) > timestamp(local.updatedAt)
    ? blankSyncSnapshot(remote.resetAt)
    : local;
  const remoteEffective = local.resetAt && timestamp(local.resetAt) > timestamp(remote.updatedAt)
    ? blankSyncSnapshot(local.resetAt)
    : remote;

  const removedMistakes = mergeRemovedMistakes(localEffective.removedMistakes, remoteEffective.removedMistakes);
  const mistakes = {};
  const ids = new Set([...Object.keys(localEffective.mistakes), ...Object.keys(remoteEffective.mistakes)]);
  ids.forEach((id) => {
    const removalTime = timestamp(removedMistakes[id]);
    const records = [localEffective.mistakes[id], remoteEffective.mistakes[id]]
      .filter((record) => record && timestamp(record.lastWrongAt) > removalTime);
    if (!records.length) return;
    mistakes[id] = mergeMistakeRecords(records);
  });

  const resetAt = latestTime(local.resetAt, remote.resetAt);
  const updatedAt = latestTime(local.updatedAt, remote.updatedAt, resetAt);
  return sanitizeSyncSnapshot({
    practiceIndex: Math.max(localEffective.practiceIndex, remoteEffective.practiceIndex),
    mistakes,
    removedMistakes,
    resetAt,
    updatedAt,
  });
}

function blankSyncSnapshot(time) {
  return sanitizeSyncSnapshot({ practiceIndex: 0, mistakes: {}, removedMistakes: {}, resetAt: time, updatedAt: time });
}

function mergeRemovedMistakes(left = {}, right = {}) {
  const merged = {};
  new Set([...Object.keys(left), ...Object.keys(right)]).forEach((id) => {
    merged[id] = latestTime(left[id], right[id]);
  });
  return merged;
}

function mergeMistakeRecords(records) {
  return records.reduce((merged, record) => {
    if (!merged) return { ...record, lastAnswer: [...record.lastAnswer] };
    const newer = timestamp(record.lastWrongAt) >= timestamp(merged.lastWrongAt) ? record : merged;
    return {
      count: Math.max(Number(merged.count || 0), Number(record.count || 0)),
      lastAnswer: [...newer.lastAnswer],
      lastWrongAt: newer.lastWrongAt,
    };
  }, null);
}

function applySyncSnapshot(snapshot) {
  state.practice.index = snapshot.practiceIndex;
  state.mistakes = snapshot.mistakes;
  state.removedMistakes = snapshot.removedMistakes;
  state.resetAt = snapshot.resetAt;
  state.updatedAt = snapshot.updatedAt || new Date().toISOString();
  localStorage.setItem(storage.practiceIndex, String(state.practice.index));
  localStorage.setItem(storage.mistakes, JSON.stringify(state.mistakes));
  localStorage.setItem(storage.removedMistakes, JSON.stringify(state.removedMistakes));
  localStorage.setItem(storage.resetAt, state.resetAt);
  localStorage.setItem(storage.updatedAt, state.updatedAt);
  updateBankStats();
}

function timestamp(value) {
  const time = Date.parse(value || "");
  return Number.isNaN(time) ? 0 : time;
}

function latestTime(...values) {
  return values.filter(Boolean).sort((a, b) => timestamp(b) - timestamp(a))[0] || "";
}

function updateBankStats() {
  bankStats.textContent = `${questions.length} 题 · 单选 ${singles.length} · 多选 ${multiples.length} · 错题 ${countMistakes()}`;
}

function countMistakes() {
  return Object.keys(state.mistakes).filter((id) => questionById.has(id)).length;
}

function totalMistakeCount() {
  return Object.entries(state.mistakes).reduce((sum, [id, record]) => {
    return questionById.has(id) ? sum + Number(record.count || 0) : sum;
  }, 0);
}

function isCorrect(question, selected) {
  return normalizeLabels(question.answer) === normalizeLabels(selected);
}

function normalizeLabels(labels) {
  return [...labels].sort().join("");
}

function answerLine(question, labels) {
  if (!labels || labels.length === 0) return "未作答";
  return [...labels]
    .sort()
    .map((label) => {
      const option = question.options.find((item) => item.label === label);
      return option ? `${label}. ${option.text}` : label;
    })
    .join("；");
}

function formatQuestionType(question) {
  return question.type === "multiple" ? "多选题" : "单选题";
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => toast.classList.remove("show"), 1800);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function icon(name) {
  const paths = {
    check: '<path d="m5 12 4 4L19 6"></path>',
    left: '<path d="m15 18-6-6 6-6"></path>',
    right: '<path d="m9 18 6-6-6-6"></path>',
    play: '<path d="M8 5v14l11-7-11-7Z"></path>',
    rotate: '<path d="M4 4v6h6"></path><path d="M20 12a8 8 0 0 1-13.7 5.7L4 15.5"></path><path d="M4 10a8 8 0 0 1 13.7-5.7L20 6.5"></path>',
    refresh: '<path d="M4 4v6h6"></path><path d="M20 20v-6h-6"></path><path d="M20 9a8 8 0 0 0-13.5-3L4 8"></path><path d="M4 15a8 8 0 0 0 13.5 3l2.5-2"></path>',
    cloud: '<path d="M17.5 18H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20 11.5 3.5 3.5 0 0 1 17.5 18Z"></path>',
    link: '<path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"></path><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"></path>',
    alert: '<path d="M12 3 3.8 20h16.4L12 3Z"></path><path d="M12 9v5M12 17h.01"></path>',
    trash: '<path d="M4 7h16"></path><path d="M10 11v6M14 11v6"></path><path d="m6 7 1 14h10l1-14"></path><path d="M9 7V4h6v3"></path>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ""}</svg>`;
}

init();
