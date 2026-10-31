import type { ClientModule, ClientSurface } from 'claude-code'

// The casino drawn inside Claude Code's own pane: app/cassino.py's game, its
// art and its layout, with clicks from onPointer and frames from every().

const TAU = 2 * Math.PI
const MIN_BET = 10
const START = 1000
const ROWS = 28
const TICK = 15

type Tab = 'roleta' | 'blackjack' | 'slots' | 'poker'
type Pick = 'red' | 'black' | 'green'
type Card = [number, number]
export type Save = { coins: number; bet: number; allIn: boolean; tab: Tab; history: number[] }

const mod = (a: number, n: number) => ((a % n) + n) % n
const randrange = (n: number) => Math.floor(Math.random() * n)

function money(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** The bet steps up to max: 10, 25, 50, 100, 250, 500, 1.000, 2.500... */
function ladder(max: number) {
  const out: number[] = []
  for (let p = MIN_BET; ; p *= 10) {
    for (const m of [1, 2.5, 5]) {
      if (m * p > max) return out
      out.push(m * p)
    }
  }
}

// ---------- Roleta (europeia, um zero) ----------

const WHEEL = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
]
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36])
const POCKET = TAU / WHEEL.length
const NAME: Record<Pick, string> = { red: 'VERMELHO', black: 'PRETO', green: 'VERDE' }
const PAYS: Record<Pick, number> = { red: 2, black: 2, green: 36 }
const R_FRAMES = 60
const R_DT = 50

const colorOf = (n: number): Pick => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black')

// ---------- Blackjack ----------

const SUITS = '♠♥♦♣'
const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const DEALER_DT = 550

const drawCard = (): Card => [1 + randrange(13), randrange(4)]

function total(hand: Card[]) {
  let s = hand.reduce((a, [r]) => a + (r === 1 ? 11 : Math.min(10, r)), 0)
  let aces = hand.filter(([r]) => r === 1).length
  while (s > 21 && aces) {
    s -= 10
    aces -= 1
  }
  return s
}

const natural = (hand: Card[]) => hand.length === 2 && total(hand) === 21

// a card turning over plays one look per frame: 'b' its back, 'f' its face, 's' its face
// in a flash, 'o' the face it had before, each with the columns it takes, and 'e' its edge
type Flip = { f: number; seq: string[]; old?: Card }
const UP = ['b3', 'e', 'f3', 's5']
const DOWN = ['o3', 'e', 'b3']
const FLIP_DT = 45
const FLIP_GAP = 3

// ---------- Caça-níquel ----------

const SYMBOLS = ['cereja', 'limão', 'sino', 'estrela', 'sete', 'diamante']
const WEIGHTS = [30, 25, 18, 12, 8, 4]
const TRIPLE = [5, 15, 25, 50, 100, 250]
const PITCH = 10
const STOPS = [28, 40, 52]
const TENSION = 30
const S_DT = 45

function weighted() {
  let n = Math.random() * WEIGHTS.reduce((a, b) => a + b, 0)
  for (let i = 0; i < WEIGHTS.length; i++) {
    n -= WEIGHTS[i]
    if (n < 0) return i
  }
  return WEIGHTS.length - 1
}

function payout([a, b, c]: number[]) {
  if (a === b && b === c) return TRIPLE[a]
  if ([a, b, c].filter(f => f === 0).length === 2) return 1
  return 0
}

// ---------- Poker (fique com 2 das 5 e veja a mesa) ----------

const HANDS = ['Royal flush', 'Str. flush', 'Quadra', 'Full house', 'Flush', 'Sequência', 'Trinca',
               'Dois pares', 'Par de J+']
const HAND_PAYS = [250, 50, 10, 3, 3, 3, 2, 2, 1]
const RIVER = 10

function shuffled() {
  const deck: Card[] = []
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) deck.push([r, s])
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randrange(i + 1)
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

/** The highest card of a straight among these ranks, the ace counting high and low, or 0. */
function straightTop(ranks: Set<number>) {
  for (let top = 14; top >= 5; top--) {
    let run = 0
    while (run < 5 && ranks.has(top - run === 14 ? 1 : top - run)) run += 1
    if (run === 5) return top
  }
  return 0
}

/** The best five-card hand among these cards (your two and the table's five) as its index in HANDS, or -1. */
function rankHand(cards: Card[]) {
  const counts = new Map<number, number>()
  const suits = new Map<number, Set<number>>()
  for (const [r, s] of cards) {
    counts.set(r, (counts.get(r) ?? 0) + 1)
    suits.set(s, (suits.get(s) ?? new Set()).add(r))
  }
  const flush = [...suits.values()].find(rs => rs.size >= 5)
  const top = flush ? straightTop(flush) : 0
  if (top) return top === 14 ? 0 : 1
  const groups = [...counts.values()].sort((a, b) => b - a)
  if (groups[0] >= 4) return 2
  if (groups[0] >= 3 && groups[1] >= 2) return 3
  if (flush) return 4
  if (straightTop(new Set(counts.keys()))) return 5
  if (groups[0] >= 3) return 6
  if (groups[1] >= 2) return 7
  if ([...counts].some(([r, n]) => n >= 2 && (r === 1 || r >= 11))) return 8
  return -1
}

// ---------- Efeitos ----------

const FX_DT = 50
const PARTY = 28
const BIG = 9
const CHEER = [0xffd43b, 0x51cf66, 0xffffff, 0xff922b]
const CHIPS = '●✦◆$'
const CHIP_COLORS = [0xffd43b, 0xfcc419, 0xff922b, 0xfff3bf]

