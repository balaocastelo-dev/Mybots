---
name: "MCP-Playwright-Tests"
description: "Playwright MCP OFICIAL da Microsoft (1 MILHAO de downloads Docker Hub). Testes UI E2E, scraping interativo, screenshots cross-browser. Docker-ready. Usar para validar UI do index.html, sentinela Kabum navegacao completa, e testes de login/forms."
---

# MCP Playwright Tests — Oficial Microsoft QA + Browser Automation

Agregador inspirado nas categorias MCP:
📂 Browser Automation · 🧪 Testing & QA Tools · 🖥️ Command Line · 🔎 Search & Data Extraction

## ⚠️ REGRA OBRIGATÓRIA
**Esta Skill > Browser Integrado para QUALQUER tarefa de teste ou scraping interativo.** Se precisa de navegação complexa, multi-step, screenshot cross-browser, preenchimento de formulários com validação → Playwright PRIMEIRO.

## Quando Invocar

- Ao **validar UI do index.html após deploy** (abrir home, clicar flip card, abrir view-shop, clicar bottom nav, voltar)
- Ao **criar testes E2E** para o PDV Balão (adicionar item carrinho, fechar compra, gerar QR code)
- Ao **fazer scraping interativo** (navegar múltiplas páginas, selecionar filtros de preço, adicionar ao carrinho confirmando estoque)
- Ao **gerar screenshot de página inteira** para documentação ou relatórios
- Ao **medir Core Web Vitals** localmente (LCP, INP, CLS) antes de publicar
- Ao **testar responsividade** em viewports 375px (mobile) / 768px (tablet) / 1440px (desktop)

## Instalação (2 opções)

### Opção A — Stdio (Local, rápido para testes rápidos)
```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest", "server"]
    }
  }
}
```

### Opção B — DOCKER (Recomendado! Isolamento + 1M+ downloads Docker Hub)
```json
{
  "mcpServers": {
    "playwright": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-p", "3000:3000", "mcr.microsoft.com/playwright:mcp"]
    }
  }
}
```
✅ Docker = sem dor de cabeça com versões Node.js, Chromium, Firefox, WebKit. Tudo já instalado na imagem oficial MSFT.

## 3 Navegadores Suportados (Cross-Testing)

| Navegador | Engine | Quando usar |
|---|---|---|
| 🟢 **Chromium** (Chrome/Edge) | Blink | 85% dos usuários Balão. Teste PADRÃO. |
| 🦊 **Firefox** | Gecko | Verificar compatibilidade (20% dos clientes corporativos usam Firefox) |
| 🍏 **WebKit** (Safari) | WebKit | 5% dos clientes iPhone/Mac. Validar layout no Safari sempre que usar CSS 3D (flip cards). |

## Ferramentas Principais

| Ferramenta | O que faz | Uso Balão |
|---|---|---|
| `browser_navigate` | Abre uma URL | Ir para http://localhost:8080 |
| `browser_click` | Clica em elemento botão/link | Clicar em "🛒 Loja" no bottom nav → ver se view-shop abre |
| `browser_type` | Preenche input/textarea | Testar busca global com Ctrl+K + digitar "monitor RTX" → Enter → vê se redireciona para view-shop |
| `browser_snapshot` | Pega estrutura acessibilidade da página | Verifica se todos os botões dos flip cards existem após clique |
| `browser_take_screenshot` | Tira screenshot (full page ou elemento) | Documentar visual da home + view-shop após alterações |
| `browser_select_option` | Seleciona opção em `<select>` | Testar seleção de status OS no módulo técnico |
| `browser_press_key` | Envia tecla (Enter, Ctrl+K, ESC) | Testar atalhos: Ctrl+K → foca busca | ESC → volta home |
| `browser_scroll` | Scrolla página | Verificar se footer carrega e bottom nav continua fixo |
| `browser_get_attribute` | Pega atributo de elemento | Verificar alt img produto, href de links, classes CSS ativas |
| `browser_wait_for` | Espera por condição (tempo ou elemento) | Espera animação flip card terminar (0.7s) antes de interagir com verso |
| `browser_console_messages` | Lê console do navegador | Pegar erros JavaScript em runtime |
| `browser_network_requests` | Lê requests rede | Verificar se API Firecrawl está carregando sem bloqueios CORS |

