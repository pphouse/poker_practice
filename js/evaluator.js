// evaluator.js — 7枚のカードから最強の5枚ハンドを評価する
// 戻り値は比較可能な数値スコア（大きいほど強い）と役名。

(function () {
  const { RANK_VALUE } = window.Poker;

  // 役のカテゴリ（高いほど強い）
  const CATEGORY = {
    HIGH_CARD: 0,
    PAIR: 1,
    TWO_PAIR: 2,
    TRIPS: 3,
    STRAIGHT: 4,
    FLUSH: 5,
    FULL_HOUSE: 6,
    QUADS: 7,
    STRAIGHT_FLUSH: 8,
  };

  const CATEGORY_NAME_JA = {
    0: 'ハイカード',
    1: 'ワンペア',
    2: 'ツーペア',
    3: 'スリーカード',
    4: 'ストレート',
    5: 'フラッシュ',
    6: 'フルハウス',
    7: 'フォーカード',
    8: 'ストレートフラッシュ',
  };

  // 役を比較可能な単一整数にエンコードする。
  // category を最上位に、続いてタイブレーク用ランクを並べる。
  function encode(category, tiebreakers) {
    // tiebreakers は最大5要素、各要素は 0..14
    let score = category;
    for (let i = 0; i < 5; i++) {
      score = score * 16 + (tiebreakers[i] || 0);
    }
    return score;
  }

  // ストレートの最高ランクを返す（無ければ 0）。A-5 のホイールに対応。
  function straightHigh(valueSet) {
    // valueSet: Set of values present (2..14)
    // A を 1 としても扱えるよう 14 があれば 1 を補う
    const present = new Set(valueSet);
    if (present.has(14)) present.add(1);
    let run = 0;
    let best = 0;
    for (let v = 14; v >= 1; v--) {
      if (present.has(v)) {
        run++;
        if (run >= 5) {
          best = v + 4; // 連続開始の最高値
          break;
        }
      } else {
        run = 0;
      }
    }
    return best;
  }

  // cards: Card[] (5〜7枚)。最強の役を評価。
  function evaluate(cards) {
    const values = cards.map((c) => c.value);
    const suits = cards.map((c) => c.suit);

    // ランクごとの枚数
    const countByValue = {};
    for (const v of values) countByValue[v] = (countByValue[v] || 0) + 1;

    // スートごとのカード
    const cardsBySuit = { s: [], h: [], d: [], c: [] };
    cards.forEach((c) => cardsBySuit[c.suit].push(c.value));

    // フラッシュ判定
    let flushSuit = null;
    for (const s of ['s', 'h', 'd', 'c']) {
      if (cardsBySuit[s].length >= 5) flushSuit = s;
    }

    // ストレートフラッシュ
    if (flushSuit) {
      const sfHigh = straightHigh(new Set(cardsBySuit[flushSuit]));
      if (sfHigh) {
        return result(CATEGORY.STRAIGHT_FLUSH, [sfHigh]);
      }
    }

    // 枚数でグループ化
    const groups = Object.entries(countByValue)
      .map(([v, n]) => ({ v: parseInt(v, 10), n }))
      .sort((a, b) => (b.n - a.n) || (b.v - a.v));

    const quad = groups.find((g) => g.n === 4);
    const trips = groups.filter((g) => g.n === 3).sort((a, b) => b.v - a.v);
    const pairs = groups.filter((g) => g.n === 2).sort((a, b) => b.v - a.v);

    // フォーカード
    if (quad) {
      const kicker = Math.max(...values.filter((v) => v !== quad.v));
      return result(CATEGORY.QUADS, [quad.v, kicker]);
    }

    // フルハウス
    if (trips.length >= 1 && (trips.length >= 2 || pairs.length >= 1)) {
      const three = trips[0].v;
      const pairVal = trips.length >= 2 ? trips[1].v : pairs[0].v;
      return result(CATEGORY.FULL_HOUSE, [three, pairVal]);
    }

    // フラッシュ
    if (flushSuit) {
      const top5 = cardsBySuit[flushSuit].sort((a, b) => b - a).slice(0, 5);
      return result(CATEGORY.FLUSH, top5);
    }

    // ストレート
    const sHigh = straightHigh(new Set(values));
    if (sHigh) {
      return result(CATEGORY.STRAIGHT, [sHigh]);
    }

    // スリーカード
    if (trips.length >= 1) {
      const three = trips[0].v;
      const kickers = values.filter((v) => v !== three).sort((a, b) => b - a).slice(0, 2);
      return result(CATEGORY.TRIPS, [three, ...kickers]);
    }

    // ツーペア
    if (pairs.length >= 2) {
      const [p1, p2] = [pairs[0].v, pairs[1].v];
      const kicker = Math.max(...values.filter((v) => v !== p1 && v !== p2));
      return result(CATEGORY.TWO_PAIR, [p1, p2, kicker]);
    }

    // ワンペア
    if (pairs.length === 1) {
      const p = pairs[0].v;
      const kickers = values.filter((v) => v !== p).sort((a, b) => b - a).slice(0, 3);
      return result(CATEGORY.PAIR, [p, ...kickers]);
    }

    // ハイカード
    const top5 = [...values].sort((a, b) => b - a).slice(0, 5);
    return result(CATEGORY.HIGH_CARD, top5);
  }

  function result(category, tiebreakers) {
    return {
      category,
      name: CATEGORY_NAME_JA[category],
      score: encode(category, tiebreakers),
      tiebreakers,
    };
  }

  Object.assign(window.Poker, { evaluate, CATEGORY, CATEGORY_NAME_JA });
})();
