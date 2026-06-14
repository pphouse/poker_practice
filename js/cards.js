// cards.js — カードとデッキの定義
// Texas Hold'em 用の 52 枚デッキ。

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['s', 'h', 'd', 'c']; // spade, heart, diamond, club
const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SUIT_COLORS = { s: 'black', c: 'black', h: 'red', d: 'red' };

// ランク文字 -> 数値 (2=2 ... A=14)
const RANK_VALUE = RANKS.reduce((acc, r, i) => {
  acc[r] = i + 2;
  return acc;
}, {});

class Card {
  constructor(rank, suit) {
    this.rank = rank;       // '2'..'A'
    this.suit = suit;       // 's','h','d','c'
    this.value = RANK_VALUE[rank];
  }
  get code() {
    return this.rank + this.suit; // 例: 'As'
  }
  toString() {
    return this.rank + SUIT_SYMBOLS[this.suit];
  }
}

class Deck {
  constructor() {
    this.reset();
  }
  reset() {
    this.cards = [];
    for (const s of SUITS) {
      for (const r of RANKS) {
        this.cards.push(new Card(r, s));
      }
    }
  }
  // Fisher–Yates シャッフル
  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
    return this;
  }
  deal(n = 1) {
    return this.cards.splice(0, n);
  }
}

// グローバル公開（モジュール無しのシンプル構成）
window.Poker = window.Poker || {};
Object.assign(window.Poker, { Card, Deck, RANKS, SUITS, SUIT_SYMBOLS, SUIT_COLORS, RANK_VALUE });
