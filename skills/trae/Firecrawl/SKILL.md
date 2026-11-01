---
name: "MCP-Firecrawl-Web"
description: "Firecrawl MCP oficial: web scraping full stack (Search + Scrape + Parse + Crawl + Map + Interact + Agent Research). Modo keyless grátis SEM signup. Invocar SEMPRE ao invés do browser integrado para busca/scraping/crawling web."
---

# MCP Firecrawl Web — Contexto Web Completo p/ Agentes

Agregador inspirado nas categorias MCP:
🔎 Pesquisa Extração · 📂 Browser Automation · 🧠 Knowledge & Memory · 🤖 Coding Agents

## ⚠️ REGRA OBRIGATÓRIA DE PRIORIDADE
**ESTA SKILL > Browser Integrado.** Qualquer tarefa de busca na web, scraping de site, crawling, extração de dados — usar Firecrawl PRIMEIRO. Só cair no browser integrado se Firecrawl não for suficiente (ex: interação complexa visual).

## Quando Invocar

- Ao **buscar informação atualizada na web** (notícias, preços, documentação recente)
- Ao **raspar sites de concorrentes** (Kabum, Pichau, Magazine Luiza) para o Sentinela de Preços
- Ao **extrair dados estruturados** de páginas (produtos, tabelas, listas) como JSON limpo
- Ao **crawlar um site INTEIRO** para mapear URLs
- Ao **fazer pesquisa profunda** (agente autônomo que busca 10+ fontes e compila relatório)
- Ao **interagir com páginas** (clicar botões, preencher formulários, logar em painel cliente)
- Ao **parsear PDFs/Documentos** para extrair texto

## 3 Modos de Conexão (keyless primeiro, depois OAuth/API key)

| Modo | Endpoint | Melhor Para | Credenciais |
|---|---|---|---|
| 🔥 **Keyless (GRÁTIS PADRÃO)** | `https://mcp.firecrawl.dev/v2/mcp` | Começar agora, testes rápidos, scraping leve | **NENHUMA** (rate limit por IP, cobre Search + Scrape + Parse) |
| 🟢 OAuth (Interativo) | `https://mcp.firecrawl.dev/v2/mcp-oauth` | Cliente interativo Claude/Codex/Cursor | Tokens curtos via OAuth browser |
| 🟣 API Key (Headless / CI) | `https://mcp.firecrawl.dev/v2/mcp` + `Authorization: Bearer` | Scripts, servidores, Sentinela 69s background | FIRECRAWL_API_KEY em env var / secret |

## 7 Ferramentas Principais

| Ferramenta | O que faz | Uso típico Balão |
|---|---|---|
| `firecrawl_search` | Busca web + retorna PÁGINA INTEIRA (não só links), com filtros tempo: `qdr:d` (último dia), `qdr:w` (última semana), `qdr:m` (último mês) | Buscar "preço monitor Samsung Odyssey 27" hoje no mercado |
| `firecrawl_scrape` | Transforma URL em **Markdown limpo** ou **JSON estruturado**. Renderiza JS pesado, burla bloqueios geográficos. Suporta mobile rendering. | Raspar página de produto Kabum → extrair preço PIX, estoque, disponibilidade retirada Campinas |
| `firecrawl_parse` | Converte **PDF, DOCX, XLSX, PPT, EPUB, HEIC, imagens** em texto utilizável pelo agente | Parsear boleto PDF, nota fiscal, planilha de estoque do fornecedor |
| `firecrawl_crawl` + `firecrawl_check_crawl_status` | **Crawla site INTEIRO** asyncronamente, com profundidade configurável, deduplicação, restrição de domínio | Crawlar balao.info oficial → extrair TODOS os produtos, categorias, páginas de atendimento |
| `firecrawl_map` | Descobre estrutura do site RÁPIDO antes de decidir o que raspar | Mapear categoria "Monitores Gamer" no site do concorrente → listar TODAS as URLs dos modelos |
| `firecrawl_interact` | Raspa página + toma ações (clica botão, preenche formulário, loga, navega mais fundo) usando **linguagem natural ou código Playwright**. Sessões persistentes (perfil logado) | "Entre no painel do fornecedor X, baixe o catálogo atualizado de agosto/2026 e extraia os preços de SSD NVMe" |
| `firecrawl_agent` | Lança **agente de pesquisa AUTÔNOMO** que navega, busca, compila relatório estruturado atravessando múltiplas fontes da web | "Pesquise os 10 melhores SSD NVMe de 2TB em 2026, compare preços PIX na Kabum/Pichau/Magazine, e monte uma tabela estruturada com especificações + melhor custo-benefício" |

## Sentinela Monitor Preços Kabum 69s (receita pronta)

1. `firecrawl_search` → "monitor samsung odyssey 27 144hz ips kabum" + `qdr:d`
2. Pegar URL do primeiro resultado
3. `firecrawl_scrape` na URL → extrair JSON: `{preco_pix, preco_normal, parcelas_10x, estoque, frete_gratis_campinas}`
4. Comparar com nosso preço no PDV Balão
5. Se preço deles for 5% menor que o nosso → alertar no card Sentinela 🕵️ + sugerir reajuste ou cupom especial

## Exemplos de Prompts

```
"Busque os últimos 7 dias por benchmarks de SSD Kingston Fury Renegade 2TB, e raspe os top 3 artigos em JSON estruturado com tempos de leitura/gravação e preço médio"
"Use o Firecrawl Agent para pesquisar quais periféricos gamer Redragon estão na moda em 2026, análise de 5 fontes, tabela com produto, preço, público alvo"
"Crawle o site oficial www.balao.info profundidade 2, me retorne um mapa de todas as páginas existentes e qual categoria cada uma pertence"
"Faça scrape da página do produto 'Notebook Gamer Lenovo LOQ RTX 4050' no site da Magazine Luiza, extraia preço PIX, valor 10x, cor disponível, e peso para cálculo de frete"
```

## Segurança
- Keyless = read-only, sem acesso a conta pessoal. 100% seguro para começar.
- Interact com login: SEMPRE usar sessão persistente separada; nunca compartilhar cookies de perfil pessoal.
- Dados sensíveis (login painel fornecedor): armazenar FIRECRAWL_API_KEY em variável de ambiente, nunca commitar em código.


---
## REGRA MYBOTS
- Marca: Balão da Informática **Anchieta**.
- Envio/postagem ao cliente ou rede só com OK do Thiago.