class Casino {
  coins = START
  bet = 50
  allIn = false
  tab: Tab = 'roleta'
  msg = 'Bem-vindo! Escolha uma aposta.'
  tone: 'win' | 'lose' | null = null
  r = { spinning: false, frame: R_FRAMES, wfrom: 0, wto: 0, ballto: 0, result: 0,
        pick: 'red' as Pick, stake: 0, history: [] as number[] }
  bj = { phase: 'bet' as 'bet' | 'play' | 'dealer' | 'done', dealer: [] as Card[],
         player: [] as Card[], hide: false, stake: 0 }
  sl = { spinning: false, frame: STOPS[2], strips: [[4], [4], [4]], stake: 0, stops: STOPS, tension: false }
  pk = { phase: 'bet' as 'bet' | 'pick' | 'board' | 'done', hand: [] as Card[], kept: [] as number[],
         board: [] as Card[], deck: [] as Card[], stake: 0, rank: -1 }
  flips: Record<string, Flip> = {}
  then: (() => void) | null = null
  party = 0
  rain: { x: number; y: number; v: number; ch: string; c: number }[] = []
  shown = START
  due: Record<string, number> = {}

  constructor(public onSave: (save: Save) => void, saved?: Partial<Save>) {
    if (saved && typeof saved.coins === 'number') {
      this.coins = saved.coins
      this.bet = typeof saved.bet === 'number' && saved.bet >= MIN_BET ? saved.bet : 50
      this.allIn = saved.allIn === true
      this.tab = saved.tab ?? 'roleta'
      this.r.history = (saved.history ?? []).slice(0, 12)
      this.msg = `Bem-vindo de volta! Saldo ${money(this.coins)}.`
      this.shown = this.coins
    }
  }

  // ----- saldo -----

  save() {
    this.onSave({ coins: this.coins, bet: this.bet, allIn: this.allIn, tab: this.tab,
                  history: this.r.history })
  }

  say(msg: string, tone: 'win' | 'lose' | null = null) {
    this.msg = msg
    this.tone = tone
  }

  /** What the next round puts down: the whole balance all in, and never more than it. */
  stake() {
    return this.allIn ? this.coins : Math.min(this.bet, this.coins)
  }

  /** Takes the stake from the balance and returns it, or 0 with no chips left. */
  takeBet() {
    const stake = this.stake()
    if (stake <= 0) {
      this.say('Sem fichas: peça mais à casa.', 'lose')
      return 0
    }
    this.coins -= stake
    return stake
  }

  shiftBet(d: number) {
    const now = this.stake()
    const steps = ladder(this.coins)
    const next = d > 0 ? steps.find(v => v > now) ?? this.coins : steps.reverse().find(v => v < now) ?? now
    this.allIn = false
    this.bet = Math.max(next, MIN_BET)
  }

  toggleAllIn() {
    this.allIn = !this.allIn
  }

  refill() {
    this.coins += START
    this.say(`+${money(START)} fichas da casa.`)
    this.save()
  }

  busy() {
    return this.r.spinning || this.sl.spinning || this.bj.phase === 'dealer' || this.pk.phase === 'board'
      || this.flipping()
  }

  // ----- efeitos -----

  /** Turns the cards at these slots over one after another, each delay(i) frames after the
   *  first, then runs done; with old, each first turns its old face down. While they turn,
   *  the cards take no clicks. */
  turn(slots: string[], done: () => void = () => {}, old?: Card[], delay = (i: number) => i * FLIP_GAP) {
    if (!slots.length) return done()
    slots.forEach((s, i) => {
      const seq = [...(old ? DOWN : []), ...Array<string>(delay(i) + (old ? 2 : 0)).fill('b5'), ...UP]
      this.flips[s] = { f: 0, seq, old: old?.[i] }
    })
    this.then = done
  }

  flipping() {
    return Object.keys(this.flips).length > 0
  }

  stepFlips() {
    for (const [s, flip] of Object.entries(this.flips)) if (++flip.f >= flip.seq.length) delete this.flips[s]
    if (!this.flipping() && this.then) {
      const done = this.then
      this.then = null
      done()
    }
  }

  /** Lights a win up: blinking for any win, chips raining down for a big one. */
  cheer(mult: number) {
    this.party = PARTY
    if (mult < BIG) return
    for (let i = 0; i < 30; i++) {
      this.rain.push({ x: Math.random(), y: -Math.random() * 10, v: 0.8 + Math.random() * 0.8,
                       ch: CHIPS[randrange(CHIPS.length)], c: CHIP_COLORS[randrange(CHIP_COLORS.length)] })
    }
  }

  effects() {
    return this.party > 0 || this.rain.length > 0 || this.shown !== this.coins
  }

  stepFx() {
    if (this.party > 0) this.party -= 1
    for (const p of this.rain) p.y += p.v
    this.rain = this.rain.filter(p => p.y < ROWS)
    // the balance rolls up to a win, and drops to a bet at once
    const gap = this.coins - this.shown
    this.shown = gap <= 1 ? this.coins : this.shown + Math.ceil(gap * 0.3)
  }

  /** The balance on show: rolling up after a win, never above what there is. */
  balance() {
    return Math.min(this.shown, this.coins)
  }

  // ----- roleta -----

  spin(pick: Pick) {
    const r = this.r
    if (r.spinning) return
    const stake = this.takeBet()
    if (!stake) return
    const result = randrange(WHEEL.length)
    const wfrom = mod(r.wto, TAU)
    const wto = wfrom + TAU * (1.5 + Math.random())
    Object.assign(r, { spinning: true, frame: 0, wfrom, wto, ballto: wto + result * POCKET,
                       result, pick, stake })
    this.say(`${this.allIn ? 'ALL IN! ' : ''}Girando... ${money(stake)} no ${NAME[pick]}`)
  }

