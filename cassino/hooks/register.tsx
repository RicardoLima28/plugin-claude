import type { Register } from 'claude-code'

// The casino itself is app/cassino.py, run in the person's own terminal: a
// session cannot open a pane in their window, so the command points the way.
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cassino',
      description: 'Como abrir o mini cassino ao lado do terminal',
    })

    return next(e)
  })

  on('command.run', { command: 'cassino' }, async () => ({
    text: 'Digite cassino em qualquer terminal (no Windows Terminal, também Ctrl+Shift+K): ele abre num painel à direita quando o terminal deixa, senão na própria janela. Tudo no mouse; para fechar, clique em Sair.',
  }))
}
