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
    text: 'Rode cassino/app/cassino.py --lado com python (python3 no Mac), ou o comando cassino se você criou o alias (no Windows Terminal, também Ctrl+Shift+K): ele abre à direita no Windows Terminal, iTerm2, Terminal do macOS, tmux, WezTerm, kitty e Zellij, e na própria janela nos outros. Tudo no mouse; para fechar, clique em Sair.',
  }))
}
