// Os primeiros passos de uma empresa nova — o roteiro que o Gerente cumpre sozinho.
//
// POR QUE ISTO É CÓDIGO E NÃO PERSONA. A persona do Gerente já mandava fazer uma
// apresentação em cinco partes, bem escrita, e o modelo devolveu um menu de bullets.
// Com modelo local fraco — ou com nenhuma chave configurada, que é a situação de todo
// cliente no primeiro minuto — instrução não vira comportamento. Aqui o Hub fala pelo
// Gerente e chama as ferramentas ele mesmo: sai igual toda vez, e sai mesmo antes de
// existir uma chave de modelo.
//
// O RITMO. Não despeja imagem, PDF e canais na mesma rajada. É uma coisa de cada vez:
// apresentação curta, os dados da empresa, o time com a folha, a imagem, os canais.
// Cada etapa espera "Pode seguir" ou "Pular".
//
// A REGRA QUE NÃO SE QUEBRA: falar para fora continua pedindo o OK. Aqui o OK é o
// próprio passo — ele digita o número porque QUER receber a mensagem. Nada sai para
// terceiro: tudo vai para o dono da casa, nos contatos que ele mesmo deu.
//
// SEGREDO NENHUM ENTRA NO BANCO. Senha de app e token do Telegram vão para o .env e a
// resposta dele é apagada da tabela de perguntas no mesmo instante. O que fica gravado
// é "guardado no .env", nunca o valor.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pecaDaDemo, type Dados, type PecaDemo } from "./demo.js";
import { logoNaPasta, textoDaEmpresa, textoDoTime } from "./folha.js";
import { pickVoice, synthesize } from "./voice.js";
import type { WhatsAppDasEmpresas } from "./whatsapp.js";

export type Anexo = { id: string; name: string; url: string; mime: string };

/** O que a sequência precisa do Hub. Interface pequena de propósito: o roteiro não enxerga o resto. */
export type HubParaPassos = {
  falar(botId: string, texto: string, anexos?: Anexo[]): void;
  perguntar(botId: string, questionId: string, pergunta: string, opcoes: string[]): void;
  fecharPergunta(questionId: string, respostaGravada: string): void;
  salvarArquivo(botId: string, nome: string, mime: string, data: Buffer): Anexo;
  empresa(empresaId: string): {
    id: string; nome: string; site?: string; instagram?: string; facebook?: string;
    resumo?: string; segmento?: string; regras?: string;
    contatos?: Dados["contatos"]; logo?: string;
  } | undefined;
  time?(empresaId: string): Array<{ nome: string; funcao?: string }>;
  anotacoes?(empresaId: string): Array<{ titulo: string; texto?: string; tipo?: string }>;
  memoria?(empresaId: string): Array<{ chave: string; valor: string }>;
  whats: WhatsAppDasEmpresas;
  lerEstado<T>(chave: string): T | undefined;
  gravarEstado(chave: string, valor: unknown): void;
  audit(botId: string | null, acao: string, detalhe: unknown): void;
  raizDoProjeto: string;
};

export const PASSOS = ["ola", "empresa", "time", "imagem", "whatsapp", "voz", "email", "telegram", "resumo", "fim"] as const;
export type Passo = (typeof PASSOS)[number];

type Estado = {
  empresaId: string;
  botId: string;
  passo: Passo;
  numero?: string;
  email?: string;
  emailLigado?: boolean;
  telegramLigado?: boolean;
  pecas: Array<{ tipo: string; nome: string; url: string; mime: string }>;
  comecou: number;
};

const chaveDe = (empresaId: string) => `primeirospassos:${empresaId}`;

/** Só dígitos, com o 55 na frente. Aceita "19 99999-8888", "+55 19 ...", "5519...". */
export function numeroWhats(bruto: string): string | null {
  const d = String(bruto ?? "").replace(/\D+/g, "");
  if (d.length < 10) return null;
  const com55 = d.startsWith("55") ? d : "55" + d;
  if (com55.length < 12 || com55.length > 13) return null;
  return com55;
}

