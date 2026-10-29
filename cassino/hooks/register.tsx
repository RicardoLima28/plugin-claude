import type { Register } from 'claude-code'

// The casino plays in a pane of Claude Code's own, beside the chat: mesa.tsx
// draws the game and posts the balance here, which keeps it across sessions.
const PANE = 'cassino'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cassino',
      description: 'Abre o mini cassino num painel ao lado do chat',
    })

    return next(e)
  })

  on('command.run', { command: 'cassino' }, async ($, e) => {
    await $.ui.open({ id: PANE, title: 'Cassino', columns: 34 })

    return {
      text: e.presentation?.isFullscreen
        ? 'Cassino aberto ao lado do chat. Tudo no mouse; para fechar, clique em Sair.'
        : 'Cassino aberto acima do prompt. Para tê-lo ao lado do chat e jogar com o mouse, rode /tui fullscreen e depois /cassino de novo.',
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    if (!('Client' in els)) {
      const { Text } = els
      return <Text dimColor>O cassino abre no terminal ou no app desktop.</Text>
    }
    const { Client } = els

    return <Client key="mesa" module="./mesa.tsx" props={{ save: (await $.store.get('save')) ?? {} }} height={28} width="100%" />
  })

  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const data = e.data as { save?: unknown; quit?: boolean }
    if (data.save) await $.store.set('save', data.save)
    if (data.quit) await $.ui.close({ id: PANE })

    return {}
  })
}
