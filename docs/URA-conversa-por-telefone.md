# URA — conversa por telefone (31/10/2026)

Tudo que se sabe hoje sobre a URA do Balão falando com gente por telefone, com as causas
de cada defeito encontrado. Escrito para quem pegar isto daqui a três meses e precisar
mexer sem refazer a investigação.

**Estado: funcionando.** O bot liga, atende, ouve, entende, pensa e responde em português,
com voz natural, em cerca de 1 segundo por turno. Validado em ligações reais para
19 98451-5960 e 19 98751-0267.

---

## 1. A pilha, peça por peça

```
PortSIP (bala.pbx.telefoniafacil.com.br)   ← a operadora, ramal 2055
        ↕ SIP/RTP
Asterisk  (dentro do WSL Ubuntu do i9)     ← tronco telefoniafacil-out
        ↕ AMI 5038 (originar)  +  AudioSocket (áudio ao vivo)
scripts/ura-conversa.mjs  (Node, Windows, porta 8091)
        ├─ ouvir   → Whisper da Groq (whisper-large-v3-turbo)
        ├─ pensar  → Groq (qwen/qwen3.8-27b), reserva Z.ai glm-4.5-flash
        └─ falar   → TTS do Hub do MyBots (Edge pt-BR) → ffmpeg → 8 kHz
```

**Formato da linha:** PCM 16 bits, 8 kHz, mono, quadros de 20 ms (320 bytes).

**O tronco está registrado e saudável:** `telefoniafacil-out/2055`, contato ativo, ~125 ms
de latência. Conferido por `pjsip show registrations` / `pjsip show endpoints`.

---

## 2. Como disparar uma ligação

Pelo AMI, em `127.0.0.1:5038`, usuário `uraadmin` (senha no `.env` do MyBots como
`URA_AMI_SECRET`; a origem dela é o `manager.conf` da URA-Balão).

```
Action: Originate
Channel: PJSIP/55DDDNUMERO@telefoniafacil-out
Application: AudioSocket
Data: <uuid>,172.24.32.1:8091
CallerID: 1932551661
Timeout: 30000
Async: true
```

**O número TEM que ir em E.164, com o 55 na frente.** Sem o 55 o Asterisk aceita a ordem,
responde `Success` e **a chamada nunca toca** — o pior tipo de erro, o que mente. A própria
URA-Balão já fazia essa normalização (`normalizePhone` em `backend/clients.js`); foi de lá
que veio a descoberta.

`172.24.32.1` é o endereço do Windows visto de dentro do WSL. Confirmado alcançável.

Para só tocar um áudio pronto, sem conversa: `Application: Playback`, `Data: /tmp/arquivo`
(sem extensão), com o `.wav` copiado para `/tmp` dentro do WSL em 8 kHz mono PCM16.

---

## 3. Os números medidos (não estimados)

| etapa | tempo |
|---|---|
| ouvir (Whisper Groq) | 300–460 ms |
| pensar (Groq qwen3.8-27b) | 230–320 ms |
| primeira sílaba sair (TTS em fluxo) | ~300–400 ms |
| espera de silêncio antes de começar | 320 ms (configurável) |

**Total por turno: ~1 segundo.** Começou em 5,7 s.

---

## 4. Os cinco defeitos encontrados, e a causa de cada um

Esta é a parte que vale mais que o resto do documento.

### 4.1 Quatro segundos escondidos num nome de modelo
`llama-3.3-70b-versatile` **não existe mais na Groq**. A chamada era recusada em 65 ms, o
código caía no reserva (Z.ai) **sem dizer nada**, e o Z.ai levava 4,3 s. No log aparecia
`pensar=4270ms`, o que parecia problema de desempenho.

**Lição:** reserva silencioso esconde defeito e o disfarça de lentidão. Hoje a queda para o
reserva é registrada no log com o motivo.

Modelos que a conta realmente tem, cronometrados: `qwen/qwen3.8-27b` **187 ms**,
`openai/gpt-oss-120b` 308 ms, `openai/gpt-oss-20b` 351 ms.

### 4.2 A voz engasgando — era relógio, não velocidade
Mandar um quadro e dormir 20 ms parece certo, mas o relógio do JavaScript acorda em 22, 25,
às vezes 30 ms. Cada atraso vira um buraco no áudio. Resolvido com **um relógio único** que
despeja da fila a cada 20 ms e manda silêncio quando a fila está vazia.

