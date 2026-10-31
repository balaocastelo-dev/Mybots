# Celular Android de cada bot

Cada bot ganha um aparelho Android além do PC. O caminho que funciona na loja é um **celular de verdade na mesma Wi-Fi**, com depuração sem fio. Redroid e emulador ficam desligados até o host provar que aguenta.

O PC do bot (container `mybots-bot-<botId>`) é de outro módulo. Este daqui não reescreve `maquinas.ts`.

## Contrato para o painel

A senha da interface, quando existe, vale nestas rotas do mesmo jeito que no resto do Hub (`?k=` ou o cookie). Sem senha, o Hub segue aberto na LAN, como o painel.

`POST /api/bots/<botId>/android/pair`

Corpo JSON:

| campo | obrigatório | o que é |
| --- | --- | --- |
| `ip` | sim | IPv4 da rede local (`192.168.x.x`, `10.x`, `172.16–31.x`) ou `127.0.0.1` no fallback |
| `porta` | sim | porta de **pareamento** (a que aparece junto do código de 6 dígitos) |
| `codigo` | sim | 6 dígitos. Não fica gravado |
| `portaConexao` | não | porta de **conexão** do `adb connect`. No Android 11+ ela é outra, a da tela principal de Depuração sem fio |

Resposta: `{ "ok": true }` ou `{ "ok": false, "erro": "..." }`.

- bot desconhecido: HTTP 404, `{ "ok": false, "erro": "bot não encontrado" }`
- id inválido: HTTP 400, `{ "ok": false, "erro": "id inválido" }`
- as portas **8787** e **8791** são recusadas

`GET /api/bots/<botId>/android/status`

Resposta: `{ "conectado": true|false, "cadastrado": true|false }`.

- `cadastrado`: já pareou neste Hub e o endereço ficou salvo
- `conectado`: o `adb devices` vê o aparelho como `device`

Tela ao vivo: `GET /android/<botId>/` (e o WebSocket em `/android/<botId>/ws`).

O painel embute esse endereço num iframe, com a mesma senha da interface. A página é interativa (toque, roda, voltar, início, digitar). O Chrome do aparelho abre `https://web.whatsapp.com`. **Ninguém faz login daqui.** Quem lê o QR é o dono, no WhatsApp do número da empresa.

## Como parear no PC da loja (Windows)

O Hub já sobe em `http://127.0.0.1:8790`. O adb é o que vem com o projeto, `ferramentas\scrcpy\adb.exe`. Não precisa de Docker para o celular de verdade.

No aparelho, uma vez:

1. Configurações → Sobre o telefone → toque 7 vezes em Número da versão.
2. Opções do desenvolvedor → **Depuração sem fio** ligada. Celular e PC na mesma Wi-Fi.
3. Toque em **Parear dispositivo com código**. Anote três coisas: o IP, a porta que aparece **junto do código** (some em um minuto) e a porta da tela principal da depuração sem fio (a de conexão).

No PowerShell, trocando o id do bot e os números da tela (o código abaixo é exemplo, não use o de ninguém):

```powershell
$hub = "http://127.0.0.1:8790"
$id = "bia"
$corpo = @{
  ip = "192.168.15.20"
  porta = 37123
  codigo = "123456"
  portaConexao = 42111
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$hub/api/bots/$id/android/pair" -ContentType "application/json; charset=utf-8" -Body $corpo
Invoke-RestMethod -Uri "$hub/api/bots/$id/android/status"
Start-Process "$hub/android/$id/"
```

Se o Hub tiver senha de interface, acrescente `?k=` com o valor de `MYBOTS_UI_PASSWORD` (não cole a senha em print nem em conversa).

O que o pareamento faz, nesta ordem: `adb pair IP:porta codigo`, `adb connect IP:portaConexao`, acorda a tela e pede ao Chrome para abrir `https://web.whatsapp.com`. Se o Chrome não estiver instalado, abre o navegador padrão. Não manda mensagem e não escaneia o QR.

