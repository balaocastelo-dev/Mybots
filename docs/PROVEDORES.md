# A roleta de cotas grátis (30/10/2026)

O cliente liga as chaves dele no primeiro dia e o MyBots gira entre os provedores até
cada cota acabar, escolhendo o melhor para cada tarefa. O objetivo é duplo: **não parar**
e **não desperdiçar**.

> Números conferidos em 30/10/2026. Cota grátis muda de mês para mês — e some sem aviso.
> O sistema tem de descobrir isso sozinho, não pela reclamação do cliente.

## 1. Onde há cota grátis hoje (texto)

| provedor | o que dá de graça | serve bem para | pegadinha |
|---|---|---|---|
| **Google AI Studio** (Gemini Flash) | ~1.500 requisições/dia, sem cartão | contexto grande, documento inteiro, multimodal | o Pro é pago; "grátis" é por modelo, não por conta |
| **Groq** | ~30 req/min, ~1.000/dia | resposta curta e rápida, voz, status | o catálogo troca de modelo sem avisar |
| **Cerebras** | ~1M tokens/dia, o mais rápido de todos | lote, texto em volume | contexto curto (~8K) no grátis |
| **Mistral** (tier Experiment) | ~1B tokens/mês — a maior cota da lista | volume | **exige aceitar que seus dados treinem o modelo** |
| **Cloudflare Workers AI** | 10.000 "neurons"/dia | texto e imagem na mesma conta | neuron não é requisição; imagem come muito mais |
| **OpenRouter** | os modelos marcados `:free` | variedade, uma chave só | o que é `:free` hoje pode não ser amanhã |
| **OpenCode Zen** | os modelos grátis que já usamos | agente e código | "grátis por tempo limitado", declarado |
| **Nous Portal** | modelos grátis com ferramentas | agente | catálogo pequeno |
| NVIDIA NIM · GitHub Models · Cohere · Together · HuggingFace | créditos pequenos ou uso não-comercial | avaliar, não produzir | **não servem de base para cliente** |

Quase todos falam **OpenAI Chat Completions**, então entram no engine `direct` pelo
`openaiCompat.ts` que já existe — trocar de provedor é trocar `baseURL` e nome do modelo.

## 2. Como a roleta precisa funcionar

1. **Contar antes de chamar, não descobrir batendo.** Cada provedor tem três cotas
   diferentes (req/min, req/dia, tokens/dia ou mês) e elas contam separado, por chave e
   às vezes por modelo. O Hub mantém esse placar. Tomar 429 para então trocar é
   desperdício e deixa o bot parado no meio de uma frase.
2. **Gastar primeiro o que expira.** Cota diária zera à meia-noite do fuso do provedor —
   o que sobrar dela virou pó. A cota mensal (Mistral) é poupança: só depois.
3. **Escolher pela tarefa, não pelo "melhor modelo".**
   | tarefa | para onde vai |
   |---|---|
   | resposta curta, status, voz | Groq / Cerebras (latência) |
   | documento grande, planilha, contrato | Gemini Flash (contexto) |
   | código, uso de ferramentas, agente | OpenCode Zen / Nous |
   | texto em volume, resumo em lote | Cerebras / Mistral |
   | **nada disponível** | **Ollama local** |
4. **O piso local é o que garante o "não parar".** Toda nuvem grátis acaba. A única
   capacidade sem cota é a máquina do cliente: um modelo pequeno no Ollama atende o
   básico quando a roleta inteira estiver vazia. Sem esse piso, a roleta um dia para.
5. **Modelo some sem aviso.** Caso documentado: em 31/05/2026 um provedor apagou os
   modelos grátis e o código de quem dependia deles passou a tomar 404 em silêncio. Logo:
   conferir o catálogo do provedor na partida e de hora em hora, nunca fixar um nome de
   modelo sem alternativa, e avisar o chefe quando um sumir.
6. **Termos antes de economia.** O tier de 1B tokens/mês da Mistral exige opt-in para que
   os dados treinem o modelo. Conversa de cliente de PME indo treinar modelo de terceiro
   é problema de contrato e de LGPD — tem que ser escolha explícita do dono, com o aviso
   na tela, nunca o padrão.
7. **Quando tudo falha, falar.** Cota esgotada não é erro de bot: é recado para o chefe,
   com o que acabou, quando volta, e o que dá para fazer enquanto isso.

## 3. Foto e vídeo

**"Grátis sem cota" não existe na nuvem.** O que existe é grátis *com* cota — e sem cota
só na máquina do cliente. A escada que todo bot nasce sabendo:

| ordem | onde | custo | observação |
|---|---|---|---|
| 1 | **ComfyUI local** (GPU do cliente) | sem cota, sem limite | imagem e vídeo; é o único sem teto |
| 2 | **Cloudflare Workers AI** (FLUX.1 Schnell) | dentro dos 10.000 neurons/dia | a cota recorrente mais confiável para imagem |
| 3 | **Google Gemini** (imagem) | cota diária pequena | melhor aderência ao pedido e edição de imagem |
| 4 | **Pollinations.ai** | sem chave, sem cadastro | Flux e também vídeo (Seedance, Veo em alfa, Wan-Fast); limita ~1 req/15s anônimo |

Vídeo em nuvem grátis é alfa e limitado: serve para rascunho, não para peça de cliente.
Vídeo de verdade, sem fila e sem cota, é o ComfyUI na GPU — que já existe aqui.

**Uso comercial:** conferir os termos de cada um antes de pôr arte gerada no ar para
cliente. O Pollinations é conveniência, não dependência de produção.

## 4. O que falta construir
1. Tela de chaves no primeiro dia: uma linha por provedor, com teste que confirma a chave.
2. Tabela `cotas` no Hub (provedor, chave, janela, usado, limite, quando zera) e o placar.
3. O roteador: escolhe por tarefa + cota restante + latência, com o Ollama como piso.
4. Verificação de catálogo na partida e de hora em hora, com aviso quando um modelo some.
5. Ferramentas `gerar_imagem` e `gerar_video` com a escada acima, local primeiro.
6. Painel do dono: quanto de cota grátis foi usado hoje, por provedor — e quanto isso
   economizou. É o número que justifica a mensalidade.
