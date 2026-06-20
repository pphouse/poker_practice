// main.js — 画面の配線（モード切替、セットアップ、戦略モード）

(function () {
  const P = window.Poker;
  const UI = P.UI;
  const el = (id) => document.getElementById(id);

  // ===== タブ切替 =====
  function switchMode(mode) {
    document.querySelectorAll('.mode-view').forEach((v) => v.classList.add('hidden'));
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    el('view-' + mode).classList.remove('hidden');
    el('tab-' + mode).classList.add('active');
  }

  // ===== ゲームセットアップ =====
  function setupGameForm() {
    el('btn-start-game').addEventListener('click', () => {
      const opponents = parseInt(el('cfg-opponents').value, 10);
      const startStack = parseInt(el('cfg-stack').value, 10);
      const bigBlind = parseInt(el('cfg-bb').value, 10);
      const smallBlind = Math.max(1, Math.floor(bigBlind / 2));
      const autoFF = el('cfg-autoff').checked;
      const autoNext = el('cfg-autonext').checked;
      const sound = el('cfg-sound').checked;
      if (window.Poker.Sound) { window.Poker.Sound.setEnabled(sound); window.Poker.Sound.resume(); }
      updateMuteBtn();
      el('game-over-banner').classList.add('hidden');
      UI.startGame({ opponents, startStack, smallBlind, bigBlind, autoFF, autoNext, sound });
    });

    el('btn-fold');
    el('btn-next-hand').addEventListener('click', () => UI.nextHand());
    el('btn-back-setup').addEventListener('click', () => UI.backToSetup());

    // 速度調整
    const speed = el('cfg-speed');
    if (speed) {
      speed.addEventListener('input', () => {
        UI.speed = parseInt(speed.value, 10);
        el('speed-label').textContent = `${UI.speed}ms`;
      });
    }
  }

  // ===== 戦略モード: レッスン =====
  function renderLessons() {
    const list = el('lesson-list');
    const content = el('lesson-content');
    list.innerHTML = '';
    P.LESSONS.forEach((lesson, i) => {
      const item = document.createElement('button');
      item.className = 'lesson-item';
      item.textContent = lesson.title;
      item.addEventListener('click', () => {
        document.querySelectorAll('.lesson-item').forEach((x) => x.classList.remove('active'));
        item.classList.add('active');
        content.innerHTML =
          `<h3>${lesson.title}</h3>` +
          lesson.body.map((para) => `<p>${para}</p>`).join('');
      });
      list.appendChild(item);
      if (i === 0) item.click();
    });
  }

  // ===== 戦略モード: プリフロップ・レンジトレーナー =====
  const rangeState = { q: null, correct: 0, total: 0 };

  function newRangeQuestion() {
    rangeState.q = P.newRangeQuestion();
    const q = rangeState.q;
    const cardsHtml = q.hole.map((c) => {
      const color = P.SUIT_COLORS[c.suit] === 'red' ? 'red' : 'black';
      const r = P.displayRank(c.rank);
      const two = r.length > 1 ? ' two-char' : '';
      return `<div class="card large ${color}${two}"><span class="card-rank">${r}</span><span class="card-suit">${P.SUIT_SYMBOLS[c.suit]}</span></div>`;
    }).join('');
    el('range-cards').innerHTML = cardsHtml;
    el('range-position').textContent = `ポジション: ${q.pos}`;
    el('range-feedback').textContent = '';
    el('range-feedback').className = 'feedback';
  }

  function answerRange(choice) {
    const q = rangeState.q;
    if (!q) return;
    rangeState.total++;
    const correct = (choice === q.answer);
    if (correct) rangeState.correct++;
    const fb = el('range-feedback');
    const correctLabel = q.answer === 'open' ? 'オープン(レイズ)' : 'フォールド';
    const codeDisp = q.code.replace(/T/g, '10');
    fb.textContent = correct
      ? `正解！ ${codeDisp} は ${q.pos} で ${correctLabel}。`
      : `不正解。${codeDisp}（${q.pos}）の正解は ${correctLabel} です。`;
    fb.className = 'feedback ' + (correct ? 'good' : 'bad');
    el('range-score').textContent = `正答 ${rangeState.correct} / ${rangeState.total}`;
    setTimeout(newRangeQuestion, 1400);
  }

  // ===== 戦略モード: ポットオッズ・クイズ =====
  const potState = { q: null, correct: 0, total: 0 };

  function newPotQuestion() {
    potState.q = P.newPotOddsQuestion();
    const q = potState.q;
    el('pot-question').innerHTML =
      `ポット <b>${q.pot}</b> に対して相手が <b>${q.bet}</b> ベットしました。<br>` +
      `あなたは <b>${q.street === 'flop' ? 'フロップ' : 'ターン'}</b> で <b>アウツ ${q.outs}枚</b> のドローを持っています。<br>` +
      `コールすべき？ フォールドすべき？`;
    el('pot-feedback').textContent = '';
    el('pot-feedback').className = 'feedback';
  }

  function answerPot(choice) {
    const q = potState.q;
    if (!q) return;
    potState.total++;
    const correct = (choice === q.correct);
    if (correct) potState.correct++;
    const fb = el('pot-feedback');
    const req = Math.round(q.required * 100);
    const eq = Math.round(q.equity * 100);
    fb.innerHTML =
      (correct ? '正解！ ' : '不正解。 ') +
      `必要勝率(ポットオッズ)=${q.bet}/(${q.pot}+${q.bet})=<b>${req}%</b>、` +
      `あなたの概算勝率(4-2の法則)=<b>${eq}%</b> → ` +
      (q.correct === 'call' ? '勝率が上回るので<b>コール</b>' : '勝率が下回るので<b>フォールド</b>');
    fb.className = 'feedback ' + (correct ? 'good' : 'bad');
    el('pot-score').textContent = `正答 ${potState.correct} / ${potState.total}`;
    setTimeout(newPotQuestion, 2400);
  }

  // 効果音オン/オフ表示更新
  function updateMuteBtn() {
    const btn = el('btn-mute');
    const S = window.Poker.Sound;
    if (btn && S) btn.textContent = S.isEnabled() ? '🔊' : '🔇';
  }

  // ===== 初期化 =====
  function init() {
    el('tab-game').addEventListener('click', () => switchMode('game'));
    el('tab-strategy').addEventListener('click', () => switchMode('strategy'));

    // 効果音ミュート切替
    el('btn-mute').addEventListener('click', () => {
      const S = window.Poker.Sound;
      if (!S) return;
      S.setEnabled(!S.isEnabled());
      updateMuteBtn();
    });

    setupGameForm();
    renderLessons();

    el('range-open').addEventListener('click', () => answerRange('open'));
    el('range-fold').addEventListener('click', () => answerRange('fold'));
    newRangeQuestion();

    el('pot-call').addEventListener('click', () => answerPot('call'));
    el('pot-fold').addEventListener('click', () => answerPot('fold'));
    newPotQuestion();

    switchMode('game');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
