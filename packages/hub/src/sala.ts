// A sala: os bots conversando ENTRE SI, por turnos, com fim marcado.
//
// POR QUE POR TURNOS, E NAO SOLTOS: num grupo, a resposta de um bot ja chega aos
// outros (fanOutGroupReply), mas chega como "silent" — eles leem e nao respondem.
// Se a gente simplesmente tirasse esse silent, nove bots responderiam a cada fala
// de cada um: um turno viraria nove, nove virariam oitenta e um, e a conta da
// Anthropic subiria sem ninguem olhando. Entao aqui so UM bot fala por vez, a
// sala tem numero maximo de turnos, e qualquer fala do chefe para a sala na hora.
//
// A sala e conversa, nao e trabalho: nada de enviar, publicar, pagar ou apagar.

export type PontesDaSala = {
  membrosDoGrupo(groupId: string): string[] | undefined;
  nomeDoBot(botId: string): string;
  /** Entrega a vez a um bot. false = o PC dele esta fora do ar. */
  acordarBot(botId: string, conversationId: string, texto: string): boolean;
  /** Escreve na conversa SEM acordar ninguem (marcador). */
  anotar(conversationId: string, texto: string): void;
};

export type Sala = {
  groupId: string;
  conversationId: string;
  assunto: string;
  fila: string[];
  posicao: number;
  turno: number;
  maxTurnos: number;
  pausaMs: number;
  vazios: number;
  esperando: string | null;
  abertaEm: number;
};

const CAP_TURNOS = 36;
const PAUSA_PADRAO_S = 8;
const PACIENCIA_MS = 180_000;
const VAZIOS_PARA_FECHAR = 2;

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** "Nada a acrescentar" em qualquer vestimenta razoavel. */
export const nadaAAcrescentar = (texto: string): boolean => {
  const t = semAcento(texto).replace(/[.!…\s]+$/g, "");
  if (!t) return true;
  if (t.length > 60) return false;
  return /^(nada a acrescentar|sem nada a acrescentar|nada a add|nada a acrescer|concordo, nada a acrescentar)$/.test(t);
};