export function pareceEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s ?? "").trim());
}

/**
 * Cada etapa da chegada espera um "pode seguir" ou um "pular".
 * Pular salta aquela parte e continua na próxima — não despeja o resto junto.
 */
export function proximoDepoisDe(passo: Passo, pular: boolean): Passo | null {
  if (passo === "ola") return pular ? "time" : "empresa";
  if (passo === "empresa") return pular ? "imagem" : "time";
  if (passo === "time") return pular ? "whatsapp" : "imagem";
  if (passo === "imagem") return pular ? "resumo" : "whatsapp";
  return null;
}

export class PrimeirosPassos {
  /** questionId → o que fazer com a resposta */
  private esperando = new Map<string, { empresaId: string; passo: Passo }>();
  /** url → anexo + bytes, guardados no momento em que a peça nasce. Evita caçar o arquivo no disco depois. */
  private salvos = new Map<string, { anexo: Anexo; data: Buffer }>();

  constructor(private hub: HubParaPassos, private gerar: typeof pecaDaDemo = pecaDaDemo) {}

  /** O `salvar` que a demo.ts espera, guardando de lado o id e os bytes. */
  private guardador(botId: string) {
    return (nome: string, mime: string, data: Buffer) => {
      const f = this.hub.salvarArquivo(botId, nome, mime, data);
      const anexo: Anexo = { id: f.id, name: f.name, url: f.url, mime: f.mime };
      this.salvos.set(f.url, { anexo, data });
      return { url: f.url, name: f.name };
    };
  }

  private ler(empresaId: string): Estado | undefined {
    return this.hub.lerEstado<Estado>(chaveDe(empresaId));
  }

  private gravar(e: Estado) {
    this.hub.gravarEstado(chaveDe(e.empresaId), e);
  }

  /** Chamado quando a empresa nasce e o Gerente dela fica online. */
  async iniciar(botId: string, empresaId: string): Promise<void> {
    if (this.ler(empresaId)) return; // já rodou uma vez; não repete a boas-vindas
    await this.rodar(botId, empresaId);
  }

  /**
   * Recomeça do zero (botão "fazer de novo" / teste).
   *
   * Não apaga o estado antigo para depois recriar: gravar `undefined` no settings
   * quebra a coluna NOT NULL — foi o primeiro defeito que este roteiro teve. Aqui o
   * estado novo simplesmente escreve por cima.
   */
  async refazer(botId: string, empresaId: string): Promise<void> {
    // Cartão da rodada anterior na tela é cartão órfão: ele clica e nada acontece.
    for (const [id, alvo] of [...this.esperando]) {
      if (alvo.empresaId !== empresaId) continue;
      this.esperando.delete(id);
      this.hub.fecharPergunta(id, "(refeito)");
    }
    await this.rodar(botId, empresaId);
  }

  private async rodar(botId: string, empresaId: string): Promise<void> {
    const e: Estado = { empresaId, botId, passo: "ola", pecas: [], comecou: Date.now() };
    this.gravar(e);
    this.hub.audit(botId, "primeirospassos.inicio", { empresaId });
    await this.ola(e);
  }

  /** O chefe respondeu um cartão. Devolve true se a pergunta era desta sequência. */
  responder(questionId: string, resposta: string): boolean | Promise<void> {
    const alvo = this.esperando.get(questionId);
    if (!alvo) return false;
    this.esperando.delete(questionId);
    const e = this.ler(alvo.empresaId);
    const segredo = alvo.passo === "email" || alvo.passo === "telegram";
    // a resposta some da tabela antes de qualquer outra coisa quando pode ser segredo
    this.hub.fecharPergunta(questionId, segredo ? "(guardado fora do banco)" : resposta);
    if (!e) return true;
    return this.continuar(e, alvo.passo, resposta).catch((err) => {
      this.hub.falar(e.botId, "Travei neste passo: " + (err as Error).message + "\n\nNão perdi o resto — me diga \"continuar\" que eu sigo do próximo.");
    });
  }

