# Banco de almas

Um bot novo pode nascer com persona, skills e servidores MCP já escolhidos. O catálogo mora neste pacote. A interface mostra o seletor **Nascer com alma** ao criar o bot. O Hub grava a persona, copia as skills para o workspace e deixa o `alma-mcp.json` ao lado. Segredo não entra no manifesto: só o id do item no cofre.

Atualizar um pin é pull request. Não existe `latest`.

## O que tem aqui

- `allowlist.json` — skills e MCPs permitidos, cada um com commit, versão npm + integridade, ou sha256 de contrato.
- `almas/alma-*.json` — uma alma: persona em português, `skills`, `mcps`, permissões e ids de cofre.
- `vendor/` — cópia dos arquivos pinados, para o bot nascer sem baixar nada na hora.
- `src/adaptadores/corretorDoFuturo.ts` — contrato provisório do app do dono. Ver as perguntas em aberto abaixo.
- `scripts/atualizar-checksums.mjs` — recalcula os sha256 depois que você troca um arquivo pinado.

Ações que mudam o mundo (`enviarMensagens`, `gravarDados`, `gastarDinheiro`, `apagar`, `publicar`) só podem ser `confirma` ou `nao`. O bot não nasce com elas ligadas. Na criação, a pessoa marca a confirmação; na hora de agir, pede de novo.

O complemento **Bling** (`https://mcp.bling.com.br/mcp`) fica desmarcado. O financeiro da loja usa o MCP `balao-sistema`, o ERP da própria Balão, não o Bling.

O atendente usa o MCP oficial da Meta (`https://mcp.facebook.com/whatsapp_business_tools`). WhatsApp Web, Baileys, whatsapp-web.js e `lharries/whatsapp-mcp` estão na lista proibida e não nascem ligados.

## Como adicionar uma alma

1. Escolha skills e MCPs que já estão na `allowlist.json`. Se faltar um, primeiro pinne o pacote (passo seguinte). Não escreva URL solta dentro da alma.
2. Crie `almas/alma-meu-bot.json`:

```json
{
  "id": "meu-bot",
  "nome": "Meu bot",
  "avatar": "🤖",
  "funcao": "O que ele faz, numa linha",
  "resumo": "Frase do cartão no seletor.",
  "persona": ["# Meu bot", "", "Você fala português..."],
  "skills": ["casa.professor-ingles"],
  "mcps": [],
  "permissoes": {
    "rede": "nao",
    "enviarMensagens": "nao",
    "gravarDados": "nao",
    "gastarDinheiro": "nao",
    "apagar": "nao",
    "publicar": "nao"
  },
  "segredos": []
}
```

`persona` é uma lista de linhas. Segredo, se precisar, é só `{ "cofreId": "area.item", "uso": "para que serve", "env": "NOME_DA_VARIAVEL" }`. Sem valor.

3. Rode `node --import tsx tests/alma.test.ts`. O teste recusa `latest`, checksum errado, Bling ligado sozinho, WhatsApp Web e permissão destrutiva em `sim`.

## Como pinar um pacote novo

Skill ou MCP de fora:

- Repositório git: grave o commit SHA completo (não o nome do branch) e copie para `vendor/` só os arquivos que o bot precisa. Anote o caminho em `pastaVendor`.
- Pacote npm: versão exata e o `dist.integrity` (`sha512-...` do `npm view pacote@versao dist.integrity`). O comando usa `@versao`, nunca `@latest`.
- Servidor hospedado sem código (Meta, Bling): URL exata e um JSON em `contratos/` com o que foi conferido (transporte, OAuth, data). O sha256 desse JSON é o pin.

Depois:

```bash
node packages/soul-bank/scripts/atualizar-checksums.mjs
node --import tsx tests/alma.test.ts
```

O script preenche `arquivos[].sha256` e `contratoSha256`. Ele não mexe no commit, na versão nem no checksum de binário que você escreveu à mão (o do GitHub MCP, por exemplo).

## Pins conferidos em 2026-10-31

| Item | Pin |
| --- | --- |
| anthropics/skills | `ca45fc496a3436251f191354091d557da31c15b5` |
| vercel-labs/agent-skills | `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62` |
| github/github-mcp-server | release `v2.0.3`, commit `b98d115bbb080e9555466a96656ec4df605aea21`, sha256 do tarball no `checksums` |
| microsoft/playwright-mcp | commit `be26c080edfae7c761db1e757c4aff9f6453b4d7`, npm `@playwright/mcp@0.0.84` + integridade |
| modelcontextprotocol/servers `src/fetch` | commit `194cc86e3ae6400958555bd4116849d822d69263`, versão `2026.10.28` |
| WhatsApp Business Tools (Meta) | `https://mcp.facebook.com/whatsapp_business_tools` + sha256 de `contratos/whatsapp-business.json`. Documentação datada de 2026-09-03. Não há commit público. |
| Bling | `https://mcp.bling.com.br/mcp` + sha256 de `contratos/bling.json`. Saúde conferida: `{"status":"ok"}`. Opcional, desligado. |
| balao-sistema | contrato `1.0.0` + sha256. Não há repositório público neste workspace. URL e token só no cofre (`balao.sistema.url`, `balao.sistema.token`). |

As fontes binárias de `canvas-design` (`canvas-fonts/`) não foram copiadas: são muitos arquivos OFL grandes. O `SKILL.md` e a licença estão pinados. O PDF de temas do `theme-factory` veio junto.

## Corretor do Futuro — perguntas em aberto

Em 2026-10-31 não havia API pública:

- `https://corretordofuturo.app/api`, `/docs` e `/openapi.json` devolvem o HTML da página de apresentação.
- `https://app.corretordofuturo.app/` é o painel.
- A busca por documentação não achou um contrato HTTP.

O adaptador assume, até alguém confirmar:

- `GET {base}/v1/imoveis` — busca (`q`, `bairro`, `tipo`, `precoMin`, `precoMax`, `pagina`)
- `GET {base}/v1/imoveis/{id}` — ficha
- `POST {base}/v1/leads` — cria lead, só com confirmação
- `POST {base}/v1/visitas` — agenda visita, só com confirmação
- `Authorization: Bearer`, token no cofre `corretor.token`, URL no cofre `corretor.base-url`

Falta saber: se a API existe e qual é o prefixo; se o autenticador é Bearer ou outro; filtros e paginação reais; formato do id; campos de lead e visita; o que acontece se o horário já está ocupado; se um token é de uma imobiliária só; limite de taxa; se escrita existe ou só o painel grava.

## Cofre

O manifesto cita o id (`balao.meta.whatsapp`, `github.token`, …). Quem injeta o valor na variável de ambiente é o cofre da casa, fora deste pacote. Nascer com alma não lê nem grava segredo.