  stepRoulette() {
    const r = this.r
    r.frame += 1
    if (r.frame < R_FRAMES) return
    r.spinning = false
    const n = WHEEL[r.result]
    const c = colorOf(n)
    const won = r.pick === c ? r.stake * PAYS[c] : 0
    this.coins += won
    r.history = [n, ...r.history.slice(0, 11)]
    const head = `Deu ${n} ${NAME[c]}!`
    if (won) {
      this.say(`${head} Ganhou +${money(won)}`, 'win')
      this.cheer(PAYS[c])
    } else {
      this.say(`${head} Perdeu ${money(r.stake)}`, 'lose')
    }
    this.save()
  }

  // ----- blackjack -----

  deal() {
    const bj = this.bj
    if (bj.phase === 'play' || bj.phase === 'dealer' || this.flipping()) return
    const stake = this.takeBet()
    if (!stake) return
    Object.assign(bj, { phase: 'play', player: [drawCard(), drawCard()],
                        dealer: [drawCard(), drawCard()], hide: true, stake })
    this.say('Distribuindo...')
    this.turn(['p0', 'd0', 'p1'], () => {
      if (natural(bj.player) || natural(bj.dealer)) this.settle()
      else this.say(`Sua mão: ${total(bj.player)}. Pedir ou parar?`)
    })
  }

  hit() {
    const bj = this.bj
    if (bj.phase !== 'play' || this.flipping()) return
    bj.player.push(drawCard())
    this.turn([`p${bj.player.length - 1}`], () => {
      const s = total(bj.player)
      if (s > 21) this.settle()
      else if (s === 21) this.stand()
      else this.say(`Sua mão: ${s}.`)
    })
  }

  stand() {
    const bj = this.bj
    if (bj.phase !== 'play' || this.flipping()) return
    Object.assign(bj, { phase: 'dealer', hide: false })
    this.say('A banca revela a carta...')
    this.turn(['d1'])
  }

  double() {
    const bj = this.bj
    if (bj.phase !== 'play' || bj.player.length !== 2 || this.flipping()) return
    if (this.coins < bj.stake) {
      this.say('Fichas insuficientes para dobrar.', 'lose')
      return
    }
    this.coins -= bj.stake
    bj.stake *= 2
    bj.player.push(drawCard())
    this.turn(['p2'], () => (total(bj.player) > 21 ? this.settle() : this.stand()))
  }

  stepDealer() {
    const bj = this.bj
    if (total(bj.dealer) < 17) {
      bj.dealer.push(drawCard())
      this.turn([`d${bj.dealer.length - 1}`], () => this.say(`Banca compra: ${total(bj.dealer)}`))
    } else {
      this.settle()
    }
  }

  settle() {
    const bj = this.bj
    const me = total(bj.player)
    const house = total(bj.dealer)
    const st = bj.stake
    if (bj.hide) this.turn(['d1'])
    Object.assign(bj, { phase: 'done', hide: false })
    const pay = (mult: number, msg: string, tone: 'win' | 'lose' | null) => {
      this.coins += st * mult
      this.say(msg, tone)
      if (tone === 'win') this.cheer(mult)
      this.save()
    }
    if (me > 21) pay(0, `Estourou com ${me}! Perdeu ${money(st)}`, 'lose')
    else if (natural(bj.player) && !natural(bj.dealer)) pay(2.5, `BLACKJACK! +${money(st * 2.5)}`, 'win')
    else if (natural(bj.dealer) && !natural(bj.player)) pay(0, `Blackjack da banca. Perdeu ${money(st)}`, 'lose')
    else if (house > 21) pay(2, `Banca estourou (${house})! +${money(st * 2)}`, 'win')
    else if (me > house) pay(2, `${me} x ${house}: ganhou +${money(st * 2)}`, 'win')
    else if (me === house) pay(1, `Empate em ${me}. Aposta devolvida.`, null)
    else pay(0, `${house} x ${me}: a banca leva ${money(st)}`, 'lose')
  }

  // ----- caça-níquel -----

  pull() {
    const sl = this.sl
    if (sl.spinning) return
    const stake = this.takeBet()
    if (!stake) return
    // each strip starts at the symbol on show and ends at the new one;
    // the later reels have longer strips, so they stop one after another,
    // and when the first two match the last one keeps everyone waiting
    const ends = [weighted(), weighted(), weighted()]
    const tension = ends[0] === ends[1]
    const strips = sl.strips.map((old, i) => [
      old[old.length - 1],
      ...Array.from({ length: 16 + i * 6 + (tension && i === 2 ? 18 : 0) }, () => randrange(SYMBOLS.length)),
      ends[i],
    ])
    const stops = [STOPS[0], STOPS[1], STOPS[2] + (tension ? TENSION : 0)]
    Object.assign(sl, { spinning: true, frame: 0, strips, stake, stops, tension })
    this.say(`${this.allIn ? 'ALL IN! ' : ''}Girando... ${money(stake)}`)
  }

  stepSlots() {
    const sl = this.sl
    sl.frame += 1
    if (sl.tension && sl.frame === sl.stops[1]) this.say('Dois iguais... segura!')
    if (sl.frame < sl.stops[2]) return
    sl.spinning = false
    const faces = sl.strips.map(s => s[s.length - 1])
    const mult = payout(faces)
    const won = sl.stake * mult
    this.coins += won
    if (mult >= 50) this.say(`JACKPOT! ${mult}x +${money(won)}`, 'win')
    else if (mult > 1) this.say(`Trinca de ${SYMBOLS[faces[0]]}! +${money(won)}`, 'win')
    else if (mult === 1) this.say('Duas cerejas: aposta de volta.', null)
    else this.say(`Nada dessa vez. Perdeu ${money(sl.stake)}`, 'lose')
    if (mult > 1) this.cheer(mult)
    this.save()
  }

