// game.js — テキサスホールデム（ノーリミット）ゲームエンジン
// イベント駆動。UI は onEvent コールバックで状態を受け取り、
// 人間プレイヤーの番では submitAction() で進行する。

(function () {
  const { Deck, evaluate, decide } = window.Poker;

  const STREETS = ['preflop', 'flop', 'turn', 'river'];

  class Player {
    constructor(id, name, stack, isHuman, style) {
      this.id = id;
      this.name = name;
      this.stack = stack;
      this.isHuman = isHuman;
      this.style = style;       // CPU のプレイスタイルキー
      this.hole = [];
      this.folded = false;
      this.allIn = false;
      this.out = false;         // チップ切れで卓から退場
      this.betThisStreet = 0;   // 現ストリートでの拠出額
      this.totalBet = 0;        // ハンド全体での拠出額（サイドポット用）
      this.lastAction = '';
      this.lastActionType = ''; // fold/check/call/raise/allin/blind（吹き出しの色分け用）
    }
    get inHand() {
      return !this.folded && !this.out;
    }
  }

  class Game {
    constructor(config) {
      this.config = config; // { players:[{name,isHuman,style}], startStack, smallBlind, bigBlind }
      this.onEvent = config.onEvent || (() => {});
      this.players = config.players.map(
        (p, i) => new Player(i, p.name, config.startStack, p.isHuman, p.style)
      );
      this.smallBlind = config.smallBlind;
      this.bigBlind = config.bigBlind;
      this.dealer = -1;
      this.handNo = 0;
      this.deck = new Deck();
      this.board = [];
      this.pots = [];
      this.streetIndex = 0;
      this.currentBet = 0;     // 現ストリートで合わせるべき最大ベット額
      this.minRaise = this.bigBlind;
      this.toActQueue = [];
      this.actingPlayer = null;
      this.lastAggressor = null;
      this.handActive = false;
      this.waitingForHuman = false;
    }

    emit(type, data = {}) {
      this.onEvent({ type, ...data, game: this });
    }

    activePlayers() {
      return this.players.filter((p) => !p.out);
    }

    playersInHand() {
      return this.players.filter((p) => p.inHand);
    }

    // 次の（out でない）プレイヤーインデックスを得る
    nextIndex(from) {
      const n = this.players.length;
      for (let k = 1; k <= n; k++) {
        const idx = (from + k) % n;
        if (!this.players[idx].out) return idx;
      }
      return from;
    }

    startHand() {
      if (this.activePlayers().length < 2) {
        this.emit('gameOver', { winner: this.activePlayers()[0] });
        return;
      }
      this.handNo++;
      this.deck.reset();
      this.deck.shuffle();
      this.board = [];
      this.pots = [];
      this.streetIndex = 0;
      this.currentBet = 0;
      this.minRaise = this.bigBlind;
      this.lastAggressor = null;
      this.handActive = true;

      for (const p of this.players) {
        p.hole = [];
        p.folded = false;
        p.allIn = false;
        p.betThisStreet = 0;
        p.totalBet = 0;
        p.lastAction = '';
        p.lastActionType = '';
      }

      // ボタン移動
      this.dealer = this.nextIndex(this.dealer);

      // ブラインド位置
      const inPlayers = this.activePlayers();
      let sbIndex, bbIndex;
      if (inPlayers.length === 2) {
        // ヘッズアップ: ボタン=SB
        sbIndex = this.dealer;
        bbIndex = this.nextIndex(this.dealer);
      } else {
        sbIndex = this.nextIndex(this.dealer);
        bbIndex = this.nextIndex(sbIndex);
      }

      this.postBlind(this.players[sbIndex], this.smallBlind, 'SB');
      this.postBlind(this.players[bbIndex], this.bigBlind, 'BB');
      this.currentBet = this.bigBlind;
      this.minRaise = this.bigBlind;

      // ホールカード配布
      for (const p of this.activePlayers()) {
        p.hole = this.deck.deal(2);
      }

      this.emit('handStart', { dealer: this.dealer, sb: sbIndex, bb: bbIndex });

      // プリフロップのアクション開始位置: BB の次
      const firstToAct = this.nextIndex(bbIndex);
      this.beginStreet(firstToAct, true);
    }

    postBlind(player, amount, label) {
      const pay = Math.min(amount, player.stack);
      player.stack -= pay;
      player.betThisStreet += pay;
      player.totalBet += pay;
      if (player.stack === 0) player.allIn = true;
      player.lastAction = label;
      player.lastActionType = 'blind';
    }

    // ストリートのアクション順を組み立て、最初のプレイヤーへ
    beginStreet(firstIdx, isPreflop = false) {
      // アクション可能（フォールド/オールイン/out でない）プレイヤーの順番
      this.toActQueue = [];
      const n = this.players.length;
      for (let k = 0; k < n; k++) {
        const idx = (firstIdx + k) % n;
        const p = this.players[idx];
        if (p.inHand && !p.allIn) this.toActQueue.push(idx);
      }
      // ベットに直面していない場合の締め: 全員がアクション済みかで判断するため
      // lastAggressor を基準にする。プリフロップは BB がアグレッサー扱い。
      this.streetActedSet = new Set();
      this.proceed();
    }

    proceed() {
      // ハンド継続条件チェック
      const contenders = this.playersInHand();
      if (contenders.length <= 1) {
        return this.endHand();
      }

      // アクション可能なプレイヤーが残っているか
      const canAct = contenders.filter((p) => !p.allIn);
      if (canAct.length === 0) {
        // 全員オールイン -> 残りのボードを開いてショーダウン
        return this.runOutBoard();
      }

      // ベッティングラウンド終了判定
      if (this.isBettingClosed()) {
        return this.advanceStreet();
      }

      // 次にアクションするプレイヤー
      const idx = this.toActQueue.shift();
      if (idx === undefined) {
        // キューが尽きたが終了条件未達 -> 再構築
        if (this.isBettingClosed()) return this.advanceStreet();
        // 安全策: 終了
        return this.advanceStreet();
      }
      const player = this.players[idx];
      if (!player.inHand || player.allIn) {
        return this.proceed();
      }
      this.actingPlayer = player;
      this.askAction(player);
    }

    // ベッティングが閉じたか: 全員が currentBet に合わせ、かつ全員が1度アクション済み
    isBettingClosed() {
      const actants = this.playersInHand().filter((p) => !p.allIn);
      if (actants.length === 0) return true;
      // 全員のベットが揃っているか
      const allMatched = actants.every((p) => p.betThisStreet === this.currentBet);
      // 全員が今ストリートで行動済みか
      const allActed = actants.every((p) => this.streetActedSet.has(p.id));
      return allMatched && allActed && this.toActQueue.length === 0;
    }

    askAction(player) {
      const toCall = this.currentBet - player.betThisStreet;
      const ctx = this.buildContext(player, toCall);
      if (player.isHuman) {
        this.waitingForHuman = true;
        this.actingPlayer = player;
        this.emit('awaitHuman', { player, toCall, ctx });
      } else {
        // CPU: 少し考える演出は UI 側で。ここでは即決し emit。
        const decision = decide(ctx);
        this.applyAction(player, decision.action, decision.amount, toCall);
      }
    }

    buildContext(player, toCall) {
      const pot = this.totalPot();
      const inHand = this.playersInHand();
      // ポジション簡易判定
      let position = 'middle';
      const order = inHand.length;
      // ボタンからの相対位置で雑に分類
      const dealerSeat = this.dealer;
      const rel = (player.id - dealerSeat + this.players.length) % this.players.length;
      if (rel <= 1) position = 'blinds';
      else if (rel >= this.players.length - 2) position = 'late';
      else if (rel <= Math.floor(this.players.length / 3)) position = 'early';
      else position = 'middle';

      return {
        hole: player.hole,
        board: this.board,
        toCall,
        pot,
        stack: player.stack,
        minRaise: this.minRaise,
        bigBlind: this.bigBlind,
        activeOpponents: Math.max(1, inHand.length - 1),
        style: player.style,
        street: STREETS[this.streetIndex],
        position,
      };
    }

    // 人間のアクション投入
    submitAction(action, amount) {
      if (!this.waitingForHuman || !this.actingPlayer) return;
      const player = this.actingPlayer;
      const toCall = this.currentBet - player.betThisStreet;
      this.waitingForHuman = false;
      this.applyAction(player, action, amount, toCall);
    }

    applyAction(player, action, amount, toCall) {
      this.streetActedSet.add(player.id);

      if (action === 'fold') {
        // チェックできるなら fold ではなく check 扱い（誤操作防止）
        if (toCall === 0) {
          player.lastAction = 'チェック';
          player.lastActionType = 'check';
          this.emit('action', { player, action: 'check', amount: 0 });
        } else {
          player.folded = true;
          player.lastAction = 'フォールド';
          player.lastActionType = 'fold';
          this.emit('action', { player, action: 'fold', amount: 0 });
        }
      } else if (action === 'check') {
        if (toCall > 0) {
          // チェック不可ならコール扱い
          return this.applyAction(player, 'call', toCall, toCall);
        }
        player.lastAction = 'チェック';
        player.lastActionType = 'check';
        this.emit('action', { player, action: 'check', amount: 0 });
      } else if (action === 'call') {
        const pay = Math.min(toCall, player.stack);
        player.stack -= pay;
        player.betThisStreet += pay;
        player.totalBet += pay;
        if (player.stack === 0) player.allIn = true;
        player.lastAction = pay > 0 ? `コール ${pay}` : 'チェック';
        player.lastActionType = player.allIn ? 'allin' : (pay > 0 ? 'call' : 'check');
        this.emit('action', { player, action: 'call', amount: pay });
      } else if (action === 'raise') {
        // amount は「合計のベット額（このストリートで到達する額）」として解釈
        let target = Math.max(amount, this.currentBet + this.minRaise);
        // スタックを超えない（オールイン）
        const maxTarget = player.betThisStreet + player.stack;
        target = Math.min(target, maxTarget);
        const pay = target - player.betThisStreet;
        player.stack -= pay;
        player.betThisStreet = target;
        player.totalBet += pay;
        if (player.stack === 0) player.allIn = true;

        const raiseSize = target - this.currentBet;
        if (raiseSize >= this.minRaise) {
          this.minRaise = raiseSize;
        }
        this.currentBet = Math.max(this.currentBet, target);
        this.lastAggressor = player;
        player.lastAction = player.allIn ? `オールイン ${target}` : `レイズ ${target}`;
        player.lastActionType = player.allIn ? 'allin' : 'raise';

        // レイズが入ったので、他の全員に再アクション権が戻る
        this.reopenAction(player);
        this.emit('action', { player, action: 'raise', amount: target });
      }

      // 次へ
      this.proceed();
    }

    // レイズ後、アクション順を再構築（レイザーの次から、レイザー本人手前まで）
    reopenAction(raiser) {
      this.streetActedSet = new Set([raiser.id]);
      this.toActQueue = [];
      const n = this.players.length;
      const start = raiser.id;
      for (let k = 1; k < n; k++) {
        const idx = (start + k) % n;
        const p = this.players[idx];
        if (p.inHand && !p.allIn) this.toActQueue.push(idx);
      }
    }

    advanceStreet() {
      // ストリート終了 -> ベットをポットへ集約（サイドポット計算は最後にまとめて）
      // 吹き出しは新ストリートの行動を示すため一旦クリア（フォールド表示は維持）
      for (const p of this.players) {
        p.betThisStreet = 0;
        if (!p.folded) { p.lastAction = ''; p.lastActionType = ''; }
      }
      this.currentBet = 0;
      this.minRaise = this.bigBlind;
      this.streetActedSet = new Set();

      if (this.streetIndex >= STREETS.length - 1) {
        return this.showdown();
      }

      this.streetIndex++;
      // ボードを開く
      if (this.streetIndex === 1) {
        this.board.push(...this.deck.deal(3)); // flop
      } else {
        this.board.push(...this.deck.deal(1)); // turn / river
      }
      this.emit('board', { street: STREETS[this.streetIndex], board: this.board });

      // ポストフロップの最初のアクション: ボタンの次の生存者（SB側）から
      const first = this.firstToActPostflop();
      this.beginStreet(first, false);
    }

    firstToActPostflop() {
      // ボタンの次のインハンド・非オールインから
      let idx = this.dealer;
      const n = this.players.length;
      for (let k = 1; k <= n; k++) {
        const i = (this.dealer + k) % n;
        if (this.players[i].inHand) return i;
      }
      return idx;
    }

    runOutBoard() {
      // 全員オールイン状態。残りのボードを配ってショーダウン。
      this.emit('allInRunout', {});
      while (this.board.length < 5) {
        if (this.board.length < 3) {
          this.board.push(...this.deck.deal(3));
        } else {
          this.board.push(...this.deck.deal(1));
        }
        this.streetIndex = Math.min(this.streetIndex + 1, STREETS.length - 1);
      }
      this.emit('board', { street: 'river', board: this.board });
      this.showdown();
    }

    // メインポット/サイドポットを totalBet から計算
    computePots() {
      const contributors = this.players.filter((p) => p.totalBet > 0);
      const pots = [];
      let levels = [...new Set(contributors.map((p) => p.totalBet))].sort((a, b) => a - b);
      let prev = 0;
      for (const level of levels) {
        const slice = level - prev;
        const inThis = this.players.filter((p) => p.totalBet >= level);
        const amount = slice * inThis.length;
        if (amount > 0) {
          pots.push({
            amount,
            eligible: inThis.filter((p) => !p.folded).map((p) => p.id),
          });
        }
        prev = level;
      }
      // 連続する同一 eligible ポットを統合
      const merged = [];
      for (const pot of pots) {
        const key = pot.eligible.slice().sort().join(',');
        const last = merged[merged.length - 1];
        if (last && last.key === key) {
          last.amount += pot.amount;
        } else {
          merged.push({ amount: pot.amount, eligible: pot.eligible, key });
        }
      }
      return merged;
    }

    showdown() {
      const pots = this.computePots();
      const contenders = this.playersInHand();

      // 各プレイヤーの役を評価
      const evals = {};
      for (const p of contenders) {
        evals[p.id] = evaluate([...p.hole, ...this.board]);
      }

      const results = []; // ポットごとの勝者
      const winningsById = {};
      for (const pot of pots) {
        const eligible = pot.eligible.filter((id) => contenders.some((p) => p.id === id));
        if (eligible.length === 0) continue;
        let best = -1;
        let winners = [];
        for (const id of eligible) {
          const s = evals[id].score;
          if (s > best) {
            best = s;
            winners = [id];
          } else if (s === best) {
            winners.push(id);
          }
        }
        const share = Math.floor(pot.amount / winners.length);
        let remainder = pot.amount - share * winners.length;
        for (const id of winners) {
          let amt = share;
          if (remainder > 0) { amt += 1; remainder--; }
          this.players[id].stack += amt;
          winningsById[id] = (winningsById[id] || 0) + amt;
        }
        results.push({ amount: pot.amount, winners, hand: winners.length ? evals[winners[0]] : null });
      }

      this.emit('showdown', { evals, results, winningsById, board: this.board });
      this.finishHand();
    }

    // 1人だけ残ってハンド終了（ショーダウン無し）
    endHand() {
      const winner = this.playersInHand()[0];
      const pot = this.totalPot();
      if (winner) {
        winner.stack += pot;
        this.emit('handWonNoShowdown', { winner, amount: pot });
      }
      this.finishHand();
    }

    finishHand() {
      this.handActive = false;
      // チップ切れのプレイヤーを out に
      for (const p of this.players) {
        if (p.stack <= 0) {
          p.stack = 0;
          p.out = true;
        }
      }
      const remaining = this.activePlayers();
      this.emit('handComplete', { remaining });
      if (remaining.length < 2) {
        this.emit('gameOver', { winner: remaining[0] });
      }
    }

    totalPot() {
      return this.players.reduce((sum, p) => sum + p.totalBet, 0);
    }
  }

  Object.assign(window.Poker, { Game, Player, STREETS });
})();
