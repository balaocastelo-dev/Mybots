# MyBots Base — versão de produto (30/10/2026)

Cópia limpa do MyBots, sem nada de uma empresa específica. É daqui que sai a instalação
de qualquer cliente.

## O que saiu
- **Bots iniciais: nenhum.** A pasta `bots/` não existe. O sistema sobe vazio e o primeiro
  bot nasce pela tela de abertura.
- **Banco de dados**: nenhum. Sobe zerado (sem conversas, saberes, arquivos, rotinas).
- **Segredos**: `.env` não veio. Só `.env.example`.
- **Dados da loja**: catálogo de 6 mil produtos, agenda de 9 mil contatos, história da casa,
  vozes clonadas, marca. Tudo fora — inclusive por LGPD.
- **Ferramentas amarradas a uma empresa** (removidas da lista que o bot enxerga):
  `cameras` (automação de tela do programa de DVR, não portável), `agenda` (contatos),
  `catalogo_balao` (raspa um site específico), `redes_sociais` (contas fixas).
- **Scripts** de raspagem, câmeras (`sp-*.ps1`), ingestão do Obsidian, patches avulsos e
  logs. Sobraram os genéricos: instaladores, áudio, documento, e-mail, STT, navegador,
  capacidades, vídeo.
- **Identidade**: nome do dono, nome da empresa, site, contas sociais, cor da marca e ids
  de perfis de voz — trocados por valores neutros.

## O que ficou (o produto)
Hub + nó + UI + MCP, engines `direct` (Anthropic, Gemini, Nous, Ollama, OpenRouter, Groq,
LM Studio) e `opencode`, voz e chamada, aprovações, rotinas, grupos, memória e base de
conhecimento, trabalhos feitos, diagnóstico de bot caído, menu de contexto, parada total,
tela de abertura, testes.

## Antes de instalar em cliente — pendências conhecidas
1. `npm install && npm test` no Windows (não deu para rodar daqui: node_modules é de Windows).
2. **Caminhos fixos** `C:\Users\user\...` ainda existem em alguns scripts — varrer.
3. **Porta 8790 fixa** e a regra da 8787: virar configuração.
4. ~~Reserva fixa de RAM/VRAM~~ — **feito**: agora é 15% da máquina, piso 2 GB/1 GB,
   teto 12 GB/4 GB e nunca mais de 25% do total, então o bot fica sempre com pelo menos
   três quartos do PC. `MYBOTS_RESERVE_PCT` muda a porcentagem; `MYBOTS_RESERVE_RAM_GB`
   e `MYBOTS_RESERVE_VRAM_GB` fixam em GB. Ver `docs/ONBOARDING.md` para o primeiro dia.
5. **Catálogo genérico**: o cliente precisa de uma importação por CSV/planilha no lugar do
   raspador que saiu.
6. **Login no painel** e backup automático do banco: obrigatórios antes de expor.
7. Revisar `README.md` e `CLAUDE.md` — foram substituídos automaticamente, vale uma lida.