  // ----- poker -----

  dealPoker() {
    const pk = this.pk
    if (pk.phase === 'pick' || pk.phase === 'board' || this.flipping()) return
    const stake = this.takeBet()
    if (!stake) return
    // the cards on show turn down first: the last table, or the last five dealt
    const old = pk.board.length ? pk.board : pk.hand.length ? pk.hand : undefined
    const deck = shuffled()
    const hand = deck.splice(0, 5)
    Object.assign(pk, { phase: 'pick', hand, kept: [], board: [], deck, stake, rank: -1 })
    this.say('Distribuindo...')
    this.turn(hand.map((_, i) => `k${i}`), () => this.say('Escolha 2 cartas para ficar.'), old)
  }

  /** Keeps the dealt card i, or lets it go: two at most. */
  keep(i: number) {
    const pk = this.pk
    if (pk.phase !== 'pick' || this.flipping()) return
    if (pk.kept.includes(i)) pk.kept = pk.kept.filter(k => k !== i)
    else if (pk.kept.length < 2) pk.kept.push(i)
    else return this.say('Só duas! Tire uma antes.')
    this.say(['Escolha 2 cartas para ficar.', 'Escolha mais uma.', 'Pronto! Clique em Ver a mesa.'][pk.kept.length])
  }

  /** Turns the five dealt cards down and up again as the table's, then pays the best hand. */
  showBoard() {
    const pk = this.pk
    if (pk.phase !== 'pick' || pk.kept.length !== 2 || this.flipping()) return
    pk.board = pk.deck.splice(0, 5)
    pk.phase = 'board'
    this.say('Lá vem a mesa...')
    // the flop's three one after another, then the turn and the river each after a pause
    this.turn(pk.board.map((_, i) => `k${i}`), () => this.payPoker(), pk.hand,
              i => i * FLIP_GAP + (i >= 3 ? RIVER : 0) + (i >= 4 ? RIVER : 0))
  }

  mine() {
    return this.pk.kept.map(i => this.pk.hand[i])
  }

  payPoker() {
    const pk = this.pk
    pk.rank = rankHand([...this.mine(), ...pk.board])
    pk.phase = 'done'
    const won = pk.rank >= 0 ? pk.stake * HAND_PAYS[pk.rank] : 0
    this.coins += won
    if (pk.rank < 0) this.say(`Nada dessa vez. Perdeu ${money(pk.stake)}`, 'lose')
    else if (won === pk.stake) this.say(`${HANDS[pk.rank]}: aposta de volta.`, null)
    else this.say(`${pk.rank === 0 ? 'ROYAL FLUSH' : HANDS[pk.rank]}! +${money(won)}`, 'win')
    if (won > pk.stake) this.cheer(HAND_PAYS[pk.rank])
    this.save()
  }

  // ----- relógio -----

  tick(now: number) {
    let changed = false
    const clocks: [string, boolean, number, () => void][] = [
      ['r', this.r.spinning, R_DT, () => this.stepRoulette()],
      ['s', this.sl.spinning, S_DT, () => this.stepSlots()],
      ['f', this.flipping(), FLIP_DT, () => this.stepFlips()],
      // the dealer waits for each card to land before the next
      ['d', this.bj.phase === 'dealer' && !this.flipping(), DEALER_DT, () => this.stepDealer()],
      ['x', this.effects(), FX_DT, () => this.stepFx()],
    ]
    for (const [key, running, dt, step] of clocks) {
      if (!running) {
        delete this.due[key]
        continue
      }
      const due = (this.due[key] ??= now + dt)
      if (now >= due) {
        step()
        this.due[key] = Math.max(due + dt, now)
        changed = true
      }
    }
    return changed
  }

  finish() {
    while (this.r.spinning) this.stepRoulette()
    while (this.sl.spinning) this.stepSlots()
    for (;;) {
      while (this.flipping()) this.stepFlips()
      if (this.bj.phase === 'dealer') this.stepDealer()
      else if (this.pk.phase === 'pick') {
        // a hand left halfway keeps its first cards and still sees the table
        for (let i = 0; this.pk.kept.length < 2; i++) if (!this.pk.kept.includes(i)) this.pk.kept.push(i)
        this.showBoard()
      } else break
    }
  }
}

// ---------- Tela ----------

type Cell = [string, number | null, number | null]
type Action = () => void | 'quit'
type Item = [string, Action | null, number | null, number | null]
const KEEP = Symbol('keep')

class Screen {
  cells: Cell[][]
  hits: [number, number, number, Action][] = []

  constructor(public w: number, public h: number) {
    this.cells = Array.from({ length: h }, () => Array.from({ length: w }, (): Cell => [' ', null, null]))
  }

  put(x: number, y: number, ch: string, fg: number | null = null, bg: number | null | typeof KEEP = KEEP) {
    if (x >= 0 && x < this.w && y >= 0 && y < this.h) {
      this.cells[y][x] = [ch, fg, bg === KEEP ? this.cells[y][x][2] : bg]
    }
  }

  text(x: number, y: number, s: string, fg: number | null = null, bg: number | null | typeof KEEP = KEEP) {
    ;[...s].forEach((ch, i) => this.put(x + i, y, ch, fg, bg))
  }

  button(x: number, y: number, label: string, action: Action | null, fg: number | null, bg: number | null) {
    const s = ` ${label} `
    this.text(x, y, s, fg, bg)
    if (action) this.hits.push([x, x + s.length, y, action])
    return s.length
  }

