#!/usr/bin/env python3
"""Mini cassino pixelizado para o terminal, jogado com o mouse.

    python cassino.py          roda nesta janela
    python cassino.py --lado   abre num painel à direita quando o terminal
                               deixa (Windows Terminal, iTerm2, Terminal do
                               macOS, tmux, WezTerm, kitty, Zellij); nos
                               outros, roda nesta janela

Funciona no Windows, no macOS e no Linux, só com a biblioteca padrão.
Para sair, clique em Sair ou aperte q. CASSINO_CORES=256 força 256 cores.
"""

import json
import math
import os
import queue
import random
import re
import shlex
import shutil
import subprocess
import sys
import threading
import time

SAVE = os.path.join(os.path.expanduser('~'), '.claude', 'cassino-save.json')
rng = random.SystemRandom()
TAU = 2 * math.pi
MIN_BET = 10
START = 1000


def money(n):
    return f'{round(n):,}'.replace(',', '.')


def ladder(top):
    """The bet steps up to top: 10, 25, 50, 100, 250, 500, 1.000, 2.500..."""
    out, p = [], MIN_BET
    while True:
        for m in (1, 2.5, 5):
            if m * p > top:
                return out
            out.append(int(m * p))
        p *= 10


# ---------- Roleta (europeia, um zero) ----------

WHEEL = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
    24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
]
REDS = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}
POCKET = TAU / len(WHEEL)
NAME = {'red': 'VERMELHO', 'black': 'PRETO', 'green': 'VERDE'}
PAYS = {'red': 2, 'black': 2, 'green': 36}
R_FRAMES, R_DT = 60, 0.05


def color_of(n):
    return 'green' if n == 0 else 'red' if n in REDS else 'black'


# ---------- Blackjack ----------

SUITS = '♠♥♦♣'
RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
DEALER_DT = 0.55


def draw_card():
    return [1 + rng.randrange(13), rng.randrange(4)]


def total(hand):
    s = sum(11 if r == 1 else min(10, r) for r, _ in hand)
    aces = sum(1 for r, _ in hand if r == 1)
    while s > 21 and aces:
        s -= 10
        aces -= 1
    return s


def natural(hand):
    return len(hand) == 2 and total(hand) == 21


# a card turning over plays one look per frame: 'b' its back, 'f' its face, 's' its face
# in a flash, 'o' the face it had before, each with the columns it takes, and 'e' its edge
UP = ['b3', 'e', 'f3', 's5']
DOWN = ['o3', 'e', 'b3']
FLIP_DT = 0.045
FLIP_GAP = 3


# ---------- Caça-níquel ----------

SYMBOLS = ['cereja', 'limão', 'sino', 'estrela', 'sete', 'diamante']
WEIGHTS = [30, 25, 18, 12, 8, 4]
TRIPLE = [5, 15, 25, 50, 100, 250]
PITCH = 10
STOPS = [28, 40, 52]
TENSION = 30
S_DT = 0.045


def payout(faces):
    a, b, c = faces
    if a == b == c:
        return TRIPLE[a]
    if faces.count(0) == 2:
        return 1
    return 0


# ---------- Video poker (Jacks or Better) ----------

HANDS = ['Royal flush', 'Str. flush', 'Quadra', 'Full house', 'Flush', 'Sequência', 'Trinca',
         'Dois pares', 'Par de J+']
HAND_PAYS = [250, 50, 25, 9, 6, 4, 3, 2, 1]


def shuffled():
    deck = [[r, s] for s in range(4) for r in range(1, 14)]
    rng.shuffle(deck)
    return deck


def rank_hand(hand):
    """The best hand among HANDS as its index, or -1 for nothing."""
    counts = {}
    for r, _ in hand:
        counts[r] = counts.get(r, 0) + 1
    groups = sorted(counts.values(), reverse=True)
    ranks = sorted(counts)
    flush = len({s for _, s in hand}) == 1
    straight = len(ranks) == 5 and (ranks[4] - ranks[0] == 4 or ranks == [1, 10, 11, 12, 13])
    if straight and flush:
        return 0 if ranks[:2] == [1, 10] else 1
    if groups[0] == 4:
        return 2
    if groups[:2] == [3, 2]:
        return 3
    if flush:
        return 4
    if straight:
        return 5
    if groups[0] == 3:
        return 6
    if groups[:2] == [2, 2]:
        return 7
    if any(n == 2 and (r == 1 or r >= 11) for r, n in counts.items()):
        return 8
    return -1


# ---------- Efeitos ----------

FX_DT = 0.05
PARTY = 28
BIG = 9
CHEER = [0xffd43b, 0x51cf66, 0xffffff, 0xff922b]
CHIPS = '●✦◆$'
CHIP_COLORS = [0xffd43b, 0xfcc419, 0xff922b, 0xfff3bf]
RAIN_ROWS = 28