  /**
   * Readota as perguntas que ficaram abertas quando o Hub caiu ou reiniciou.
   *
   * O mapa `esperando` vive na memória. Sem isto, reiniciar no meio da sequência deixa
   * o cartão na tela do chefe e ninguém do outro lado para receber a resposta: ele
   * clica e não acontece nada, que é o pior defeito possível em uma boas-vindas.
   * O id carrega tudo que preciso: pp_<empresa>_<passo>_<carimbo>.
   */
  retomar(pendentes: Array<{ id: string }>) {
    for (const q of pendentes) {
      if (!q.id.startsWith("pp_")) continue;
      const partes = q.id.split("_");
      if (partes.length < 4) continue;
      let passo = partes[partes.length - 2] as Passo;
      const empresaId = partes.slice(1, partes.length - 2).join("_");
      // Roteiro antigo chamava o primeiro passo de "apresentacao" e despejava tudo.
      if ((passo as string) === "apresentacao") passo = "ola";
      if (!PASSOS.includes(passo)) continue;
      this.esperando.set(q.id, { empresaId, passo });
    }
  }

  private pergunta(e: Estado, passo: Passo, texto: string, opcoes: string[]) {
    const id = "pp_" + e.empresaId + "_" + passo + "_" + Date.now().toString(36);
    this.esperando.set(id, { empresaId: e.empresaId, passo });
    this.hub.perguntar(e.botId, id, texto, opcoes);
  }

  private async continuar(e: Estado, passo: Passo, resposta: string): Promise<void> {
    const r = String(resposta ?? "").trim();
    const pular = /^(pular|depois|agora n[aã]o|n[aã]o)/i.test(r);
    const seguinte = proximoDepoisDe(passo, pular);
    if (seguinte) return this.irPara(e, seguinte);
    switch (passo) {
      case "whatsapp": return pular ? this.irPara(e, "voz") : this.whatsappComNumero(e, r);
      case "voz": return this.voz(e);
      case "email": return pular ? this.irPara(e, "telegram") : this.email(e, r);
      case "telegram": return pular ? this.irPara(e, "resumo") : this.telegram(e, r);
      default: return this.irPara(e, "fim");
    }
  }

  private async irPara(e: Estado, passo: Passo): Promise<void> {
    e.passo = passo;
    this.gravar(e);
    switch (passo) {
      case "ola": return this.ola(e);
      case "empresa": return this.dadosDaEmpresa(e);
      case "time": return this.time(e);
      case "imagem": return this.imagem(e);
      case "whatsapp": return this.whatsapp(e);
      case "voz": return this.voz(e);
      case "email": return this.pedirEmail(e);
      case "telegram": return this.pedirTelegram(e);
      case "resumo": return this.resumo(e);
      default: return this.fim(e);
    }
  }

  // ---------------------------------------------------------------- 1. apresentação

  /** O que a folha e as falas usam: ficha gravada, anotações e o time desta empresa. */
  private ficha(e: Estado): Dados {
    const emp = this.hub.empresa(e.empresaId);
    const nome = emp?.nome ?? "a sua empresa";
    return {
      nome,
      site: emp?.site,
      instagram: emp?.instagram,
      facebook: emp?.facebook,
      segmento: emp?.segmento,
      resumo: emp?.resumo,
      regras: emp?.regras,
      contatos: emp?.contatos,
      logo: emp?.logo || logoNaPasta(path.join(this.hub.raizDoProjeto, "dados", "empresas", e.empresaId)),
      time: this.hub.time?.(e.empresaId) ?? [],
      anotacoes: this.hub.anotacoes?.(e.empresaId) ?? [],
      memoria: this.hub.memoria?.(e.empresaId) ?? [],
    };
  }