  /** Centers a row of buttons: items are [label, action, fg, bg]. */
  row(y: number, items: Item[], gap = 1) {
    const width = items.reduce((a, i) => a + i[0].length + 2, 0) + gap * (items.length - 1)
    let x = Math.floor((this.w - width) / 2)
    for (const [label, action, fg, bg] of items) x += this.button(x, y, label, action, fg, bg) + gap
  }

  center(y: number, s: string, fg: number | null = null, bg: number | null | typeof KEEP = KEEP) {
    this.text(Math.floor((this.w - [...s].length) / 2), y, s, fg, bg)
  }
}

/** Square pixels, two per cell: the top one a half block's foreground. */
class Pixels {
  px: (number | null)[][]

  constructor(public w: number, public h: number) {
    this.px = Array.from({ length: h }, () => Array<number | null>(w).fill(null))
  }

  set(x: number, y: number, c: number) {
    x = Math.floor(x)
    y = Math.floor(y)
    if (x >= 0 && x < this.w && y >= 0 && y < this.h) this.px[y][x] = c
  }

  rect(x: number, y: number, w: number, h: number, c: number) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c)
  }

  sprite(x: number, y: number, rows: string[], palette: Record<string, number>, top: number, bottom: number) {
    rows.forEach((row, j) => {
      if (top <= y + j && y + j <= bottom) {
        ;[...row].forEach((ch, i) => {
          if (ch in palette) this.set(x + i, y + j, palette[ch])
        })
      }
    })
  }

  blit(scr: Screen, ox: number, oy: number) {
    for (let cy = 0; cy < Math.floor(this.h / 2); cy++) {
      for (let x = 0; x < this.w; x++) {
        const t = this.px[2 * cy][x]
        const b = this.px[2 * cy + 1][x]
        if (t === null && b === null) continue
        if (t === b) scr.put(ox + x, oy + cy, ' ', null, t)
        else if (t === null) scr.put(ox + x, oy + cy, '▄', b, null)
        else scr.put(ox + x, oy + cy, '▀', t, b)
      }
    }
  }
}

const POCKET_COLOR: Record<Pick, number> = { red: 0xd42a2a, black: 0x1c1c1c, green: 0x16a34a }

function wheelAngles(r: Casino['r']) {
  const t = Math.min(1, r.frame / R_FRAMES)
  const e = 1 - (1 - t) ** 3
  const wheel = r.wfrom + (r.wto - r.wfrom) * e
  return { t, wheel, ball: r.ballto + (1 - e) * TAU * 3 }
}

/** The number in the pocket under the ball: it rolls by while the wheel spins and stops on the result. */
function ballNumber(r: Casino['r']) {
  const { wheel, ball } = wheelAngles(r)
  return WHEEL[mod(Math.round(mod(ball - wheel, TAU) / POCKET), WHEEL.length)]
}

function wheelArt(r: Casino['r'], party: number, size = 22) {
  const p = new Pixels(size, size)
  const { t, wheel, ball } = wheelAngles(r)
  const drop = t < 0.7 ? 0 : (t - 0.7) / 0.3
  const c = size / 2
  const R = size / 2
  const hub = R * 0.36
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c
      const dy = y + 0.5 - c
      const d = Math.hypot(dx, dy)
      if (d > R) continue
      let col: number
      if (d > R - 0.9) {
        // after a win the rim's lights chase each other around the wheel
        const bulb = (Math.floor(mod(Math.atan2(dy, dx), TAU) / (TAU / 16)) + party) % 2
        col = party ? (bulb ? 0xffffff : 0xffd43b) : dy < 0 ? 0xe2b93b : 0x9c7418
      } else if (d > R - 2.8) col = 0x5a3a1e
      else if (d > hub) {
        const rel = mod(Math.atan2(dy, dx) - wheel, TAU)
        col = POCKET_COLOR[colorOf(WHEEL[mod(Math.round(rel / POCKET), WHEEL.length)])]
      } else if (d > hub - 1) col = 0xc9a227
      else {
        // the turret: four gold spokes turning with the wheel
        let spoke = Infinity
        for (let k = 0; k < 4; k++) {
          const s = wheel + (k * Math.PI) / 2
          spoke = Math.min(spoke, Math.abs(dx * Math.sin(s) - dy * Math.cos(s))
            + (dx * Math.cos(s) + dy * Math.sin(s) < 0 ? 99 : 0))
        }
        col = spoke < 0.7 || d < 1.2 ? 0xe2b93b : 0x3b2412
      }
      p.set(x, y, col)
    }
  }
  const track = R - 2
  const depth = track - (track - (R - 3.8)) * drop
  p.set(c + Math.cos(ball) * depth, c + Math.sin(ball) * depth, 0xffffff)
  return p
}

const SPRITES = [
  ['....gg..', '...g..g.', '..g...g.', '.g....g.', 'rwr..rwr', 'rrr..rrr', '.r....r.', '........'],
  ['........', '..yyyy..', '.ywyyyy.', 'yyyyyyyo', 'yyyyyyyo', '.yyyyyo.', '..yooo..', '........'],
  ['...oo...', '..oyyo..', '.oywyyo.', '.oyyyyo.', '.oyyyyo.', 'oyyyyyyo', 'oooooooo', '...oo...'],
  ['...yy...', '...yy...', 'yyywyyyy', '.yyyyyy.', '..yyyy..', '.yy..yy.', 'yy....yy', '........'],
  ['RRRRRRRR', 'RRRRRRRR', '.....RR.', '....RR..', '...RR...', '...RR...', '..RR....', '..RR....'],
  ['........', '..cccc..', '.cwccbc.', 'cccccccb', '.cccccb.', '..cccb..', '...cb...', '........'],
]
const SPRITE_COLORS: Record<string, number> = { g: 0x2f9e44, r: 0xe03131, w: 0xffffff, y: 0xffd43b,
                                                o: 0xe8890c, R: 0xd6001c, c: 0x66d9e8, b: 0x1c7ed6 }

