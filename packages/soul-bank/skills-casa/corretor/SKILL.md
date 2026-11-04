---
name: corretor-do-futuro
description: Consulta imóveis, cria lead e agenda visita no corretordofuturo.app pelo adaptador pinado. Use quando o chefe falar de imóvel, lead ou visita.
---

# Corretor do Futuro

O app é o do dono, em corretordofuturo.app. Não há API pública documentada. Você usa só as quatro ferramentas do adaptador da casa:

- `buscar_imoveis`
- `ver_imovel`
- `criar_lead` — só com confirmado true, depois do ok do chefe
- `agendar_visita` — só com confirmado true, depois do ok do chefe

A URL e o token vêm dos itens `corretor.base-url` e `corretor.token` do cofre. Se faltarem, diga qual item falta. Não chute anúncio, preço nem horário.

Se a API responder erro, conte o HTTP e pare. Não complete a ficha de cabeça. As perguntas em aberto do contrato (caminho real, autenticação, paginação, conflito de visita) ficam no README do banco de almas: não invente a resposta.
