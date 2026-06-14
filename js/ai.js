// ai.js — CPU の意思決定ロジック
// モンテカルロ法で勝率(エクイティ)を推定し、ポットオッズ・ポジション・
// プレイスタイル(性格)を加味してアクションを決める。

(function () {
  const { Card, RANKS, SUITS, evaluate } = window.Poker;

  // 既知のカードを除いた山札を作る
  function remainingDeck(known) {
    const knownCodes = new Set(known.map((c) => c.code));
    const deck = [];
    for (const s of SUITS) {
      for (const r of RANKS) {
        const c = new Card(r, s);
        if (!knownCodes.has(c.code)) deck.push(c);
      }
    }
    return deck;
  }

  function pick(deck, n) {
    // deck から重複なく n 枚ランダム抽出（破壊的でない）
    const idxs = new Set();
    while (idxs.size < n) {
      idxs.add(Math.floor(Math.random() * deck.length));
    }
    return [...idxs].map((i) => deck[i]);
  }

  // 自分の hole2枚 + 既知の board に対し、相手 opponents 人を仮定して
  // モンテカルロで勝率(引き分けは分割)を推定する。
  function estimateEquity(hole, board, opponents, iterations = 300) {
    const known = [...hole, ...board];
    const deck = remainingDeck(known);
    let win = 0;
    let tie = 0;

    for (let it = 0; it < iterations; it++) {
      // 必要枚数: 残りボード + 相手ハンド
      const needBoard = 5 - board.length;
      const draw = pick(deck, needBoard + opponents * 2);
      let di = 0;
      const fullBoard = [...board];
      for (let k = 0; k < needBoard; k++) fullBoard.push(draw[di++]);

      const myScore = evaluate([...hole, ...fullBoard]).score;
      let best = myScore;
      let bestCount = 1; // 自分を含む最高スコアの人数
      let iWin = true;
      for (let o = 0; o < opponents; o++) {
        const oppHole = [draw[di++], draw[di++]];
        const oppScore = evaluate([...oppHole, ...fullBoard]).score;
        if (oppScore > best) {
          best = oppScore;
          bestCount = 1;
          iWin = false;
        } else if (oppScore === best) {
          bestCount++;
        }
      }
      if (iWin && myScore === best) {
        if (bestCount === 1) win++;
        else tie += 1 / bestCount;
      }
    }
    return (win + tie) / iterations;
  }

  // プレイスタイル定義
  // tightness: 参加ハンドの厳しさ(高いほど降りやすい)
  // aggression: ベット/レイズの頻度
  // bluff: ブラフ頻度
  const STYLES = {
    rock:     { name: 'ロック',       tightness: 0.62, aggression: 0.35, bluff: 0.03 },
    tag:      { name: 'TAG',          tightness: 0.50, aggression: 0.60, bluff: 0.10 },
    lag:      { name: 'LAG',          tightness: 0.38, aggression: 0.80, bluff: 0.22 },
    station:  { name: 'コーリングST', tightness: 0.40, aggression: 0.25, bluff: 0.05 },
    maniac:   { name: 'マニアック',   tightness: 0.30, aggression: 0.92, bluff: 0.35 },
  };

  // メイン: 状況からアクションを決める
  // ctx = {
  //   hole, board, toCall, pot, stack, minRaise, bigBlind,
  //   activeOpponents, style, street ('preflop'|'flop'|'turn'|'river'),
  //   position ('early'|'middle'|'late'|'blinds')
  // }
  // 戻り値: { action: 'fold'|'check'|'call'|'raise', amount }
  function decide(ctx) {
    const style = STYLES[ctx.style] || STYLES.tag;
    const opp = Math.max(1, ctx.activeOpponents);
    const iterations = ctx.street === 'preflop' ? 200 : 280;
    let equity = estimateEquity(ctx.hole, ctx.board, opp, iterations);

    // スタイルのタイトさを「降り閾値」へ反映
    const toCall = ctx.toCall;
    const pot = ctx.pot;
    const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;

    // ポジション補正: 後ろのポジションほど強気に
    const posBonus = { early: -0.03, middle: 0, late: 0.04, blinds: -0.01 }[ctx.position] || 0;
    const effEquity = Math.min(0.99, Math.max(0.01, equity + posBonus));

    // ランダム要素（読みにくさ）
    const noise = (Math.random() - 0.5) * 0.06;

    // --- チェック可能（コール不要） ---
    if (toCall === 0) {
      // バリュー/セミブラフでベットするか
      const betThreshold = 0.55 - style.aggression * 0.18;
      const wantsBet = effEquity + noise > betThreshold || Math.random() < style.bluff;
      if (wantsBet && ctx.stack > 0) {
        const amount = sizeBet(ctx, effEquity, style);
        return { action: 'raise', amount };
      }
      return { action: 'check' };
    }

    // --- コールが必要 ---
    // 必要勝率 = ポットオッズ。スタイルのタイトさで上乗せ。
    const requiredEquity = potOdds * (0.85 + style.tightness * 0.5);

    // 強いハンド: レイズ
    const raiseThreshold = 0.62 - style.aggression * 0.12;
    if (effEquity + noise > raiseThreshold && ctx.stack > toCall) {
      // たまにスロープレイ
      if (Math.random() < 0.15 && effEquity < 0.85) {
        return { action: 'call', amount: Math.min(toCall, ctx.stack) };
      }
      const amount = sizeBet(ctx, effEquity, style);
      if (amount > toCall) return { action: 'raise', amount };
      return { action: 'call', amount: Math.min(toCall, ctx.stack) };
    }

    // ブラフレイズ
    if (effEquity < requiredEquity && Math.random() < style.bluff * 0.5 && ctx.stack > toCall * 2) {
      const amount = sizeBet(ctx, 0.5, style);
      return { action: 'raise', amount };
    }

    // コール判断
    if (effEquity + noise >= requiredEquity) {
      return { action: 'call', amount: Math.min(toCall, ctx.stack) };
    }

    // それ以外はフォールド（ただしチェック可能ならチェック）
    return { action: 'fold' };
  }

  // ベット/レイズ額を決める（ポットに対する割合）
  function sizeBet(ctx, equity, style) {
    let fraction;
    if (ctx.street === 'preflop') {
      fraction = 1.0; // プリフロップはポット弱の標準オープン相当
    } else {
      // バリューが高いほど大きめ、スタイルで調整
      fraction = 0.45 + equity * 0.4 + style.aggression * 0.15;
    }
    const base = Math.max(ctx.bigBlind, Math.round(ctx.pot * fraction));
    let amount = ctx.toCall + base; // 現在のコール額にレイズ分を上乗せ
    amount = Math.max(amount, ctx.toCall + ctx.minRaise);
    amount = Math.min(amount, ctx.stack); // オールイン上限
    return Math.round(amount);
  }

  Object.assign(window.Poker, { estimateEquity, decide, STYLES });
})();