function reelsArt(sl: Casino['sl'], won: boolean, party: number) {
  const W = 28
  const H = 16
  const p = new Pixels(W, H)
  p.rect(0, 0, W, H, 0xc9a227)
  // the frame's bulbs chase around while it spins and blink in colors after a win
  if (sl.spinning || party) {
    const phase = sl.spinning ? sl.frame : party
    const bulb = sl.spinning ? 0xfff3bf : CHEER[party % CHEER.length]
    for (let x = 0; x < W; x++) {
      if ((x + phase) % 3 === 0) p.set(x, 0, bulb)
      if ((x - phase) % 3 === 0) p.set(x, H - 1, bulb)
    }
    for (let y = 0; y < H; y++) {
      if ((y - phase) % 3 === 0) p.set(0, y, bulb)
      if ((y + phase) % 3 === 0) p.set(W - 1, y, bulb)
    }
  }
  sl.strips.forEach((strip, i) => {
    const x0 = 1 + i * 9
    p.rect(x0, 1, 8, 14, 0xf8f1e3)
    const t = sl.spinning ? Math.min(1, sl.frame / sl.stops[i]) : 1
    const pos = Math.round((strip.length - 1) * PITCH * (1 - (1 - t) ** 3))
    // window row wy shows strip row pos + wy - 3; symbol k sits at k*PITCH+1
    for (let k = -2; k < 3; k++) {
      const base = Math.floor(pos / PITCH) + k
      const sym = strip[mod(base, strip.length)]
      const top = base * PITCH + 1 - pos + 4
      p.sprite(x0, top, SPRITES[sym], SPRITE_COLORS, 1, 14)
    }
  })
  // the pay line's marks: green on a win, blinking while the last reel decides
  const waiting = sl.spinning && sl.tension && sl.frame >= sl.stops[1]
  const mark = won ? 0x40c057 : waiting && sl.frame % 4 < 2 ? 0xffd43b : 0xe03131
  for (const y of [8, 9]) {
    p.set(0, y, mark)
    p.set(W - 1, y, mark)
  }
  return p
}

const FELT = 0x0f5132
const FELT_TEXT = 0xd8f5e3

/** A card 5 columns wide, or the look it has this frame while it turns over. */
function cardArt(scr: Screen, x: number, y: number, card: Card | null, flip?: Flip) {
  let look = card === null ? 'b5' : flip ? flip.seq[flip.f] : 'f5'
  if (look[0] === 'o') {
    card = flip?.old ?? card
    look = `f${look[1]}`
  }
  if (look === 'e') {
    for (let j = 0; j < 3; j++) scr.put(x + 2, y + j, ' ', null, 0xdee2e6)
    return
  }
  const cw = Number(look[1])
  const left = x + (5 - cw) / 2
  if (look[0] === 'b' || card === null) {
    for (let j = 0; j < 3; j++) scr.text(left, y + j, '▒'.repeat(cw), 0x748ffc, 0x1c3d8f)
    return
  }
  const [rank, suit] = card
  const ink = suit === 1 || suit === 2 ? 0xc92a2a : 0x111111
  const paper = look[0] === 's' ? 0xfff3bf : 0xf8f9fa
  for (let j = 0; j < 3; j++) scr.text(left, y + j, ' '.repeat(cw), ink, paper)
  const label = RANKS[rank]
  scr.text(left, y, label, ink)
  scr.put(left + (cw - 1) / 2, y + 1, SUITS[suit], ink)
  scr.text(left + cw - label.length, y + 2, label, ink)
}

function tableArt(scr: Screen, game: Casino, x0: number, y0: number, width: number) {
  const bj = game.bj
  for (let j = 0; j < 9; j++) scr.text(x0, y0 + j, ' '.repeat(width), null, FELT)
  // a card still turning over counts once it lands
  const count = (hand: Card[], id: string) => {
    const seen = hand.filter((_, i) => !game.flips[id + i])
    return seen.length ? String(total(seen)) : ''
  }
  const dealer = bj.dealer
  const first = count(dealer.slice(0, 1), 'd')
  const dealerTotal = bj.hide ? (first ? `${first} + ?` : '') : count(dealer, 'd')
  scr.text(x0 + 1, y0, `BANCA ${dealerTotal}`, FELT_TEXT)
  scr.text(x0 + 1, y0 + 8, `VOCÊ ${count(bj.player, 'p')}`, FELT_TEXT)
  if (!dealer.length) scr.text(x0 + 1, y0 + 3, 'Aposte e distribua', FELT_TEXT)

  const seat = (hand: (Card | null)[], y: number, id: string) => {
    const step = hand.length > 1 ? Math.min(6, Math.floor((width - 7) / (hand.length - 1))) : 6
    hand.forEach((card, i) => cardArt(scr, x0 + 1 + i * step, y, card, game.flips[id + i]))
  }
  seat(bj.hide ? [dealer[0], null] : dealer, y0 + 1, 'd')
  seat(bj.player, y0 + 5, 'p')
  if (bj.stake) {
    const chip = `● ${money(bj.stake)}`
    scr.text(x0 + width - 1 - chip.length, y0 + 4, chip, glow(game, 0xffd43b))
  }
}

const SLOT = 0x146c43