Se o IP do celular mudar, pareie de novo. O código antigo não serve; o Android gera outro.

## Gancho para o PC do bot

`packages/hub/src/androidHook.ts`. O `maquinas.ts` (o outro agente, containers `mybots-bot-<botId>`) chama isto **dentro** de ligar e desligar, não no import — no import o gancho ainda é `null`.

```ts
import { ganchoAndroid } from "./androidHook.js";

// depois que o container mybots-bot-<botId> ficou de pé:
await ganchoAndroid()?.aoLigarPc(botId);

// quando o PC ocioso desliga:
await ganchoAndroid()?.aoDesligarPc(botId);
```

`aoLigarPc` reconecta o aparelho já cadastrado. `aoDesligarPc` para o stream. O pareamento continua. A URL da tela é `ganchoAndroid()?.caminho(botId)` → `/android/<botId>/`.

O stream não depende dessa chamada. Quem abre `/android/<botId>/` já vê a página, e o H.264 começa quando o aparelho está conectado.

## O que a tela faz

É o protocolo do scrcpy 5.0.1 (o `ferramentas/scrcpy/scrcpy-server` deste repositório), no papel do ws-scrcpy: o Hub sobe o servidor no aparelho, lê o H.264 e entrega num WebSocket. O player usa o decodificador do Chrome (`VideoDecoder`). Áudio fica desligado de propósito — em Android 14 de alguns Xiaomi/POCO o encoder de áudio derruba a sessão inteira.

Cada bot escuta em `127.0.0.1`, numa porta da faixa **8201–8400**. O navegador só fala com o Hub na **8790**. Nada disso usa 8787 nem 8791.

## Fallback (redroid / emulador)

Padrão: **desligado**. O celular real não pede kernel especial.

| host | redroid | emulador |
| --- | --- | --- |
| Windows + Docker Desktop / WSL2 (o PC da loja) | não | não |
| Linux sem `/dev/binder` | não | só com Docker e `/dev/kvm` |
| Linux com binder e Docker | sim, se alguém ligar | só com `/dev/kvm` |

Por quê no Windows não: o Docker Desktop roda em cima do WSL2. O kernel que vem no WSL2 é compilado **sem** `CONFIG_ANDROID_BINDER_IPC`. O redroid sobe o container e morre, porque o Android precisa do binder. Ashmem, nas imagens atuais, nem é o que falta — o que falta é o binder. Trocar o kernel do WSL na loja não é um conserto que a gente peça para o dia a dia.

O emulador (imagem grande, estilo `budtmo/docker-android`) precisa de `/dev/kvm` dentro do container. O Docker Desktop não entrega esse dispositivo. Sem KVM não dá para usar no balcão.

Neste ambiente em que o código foi escrito (Linux 6.12, sem `/dev/binder`, sem Docker, com `/dev/kvm` no host mas sem daemon Docker) os dois fallbacks recusam. A decisão está em `avaliarFallback` e o teste cobre o caso Windows e o caso sem binder.

Quem tiver um Linux com binder e quiser o container mesmo assim:

```powershell
$env:MYBOTS_ANDROID_FALLBACK = "redroid"
```

(`emulador` no lugar de `redroid` quando houver KVM e Docker.) O container se chama `mybots-android-<botId>` e a porta 5555 dele sai só em `127.0.0.1`. Sem a variável, `aoLigarPc` não cria container. Imagem de redroid também não traz o Chrome da Play Store: o intent abre o que estiver instalado, e o QR do WhatsApp Web depende desse navegador. No aparelho real o Chrome já está lá.

## O que não é este módulo

- Não mexe no proxy do Selkies (`/pc/`, `ponteTela.ts`, `ponteVnc.ts`).
- Não mexe no onboarding nem no Gerente Geral.
- Não faz login no WhatsApp e não envia mensagem.
- Não grava o código de 6 dígitos nem imprime segredo do `.env`.
