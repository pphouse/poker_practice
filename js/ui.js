// ui.js — ゲーム画面の描画とプレイヤー操作
// エンジンのイベントをスナップショット化してキューに積み、
// 一定間隔で再生することで CPU のアクションを順に見せる。

(function () {
  const { Game, SUIT_SYMBOLS, SUIT_COLORS } = window.Poker;

  const UI = {
    game: null,
    queue: [],
    animating: false,
    revealAll: false,
    config: null,
    speed: 750,

    el(id) { return document.getElementById(id); },

    // ===== ゲーム開始 =====
    startGame(config) {
      this.config = config;
      this.revealAll = false;
      this.queue = [];
      this.animating = false;

      const players = [{ name: 'あなた', isHuman: true, style: null }];
      const styleKeys = Object.keys(window.Poker.STYLES);
      const names = ['ナオ', 'ケン', 'ユイ', 'リク', 'アヤ', 'タク', 'ミオ'];
      for (let i = 0; i < config.opponents; i++) {
        const style = config.styles && config.styles[i]
          ? config.styles[i]
          : styleKeys[Math.floor(Math.random() * styleKeys.length)];
        players.push({ name: names[i % names.length], isHuman: false, style });
      }

      this.game = new Game({
        players,
        startStack: config.startStack,
        smallBlind: config.smallBlind,
        bigBlind: config.bigBlind,
        onEvent: (e) => this.onEvent(e),
      });

      this.el('table-area').classList.remove('hidden');
      this.el('game-setup').classList.add('hidden');
      this.el('hand-log').innerHTML = '';
      this.renderTable(this.snapshot(this.game, null));

      // 画面回転・リサイズで席配置を組み直す（重複登録は防ぐ）
      if (!this._resizeBound) {
        this._resizeBound = true;
        let rt;
        window.addEventListener('resize', () => {
          clearTimeout(rt);
          rt = setTimeout(() => { if (this.lastSnap) this.renderTable(this.lastSnap); }, 150);
        });
      }

      this.game.startHand();
    },

    // ===== イベント受信（同期）→ スナップショットしてキューへ =====
    onEvent(e) {
      // showdown でカードを全公開
      const reveal = e.type === 'showdown' || e.type === 'allInRunout';
      const snap = this.snapshot(e.game, e, reveal);
      this.queue.push({ e, snap });
      if (!this.animating) this.playNext();
    },

    // ゲーム状態の静的スナップショット
    snapshot(game, event, reveal = false) {
      return {
        event,
        reveal,
        board: game.board.map((c) => ({ ...c })),
        pot: game.totalPot(),
        dealer: game.dealer,
        currentBet: game.currentBet,
        street: window.Poker.STREETS[game.streetIndex],
        players: game.players.map((p) => ({
          id: p.id, name: p.name, stack: p.stack, isHuman: p.isHuman,
          style: p.style, folded: p.folded, allIn: p.allIn, out: p.out,
          betThisStreet: p.betThisStreet, lastAction: p.lastAction,
          hole: p.hole.map((c) => ({ rank: c.rank, suit: c.suit })),
          acting: game.actingPlayer && game.actingPlayer.id === p.id,
        })),
      };
    },

    // ===== キュー再生 =====
    playNext() {
      if (this.queue.length === 0) { this.animating = false; return; }
      this.animating = true;
      const { e, snap } = this.queue.shift();
      this.handleEvent(e, snap);
    },

    scheduleNext(delay) {
      setTimeout(() => this.playNext(), delay);
    },

    handleEvent(e, snap) {
      switch (e.type) {
        case 'handStart':
          this.log(`--- ハンド #${e.game.handNo} 開始 ---`);
          this.hideControls();
          this.renderTable(snap);
          this.scheduleNext(this.speed);
          break;
        case 'action': {
          const verb = this.actionLabel(e.action, e.amount);
          this.log(`${e.player.name}: ${verb}`);
          this.renderTable(snap);
          this.scheduleNext(this.speed);
          break;
        }
        case 'board':
          this.log(`【${this.streetJa(e.street)}】 ${e.board.map(this.cardStr).join(' ')}`);
          this.renderTable(snap);
          this.scheduleNext(this.speed + 200);
          break;
        case 'awaitHuman':
          this.renderTable(snap);
          this.showControls(e);
          // 人間待ち: ここで停止（submitAction でキュー再開）
          this.animating = false;
          break;
        case 'allInRunout':
          this.log('オールイン！ 残りのボードを公開します…');
          this.revealAll = true;
          this.renderTable(snap);
          this.scheduleNext(this.speed);
          break;
        case 'showdown':
          this.revealAll = true;
          this.renderShowdown(e, snap);
          this.scheduleNext(this.speed + 1400);
          break;
        case 'handWonNoShowdown':
          this.log(`${e.winner.name} がポット ${e.amount} を獲得（ショーダウンなし）`);
          this.renderTable(snap);
          this.scheduleNext(this.speed + 800);
          break;
        case 'handComplete':
          this.renderTable(snap);
          this.onHandComplete(e);
          this.scheduleNext(this.speed);
          break;
        case 'gameOver':
          this.onGameOver(e);
          this.animating = false;
          break;
        default:
          this.scheduleNext(this.speed);
      }
    },

    actionLabel(action, amount) {
      switch (action) {
        case 'fold': return 'フォールド';
        case 'check': return 'チェック';
        case 'call': return amount > 0 ? `コール ${amount}` : 'チェック';
        case 'raise': return `レイズ → ${amount}`;
        default: return action;
      }
    },
    streetJa(s) {
      return { preflop: 'プリフロップ', flop: 'フロップ', turn: 'ターン', river: 'リバー' }[s] || s;
    },
    cardStr(c) {
      return c.rank + (SUIT_SYMBOLS[c.suit] || c.suit);
    },

    // ===== テーブル描画 =====
    renderTable(snap) {
      this.lastSnap = snap; // リサイズ/回転時の再描画用
      // ボード
      const boardEl = this.el('community-cards');
      boardEl.innerHTML = '';
      for (let i = 0; i < 5; i++) {
        const c = snap.board[i];
        boardEl.appendChild(c ? this.cardEl(c) : this.cardBack(true));
      }
      this.el('pot-display').textContent = `ポット: ${snap.pot}`;
      this.el('street-display').textContent = this.streetJa(snap.street);

      // プレイヤー席
      const seats = this.el('seats');
      seats.innerHTML = '';
      const n = snap.players.length;
      snap.players.forEach((p, i) => {
        const seat = document.createElement('div');
        seat.className = 'seat';
        seat.style.cssText = this.seatPosition(i, n);
        if (p.acting) seat.classList.add('acting');
        if (p.folded) seat.classList.add('folded');
        if (p.out) seat.classList.add('out');
        if (p.isHuman) seat.classList.add('you');

        const dealerBadge = (snap.dealer === p.id) ? '<span class="dealer-btn">D</span>' : '';
        const styleName = p.isHuman ? '' :
          `<span class="style-tag">${(window.Poker.STYLES[p.style] || {}).name || ''}</span>`;

        const cardsHtml = document.createElement('div');
        cardsHtml.className = 'hole-cards';
        if (p.out) {
          // なし
        } else if (p.isHuman || snap.reveal || this.revealAll) {
          p.hole.forEach((c) => cardsHtml.appendChild(this.cardEl(c, true)));
        } else if (p.folded) {
          // 伏せたまま薄く
          p.hole.forEach(() => cardsHtml.appendChild(this.cardBack()));
        } else {
          p.hole.forEach(() => cardsHtml.appendChild(this.cardBack()));
        }

        const info = document.createElement('div');
        info.className = 'seat-info';
        info.innerHTML =
          `<div class="seat-name">${p.name} ${dealerBadge} ${styleName}</div>` +
          `<div class="seat-stack">💰 ${p.stack}</div>` +
          (p.betThisStreet > 0 ? `<div class="seat-bet">ベット ${p.betThisStreet}</div>` : '') +
          (p.lastAction ? `<div class="seat-last">${p.lastAction}</div>` : '');

        seat.appendChild(cardsHtml);
        seat.appendChild(info);
        seats.appendChild(seat);
      });
    },

    // 円卓上の座席配置（CSS の絶対座標）
    seatPosition(i, n) {
      // i=0(自分)を下中央に、その他を時計回りに配置
      const angle = (Math.PI / 2) + (i / n) * 2 * Math.PI; // 下から開始
      // スマホ（縦長卓）では席を外周へ寄せ、中央のボードと重ならないようにする
      const mobile = window.innerWidth <= 640;
      const rx = mobile ? 46 : 42;
      const ry = mobile ? 40 : 40;
      const cx = 50, cy = 50;
      const x = cx + rx * Math.cos(angle);
      const y = cy + ry * Math.sin(angle);
      return `left:${x}%; top:${y}%; transform:translate(-50%,-50%);`;
    },

    cardEl(c, large = false) {
      const d = document.createElement('div');
      d.className = 'card' + (large ? ' large' : '');
      d.classList.add(SUIT_COLORS[c.suit] === 'red' ? 'red' : 'black');
      d.innerHTML = `<span class="card-rank">${c.rank}</span><span class="card-suit">${SUIT_SYMBOLS[c.suit]}</span>`;
      return d;
    },
    cardBack(placeholder = false) {
      const d = document.createElement('div');
      d.className = placeholder ? 'card placeholder' : 'card back';
      return d;
    },

    // ===== 人間の操作 =====
    showControls(e) {
      const player = e.player;
      const toCall = e.toCall;
      const controls = this.el('action-controls');
      controls.classList.remove('hidden');

      const stack = player.stack;
      const pot = e.ctx.pot;
      const minRaiseTotal = this.game.currentBet + this.game.minRaise;

      // ボタン表示の出し分け
      const foldBtn = this.el('btn-fold');
      const checkCallBtn = this.el('btn-checkcall');
      const raiseBtn = this.el('btn-raise');
      const slider = this.el('raise-slider');
      const raiseAmt = this.el('raise-amount');

      foldBtn.style.display = toCall > 0 ? '' : 'none';
      if (toCall > 0) {
        checkCallBtn.textContent = `コール ${Math.min(toCall, stack)}`;
      } else {
        checkCallBtn.textContent = 'チェック';
      }

      // レイズ範囲
      const maxTotal = player.betThisStreet + stack; // オールイン上限
      const minTotal = Math.min(maxTotal, Math.max(minRaiseTotal, this.game.bigBlind));
      const canRaise = maxTotal > this.game.currentBet;
      raiseBtn.style.display = canRaise ? '' : 'none';
      slider.style.display = canRaise ? '' : 'none';
      this.el('raise-presets').style.display = canRaise ? '' : 'none';

      if (canRaise) {
        slider.min = minTotal;
        slider.max = maxTotal;
        slider.value = Math.min(maxTotal, Math.max(minTotal, Math.round(pot * 0.66) + this.game.currentBet));
        raiseAmt.textContent = slider.value;
        raiseBtn.textContent = (slider.value >= maxTotal) ? `オールイン ${maxTotal}` : `レイズ → ${slider.value}`;

        slider.oninput = () => {
          raiseAmt.textContent = slider.value;
          raiseBtn.textContent = (parseInt(slider.value) >= maxTotal) ? `オールイン ${maxTotal}` : `レイズ → ${slider.value}`;
        };
        // プリセット
        const setPreset = (frac) => {
          let target;
          if (frac === 'allin') target = maxTotal;
          else target = this.game.currentBet + Math.round(pot * frac);
          target = Math.min(maxTotal, Math.max(minTotal, target));
          slider.value = target;
          slider.oninput();
        };
        this.el('preset-half').onclick = () => setPreset(0.5);
        this.el('preset-pot').onclick = () => setPreset(1.0);
        this.el('preset-allin').onclick = () => setPreset('allin');
      }

      // 勝率ヒント（任意）
      const eq = window.Poker.estimateEquity(player.hole, this.game.board,
        Math.max(1, this.game.playersInHand().length - 1), 150);
      this.el('equity-hint').textContent =
        `あなたの推定勝率: ${Math.round(eq * 100)}%　|　必要勝率(ポットオッズ): ${toCall > 0 ? Math.round(toCall / (pot + toCall) * 100) : 0}%`;

      foldBtn.onclick = () => { this.hideControls(); this.game.submitAction('fold'); this.resume(); };
      checkCallBtn.onclick = () => {
        this.hideControls();
        this.game.submitAction(toCall > 0 ? 'call' : 'check', toCall);
        this.resume();
      };
      raiseBtn.onclick = () => {
        this.hideControls();
        this.game.submitAction('raise', parseInt(slider.value, 10));
        this.resume();
      };
    },

    resume() {
      // submitAction で新たなイベントがキューに積まれている。再生再開。
      if (!this.animating) this.playNext();
    },

    hideControls() {
      this.el('action-controls').classList.add('hidden');
    },

    // ===== ショーダウン =====
    renderShowdown(e, snap) {
      this.renderTable(snap);
      const results = e.results || [];
      for (const r of results) {
        const winnerNames = r.winners.map((id) => this.game.players[id].name).join(', ');
        const handName = r.hand ? r.hand.name : '';
        this.log(`ショーダウン: ${winnerNames} が ${r.amount} 獲得（${handName}）`);
      }
      // 各プレイヤーの役を表示
      if (e.evals) {
        for (const p of this.game.playersInHand()) {
          const ev = e.evals[p.id];
          if (ev) this.log(`　${p.name}: ${ev.name}`);
        }
      }
    },

    onHandComplete(e) {
      this.hideControls();
      const cont = this.el('next-hand-controls');
      cont.classList.remove('hidden');
      // 自分が脱落していたら次ハンドボタンを無効化
      const me = this.game.players[0];
      if (me.out) {
        this.el('btn-next-hand').textContent = 'あなたは脱落しました';
        this.el('btn-next-hand').disabled = true;
      } else {
        this.el('btn-next-hand').disabled = false;
        this.el('btn-next-hand').textContent = '次のハンドへ ▶';
      }
    },

    nextHand() {
      this.el('next-hand-controls').classList.add('hidden');
      this.revealAll = false;
      this.queue = [];
      this.animating = false;
      this.game.startHand();
    },

    onGameOver(e) {
      this.hideControls();
      this.el('next-hand-controls').classList.add('hidden');
      const w = e.winner;
      const msg = w && w.isHuman
        ? '🏆 優勝！ あなたが全チップを獲得しました！'
        : `ゲーム終了。優勝者: ${w ? w.name : '—'}`;
      this.log('==============================');
      this.log(msg);
      const banner = this.el('game-over-banner');
      banner.textContent = msg;
      banner.classList.remove('hidden');
    },

    backToSetup() {
      this.el('table-area').classList.add('hidden');
      this.el('game-setup').classList.remove('hidden');
      this.el('game-over-banner').classList.add('hidden');
      this.el('next-hand-controls').classList.add('hidden');
      this.hideControls();
    },

    log(msg) {
      const logEl = this.el('hand-log');
      const line = document.createElement('div');
      line.className = 'log-line';
      line.textContent = msg;
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
    },
  };

  window.Poker.UI = UI;
})();