/** The pay table, then the five dealt cards (the table's five once it comes) and your two under them. */
function pokerArt(scr: Screen, game: Casino, x0: number, y0: number, width: number) {
  const pk = game.pk
  const mid = (y: number, s: string) => scr.text(x0 + Math.floor((width - [...s].length) / 2), y, s, FELT_TEXT)
  for (let j = 0; j < 13; j++) scr.text(x0, y0 + j, ' '.repeat(width), null, FELT)
  // the pay table in two columns, the hand on the table lit in gold
  HANDS.forEach((name, i) => {
    const left = i < 4
    const line = name.padEnd(left ? 11 : 10) + String(HAND_PAYS[i]).padStart(left ? 4 : 3)
    scr.text(x0 + (left ? 1 : 18), y0 + (left ? i : i - 4), line, i === pk.rank ? glow(game, GOLD) : FELT_TEXT)
  })
  const picking = pk.phase === 'pick'
  mid(y0 + 5, pk.phase === 'bet' ? 'fique com 2 e veja a mesa' : picking ? 'escolha 2 cartas' : 'MESA')

  const top = picking ? pk.hand : pk.board.length ? pk.board : pk.hand
  const cx = x0 + Math.floor((width - 29) / 2)
  for (let i = 0; i < 5; i++) {
    const x = cx + i * 6
    cardArt(scr, x, y0 + 6, top[i] ?? null, game.flips[`k${i}`])
    if (!picking) continue
    if (pk.kept.includes(i)) scr.text(x, y0 + 9, ' FICA', 0x111111, GOLD)
    // the card and the row under it both keep it
    for (let j = 6; j < 10; j++) scr.hits.push([x, x + 5, y0 + j, () => game.keep(i)])
  }
  if (!picking && pk.board.length) mid(y0 + 9, 'SUAS CARTAS')

  // your two, or the empty places waiting for them; a click on one lets it go
  const bx = x0 + Math.floor((width - 11) / 2)
  for (let j = 0; j < 2; j++) {
    const x = bx + j * 6
    const k = pk.kept[j]
    if (k === undefined) {
      for (let r = 0; r < 3; r++) scr.text(x, y0 + 10 + r, ' '.repeat(5), FELT_TEXT, SLOT)
      scr.put(x + 2, y0 + 11, '?', FELT_TEXT)
      continue
    }
    cardArt(scr, x, y0 + 10, pk.hand[k])
    if (picking) for (let r = 10; r < 13; r++) scr.hits.push([x, x + 5, y0 + r, () => game.keep(k)])
  }
}

const GOLD = 0xffd43b
const DIM = 0x868e96
const TAB_BG = 0x343a40
const TAB_ON = 0xffd43b
const BTN_BG = 0x495057

/** A color that blinks through CHEER while a win is cheered, and base otherwise. */
const glow = (game: Casino, base: number) => (game.party > 0 ? CHEER[Math.floor(game.party / 2) % CHEER.length] : base)