### 4.3 A chamada caindo logo depois de atender — canal mudo é canal morto
Entre atender e a primeira sílaba há ~3 s de síntese. Nesse intervalo nada era enviado, e o
Asterisk derrubava. Resolvido com **silêncio ativo**: quadros zerados a 50/s enquanto o bot
pensa. Não se ouve, e a linha fica viva.

### 4.4 O bot se cortando sozinho — eco lido como interrupção
Parte da voz do próprio bot volta pela linha. O detector de interrupção via energia e
concluía "a pessoa falou". Resultado: ele começava a falar e calava, dezenas de vezes
(`interrompido pela pessoa` repetido no log), com a chamada de pé e nenhum som.

Tentei consertar subindo o limiar e exigindo voz sustentada. **Não resolveu e não ia
resolver:** para um medidor de energia, eco e voz humana são o mesmo sinal. Distinguir exige
**cancelamento de eco** de verdade — comparar o que saiu com o que voltou.

**Hoje a interrupção está DESLIGADA** (`URA_INTERROMPER=1` religa, para testes). Falar
inteiro vale mais que poder interromper.

### 4.5 O turno de 10 segundos
Ruído de fundo segurava o "ainda falando" indefinidamente. Hoje há trava: passou de 7 s de
fala contínua, fecha e manda.

### Bônus: a ferramenta de teste também mente
`Invoke-WebRequest` do PowerShell engasga ao receber áudio binário e devolve *"Referência de
objeto não definida"* — parece erro do servidor. O status real era **200**. Quase virou
diagnóstico errado. Erro genérico merece segunda conferência antes de virar conclusão.

---

## 5. Configuração

No `.env` do MyBots (`C:\Users\user\Desktop\MyBots-Base\.env`):

| chave | para quê |
|---|---|
| `URA_AMI_HOST` / `URA_AMI_USER` / `URA_AMI_SECRET` | acesso ao Asterisk |
| `URA_TRONCO` / `URA_CONTEXTO` | `telefoniafacil-out` / `ura-outbound` |
| `GROQ_API_KEY` | ouvir **e** pensar |
| `ZAI_API_KEY` | reserva do pensar |
| `URA_VOZ` / `URA_VEL` | voz e velocidade (padrão: Thalita, 1,05x) |
| `URA_SILENCIO` | ms de silêncio que encerram a fala (padrão 320) |
| `URA_INTERROMPER` | `1` religa a interrupção (ver 4.4) |

**A velocidade importa mais do que parece.** O Hub fala a 1,4x por padrão — bom no painel,
apressado e robótico ao telefone. 1,05x é metade do "parece gente".

**Porta:** o servidor sobe na **8091**. A 8090 está ocupada pelo `voice-agent` da própria
URA-Balão.

**Subir:** `set URA_PORTA=8091 && node scripts/ura-conversa.mjs`
**Log:** `dados/ura-conversa.log` — cada turno com o que foi dito, o que foi respondido e os tempos.

---

## 6. Regras duras

1. **O bot se identifica como robô na primeira fala.** Cliente tem o direito de saber.
2. **Nunca inventar.** Sem preço, prazo, estoque ou motivo: diz que não sabe e que vai
   verificar com uma pessoa. Não chutar causa técnica — palpite com cliente vira promessa.
3. **Ligar para cliente pede o OK do chefe.** Ligar para o próprio dono é teste.
4. **Uma frase curta sempre que possível**, no máximo duas. Sem lista, markdown ou emoji:
   nada disso se fala em voz alta.

---

## 7. Pendências

- **Cancelamento de eco**, para a interrupção voltar a funcionar (ver 4.4).
- **Transcrever enquanto a pessoa fala**, em vez de esperar o fim — é o último pedaço grande
  de latência.
- **Tirar do WSL do i9.** Hoje a URA morre se o PC desligar. O destino é o ProLiant ML30
  Gen9 — **depois** de resolver a Fan 2 ausente e a falha recorrente do regulador P12V
  (ver `MYBOTS-proliant.md` se existir, ou o log IML da iLO em 192.168.15.11).
- **Amarrar ao MyBots como ferramenta `ligar`**, com cartão de aprovação, para os bots
  discarem por conta própria em vez de alguém chamar o AMI na mão.
- **Transcrição erra em linha de 8 kHz** (apareceu "que legalmente explana"). Passar o
  vocabulário da loja como contexto para o Whisper deve melhorar.
- **Voz clonada**: o `voz_clone.py` (porta 8770) tem perfis do Thiago e do João, e o Hub já
  sabe usar (`clone:thiago`). Exige consentimento por escrito de quem emprestou a voz.
