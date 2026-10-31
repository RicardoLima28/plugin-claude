# Cassino

Um mini cassino em pixel art para jogar no terminal com fichas fictícias, enquanto o Claude trabalha. Tem roleta (vermelho, preto ou verde), blackjack, caça-níquel e poker. Tudo funciona com o mouse e o saldo fica salvo entre as sessões.

A aposta sobe e desce com `+` e `-` (10, 25, 50, 100, 250, 500, 1.000, 2.500...) e nunca passa do seu saldo: o limite é o que você tem. O botão All in aposta o saldo inteiro em cada rodada até você clicar nele de novo ou mexer na aposta.

No poker, você recebe 5 cartas e fica com 2 (aparece FICA embaixo; clique de novo para trocar a escolha). Depois vem a mesa com 5 cartas, uma a uma, e vale a melhor mão de 5 entre as suas 2 e as da mesa. Ela paga pela tabela na mesa: par de valetes ou mais devolve a aposta, dois pares pagam 2x e o royal flush paga 250x.

## Como abrir: painel ao lado do chat

No Claude Code, digite `/cassino`. O cassino abre num painel do próprio Claude Code, ao lado da conversa, no Windows, no macOS e no Linux, em qualquer terminal, sem Python e sem janela extra.

Para o painel ficar ao lado do chat e aceitar cliques, o Claude Code precisa estar no modo tela cheia: rode `/tui fullscreen` uma vez. Com a janela do terminal estreita (menos de 110 colunas), o painel abre acima do prompt. Para fechar, clique em Sair ou aperte Ctrl+X X.

## Como abrir: fora do Claude Code

O jogo também existe como o arquivo `app/cassino.py`, que usa só a biblioteca padrão do Python 3.8 ou mais novo e roda no Windows, no macOS e no Linux:

```
python app/cassino.py --lado
```

No macOS, use `python3` no lugar de `python`.

Com `--lado`, o cassino abre num painel à direita nos terminais que deixam dividir a janela:

| Terminal | Como divide |
| --- | --- |
| Windows Terminal | `wt split-pane` (também pelo atalho Ctrl+Shift+K, veja abaixo) |
| iTerm2 | divide a janela com AppleScript |
| Terminal do macOS | encolhe a janela e abre outra colada à direita (não tem painel lado a lado) |
| tmux | `tmux split-window` |
| WezTerm | `wezterm cli split-pane` |
| kitty | `kitten @ launch` (precisa de `allow_remote_control yes`) |
| Zellij | `zellij run` |

No iTerm2 e no Terminal do macOS, a primeira vez o macOS pergunta se o terminal pode controlar a si mesmo (Automação). Responda OK; se negar, o cassino roda na própria janela.

Nos outros terminais (VS Code, Cursor, GNOME Terminal, cmd), ele roda na própria janela. Para tê-lo do lado, divida o terminal primeiro e rode o comando no painel novo. No VS Code e no Cursor, o atalho para dividir é Ctrl+Shift+5.

Sem `--lado`, ele sempre roda na janela atual.

### Um comando `cassino`

- **Windows:** crie um `cassino.cmd` numa pasta do PATH com
  `@"C:\caminho\python.exe" "C:\caminho\cassino\app\cassino.py" --lado %*`
- **macOS / Linux:** adicione ao `~/.bashrc` ou `~/.zshrc` a linha
  `alias cassino='python3 /caminho/cassino/app/cassino.py --lado'`

### Atalho no Windows Terminal

No `settings.json` do Windows Terminal, adicione uma entrada em `actions` e outra em `keybindings`:

```json
{ "command": { "action": "splitPane", "split": "right", "size": 0.32, "title": "Cassino",
  "commandline": "python \"C:\\caminho\\cassino\\app\\cassino.py\"" },
  "name": "Cassino", "id": "User.Cassino" }
```

```json
{ "id": "User.Cassino", "keys": "ctrl+shift+k" }
```

## Cores

O cassino usa cores de 24 bits quando o terminal tem suporte e 256 cores nos outros, como o Terminal do macOS ou o tmux sem truecolor. Para forçar, use `CASSINO_CORES=256` ou `CASSINO_CORES=24`.

## Saldo

No painel, o saldo fica guardado pelo próprio Claude Code. No `app/cassino.py`, ele fica em `~/.claude/cassino-save.json`; para recomeçar, apague esse arquivo. Os dois saldos são separados.

## Plugin do Claude Code

A pasta também é um plugin do Claude Code. Ele cria o comando `/cassino`, que abre o painel: `hooks/register.tsx` abre o painel e guarda o saldo, e `hooks/mesa.tsx` desenha o jogo.
