// strategy.js — 最新（GTOベース）戦略を学べるモードのデータとトレーナー
// レッスン本文＋インタラクティブな練習（プリフロップレンジ／ポットオッズ）。

(function () {
  const { RANKS } = window.Poker;

  // ===== レッスン本文 =====
  const LESSONS = [
    {
      id: 'gto',
      title: 'GTOとは何か（基礎）',
      body: [
        'GTO（Game Theory Optimal）は「相手にどう対応されても搾取されない」均衡戦略のこと。',
        '現代ポーカーの土台で、まず「崩れない基準線」を作り、相手の弱点が見えたらそこから逸脱(エクスプロイト)して利益を上乗せします。',
        'ポイント: ①混合戦略（同じ状況でもコール/レイズを一定比率で混ぜる）②レンジで考える（単体のハンドではなく「ありうる手札全体」で意思決定）③ベットサイズと頻度はセット。',
        '初心者はまず「タイトに正しいレンジで参加し、ポジションを使い、ポットオッズに従う」だけで多くの相手に勝てます。',
      ],
    },
    {
      id: 'position',
      title: 'ポジションの力',
      body: [
        '後（ボタンに近い）に行動できるほど、相手の情報を見てから決められるため有利。',
        'アーリー(UTG)は強いハンドだけ、レイト(CO/BTN)は広いレンジで参加するのが基本。',
        'ボタンは全ストリートで最後に行動できる最強ポジション。ここでのオープンレンジは最も広く取ります。',
        '「迷ったらポジションがある時だけ続ける」は強力な指針です。',
      ],
    },
    {
      id: 'preflop',
      title: 'プリフロップ・レンジ',
      body: [
        '現代の標準は「ポジションごとに決まったオープンレンジ」を覚えること。',
        'UTG: 上位約15%（大きいペア、AK/AQ、AJs、KQsなど）。',
        'CO: 約27%まで拡大。BTN: 約45%と最も広く、スーテッドコネクターや小さいペアも含む。',
        'SB/BBはディフェンス（3ベット or コール）のレンジを別途持ちます。リンプ(コールだけ)よりレイズが基本。',
        '右の「レンジトレーナー」で、配られた手札を即座にオープン/フォールド判断する練習ができます。',
      ],
    },
    {
      id: 'potodds',
      title: 'ポットオッズとエクイティ',
      body: [
        'ポットオッズ = コール額 ÷ (ポット + コール額)。これが「コールに必要な最低勝率」。',
        '例: ポット100に対し50コール → 50 / 150 = 33%。手の勝率が33%超ならコールが正当化される。',
        'ドローの勝率は「アウツ × 2 ≒ 1枚で当たる%」「アウツ × 4 ≒ 残り2枚で当たる%（フロップ時）」で概算（4-2の法則）。',
        '例: フラッシュドローはアウツ9枚 → フロップで約36%。リバー1枚なら約18%。',
        '右の「ポットオッズ・クイズ」で計算を反復し、瞬時に判断できるようにします。',
      ],
    },
    {
      id: 'cbet',
      title: 'Cベットとボードの質感',
      body: [
        'Cベット(継続ベット)はプリフロップのアグレッサーがフロップでもベットすること。',
        'レンジが有利なボード(A高/K高などハイカード)では小さく高頻度にCベット。',
        '相手に有利な湿ったボード(連結・同色が多い中位ボード)では頻度を落とし、強い手と良いドローに絞る。',
        'サイズは「乾いたボードは小さく(1/3)、湿ったボードは大きく(2/3〜)」が現代的な指針。',
      ],
    },
    {
      id: 'sizing',
      title: 'ベットサイズの設計',
      body: [
        'サイズは目的で決める: バリュー(強い手で薄く厚く取る)か、ブラフ(相手を降ろす)か。',
        '同じ状況ではバリューとブラフを同じサイズで打ち、相手にサイズから手を読ませない(バランス)。',
        '大きいサイズ(ポット以上のオーバーベット)は、相手のレンジが上限に弱いポラライズ局面で有効。',
        'スタックとポットの比(SPR)が小さいほどコミットしやすく、ブラフは効きにくくなります。',
      ],
    },
    {
      id: 'mental',
      title: 'メンタルとバンクロール',
      body: [
        '分散(運の振れ)は大きい。正しい判断でも短期では負ける。結果ではなく意思決定の質で評価する。',
        'ティルト(熱くなって判断が崩れる状態)を避ける。負けが込んだら離席するルールを決める。',
        'バンクロール管理: 1回のゲームに資金の数%以上をリスクしない。これが長期で生き残る条件。',
      ],
    },
  ];

  // ===== プリフロップ・オープンレンジ（簡易版・169通り） =====
  // 表記: "AKs"(スーテッド), "AKo"(オフスート), "AA"(ペア)
  // 各ポジションでオープン(レイズ)推奨のハンド集合。
  const OPEN_RANGES = {
    UTG: new Set([
      'AA','KK','QQ','JJ','TT','99','88','77',
      'AKs','AQs','AJs','ATs','KQs','KJs','QJs','JTs',
      'AKo','AQo',
    ]),
    MP: new Set([
      'AA','KK','QQ','JJ','TT','99','88','77','66','55',
      'AKs','AQs','AJs','ATs','A9s','KQs','KJs','KTs','QJs','QTs','JTs','T9s',
      'AKo','AQo','AJo','KQo',
    ]),
    CO: new Set([
      'AA','KK','QQ','JJ','TT','99','88','77','66','55','44','33','22',
      'AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s',
      'KQs','KJs','KTs','K9s','QJs','QTs','Q9s','JTs','J9s','T9s','98s','87s','76s','65s',
      'AKo','AQo','AJo','ATo','KQo','KJo','QJo',
    ]),
    BTN: new Set([
      'AA','KK','QQ','JJ','TT','99','88','77','66','55','44','33','22',
      'AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s',
      'KQs','KJs','KTs','K9s','K8s','K7s','K6s','K5s','K4s','K3s','K2s',
      'QJs','QTs','Q9s','Q8s','Q7s','Q6s','Q5s','JTs','J9s','J8s','J7s',
      'T9s','T8s','T7s','98s','97s','87s','86s','76s','75s','65s','54s','43s',
      'AKo','AQo','AJo','ATo','A9o','A8o','A5o',
      'KQo','KJo','KTo','K9o','QJo','QTo','Q9o','JTo','J9o','T9o','98o',
    ]),
  };

  // 2枚のカードから 169通り表記を作る
  function handCode(c1, c2) {
    const order = (c) => window.Poker.RANK_VALUE[c.rank];
    let hi = c1, lo = c2;
    if (order(c2) > order(c1)) { hi = c2; lo = c1; }
    if (hi.rank === lo.rank) return hi.rank + lo.rank; // ペア
    const suited = hi.suit === lo.suit ? 's' : 'o';
    return hi.rank + lo.rank + suited;
  }

  // ランダムな2枚を生成
  function randomHole() {
    const { Card } = window.Poker;
    const suits = ['s', 'h', 'd', 'c'];
    function rc() {
      return new Card(RANKS[Math.floor(Math.random() * 13)], suits[Math.floor(Math.random() * 4)]);
    }
    let a = rc(), b = rc();
    while (a.code === b.code) b = rc();
    return [a, b];
  }

  const POSITIONS = ['UTG', 'MP', 'CO', 'BTN'];

  // 出題: ランダムなポジション＋ハンド。正解は OPEN/FOLD。
  function newRangeQuestion() {
    const pos = POSITIONS[Math.floor(Math.random() * POSITIONS.length)];
    const hole = randomHole();
    const code = handCode(hole[0], hole[1]);
    const shouldOpen = OPEN_RANGES[pos].has(code);
    return { pos, hole, code, answer: shouldOpen ? 'open' : 'fold' };
  }

  // ポットオッズ・クイズ
  function newPotOddsQuestion() {
    const pot = (Math.floor(Math.random() * 18) + 3) * 10;       // 30..200
    const bet = (Math.floor(Math.random() * Math.max(2, pot / 10)) + 1) * 10;
    const required = bet / (pot + bet);                           // 必要勝率
    // 概算ドロー: アウツを提示し、それで足りるか判断させる
    const outsOptions = [4, 8, 9, 12, 15];
    const outs = outsOptions[Math.floor(Math.random() * outsOptions.length)];
    const street = Math.random() < 0.5 ? 'flop' : 'turn';
    const equity = street === 'flop' ? Math.min(0.95, outs * 0.04) : Math.min(0.95, outs * 0.02);
    return {
      pot, bet, required,
      outs, street,
      equity,
      correct: equity >= required ? 'call' : 'fold',
    };
  }

  Object.assign(window.Poker, {
    LESSONS, OPEN_RANGES, POSITIONS,
    handCode, randomHole, newRangeQuestion, newPotOddsQuestion,
  });
})();
