import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'cassino',
  component: 'Pane',
  requestId: 'cassino',
  props: {
    title: 'Cassino',
    isFocused: false,
    bodyColumns: 34,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 28 },
    view: {},
  },
} as const

test('/cassino opens the pane beside the chat', async ($, on) => {
  const opened: string[] = []
  on('command.register', () => ({ value: { command: 'cassino' } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const out = await $.command.run({
    command: 'cassino',
    args: '',
    origin: { kind: 'person' },
    presentation: { isFullscreen: true, columns: 160 },
  } as never)
  expect(opened).toEqual(['cassino'])
  expect(JSON.stringify(out)).toContain('ao lado do chat')
})

test('a click on Vermelho spins the wheel and the balance is saved', async ($, on) => {
  mock.store(on, { save: { coins: 1000, bet: 50, tab: 'roleta', history: [] } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize({ columns: 34, rows: 28, in: 'mesa' })
  expect((await ui.find({ type: 'Text', text: /fichas/, in: 'mesa' }))?.text).toBe('● 1.000 fichas')

  // the colour row sits at y 18: ' Vermelho ' from x 4 to 13 on 34 columns
  await ui.pointer({ type: 'down', x: 6, y: 18, button: 'left', in: 'mesa' })
  expect((await ui.find({ type: 'Text', text: /fichas/, in: 'mesa' }))?.text).toBe('● 950 fichas')
  expect((await ui.find({ type: 'Text', text: /Girando/, in: 'mesa' }))?.text).toContain('VERMELHO')

  // the spin, the balance rolling up and any chips raining down are over by then
  await ui.advance(6000)
  expect((await ui.find({ type: 'Text', text: /^Deu /, in: 'mesa' }))).toBeDefined()
  const after = (await ui.find({ type: 'Text', text: /fichas/, in: 'mesa' }))?.text
  expect(after).toMatch(/^● (950|1\.050|2\.750) fichas$/)
  await ui.unmount()

  // the pane opened again reads the balance the spin saved
  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await again.find({ type: 'Text', text: /fichas/, in: 'mesa' }))?.text).toBe(after)
  expect((await again.find({ type: 'Text', text: /Bem-vindo de volta/, in: 'mesa' }))).toBeDefined()
  await again.unmount()
})

test('the bet never passes the balance and All in puts it all down', async ($, on) => {
  mock.store(on, { save: { coins: 300, bet: 1000, tab: 'roleta', history: [] } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize({ columns: 34, rows: 28, in: 'mesa' })
  const shown = async (text: RegExp) => (await ui.find({ type: 'Text', text, in: 'mesa' }))?.text

  // the bet row sits at y 21: '-' x 2-4, 'aposta 300' x 6-17, '+' x 19-21, 'All in' x 23-30
  expect((await shown(/aposta/))?.trim()).toBe('aposta 300')
  await ui.pointer({ type: 'down', x: 20, y: 21, button: 'left', in: 'mesa' })
  expect((await shown(/aposta/))?.trim()).toBe('aposta 300')
  await ui.pointer({ type: 'down', x: 3, y: 21, button: 'left', in: 'mesa' })
  expect((await shown(/aposta/))?.trim()).toBe('aposta 250')

  // 'aposta 250' keeps the row where it was, so All in still sits at x 23-30
  await ui.pointer({ type: 'down', x: 26, y: 21, button: 'left', in: 'mesa' })
  expect((await shown(/aposta/))?.trim()).toBe('aposta 300')
  expect(await shown(/^ ALL IN $/)).toBeDefined()
  await ui.pointer({ type: 'down', x: 6, y: 18, button: 'left', in: 'mesa' })
  expect(await shown(/fichas/)).toBe('● 0 fichas')
  expect(await shown(/Girando/)).toContain('ALL IN! Girando... 300 no')
  await ui.unmount()
})

test('Sair closes the pane', async ($, on) => {
  mock.store(on)
  const closed: string[] = []
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize({ columns: 34, rows: 28, in: 'mesa' })
  // ' Sair ' sits on the last row, x 14 to 19
  await ui.pointer({ type: 'down', x: 15, y: 27, button: 'left', in: 'mesa' })
  expect(closed).toEqual(['cassino'])
  await ui.unmount()
})

test('blackjack deals and the slots spin to a result', async ($, on) => {
  mock.store(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize({ columns: 34, rows: 28, in: 'mesa' })
  const shown = async (text: RegExp) => (await ui.find({ type: 'Text', text, in: 'mesa' }))?.text

  // tabs on row 3: Roleta x 0-7, Blackjack x 8-18, Slots x 19-25, Poker x 26-32
  await ui.pointer({ type: 'down', x: 15, y: 3, button: 'left', in: 'mesa' })
  expect(await shown(/Aposte e distribua/)).toBeDefined()
  await ui.pointer({ type: 'down', x: 13, y: 15, button: 'left', in: 'mesa' })
  expect(await shown(/Distribuindo/)).toBeDefined()
  await ui.advance(4000)
  expect(await shown(/Sua mão|BLACKJACK|Blackjack da banca|Empate/)).toBeDefined()

  await ui.pointer({ type: 'down', x: 22, y: 3, button: 'left', in: 'mesa' })
  await ui.pointer({ type: 'down', x: 14, y: 14, button: 'left', in: 'mesa' })
  expect(await shown(/Girando/)).toBeDefined()
  // up to 3,7 s with the last reel holding out, then the chips of a big win
  await ui.advance(7000)
  expect(await shown(/Nada dessa vez|Trinca|JACKPOT|Duas cerejas/)).toBeDefined()
  await ui.unmount()
})

test('poker deals five cards, holds the clicked ones and pays the swap', async ($, on) => {
  mock.store(on, { save: { coins: 1000, bet: 50, tab: 'roleta', history: [] } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize({ columns: 34, rows: 28, in: 'mesa' })
  const shown = async (text: RegExp) => (await ui.find({ type: 'Text', text, in: 'mesa' }))?.text
  const click = (x: number, y: number) => ui.pointer({ type: 'down', x, y, button: 'left', in: 'mesa' })

  await click(28, 3)
  expect(await shown(/Par de J\+/)).toBeDefined()
  // Distribuir, Trocar and Nova mão all sit on row 16 around x 16
  await click(16, 16)
  expect(await shown(/fichas/)).toBe('● 950 fichas')
  // the cards take no clicks while they turn over
  await click(4, 12)
  await ui.advance(1000)
  expect(await shown(/FICA/)).toBeUndefined()
  expect(await shown(/Escolha/)).toBeDefined()

  // the first card sits at x 2-6 on rows 11-13, its FICA tag on row 14
  await click(4, 12)
  expect(await shown(/FICA/)).toBeDefined()
  await click(4, 14)
  expect(await shown(/FICA/)).toBeUndefined()

  // the swapped cards turn over before the hand is paid
  await click(16, 16)
  expect(await shown(/Virando/)).toBeDefined()
  await ui.advance(4000)
  expect(await shown(/Nada dessa vez|aposta de volta|! \+\d/)).toBeDefined()
  expect(await shown(/Nova mão/)).toBeDefined()
  await ui.unmount()
})