export class SalaDeConversa {
  private salas = new Map<string, Sala>();
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private p: PontesDaSala) {}

  ativas(): Sala[] {
    return [...this.salas.values()];
  }

  /** Abre a sala e da a vez ao primeiro. */
  abrir(groupId: string, assunto: string, opcoes: { voltas?: number; pausaSeg?: number } = {}): Sala | { error: string } {
    const membros = this.p.membrosDoGrupo(groupId);
    if (!membros) return { error: "esse grupo não existe" };
    if (membros.length < 2) return { error: "uma sala precisa de pelo menos 2 robôs" };
    if (!assunto.trim()) return { error: "diga o assunto da sala" };
    if (this.salas.has(groupId)) return { error: "essa sala já está aberta" };

    const voltas = Math.max(1, Math.min(6, Math.floor(opcoes.voltas ?? 2)));
    const sala: Sala = {
      groupId,
      conversationId: `group:${groupId}`,
      assunto: assunto.trim(),
      fila: [...membros],
      posicao: 0,
      turno: 0,
      maxTurnos: Math.min(CAP_TURNOS, membros.length * voltas),
      // A pausa é só pra dar ritmo de leitura. Quem segura a conta é o maxTurnos,
      // então zero é permitido (os testes usam isso) e negativo vira zero.
      pausaMs: Math.max(0, Math.round((opcoes.pausaSeg ?? PAUSA_PADRAO_S) * 1000)),
      vazios: 0,
      esperando: null,
      abertaEm: Date.now(),
    };
    this.salas.set(groupId, sala);
    this.p.anotar(sala.conversationId, `Sala aberta — ${sala.assunto} · ${sala.fila.length} robôs · até ${sala.maxTurnos} falas`);
    this.proximo(sala);
    return sala;
  }

  /** Um bot acabou de falar nesta conversa. */
  respondeu(conversationId: string, botId: string, texto: string): void {
    const sala = [...this.salas.values()].find((s) => s.conversationId === conversationId);
    if (!sala || sala.esperando !== botId) return;
    sala.esperando = null;
    this.limparTimer(sala.groupId);
    sala.vazios = nadaAAcrescentar(texto) ? sala.vazios + 1 : 0;
    if (sala.vazios >= VAZIOS_PARA_FECHAR) {
      this.fechar(sala.groupId, "assunto esgotado — ninguém tinha mais o que acrescentar");
      return;
    }
    if (sala.turno >= sala.maxTurnos) {
      this.fechar(sala.groupId, `acabaram as ${sala.maxTurnos} falas combinadas`);
      return;
    }
    this.agendar(sala, sala.pausaMs, () => this.proximo(sala));
  }

  /** O chefe falou: a sala para e devolve a palavra a ele. */
  pausarPorHumano(conversationId: string): void {
    const sala = [...this.salas.values()].find((s) => s.conversationId === conversationId);
    if (sala) this.fechar(sala.groupId, "o chefe entrou na conversa");
  }

  parar(groupId: string): boolean {
    if (!this.salas.has(groupId)) return false;
    this.fechar(groupId, "parada por você");
    return true;
  }

  pararTudo(): void {
    for (const id of [...this.salas.keys()]) this.fechar(id, "o Hub está desligando");
  }

  // ---------- por dentro ----------

  private proximo(sala: Sala): void {
    if (!this.salas.has(sala.groupId)) return;
    if (sala.turno >= sala.maxTurnos) {
      this.fechar(sala.groupId, `acabaram as ${sala.maxTurnos} falas combinadas`);
      return;
    }
    // Procura o proximo que esteja de pe; se a volta inteira estiver offline, fecha.
    for (let tentativas = 0; tentativas < sala.fila.length; tentativas++) {
      const botId = sala.fila[sala.posicao % sala.fila.length];
      sala.posicao++;
      sala.turno++;
      if (this.p.acordarBot(botId, sala.conversationId, this.recado(sala, botId))) {
        sala.esperando = botId;
        this.agendar(sala, PACIENCIA_MS, () => {
          if (sala.esperando !== botId) return;
          sala.esperando = null;
          this.p.anotar(sala.conversationId, `${this.p.nomeDoBot(botId)} não respondeu a tempo — passando a vez`);
          this.proximo(sala);
        });
        return;
      }
      sala.turno--; // offline nao gasta turno de ninguem
    }
    this.fechar(sala.groupId, "nenhum robô da sala está online");
  }

  private recado(sala: Sala, botId: string): string {
    return [
      `[sala] Assunto: ${sala.assunto}`,
      `Sua vez de falar, ${this.p.nomeDoBot(botId)}. Fala ${sala.turno} de ${sala.maxTurnos}.`,
      "",
      "Como se fala nesta sala:",
      "- No máximo 4 linhas. Fale só do que é da SUA alçada.",
      "- Não repita o que um colega já disse: some alguma coisa, ou discorde dizendo por quê.",
      "- Se o assunto é de outro, chame ele pelo nome e devolva: \"Gerente, essa parte é tua\".",
      "- Termine com UMA coisa concreta: uma proposta, um número, ou uma pergunta a um colega específico.",
      "- Se você não tem nada útil a acrescentar, responda exatamente: nada a acrescentar",
      "- Aqui é conversa, não é execução: nada de enviar, publicar, pagar, apagar ou instalar.",
    ].join("\n");
  }

  private fechar(groupId: string, motivo: string): void {
    const sala = this.salas.get(groupId);
    if (!sala) return;
    this.limparTimer(groupId);
    this.salas.delete(groupId);
    this.p.anotar(sala.conversationId, `Sala encerrada — ${motivo} · ${sala.turno} falas`);
  }

  private agendar(sala: Sala, ms: number, fn: () => void): void {
    this.limparTimer(sala.groupId);
    const t = setTimeout(() => { this.timers.delete(sala.groupId); fn(); }, ms);
    if (typeof t.unref === "function") t.unref();
    this.timers.set(sala.groupId, t);
  }

  private limparTimer(groupId: string): void {
    const t = this.timers.get(groupId);
    if (t) { clearTimeout(t); this.timers.delete(groupId); }
  }
}