  /** 1. Uma apresentação curta. O resto espera o chefe seguir ou pular. */
  private async ola(e: Estado): Promise<void> {
    const nome = this.hub.empresa(e.empresaId)?.nome ?? "a sua empresa";
    this.hub.falar(e.botId,
      "Oi. Eu sou o Gerente Geral da " + nome + ".\n\n" +
      "Meu trabalho é fazer a equipe de robôs desta casa existir e funcionar: eu monto os bots, " +
      "ligo os canais e cuido para que nada caia em silêncio.\n\n" +
      "Vou te mostrar aos poucos — o que eu já sei da empresa, o time com a folha de apresentação, " +
      "uma imagem e os canais. Em cada passo você segue ou pula.");
    this.pergunta(e, "ola", "Posso te mostrar o que já sei da " + nome + "?", ["Pode seguir", "Pular"]);
  }

  /** 2. Os dados da empresa, em texto. A folha vem no passo seguinte. */
  private async dadosDaEmpresa(e: Estado): Promise<void> {
    this.hub.falar(e.botId, textoDaEmpresa(this.ficha(e)));
    this.pergunta(e, "empresa", "Sigo para o time e a folha de apresentação?", ["Pode seguir", "Pular"]);
  }

  /** 3. O time, e a folha com a cara da casa. */
  private async time(e: Estado): Promise<void> {
    const dados = this.ficha(e);
    this.hub.falar(e.botId, textoDoTime(dados));
    const pdf = await this.gerar("pdf", dados, this.guardador(e.botId)).catch((err): PecaDemo => ({ tipo: "pdf", titulo: "Um PDF", texto: "", erro: (err as Error).message }));
    this.mostrar(e, pdf, "pdf");
    this.gravar(e);
    this.pergunta(e, "time", "Quer ver uma imagem feita agora, a partir disso?", ["Pode seguir", "Pular"]);
  }

  /** 4. A imagem. Os canais vêm depois, se ele quiser. */
  private async imagem(e: Estado): Promise<void> {
    const imagem = await this.gerar("imagem", this.ficha(e), this.guardador(e.botId)).catch((err): PecaDemo => ({ tipo: "imagem", titulo: "Uma imagem", texto: "", erro: (err as Error).message }));
    this.mostrar(e, imagem, "imagem");
    this.gravar(e);
    this.pergunta(e, "imagem", "Agora os canais. Começo pelo WhatsApp?", ["Pode seguir", "Pular"]);
  }

  /** Põe a peça no chat como anexo de verdade, ou diz em uma linha por que não saiu. */
  private mostrar(e: Estado, p: PecaDemo, tipo: string) {
    if (p.erro || !p.url) {
      this.hub.falar(e.botId, "(" + (p.titulo || tipo) + ": não saiu agora — " + (p.erro ?? "sem arquivo") + ". Não é impeditivo, sigo.)");
      return;
    }
    const guardado = this.salvos.get(p.url);
    if (!guardado) { this.hub.falar(e.botId, "**" + p.titulo + "** — " + p.texto); return; }
    e.pecas.push({ tipo, nome: guardado.anexo.name, url: guardado.anexo.url, mime: guardado.anexo.mime });
    this.hub.falar(e.botId, "**" + p.titulo + "** — " + p.texto, [guardado.anexo]);
  }

  // ------------------------------------------------------------------- 2. WhatsApp

  /** "Vou te mandar um WhatsApp." Primeiro o número da empresa precisa estar de pé. */
  private async whatsapp(e: Estado): Promise<void> {
    const nome = this.hub.empresa(e.empresaId)?.nome ?? "a empresa";
    const st = this.hub.whats.estado(e.empresaId);
    if (st.estado !== "conectado") {
      this.hub.falar(e.botId,
        "**Primeiro canal: o WhatsApp da " + nome + ".**\n\n" +
        "Esta empresa vai ter o número dela, separado do seu pessoal. Para ligar, é o mesmo QR do " +
        "WhatsApp Web: eu gero aqui e você lê com o celular que vai ser o número da empresa.");
      const qr = await this.gerarQr(e);
      if (!qr) {
        this.hub.falar(e.botId, "Não consegui gerar o QR agora. Dá para ligar depois em **Empresas → Gerar QR** — sigo para o próximo passo.");
        return this.irPara(e, "voz");
      }
      this.pergunta(e, "whatsapp", "Leu o QR? Então me diga o seu número de WhatsApp (com DDD) que eu te mando uma mensagem agora.", ["Pular o WhatsApp"]);
      return;
    }
    this.hub.falar(e.botId, "**O WhatsApp da empresa já está conectado** (" + (st.numero ?? "número ativo") + "). Vou usar ele.");
    this.pergunta(e, "whatsapp", "Me diga o seu número de WhatsApp (com DDD) que eu te mando uma mensagem agora.", ["Pular o WhatsApp"]);
  }

