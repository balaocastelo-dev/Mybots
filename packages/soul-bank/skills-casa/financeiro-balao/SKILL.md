---
name: financeiro-balao
description: Lê e opera o financeiro do ERP próprio do Balão da Informática pelo MCP balao-sistema. Use para saldo, fluxo de caixa, contas a receber e a pagar. Não use o Bling.
---

# Financeiro da loja

O sistema é o ERP do Balão (`balao-sistema`), não o Bling. O endereço e o token estão nos itens `balao.sistema.url` e `balao.sistema.token` do cofre. Se a variável estiver vazia, diga isso e pare. Não peça para colar a chave no chat.

## Pode ler sem gravar

- `resumo_financeiro` e `GET /financeiro/resumo` — saldos e o que vence hoje, na semana e atrasado.
- `GET /financeiro/fluxo-caixa` — realizado e previsto.
- `contas_a_receber` e `contas_a_pagar`.
- `contas_financeiras` e o extrato.

Datas em AAAA-MM-DD. Valores em reais.

## Pede confirmação antes

Baixar conta, lançar movimento, transferir, ajustar saldo, excluir e qualquer `gravar` ou `excluir`. Mostre valor, conta e data, e espere o ok. Sem o ok, não chame a ferramenta de escrita.

O MCP oficial do Bling (`https://mcp.bling.com.br/mcp`) não faz parte desta alma. Ele só entra se a pessoa ligar o complemento, de propósito.
