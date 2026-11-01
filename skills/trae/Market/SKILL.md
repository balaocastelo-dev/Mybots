---
name: "MCP-Market-Intelligence"
description: "Sentinela de inteligência de mercado: monitora Kabum, concorrentes, preços e promoções. Invocar ao analisar precificação, buscar produtos ou ativar monitoramento contínuo de 69s."
---

# MCP Market Intelligence — Balão da Informática

Agregador de capacidades inspirado nas categorias MCP:
🔎 Pesquisa & Extração · 📊 Monitoramento · 💰 Finanças · 🎯 Marketing · 🗺️ Localização

## Quando Invocar

- Quando usuário pedir para "monitorar Kabum" ou "sentinela de preços"
- Quando precisar buscar dados de produtos da concorrência em tempo real
- Quando analisar estratégia de precificação PIX (-15%) e parcelamento
- Quando mapear lançamentos de hardware (RTX, Ryzen, Intel, Apple)
- Quando ativar ciclo de polling 69s do sistema de sentinelas

## Sentinelas Core

| Sentinela | Polling | Categoria MCP |
|---|---|---|
| 🕵️ Monitor Kabum | 69s | 🔎 Pesquisa & Extração + 📊 Monitoramento |
| 📊 Concorrentes | 69s | 📊 Monitoramento + 💰 Finanças |
| 🏪 Google Maps | 3min | 🗺️ Serviços de Localização |
| 💹 Cotação Dólar | 5min | 💰 Finanças & Fintech |

## Workflow Operação

1. **Ciclo 69s**: `browser_navigate` → extrai cada concorrente (Kabum, Pichau, Terabyte)
2. **Extrai**: nome do produto, preço PIX, preço parcelado, estoque, frete grátis
3. **Compara**: banco de dados interno da Balão (Supabase)
4. **Alerta**: se preço concorrente < preço Balão → sugere reajuste ou campanha
5. **Relatório**: gera tabela comparativa com destaques

## Categorias MCP que essa skill unifica

- 🔎 **Pesquisa & Extração**: ashra-mcp, playwright-mcp (Microsoft), puppeteer, web-search
- 📊 **Monitoramento**: Prometheus, Grafana, New Relic MCPs
- 💰 **Finanças**: Coinmarket, AWS Pricing, Octagon AI
- 🎯 **Marketing**: HubSpot, Meta Ads, Google Ads
- 🗺️ **Localização**: Google Maps, Mapbox, OpenStreetMap
- 🧮 **Data Science**: Pandas, NumPy, Matplotlib (Fermat MCP)


---
## REGRA MYBOTS
- Marca: Balão da Informática **Anchieta**.
- Envio/postagem ao cliente ou rede só com OK do Thiago.