class Casino:
    def __init__(self):
        self.coins = START
        self.bet = 50
        self.all_in = False
        self.tab = 'roleta'
        self.msg = 'Bem-vindo! Escolha uma aposta.'
        self.tone = None
        self.r = dict(spinning=False, frame=R_FRAMES, wfrom=0.0, wto=0.0, ballto=0.0,
                      result=0, pick=None, stake=0, history=[])
        self.bj = dict(phase='bet', dealer=[], player=[], hide=False, stake=0)
        self.sl = dict(spinning=False, frame=STOPS[2], strips=[[4], [4], [4]], stake=0, stops=STOPS,
                       tension=False)
        self.pk = dict(phase='bet', hand=[], held=[], deck=[], stake=0, rank=-1)
        self.flips = {}
        self.then = None
        self.party = 0
        self.rain = []
        self.shown = START
        self.due = {}

    # ----- saldo -----

    @classmethod
    def load(cls):
        game = cls()
        try:
            with open(SAVE, encoding='utf-8') as f:
                data = json.load(f)
            game.coins = int(data.get('coins', START))
            bet = data.get('bet')
            game.bet = bet if isinstance(bet, (int, float)) and bet >= MIN_BET else 50
            game.all_in = data.get('allIn') is True
            game.tab = data.get('tab', 'roleta')
            game.r['history'] = list(data.get('history', []))[:12]
            game.msg = f'Bem-vindo de volta! Saldo {money(game.coins)}.'
            game.shown = game.coins
        except (OSError, ValueError, TypeError):
            pass
        return game

    def save(self):
        os.makedirs(os.path.dirname(SAVE), exist_ok=True)
        with open(SAVE, 'w', encoding='utf-8') as f:
            json.dump({'coins': self.coins, 'bet': self.bet, 'allIn': self.all_in, 'tab': self.tab,
                       'history': self.r['history']}, f)

    def say(self, msg, tone=None):
        self.msg, self.tone = msg, tone

    def stake(self):
        """What the next round puts down: the whole balance all in, and never more than it."""
        return self.coins if self.all_in else min(self.bet, self.coins)

    def take_bet(self):
        """Takes the stake from the balance and returns it, or 0 with no chips left."""
        stake = self.stake()
        if stake <= 0:
            self.say('Sem fichas: peça mais à casa.', 'lose')
            return 0
        self.coins -= stake
        return stake

    def shift_bet(self, d):
        now, steps = self.stake(), ladder(self.coins)
        if d > 0:
            nxt = next((v for v in steps if v > now), self.coins)
        else:
            nxt = next((v for v in reversed(steps) if v < now), now)
        self.all_in = False
        self.bet = max(nxt, MIN_BET)

    def toggle_all_in(self):
        self.all_in = not self.all_in

    def refill(self):
        self.coins += START
        self.say(f'+{money(START)} fichas da casa.')
        self.save()

    def busy(self):
        return (self.r['spinning'] or self.sl['spinning'] or self.bj['phase'] == 'dealer'
                or self.pk['phase'] == 'reveal' or self.flipping())

    # ----- efeitos -----

    def turn(self, slots, done=None, old=None):
        """Turns the cards at these slots over one after another, then runs done; with old, each
        first turns its old face down. While they turn, the cards take no clicks."""
        done = done or (lambda: None)
        if not slots:
            return done()
        for i, s in enumerate(slots):
            seq = (DOWN if old else []) + ['b5'] * (i * FLIP_GAP + (2 if old else 0)) + UP
            self.flips[s] = dict(f=0, seq=seq, old=old[i] if old else None)
        self.then = done

    def flipping(self):
        return bool(self.flips)

    def step_flips(self):
        for s, flip in list(self.flips.items()):
            flip['f'] += 1
            if flip['f'] >= len(flip['seq']):
                del self.flips[s]
        if not self.flips and self.then:
            done, self.then = self.then, None
            done()

    def cheer(self, mult):
        """Lights a win up: blinking for any win, chips raining down for a big one."""
        self.party = PARTY
        if mult < BIG:
            return
        for _ in range(30):
            self.rain.append(dict(x=rng.random(), y=-rng.random() * 10, v=0.8 + rng.random() * 0.8,
                                  ch=rng.choice(CHIPS), c=rng.choice(CHIP_COLORS)))

    def effects(self):
        return self.party > 0 or bool(self.rain) or self.shown != self.coins

    def step_fx(self):
        if self.party > 0:
            self.party -= 1
        for p in self.rain:
            p['y'] += p['v']
        self.rain = [p for p in self.rain if p['y'] < RAIN_ROWS]
        # the balance rolls up to a win, and drops to a bet at once
        gap = self.coins - self.shown
        self.shown = self.coins if gap <= 1 else self.shown + math.ceil(gap * 0.3)

    def balance(self):
        """The balance on show: rolling up after a win, never above what there is."""
        return min(self.shown, self.coins)

    # ----- roleta -----

    def spin(self, pick):
        r = self.r
        if r['spinning']:
            return
        stake = self.take_bet()
        if not stake:
            return
        result = rng.randrange(len(WHEEL))
        wfrom = r['wto'] % TAU
        wto = wfrom + TAU * (1.5 + rng.random())
        r.update(spinning=True, frame=0, wfrom=wfrom, wto=wto, ballto=wto + result * POCKET,
                 result=result, pick=pick, stake=stake)
        self.say(f'{"ALL IN! " if self.all_in else ""}Girando... {money(stake)} no {NAME[pick]}')

    def step_roulette(self):
        r = self.r
        r['frame'] += 1
        if r['frame'] < R_FRAMES:
            return
        r['spinning'] = False
        n = WHEEL[r['result']]
        c = color_of(n)
        won = r['stake'] * PAYS[c] if r['pick'] == c else 0
        self.coins += won
        r['history'] = [n] + r['history'][:11]
        head = f'Deu {n} {NAME[c]}!'
        if won:
            self.say(f'{head} Ganhou +{money(won)}', 'win')
            self.cheer(PAYS[c])
        else:
            self.say(f'{head} Perdeu {money(r["stake"])}', 'lose')
        self.save()

    # ----- blackjack -----

    def deal(self):
        bj = self.bj
        if bj['phase'] in ('play', 'dealer') or self.flipping():
            return
        stake = self.take_bet()
        if not stake:
            return
        bj.update(phase='play', player=[draw_card(), draw_card()],
                  dealer=[draw_card(), draw_card()], hide=True, stake=stake)
        self.say('Distribuindo...')

        def dealt():
            if natural(bj['player']) or natural(bj['dealer']):
                self.settle()
            else:
                self.say(f'Sua mão: {total(bj["player"])}. Pedir ou parar?')
        self.turn(['p0', 'd0', 'p1'], dealt)

    def hit(self):
        bj = self.bj
        if bj['phase'] != 'play' or self.flipping():
            return
        bj['player'].append(draw_card())

        def landed():
            s = total(bj['player'])
            if s > 21:
                self.settle()
            elif s == 21:
                self.stand()
            else:
                self.say(f'Sua mão: {s}.')
        self.turn([f'p{len(bj["player"]) - 1}'], landed)

    def stand(self):
        bj = self.bj
        if bj['phase'] != 'play' or self.flipping():
            return
        bj.update(phase='dealer', hide=False)
        self.say('A banca revela a carta...')
        self.turn(['d1'])

    def double(self):
        bj = self.bj
        if bj['phase'] != 'play' or len(bj['player']) != 2 or self.flipping():
            return
        if self.coins < bj['stake']:
            self.say('Fichas insuficientes para dobrar.', 'lose')
            return
        self.coins -= bj['stake']
        bj['stake'] *= 2
        bj['player'].append(draw_card())
        self.turn(['p2'], lambda: self.settle() if total(bj['player']) > 21 else self.stand())

    def step_dealer(self):
        bj = self.bj
        if total(bj['dealer']) < 17:
            bj['dealer'].append(draw_card())
            self.turn([f'd{len(bj["dealer"]) - 1}'], lambda: self.say(f'Banca compra: {total(bj["dealer"])}'))
        else:
            self.settle()

    def settle(self):
        bj = self.bj
        me, house, st = total(bj['player']), total(bj['dealer']), bj['stake']
        if bj['hide']:
            self.turn(['d1'])
        bj.update(phase='done', hide=False)

        def pay(mult, msg, tone):
            self.coins += st * mult
            self.say(msg, tone)
            if tone == 'win':
                self.cheer(mult)
            self.save()

        if me > 21:
            pay(0, f'Estourou com {me}! Perdeu {money(st)}', 'lose')
        elif natural(bj['player']) and not natural(bj['dealer']):
            pay(2.5, f'BLACKJACK! +{money(st * 2.5)}', 'win')
        elif natural(bj['dealer']) and not natural(bj['player']):
            pay(0, f'Blackjack da banca. Perdeu {money(st)}', 'lose')
        elif house > 21:
            pay(2, f'Banca estourou ({house})! +{money(st * 2)}', 'win')
        elif me > house:
            pay(2, f'{me} x {house}: ganhou +{money(st * 2)}', 'win')
        elif me == house:
            pay(1, f'Empate em {me}. Aposta devolvida.', None)
        else:
            pay(0, f'{house} x {me}: a banca leva {money(st)}', 'lose')

    # ----- caça-níquel -----

    def pull(self):
        sl = self.sl
        if sl['spinning']:
            return
        stake = self.take_bet()
        if not stake:
            return
        # each strip starts at the symbol on show and ends at the new one;
        # the later reels have longer strips, so they stop one after another,
        # and when the first two match the last one keeps everyone waiting
        ends = rng.choices(range(len(SYMBOLS)), WEIGHTS, k=3)
        tension = ends[0] == ends[1]
        strips = []
        for i, old in enumerate(sl['strips']):
            n = 16 + i * 6 + (18 if tension and i == 2 else 0)
            strips.append([old[-1]] + [rng.randrange(len(SYMBOLS)) for _ in range(n)] + [ends[i]])
        stops = [STOPS[0], STOPS[1], STOPS[2] + (TENSION if tension else 0)]
        sl.update(spinning=True, frame=0, strips=strips, stake=stake, stops=stops, tension=tension)
        self.say(f'{"ALL IN! " if self.all_in else ""}Girando... {money(stake)}')

    def step_slots(self):
        sl = self.sl
        sl['frame'] += 1
        if sl['tension'] and sl['frame'] == sl['stops'][1]:
            self.say('Dois iguais... segura!')
        if sl['frame'] < sl['stops'][2]:
            return
        sl['spinning'] = False
        faces = [s[-1] for s in sl['strips']]
        mult = payout(faces)
        won = sl['stake'] * mult
        self.coins += won
        if mult >= 50:
            self.say(f'JACKPOT! {mult}x +{money(won)}', 'win')
        elif mult > 1:
            self.say(f'Trinca de {SYMBOLS[faces[0]]}! +{money(won)}', 'win')
        elif mult == 1:
            self.say('Duas cerejas: aposta de volta.', None)
        else:
            self.say(f'Nada dessa vez. Perdeu {money(sl["stake"])}', 'lose')
        if mult > 1:
            self.cheer(mult)
        self.save()

    # ----- poker -----

    def deal_poker(self):
        pk = self.pk
        if pk['phase'] in ('draw', 'reveal') or self.flipping():
            return
        stake = self.take_bet()
        if not stake:
            return
        old = pk['hand'] or None
        deck = shuffled()
        hand = deck[:5]
        pk.update(phase='draw', hand=hand, held=[False] * 5, deck=deck[5:], stake=stake, rank=-1)
        self.say('Distribuindo...')

        def dealt():
            pk['rank'] = rank_hand(hand)
            if pk['rank'] >= 0:
                self.say(f'Você tem {HANDS[pk["rank"]]}. Escolha as que ficam.')
            else:
                self.say('Escolha as cartas que ficam e troque.')
        self.turn([f'k{i}' for i in range(5)], dealt, old)

    def hold(self, i):
        pk = self.pk
        if pk['phase'] == 'draw' and not self.flipping():
            pk['held'][i] = not pk['held'][i]

    def swap(self):
        """Turns the cards not held face down and up again as new ones, then pays the hand."""
        pk = self.pk
        if pk['phase'] != 'draw' or self.flipping():
            return
        old = pk['hand']
        out = [i for i in range(5) if not pk['held'][i]]
        pk['hand'] = [card if held else pk['deck'].pop() for card, held in zip(old, pk['held'])]
        pk['phase'] = 'reveal'
        self.say('Virando...')
        self.turn([f'k{i}' for i in out], self.pay_poker, [old[i] for i in out])

    def pay_poker(self):
        pk = self.pk
        rank = pk['rank'] = rank_hand(pk['hand'])
        pk['phase'] = 'done'
        won = pk['stake'] * HAND_PAYS[rank] if rank >= 0 else 0
        self.coins += won
        if rank < 0:
            self.say(f'Nada dessa vez. Perdeu {money(pk["stake"])}', 'lose')
        elif won == pk['stake']:
            self.say(f'{HANDS[rank]}: aposta de volta.', None)
        else:
            self.say(f'{"ROYAL FLUSH" if rank == 0 else HANDS[rank]}! +{money(won)}', 'win')
        if won > pk['stake']:
            self.cheer(HAND_PAYS[rank])
        self.save()

    # ----- relógio -----

    def tick(self, now):
        changed = False
        for key, running, dt, step in (
            ('r', self.r['spinning'], R_DT, self.step_roulette),
            ('s', self.sl['spinning'], S_DT, self.step_slots),
            ('f', self.flipping(), FLIP_DT, self.step_flips),
            # the dealer waits for each card to land before the next
            ('d', self.bj['phase'] == 'dealer' and not self.flipping(), DEALER_DT, self.step_dealer),
            ('x', self.effects(), FX_DT, self.step_fx),
        ):
            if not running:
                self.due.pop(key, None)
                continue
            due = self.due.setdefault(key, now + dt)
            if now >= due:
                step()
                self.due[key] = max(due + dt, now)
                changed = True
        return changed

    def finish(self):
        while self.r['spinning']:
            self.step_roulette()
        while self.sl['spinning']:
            self.step_slots()
        while True:
            while self.flipping():
                self.step_flips()
            if self.bj['phase'] == 'dealer':
                self.step_dealer()
            elif self.pk['phase'] == 'draw':
                self.swap()
            else:
                break


