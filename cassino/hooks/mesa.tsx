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

// ---------- Caça-níquel ----------

const SYMBOLS = ['cereja', 'limão', 'sino', 'estrela', 'sete', 'diamante']
const WEIGHTS = [30, 25, 18, 12, 8, 4]
const TRIPLE = [5, 15, 25, 50, 100, 250]
const PITCH = 10
const STOPS = [28, 40, 52]
const S_FRAMES = 52
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

// ---------- Video poker (Jacks or Better) ----------

const HANDS = ['Royal flush', 'Str. flush', 'Quadra', 'Full house', 'Flush', 'Sequência', 'Trinca',
               'Dois pares', 'Par de J+']
const HAND_PAYS = [250, 50, 25, 9, 6, 4, 3, 2, 1]

function shuffled() {
  const deck: Card[] = []
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) deck.push([r, s])
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randrange(i + 1)
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

/** The best hand among HANDS as its index, or -1 for nothing. */
function rankHand(hand: Card[]) {
  const counts = new Map<number, number>()
  for (const [r] of hand) counts.set(r, (counts.get(r) ?? 0) + 1)
  const groups = [...counts.values()].sort((a, b) => b - a)
  const ranks = [...counts.keys()].sort((a, b) => a - b)
  const flush = hand.every(([, s]) => s === hand[0][1])
  const straight = ranks.length === 5 && (ranks[4] - ranks[0] === 4 || ranks.join() === '1,10,11,12,13')
  if (straight && flush) return ranks[0] === 1 && ranks[1] === 10 ? 0 : 1
  if (groups[0] === 4) return 2
  if (groups[0] === 3 && groups[1] === 2) return 3
  if (flush) return 4
  if (straight) return 5
  if (groups[0] === 3) return 6
  if (groups[0] === 2 && groups[1] === 2) return 7
  if ([...counts].some(([r, n]) => n === 2 && (r === 1 || r >= 11))) return 8
  return -1
}

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
  sl = { spinning: false, frame: S_FRAMES, strips: [[4], [4], [4]], stake: 0 }
  pk = { phase: 'bet' as 'bet' | 'draw' | 'done', hand: [] as Card[], held: [] as boolean[],
         deck: [] as Card[], stake: 0, rank: -1 }
  due: Record<string, number> = {}

  constructor(public onSave: (save: Save) => void, saved?: Partial<Save>) {
    if (saved && typeof saved.coins === 'number') {
      this.coins = saved.coins
      this.bet = typeof saved.bet === 'number' && saved.bet >= MIN_BET ? saved.bet : 50
      this.allIn = saved.allIn === true
      this.tab = saved.tab ?? 'roleta'
      this.r.history = (saved.history ?? []).slice(0, 12)
      this.msg = `Bem-vindo de volta! Saldo ${money(this.coins)}.`
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
    return this.r.spinning || this.sl.spinning || this.bj.phase === 'dealer'
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
    if (won) this.say(`${head} Ganhou +${money(won)}`, 'win')
    else this.say(`${head} Perdeu ${money(r.stake)}`, 'lose')
    this.save()
  }

  // ----- blackjack -----

  deal() {
    const bj = this.bj
    if (bj.phase === 'play' || bj.phase === 'dealer') return
    const stake = this.takeBet()
    if (!stake) return
    Object.assign(bj, { phase: 'play', player: [drawCard(), drawCard()],
                        dealer: [drawCard(), drawCard()], hide: true, stake })
    if (natural(bj.player) || natural(bj.dealer)) this.settle()
    else this.say(`Sua mão: ${total(bj.player)}. Pedir ou parar?`)
  }

  hit() {
    const bj = this.bj
    if (bj.phase !== 'play') return
    bj.player.push(drawCard())
    const s = total(bj.player)
    if (s > 21) this.settle()
    else if (s === 21) this.stand()
    else this.say(`Sua mão: ${s}.`)
  }

  stand() {
    const bj = this.bj
    if (bj.phase !== 'play') return
    Object.assign(bj, { phase: 'dealer', hide: false })
    this.say('A banca revela a carta...')
  }

  double() {
    const bj = this.bj
    if (bj.phase !== 'play' || bj.player.length !== 2) return
    if (this.coins < bj.stake) {
      this.say('Fichas insuficientes para dobrar.', 'lose')
      return
    }
    this.coins -= bj.stake
    bj.stake *= 2
    bj.player.push(drawCard())
    if (total(bj.player) > 21) this.settle()
    else this.stand()
  }

  stepDealer() {
    const bj = this.bj
    if (total(bj.dealer) < 17) {
      bj.dealer.push(drawCard())
      this.say(`Banca compra: ${total(bj.dealer)}`)
    } else {
      this.settle()
    }
  }

  settle() {
    const bj = this.bj
    const me = total(bj.player)
    const house = total(bj.dealer)
    const st = bj.stake
    Object.assign(bj, { phase: 'done', hide: false })
    const pay = (mult: number, msg: string, tone: 'win' | 'lose' | null) => {
      this.coins += st * mult
      this.say(msg, tone)
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
    // the later reels have longer strips, so they stop one after another
    const strips = sl.strips.map((old, i) => [
      old[old.length - 1],
      ...Array.from({ length: 16 + i * 6 }, () => randrange(SYMBOLS.length)),
      weighted(),
    ])
    Object.assign(sl, { spinning: true, frame: 0, strips, stake })
    this.say(`${this.allIn ? 'ALL IN! ' : ''}Girando... ${money(stake)}`)
  }

  stepSlots() {
    const sl = this.sl
    sl.frame += 1
    if (sl.frame < S_FRAMES) return
    sl.spinning = false
    const faces = sl.strips.map(s => s[s.length - 1])
    const mult = payout(faces)
    const won = sl.stake * mult
    this.coins += won
    if (mult >= 50) this.say(`JACKPOT! ${mult}x +${money(won)}`, 'win')
    else if (mult > 1) this.say(`Trinca de ${SYMBOLS[faces[0]]}! +${money(won)}`, 'win')
    else if (mult === 1) this.say('Duas cerejas: aposta de volta.', null)
    else this.say(`Nada dessa vez. Perdeu ${money(sl.stake)}`, 'lose')
    this.save()
  }

  // ----- poker -----

  dealPoker() {
    const pk = this.pk
    if (pk.phase === 'draw') return
    const stake = this.takeBet()
    if (!stake) return
    const deck = shuffled()
    const hand = deck.splice(0, 5)
    Object.assign(pk, { phase: 'draw', hand, held: hand.map(() => false), deck, stake, rank: rankHand(hand) })
    this.say(pk.rank >= 0 ? `Você tem ${HANDS[pk.rank]}. Escolha as que ficam.`
                          : 'Escolha as cartas que ficam e troque.')
  }

  hold(i: number) {
    const pk = this.pk
    if (pk.phase === 'draw') pk.held[i] = !pk.held[i]
  }

  /** Swaps the cards not held, once, and pays the hand by the table. */
  swap() {
    const pk = this.pk
    if (pk.phase !== 'draw') return
    pk.hand = pk.hand.map((card, i) => (pk.held[i] ? card : pk.deck.pop()!))
    pk.rank = rankHand(pk.hand)
    pk.phase = 'done'
    const won = pk.rank >= 0 ? pk.stake * HAND_PAYS[pk.rank] : 0
    this.coins += won
    if (pk.rank < 0) this.say(`Nada dessa vez. Perdeu ${money(pk.stake)}`, 'lose')
    else if (won === pk.stake) this.say(`${HANDS[pk.rank]}: aposta de volta.`, null)
    else this.say(`${pk.rank === 0 ? 'ROYAL FLUSH' : HANDS[pk.rank]}! +${money(won)}`, 'win')
    this.save()
  }

  // ----- relógio -----

  tick(now: number) {
    let changed = false
    const clocks: [string, boolean, number, () => void][] = [
      ['r', this.r.spinning, R_DT, () => this.stepRoulette()],
      ['s', this.sl.spinning, S_DT, () => this.stepSlots()],
      ['d', this.bj.phase === 'dealer', DEALER_DT, () => this.stepDealer()],
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
    while (this.bj.phase === 'dealer') this.stepDealer()
    if (this.pk.phase === 'draw') this.swap()
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

function wheelArt(r: Casino['r'], size = 22) {
  const p = new Pixels(size, size)
  const t = Math.min(1, r.frame / R_FRAMES)
  const e = 1 - (1 - t) ** 3
  const wheel = r.wfrom + (r.wto - r.wfrom) * e
  const ball = r.ballto + (1 - e) * TAU * 3
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
      if (d > R - 0.9) col = dy < 0 ? 0xe2b93b : 0x9c7418
      else if (d > R - 2.8) col = 0x5a3a1e
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

function reelsArt(sl: Casino['sl'], won: boolean) {
  const W = 28
  const H = 16
  const p = new Pixels(W, H)
  p.rect(0, 0, W, H, 0xc9a227)
  sl.strips.forEach((strip, i) => {
    const x0 = 1 + i * 9
    p.rect(x0, 1, 8, 14, 0xf8f1e3)
    const t = sl.spinning ? Math.min(1, sl.frame / STOPS[i]) : 1
    const pos = Math.round((strip.length - 1) * PITCH * (1 - (1 - t) ** 3))
    // window row wy shows strip row pos + wy - 3; symbol k sits at k*PITCH+1
    for (let k = -2; k < 3; k++) {
      const base = Math.floor(pos / PITCH) + k
      const sym = strip[mod(base, strip.length)]
      const top = base * PITCH + 1 - pos + 4
      p.sprite(x0, top, SPRITES[sym], SPRITE_COLORS, 1, 14)
    }
  })
  const mark = won ? 0x40c057 : 0xe03131
  for (const y of [8, 9]) {
    p.set(0, y, mark)
    p.set(W - 1, y, mark)
  }
  return p
}

const FELT = 0x0f5132
const FELT_TEXT = 0xd8f5e3

function cardArt(scr: Screen, x: number, y: number, card: Card | null) {
  if (card === null) {
    for (let j = 0; j < 3; j++) scr.text(x, y + j, '▒'.repeat(5), 0x748ffc, 0x1c3d8f)
    return
  }
  const [rank, suit] = card
  const ink = suit === 1 || suit === 2 ? 0xc92a2a : 0x111111
  for (let j = 0; j < 3; j++) scr.text(x, y + j, ' '.repeat(5), ink, 0xf8f9fa)
  const label = RANKS[rank]
  scr.text(x, y, label, ink)
  scr.put(x + 2, y + 1, SUITS[suit], ink)
  scr.text(x + 5 - label.length, y + 2, label, ink)
}

function tableArt(scr: Screen, bj: Casino['bj'], x0: number, y0: number, width: number) {
  for (let j = 0; j < 9; j++) scr.text(x0, y0 + j, ' '.repeat(width), null, FELT)
  const dealer = bj.dealer
  const shown = bj.hide ? dealer.slice(0, 1) : dealer
  const dealerTotal = dealer.length ? (bj.hide ? `${total(shown)} + ?` : String(total(dealer))) : ''
  scr.text(x0 + 1, y0, `BANCA ${dealerTotal}`, FELT_TEXT)
  scr.text(x0 + 1, y0 + 8, `VOCÊ ${bj.player.length ? total(bj.player) : ''}`, FELT_TEXT)
  if (!dealer.length) scr.text(x0 + 1, y0 + 3, 'Aposte e distribua', FELT_TEXT)

  const seat = (hand: (Card | null)[], y: number) => {
    const step = hand.length > 1 ? Math.min(6, Math.floor((width - 7) / (hand.length - 1))) : 6
    hand.forEach((card, i) => cardArt(scr, x0 + 1 + i * step, y, card))
  }
  seat(bj.hide ? [dealer[0], null] : dealer, y0 + 1)
  seat(bj.player, y0 + 5)
  if (bj.stake) {
    const chip = `● ${money(bj.stake)}`
    scr.text(x0 + width - 1 - chip.length, y0 + 4, chip, 0xffd43b)
  }
}

function pokerArt(scr: Screen, game: Casino, x0: number, y0: number, width: number) {
  const pk = game.pk
  for (let j = 0; j < 10; j++) scr.text(x0, y0 + j, ' '.repeat(width), null, FELT)
  // the pay table in two columns, the hand on the table lit in gold
  HANDS.forEach((name, i) => {
    const left = i < 4
    const line = name.padEnd(left ? 11 : 10) + String(HAND_PAYS[i]).padStart(left ? 4 : 3)
    scr.text(x0 + (left ? 1 : 18), y0 + (left ? i : i - 4), line, i === pk.rank ? GOLD : FELT_TEXT)
  })
  const cx = x0 + Math.floor((width - 29) / 2)
  for (let i = 0; i < 5; i++) {
    const x = cx + i * 6
    cardArt(scr, x, y0 + 6, pk.hand[i] ?? null)
    if (pk.phase !== 'draw') continue
    if (pk.held[i]) scr.text(x, y0 + 9, ' FICA', 0x111111, GOLD)
    // the card and the row under it both hold it
    for (let j = 6; j < 10; j++) scr.hits.push([x, x + 5, y0 + j, () => game.hold(i)])
  }
}

const GOLD = 0xffd43b
const DIM = 0x868e96
const TAB_BG = 0x343a40
const TAB_ON = 0xffd43b
const BTN_BG = 0x495057

function layout(game: Casino, w: number, h: number) {
  const scr = new Screen(w, h)
  let y = 0
  scr.center(y, '♠ ♥  C A S S I N O  ♦ ♣', GOLD)
  y += 1
  scr.center(y, `● ${money(game.coins)} fichas`, GOLD)
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
    const art = wheelArt(r)
    art.blit(scr, Math.floor((w - art.w) / 2), y)
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
    tableArt(scr, bj, Math.floor((w - width) / 2), y, width)
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
    y += 11
    if (pk.phase === 'draw') scr.row(y, [['Trocar', () => game.swap(), 0x111111, GOLD]])
    else scr.row(y, [[pk.phase === 'bet' ? 'Distribuir' : 'Nova mão', () => game.dealPoker(), 0x111111, GOLD]])
    y += 2
    scr.center(y, pk.phase === 'draw' ? 'clique nas cartas que ficam' : 'video poker · par de J ou mais', DIM)
    y += 2
  } else {
    const sl = game.sl
    const won = !sl.spinning && sl.stake > 0 && payout(sl.strips.map(s => s[s.length - 1])) > 1
    const art = reelsArt(sl, won)
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

  const tone = game.tone === 'win' ? 0x51cf66 : game.tone === 'lose' ? 0xff6b6b : 0xdee2e6
  for (const line of wrap(game.msg, Math.max(10, Math.min(w - 2, 32))).slice(0, 2)) {
    scr.center(y, line, tone)
    y += 1
  }
  y += 1

  const items: Item[] = []
  if (game.coins < MIN_BET && !game.busy()) items.push([`+${money(START)} fichas`, () => game.refill(), 0x111111, GOLD])
  items.push(['Sair', () => 'quit', 0xffffff, 0x862e2e])
  scr.row(Math.max(y, h - 1), items)
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