## Sentinela Kabum v2 (Playwright Interativo, receita pronta)

Comparado ao Firecrawl (que raspa dados), o Playwright simula USUÁRIO REAL:
1. `browser_navigate` → kabum.com.br
2. `browser_type` + Enter → "monitor samsung odyssey 27 144hz"
3. `browser_click` no primeiro resultado
4. `browser_wait_for` 2s (carregar página do produto)
5. Extrair: `preco_pix`, `estoque`, `disponibilidade_retirada_campinas`
6. `browser_click` em "Adicionar ao carrinho"
7. Ir para página do carrinho → confirmar se frete Campinas = grátis
8. Comparar com preço Balão → alertar se diferença > 5%
9. `browser_take_screenshot` full page → salvar como evidência

## Teste E2E Obrigatório Home Page Balão (Suite 13 casos)

```
CASE 1:  navegador abre http://localhost:8080
         → espera 1.5s → título contém "Balão da Informática Anchieta"
CASE 2:  bottom nav visível e fixado, 5 botões Inicio/PDV/Loja/Chat/Técnica
CASE 3:  clique em "🛒 Loja" bottom nav → view-shop abre com heading "Loja Virtual Balão"
CASE 4:  botão "← Voltar à Home" existe e clica → volta home
CASE 5:  clique simples em flip card Loja → gira 180deg CSS
CASE 6:  clique duplo <320ms no flip card → abre view-loja DIRETO (sem precisar virar)
CASE 7:  Ctrl+K pressionado → foco vai para input de busca global
CASE 8:  digita "pc gamer" + Enter → redireciona para view-shop
CASE 9:  ESC pressionado em view-shop → volta para home
CASE 10: scroll até final da página → footer com endereço, CNPJ, redes sociais carrega
CASE 11: viewport 375px (mobile) → flip card não usa preserve-3d (fallback)
CASE 12: viewport 1440px (desktop) → modules-grid = 3 colunas x 2 linhas (6 cards)
CASE 13: clique em "🔧 Técnica" bottom nav → view-tech abre com 4 OS cards coloridos
```

# Regras de teste:
- RODAR essa suite SEMPRE após alterar qualquer CSS, HTML ou JS do index.html
- Caso 13 casos PASS → pode publicar alteração
- Qualquer CASE falhando → corrigir antes de publicar

## Comparativo: Firecrawl vs Playwright

| Caso de Uso | Firecrawl MCP | Playwright MCP |
|---|---|---|
| Buscar preço rápido no Google ✅ | 🔥 Melhor (1 chamada) | ❌ Overkill |
| Scrape produto simples (dados só) ✅ | 🔥 Melhor | ❌ Overkill |
| Logar em painel fornecedor ✅ | 🔥 Melhor (interact + sessão) | ⚠️ Dá, mas trabalhoso |
| Navega multi-step (busca → clique → carrinho) | ⚠️ Dá com interact | 🔥 MELHOR |
| Teste de UI (clicar botões, formulários) | ❌ Não é propósito | 🔥 MELHOR |
| Cross-browser Chromium/Firefox/WebKit | ❌ Não | 🔥 MELHOR |
| Tirar screenshot com propósito QA | ❌ Screenshot simples | 🔥 Melhor (full page, por elemento, cross-browser) |
| Core Web Vitals LCP / INP / CLS | ❌ Não | 🔥 Melhor (mede direto no navegador) |
| Crawlar site 500 páginas async | 🔥 Melhor (crawl task async) | ❌ Overkill, demora muito |

## Segurança Docker
- Sempre rodar em container → NÃO precisa instalar Chromium local nem Node.js
- Navegador roda isolado, se o site tiver malware não infecta sua máquina
- Login em sites sensíveis (fornecedor, banco) → usar sessão descartável `--rm` (container morre ao final, sem cookies persistentes)


---
## REGRA MYBOTS
- Marca: Balão da Informática **Anchieta**.
- Envio/postagem ao cliente ou rede só com OK do Thiago.