# ---------- Tela ----------

KEEP = object()


class Screen:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.cells = [[(' ', None, None)] * w for _ in range(h)]
        self.hits = []

    def put(self, x, y, ch, fg=None, bg=KEEP):
        if 0 <= x < self.w and 0 <= y < self.h:
            if bg is KEEP:
                bg = self.cells[y][x][2]
            self.cells[y][x] = (ch, fg, bg)

    def text(self, x, y, s, fg=None, bg=KEEP):
        for i, ch in enumerate(s):
            self.put(x + i, y, ch, fg, bg)

    def button(self, x, y, label, action, fg, bg):
        s = f' {label} '
        self.text(x, y, s, fg, bg)
        if action:
            self.hits.append((x, x + len(s), y, action))
        return len(s)

    def row(self, y, items, gap=1):
        """Centers a row of buttons: items are (label, action, fg, bg)."""
        width = sum(len(i[0]) + 2 for i in items) + gap * (len(items) - 1)
        x = (self.w - width) // 2
        for label, action, fg, bg in items:
            x += self.button(x, y, label, action, fg, bg) + gap

    def center(self, y, s, fg=None, bg=KEEP):
        self.text((self.w - len(s)) // 2, y, s, fg, bg)


class Pixels:
    """Square pixels, two per cell: the top one a half block's foreground."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = [[None] * w for _ in range(h)]

    def set(self, x, y, c):
        x, y = int(math.floor(x)), int(math.floor(y))
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x] = c

    def rect(self, x, y, w, h, c):
        for j in range(h):
            for i in range(w):
                self.set(x + i, y + j, c)

    def sprite(self, x, y, rows, palette, top, bottom):
        for j, row in enumerate(rows):
            if top <= y + j <= bottom:
                for i, ch in enumerate(row):
                    if ch in palette:
                        self.set(x + i, y + j, palette[ch])

    def blit(self, scr, ox, oy):
        for cy in range(self.h // 2):
            for x in range(self.w):
                t, b = self.px[2 * cy][x], self.px[2 * cy + 1][x]
                if t is None and b is None:
                    continue
                if t == b:
                    scr.put(ox + x, oy + cy, ' ', None, t)
                elif t is None:
                    scr.put(ox + x, oy + cy, '▄', b, None)
                else:
                    scr.put(ox + x, oy + cy, '▀', t, b)


POCKET_COLOR = {'red': 0xd42a2a, 'black': 0x1c1c1c, 'green': 0x16a34a}


def wheel_angles(r):
    t = min(1, r['frame'] / R_FRAMES)
    e = 1 - (1 - t) ** 3
    wheel = r['wfrom'] + (r['wto'] - r['wfrom']) * e
    return t, wheel, r['ballto'] + (1 - e) * TAU * 3


def ball_number(r):
    """The number in the pocket under the ball: it rolls by while the wheel spins and stops on the result."""
    _, wheel, ball = wheel_angles(r)
    return WHEEL[round(((ball - wheel) % TAU) / POCKET) % len(WHEEL)]


def wheel_art(r, party, size=22):
    p = Pixels(size, size)
    t, wheel, ball = wheel_angles(r)
    drop = 0 if t < 0.7 else (t - 0.7) / 0.3
    c = R = size / 2
    hub = R * 0.36
    for y in range(size):
        for x in range(size):
            dx, dy = x + 0.5 - c, y + 0.5 - c
            d = math.hypot(dx, dy)
            if d > R:
                continue
            if d > R - 0.9:
                # after a win the rim's lights chase each other around the wheel
                bulb = (int((math.atan2(dy, dx) % TAU) / (TAU / 16)) + party) % 2
                if party:
                    col = 0xffffff if bulb else 0xffd43b
                else:
                    col = 0xe2b93b if dy < 0 else 0x9c7418
            elif d > R - 2.8:
                col = 0x5a3a1e
            elif d > hub:
                rel = (math.atan2(dy, dx) - wheel) % TAU
                col = POCKET_COLOR[color_of(WHEEL[round(rel / POCKET) % len(WHEEL)])]
            elif d > hub - 1:
                col = 0xc9a227
            else:
                # the turret: four gold spokes turning with the wheel
                spoke = min(
                    abs(dx * math.sin(s) - dy * math.cos(s))
                    + (99 if dx * math.cos(s) + dy * math.sin(s) < 0 else 0)
                    for s in (wheel + k * math.pi / 2 for k in range(4))
                )
                col = 0xe2b93b if spoke < 0.7 or d < 1.2 else 0x3b2412
            p.set(x, y, col)
    track = R - 2
    depth = track - (track - (R - 3.8)) * drop
    p.set(c + math.cos(ball) * depth, c + math.sin(ball) * depth, 0xffffff)
    return p


SPRITES = [
    ['....gg..', '...g..g.', '..g...g.', '.g....g.', 'rwr..rwr', 'rrr..rrr', '.r....r.', '........'],
    ['........', '..yyyy..', '.ywyyyy.', 'yyyyyyyo', 'yyyyyyyo', '.yyyyyo.', '..yooo..', '........'],
    ['...oo...', '..oyyo..', '.oywyyo.', '.oyyyyo.', '.oyyyyo.', 'oyyyyyyo', 'oooooooo', '...oo...'],
    ['...yy...', '...yy...', 'yyywyyyy', '.yyyyyy.', '..yyyy..', '.yy..yy.', 'yy....yy', '........'],
    ['RRRRRRRR', 'RRRRRRRR', '.....RR.', '....RR..', '...RR...', '...RR...', '..RR....', '..RR....'],
    ['........', '..cccc..', '.cwccbc.', 'cccccccb', '.cccccb.', '..cccb..', '...cb...', '........'],
]
SPRITE_COLORS = {'g': 0x2f9e44, 'r': 0xe03131, 'w': 0xffffff, 'y': 0xffd43b,
                 'o': 0xe8890c, 'R': 0xd6001c, 'c': 0x66d9e8, 'b': 0x1c7ed6}


def reels_art(sl, won, party):
    W, H = 28, 16
    p = Pixels(W, H)
    p.rect(0, 0, W, H, 0xc9a227)
    # the frame's bulbs chase around while it spins and blink in colors after a win
    if sl['spinning'] or party:
        phase = sl['frame'] if sl['spinning'] else party
        bulb = 0xfff3bf if sl['spinning'] else CHEER[party % len(CHEER)]
        for x in range(W):
            if (x + phase) % 3 == 0:
                p.set(x, 0, bulb)
            if (x - phase) % 3 == 0:
                p.set(x, H - 1, bulb)
        for y in range(H):
            if (y - phase) % 3 == 0:
                p.set(0, y, bulb)
            if (y + phase) % 3 == 0:
                p.set(W - 1, y, bulb)
    for i, strip in enumerate(sl['strips']):
        x0 = 1 + i * 9
        p.rect(x0, 1, 8, 14, 0xf8f1e3)
        stop = sl['stops'][i]
        t = min(1, sl['frame'] / stop) if sl['spinning'] else 1
        pos = round((len(strip) - 1) * PITCH * (1 - (1 - t) ** 3))
        # window row wy shows strip row pos + wy - 3; symbol k sits at k*PITCH+1
        for k in range(-2, 3):
            base = pos // PITCH + k
            sym = strip[base % len(strip)]
            top = base * PITCH + 1 - pos + 4
            p.sprite(x0, top, SPRITES[sym], SPRITE_COLORS, 1, 14)
    # the pay line's marks: green on a win, blinking while the last reel decides
    waiting = sl['spinning'] and sl['tension'] and sl['frame'] >= sl['stops'][1]
    mark = 0x40c057 if won else 0xffd43b if waiting and sl['frame'] % 4 < 2 else 0xe03131
    for y in (8, 9):
        p.set(0, y, mark)
        p.set(W - 1, y, mark)
    return p


FELT, FELT_TEXT = 0x0f5132, 0xd8f5e3


def card_art(scr, x, y, card, flip=None):
    """A card 5 columns wide, or the look it has this frame while it turns over."""
    look = 'b5' if card is None else flip['seq'][flip['f']] if flip else 'f5'
    if look[0] == 'o':
        card = flip['old'] or card
        look = 'f' + look[1]
    if look == 'e':
        for j in range(3):
            scr.put(x + 2, y + j, ' ', None, 0xdee2e6)
        return
    cw = int(look[1])
    left = x + (5 - cw) // 2
    if look[0] == 'b' or card is None:
        for j in range(3):
            scr.text(left, y + j, '▒' * cw, 0x748ffc, 0x1c3d8f)
        return
    rank, suit = card
    ink = 0xc92a2a if suit in (1, 2) else 0x111111
    paper = 0xfff3bf if look[0] == 's' else 0xf8f9fa
    for j in range(3):
        scr.text(left, y + j, ' ' * cw, ink, paper)
    label = RANKS[rank]
    scr.text(left, y, label, ink)
    scr.put(left + (cw - 1) // 2, y + 1, SUITS[suit], ink)
    scr.text(left + cw - len(label), y + 2, label, ink)


def table_art(scr, game, x0, y0, width):
    bj = game.bj
    for j in range(9):
        scr.text(x0, y0 + j, ' ' * width, None, FELT)

    # a card still turning over counts once it lands
    def count(hand, id):
        seen = [card for i, card in enumerate(hand) if f'{id}{i}' not in game.flips]
        return str(total(seen)) if seen else ''

    dealer = bj['dealer']
    first = count(dealer[:1], 'd')
    dealer_total = (f'{first} + ?' if first else '') if bj['hide'] else count(dealer, 'd')
    scr.text(x0 + 1, y0, f'BANCA {dealer_total}', FELT_TEXT)
    scr.text(x0 + 1, y0 + 8, f'VOCÊ {count(bj["player"], "p")}', FELT_TEXT)
    if not dealer:
        scr.text(x0 + 1, y0 + 3, 'Aposte e distribua', FELT_TEXT)

    def seat(hand, y, id):
        step = min(6, (width - 7) // (len(hand) - 1)) if len(hand) > 1 else 6
        for i, card in enumerate(hand):
            card_art(scr, x0 + 1 + i * step, y, card, game.flips.get(f'{id}{i}'))

    seat([dealer[0], None] if bj['hide'] else dealer, y0 + 1, 'd')
    seat(bj['player'], y0 + 5, 'p')
    if bj['stake']:
        chip = f'● {money(bj["stake"])}'
        scr.text(x0 + width - 1 - len(chip), y0 + 4, chip, glow(game, 0xffd43b))


def poker_art(scr, game, x0, y0, width):
    pk = game.pk
    for j in range(10):
        scr.text(x0, y0 + j, ' ' * width, None, FELT)
    # the pay table in two columns, the hand on the table lit in gold
    for i, name in enumerate(HANDS):
        left = i < 4
        line = name.ljust(11 if left else 10) + str(HAND_PAYS[i]).rjust(4 if left else 3)
        scr.text(x0 + (1 if left else 18), y0 + (i if left else i - 4), line,
                 glow(game, GOLD) if i == pk['rank'] else FELT_TEXT)
    cx = x0 + (width - 29) // 2
    for i in range(5):
        x = cx + i * 6
        card_art(scr, x, y0 + 6, pk['hand'][i] if pk['hand'] else None, game.flips.get(f'k{i}'))
        if pk['phase'] not in ('draw', 'reveal'):
            continue
        if pk['held'][i]:
            scr.text(x, y0 + 9, ' FICA', 0x111111, GOLD)
        # the card and the row under it both hold it
        if pk['phase'] == 'draw':
            for j in range(6, 10):
                scr.hits.append((x, x + 5, y0 + j, lambda i=i: game.hold(i)))


GOLD = 0xffd43b
DIM = 0x868e96
TAB_BG, TAB_ON = 0x343a40, 0xffd43b
BTN_BG = 0x495057


def glow(game, base):
    """A color that blinks through CHEER while a win is cheered, and base otherwise."""
    return CHEER[game.party // 2 % len(CHEER)] if game.party > 0 else base


def layout(game, w, h):
    scr = Screen(w, h)
    y = 0
    scr.center(y, '♠ ♥  C A S S I N O  ♦ ♣', glow(game, GOLD))
    y += 1
    scr.center(y, f'● {money(game.balance())} fichas', 0x51cf66 if game.shown < game.coins else GOLD)
    y += 2

    def tab(id, label):
        on = game.tab == id

        def go():
            game.tab = id
            game.save()
        return (label, go, 0x111111 if on else 0xdee2e6, TAB_ON if on else TAB_BG)

    # four tabs fit in 34 columns only with no gap between them
    scr.row(y, [tab('roleta', 'Roleta'), tab('blackjack', 'Blackjack'), tab('slots', 'Slots'),
                tab('poker', 'Poker')], 0)
    y += 2

    if game.tab == 'roleta':
        r = game.r
        art = wheel_art(r, game.party)
        ax = (w - art.w) // 2
        art.blit(scr, ax, y)
        if r['stake']:
            # the hub shows the pocket under the ball as it rolls by, then the one it lands in
            n = ball_number(r)
            scr.text(ax + 9, y + 5, f' {n:>2} ', glow(game, 0xffffff), POCKET_COLOR[color_of(n)])
        y += art.h // 2
        hist = r['history'][:7]
        if hist:
            width = sum(len(str(n)) + 2 for n in hist)
            x = (w - width) // 2
            for n in hist:
                scr.text(x, y, f' {n} ', 0xffffff, POCKET_COLOR[color_of(n)])
                x += len(str(n)) + 2
        y += 2
        live = not r['spinning']

        def pick(color, label, bg):
            return (label, (lambda: game.spin(color)) if live else None,
                    0xffffff if live else DIM, bg if live else TAB_BG)
        scr.row(y, [pick('red', 'Vermelho', 0xc92a2a), pick('black', 'Preto', 0x1a1a1a),
                    pick('green', 'Verde', 0x2b8a3e)])
        y += 1
        scr.center(y, 'paga 2x · 2x · 36x', DIM)
        y += 2
    elif game.tab == 'blackjack':
        bj = game.bj
        width = max(24, min(w - 2, 30))
        table_art(scr, game, (w - width) // 2, y, width)
        y += 10
        if bj['phase'] in ('bet', 'done'):
            label = 'Distribuir' if bj['phase'] == 'bet' else 'Nova mão'
            scr.row(y, [(label, game.deal, 0x111111, GOLD)])
        elif bj['phase'] == 'play':
            items = [('Pedir', game.hit, 0xffffff, BTN_BG), ('Parar', game.stand, 0xffffff, BTN_BG)]
            if len(bj['player']) == 2:
                items.append(('Dobrar', game.double, 0xffffff, BTN_BG))
            scr.row(y, items)
        else:
            scr.center(y, 'vez da banca...', GOLD)
        y += 2
        scr.center(y, 'blackjack paga 3:2', DIM)
        y += 2
    elif game.tab == 'poker':
        pk = game.pk
        width = max(24, min(w - 2, 32))
        poker_art(scr, game, (w - width) // 2, y, width)
        y += 11
        if pk['phase'] == 'draw':
            scr.row(y, [('Trocar', game.swap, 0x111111, GOLD)])
        elif pk['phase'] != 'reveal':
            label = 'Distribuir' if pk['phase'] == 'bet' else 'Nova mão'
            scr.row(y, [(label, game.deal_poker, 0x111111, GOLD)])
        y += 2
        if pk['phase'] == 'draw':
            scr.center(y, 'clique nas cartas que ficam', DIM)
        elif pk['phase'] != 'reveal':
            scr.center(y, 'video poker · par de J ou mais', DIM)
        y += 2
    else:
        sl = game.sl
        won = not sl['spinning'] and sl['stake'] and payout([s[-1] for s in sl['strips']]) > 1
        art = reels_art(sl, won, game.party)
        art.blit(scr, (w - art.w) // 2, y)
        y += art.h // 2 + 1
        live = not sl['spinning']
        scr.row(y, [('  GIRAR  ', game.pull if live else None,
                     0x111111 if live else DIM, GOLD if live else TAB_BG)])
        y += 2
        for line in ('cereja 5x · limão 15x · sino 25x', 'estrela 50x · sete 100x',
                     'diamante 250x · 2 cerejas 1x'):
            scr.center(y, line, DIM)
            y += 1
        y += 1

    def bet(d):
        return lambda: (game.shift_bet(d), game.save())

    def all_in():
        game.toggle_all_in()
        game.save()
    # the buttons, the gaps and the label's padding take 19 columns; a long balance drops the word
    stake = f'aposta {money(game.stake())}'
    if len(stake) + 19 > w:
        stake = f'● {money(game.stake())}'
    scr.row(y, [('-', bet(-1), 0xffffff, BTN_BG), (stake, None, GOLD, None), ('+', bet(1), 0xffffff, BTN_BG),
                ('ALL IN', all_in, 0xffffff, 0xa61e4d) if game.all_in else ('All in', all_in, 0x111111, GOLD)])
    y += 2

    tone = {'win': glow(game, 0x51cf66), 'lose': 0xff6b6b}.get(game.tone, 0xdee2e6)
    for line in wrap(game.msg, max(10, min(w - 2, 32)))[:2]:
        scr.center(y, line, tone)
        y += 1
    y += 1

    items = []
    if game.coins < MIN_BET and not game.busy():
        items.append((f'+{money(START)} fichas', game.refill, 0x111111, GOLD))
    items.append(('Sair', lambda: 'quit', 0xffffff, 0x862e2e))
    scr.row(max(y, h - 1), items)

    # a big win's chips fall over everything; the clicks still go through to what is under them
    for p in game.rain:
        if p['y'] >= 0:
            scr.put(int(p['x'] * w), int(p['y']), p['ch'], p['c'])
    return scr


def wrap(text, width):
    lines, line = [], ''
    for word in text.split():
        if line and len(line) + 1 + len(word) > width:
            lines.append(line)
            line = word
        else:
            line = f'{line} {word}'.strip()
    return lines + [line] if line else lines


def has_truecolor():
    forced = os.environ.get('CASSINO_CORES')
    if forced:
        return forced != '256'
    if os.environ.get('COLORTERM', '').lower() in ('truecolor', '24bit'):
        return True
    if os.name == 'nt' or os.environ.get('WT_SESSION'):
        return True
    if os.environ.get('TERM_PROGRAM') in ('vscode', 'iTerm.app', 'WezTerm', 'ghostty', 'Hyper', 'Tabby'):
        return True
    term = os.environ.get('TERM', '')
    return any(t in term for t in ('kitty', 'alacritty', 'direct', 'foot', 'ghostty'))


TRUECOLOR = has_truecolor()


def xterm256(c):
    r, g, b = c >> 16 & 255, c >> 8 & 255, c & 255
    if max(r, g, b) - min(r, g, b) < 12:
        gray = (r + g + b) // 3
        if gray < 8:
            return 16
        if gray > 238:
            return 231
        return 232 + (gray - 8) * 24 // 231
    level = lambda v: 0 if v < 48 else 1 if v < 115 else (v - 35) // 40
    return 16 + 36 * level(r) + 6 * level(g) + level(b)


def sgr(fg, bg):
    def part(c, layer, default):
        if c is None:
            return default
        if TRUECOLOR:
            return f'{layer};2;{c >> 16 & 255};{c >> 8 & 255};{c & 255}'
        return f'{layer};5;{xterm256(c)}'
    return f'\x1b[{part(fg, 38, "39")};{part(bg, 48, "49")}m'


def encode(row):
    out, cur = [], (KEEP, KEEP)
    for ch, fg, bg in row:
        if (fg, bg) != cur:
            out.append(sgr(fg, bg))
            cur = (fg, bg)
        out.append(ch)
    out.append('\x1b[0m')
    return ''.join(out)


# ---------- Terminal ----------

MOUSE = re.compile(r'\x1b\[<(\d+);(\d+);(\d+)([Mm])')


def write(s):
    sys.stdout.write(s)
    sys.stdout.flush()


class WindowsConsole:
    """Raw VT input and output on a Windows console (Windows Terminal, conhost)."""

    VT_INPUT, EXTENDED_FLAGS = 0x0200, 0x0080
    PROCESSED_OUTPUT, VT_OUTPUT, NO_AUTO_RETURN = 0x0001, 0x0004, 0x0008

    def __init__(self):
        import ctypes
        from ctypes import wintypes
        self.ctypes, self.wintypes = ctypes, wintypes
        self.k32 = ctypes.WinDLL('kernel32', use_last_error=True)
        self.hin, self.hout = self.k32.GetStdHandle(-10), self.k32.GetStdHandle(-11)
        self.mode_in, self.mode_out = wintypes.DWORD(), wintypes.DWORD()

    def enter(self):
        k32, byref = self.k32, self.ctypes.byref
        k32.GetConsoleMode(self.hin, byref(self.mode_in))
        k32.GetConsoleMode(self.hout, byref(self.mode_out))
        # no line editing, no echo, no quick-edit selection eating the clicks
        k32.SetConsoleMode(self.hin, self.VT_INPUT | self.EXTENDED_FLAGS)
        k32.SetConsoleMode(self.hout, self.mode_out.value | self.PROCESSED_OUTPUT
                           | self.VT_OUTPUT | self.NO_AUTO_RETURN)
        k32.SetConsoleOutputCP(65001)

    def leave(self):
        self.k32.SetConsoleMode(self.hin, self.mode_in.value)
        self.k32.SetConsoleMode(self.hout, self.mode_out.value)

    def read(self, q):
        buf = self.ctypes.create_unicode_buffer(1024)
        n = self.wintypes.DWORD()
        while self.k32.ReadConsoleW(self.hin, buf, 1024, self.ctypes.byref(n), None):
            q.put(buf[:n.value])


class PosixConsole:
    """Raw mode on a Unix tty (macOS, Linux, WSL, tmux)."""

    def __init__(self):
        import termios
        self.termios = termios
        self.fd = sys.stdin.fileno()
        self.saved = None

    def enter(self):
        import tty
        self.saved = self.termios.tcgetattr(self.fd)
        tty.setraw(self.fd)

    def leave(self):
        if self.saved:
            self.termios.tcsetattr(self.fd, self.termios.TCSADRAIN, self.saved)

    def read(self, q):
        while True:
            data = os.read(self.fd, 1024)
            if not data:
                break
            q.put(data.decode('utf-8', 'ignore'))


def events(chunk):
    """Clicks as (x, y) zero-based, and 'quit' for q or Ctrl+C."""
    for m in MOUSE.finditer(chunk):
        b, x, y, kind = int(m[1]), int(m[2]), int(m[3]), m[4]
        if kind == 'M' and b & 3 == 0 and not b & (32 | 64):
            yield (x - 1, y - 1)
    rest = MOUSE.sub('', chunk)
    if 'q' in rest or 'Q' in rest or '\x03' in rest:
        yield 'quit'


def play():
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        sys.exit('O cassino precisa de um terminal.')
    sys.stdout.reconfigure(encoding='utf-8')
    console = WindowsConsole() if os.name == 'nt' else PosixConsole()
    console.enter()
    write('\x1b]0;Cassino\x07\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h\x1b[2J')

    game = Casino.load()
    q = queue.Queue()
    threading.Thread(target=console.read, args=(q,), daemon=True).start()
    prev, size, hits, dirty = None, None, [], True
    try:
        while True:
            if game.tick(time.monotonic()):
                dirty = True
            now_size = shutil.get_terminal_size()
            if now_size != size:
                size, prev, dirty = now_size, None, True
                write('\x1b[0m\x1b[2J')
            if dirty:
                # one row short of the bottom, so the last cell never scrolls
                scr = layout(game, size.columns, max(1, size.lines - 1))
                rows = [encode(r) for r in scr.cells]
                write('\x1b[?2026h' + ''.join(
                    f'\x1b[{y + 1};1H{line}' for y, line in enumerate(rows)
                    if prev is None or prev[y] != line) + '\x1b[?2026l')
                prev, hits, dirty = rows, scr.hits, False
            try:
                chunk = q.get(timeout=0.02)
            except queue.Empty:
                continue
            for ev in events(chunk):
                if ev == 'quit':
                    return
                x, y = ev
                for x0, x1, yy, action in hits:
                    if yy == y and x0 <= x < x1:
                        if action() == 'quit':
                            return
                        dirty = True
                        break
    finally:
        game.finish()
        game.save()
        write('\x1b[?1000l\x1b[?1006l\x1b[0m\x1b[?25h\x1b[?1049l')
        console.leave()


# ---------- Painel ao lado ----------

# iTerm2 splits the current session; the new pane runs the game and closes with it.
ITERM_SPLIT = '''on run argv
  tell application "iTerm2" to tell current session of current window
    split vertically with default profile command (item 1 of argv)
  end tell
end run'''

# Terminal.app has no side panes: the current window gives up its right 32%
# to a new window that runs the game, so the two sit together like a split.
TERMINAL_SPLIT = '''on run argv
  tell application "Terminal"
    set b to bounds of front window
    set cut to (item 3 of b) - (round (((item 3 of b) - (item 1 of b)) * 32 / 100))
    set bounds of front window to {item 1 of b, item 2 of b, cut, item 4 of b}
    do script "exec " & (item 1 of argv)
    set bounds of front window to {cut, item 2 of b, item 3 of b, item 4 of b}
  end tell
end run'''


def side_pane_commands(cmd):
    """How each terminal that can split opens `cmd` in a pane at the right."""
    env = os.environ
    found = []
    if env.get('TMUX'):
        found.append(['tmux', 'split-window', '-h', '-l', '34%', *cmd])
    if env.get('ZELLIJ'):
        found.append(['zellij', 'run', '--direction', 'right', '--close-on-exit', '--', *cmd])
    if env.get('WEZTERM_PANE'):
        found.append(['wezterm', 'cli', 'split-pane', '--right', '--percent', '34', '--', *cmd])
    if env.get('KITTY_WINDOW_ID'):
        found.append(['kitten', '@', 'launch', '--location=vsplit', '--title', 'Cassino', *cmd])
    if env.get('WT_SESSION'):
        found.append(['wt', '-w', '0', 'split-pane', '-V', '-s', '0.32', '--title', 'Cassino', *cmd])
    line = ' '.join(shlex.quote(a) for a in cmd)
    if env.get('TERM_PROGRAM') == 'iTerm.app':
        found.append(['osascript', '-e', ITERM_SPLIT, line])
    if env.get('TERM_PROGRAM') == 'Apple_Terminal':
        found.append(['osascript', '-e', TERMINAL_SPLIT, line])
    return found


def open_beside():
    """Opens the game in a split at the right; False where no split worked."""
    cmd = [sys.executable, os.path.abspath(__file__)]
    for argv in side_pane_commands(cmd):
        try:
            done = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                  stderr=subprocess.DEVNULL, timeout=10)
        except (OSError, subprocess.SubprocessError):
            continue
        if done.returncode == 0:
            return True
    return False


def main():
    if '--lado' in sys.argv[1:] and open_beside():
        return
    try:
        play()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
