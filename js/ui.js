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
    sfx(name) { const S = window.Poker.Sound; if (S) S.play(name); },

    // ===== ゲーム開始 =====
    startGame(config) {
      this.config = config;
      this.autoFF = !!config.autoFF;
      this.autoNext = config.autoNext !== false;
      this.gameEnded = false;
      if (this.autoNextTimer) { clearTimeout(this.autoNextTimer); this.autoNextTimer = null; }
      this.shownStack = {};
      this._stackTw = {};
      this.fastForward = false;
      this.humanFolded = false;
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
          lastActionType: p.lastActionType,
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

    // force=true の重要イベントは早送り中でも一定時間見せる
    scheduleNext(delay, force) {
      const d = (this.fastForward && !force) ? 50 : delay;
      setTimeout(() => this.playNext(), d);
    },

    handleEvent(e, snap) {
      switch (e.type) {
        case 'handStart':
          this.log(`--- ハンド #${e.game.handNo} 開始 ---`);
          this.hideControls();
          this.hideFastForward();
          this.fastForward = false;
          this.humanFolded = false;
          this.heroPrevCat = -1;
          { const fx = this.el('fx-layer'); if (fx) fx.innerHTML = ''; }
          this.renderTable(snap);
          this.sfx('card');
          // ブラインドのチップがポットへ
          if (e.sb !== undefined) this.animateChips(this.seatEl(e.sb), this.potEl(), { count: 1, label: e.game.smallBlind });
          if (e.bb !== undefined) this.animateChips(this.seatEl(e.bb), this.potEl(), { count: 2, label: e.game.bigBlind });
          this.scheduleNext(this.speed);
          break;
        case 'action': {
          const verb = this.actionLabel(e.action, e.amount);
          this.log(`${e.player.name}: ${verb}`);
          this.renderTable(snap);
          // チップが席→ポットへ飛ぶ演出（ベット/コール/レイズ）＋ 効果音
          if ((e.action === 'raise' || e.action === 'call') && e.amount > 0) {
            this.animateChips(this.seatEl(e.player.id), this.potEl(),
              { count: e.action === 'raise' ? 4 : 2, label: e.amount });
            this.sfx('chip');
          } else if (e.action === 'check') {
            this.sfx('check');
          } else if (e.action === 'fold') {
            this.sfx('fold');
          }
          // 自分がフォールドしたら早送りを案内（自動なら即適用）
          if (e.player.isHuman && e.action === 'fold') {
            this.humanFolded = true;
            if (this.autoFF) this.fastForward = true;
            else this.showFastForward();
          }
          this.scheduleNext(this.speed);
          break;
        }
        case 'board': {
          this.log(`【${this.streetJa(e.street)}】 ${e.board.map(this.cardStr).join(' ')}`);
          this.renderTable(snap);
          this.sfx('card');
          // 自分の役が新しく完成したら演出（ツーペア以上）
          const hero = snap.players.find((p) => p.isHuman);
          if (hero && !hero.folded && hero.hole.length === 2) {
            const cat = this.evalCategory(hero.hole, snap.board);
            const C = window.Poker.CATEGORY;
            if (cat > this.heroPrevCat && cat >= C.TWO_PAIR) {
              const name = window.Poker.CATEGORY_NAME_JA[cat];
              this.showHandFx(`${name}！`, '役が完成', cat);
              this.sfx(cat >= C.FLUSH ? 'ding' : 'chip');
            }
            this.heroPrevCat = Math.max(this.heroPrevCat, cat);
          }
          this.scheduleNext(this.speed + 200);
          break;
        }
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
          this.hideFastForward();
          this.revealAll = true;
          this.renderShowdown(e, snap);
          this.scheduleNext(this.speed + 1400, true); // 結果は早送り中でも見せる
          break;
        case 'handWonNoShowdown':
          this.hideFastForward();
          this.log(`${e.winner.name} がポット ${e.amount} を獲得（ショーダウンなし）`);
          this.renderTable(snap);
          {
            const count = Math.max(2, Math.min(6, Math.round(e.amount / (this.game.bigBlind * 3))));
            this.animateChips(this.potEl(), this.seatEl(e.winner.id), { count, cls: 'win', label: '+' + e.amount });
            this.sfx('coins');
          }
          this.scheduleNext(this.speed + 800, true);
          break;
        case 'handComplete':
          this.hideFastForward();
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
      return window.Poker.displayRank(c.rank) + (SUIT_SYMBOLS[c.suit] || c.suit);
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
        seat.dataset.id = p.id;
        seat.style.cssText = this.seatPosition(i, n);
        if (p.acting) seat.classList.add('acting');
        if (p.folded) seat.classList.add('folded');
        if (p.out) seat.classList.add('out');
        if (p.isHuman) seat.classList.add('you');

        // アクション吹き出し（ログを見なくても状況が分かる）
        if (p.lastAction && !p.out) {
          const bubble = document.createElement('div');
          bubble.className = 'bubble bubble-' + (p.lastActionType || 'info');
          bubble.textContent = p.lastAction;
          seat.appendChild(bubble);
        }

        // アバター（顔アイコン）
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.style.background = this.avatarColor(p.id, p.isHuman);
        avatar.textContent = this.avatarEmoji(p.id, p.isHuman);
        if (snap.dealer === p.id) {
          const d = document.createElement('span');
          d.className = 'dealer-btn';
          d.textContent = 'D';
          avatar.appendChild(d);
        }
        seat.appendChild(avatar);

        // 手札
        const cardsHtml = document.createElement('div');
        cardsHtml.className = 'hole-cards';
        const revealed = snap.reveal || this.revealAll;
        if (!p.out) {
          if (p.isHuman) {
            p.hole.forEach((c) => cardsHtml.appendChild(this.cardEl(c, true)));
          } else if (revealed && !p.folded) {
            p.hole.forEach((c) => cardsHtml.appendChild(this.cardEl(c)));
          } else {
            cardsHtml.classList.add('mini-cards');
            p.hole.forEach(() => cardsHtml.appendChild(this.cardBack()));
          }
        }
        seat.appendChild(cardsHtml);

        // 名前・スタック
        const info = document.createElement('div');
        info.className = 'seat-info';
        const styleName = p.isHuman ? '' :
          `<span class="style-tag">${(window.Poker.STYLES[p.style] || {}).name || ''}</span>`;
        const shown = (this.shownStack && this.shownStack[p.id] != null) ? this.shownStack[p.id] : p.stack;
        info.innerHTML =
          `<div class="seat-name">${p.name} ${styleName}</div>` +
          `<div class="seat-stack">💰 <span class="stack-val">${shown}</span></div>`;
        seat.appendChild(info);
        const sv = info.querySelector('.stack-val');
        if (sv) this.tweenStack(sv, p.id, p.stack);

        // ベットチップ
        if (p.betThisStreet > 0) {
          const chip = document.createElement('div');
          chip.className = 'bet-chip';
          chip.innerHTML = `<span class="chip-ico">🔴</span>${p.betThisStreet}`;
          seat.appendChild(chip);
        }

        // 現在の役名（自分は常に / 相手はショーダウンで公開時）
        const rankVisible = !p.folded && !p.out && p.hole.length === 2 &&
          (p.isHuman || ((snap.reveal || this.revealAll) && snap.board.length >= 3));
        if (rankVisible) {
          const rank = this.heroHandName(p.hole, snap.board);
          if (rank) {
            const hr = document.createElement('div');
            hr.className = 'hand-rank';
            hr.textContent = rank;
            seat.appendChild(hr);
          }
        }

        seats.appendChild(seat);
      });
    },

    // アバター用の絵文字と色
    avatarEmoji(id, isHuman) {
      if (isHuman) return '😎';
      const e = ['🦊', '🐼', '🐯', '🐨', '🦁', '🐵', '🐱', '🐶'];
      return e[(id - 1 + e.length) % e.length];
    },
    avatarColor(id, isHuman) {
      if (isHuman) return 'linear-gradient(135deg,#3a86ff,#2456b3)';
      const c = ['#b5651d', '#5a7d9a', '#7d5a9a', '#9a5a6e', '#5a9a72', '#8a8a3a', '#9a7d5a', '#6e5a9a'];
      return c[(id - 1 + c.length) % c.length];
    },

    // 自分の現在の役名
    heroHandName(hole, board) {
      try {
        const { Card, evaluate } = window.Poker;
        const cards = [...hole, ...board].map((c) => new Card(c.rank, c.suit));
        if (cards.length < 2) return '';
        return evaluate(cards).name;
      } catch (e) { return ''; }
    },

    // 手札+ボードの役カテゴリ（数値）。評価不可なら -1。
    evalCategory(hole, board) {
      try {
        const { Card, evaluate } = window.Poker;
        const cards = [...hole, ...board].map((c) => new Card(c.rank, c.suit));
        if (cards.length < 2) return -1;
        return evaluate(cards).category;
      } catch (e) { return -1; }
    },

    // カテゴリ→演出用CSSクラス
    fxClassFor(category) {
      const C = window.Poker.CATEGORY;
      return {
        [C.TWO_PAIR]: 'cat-twopair',
        [C.TRIPS]: 'cat-trips',
        [C.STRAIGHT]: 'cat-straight',
        [C.FLUSH]: 'cat-flush',
        [C.FULL_HOUSE]: 'cat-fullhouse',
        [C.QUADS]: 'cat-quads',
        [C.STRAIGHT_FLUSH]: 'cat-straightflush',
      }[category] || 'cat-default';
    },

    // 役成立の演出を中央に表示
    showHandFx(text, sub, category) {
      const layer = this.el('fx-layer');
      if (!layer) return;
      const burst = document.createElement('div');
      burst.className = 'fx-burst ' + this.fxClassFor(category);
      burst.innerHTML = `<span class="fx-main">${text}</span>` + (sub ? `<span class="fx-sub">${sub}</span>` : '');
      layer.appendChild(burst);
      // きらめき
      for (let i = 0; i < 8; i++) {
        const s = document.createElement('span');
        s.className = 'fx-spark';
        s.textContent = category >= window.Poker.CATEGORY.STRAIGHT ? '✨' : '●';
        s.style.left = (38 + Math.random() * 24) + '%';
        s.style.top = (34 + Math.random() * 18) + '%';
        s.style.setProperty('--dx', (Math.random() * 160 - 80) + 'px');
        s.style.setProperty('--dy', (Math.random() * 120 - 70) + 'px');
        s.style.animationDelay = (Math.random() * 0.15) + 's';
        layer.appendChild(s);
      }
      setTimeout(() => { layer.innerHTML = ''; }, 2000);
    },

    // チップが移動する演出。fromEl→toEl へ弧を描いて飛び、着地でバウンドする。
    animateChips(fromEl, toEl, opts = {}) {
      if (this.fastForward) return; // 早送り中は省略
      const layer = this.el('fx-layer');
      const table = document.querySelector('.poker-table');
      if (!layer || !table || !fromEl || !toEl) return;
      const t = table.getBoundingClientRect();
      const a = fromEl.getBoundingClientRect();
      const b = toEl.getBoundingClientRect();
      if (!a.width || !b.width) return;
      const fromX = a.left + a.width / 2 - t.left;
      const fromY = a.top + a.height / 2 - t.top;
      const dx = b.left + b.width / 2 - t.left - fromX;
      const dy = b.top + b.height / 2 - t.top - fromY;
      const arc = -(36 + Math.abs(dx) * 0.12); // 放物線の高さ
      const count = Math.max(1, Math.min(6, opts.count || 3));
      for (let i = 0; i < count; i++) {
        const chip = document.createElement('div');
        chip.className = 'fly-chip' + (opts.cls ? ' ' + opts.cls : '');
        chip.style.left = fromX + 'px';
        chip.style.top = fromY + 'px';
        layer.appendChild(chip);
        const jx = Math.random() * 18 - 9;
        const jy = Math.random() * 14 - 7;
        const delay = i * 55;
        const anim = chip.animate([
          { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0 },
          { transform: `translate(${dx * 0.5 + jx * 0.5}px, ${dy * 0.5 + arc}px) scale(1.05)`, opacity: 1, offset: 0.5 },
          { transform: `translate(${dx + jx}px, ${dy + jy - 7}px) scale(1.2)`, opacity: 1, offset: 0.8 },
          { transform: `translate(${dx + jx}px, ${dy + jy}px) scale(.92)`, opacity: .95, offset: 0.9 },
          { transform: `translate(${dx + jx}px, ${dy + jy - 3}px) scale(1.06)`, opacity: .9, offset: 0.96 },
          { transform: `translate(${dx + jx}px, ${dy + jy}px) scale(1)`, opacity: .12, offset: 1 },
        ], { duration: 640, delay, easing: 'cubic-bezier(.35,.05,.3,1)', fill: 'forwards' });
        anim.onfinish = () => chip.remove();
        setTimeout(() => chip.remove(), 720 + delay);
      }
      // 金額ラベル
      if (opts.label) {
        const lab = document.createElement('div');
        lab.className = 'chip-label' + (opts.cls ? ' ' + opts.cls : '');
        lab.textContent = opts.label;
        lab.style.left = fromX + 'px';
        lab.style.top = fromY + 'px';
        layer.appendChild(lab);
        const la = lab.animate([
          { transform: 'translate(-50%,-50%)', opacity: 0, offset: 0 },
          { transform: 'translate(-50%,-50%) translateY(-8px)', opacity: 1, offset: 0.2 },
          { transform: `translate(-50%,-50%) translate(${dx}px, ${dy + arc}px)`, opacity: 1, offset: 0.6 },
          { transform: `translate(-50%,-50%) translate(${dx}px, ${dy}px)`, opacity: 0, offset: 1 },
        ], { duration: 720, easing: 'ease-out', fill: 'forwards' });
        la.onfinish = () => lab.remove();
        setTimeout(() => lab.remove(), 800);
      }
    },

    // スタックのカウントアップ/ダウン表示
    tweenStack(el, id, to) {
      if (!this.shownStack) this.shownStack = {};
      if (!this._stackTw) this._stackTw = {};
      const from = this.shownStack[id] != null ? this.shownStack[id] : to;
      if (this._stackTw[id]) cancelAnimationFrame(this._stackTw[id]);
      if (from === to) { el.textContent = to; this.shownStack[id] = to; return; }
      const dur = 550, t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        const val = Math.round(from + (to - from) * e);
        el.textContent = val;
        this.shownStack[id] = val;
        if (k < 1) { this._stackTw[id] = requestAnimationFrame(step); }
        else { el.textContent = to; this.shownStack[id] = to; delete this._stackTw[id]; }
      };
      this._stackTw[id] = requestAnimationFrame(step);
    },

    seatEl(id) {
      return this.el('seats').querySelector(`.seat[data-id="${id}"]`);
    },
    potEl() {
      return this.el('pot-display');
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
      const r = window.Poker.displayRank(c.rank);
      if (r.length > 1) d.classList.add('two-char');
      d.innerHTML = `<span class="card-rank">${r}</span><span class="card-suit">${SUIT_SYMBOLS[c.suit]}</span>`;
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
      const made = this.heroHandName(
        player.hole.map((c) => ({ rank: c.rank, suit: c.suit })),
        this.game.board.map((c) => ({ rank: c.rank, suit: c.suit }))
      );
      this.el('equity-hint').innerHTML =
        `<b>${made}</b>　|　推定勝率 ${Math.round(eq * 100)}%　|　必要勝率 ${toCall > 0 ? Math.round(toCall / (pot + toCall) * 100) : 0}%`;

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

    // ===== 早送り（自分がフォールドした後） =====
    showFastForward() {
      const ff = this.el('ff-controls');
      if (!ff) return;
      ff.classList.remove('hidden');
      this.el('btn-fastforward').onclick = () => {
        this.fastForward = true;
        this.hideFastForward();
      };
    },
    hideFastForward() {
      const ff = this.el('ff-controls');
      if (ff) ff.classList.add('hidden');
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

      // 勝者の役を中央で演出 + 勝者席をハイライト
      let best = null;
      for (const r of results) {
        if (r.hand && (!best || r.hand.category > best.hand.category)) best = r;
      }
      if (best && best.hand) {
        const names = best.winners.map((id) => this.game.players[id].name).join('・');
        this.showHandFx(`${best.hand.name}！`, `${names} の勝ち`, best.hand.category);
      }
      // 勝者席に王冠＋金枠
      const winnerIds = new Set();
      results.forEach((r) => r.winners.forEach((id) => winnerIds.add(id)));
      winnerIds.forEach((id) => {
        const seatEl = this.el('seats').querySelector(`.seat[data-id="${id}"]`);
        if (seatEl) {
          seatEl.classList.add('winner-seat');
          const av = seatEl.querySelector('.avatar');
          if (av && !av.querySelector('.crown')) {
            const crown = document.createElement('span');
            crown.className = 'crown';
            crown.textContent = '👑';
            av.appendChild(crown);
          }
        }
      });
      // 勝ち役に応じた効果音
      this.sfx(best && best.hand && best.hand.category >= window.Poker.CATEGORY.FLUSH ? 'ding' : 'win');
      // ポット→勝者へチップが流れる演出（少し遅らせて役演出のあとに）
      const won = e.winningsById || {};
      setTimeout(() => {
        winnerIds.forEach((id) => {
          const amt = won[id] || 0;
          const count = Math.max(2, Math.min(6, Math.round(amt / (this.game.bigBlind * 3))));
          this.animateChips(this.potEl(), this.seatEl(id), { count, cls: 'win', label: '+' + amt });
        });
        this.sfx('coins');
      }, 450);
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
        // 自動で次のハンドへ（演出を見せてから）
        if (this.autoNext) {
          this.el('btn-next-hand').textContent = '次のハンドへ ▶（自動・タップで即）';
          if (this.autoNextTimer) clearTimeout(this.autoNextTimer);
          this.autoNextTimer = setTimeout(() => {
            this.autoNextTimer = null;
            if (!this.gameEnded && !this.game.players[0].out) this.nextHand();
          }, 2800);
        } else {
          this.el('btn-next-hand').textContent = '次のハンドへ ▶';
        }
      }
    },

    nextHand() {
      if (this.autoNextTimer) { clearTimeout(this.autoNextTimer); this.autoNextTimer = null; }
      this.el('next-hand-controls').classList.add('hidden');
      this.hideFastForward();
      this.fastForward = false;
      this.humanFolded = false;
      this.revealAll = false;
      this.queue = [];
      this.animating = false;
      this.game.startHand();
    },

    onGameOver(e) {
      this.gameEnded = true;
      if (this.autoNextTimer) { clearTimeout(this.autoNextTimer); this.autoNextTimer = null; }
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
      if (this.autoNextTimer) { clearTimeout(this.autoNextTimer); this.autoNextTimer = null; }
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
