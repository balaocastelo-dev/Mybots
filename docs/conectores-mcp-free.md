# Conectores MCP 100% gratuitos para MyBots

> Gerado em **2026-10-31 15:58 America/Sao_Paulo**. Regra Thiago: só sem chave / chave grátis sem cartão / free tier permanente sem cartão.

**Total na lista:** 109 servers · **Top 15** abaixo · Pagos só em [Descartados por custo](#descartados-por-custo).

## Como plugar MCP no hub MyBots (localhost:8790)

MyBots hub em localhost:8790 no Windows agrega bots; cada bot pode apontar MCP servers stdio (npx/uvx) ou HTTP/SSE.

- 1. No hub MyBots / config do bot, abra a seção MCP / Tools / Connectors.
- 2. Para stdio: informe command + args (+ env). Ex.: npx -y @playwright/mcp@latest
- 3. Para HTTP: informe a URL (ex.: https://mcp.bling.com.br/mcp) e faça OAuth se pedido.
- 4. Reinicie o bot; liste tools para confirmar.
- 5. Prefira modelos OpenRouter free; tools MCP consomem contexto — comece com 3–5 servers.

### Exemplo stdio
```json
{
  "playwright": {
    "command": "npx",
    "args": [
      "@playwright/mcp@latest"
    ]
  },
  "filesystem": {
    "command": "npx",
    "args": [
      "-y",
      "@modelcontextprotocol/server-filesystem",
      "C:/Users/Public/Documents"
    ]
  },
  "brasil_api": {
    "command": "npx",
    "args": [
      "-y",
      "@codespar/mcp-brasil-api"
    ]
  },
  "duckduckgo": {
    "command": "uvx",
    "args": [
      "duckduckgo-mcp-server"
    ]
  }
}
```

### Exemplo HTTP
```json
{
  "bling": {
    "url": "https://mcp.bling.com.br/mcp"
  },
  "firecrawl_keyless": {
    "url": "https://mcp.firecrawl.dev/v2/mcp"
  },
  "n8n": {
    "url": "https://SUA-INSTANCIA/mcp-server/http"
  }
}
```

### Dicas Windows
- Instale Node LTS e Python/uv (uvx) no PATH do usuário do hub.
- Use caminhos absolutos Windows (C:/...).
- Firewall: permita node/python para localhost:8790 e browsers Playwright.

## Top 15 para MyBots

| # | Nome | Custo | Limite free | Por quê | Link |
|---|------|-------|-------------|---------|------|
| 1 | Bling ERP MCP | chave grátis | API Bling conforme plano; MCP sem taxa | ERP oficial OAuth — core MEU BLING. | [repo](https://developer.bling.com.br/bling-mcp) |
| 2 | Playwright MCP | sem chave | Ilimitado local | Navegador local sem chave — OLX/sites sem API. | [repo](https://github.com/microsoft/playwright-mcp) |
| 3 | MCP Filesystem | sem chave | Ilimitado local | Arquivos do hub Windows. | [repo](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) |
| 4 | DuckDuckGo MCP | sem chave | Sem cota; ~30/min; pode vir vazio | Busca web sem conta nem cartão. | [repo](https://github.com/nickclyde/duckduckgo-mcp-server) |
| 5 | MCP Memory | sem chave | Ilimitado (arquivo local) | Memória persistente entre sessões. | [repo](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) |
| 6 | Brasil API MCP (CodeSpar) | sem chave | Rate limit público BrasilAPI | CEP/CNPJ/bancos BR sem auth. | [repo](https://github.com/codespar/mcp-dev-latam/tree/main/packages/identity/brasil-api) |
| 7 | WhatsApp MCP (lharries) | sem chave | Ilimitado; WhatsApp pessoal; risco ban | WhatsApp local via QR sem gateway pago. | [repo](https://github.com/lharries/whatsapp-mcp) |
| 8 | GitHub MCP Official | chave grátis | GitHub Free; rate API | Repos/código PROGRAMADOR. | [repo](https://github.com/github/github-mcp-server) |
| 9 | n8n MCP (instância) | sem chave | Self-host n8n Community free; cloud tem free trial limitado | Automação self-host free. | [repo](https://docs.n8n.io/advanced-ai/accessing-n8n-mcp-server/) |
| 10 | Tavily MCP | chave grátis | 1000 créditos/mês sem cartão; para ao esgotar | Busca agentic 1000 créditos/mês sem cartão. | [repo](https://github.com/tavily-ai/tavily-mcp) |
| 11 | Firecrawl MCP keyless | sem chave | Keyless por IP/dia; free key 1000 créditos/mês sem cartão | Scrape hospedado sem chave. | [repo](https://github.com/firecrawl/firecrawl-mcp-server) |
| 12 | MCP Fetch | sem chave | Ilimitado local | URL→Markdown oficial. | [repo](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch) |
| 13 | MarkItDown MCP | sem chave | Ilimitado local | PDF/Office→MD (aulas/docs). | [repo](https://github.com/microsoft/markitdown) |
| 14 | Mercado Pago MCP | chave grátis | Conta MP free; taxas por transação | Pagamentos BR oficial. | [repo](https://www.mercadopago.com.br/developers/pt/docs/mcp-server/overview) |
| 15 | TypeScript MCP SDK | sem chave | Ilimitado | Criar conectores na Escola de Bots. | [repo](https://github.com/modelcontextprotocol/typescript-sdk) |

## Snippets por persona

### MEU BLING
`Bling ERP MCP`, `Brasil API MCP (CodeSpar)`, `Mercado Pago MCP`, `Playwright MCP`, `Excel MCP`, `Tiny ERP MCP (CodeSpar)`, `Evolution API MCP (CodeSpar)`

### Herrera
`Gmail MCP (GongRzhe)`, `Google Calendar MCP`, `Playwright MCP`, `DuckDuckGo MCP`, `MCP Memory`, `RD Station MCP (CodeSpar)`, `Bluesky / ATProto MCP`

### PROGRAMADOR
`GitHub MCP Official`, `Playwright MCP`, `Context7 MCP`, `TypeScript MCP SDK`, `Docker MCP`, `Supabase MCP`, `Vercel MCP`

### Professor
`MarkItDown MCP`, `MCP Sequential Thinking`, `Wikipedia MCP`, `Obsidian MCP`, `MCP Fetch`, `YouTube Transcript MCP`

### escola-navegador
`Playwright MCP`, `Browser MCP`, `Firecrawl MCP keyless`, `DuckDuckGo MCP`, `MCP Fetch`

### escola-conector
`TypeScript MCP SDK`, `Python MCP SDK`, `FastMCP (framework)`, `n8n MCP (instância)`, `CodeSpar catalogo LATAM`, `MCP Registry`

### escola-rotineiro
`MCP Memory`, `Time MCP`, `Home Assistant MCP`, `Todoist MCP`, `Google Calendar MCP`

### todos
`MCP Filesystem`, `DuckDuckGo MCP`, `MCP Memory`, `MCP Fetch`, `Time MCP`

## Catálogo completo por categoria

| Nome | Categoria | Custo | Limite free | Credencial | Transporte | Origem | Bots | Link |
|------|-----------|-------|-------------|------------|------------|--------|------|------|
| Box MCP Remote | arquivos/sistema | chave grátis | Box free personal | OAuth Box | http | oficial | Herrera, MEU BLING | [link](https://github.com/box/mcp-server-box-remote) |
| Desktop Commander | arquivos/sistema | sem chave | Ilimitado local | Nenhuma | stdio | comunidade | PROGRAMADOR, escola-navegador | [link](https://github.com/wonderwhy-er/DesktopCommanderMCP) |
| Filesystem Go (mark3labs) | arquivos/sistema | sem chave | Ilimitado local | Allowed dirs | stdio | comunidade | todos, PROGRAMADOR | [link](https://github.com/mark3labs/mcp-filesystem-server) |
| MCP Everything | arquivos/sistema | sem chave | Ilimitado local | Nenhuma | stdio | oficial | PROGRAMADOR, escola-conector | [link](https://github.com/modelcontextprotocol/servers/tree/main/src/everything) |
| MCP Filesystem | arquivos/sistema | sem chave | Ilimitado local | Nenhuma | stdio | oficial | todos, PROGRAMADOR, MEU BLING | [link](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) |
| n8n MCP (instância) | automação | sem chave | Self-host n8n Community free; cloud tem free trial limitado | URL + API key da sua instância | http | oficial | todos, MEU BLING, Herrera, escola-conector | [link](https://docs.n8n.io/advanced-ai/accessing-n8n-mcp-server/) |
| Airtable MCP | bancos de dados | chave grátis | Airtable Free | AIRTABLE_API_KEY | stdio | comunidade | Herrera, MEU BLING | [link](https://github.com/domdomegg/airtable-mcp-server) |
| Anyquery | bancos de dados | sem chave | Local; APIs dependem de cada serviço | Tokens por integração | stdio | comunidade | PROGRAMADOR, Herrera | [link](https://github.com/julien040/anyquery) |
| Appwrite MCP | bancos de dados | chave grátis | Cloud free / self-host | APPWRITE_API_KEY | stdio | oficial | PROGRAMADOR | [link](https://github.com/appwrite/mcp) |
| DBHub | bancos de dados | sem chave | Ilimitado nos seus DBs | DSN | stdio | comunidade | PROGRAMADOR, MEU BLING | [link](https://github.com/bytebase/dbhub) |
| Elasticsearch MCP | bancos de dados | sem chave | Self-host OSS; Elastic Cloud tem trial | ES_URL | stdio | oficial | PROGRAMADOR | [link](https://github.com/elastic/mcp-server-elasticsearch) |
| MongoDB MCP | bancos de dados | chave grátis | Atlas Free M0; local ilimitado | MDB connection string | stdio | oficial | PROGRAMADOR | [link](https://github.com/mongodb-js/mongodb-mcp-server) |
| MySQL MCP | bancos de dados | sem chave | Seu MySQL | MYSQL_* | stdio | comunidade | PROGRAMADOR, MEU BLING | [link](https://github.com/designcomputer/mysql_mcp_server) |
| Neo4j MCP | bancos de dados | chave grátis | Aura Free / local | NEO4J_URI | stdio | oficial | PROGRAMADOR | [link](https://github.com/neo4j-contrib/mcp-neo4j) |
| PostgreSQL MCP (arquivado) | bancos de dados | sem chave | Seu Postgres | DATABASE_URL | stdio | oficial (arquivado) | PROGRAMADOR, MEU BLING | [link](https://github.com/modelcontextprotocol/servers-archived/tree/main/src/postgres) |
| Postgres community | bancos de dados | sem chave | Seu Postgres | DATABASE_URL | stdio | comunidade | PROGRAMADOR | [link](https://github.com/antonorlov/mcp-postgres-server) |
| Redis MCP (arquivado) | bancos de dados | sem chave | Seu Redis | REDIS_URL | stdio | oficial (arquivado) | PROGRAMADOR | [link](https://github.com/modelcontextprotocol/servers-archived/tree/main/src/redis) |
| SQLite MCP (arquivado) | bancos de dados | sem chave | Ilimitado local | Path .db | stdio | oficial (arquivado) | MEU BLING, Herrera, PROGRAMADOR | [link](https://github.com/modelcontextprotocol/servers-archived/tree/main/src/sqlite) |
| SQLite community | bancos de dados | sem chave | Ilimitado local | DB path | stdio | comunidade | MEU BLING | [link](https://github.com/Aderali06/sqlite-mcp-server) |
| Supabase MCP | bancos de dados | chave grátis | Supabase Free; MCP sem custo extra | OAuth / project_ref | http | oficial | PROGRAMADOR, MEU BLING, Herrera | [link](https://github.com/supabase/mcp) |
| DuckDuckGo MCP | busca web | sem chave | Sem cota; ~30/min; pode vir vazio | Nenhuma | stdio | comunidade | todos, escola-navegador | [link](https://github.com/nickclyde/duckduckgo-mcp-server) |
| Google Custom Search MCP | busca web | chave grátis | ~100 queries/dia free CSE | GOOGLE_API_KEY + CX | stdio | comunidade | todos | [link](https://github.com/A1-x-Tech/mcp-google-custom-search) |
| Hacker News MCP | busca web | sem chave | API HN free | Nenhuma | stdio | comunidade | Professor, PROGRAMADOR | [link](https://github.com/pskill9/hn-server) |
| MCP Fetch | busca web | sem chave | Ilimitado local | Nenhuma | stdio | oficial | todos, escola-navegador | [link](https://github.com/modelcontextprotocol/servers/tree/main/src/fetch) |
| SearXNG MCP | busca web | sem chave | Ilimitado no seu Docker | SEARXNG_URL | stdio | comunidade | todos, escola-navegador | [link](https://github.com/ihor-sokoliuk/mcp-searxng) |
| Tavily MCP | busca web | chave grátis | 1000 créditos/mês sem cartão; para ao esgotar | TAVILY_API_KEY | stdio | oficial | todos, Herrera | [link](https://github.com/tavily-ai/tavily-mcp) |
| WebSearchFree | busca web | sem chave | Ilimitado local | Nenhuma | stdio | comunidade | todos, escola-navegador | [link](https://github.com/drmikecrypto/WebSearchFree) |
| Wikipedia MCP | busca web | sem chave | API Wikimedia fair use | Nenhuma | stdio | comunidade | Professor, todos | [link](https://github.com/rudra-ravi/wikipedia-mcp) |
| YouTube Transcript MCP | busca web | sem chave | Ilimitado (yt); rate YouTube | Nenhuma | stdio | comunidade | Professor, Herrera | [link](https://github.com/sinco-lab/mcp-youtube-transcript) |
| arXiv MCP | busca web | sem chave | API arXiv free | Nenhuma | stdio | comunidade | Professor, PROGRAMADOR | [link](https://github.com/blazickjp/arxiv-mcp-server) |
| Context7 MCP | dev/docs | chave grátis | Free tier Context7 (sem cartão no plano free documentado) | Opcional CONTEXT7_API_KEY | stdio/http | oficial | PROGRAMADOR | [link](https://github.com/upstash/context7) |
| FastMCP (framework) | dev/docs | sem chave | Ilimitado | Nenhuma | stdio | oficial comunidade | PROGRAMADOR, escola-conector | [link](https://github.com/jlowin/fastmcp) |
| Hugging Face MCP | dev/docs | chave grátis | HF Free | HF token opcional | http | oficial | PROGRAMADOR | [link](https://github.com/huggingface/hf-mcp-server) |
| MCP Registry | dev/docs | sem chave | Ilimitado leitura | Nenhuma | http | oficial | PROGRAMADOR, escola-conector | [link](https://registry.modelcontextprotocol.io) |
| Python MCP SDK | dev/docs | sem chave | Ilimitado | Nenhuma | stdio/http | oficial | PROGRAMADOR, escola-conector | [link](https://github.com/modelcontextprotocol/python-sdk) |
| TypeScript MCP SDK | dev/docs | sem chave | Ilimitado | Nenhuma | stdio/http | oficial | PROGRAMADOR, escola-conector | [link](https://github.com/modelcontextprotocol/typescript-sdk) |
| Excel MCP | docs/pdf | sem chave | Ilimitado local | Nenhuma | stdio | comunidade | MEU BLING, Herrera | [link](https://github.com/haris-musa/excel-mcp-server) |
| MarkItDown MCP | docs/pdf | sem chave | Ilimitado local | Nenhuma | stdio | oficial | todos, Professor, MEU BLING | [link](https://github.com/microsoft/markitdown) |
| Markdownify MCP | docs/pdf | sem chave | Ilimitado local | Nenhuma | stdio | comunidade | todos, Professor | [link](https://github.com/zcaceres/markdownify-mcp) |
| Mermaid MCP | docs/pdf | sem chave | Ilimitado local | Nenhuma | stdio | comunidade | PROGRAMADOR, Professor | [link](https://github.com/peng-shawn/mermaid-mcp-server) |
| Pandoc MCP | docs/pdf | sem chave | Ilimitado; precisa pandoc instalado | Nenhuma | stdio | comunidade | Professor, PROGRAMADOR | [link](https://github.com/vivekVells/mcp-pandoc) |
| Gmail MCP (GongRzhe) | email/calendário | chave grátis | Gmail free; quotas Google API | OAuth Google | stdio | comunidade | todos, Herrera, MEU BLING | [link](https://github.com/GongRzhe/Gmail-MCP-Server) |
| Gmail MCP (cli_prism) | email/calendário | chave grátis | Gmail free | OAuth Google | stdio | comunidade | todos | [link](https://github.com/shinzo-labs/gmail-mcp) |
| Google Calendar MCP | email/calendário | chave grátis | Google Calendar free | OAuth Google | stdio | comunidade | todos, Herrera, Professor | [link](https://github.com/nspady/google-calendar-mcp) |
| MCP Google Workspace | email/calendário | chave grátis | Google free | OAuth Google | stdio | comunidade | Herrera, todos | [link](https://github.com/aaronsb/google-workspace-mcp) |
| Asaas MCP (CodeSpar) | financeiro BR | chave grátis | Sandbox free; produção conforme Asaas | ASAAS_API_KEY | stdio | comunidade BR | MEU BLING | [link](https://github.com/codespar/mcp-dev-latam/tree/main/packages/payments/asaas) |
| Bling ERP MCP | financeiro BR | chave grátis | API Bling conforme plano; MCP sem taxa | OAuth Bling | http | oficial | MEU BLING, Herrera | [link](https://developer.bling.com.br/bling-mcp) |
| Bling MCP (CodeSpar OSS) | financeiro BR | chave grátis | MCP OSS; API Bling OAuth conforme plano | BLING OAuth | stdio | comunidade BR | MEU BLING | [link](https://github.com/codespar/mcp-dev-latam/tree/main/packages/erp/bling) |
| Brasil API MCP (CodeSpar) | financeiro BR | sem chave | Rate limit público BrasilAPI | Nenhuma | stdio | comunidade BR | MEU BLING, Herrera, todos | [link](https://github.com/codespar/mcp-dev-latam/tree/main/packages/identity/brasil-api) |
| CodeSpar catalogo LATAM | financeiro BR | sem chave | Catálogo e pacotes npm MIT; cada API tem seu limite | Nenhuma para o catálogo | — | comunidade BR | MEU BLING, PROGRAMADOR, escola-conector | [link](https://codespar.dev/servers) |
| Conta Azul MCP (CodeSpar) | financeiro BR | chave grátis | MCP OSS; API Conta Azul conforme plano | CONTA_AZUL credentials | stdio | comunidade BR | MEU BLING | [link](https://github.com/codespar/mcp-dev-latam/tree/main/packages/fiscal/conta-azul) |
| Correios MCP (CodeSpar) | financeiro BR | chave grátis | MCP OSS; API Correios com cadastro (sem cartão típico) | Correios API creds | stdio | comunidade BR | MEU BLING, Herrera | [link](https://github.com/codespar/mcp-dev-latam/tree/main/packages/ecommerce/correios) |
| EFI/Gerencianet MCP (CodeSpar) | financeiro BR | chave grátis | Conta EFI; sandbox disponível | EFI credentials | stdio | comunidade BR | MEU BLING | [link](https://github.com/codespar/mcp-dev-latam/tree/main/packages/payments/efi) |
| Focus NFe MCP (CodeSpar) | financeiro BR | chave grátis | Sandbox free Focus | FOCUS_NFE_TOKEN | stdio | comunidade BR | MEU BLING | [link](https://github.com/codespar/mcp-dev-latam/tree/main/packages/fiscal/focus-nfe) |
| Iugu MCP (CodeSpar) | financeiro BR | chave grátis | Sandbox/test Iugu; produção com taxas | IUGU_API_TOKEN | stdio | comunidade BR | MEU BLING | [link](https://github.com/codespar/mcp-dev-latam/tree/main/packages/payments/iugu) |
| Melhor Envio MCP (CodeSpar) | financeiro BR | chave grátis | MCP OSS; conta Melhor Envio free para cotar | OAuth Melhor Envio | stdio | comunidade BR | MEU BLING | [link](https://github.com/codespar/mcp-dev-latam/tree/main/packages/ecommerce/melhor-envio) |
| Mercado Livre MCP (CodeSpar) | financeiro BR | chave grátis | Conta ML free; API com app gratuito | ML OAuth | stdio | comunidade BR | MEU BLING, Herrera | [link](https://github.com/codespar/mcp-dev-latam/tree/main/packages/ecommerce/mercado-libre) |
| Mercado Pago MCP | financeiro BR | chave grátis | Conta MP free; taxas por transação | Access Token MP | http | oficial | MEU BLING, Herrera | [link](https://www.mercadopago.com.br/developers/pt/docs/mcp-server/overview) |
| Mercado Pago MCP (CodeSpar) | financeiro BR | chave grátis | Conta MP free; taxas por transação | MP Access Token | stdio | comunidade BR | MEU BLING | [link](https://github.com/codespar/mcp-dev-latam/tree/main/packages/payments/mercado-pago) |
| Nuvem Fiscal MCP (CodeSpar) | financeiro BR | chave grátis | Sandbox; produção paga Nuvem Fiscal | NUVEM_FISCAL_TOKEN | stdio | comunidade BR | MEU BLING | [link](https://github.com/codespar/mcp-dev-latam/tree/main/packages/fiscal/nuvem-fiscal) |
| Omie MCP (CodeSpar) | financeiro BR | chave grátis | App Omie free tier conforme conta | OMIE_APP_KEY/SECRET | stdio | comunidade BR | MEU BLING | [link](https://github.com/codespar/mcp-dev-latam/tree/main/packages/erp/omie) |
| Pluggy Open Finance MCP | financeiro BR | chave grátis | Pluggy tem sandbox free | PLUGGY_API_KEY | stdio | comunidade BR | MEU BLING | [link](https://github.com/codespar/mcp-dev-latam/tree/main/packages/banking/pluggy) |
| Shopify MCP (CodeSpar) | financeiro BR | chave grátis | MCP OSS; API Shopify conforme plano da loja / partner | Shopify Admin API token | stdio | comunidade BR | MEU BLING, PROGRAMADOR | [link](https://github.com/codespar/mcp-dev-latam/tree/main/packages/ecommerce/shopify) |
| Stripe MCP | financeiro BR | chave grátis | Test mode free; live com taxas Stripe | STRIPE_SECRET_KEY | http | oficial | MEU BLING, PROGRAMADOR | [link](https://docs.stripe.com/mcp) |
| Tiny ERP MCP (CodeSpar) | financeiro BR | chave grátis | MCP OSS MIT; API Tiny conforme plano da conta (sandbox/dev se disponível) | TINY_TOKEN | stdio | comunidade BR | MEU BLING, Herrera | [link](https://github.com/codespar/mcp-dev-latam/tree/main/packages/erp/tiny) |
| VTEX MCP (CodeSpar) | financeiro BR | chave grátis | MCP OSS; VTEX conforme contrato da loja | VTEX app key/token | stdio | comunidade BR | MEU BLING | [link](https://github.com/codespar/mcp-dev-latam/tree/main/packages/ecommerce/vtex) |
| Auth0 MCP | github/devops | chave grátis | Auth0 Free 25k MAU | Auth0 token | stdio | oficial | PROGRAMADOR | [link](https://github.com/auth0/auth0-mcp-server) |
| Cloudflare MCP | github/devops | chave grátis | CF Free plan | OAuth CF | http | oficial | PROGRAMADOR | [link](https://github.com/cloudflare/mcp-server-cloudflare) |
| Docker MCP | github/devops | sem chave | Ilimitado Docker local | Docker socket | stdio | comunidade | PROGRAMADOR | [link](https://github.com/ckreiling/mcp-server-docker) |
| Fly.io MCP | github/devops | chave grátis | Fly free allowance | FLY_API_TOKEN | stdio | oficial | PROGRAMADOR | [link](https://github.com/superfly/flymcp) |
| Git MCP local | github/devops | sem chave | Ilimitado local | Nenhuma | stdio | oficial | PROGRAMADOR | [link](https://github.com/modelcontextprotocol/servers/tree/main/src/git) |
| GitHub MCP Official | github/devops | chave grátis | GitHub Free; rate API | GITHUB_PERSONAL_ACCESS_TOKEN | stdio/http | oficial | PROGRAMADOR, todos | [link](https://github.com/github/github-mcp-server) |
| GitLab MCP | github/devops | chave grátis | GitLab Free; rate API | OAuth ou PAT com scope MCP | http | oficial | PROGRAMADOR | [link](https://docs.gitlab.com/user/model_context_protocol/mcp_server/) |
| Grafana MCP | github/devops | chave grátis | Grafana OSS self-host free | GRAFANA_URL + token | stdio | oficial | PROGRAMADOR | [link](https://github.com/grafana/mcp-grafana) |
| Kubernetes MCP | github/devops | sem chave | Seu cluster | kubeconfig | stdio | comunidade | PROGRAMADOR | [link](https://github.com/Flux159/mcp-server-kubernetes) |
| Sentry MCP | github/devops | chave grátis | Sentry Free 5k errors/mês | OAuth Sentry | http | oficial | PROGRAMADOR | [link](https://github.com/getsentry/sentry-mcp) |
| Vercel MCP | github/devops | chave grátis | Hobby free Vercel | OAuth Vercel | http | oficial | PROGRAMADOR | [link](https://vercel.com/docs/mcp) |
| OpenStreetMap / Nominatim MCP | mapas/geo | sem chave | Política Nominatim 1 req/s; self-host ilimitado | Nenhuma ou self-host | stdio | comunidade | MEU BLING, Herrera | [link](https://github.com/jagan-shanmugam/open-streetmap-mcp) |
| Chroma MCP | memória/conhecimento | sem chave | Local ilimitado; Chroma Cloud free tier | Nenhuma (local) | stdio | oficial | PROGRAMADOR, Herrera | [link](https://github.com/chroma-core/chroma-mcp) |
| Graphiti MCP | memória/conhecimento | sem chave | Self-host; Zep cloud tem free limitado | Nenhuma (local) | stdio | oficial | PROGRAMADOR, Herrera | [link](https://github.com/getzep/graphiti) |
| MCP Memory | memória/conhecimento | sem chave | Ilimitado (arquivo local) | Opcional MEMORY_FILE_PATH | stdio | oficial | todos, escola-rotineiro, Herrera | [link](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) |
| MCP Sequential Thinking | memória/conhecimento | sem chave | Ilimitado | Nenhuma | stdio | oficial | todos, Professor | [link](https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking) |
| Notion MCP | memória/conhecimento | chave grátis | Notion Free | NOTION_TOKEN | stdio | oficial/comunidade | Herrera, Professor, MEU BLING | [link](https://github.com/makenotion/notion-mcp-server) |
| Obsidian MCP | memória/conhecimento | sem chave | Ilimitado; Obsidian free | Path do vault | stdio | comunidade | todos, Professor, Herrera | [link](https://github.com/StevenStavrakis/obsidian-mcp) |
| Qdrant MCP | memória/conhecimento | sem chave | Qdrant local / cloud free tier | QDRANT_URL | stdio | oficial | PROGRAMADOR | [link](https://github.com/qdrant/mcp-server-qdrant) |
| Browser MCP | navegador/scraping | sem chave | Ilimitado + extensão Chrome | Nenhuma | stdio | comunidade | escola-navegador | [link](https://github.com/browsermcp/mcp) |
| Chrome DevTools MCP | navegador/scraping | sem chave | Ilimitado local | Chrome | stdio | oficial Google | PROGRAMADOR, escola-navegador | [link](https://github.com/ChromeDevTools/chrome-devtools-mcp) |
| Firecrawl MCP keyless | navegador/scraping | sem chave | Keyless por IP/dia; free key 1000 créditos/mês sem cartão | Nenhuma ou FIRECRAWL_API_KEY free | http | oficial | escola-navegador, Herrera, MEU BLING | [link](https://github.com/firecrawl/firecrawl-mcp-server) |
| Playwright MCP | navegador/scraping | sem chave | Ilimitado local | Nenhuma | stdio | oficial | escola-navegador, Herrera, MEU BLING, todos | [link](https://github.com/microsoft/playwright-mcp) |
| Puppeteer MCP (arquivado) | navegador/scraping | sem chave | Ilimitado local | Nenhuma | stdio | oficial (arquivado) | escola-navegador | [link](https://github.com/modelcontextprotocol/servers-archived/tree/main/src/puppeteer) |
| Atlassian MCP | produtividade | chave grátis | Jira Free / Confluence Free | OAuth Atlassian | http | oficial | PROGRAMADOR, Herrera | [link](https://github.com/atlassian/atlassian-mcp-server) |
| Figma MCP | produtividade | chave grátis | Figma Free/Dev seat | OAuth Figma | http | oficial | PROGRAMADOR, Herrera | [link](https://www.figma.com/developers/mcp) |
| Google Drive MCP (arquivado) | produtividade | chave grátis | Google Drive free 15GB | OAuth Google | stdio | oficial (arquivado) | todos, Herrera | [link](https://github.com/modelcontextprotocol/servers-archived/tree/main/src/gdrive) |
| Linear MCP | produtividade | chave grátis | Linear Free | OAuth Linear | http | oficial | PROGRAMADOR, Herrera | [link](https://linear.app/docs/mcp) |
| Slack MCP | produtividade | chave grátis | Slack Free workspace | SLACK_BOT_TOKEN | stdio | oficial (arquivado)/comunidade | Herrera, todos | [link](https://github.com/modelcontextprotocol/servers/tree/main/src/slack) |
| Todoist MCP | produtividade | chave grátis | Todoist Free | TODOIST_API_TOKEN | stdio | comunidade | todos, Herrera | [link](https://github.com/abhiz123/todoist-mcp-server) |
| Bluesky / ATProto MCP | redes sociais | chave grátis | Bluesky free | BSKY handle/app password | stdio | comunidade | Herrera | [link](https://github.com/cameronrye/atproto-mcp) |
| LinkedIn MCP (community) | redes sociais | sem chave | Local; risco ToS LinkedIn | Sessão/login | stdio | comunidade | Herrera | [link](https://github.com/stickerdaniel/linkedin-mcp-server) |
| RD Station MCP (CodeSpar) | redes sociais | chave grátis | RD Station free/light conforme plano | RD_STATION_TOKEN | stdio | comunidade BR | Herrera, MEU BLING | [link](https://github.com/codespar/mcp-dev-latam/tree/main/packages/communication/rd-station) |
| Reddit MCP | redes sociais | sem chave / chave grátis | Reddit free API (rate limit) | Opcional client id | stdio | comunidade | Herrera, Professor | [link](https://github.com/adhikasp/mcp-reddit) |
| X/Twitter MCP (EnesCinr) | redes sociais | chave grátis | API X free tier muito limitado (read) | X API keys | stdio | comunidade | Herrera | [link](https://github.com/EnesCinr/twitter-mcp) |
| Home Assistant MCP | utilidades | sem chave | HA OSS self-host | HA_URL + token | stdio | comunidade | escola-rotineiro | [link](https://github.com/voska/hass-mcp) |
| Time MCP | utilidades | sem chave | Ilimitado | Nenhuma | stdio | oficial | todos, escola-rotineiro | [link](https://github.com/modelcontextprotocol/servers/tree/main/src/time) |
| Weather MCP (Open-Meteo) | utilidades | sem chave | Open-Meteo free non-commercial | Nenhuma | stdio | comunidade | todos, Herrera | [link](https://github.com/isdaniel/mcp_weather_server) |
| Discord MCP | whatsapp/chat | chave grátis | Discord free | DISCORD_TOKEN | stdio | comunidade | Herrera, escola-conector | [link](https://github.com/SaseQ/discord-mcp) |
| Evolution API MCP (CodeSpar) | whatsapp/chat | sem chave | Evolution OSS self-host ilimitado; WhatsApp risco ban | EVOLUTION_API_URL + key da instância | stdio | comunidade BR | todos, MEU BLING, Herrera | [link](https://github.com/codespar/mcp-dev-latam/tree/main/packages/communication/evolution-api) |
| Telegram MCP | whatsapp/chat | chave grátis | Telegram free; API id free | API_ID/HASH + login | stdio | comunidade | todos, MEU BLING, Herrera | [link](https://github.com/dryeab/mcp-telegram) |
| WhatsApp Cloud MCP (CodeSpar) | whatsapp/chat | chave grátis | Meta free tier de conversas/mês; depois cobrado | Meta System User token + Phone ID | stdio | comunidade BR | MEU BLING, Herrera | [link](https://github.com/codespar/mcp-dev-latam/tree/main/packages/communication/whatsapp-cloud) |
| WhatsApp MCP (lharries) | whatsapp/chat | sem chave | Ilimitado; WhatsApp pessoal; risco ban | QR scan WhatsApp | stdio | comunidade | todos, MEU BLING, Herrera | [link](https://github.com/lharries/whatsapp-mcp) |

### Detalhe rápido (o que faz / install)

#### Box MCP Remote
- **Faz:** Arquivos Box.com.
- **Tools:** search/read Box files
- **Install:** `ver box/mcp-server-box-remote`
- **Config:** `{"url": "https://mcp.box.com/"}`

#### Desktop Commander
- **Faz:** Terminal, arquivos e processos no desktop.
- **Tools:** execute_command, read/write files, list_processes
- **Install:** `npx -y @wonderwhy-er/desktop-commander`
- **Config:** `{"command": "npx", "args": ["-y", "@wonderwhy-er/desktop-commander"]}`

#### Filesystem Go (mark3labs)
- **Faz:** Filesystem MCP em Go.
- **Tools:** read/write/list
- **Install:** `binário mcp-filesystem-server`
- **Config:** `{"command": "mcp-filesystem-server", "args": ["C:/Users/user/Documents"]}`

#### MCP Everything
- **Faz:** Servidor de teste do protocolo MCP.
- **Tools:** echo, add, resources, prompts
- **Install:** `npx -y @modelcontextprotocol/server-everything`
- **Config:** `{"command": "npx", "args": ["-y", "@modelcontextprotocol/server-everything"]}`

#### MCP Filesystem
- **Faz:** Arquivos locais com pastas liberadas.
- **Tools:** read_file, write_file, edit_file, list_directory, search_files
- **Install:** `npx -y @modelcontextprotocol/server-filesystem C:/Users/user/Documents`
- **Config:** `{"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/Users/user/Documents"]}`

#### n8n MCP (instância)
- **Faz:** Expor workflows n8n como tools MCP.
- **Tools:** workflows habilitados
- **Install:** `ativar MCP na instância n8n`
- **Config:** `{"url": "https://sua-instancia.n8n/mcp-server/http"}`

#### Airtable MCP
- **Faz:** CRUD Airtable.
- **Tools:** list/create/update records
- **Install:** `npx airtable-mcp-server`
- **Config:** `{"command": "npx", "args": ["-y", "airtable-mcp-server"], "env": {"AIRTABLE_API_KEY": "${AIRTABLE_API_KEY}"}}`

#### Anyquery
- **Faz:** SQL sobre apps (GitHub, Notion, etc.) + MCP.
- **Tools:** SQL query
- **Install:** `anyquery mcp`
- **Config:** `{"command": "anyquery", "args": ["mcp"]}`

#### Appwrite MCP
- **Faz:** Backend Appwrite.
- **Tools:** databases, users, storage
- **Install:** `ver appwrite/mcp`
- **Config:** `{"command": "npx", "args": ["-y", "mcp-server-appwrite"]}`

#### DBHub
- **Faz:** Multi-DB SQL (Postgres/MySQL/SQLite…).
- **Tools:** execute_sql, list_schemas
- **Install:** `npx @bytebase/dbhub`
- **Config:** `{"command": "npx", "args": ["-y", "@bytebase/dbhub", "--dsn", "sqlite:///./data.db"]}`

#### Elasticsearch MCP
- **Faz:** Busca ES/OS.
- **Tools:** search, get
- **Install:** `npx @elastic/mcp-server-elasticsearch`
- **Config:** `{"command": "npx", "args": ["-y", "@elastic/mcp-server-elasticsearch"]}`

#### MongoDB MCP
- **Faz:** MongoDB Atlas/local.
- **Tools:** find, aggregate
- **Install:** `npx -y mongodb-mcp-server`
- **Config:** `{"command": "npx", "args": ["-y", "mongodb-mcp-server"], "env": {"MDB_MCP_CONNECTION_STRING": "${URI}"}}`

#### MySQL MCP
- **Faz:** MySQL/MariaDB.
- **Tools:** query, list_tables
- **Install:** `uvx mysql-mcp-server`
- **Config:** `{"command": "uvx", "args": ["mysql_mcp_server"]}`

#### Neo4j MCP
- **Faz:** Grafos Neo4j.
- **Tools:** cypher read/write
- **Install:** `uvx mcp-neo4j-cypher`
- **Config:** `{"command": "uvx", "args": ["mcp-neo4j-cypher"]}`

#### PostgreSQL MCP (arquivado)
- **Faz:** Postgres read-only.
- **Tools:** query, schema
- **Install:** `npx -y @modelcontextprotocol/server-postgres postgresql://localhost/db`
- **Config:** `{"command": "npx", "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/db"]}`

#### Postgres community
- **Faz:** Postgres MCP comunidade.
- **Tools:** query, schema
- **Install:** `npx mcp-postgres-server`
- **Config:** `{"command": "npx", "args": ["-y", "mcp-postgres-server"], "env": {"DATABASE_URL": "${DATABASE_URL}"}}`

#### Redis MCP (arquivado)
- **Faz:** Redis key-value.
- **Tools:** get/set/list
- **Install:** `npx -y @modelcontextprotocol/server-redis redis://localhost:6379`
- **Config:** `{"command": "npx", "args": ["-y", "@modelcontextprotocol/server-redis", "redis://localhost:6379"]}`

#### SQLite MCP (arquivado)
- **Faz:** SQLite local.
- **Tools:** read_query, write_query, list_tables
- **Install:** `uvx mcp-server-sqlite --db-path ./data.db`
- **Config:** `{"command": "uvx", "args": ["mcp-server-sqlite", "--db-path", "./data.db"]}`

#### SQLite community
- **Faz:** SQLite MCP comunidade.
- **Tools:** SQL query/exec
- **Install:** `ver README`
- **Config:** `{"command": "uvx", "args": ["sqlite-mcp-server"]}`

#### Supabase MCP
- **Faz:** Projetos Supabase (SQL/schema).
- **Tools:** database, schema, docs
- **Install:** `https://mcp.supabase.com/mcp?read_only=true`
- **Config:** `{"url": "https://mcp.supabase.com/mcp?read_only=true"}`

#### DuckDuckGo MCP
- **Faz:** Busca DDG HTML sem conta.
- **Tools:** search, fetch_content
- **Install:** `uvx duckduckgo-mcp-server`
- **Config:** `{"command": "uvx", "args": ["duckduckgo-mcp-server"]}`

#### Google Custom Search MCP
- **Faz:** Programmable Search Engine.
- **Tools:** custom search
- **Install:** `ver README A1-x-Tech`
- **Config:** `{"command": "node", "args": ["path/to/gcs-mcp"]}`

#### Hacker News MCP
- **Faz:** Hacker News.
- **Tools:** get_stories, get_story
- **Install:** `npx hn-mcp-server`
- **Config:** `{"command": "npx", "args": ["-y", "hn-server"]}`

#### MCP Fetch
- **Faz:** URL → Markdown.
- **Tools:** fetch
- **Install:** `uvx mcp-server-fetch`
- **Config:** `{"command": "uvx", "args": ["mcp-server-fetch"]}`

#### SearXNG MCP
- **Faz:** Metabusca SearXNG self-hosted.
- **Tools:** search, fetch
- **Install:** `uvx mcp-searxng`
- **Config:** `{"command": "uvx", "args": ["mcp-searxng"], "env": {"SEARXNG_URL": "http://localhost:8080"}}`

#### Tavily MCP
- **Faz:** Busca/extract para agentes.
- **Tools:** tavily-search, tavily-extract
- **Install:** `npx -y tavily-mcp@latest`
- **Config:** `{"command": "npx", "args": ["-y", "tavily-mcp@latest"], "env": {"TAVILY_API_KEY": "${TAVILY_API_KEY}"}}`

#### WebSearchFree
- **Faz:** Metabusca local open-source estilo Tavily.
- **Tools:** web_search, web_search_multi, web_extract
- **Install:** `wsf mcp`
- **Config:** `{"command": "wsf", "args": ["mcp"]}`

#### Wikipedia MCP
- **Faz:** Artigos Wikipedia.
- **Tools:** search, get_article
- **Install:** `uvx wikipedia-mcp`
- **Config:** `{"command": "uvx", "args": ["wikipedia-mcp"]}`

#### YouTube Transcript MCP
- **Faz:** Transcrições YouTube.
- **Tools:** get_transcript
- **Install:** `npx mcp-youtube-transcript`
- **Config:** `{"command": "npx", "args": ["-y", "@sinco-lab/mcp-youtube-transcript"]}`

#### arXiv MCP
- **Faz:** Papers arXiv.
- **Tools:** search_papers, read_paper
- **Install:** `uvx arxiv-mcp-server`
- **Config:** `{"command": "uvx", "args": ["arxiv-mcp-server"]}`

#### Context7 MCP
- **Faz:** Docs atualizadas de libs para o LLM.
- **Tools:** resolve-library-id, get-library-docs
- **Install:** `npx -y @upstash/context7-mcp`
- **Config:** `{"command": "npx", "args": ["-y", "@upstash/context7-mcp"]}`

#### FastMCP (framework)
- **Faz:** Framework Python para criar MCP servers.
- **Tools:** (SDK)
- **Install:** `pip install fastmcp`
- **Config:** `{"command": "python", "args": ["-m", "fastmcp", "run", "server.py"]}`

#### Hugging Face MCP
- **Faz:** Hub HF: models, datasets, Spaces.
- **Tools:** search models, datasets
- **Install:** `https://huggingface.co/mcp`
- **Config:** `{"url": "https://huggingface.co/mcp"}`

#### MCP Registry
- **Faz:** Registry oficial de servers MCP.
- **Tools:** search servers
- **Install:** `https://registry.modelcontextprotocol.io`
- **Config:** `{"url": "https://registry.modelcontextprotocol.io"}`

#### Python MCP SDK
- **Faz:** SDK oficial Python.
- **Tools:** (SDK)
- **Install:** `pip install mcp`
- **Config:** `{"command": "python", "args": ["server.py"]}`

#### TypeScript MCP SDK
- **Faz:** SDK oficial TS para servers/clients.
- **Tools:** (SDK)
- **Install:** `npm i @modelcontextprotocol/sdk`
- **Config:** `{"command": "node", "args": ["server.js"]}`

#### Excel MCP
- **Faz:** Planilhas Excel.
- **Tools:** read/write sheets
- **Install:** `uvx excel-mcp-server`
- **Config:** `{"command": "uvx", "args": ["excel-mcp-server"]}`

#### MarkItDown MCP
- **Faz:** PDF/Office → Markdown (Microsoft).
- **Tools:** convert_to_markdown
- **Install:** `npx / uv markitdown-mcp`
- **Config:** `{"command": "uvx", "args": ["markitdown-mcp"]}`

#### Markdownify MCP
- **Faz:** HTML/PDF/YouTube → MD.
- **Tools:** markdownify
- **Install:** `npx markdownify-mcp`
- **Config:** `{"command": "npx", "args": ["-y", "markdownify-mcp"]}`

#### Mermaid MCP
- **Faz:** Diagramas Mermaid → imagem.
- **Tools:** generate
- **Install:** `npx mermaid-mcp-server`
- **Config:** `{"command": "npx", "args": ["-y", "@peng-shawn/mermaid-mcp-server"]}`

#### Pandoc MCP
- **Faz:** Conversões pandoc.
- **Tools:** convert
- **Install:** `uvx mcp-pandoc`
- **Config:** `{"command": "uvx", "args": ["mcp-pandoc"]}`

#### Gmail MCP (GongRzhe)
- **Faz:** Gmail send/read/labels.
- **Tools:** send_email, search, read, labels
- **Install:** `npx @gongrzhe/server-gmail-autoauth-mcp`
- **Config:** `{"command": "npx", "args": ["-y", "@gongrzhe/server-gmail-autoauth-mcp"]}`

#### Gmail MCP (cli_prism)
- **Faz:** Gmail MCP comunidade.
- **Tools:** messages, threads, draft
- **Install:** `npx gmail-mcp`
- **Config:** `{"command": "npx", "args": ["-y", "@shinzo-labs/gmail-mcp"]}`

#### Google Calendar MCP
- **Faz:** Agenda Google.
- **Tools:** list/create/update events
- **Install:** `npx @nspady/google-calendar-mcp`
- **Config:** `{"command": "npx", "args": ["-y", "@nspady/google-calendar-mcp"]}`

#### MCP Google Workspace
- **Faz:** Gmail+Calendar+Drive.
- **Tools:** gmail, calendar, drive
- **Install:** `ver aaronsb/google-workspace-mcp`
- **Config:** `{"command": "npx", "args": ["-y", "google-workspace-mcp"]}`

#### Asaas MCP (CodeSpar)
- **Faz:** Cobranças Asaas.
- **Tools:** customers, payments, subscriptions
- **Install:** `npx @codespar/mcp-asaas`
- **Config:** `{"command": "npx", "args": ["-y", "@codespar/mcp-asaas"], "env": {"ASAAS_API_KEY": "${ASAAS_API_KEY}"}}`

#### Bling ERP MCP
- **Faz:** MCP oficial Bling ERP OAuth.
- **Tools:** produtos, pedidos, estoque, financeiro, NF
- **Install:** `https://mcp.bling.com.br/mcp`
- **Config:** `{"url": "https://mcp.bling.com.br/mcp"}`

#### Bling MCP (CodeSpar OSS)
- **Faz:** Bling via stdio OSS (alternativa ao MCP remoto oficial).
- **Tools:** products, orders, stock, nfe
- **Install:** `npx @codespar/mcp-bling`
- **Config:** `{"command": "npx", "args": ["-y", "@codespar/mcp-bling"]}`

#### Brasil API MCP (CodeSpar)
- **Faz:** CEP, CNPJ, banks, FX, IBGE sem auth.
- **Tools:** cep, cnpj, banks, taxa-cambio, ibge
- **Install:** `npx @codespar/mcp-brasil-api`
- **Config:** `{"command": "npx", "args": ["-y", "@codespar/mcp-brasil-api"]}`

#### CodeSpar catalogo LATAM
- **Faz:** Catálogo 130+ MCP LATAM (MIT) — use só os de API free/sandbox.
- **Tools:** (meta)
- **Install:** `https://codespar.dev/api/servers`
- **Config:** `{"url": "https://codespar.dev/api/servers"}`

#### Conta Azul MCP (CodeSpar)
- **Faz:** Conta Azul: financeiro, NF, clientes.
- **Tools:** invoices, customers, products
- **Install:** `npx @codespar/mcp-conta-azul`
- **Config:** `{"command": "npx", "args": ["-y", "@codespar/mcp-conta-azul"]}`

#### Correios MCP (CodeSpar)
- **Faz:** Rastreio, frete e CEP Correios.
- **Tools:** tracking, rates, cep
- **Install:** `npx @codespar/mcp-correios`
- **Config:** `{"command": "npx", "args": ["-y", "@codespar/mcp-correios"]}`

#### EFI/Gerencianet MCP (CodeSpar)
- **Faz:** Pix e cobranças EFI (Gerencianet).
- **Tools:** pix, charges
- **Install:** `npx @codespar/mcp-efi`
- **Config:** `{"command": "npx", "args": ["-y", "@codespar/mcp-efi"]}`

#### Focus NFe MCP (CodeSpar)
- **Faz:** NF via Focus NFe.
- **Tools:** nfe emit/query
- **Install:** `npx @codespar/mcp-focus-nfe`
- **Config:** `{"command": "npx", "args": ["-y", "@codespar/mcp-focus-nfe"]}`

#### Iugu MCP (CodeSpar)
- **Faz:** Cobranças Iugu.
- **Tools:** invoices, subscriptions
- **Install:** `npx @codespar/mcp-iugu`
- **Config:** `{"command": "npx", "args": ["-y", "@codespar/mcp-iugu"]}`

#### Melhor Envio MCP (CodeSpar)
- **Faz:** Fretes, etiquetas, tracking Melhor Envio.
- **Tools:** rates, labels, tracking
- **Install:** `npx @codespar/mcp-melhor-envio`
- **Config:** `{"command": "npx", "args": ["-y", "@codespar/mcp-melhor-envio"]}`

#### Mercado Livre MCP (CodeSpar)
- **Faz:** Anúncios/pedidos Mercado Livre.
- **Tools:** items, orders
- **Install:** `npx @codespar/mcp-mercado-libre`
- **Config:** `{"command": "npx", "args": ["-y", "@codespar/mcp-mercado-libre"]}`

#### Mercado Pago MCP
- **Faz:** Pagamentos e cobrancas MP.
- **Tools:** pagamentos, cobrancas, QR
- **Install:** `docs Mercado Pago MCP`
- **Config:** `{"url": "consultar docs MP MCP"}`

#### Mercado Pago MCP (CodeSpar)
- **Faz:** Pagamentos/Pix Mercado Pago via CodeSpar (alt. ao MCP oficial).
- **Tools:** payments, pix, refunds
- **Install:** `npx @codespar/mcp-mercado-pago`
- **Config:** `{"command": "npx", "args": ["-y", "@codespar/mcp-mercado-pago"]}`

#### Nuvem Fiscal MCP (CodeSpar)
- **Faz:** NF-e/NFC-e via Nuvem Fiscal.
- **Tools:** emitir/consultar NF
- **Install:** `npx @codespar/mcp-nuvem-fiscal`
- **Config:** `{"command": "npx", "args": ["-y", "@codespar/mcp-nuvem-fiscal"], "env": {"NUVEM_FISCAL_TOKEN": "${TOKEN}"}}`

#### Omie MCP (CodeSpar)
- **Faz:** ERP Omie.
- **Tools:** clientes, pedidos, financeiro
- **Install:** `npx @codespar/mcp-omie`
- **Config:** `{"command": "npx", "args": ["-y", "@codespar/mcp-omie"]}`

#### Pluggy Open Finance MCP
- **Faz:** Open Finance agregador Pluggy.
- **Tools:** accounts, transactions
- **Install:** `npx @codespar/mcp-pluggy`
- **Config:** `{"command": "npx", "args": ["-y", "@codespar/mcp-pluggy"]}`

#### Shopify MCP (CodeSpar)
- **Faz:** Docs/dev Shopify (oficial dev).
- **Tools:** search docs, graphql
- **Install:** `npx @codespar/mcp-shopify`
- **Config:** `{"command": "npx", "args": ["-y", "@codespar/mcp-shopify"]}`

#### Stripe MCP
- **Faz:** Pagamentos Stripe.
- **Tools:** balance, customers, payment_intents
- **Install:** `docs.stripe.com/mcp`
- **Config:** `{"url": "https://mcp.stripe.com"}`

#### Tiny ERP MCP (CodeSpar)
- **Faz:** Tiny ERP: produtos, estoque, pedidos, NF.
- **Tools:** products, orders, invoices, stock
- **Install:** `npx @codespar/mcp-tiny`
- **Config:** `{"command": "npx", "args": ["-y", "@codespar/mcp-tiny"], "env": {"TINY_TOKEN": "${TOKEN}"}}`

#### VTEX MCP (CodeSpar)
- **Faz:** E-commerce VTEX pedidos/produtos.
- **Tools:** orders, products, inventory
- **Install:** `npx @codespar/mcp-vtex`
- **Config:** `{"command": "npx", "args": ["-y", "@codespar/mcp-vtex"]}`

#### Auth0 MCP
- **Faz:** Gerenciar Auth0.
- **Tools:** apps, apis
- **Install:** `npx @auth0/auth0-mcp-server`
- **Config:** `{"command": "npx", "args": ["-y", "@auth0/auth0-mcp-server"]}`

#### Cloudflare MCP
- **Faz:** Workers/DNS/R2 Cloudflare.
- **Tools:** workers, dns, kv
- **Install:** `https://mcp.cloudflare.com`
- **Config:** `{"url": "https://mcp.cloudflare.com"}`

#### Docker MCP
- **Faz:** Containers Docker local.
- **Tools:** list/start/stop containers, logs
- **Install:** `uvx mcp-server-docker`
- **Config:** `{"command": "uvx", "args": ["mcp-server-docker"]}`

#### Fly.io MCP
- **Faz:** Apps Fly.io.
- **Tools:** apps, machines
- **Install:** `ver superfly/flymcp`
- **Config:** `{"command": "flymcp"}`

#### Git MCP local
- **Faz:** Git local read/write.
- **Tools:** git_status, log, diff, commit
- **Install:** `uvx mcp-server-git --repository .`
- **Config:** `{"command": "uvx", "args": ["mcp-server-git", "--repository", "."]}`

#### GitHub MCP Official
- **Faz:** Repos/issues/PRs/Actions oficial.
- **Tools:** create_issue, list_prs, search_code, actions
- **Install:** `npx -y @modelcontextprotocol/server-github OU remote`
- **Config:** `{"command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": "${GH_TOKEN}"}}`

#### GitLab MCP
- **Faz:** MCP oficial GitLab (issues, MRs, CI) via HTTP.
- **Tools:** projects, merge_requests, issues, pipelines
- **Install:** `https://gitlab.com/api/v4/mcp`
- **Config:** `{"url": "https://gitlab.com/api/v4/mcp"}`

#### Grafana MCP
- **Faz:** Dashboards/alertas Grafana.
- **Tools:** search dashboards, query
- **Install:** `uvx mcp-grafana`
- **Config:** `{"command": "uvx", "args": ["mcp-grafana"]}`

#### Kubernetes MCP
- **Faz:** kubectl via MCP.
- **Tools:** get/apply/logs pods
- **Install:** `npx mcp-server-kubernetes`
- **Config:** `{"command": "npx", "args": ["-y", "mcp-server-kubernetes"]}`

#### Sentry MCP
- **Faz:** Erros Sentry.
- **Tools:** list issues, resolve
- **Install:** `https://mcp.sentry.dev/mcp`
- **Config:** `{"url": "https://mcp.sentry.dev/mcp"}`

#### Vercel MCP
- **Faz:** Deploys/projetos Vercel.
- **Tools:** projects, deployments, logs
- **Install:** `https://mcp.vercel.com`
- **Config:** `{"url": "https://mcp.vercel.com"}`

#### OpenStreetMap / Nominatim MCP
- **Faz:** Geocode OSM Nominatim (uso justo).
- **Tools:** geocode, reverse
- **Install:** `uvx open-streetmap-mcp`
- **Config:** `{"command": "uvx", "args": ["open-streetmap-mcp"]}`

#### Chroma MCP
- **Faz:** Vector DB Chroma local/cloud.
- **Tools:** add, query, delete
- **Install:** `uvx chroma-mcp`
- **Config:** `{"command": "uvx", "args": ["chroma-mcp"]}`

#### Graphiti MCP
- **Faz:** Temporal knowledge graph (Zep).
- **Tools:** add/search episodes
- **Install:** `ver getzep/graphiti`
- **Config:** `{"command": "uv", "args": ["run", "graphiti_mcp_server.py"]}`

#### MCP Memory
- **Faz:** Knowledge graph local persistente.
- **Tools:** create_entities, relations, search_nodes
- **Install:** `npx -y @modelcontextprotocol/server-memory`
- **Config:** `{"command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"]}`

#### MCP Sequential Thinking
- **Faz:** Raciocínio passo a passo.
- **Tools:** sequentialthinking
- **Install:** `npx -y @modelcontextprotocol/server-sequential-thinking`
- **Config:** `{"command": "npx", "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]}`

#### Notion MCP
- **Faz:** Notion como KB (checar MCP oficial no registry).
- **Tools:** search pages, blocks
- **Install:** `npx -y @notionhq/notion-mcp-server`
- **Config:** `{"command": "npx", "args": ["-y", "@notionhq/notion-mcp-server"], "env": {"NOTION_TOKEN": "${NOTION_TOKEN}"}}`

#### Obsidian MCP
- **Faz:** Vault Obsidian local.
- **Tools:** list/read/write notes
- **Install:** `npx -y obsidian-mcp /path/to/vault`
- **Config:** `{"command": "npx", "args": ["-y", "obsidian-mcp", "C:/Obsidian/Balao"]}`

#### Qdrant MCP
- **Faz:** Vector search Qdrant.
- **Tools:** store, find
- **Install:** `uvx mcp-server-qdrant`
- **Config:** `{"command": "uvx", "args": ["mcp-server-qdrant"]}`

#### Browser MCP
- **Faz:** Controla Chrome local já logado.
- **Tools:** navigate, click, type, screenshot
- **Install:** `npx @browsermcp/mcp@latest`
- **Config:** `{"command": "npx", "args": ["@browsermcp/mcp@latest"]}`

#### Chrome DevTools MCP
- **Faz:** DevTools protocol no Chrome.
- **Tools:** inspect, network, performance
- **Install:** `npx chrome-devtools-mcp`
- **Config:** `{"command": "npx", "args": ["-y", "chrome-devtools-mcp"]}`

#### Firecrawl MCP keyless
- **Faz:** Scrape/search/parse hospedado sem chave.
- **Tools:** firecrawl_scrape, search, parse
- **Install:** `https://mcp.firecrawl.dev/v2/mcp`
- **Config:** `{"url": "https://mcp.firecrawl.dev/v2/mcp"}`

#### Playwright MCP
- **Faz:** Browser automation oficial Microsoft.
- **Tools:** browser_navigate, click, type, snapshot, screenshot, fill_form
- **Install:** `npx @playwright/mcp@latest`
- **Config:** `{"command": "npx", "args": ["@playwright/mcp@latest"]}`

#### Puppeteer MCP (arquivado)
- **Faz:** Chrome headless via Puppeteer.
- **Tools:** navigate, screenshot, click, fill, evaluate
- **Install:** `npx -y @modelcontextprotocol/server-puppeteer`
- **Config:** `{"command": "npx", "args": ["-y", "@modelcontextprotocol/server-puppeteer"]}`

#### Atlassian MCP
- **Faz:** Jira/Confluence.
- **Tools:** issues, pages
- **Install:** `https://mcp.atlassian.com/v1/sse`
- **Config:** `{"url": "https://mcp.atlassian.com/v1/sse"}`

#### Figma MCP
- **Faz:** Design Figma para código.
- **Tools:** get_design_context
- **Install:** `https://mcp.figma.com/mcp`
- **Config:** `{"url": "https://mcp.figma.com/mcp"}`

#### Google Drive MCP (arquivado)
- **Faz:** Drive search/read.
- **Tools:** search, read_file
- **Install:** `npx -y @modelcontextprotocol/server-gdrive`
- **Config:** `{"command": "npx", "args": ["-y", "@modelcontextprotocol/server-gdrive"]}`

#### Linear MCP
- **Faz:** Issues Linear.
- **Tools:** create/list issues
- **Install:** `https://mcp.linear.app/sse`
- **Config:** `{"url": "https://mcp.linear.app/sse"}`

#### Slack MCP
- **Faz:** Slack channels/messages (arquivado oficial; ver forks).
- **Tools:** list_channels, post_message
- **Install:** `npx -y @modelcontextprotocol/server-slack`
- **Config:** `{"command": "npx", "args": ["-y", "@modelcontextprotocol/server-slack"], "env": {"SLACK_BOT_TOKEN": "${TOKEN}"}}`

#### Todoist MCP
- **Faz:** Tasks Todoist.
- **Tools:** create/list tasks
- **Install:** `npx todoist-mcp-server`
- **Config:** `{"command": "npx", "args": ["-y", "todoist-mcp-server"], "env": {"TODOIST_API_TOKEN": "${TOKEN}"}}`

#### Bluesky / ATProto MCP
- **Faz:** AT Protocol Bluesky.
- **Tools:** timeline, search, post (com app password)
- **Install:** `npx atproto-mcp`
- **Config:** `{"command": "npx", "args": ["-y", "atproto-mcp"]}`

#### LinkedIn MCP (community)
- **Faz:** LinkedIn via scrap/login (cuidado ToS).
- **Tools:** profile, posts
- **Install:** `ver stickerdaniel/linkedin-mcp-server`
- **Config:** `{"command": "uvx", "args": ["linkedin-mcp-server"]}`

#### RD Station MCP (CodeSpar)
- **Faz:** Marketing RD Station.
- **Tools:** contacts, emails
- **Install:** `npx @codespar/mcp-rd-station`
- **Config:** `{"command": "npx", "args": ["-y", "@codespar/mcp-rd-station"]}`

#### Reddit MCP
- **Faz:** Ler Reddit.
- **Tools:** search, get_thread
- **Install:** `uvx mcp-reddit`
- **Config:** `{"command": "uvx", "args": ["mcp-reddit"]}`

#### X/Twitter MCP (EnesCinr)
- **Faz:** Post/search X via API.
- **Tools:** post_tweet, search_tweets
- **Install:** `npx twitter-mcp`
- **Config:** `{"command": "npx", "args": ["-y", "@enescinr/twitter-mcp"], "env": {"API_KEY": "${X_API_KEY}"}}`

#### Home Assistant MCP
- **Faz:** Automação casa HA.
- **Tools:** call_service, get_state
- **Install:** `uvx hass-mcp`
- **Config:** `{"command": "uvx", "args": ["hass-mcp"], "env": {"HA_URL": "http://homeassistant.local:8123"}}`

#### Time MCP
- **Faz:** Hora/timezone.
- **Tools:** get_current_time, convert_time
- **Install:** `uvx mcp-server-time`
- **Config:** `{"command": "uvx", "args": ["mcp-server-time"]}`

#### Weather MCP (Open-Meteo)
- **Faz:** Clima via Open-Meteo (sem chave).
- **Tools:** get_weather
- **Install:** `uvx mcp-weather-server`
- **Config:** `{"command": "uvx", "args": ["mcp-weather-server"]}`

#### Discord MCP
- **Faz:** Bot Discord.
- **Tools:** send/read channels
- **Install:** `ver SaseQ/discord-mcp`
- **Config:** `{"command": "npx", "args": ["-y", "discord-mcp"], "env": {"DISCORD_TOKEN": "${TOKEN}"}}`

#### Evolution API MCP (CodeSpar)
- **Faz:** WhatsApp via Evolution API self-host.
- **Tools:** send message, instances, contacts
- **Install:** `npx @codespar/mcp-evolution-api`
- **Config:** `{"command": "npx", "args": ["-y", "@codespar/mcp-evolution-api"]}`

#### Telegram MCP
- **Faz:** Telegram via Telethon/API.
- **Tools:** send/list messages
- **Install:** `ver dryeab/mcp-telegram`
- **Config:** `{"command": "uvx", "args": ["mcp-telegram"]}`

#### WhatsApp Cloud MCP (CodeSpar)
- **Faz:** WhatsApp Cloud API oficial Meta.
- **Tools:** messages, media, templates
- **Install:** `npx @codespar/mcp-whatsapp-cloud`
- **Config:** `{"command": "npx", "args": ["-y", "@codespar/mcp-whatsapp-cloud"]}`

#### WhatsApp MCP (lharries)
- **Faz:** WhatsApp via whatsmeow (bridge Go + MCP).
- **Tools:** search_contacts, list_messages, send_message, media
- **Install:** `clone + go build bridge + uv run whatsapp-mcp`
- **Config:** `{"command": "uv", "args": ["--directory", "path/whatsapp-mcp/whatsapp-mcp-server", "run", "main.py"]}`

## Descartados por custo

- **Brave Search MCP** — API exige cartão mesmo para créditos free ($5/mês).
- **Browserbase** — Cloud browser pago / cartão.
- **Replicate / fal.ai** — Inferência paga; free trial com cartão típico.
- **ElevenLabs** — TTS pago após trial; cartão comum.
- **Pollinations** — Modelo Pollen passou a ser pago.
- **Composio / Zapier MCP pagos** — Planos úteis são pagos.
- **Z-API (CodeSpar)** — Gateway WhatsApp comercial pago (use Evolution self-host ou Cloud free tier).
- **Google Maps MCP** — Google Cloud exige cartão; preferir Nominatim/OSM.
- **Make.com MCP** — Free 1000 ops existe, mas upsell/cartão frequente — evitar na regra estrita.
- **Apify MCP** — Créditos sérios costumam exigir cartão.

## Lacunas

- **OLX Brasil API oficial:** Sem MCP dedicado; usar Playwright/Browser MCP no site.
- **Buffer / agendamento social pago:** Sem opção 100% free permanente; Bluesky/Mastodon self ou RD Station free limitado.
- **Tiny / Conta Azul:** PREENCHIDO via @codespar/mcp-tiny e @codespar/mcp-conta-azul (API depende do plano).
- **Instagram / TikTok / Facebook post:** Sem MCP free estável (Meta Graph tem app review); Playwright com sessão logada.

## Fontes

- https://registry.modelcontextprotocol.io
- https://github.com/modelcontextprotocol/servers
- https://github.com/punkpeye/awesome-mcp-servers
- https://codespar.dev/servers
- https://github.com/codespar/mcp-dev-latam
- https://developer.bling.com.br/bling-mcp
- https://docs.n8n.io/advanced-ai/accessing-n8n-mcp-server/