  /** Gera o QR e põe no chat como imagem — ninguém devia ter que mudar de tela para isto. */
  private async gerarQr(e: Estado): Promise<boolean> {
    void this.hub.whats.conectar(e.empresaId).catch(() => {});
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const st = this.hub.whats.estado(e.empresaId);
      if (st.estado === "conectado") { this.hub.falar(e.botId, "Conectado: " + (st.numero ?? "número da empresa") + "."); return true; }
      if (st.estado === "qr" && st.qr) {
        const base64 = st.qr.split(",")[1] ?? "";
        if (!base64) continue;
        const f = this.hub.salvarArquivo(e.botId, "qr-whatsapp-" + e.empresaId + ".png", "image/png", Buffer.from(base64, "base64"));
        this.hub.falar(e.botId, "Aqui está o QR. No celular: **WhatsApp → Aparelhos conectados → Conectar aparelho**.", [f]);
        return true;
      }
    }
    return false;
  }

  private async whatsappComNumero(e: Estado, bruto: string): Promise<void> {
    const numero = numeroWhats(bruto);
    if (!numero) {
      this.pergunta(e, "whatsapp", "Não entendi esse número. Me manda com DDD, assim: 19 99999-8888.", ["Pular o WhatsApp"]);
      return;
    }
    e.numero = numero;
    this.gravar(e);
    const nome = this.hub.empresa(e.empresaId)?.nome ?? "sua empresa";
    const texto = "Aqui é o Gerente Geral da " + nome + ", falando pelo MyBots.\n\n" +
      "Esta mensagem saiu sozinha, do WhatsApp da empresa, sem ninguém digitar. " +
      "É por aqui que os bots vão falar com cliente — e tudo que sair para fora passa pelo seu OK antes.";
    const r = await this.hub.whats.enviar(e.empresaId, numero, texto).catch((err) => ({ ok: false, detalhe: (err as Error).message }));
    this.hub.audit(e.botId, "primeirospassos.whatsapp", { ok: r.ok, numero: numero.slice(0, 4) + "…" });
    this.hub.falar(e.botId, r.ok
      ? "**Mandei.** Olha o seu WhatsApp — a mensagem chegou do número da empresa, não do meu."
      : "O envio falhou: " + r.detalhe + ". Sigo para o próximo e a gente volta nisso.");
    await this.irPara(e, "voz");
  }

  // ----------------------------------------------------------------------- 3. voz

  /** A voz do bot, gravada agora a partir do texto. Vai no chat e, se der, no WhatsApp. */
  private async voz(e: Estado): Promise<void> {
    const nome = this.hub.empresa(e.empresaId)?.nome ?? "a empresa";
    this.hub.falar(e.botId, "**Segunda coisa: a voz.** Eu não leio texto pronto — eu falo. Gravando agora:");
    const fala = "Oi. Aqui é o Gerente Geral da " + nome + ". Esta gravação foi feita no momento em que você está lendo, " +
      "a partir do texto que eu mesmo escrevi. Todo bot da casa pode ter a voz dele, e pode atender no telefone com ela.";
    try {
      const voz = pickVoice(e.botId);
      const { audio, mime } = await synthesize(fala, voz);
      const f = this.hub.salvarArquivo(e.botId, "voz-do-gerente.mp3", mime || "audio/mpeg", audio);
      e.pecas.push({ tipo: "audio", nome: f.name, url: f.url, mime: f.mime });
      this.gravar(e);
      this.hub.falar(e.botId, "Toca aí — é a minha voz, no texto acima.", [f]);

      if (e.numero) {
        const r = await this.hub.whats.enviarArquivo(e.empresaId, e.numero, {
          base64: audio.toString("base64"), nome: "voz-do-gerente.mp3", mime: mime || "audio/mpeg",
          legenda: "O mesmo áudio, agora no seu WhatsApp.",
        }).catch((err) => ({ ok: false, detalhe: (err as Error).message }));
        this.hub.falar(e.botId, r.ok ? "E mandei o mesmo áudio no seu WhatsApp." : "(No WhatsApp o áudio não foi: " + r.detalhe + ")");
      }
    } catch (err) {
      this.hub.falar(e.botId, "A voz não saiu agora (" + (err as Error).message + "). Em geral é o motor de fala sem rede. Sigo.");
    }
    await this.irPara(e, "email");
  }

  // --------------------------------------------------------------------- 4. e-mail

  private async pedirEmail(e: Estado): Promise<void> {
    this.hub.falar(e.botId,
      "**Terceira coisa: o e-mail.** Quero te mandar um, escrito por mim.\n\n" +
      "Para isso preciso de uma conta Gmail que eu possa usar e de uma **senha de app** dela " +
      "(não é a sua senha normal: é uma de 16 letras que o Google gera em myaccount.google.com → Segurança → Senhas de app). " +
      "Ela vai para o arquivo .env da sua máquina. **Não entra no banco e eu nunca repito o valor dela.**");
    this.pergunta(e, "email",
      "Me manda numa linha só: **conta@gmail.com senha-de-app** — ou só o endereço, se quiser ligar o e-mail depois.",
      ["Pular o e-mail"]);
  }

  private async email(e: Estado, resposta: string): Promise<void> {
    const partes = String(resposta).trim().split(/\s+/);
    const conta = partes.find((p) => pareceEmail(p));
    const senha = partes.filter((p) => !pareceEmail(p)).join("").trim();
    if (!conta) {
      this.pergunta(e, "email", "Não achei um endereço de e-mail aí. Manda de novo: conta@gmail.com senha-de-app", ["Pular o e-mail"]);
      return;
    }
    e.email = conta;
    this.gravar(e);
    const nome = this.hub.empresa(e.empresaId)?.nome ?? "sua empresa";

    if (senha.length >= 12) {
      this.gravarNoEnv({ MYBOTS_EMAIL_USER: conta, MYBOTS_EMAIL_APP_PASSWORD: senha });
      e.emailLigado = true;
      this.gravar(e);
      this.hub.audit(e.botId, "primeirospassos.email.config", { conta, senha: "(no .env)" });
      this.hub.falar(e.botId, "Guardei a conta **" + conta + "** e a senha de app no .env. A senha não aparece em lugar nenhum além dele.");
      const r = await this.enviarEmail(conta, "A sua equipe de IA está de pé",
        "Este e-mail foi escrito e enviado por um robô — o Gerente Geral da " + nome + ".\n\n" +
        "Ninguém digitou nada: ele decidiu o assunto, o texto e a hora.\n\n" +
        "É assim que os bots vão responder cliente, mandar orçamento e avisar você quando algo precisar de decisão. " +
        "Todo envio para fora passa pelo seu OK antes de sair.");
      this.hub.falar(e.botId, r.ok ? "**Mandei o e-mail para " + conta + ".** Confere a caixa." : "O e-mail não saiu: " + r.erro);
    } else {
      this.hub.falar(e.botId,
        "Anotei **" + conta + "** como o seu endereço. Sem a senha de app eu ainda não consigo enviar — " +
        "quando você gerar, me diga \"e-mail: " + conta + " <senha>\" que eu ligo e mando na hora.");
    }
    await this.irPara(e, "telegram");
  }

  private enviarEmail(para: string, assunto: string, texto: string): Promise<{ ok: boolean; erro?: string }> {
    const script = path.join(this.hub.raizDoProjeto, "scripts", "email-tool.py");
    return new Promise((resolve) => {
      const tentar = (exes: string[]) => {
        const exe = exes[0];
        if (!exe) return resolve({ ok: false, erro: "python não encontrado" });
        const p = spawn(exe, [script, "enviar", "--para", para, "--assunto", assunto, "--texto", texto], { windowsHide: true, cwd: this.hub.raizDoProjeto });
        let err = "";
        p.stderr.on("data", (d) => { err += String(d); });
        p.on("error", () => tentar(exes.slice(1)));
        p.on("close", (c) => (c === 0 ? resolve({ ok: true }) : resolve({ ok: false, erro: err.split("\n").filter(Boolean).slice(-1)[0] ?? ("código " + c) })));
      };
      tentar([process.env.MYBOTS_PYTHON, "python", "py", "python3"].filter(Boolean) as string[]);
    });
  }

  // ------------------------------------------------------------------- 5. Telegram

  private async pedirTelegram(e: Estado): Promise<void> {
    this.hub.falar(e.botId,
      "**Quarta coisa: o Telegram.** É por onde você me dá ordem de qualquer lugar e eu te aviso sem você abrir o painel.\n\n" +
      "No Telegram, fale com o **@BotFather**, mande **/newbot**, escolha um nome, e ele devolve um token " +
      "parecido com `8123456789:AAG...`. Cola aqui. Vai para o .env, igual à senha do e-mail — **não entra no banco**.");
    this.pergunta(e, "telegram", "Cola o token do BotFather aqui.", ["Pular o Telegram"]);
  }

  private async telegram(e: Estado, resposta: string): Promise<void> {
    const token = String(resposta).trim().match(/\d{6,}:[A-Za-z0-9_-]{20,}/)?.[0];
    if (!token) {
      this.pergunta(e, "telegram", "Esse não parece um token do BotFather (o formato é 8123456789:AAG…). Cola de novo.", ["Pular o Telegram"]);
      return;
    }
    const quem = await this.conferirToken(token);
    if (!quem.ok) {
      this.pergunta(e, "telegram", "O Telegram recusou esse token (" + quem.erro + "). Confere no BotFather e cola de novo.", ["Pular o Telegram"]);
      return;
    }
    this.gravarNoEnv({ TELEGRAM_BOT_TOKEN: token, TELEGRAM_BOT_USERNAME: quem.username ?? "" });
    e.telegramLigado = true;
    this.gravar(e);
    this.hub.audit(e.botId, "primeirospassos.telegram.config", { username: quem.username, token: "(no .env)" });
    this.hub.falar(e.botId,
      "**Token aceito: @" + quem.username + ".** Guardei no .env.\n\n" +
      "Abre o Telegram, procura **@" + quem.username + "** e manda **/start**. " +
      "A ponte sobe no próximo reinício do Hub — aí você fala comigo por lá e eu te aviso por lá.");
    await this.irPara(e, "resumo");
  }

  private async conferirToken(token: string): Promise<{ ok: boolean; username?: string; erro?: string }> {
    try {
      const r = await fetch("https://api.telegram.org/bot" + token + "/getMe", { signal: AbortSignal.timeout(15000) });
      const j = (await r.json()) as any;
      if (!j?.ok) return { ok: false, erro: String(j?.description ?? ("HTTP " + r.status)) };
      return { ok: true, username: j.result?.username };
    } catch (err) {
      return { ok: false, erro: (err as Error).message };
    }
  }

  // --------------------------------------------------------------------- 6. resumo

  /** Fecha com um PDF do que foi ligado e manda pelos canais que passaram a existir. */
  private async resumo(e: Estado): Promise<void> {
    const emp = this.hub.empresa(e.empresaId);
    const nome = emp?.nome ?? "a empresa";
    const linhas = [
      "WhatsApp da empresa: " + (this.hub.whats.estado(e.empresaId).estado === "conectado" ? "ligado" : "ainda não ligado"),
      "Mensagem de teste: " + (e.numero ? "entregue no seu número" : "não enviada"),
      "Voz do Gerente: " + (e.pecas.some((p) => p.tipo === "audio") ? "gravada e entregue" : "não saiu"),
      "E-mail: " + (e.emailLigado ? "ligado em " + e.email : e.email ? "anotado (" + e.email + "), falta a senha de app" : "pulado"),
      "Telegram: " + (e.telegramLigado ? "token aceito, falta você mandar /start" : "pulado"),
    ];
    this.hub.falar(e.botId, "**Última coisa: o resumo.** Vou fechar isto num PDF e te mandar pelos canais que a gente acabou de ligar.");

    const salvar = this.guardador(e.botId);
    const peca = await this.gerar("recap", { nome, regras: linhas.join("\n") }, salvar)
      .catch((err): PecaDemo => ({ tipo: "pdf", titulo: "", texto: "", erro: (err as Error).message }));

    if (peca.erro || !peca.url) {
      this.hub.falar(e.botId, "O PDF do resumo não saiu (" + peca.erro + "). Fica o resumo em texto:\n\n- " + linhas.join("\n- "));
      return this.irPara(e, "fim");
    }
    const guardado = this.salvos.get(peca.url);
    if (guardado) this.hub.falar(e.botId, "O resumo do que a gente ligou:", [guardado.anexo]);

    if (e.numero && guardado) {
      const r = await this.hub.whats.enviarArquivo(e.empresaId, e.numero, { base64: guardado.data.toString("base64"), nome: guardado.anexo.name, mime: "application/pdf", legenda: "Resumo dos primeiros passos da " + nome + "." })
        .catch((err) => ({ ok: false, detalhe: (err as Error).message }));
      this.hub.falar(e.botId, r.ok ? "Mandei o PDF no seu WhatsApp." : "(No WhatsApp o PDF não foi: " + r.detalhe + ")");
    }
    if (e.emailLigado && e.email) {
      const r = await this.enviarEmail(e.email, "Primeiros passos da " + nome, "Segue o resumo do que ligamos agora:\n\n- " + linhas.join("\n- ") + "\n\n(O PDF está no painel, em Trabalhos feitos.)");
      this.hub.falar(e.botId, r.ok ? "E mandei por e-mail para " + e.email + "." : "(Por e-mail não foi: " + r.erro + ")");
    }
    await this.irPara(e, "fim");
  }

  private async fim(e: Estado): Promise<void> {
    this.hub.falar(e.botId,
      "Era isso. Em poucos minutos esta empresa passou a ter canal próprio, voz própria e um robô que trabalha sozinho.\n\n" +
      "O próximo passo de verdade é a equipe: eu monto os bots desta empresa, com nome e função, e cada um começa a trabalhar. " +
      "Me diga o que mais consome o seu dia e eu já crio o primeiro.");
    e.passo = "fim";
    this.gravar(e);
    this.hub.audit(e.botId, "primeirospassos.fim", { empresaId: e.empresaId, minutos: Math.round((Date.now() - e.comecou) / 60000) });
  }

  // ------------------------------------------------------------------------ .env

  /**
   * Grava chaves no .env da raiz sem mexer no resto do arquivo.
   *
   * Reescreve a linha se ela já existe, acrescenta se não. Nunca imprime o valor:
   * quem chama é que decide o que dizer ao chefe, e o que se diz é "guardei", não o quê.
   */
  private gravarNoEnv(pares: Record<string, string>) {
    const arq = path.join(this.hub.raizDoProjeto, ".env");
    let texto = "";
    try { texto = fs.readFileSync(arq, "utf8"); } catch { texto = ""; }
    for (const [k, v] of Object.entries(pares)) {
      if (!v) continue;
      const linha = k + "=" + v;
      const re = new RegExp("^" + k + "=.*$", "m");
      texto = re.test(texto) ? texto.replace(re, linha) : texto.replace(/\s*$/, "") + "\n" + linha + "\n";
    }
    fs.writeFileSync(arq, texto.replace(/^﻿/, ""), "utf8");
  }
}
