import { expect, test } from 'claude-code/testing'

test('/cassino points to the Windows Terminal shortcut', async ($, on) => {
  on('command.register', () => ({ value: { command: 'cassino' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const out = await $.command.run({
    command: 'cassino',
    args: '',
    origin: { kind: 'person' },
    presentation: { isFullscreen: false, columns: 120 },
  } as never)
  expect(JSON.stringify(out)).toContain('Ctrl+Shift+K')
})