function layout(game: Casino, w: number, h: number) {
  const scr = new Screen(w, h)
  let y = 0
  scr.center(y, '♠ ♥  C A S S I N O  ♦ ♣', glow(game, GOLD))
  y += 1
  scr.center(y, `● ${money(game.balance())} fichas`, game.shown < game.coins ? 0x51cf66 : GOLD)
  y += 2

  const tab = (id: Tab, label: string): Item => {
    const on = game.tab === id
    return [label, () => { game.tab = id; game.save() }, on ? 0x111111 : 0xdee2e6, on ? TAB_ON : TAB_BG]
  }
  // four tabs fit in 34 columns only with no gap between them
  scr.row(y, [tab('roleta', 'Roleta'), tab('blackjack', 'Blackjack'), tab('slots', 'Slots'),
              tab('poker', 'Poker')], 0)
  y += 2

  if (game.tab === 'roleta') {
    const r = game.r
    const art = wheelArt(r, game.party)
    const ax = Math.floor((w - art.w) / 2)
    art.blit(scr, ax, y)
    if (r.stake) {
      // the hub shows the pocket under the ball as it rolls by, then the one it lands in
      const n = ballNumber(r)
      scr.text(ax + 9, y + 5, ` ${String(n).padStart(2)} `, glow(game, 0xffffff), POCKET_COLOR[colorOf(n)])
    }
    y += art.h / 2
    const hist = r.history.slice(0, 7)
    if (hist.length) {
      let x = Math.floor((w - hist.reduce((a, n) => a + String(n).length + 2, 0)) / 2)
      for (const n of hist) {
        scr.text(x, y, ` ${n} `, 0xffffff, POCKET_COLOR[colorOf(n)])
        x += String(n).length + 2
      }
    }
    y += 2
    const live = !r.spinning
    const pick = (color: Pick, label: string, bg: number): Item =>
      [label, live ? () => game.spin(color) : null, live ? 0xffffff : DIM, live ? bg : TAB_BG]
    scr.row(y, [pick('red', 'Vermelho', 0xc92a2a), pick('black', 'Preto', 0x1a1a1a),
                pick('green', 'Verde', 0x2b8a3e)])
    y += 1
    scr.center(y, 'paga 2x · 2x · 36x', DIM)
    y += 2
  } else if (game.tab === 'blackjack') {
    const bj = game.bj
    const width = Math.max(24, Math.min(w - 2, 30))
    tableArt(scr, game, Math.floor((w - width) / 2), y, width)
    y += 10
    if (bj.phase === 'bet' || bj.phase === 'done') {
      scr.row(y, [[bj.phase === 'bet' ? 'Distribuir' : 'Nova mão', () => game.deal(), 0x111111, GOLD]])
    } else if (bj.phase === 'play') {
      const items: Item[] = [['Pedir', () => game.hit(), 0xffffff, BTN_BG],
                             ['Parar', () => game.stand(), 0xffffff, BTN_BG]]
      if (bj.player.length === 2) items.push(['Dobrar', () => game.double(), 0xffffff, BTN_BG])
      scr.row(y, items)
    } else {
      scr.center(y, 'vez da banca...', GOLD)
    }
    y += 2
    scr.center(y, 'blackjack paga 3:2', DIM)
    y += 2
  } else if (game.tab === 'poker') {
    const pk = game.pk
    const width = Math.max(24, Math.min(w - 2, 32))
    pokerArt(scr, game, Math.floor((w - width) / 2), y, width)
    y += 14
    if (pk.phase === 'pick') {
      const ready = pk.kept.length === 2
      scr.row(y, [['Ver a mesa', ready ? () => game.showBoard() : null, ready ? 0x111111 : DIM, ready ? GOLD : TAB_BG]])
    } else if (pk.phase !== 'board') {
      scr.row(y, [[pk.phase === 'bet' ? 'Distribuir' : 'Nova mão', () => game.dealPoker(), 0x111111, GOLD]])
    }
    y += 2
  } else {
    const sl = game.sl
    const won = !sl.spinning && sl.stake > 0 && payout(sl.strips.map(s => s[s.length - 1])) > 1
    const art = reelsArt(sl, won, game.party)
    art.blit(scr, Math.floor((w - art.w) / 2), y)
    y += art.h / 2 + 1
    const live = !sl.spinning
    scr.row(y, [['  GIRAR  ', live ? () => game.pull() : null, live ? 0x111111 : DIM, live ? GOLD : TAB_BG]])
    y += 2
    for (const line of ['cereja 5x · limão 15x · sino 25x', 'estrela 50x · sete 100x',
                        'diamante 250x · 2 cerejas 1x']) {
      scr.center(y, line, DIM)
      y += 1
    }
    y += 1
  }

  const bet = (d: number) => () => { game.shiftBet(d); game.save() }
  const allIn = () => { game.toggleAllIn(); game.save() }
  // the buttons, the gaps and the label's padding take 19 columns; a long balance drops the word
  let stake = `aposta ${money(game.stake())}`
  if (stake.length + 19 > w) stake = `● ${money(game.stake())}`
  scr.row(y, [['-', bet(-1), 0xffffff, BTN_BG], [stake, null, GOLD, null], ['+', bet(1), 0xffffff, BTN_BG],
              game.allIn ? ['ALL IN', allIn, 0xffffff, 0xa61e4d] : ['All in', allIn, 0x111111, GOLD]])
  y += 2

  const tone = game.tone === 'win' ? glow(game, 0x51cf66) : game.tone === 'lose' ? 0xff6b6b : 0xdee2e6
  for (const line of wrap(game.msg, Math.max(10, Math.min(w - 2, 32))).slice(0, 2)) {
    scr.center(y, line, tone)
    y += 1
  }
  y += 1

  const items: Item[] = []
  if (game.coins < MIN_BET && !game.busy()) items.push([`+${money(START)} fichas`, () => game.refill(), 0x111111, GOLD])
  items.push(['Sair', () => 'quit', 0xffffff, 0x862e2e])
  scr.row(Math.max(y, h - 1), items)

  // a big win's chips fall over everything; the clicks still go through to what is under them
  for (const p of game.rain) if (p.y >= 0) scr.put(Math.floor(p.x * w), Math.floor(p.y), p.ch, p.c)
  return scr
}

function wrap(text: string, width: number) {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else {
      line = `${line} ${word}`.trim()
    }
  }
  return line ? [...lines, line] : lines
}

// ---------- Painel ----------

const hex = (c: number | null) => (c === null ? undefined : `#${c.toString(16).padStart(6, '0')}`)

type State = { game: Casino; hits: Screen['hits']; clock: number; frame: number }
export type Props = { save?: Partial<Save> }

const Mesa: ClientModule<Props, State> = (props, surface: ClientSurface<State>) => {
  const { Box, Text } = surface.elements
  let state = surface.state
  if (state === undefined) {
    const game = new Casino(save => surface.post({ save }), props?.save)
    state = { game, hits: [], clock: 0, frame: 0 }
    surface.setState(state)
    const redraw = () => {
      const s = surface.state ?? state!
      surface.setState({ ...s, frame: s.frame + 1 })
    }
    surface.every(TICK, () => {
      const s = surface.state ?? state!
      s.clock += TICK
      if (s.game.tick(s.clock)) redraw()
    })
    surface.onPointer(e => {
      if (e.type !== 'down' || e.button !== 'left') return
      const s = surface.state ?? state!
      const hit = s.hits.find(([x0, x1, y]) => e.y === y && e.x >= x0 && e.x < x1)
      if (!hit) return
      if (hit[3]() === 'quit') {
        s.game.finish()
        s.game.save()
        surface.post({ quit: true })
        return
      }
      redraw()
    })
  }

  const scr = layout(state.game, surface.columns || 34, ROWS)
  state.hits = scr.hits
  return (
    <Box flexDirection="column">
      {scr.cells.map(row => {
        const runs: Cell[] = []
        for (const [ch, fg, bg] of row) {
          const last = runs[runs.length - 1]
          if (last && last[1] === fg && last[2] === bg) last[0] += ch
          else runs.push([ch, fg, bg])
        }
        return (
          <Box flexDirection="row">
            {runs.map(([s, fg, bg]) => <Text color={hex(fg)} backgroundColor={hex(bg)}>{s}</Text>)}
          </Box>
        )
      })}
    </Box>
  )
}

export default Mesa
