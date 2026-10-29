# plugin-claude

Marketplace de plugins do Claude Code. Por enquanto tem um plugin, o **cassino**: um mini cassino em pixel art para jogar no terminal com fichas fictícias enquanto o Claude trabalha. Tem roleta, blackjack e caça-níquel, tudo jogado com o mouse.

## Instalar

No Claude Code:

```
/plugin marketplace add RicardoLima28/plugin-claude
/plugin install cassino@plugin-claude
```

Depois disso, digite `/cassino`: o jogo abre num painel ao lado do chat, no Windows, no macOS e no Linux. Para o painel ficar do lado e aceitar cliques, rode `/tui fullscreen` uma vez.

## Jogar sem o plugin

O jogo é um único arquivo Python, que usa só a biblioteca padrão (Python 3.8 ou mais novo) e roda no Windows, no macOS e no Linux:

```
git clone https://github.com/RicardoLima28/plugin-claude
python plugin-claude/cassino/app/cassino.py --lado
```

No macOS, use `python3` no lugar de `python`.

Com `--lado`, ele abre num painel à direita no Windows Terminal, iTerm2, Terminal do macOS, tmux, WezTerm, kitty e Zellij. Nos outros terminais, roda na própria janela.

## Estrutura

```
.claude-plugin/marketplace.json   lista os plugins do marketplace
cassino/
  .claude-plugin/plugin.json      manifesto do plugin
  app/cassino.py                  o jogo para rodar fora do Claude Code
  hooks/register.tsx              o comando /cassino e o painel
  hooks/mesa.tsx                  o jogo desenhado no painel
  tests/cassino.test.ts           testes do comando e do painel
  README.md                       atalhos, cores e saldo
```

Os detalhes do jogo (atalho no Windows Terminal, comando `cassino` no PATH, cores e onde o saldo fica salvo) estão em [cassino/README.md](cassino/README.md).
