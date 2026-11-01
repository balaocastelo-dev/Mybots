# Especialidades MyBots

Catálogo usado pelo Hub (`packages/hub/src/especialidades.ts`) e pelo diálogo Novo bot.

- `defaultId`: todo bot nasce com uma especialidade (Assistente geral se ninguém escolher).
- `skills/`: SKILL.md por habilidade; no create, o Hub grava saberes e embute na persona.
- `ferramentas`: nomes de TOOL_DEFS existentes.
- `mcpOpcionais`: servidores públicos sem chave; `enabled: false` no motor direct (MCP é do opencode). Nunca inventar keys.
