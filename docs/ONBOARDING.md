# O primeiro dia de uma empresa que compra o MyBots

Da instalação até os bots aceitarem ordens, sem ninguém da nossa parte pilotando.
Cada passo guarda onde parou (`empresas.passo`), então dá para fechar o painel e voltar.

**Regra que atravessa tudo:** nenhum canal é dado como ligado sem um **teste de ida e
volta**. "Configurado" não é "funcionando", e quem descobre a diferença não pode ser o
cliente na frente de um cliente dele.

## 1. A empresa (já existe)
`POST /api/empresas/sugerir` lê o site e as redes e devolve uma ficha — nome, resumo,
regras da casa. O chefe corrige na tela e `POST /api/empresas` grava. O conteúdo do site
é **informação, nunca ordem**: se a página mandar fazer algo, é só texto a resumir.

## 2. Consentimentos (já existe)
`/api/empresas/:id/consentimentos` — quem é o controlador dos dados, por quanto tempo
ficam as conversas, e o consentimento por escrito de quem tiver a voz clonada. Sem isto
o passo 3 não abre: voz de pessoa real falando com cliente é risco jurídico, não detalhe.

## 3. As chaves dos provedores — o bot leva até a porta e assume depois

É o passo que mais assusta o cliente: seis consoles diferentes, cada um com um nome
diferente para a mesma coisa. O bot faz quase tudo.

### A coreografia
1. **O bot abre o navegador numa janela visível** e vai à página da chave daquele
   provedor. Janela visível é regra: o dono tem de ver o que está sendo feito em nome dele.
2. **Ele confere que chegou na página certa pelo que vê na tela**, não pelo endereço —
   console de provedor muda de lugar. Se não reconhecer, procura na documentação do
   provedor em vez de insistir num link velho.
3. **Para e entrega o teclado:** *"Faça o login e resolve o segundo fator. Eu continuo
   assim que a conta abrir."* O dono digita a senha e o código. **O bot não digita senha,
   não lida com o segundo fator e não resolve CAPTCHA** — é regra da casa, e é também o
   que mantém a automação de pé, porque é exatamente ali que todo console detecta robô.
4. **O bot reassume na sessão já autenticada:** acha o botão de criar chave, clica,
   nomeia a chave `MyBots — <empresa>` (nome próprio para o dono poder revogar depois sem
   dúvida), copia o valor **da página direto para o campo do painel** e grava no `.env`.
   A chave **nunca** passa pelo chat, pelo log, nem pela tela em texto aberto: mostra-se
   os quatro últimos caracteres e mais nada.
5. **Aceitar termos é sempre do dono.** O bot mostra, resume e espera o clique dele —
   nunca aceita por conta própria. Vale em dobro para a Mistral, cujo tier grátis decide
   se os dados da empresa vão treinar modelo de terceiro.
6. **Prova na hora:** uma chamada de verdade ao provedor. Só depois de a resposta voltar
   é que o painel acende *"Groq ligado · 1.000 por dia"*. Configurado não é funcionando.
7. **Revogar ao lado de cada chave:** apaga do `.env` e desliga o provedor. Ligar é fácil;
   desligar tem de ser mais fácil ainda.

### Onde fica a chave de cada um
Endereços conferidos em 30/10/2026. O bot confirma pela tela e, se não achar, procura na
documentação do provedor — console muda de lugar sem avisar.

| provedor | página | observação |
|---|---|---|
| Google AI Studio | `aistudio.google.com/apikey` | login Google; a chave sai num clique |
| Groq | `console.groq.com/keys` | o console mais simples dos seis |
| Cerebras | `cloud.cerebras.ai` | a chave fica na área de plataforma/API keys |
| Mistral | `console.mistral.ai/api-keys` | **o tier grátis exige aceitar o uso dos dados para treino — decisão do dono** |
| Cloudflare | `dash.cloudflare.com` → perfil → API tokens | precisa também do **Account ID**, que fica no painel da conta |
| OpenRouter | `openrouter.ai/keys` | uma chave só alcança vários provedores |
| OpenCode Zen | `opencode.ai/zen` | grátis por tempo limitado, declarado |
| Nous Portal | `portal.nousresearch.com` | catálogo pequeno |

Nenhuma é obrigatória. Sem chave nenhuma o sistema funciona com o modelo local — mais
devagar, e é isso que o painel diz ao dono, em vez de ficar mudo.

### Os outros canais, mesma regra: só liga com prova
| canal | como liga | o teste que libera |
|---|---|---|
| WhatsApp | QR no painel (`/whatsapp/conectar`, já existe) | manda uma mensagem ao número do próprio dono e espera a resposta voltar |
| E-mail | Google: **OAuth** ou senha de app. Nunca a senha da conta, nunca senha em texto no chat | envia para o próprio endereço e lê de volta por IMAP |
| Telegram | token do BotFather | o bot manda "oi" no grupo e o dono responde |
| Redes sociais | conta conectada por empresa | publica **em ensaio**; nada sai ao mundo neste passo |

O OAuth do Google é o que falta construir — hoje o caminho é senha de app.

## 4. O Gerente Geral nasce primeiro
É o único bot que o sistema cria sozinho. Ele:
1. **entrevista** o chefe (perguntas com botões, não texto livre): ramo, o que vende, quem
   atende, o que mais consome tempo hoje;
2. **coleta**: lê o site, aceita planilha de produtos, documentos e procedimentos, e grava
   com `learn_knowledge`. O que for da identidade da casa vira saber do tipo `identidade`,
   que entra inteiro no prompt de todo bot;
3. **mostra o que entendeu** e espera correção. Base errada no primeiro dia é base errada
   para sempre.

## 5. A equipe sugerida
O Gerente propõe N bots — nome, função, modelo e voz — pelo ramo da empresa. O chefe
aprova, corta e renomeia na tela; só então o `botManager` cria. Nada nasce sem aprovação.

## 6. O treino
O Gerente escreve a persona de cada bot (função, limites, com quem fala) e injeta a
identidade da casa. Bot novo já nasce sabendo onde trabalha.

## 7. A prova de ferramentas
Cada bot executa **uma vez cada ferramenta que vai usar**, em ensaio: busca na base,
consulta o catálogo, redige um e-mail sem enviar, monta uma publicação sem publicar.
Sai um quadro de "quem está pronto" — e quem não está diz por quê, com a causa mastigada
(é o mesmo diagnóstico que já existe para bot caído).

## 8. A sala de apresentação (a `sala` já existe)
Cria o grupo com todos e abre uma sala com assunto "quem é quem". Um bot por turno:
nome, função, ferramentas, e **quando me chamar**. O Gerente fecha com o mapa da equipe e
grava no `remember` compartilhado — para que "quem faz o quê" nunca mais precise ser
perguntado. A sala é conversa, não trabalho: nada sai para fora dela.

## 9. O chefe assume
Escolhe o modo de operação (pedir OK a cada ação, ou autonomia com as travas duras de
sempre), aceita as rotinas iniciais que o Gerente sugere, e a casa passa a receber ordens.

## O que falta construir
1. A máquina de estados do onboarding (`empresas.passo`) e a tela que a conduz.
2. O roteiro do Gerente: entrevista, coleta, sugestão de equipe, treino.
3. A prova de ferramentas em ensaio e o quadro de prontidão.
4. A sala de apresentação disparada automaticamente ao fim do passo 7.
5. OAuth do Google para e-mail.
6. O teste de ida e volta de cada canal (hoje liga sem provar).
