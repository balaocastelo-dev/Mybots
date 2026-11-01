import { useEffect, useState } from "react";
import type { BotSummary, ControlMode, Group, Routine } from "@mybots/shared";
import { CONTROL_DESCRIPTIONS, CONTROL_LABELS, CONTROL_MODES } from "@mybots/shared";
import { desintegrarAvatar } from "./particulas";
import { LendoSite } from "./lendo";
import { PcDaEmpresa } from "./pc";
import { CelularDaEmpresaPainel } from "./celularEmpresa";
import { TelaLegal } from "./legal";
import { TelaCreditos } from "./creditos";
import { api } from "./api";
import { confirmDeus } from "./controles";
import { RetratoPreview } from "./avatar";
import { AMEBAS_V2_TODOS, amebaV2Path, amebaV2Num, amebaV2StoragePath, sortearAmebaV2, isAmebaV2 } from "./amebasV2";
import { CRON_PRESETS } from "./mensagem";

export function RoutinesPanel({ bot, routines, onClose }: { bot: BotSummary; routines: Routine[]; onClose: () => void }) {
  const [name, setName] = useState("");
  const [cron, setCron] = useState("0 8 * * *");
  const [prompt, setPrompt] = useState("");
  const [err, setErr] = useState("");
  const create = async () => {
    setErr("");
    const r = await api("/routines", { method: "POST", body: JSON.stringify({ botId: bot.id, name, cron, prompt }) });
    if (!r.ok) { setErr((await r.json()).error ?? "erro"); return; }
    setName(""); setPrompt("");
  };
  return (
    <div className="panel">
      <div className="panel-head"><b>⏰ Rotinas de {bot.name}</b><button className="link" onClick={onClose}>fechar</button></div>
      {routines.length === 0 && <div className="hint">Nenhuma rotina. Crie uma abaixo — ou peça ao bot: "toda segunda às 8h, confira o o ERP".</div>}
      {routines.map((r) => (
        <div key={r.id} className={"routine" + (r.enabled ? "" : " off")}>
          <div className="routine-main"><b>{r.name}</b> <code>{r.cron}</code><div className="routine-prompt">{r.prompt}</div><small>{r.nextRun ? "próxima: " + new Date(r.nextRun).toLocaleString("pt-BR") : ""}{r.lastRun ? " · última: " + new Date(r.lastRun).toLocaleString("pt-BR") : ""}</small></div>
          <div className="routine-actions">
            <button className="btn" onClick={() => api(`/routines/${r.id}/run`, { method: "POST" })}>Rodar agora</button>
            <button className="btn" onClick={() => api(`/routines/${r.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !r.enabled }) })}>{r.enabled ? "Pausar" : "Ativar"}</button>
            <button className="btn danger" onClick={() => { if (confirm(`Apagar a rotina "${r.name}"?`)) void api(`/routines/${r.id}`, { method: "DELETE" }); }}>Apagar</button>
          </div>
        </div>
      ))}
      <div className="routine-form">
        <input placeholder="Nome (ex.: Conferir o o ERP)" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="row">
          <input placeholder="cron: min hora dia mês dia-semana" value={cron} onChange={(e) => setCron(e.target.value)} />
          <select value="" onChange={(e) => { if (e.target.value) setCron(e.target.value); }}>
            <option value="">atalhos…</option>
            {CRON_PRESETS.map(([l, c]) => <option key={c} value={c}>{l}</option>)}
          </select>
        </div>
        <textarea placeholder="O que o bot deve fazer nesse horário" rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        {err && <div className="err">{err}</div>}
        <button className="btn primary" disabled={!cron || !prompt.trim()} onClick={create}>Criar rotina</button>
      </div>
    </div>
  );
}

export function NewGroupDialog({ bots, onClose, onCreated }: { bots: BotSummary[]; onClose: () => void; onCreated: (g: Group) => void }) {
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const create = async () => {
    const r = await api("/groups", { method: "POST", body: JSON.stringify({ name: name || "Grupo", members }) });
    if (r.ok) onCreated(await r.json());
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Novo grupo</h3>
        <input placeholder="Nome do grupo (ex.: Equipe de vídeo)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div className="checks">
          {bots.map((b) => (
            <label key={b.id}><input type="checkbox" checked={members.includes(b.id)} onChange={(e) => setMembers(e.target.checked ? [...members, b.id] : members.filter((m) => m !== b.id))} /> {b.name} <small>{b.role}</small></label>
          ))}
        </div>
        <div className="card-actions">
          <button className="btn primary" disabled={members.length < 1} onClick={create}>Criar</button>
          <button className="btn" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}


// ---------------- criar e configurar bots ----------------

export type ProviderInfo = { kind: string; label: string; engines: string[]; needsKey: boolean; keyEnv: string; defaultModel: string; defaultBaseURL?: string; models: string[]; chaveDaCasa?: boolean };

export function usePresets() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [voices, setVoices] = useState<Array<{ valor: string; nome: string; clonada?: boolean }>>([]);
  useEffect(() => {
    api("/providers").then((r) => r.json()).then(setProviders).catch(() => {});
    api("/voice/voices").then((r) => r.json()).then(setVoices).catch(() => {});
  }, []);
  return { providers, voices };
}

/** Como todo bot nasce: no Claude, motor direto, sem ninguem digitar chave.
 *  A chave fica no .env do Hub e chega ao bot pelo ambiente do processo. */
export const PADRAO_DA_CASA = { engine: "direct", provider: { kind: "zai", model: "glm-4.5-flash" } };

export type EspecialidadeResumo = { id: string; nome: string; emoji?: string; cor?: string; skills?: string[]; onboarding?: string };

export function personaTemplateComEsp(name: string, role: string, esp?: EspecialidadeResumo | null) {
  const roleFinal = role || esp?.nome || "Assistente";
  const skills = esp?.skills?.length ? ("\n\n## Skills / ferramentas da especialidade\n" + esp.skills.map((x) => "- " + x).join("\n")) : "";
  const onb = esp?.onboarding ? ("\n\n## Primeira tarefa (onboarding)\n" + esp.onboarding) : "";
  const espBloco = esp ? ("\n\n## Especialidade: " + esp.nome + "\nVoce NASCEU especialista em " + esp.nome + "." + skills + onb) : "";
  return "## SOUL\nSou proativo e resolvedor de problemas. Vou pra frente: resolvo primeiro, pergunto so quando e realmente decisao do Thiago (enviar mensagem/email, apagar, pagar) ou falta um dado que nao consigo achar. Faco mais do que pergunto. Quando algo falha, tento outro caminho antes de desistir, e entrego o resultado pronto. Nunca invento dados.\n\n## §8 DOCUMENTOS PDF\nGero documentos PDF como artista: grid, margem mínima (@page 4 mm), no máx. 2 fontes (Montserrat/Inter), 1 cor de marca (#E83030) + neutros. **Folha em 3 zonas:** (1) cabeçalho fixo no topo; (2) conteúdo no meio ocupando toda a altura disponível (`#corpo` flex:1 + space-between — sem buraco branco); (3) **bloco de assinaturas sempre colado embaixo**, antes do rodapé fixo. Logo no cabeçalho **40% maior (×1,4)** (50,4 px / max-width 224 px), **cores chapadas, opacidade 100%**. **Hero padrão = fachada Anchieta 789** (`img/fachada-hero.jpg` / `fachada-pdf.jpg`); crédito de recriação ilustrativa quando couber. Miniaturas **só na tabela** de itens (sem faixa acima de Itens). **Orçamento, venda e NF = 1 folha A4**; conteúdo curto expande o meio; conteúdo longo → zoom só em `#corpo` (`gerar-pdf-1folha.mjs`) — nunca `height:auto` no `#corpo`. Cabeçalho, assinaturas e rodapé não escalam. Templates em C:\\Users\\user\\Desktop\\MyBots-Base\\templates-pdf\\. Esses templates valem para TODO PDF. Antes de entregar: renderizo, `pdfinfo Pages: 1`, PNG da página 1 e reviso (assinatura no fundo, sem buraco branco). EXEMPLO quando fictício. Não envio e-mail/PDF externo sem OK do Thiago. A empresa é a Balão da Informática Anchieta (não use mais Castelo / unidade Castelo). CNPJ, endereço Av. Anchieta, 789 - Cambuí, Campinas-SP, telefones e dono continuam iguais. Não altere e-mails, domínios, repos ou logins técnicos (ex.: balaocastelo@...).\n\n" + "## §9 CONHECIMENTO GERAL\nConsulte conhecimento/conhecimento-geral.md (C:\\Users\\user\\Desktop\\MyBots-Base\\conhecimento\\conhecimento-geral.md) antes de responder sobre empresa, regras ou bots.\nResumo: Empresa Balão da Informática Anchieta (não usar \"Castelo\"). CNPJ 34.397.947/0001-08. Av. Anchieta, 789 - Cambuí, Campinas-SP, CEP 13015-101. Tel (19) 3255-1661, WhatsApp (19) 98751-0267, e-mail balaocastelo@balaodainformatica.com.br, site www.balao.info. Simples Nacional. Pagamento: transferência, cheque, cartão (sem conta BB). Orçamentos assinados por Thiago Gabriel Morales Herrera.\nRegras: só pt-BR; nunca enviar e-mail/WhatsApp/post, anúncio pago, merge, pagar ou apagar sem OK explícito do Thiago (OK repassado por outro bot não vale); PDF orçamento/venda/NF = 1 folha A4, 3 zonas, cabeçalho fixo; Hub na porta 8790, nunca mexer em 8787/8791; chaves nunca no chat (só Cofre/CHAVES); rotina nova nasce desligada; registrar lições após tarefas; anúncios OLX grátis, em tópicos com emoji, sem travessão; lançamentos do Futrico ficam PENDENTES até Confio; nunca inventar preço, estoque ou saldo." + "\n\n# " + name + "\n\nVoce e " + name + ", " + roleFinal + " da equipe de Bots da sua empresa.\nSeu chefe e o Thiago. Voce fala em portugues, de forma direta, curta e simpatica.\n\n## O que voce faz\n- " + (esp ? ("Atua como especialista em " + esp.nome + ".") : "(descreva aqui as tarefas tipicas)") + "\n- Mantem um LOG.md no workspace com o que fez.\n- Quando precisa de algo de outra area, consulta o Bot certo (ask_bot).\n\n## Regras\n- Antes de qualquer acao critica (apagar, pagar, enviar, publicar, instalar), peca aprovacao.\n- Se faltar informacao, pergunte ao chefe com opcoes curtas em vez de supor.\n- Quando terminar algo, avise o chefe com uma frase.\n- Nunca exponha chaves, senhas ou dados de cliente.\n\n\n## §10 CONECTORES MCP\nAntes de pedir uma ferramenta nova, consulte docs/conectores-mcp-free.md (C:\\Users\\user\\Desktop\\MyBots-Base\\docs\\conectores-mcp-free.md, 109 conectores). Use só MCP grátis ou com chave grátis, nunca nada pago. Peça aprovação do Thiago antes de enviar, apagar ou pagar qualquer coisa.\n" + espBloco;
}

export const slug = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
export function personaTemplate(name: string, role: string, esp?: EspecialidadeResumo | null) {
  return personaTemplateComEsp(name, role, esp);
}
export function BotForm({ value, onChange, providers, voices, isNew, etapa = "tudo", especialidades = [], deteccao, onEspecialidade }: { value: any; onChange: (v: any) => void; providers: ProviderInfo[]; voices: Array<{ valor: string; nome: string; clonada?: boolean }>; isNew: boolean; etapa?: "identidade" | "modelo" | "tudo"; especialidades?: EspecialidadeResumo[]; deteccao?: { id: string | null; nome: string | null; emoji?: string | null; confianca?: number; metodo?: string; skills?: string[] } | null; onEspecialidade?: (id: string | null, desligada: boolean) => void }) {
  const prov = providers.find((p) => p.kind === value.provider?.kind);
  const set = (patch: any) => onChange({ ...value, ...patch });
  const setProv = (patch: any) => onChange({ ...value, provider: { ...value.provider, ...patch } });
  const identidade = etapa === "identidade" || etapa === "tudo";
  const modelo = etapa === "modelo" || etapa === "tudo";
  return (
    <div className="form">
      {identidade && (
        <>
          <div className="row">
            <label>Nome<input value={value.name} onChange={(e) => set({ name: e.target.value, ...(isNew && !value.personaTouched ? { persona: personaTemplate(e.target.value, value.role, especialidades.find((x) => x.id === value.especialidadeId) || null) } : {}) })} placeholder="Ex.: Malaquias Marketing" /></label>
            <div className="ameba-picker">
              <div className="ameba-picker-topo">
                <RetratoPreview id={value.id ?? value.name ?? "novo"} avatar={value.avatar} size={64} />
                <div className="ameba-picker-acoes">
                  <b>Ameba</b>
                  <small className="muted">So as amebas novas. Sorteie ou escolha uma.</small>
                  <button type="button" className="btn" onClick={() => {
                    const seed = (value.id || value.name || "novo") + "-" + Date.now();
                    set({ avatar: amebaV2StoragePath(sortearAmebaV2(seed, value.especialidadeId)) });
                  }}>Sortear</button>
                </div>
              </div>
              <div className="ameba-grade" role="listbox" aria-label="Escolher ameba">
                {AMEBAS_V2_TODOS.map((n) => {
                  const path = amebaV2StoragePath(n);
                  const on = amebaV2Num(value.avatar) === n;
                  return (
                    <button key={n} type="button" role="option" aria-selected={on} className={"ameba-opcao" + (on ? " on" : "")}
                      onClick={() => set({ avatar: path })}>
                      <img src={amebaV2Path(n)} alt="" draggable={false} />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <label>Função<input value={value.role} onChange={(e) => set({ role: e.target.value, ...(isNew && !value.personaTouched ? { persona: personaTemplate(value.name, e.target.value, especialidades.find((x) => x.id === value.especialidadeId) || null) } : {}) })} placeholder="Ex.: Marketing e redes sociais" /></label>
          {isNew && (
            <div className="especialidade-preview" style={{ background: "var(--panel-2, #1a1f2b)", border: "1px solid var(--border, #2a3344)", borderRadius: 10, padding: "10px 12px", marginTop: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <b>Vai nascer especialista em:</b>
                <select
                  value={value.especialidadeDesligada ? "" : (value.especialidadeId ?? deteccao?.id ?? "")}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) {
                      onEspecialidade?.(null, true);
                      set({ especialidadeId: null, especialidadeDesligada: true, ...( !value.personaTouched ? { persona: personaTemplate(value.name, value.role, null) } : {}) });
                    } else {
                      const esp = especialidades.find((x) => x.id === id) || null;
                      onEspecialidade?.(id, false);
                      set({ especialidadeId: id, especialidadeDesligada: false, avatar: isAmebaV2(value.avatar) ? value.avatar : amebaV2StoragePath(sortearAmebaV2(value.id || value.name || "novo", id)), role: value.role || esp?.nome || value.role, ...( !value.personaTouched ? { persona: personaTemplate(value.name, value.role || esp?.nome || "", esp) } : {}) });
                    }
                  }}
                >
                  <option value="">(sem especialidade)</option>
                  {especialidades.map((e) => <option key={e.id} value={e.id}>{e.emoji ? e.emoji + " " : ""}{e.nome}</option>)}
                </select>
                {deteccao?.metodo && !value.especialidadeDesligada && (
                  <small className="muted">detectado por {deteccao.metodo}{typeof deteccao.confianca === "number" ? " · " + Math.round(deteccao.confianca * 100) + "%" : ""}</small>
                )}
              </div>
              {!!(deteccao?.skills?.length) && !value.especialidadeDesligada && (
                <small className="muted">Skills: {deteccao.skills.slice(0, 6).join(", ")}</small>
              )}
            </div>
          )}
          {isNew && (
            <details className="persona-sanfona">
              <summary>Personalidade</summary>
              <textarea rows={6} aria-label="Personalidade" value={value.persona} onChange={(e) => set({ persona: e.target.value, personaTouched: true })} />
            </details>
          )}
        </>
      )}
      {modelo && (
        <>
          <div className="row">
            <label>Provedor do modelo
              <select value={value.provider?.kind ?? "anthropic"} onChange={(e) => { const p = providers.find((x) => x.kind === e.target.value); setProv({ kind: e.target.value, model: p?.defaultModel ?? "", baseURL: p?.defaultBaseURL ?? "" }); if (e.target.value === "opencode") set({ engine: "opencode", provider: { kind: "opencode", model: p?.defaultModel ?? "big-pickle" } }); }}>
                {/* quem ja tem chave no Hub vem marcado: evita escolher um provedor que nao responde */}
                {providers.map((p) => <option key={p.kind} value={p.kind}>{p.label}{p.chaveDaCasa ? "  \u2713 chave pronta" : p.needsKey ? "  (sem chave)" : ""}</option>)}
              </select>
            </label>
            <label>Modelo
              <input list="models" value={value.provider?.model ?? ""} onChange={(e) => setProv({ model: e.target.value })} />
              <datalist id="models">{(prov?.models ?? []).map((m) => <option key={m} value={m} />)}</datalist>
            </label>
          </div>
          {prov?.needsKey && (prov.chaveDaCasa
            ? <p className="hint-inline">🔑 A chave da casa ({prov.keyEnv}) já está no Hub — este bot usa ela, você não precisa digitar nada.</p>
            : <label>Chave de API ({prov.keyEnv})<input type="password" value={value.provider?.apiKey ?? ""} onChange={(e) => setProv({ apiKey: e.target.value })} placeholder={isNew ? "cole a chave" : "deixe em branco para manter"} autoComplete="off" /></label>)}
          {prov?.kind === "ollama" && <label>Endereço do Ollama<input value={value.provider?.baseURL ?? ""} onChange={(e) => setProv({ baseURL: e.target.value })} placeholder="http://192.168.0.50:11434/v1" /></label>}
          <div className="row">
            <label>Motor
              <select value={value.engine} disabled={value.provider?.kind === "opencode"} onChange={(e) => set({ engine: e.target.value })}>
                <option value="opencode">OpenCode (agente completo, ferramentas do OpenCode)</option>
                <option value="direct">Direto na API (mais leve, ferramentas do MyBots)</option>
              </select>
            </label>
            <label>Voz
              <select value={value.voice ?? ""} onChange={(e) => set({ voice: e.target.value })}>
                <option value="">automática</option>
                {voices.some((v) => v.clonada) && (
                  <optgroup label="Vozes da casa (clonadas, na 4090)">
                    {voices.filter((v) => v.clonada).map((v) => <option key={v.valor} value={v.valor}>{v.nome}</option>)}
                  </optgroup>
                )}
                <optgroup label="Vozes prontas">
                  {voices.filter((v) => !v.clonada).map((v) => <option key={v.valor} value={v.valor}>{v.nome}</option>)}
                </optgroup>
              </select>
            </label>
          </div>
          <label>Nível de controle (automode)
            <select value={value.controlMode ?? "supervisionado"} onChange={(e) => { const m = e.target.value as ControlMode; if (m === "deus" && !confirmDeus()) return; set({ controlMode: m }); }}>
              {CONTROL_MODES.map((m) => <option key={m} value={m}>{CONTROL_LABELS[m]}</option>)}
            </select>
            <small className="hint-inline">{CONTROL_DESCRIPTIONS[(value.controlMode ?? "supervisionado") as ControlMode]} O seletor "Controle" da lista de bots, quando não está em "Por bot", vale sobre este.</small>
          </label>
        </>
      )}
      {!isNew && (
        <label>Personalidade (system prompt)<textarea rows={8} value={value.persona} onChange={(e) => set({ persona: e.target.value, personaTouched: true })} /></label>
      )}
    </div>
  );
}

/** Cria um gerente: um bot acima dos outros, que recebe o pedido e distribui para a equipe. */
export function NewGerenteDialog({ bots, onClose, onCreated }: { bots: BotSummary[]; onClose: () => void; onCreated: (id: string) => void }) {
  const { providers, voices } = usePresets();
  const [equipe, setEquipe] = useState<string[]>(bots.filter((b) => !b.manages?.length).map((b) => b.id));
  const [etapa, setEtapa] = useState<0 | 1 | 2>(0);
  const [v, setV] = useState<any>({ name: "", role: "Gerente da equipe", avatar: amebaV2StoragePath(sortearAmebaV2("novo-gerente")), voice: "", ...PADRAO_DA_CASA });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const id = slug(v.name || "gerente");
  const candidatos = bots.filter((b) => !b.manages?.length);
  const criar = async () => {
    if (!equipe.length) { setErr("Escolha pelo menos um bot para ele gerenciar."); return; }
    setBusy(true); setErr("");
    // O gerente é da mesma empresa de quem ele comanda — não existe bot sem empresa.
    const empresaDaEquipe = candidatos.find((b) => b.id === equipe[0])?.empresaId ?? undefined;
    const r = await api("/managed", { method: "POST", body: JSON.stringify({ ...v, id, manages: equipe, empresa: empresaDaEquipe }) });
    setBusy(false);
    if (!r.ok) { setErr((await r.json()).error ?? "erro"); return; }
    onCreated(id);
  };
  const alterna = (botId: string) => setEquipe(equipe.includes(botId) ? equipe.filter((x) => x !== botId) : [...equipe, botId]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>👑 Novo gerente</h3>
        <p className="passos-wizard">Passo {etapa + 1} de 3 — {etapa === 0 ? "Equipe" : etapa === 1 ? "Identidade" : "Modelo e controle"}</p>
        <p className="muted">Ele fica acima dos bots escolhidos: você pede a ele, ele distribui e volta com o resultado. É quem atende no Telegram por padrão.</p>
        {!candidatos.length ? <p>Crie pelo menos um bot antes de nomear um gerente.</p> : (
          <>
            {etapa === 0 && (
              <>
                <label>Quem ele gerencia <small className="muted">({equipe.length} de {candidatos.length})</small></label>
                <div className="equipe">
                  {candidatos.map((b) => (
                    <button key={b.id} type="button" className={"equipe-item" + (equipe.includes(b.id) ? " on" : "")} aria-pressed={equipe.includes(b.id)} onClick={() => alterna(b.id)}>
                      <span>{equipe.includes(b.id) ? "☑" : "☐"}</span>
                      <b>{b.avatar || "·"} {b.name}</b>
                      <small>{b.role}</small>
                    </button>
                  ))}
                </div>
              </>
            )}
            {etapa > 0 && <BotForm value={v} onChange={setV} providers={providers} voices={voices} isNew etapa={etapa === 1 ? "identidade" : "modelo"} />}
            {etapa === 1 && <p className="muted">A persona de gerente é escrita automaticamente com a equipe escolhida. Dá para editar no sanfona, ou depois no ⚙️ dele.</p>}
          </>
        )}
        {err && <div className="err">{err}</div>}
        <div className="modal-foot">
          <button className="btn" type="button" onClick={() => etapa === 0 ? onClose() : setEtapa((etapa - 1) as 0 | 1)}>{etapa === 0 ? "Cancelar" : "Voltar"}</button>
          {etapa < 2
            ? <button className="btn primary" type="button" disabled={etapa === 0 && !equipe.length} onClick={() => setEtapa((etapa + 1) as 1 | 2)}>Continuar</button>
            : <button className="btn primary" type="button" disabled={busy || !v.name.trim() || !equipe.length} onClick={() => void criar()}>{busy ? "Criando…" : "Criar gerente"}</button>}
        </div>
      </div>
    </div>
  );
}

export function NewBotDialog({ onClose, onCreated, empresas = [], empresaAtiva = "todas", onCriou }: { onClose: () => void; onCreated: (id: string) => void; empresas?: Array<{ id: string; nome: string }>; empresaAtiva?: string; onCriou?: () => void }) {
  const { providers, voices } = usePresets();
  const [where, setWhere] = useState<"hub" | "other">("hub");
  /* empresa/ponte removidos da UI: o Hub escolhe a empresa padrao em silencio */
  const [etapa, setEtapa] = useState<1 | 2>(1);
  const [v, setV] = useState<any>({ name: "", role: "", avatar: amebaV2StoragePath(sortearAmebaV2("novo-bot")), voice: "", especialidadeId: null, especialidadeDesligada: false, ...PADRAO_DA_CASA, persona: personaTemplate("", "") });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [especialidades, setEspecialidades] = useState<EspecialidadeResumo[]>([]);
  const [deteccao, setDeteccao] = useState<any>(null);
  useEffect(() => { api("/especialidades").then((r) => r.json()).then((j) => setEspecialidades(j.especialidades ?? [])).catch(() => {}); }, []);
  useEffect(() => {
    if (!v.name.trim() || v.especialidadeDesligada) { setDeteccao(null); return; }
    const t = setTimeout(() => {
      api("/especialidades/detectar", { method: "POST", body: JSON.stringify({ nome: v.name, funcao: v.role, especialidadeId: v.especialidadeId || undefined }) })
        .then((r) => r.json())
        .then((j) => {
          if (j.error) return;
          setDeteccao(j);
          if (!v.especialidadeId && j.id && !v.especialidadeDesligada) {
            const esp = { id: j.id, nome: j.nome, emoji: j.emoji, skills: j.skills, onboarding: j.onboarding };
            setV((prev: any) => {
              if (prev.especialidadeId || prev.especialidadeDesligada) return prev;
              return {
                ...prev,
                especialidadeId: j.id,
                avatar: isAmebaV2(prev.avatar) ? prev.avatar : amebaV2StoragePath(sortearAmebaV2(prev.id || prev.name || "novo", j.id)),
                role: prev.role || j.nome || prev.role,
                ...(prev.personaTouched ? {} : { persona: j.personaPreview || personaTemplate(prev.name, prev.role || j.nome || "", esp) }),
              };
            });
          }
        })
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [v.name, v.role, v.especialidadeDesligada]);
  const id = slug(v.name || "bot");
  const create = async () => {
    setBusy(true); setErr("");
    const r = await api("/managed", { method: "POST", body: JSON.stringify({ ...v, id, avatar: isAmebaV2(v.avatar) ? amebaV2StoragePath(v.avatar) : amebaV2StoragePath(sortearAmebaV2(id, v.especialidadeId)) }) });
    setBusy(false);
    if (!r.ok) { setErr((await r.json()).error ?? "erro"); return; }
    onCriou?.();
    onCreated(id);
  };
  const prov = providers.find((p) => p.kind === v.provider?.kind);
  const cmd = `.\\scripts\\install-node.ps1 -Bot ${id} -Nome "${v.name}" -Funcao "${v.role}" -Avatar "${v.avatar}" -Hub ws://${location.hostname}:${location.port || 80} -Token <token do .env do Hub> -Engine ${v.engine} -Provider ${v.provider?.kind} -Modelo ${v.provider?.model}${prov?.needsKey ? " -ApiKey <sua chave>" : ""}${v.provider?.baseURL ? ` -BaseUrl ${v.provider.baseURL}` : ""}`;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Novo bot</h3>
        <p className="passos-wizard">Passo {etapa} de 2 — {etapa === 1 ? "Identidade" : "Modelo e controle"}</p>
        <div className="seg" role="group" aria-label="Onde o bot roda">
          <button type="button" className={where === "hub" ? "on" : ""} aria-pressed={where === "hub"} onClick={() => setWhere("hub")}>Roda neste PC (o Hub cuida dele)</button>
          <button type="button" className={where === "other" ? "on" : ""} aria-pressed={where === "other"} onClick={() => setWhere("other")}>Roda em outro PC</button>
        </div>
        {/* empresa e ponte: removidos — perfil unico */}

        <BotForm value={v} onChange={setV} providers={providers} voices={voices} isNew etapa={etapa === 1 ? "identidade" : "modelo"} especialidades={especialidades} deteccao={deteccao} onEspecialidade={(id, desligada) => setV((prev: any) => ({ ...prev, especialidadeId: id, especialidadeDesligada: desligada }))} />
        {etapa === 2 && where === "other" && (
          <div className="hint-box">Na pasta <code>mybots</code> do outro PC, rode no PowerShell:<pre>{cmd}</pre>Depois inicie com <code>bots\{id}\start-bot.cmd</code>. O bot aparece aqui assim que conectar.</div>
        )}
        {err && <div className="err">{err}</div>}
        <div className="card-actions">
          <button className="btn" type="button" onClick={() => etapa === 1 ? onClose() : setEtapa(1)}>{etapa === 1 ? "Cancelar" : "Voltar"}</button>
          {etapa === 1
            ? <button className="btn primary" type="button" disabled={!v.name.trim()} onClick={() => setEtapa(2)}>Continuar</button>
            : where === "hub"
              ? <button className="btn primary" type="button" disabled={!v.name.trim() || busy} onClick={create}>{busy ? "Criando…" : `Criar e iniciar (${id})`}</button>
              : <button className="btn primary" type="button" onClick={() => { navigator.clipboard?.writeText(cmd); onClose(); }}>Copiar comando e fechar</button>}
        </div>
      </div>
    </div>
  );
}

export function BotSettingsPanel({ bot, onClose }: { bot: BotSummary; onClose: () => void }) {
  const { providers, voices } = usePresets();
  const [def, setDef] = useState<any | null>(null);
  const [v, setV] = useState<any | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const load = async () => {
    const r = await api(`/managed/${bot.id}`);
    if (r.ok) { const d = await r.json(); setDef(d); setV({ ...d, provider: { ...d.provider, apiKey: "" } }); } else setDef(false);
  };
  useEffect(() => { void load(); }, [bot.id]);
  const act = async (what: string) => {
    setMsg("…");
    const r = await api(`/managed/${bot.id}/${what}`, { method: "POST" });
    setMsg(r.ok ? (what === "restart" ? "Reiniciando (uns 20 s)…" : "ok") : "falhou");
    setTimeout(load, 1500);
  };
  const save = async () => {
    setMsg("Salvando…");
    const body = { ...v, provider: { ...v.provider, apiKey: v.provider.apiKey || undefined } };
    const r = await api(`/managed/${bot.id}`, { method: "PATCH", body: JSON.stringify(body) });
    setMsg(r.ok ? "Salvo. O bot reinicia com a nova configuração." : (await r.json()).error ?? "falhou");
    setTimeout(load, 1500);
  };
  const remove = async () => {
    if (!confirm(`Excluir o bot "${bot.name}"? A pasta com o workspace fica no disco.`)) return;
    const r = await api(`/managed/${bot.id}`, { method: "DELETE" }).catch((e) => e as Error);
    if (r instanceof Error || !r.ok) {
      const erro = r instanceof Error ? r.message : ((await r.json().catch(() => ({} as any)))?.error ?? `o Hub respondeu ${r.status}`);
      setMsg(`Não deu para excluir: ${erro}`);
      return;
    }
    void desintegrarAvatar(bot.id);
    onClose();
  };
  if (def === null) return <div className="panel">Carregando…</div>;
  if (def === false) {
    return (
      <div className="panel">
        <div className="panel-head"><b>⚙️ {bot.name}</b><button className="link" onClick={onClose}>fechar</button></div>
        <p>Este bot roda em outro PC (não é gerenciado por este Hub). Para mudar a personalidade ou o modelo, edite <code>bots\{bot.id}\persona.md</code> e <code>mybots-node.json</code> naquele PC e reinicie o <code>start-bot.cmd</code>.</p>
        <p>Motor: <b>{bot.engine}</b> · modelo: <b>{bot.provider}/{bot.model}</b> · status: {bot.online ? "online" : "offline"}</p>
      </div>
    );
  }
  return (
    <div className="panel">
      <div className="panel-head"><b>⚙️ {bot.name} <small>{def.running ? `rodando (pid ${def.pid})` : "parado"}{def.restarts ? ` · ${def.restarts} reinícios` : ""}</small></b><button className="link" onClick={onClose}>fechar</button></div>
      {v && <BotForm value={v} onChange={setV} providers={providers} voices={voices} isNew={false} />}
      <div className="card-actions wrap">
        <button className="btn primary" onClick={save}>Salvar e reiniciar</button>
        <button className="btn" onClick={() => act("restart")}>Reiniciar</button>
        {bot.online && <button className="btn" onClick={async () => { setMsg("Parando…"); await api(`/bots/${bot.id}/parar`, { method: "POST" }); setMsg("Parado o que ele estava fazendo."); }}>Parar o trabalho</button>}
        {def.running ? <button className="btn" onClick={() => act("stop")}>Desligar</button> : <button className="btn" onClick={() => act("start")}>Ligar</button>}
        <button className="btn" onClick={async () => { const r = await api(`/managed/${bot.id}/logs?lines=120`); setLog((await r.json()).log || "(vazio)"); }}>Ver log</button>
        <button className="btn danger" onClick={remove}>Excluir</button>
        <span className="hint-inline">{msg}</span>
      </div>
      {log !== null && <pre className="log">{log}</pre>}
    </div>
  );
}


/**
 * Empresas: criar, escrever as regras e dizer de quem é cada bot.
 * O conhecimento é universal; o que separa por empresa são os bots, as conversas
 * e a memória curta.
 */
export function EmpresasDialog({ empresas, bots, onClose }: { empresas: Array<{ id: string; nome: string; regras: string; idioma?: string; bots: number }>; bots: BotSummary[]; onClose: () => void }) {
  const [lista, setLista] = useState(empresas);
  const [nome, setNome] = useState("");
  // A ficha sugerida pela análise do site/redes. É sugestão: ele lê, corrige e só então cria.
  const [site, setSite] = useState("");
  const [insta, setInsta] = useState("");
  const [sugestao, setSugestao] = useState<{ resumo: string; regras: string; fontes: string[]; avisos: string[] } | null>(null);
  const [analisando, setAnalisando] = useState(false);
  const [sel, setSel] = useState<string | null>(empresas[0]?.id ?? null);
  const [regras, setRegras] = useState(empresas[0]?.regras ?? "");
  const [err, setErr] = useState("");
  // WhatsApp da empresa escolhida: o painel pergunta o estado de 3 em 3 segundos
  // enquanto a janela está aberta — é assim que o QR aparece sozinho.
  const [whats, setWhats] = useState<{ estado: string; qr?: string; numero?: string; erro?: string }>({ estado: "desligado" });
  const [teste, setTeste] = useState({ para: "", texto: "Teste do MyBots ✅" });
  const [legal, setLegal] = useState<string | null>(null);
  const [creditos, setCreditos] = useState<string | null>(null);
  const [verPc, setVerPc] = useState<string | null>(null);
  const [verCelular, setVerCelular] = useState(false);
  const [verMac, setVerMac] = useState(false);
  useEffect(() => {
    if (!sel) return;
    let vivo = true;
    const ler = async () => { try { const r = await api(`/empresas/${sel}/whatsapp`); if (r.ok && vivo) setWhats(await r.json()); } catch {} };
    void ler();
    const t = setInterval(ler, 3000);
    return () => { vivo = false; clearInterval(t); };
  }, [sel]);
  const recarregar = async () => { const r = await api("/empresas"); if (r.ok) setLista(await r.json()); };
  const escolher = (id: string) => { setSel(id); setRegras(lista.find((e) => e.id === id)?.regras ?? ""); };
  const analisar = async () => {
    setAnalisando(true); setErr("");
    const r = await api("/empresas/sugerir", { method: "POST", body: JSON.stringify({ nome, site, instagram: insta }) });
    setAnalisando(false);
    if (!r.ok) { setErr((await r.json()).error ?? "não consegui analisar"); return; }
    const f = await r.json();
    if (f.nome && !nome.trim()) setNome(f.nome);
    setSugestao({ resumo: f.resumo, regras: f.regras, fontes: f.fontes ?? [], avisos: f.avisos ?? [] });
  };
  const criar = async () => {
    if (!nome.trim()) return;
    const r = await api("/empresas", { method: "POST", body: JSON.stringify({ nome, regras: sugestao?.regras ?? "", site, instagram: insta, resumo: sugestao?.resumo ?? "" }) });
    if (!r.ok) { setErr((await r.json()).error ?? "erro"); return; }
    const e = await r.json();
    setNome(""); setSite(""); setInsta(""); setSugestao(null);
    setErr(e.aviso ? e.aviso : e.medico ? "Empresa criada. O Gerente Geral dela já está subindo e vai se apresentar na conversa dele." : "");
    await recarregar(); escolher(e.id);
  };
  const salvarRegras = async () => {
    if (!sel) return;
    await api(`/empresas/${sel}`, { method: "PATCH", body: JSON.stringify({ regras }) });
    await recarregar();
  };
  const apagar = async (id: string) => {
    const r = await api(`/empresas/${id}`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json()).error ?? "erro"); return; }
    setErr(""); setSel(null); await recarregar();
  };
  const mover = async (botId: string, empresa: string, ponte: boolean) => {
    await api(`/bots/${botId}/empresa`, { method: "POST", body: JSON.stringify({ empresa: empresa || null, ponte }) });
    await recarregar();
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Empresas</h3>
        <p className="muted">Cada empresa tem os seus bots, os seus gerentes e as suas regras. O conhecimento da casa continua sendo um só, universal: toda empresa lê a mesma base.</p>
        <div className="emp-nova">
          <input placeholder="Nome da nova empresa" value={nome} onChange={(e) => setNome(e.target.value)} />
          <input placeholder="site (ex.: exemplo.com.br)" value={site} onChange={(e) => setSite(e.target.value)} />
          <input placeholder="@instagram" value={insta} onChange={(e) => setInsta(e.target.value)} />
          <button className="btn" disabled={analisando || (!site.trim() && !insta.trim())} onClick={() => void analisar()}>{analisando ? "Lendo o site…" : "Analisar e sugerir regras"}</button>
          <button className="btn primary" disabled={!nome.trim()} onClick={() => void criar()}>Criar empresa</button>
        </div>
        {analisando ? <LendoSite alvo={site.trim() || insta.trim()} /> : null}
        {sugestao && (
          <div className="sugestao">
            <b>Sugestão da análise</b> <small className="muted">leia e corrija antes de criar — é sugestão, não verdade</small>
            {sugestao.resumo && <p className="muted">{sugestao.resumo}</p>}
            <textarea rows={8} value={sugestao.regras} onChange={(e) => setSugestao({ ...sugestao, regras: e.target.value })} />
            {!!sugestao.fontes.length && <small className="muted">Lido de: {sugestao.fontes.join(" · ")}</small>}
            {sugestao.avisos.map((a, i) => <small key={i} className="muted">⚠ {a}</small>)}
          </div>
        )}
        <div className="emp-lista">
          {lista.map((e) => (
            <button key={e.id} className={"emp-item" + (sel === e.id ? " on" : "")} onClick={() => escolher(e.id)}>
              <b>{e.nome}</b><small>{e.bots} bot(s)</small>
            </button>
          ))}
          {!lista.length && <p className="muted">Nenhuma empresa ainda.</p>}
        </div>
        {sel && (
          <>
            <label>Idioma da empresa</label>
            <select value={lista.find((e) => e.id === sel)?.idioma ?? "pt"} onChange={async (ev) => {
              await api(`/empresas/${sel}`, { method: "PATCH", body: JSON.stringify({ idioma: ev.target.value }) });
              await recarregar();
            }}>
              <option value="pt">Português (Brasil)</option>
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
            <label>Regras desta empresa <small className="muted">(vão no prompt de todo bot dela)</small></label>
            <textarea rows={6} value={regras} onChange={(e) => setRegras(e.target.value)} placeholder={"Ex.: Toda proposta vai com 10% de margem mínima.\nCliente desta empresa fala por WhatsApp, nunca por e-mail."} />
            <div className="card-actions">
              <button className="btn primary" onClick={() => void salvarRegras()}>Salvar regras</button>
              <button className="btn" disabled={analisando} onClick={async () => {
                setAnalisando(true); setErr("");
                const r = await api("/empresas/sugerir", { method: "POST", body: JSON.stringify({ nome: lista.find((e) => e.id === sel)?.nome, site, instagram: insta }) });
                setAnalisando(false);
                if (!r.ok) { setErr((await r.json()).error ?? "não consegui analisar"); return; }
                const f = await r.json(); setRegras(regras ? `${regras}\n${f.regras}` : f.regras);
              }}>{analisando ? "Lendo…" : "Sugerir pelo site acima"}</button>
              <button className="btn" onClick={() => setLegal(sel)}>Leis e consentimentos</button>
              <button className="btn" onClick={() => setVerPc(sel)}>🖥️ Ver o PC da empresa</button>
              <button className="btn" onClick={() => setVerCelular(true)}>📱 Celular da empresa</button>
              <button className="btn" hidden onClick={() => {}}>🍎 Tela do Mac</button>
              <button className="btn" onClick={() => setCreditos(sel)}>Créditos e Pix</button>
              <button className="btn perigo" onClick={() => void apagar(sel)}>Apagar empresa</button>
            </div>
            <div className="wa-caixa">
              <div className="wa-topo">
                <b>WhatsApp desta empresa</b>
                <span className={"wa-estado wa-" + whats.estado}>
                  {whats.estado === "conectado" ? `conectado${whats.numero ? ` · ${whats.numero}` : ""}`
                    : whats.estado === "qr" ? "esperando você escanear"
                    : whats.estado === "conectando" ? "conectando…" : "desligado"}
                </span>
              </div>
              <p className="muted">Cada empresa fala pelo seu próprio número. Escaneie uma vez: a sessão fica guardada e volta sozinha quando o Hub reinicia.</p>
              {whats.estado === "qr" && whats.qr && (
                <div className="wa-qr">
                  <img src={whats.qr} alt="QR code do WhatsApp" />
                  <ol className="muted">
                    <li>Abra o WhatsApp no celular desta empresa</li>
                    <li>Menu ⋮ → <b>Aparelhos conectados</b></li>
                    <li>Conectar um aparelho e aponte para o código</li>
                  </ol>
                </div>
              )}
              {whats.erro && <div className="muted">último aviso: {whats.erro}</div>}
              <div className="card-actions">
                {whats.estado === "conectado"
                  ? <>
                      <button className="btn" onClick={async () => { await api(`/empresas/${sel}/whatsapp/desligar`, { method: "POST", body: JSON.stringify({}) }); setWhats({ estado: "desligado" }); }}>Desligar</button>
                      <button className="btn perigo" onClick={async () => { await api(`/empresas/${sel}/whatsapp/desligar`, { method: "POST", body: JSON.stringify({ esquecer: true }) }); setWhats({ estado: "desligado" }); }}>Esquecer este número</button>
                    </>
                  : <button className="btn primary" onClick={async () => { setWhats({ estado: "conectando" }); await api(`/empresas/${sel}/whatsapp/conectar`, { method: "POST", body: "{}" }); }}>Gerar QR e conectar</button>}
              </div>
              {whats.estado === "conectado" && (
                <div className="wa-teste">
                  <input placeholder="número com DDD" value={teste.para} onChange={(e) => setTeste({ ...teste, para: e.target.value })} />
                  <input placeholder="mensagem de teste" value={teste.texto} onChange={(e) => setTeste({ ...teste, texto: e.target.value })} />
                  <button className="btn" onClick={async () => {
                    const r = await api(`/empresas/${sel}/whatsapp/enviar`, { method: "POST", body: JSON.stringify(teste) });
                    setErr(r.ok ? "" : ((await r.json()).error ?? "erro"));
                    if (r.ok) setErr("enviado ✓");
                  }}>Mandar teste</button>
                </div>
              )}
            </div>
            <label>De quem é cada bot</label>
            <div className="emp-bots">
              {bots.map((b) => (
                <div key={b.id} className="emp-bot">
                  <b>{b.avatar || "·"} {b.name}</b>
                  <select value={b.empresaId ?? ""} onChange={(ev) => void mover(b.id, ev.target.value, !!b.ponte)}>
                    <option value="">sistema (todas)</option>
                    {lista.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                  </select>
                  <label className="linha-check"><input type="checkbox" checked={!!b.ponte} onChange={(ev) => void mover(b.id, b.empresaId ?? "", ev.target.checked)} /> ponte</label>
                </div>
              ))}
            </div>
          </>
        )}
        {verPc && <PcDaEmpresa empresaId={verPc} nome={lista.find((e) => e.id === verPc)?.nome ?? verPc} onFechar={() => setVerPc(null)} />}
        {verCelular && sel && (
          <div className="modal-bg" onClick={() => setVerCelular(false)}>
            <div className="modal wide" onClick={(e) => e.stopPropagation()}>
              <h3>Celular da {lista.find((e) => e.id === sel)?.nome ?? sel}</h3>
              <CelularDaEmpresaPainel empresaId={sel} nome={lista.find((e) => e.id === sel)?.nome ?? sel} aoVivo />
              <div className="modal-foot"><button className="btn" onClick={() => setVerCelular(false)}>Fechar</button></div>
            </div>
          </div>
        )}
      {creditos && <TelaCreditos empresaId={creditos} empresaNome={lista.find((e) => e.id === creditos)?.nome ?? creditos} onClose={() => setCreditos(null)} />}
        {legal && <TelaLegal empresaId={legal} empresaNome={lista.find((e) => e.id === legal)?.nome ?? legal} onClose={() => setLegal(null)} />}
        {err && <div className="err">{err}</div>}
        <div className="modal-foot"><button className="btn" onClick={onClose}>Fechar</button></div>
      </div>
    </div>
  );
}


/** Excluir um bot: pergunta dentro do painel e mostra o motivo quando o Hub recusa. */
export function ExcluirBotDialog({ bot, onClose }: { bot: BotSummary; onClose: () => void }) {
  const [erro, setErro] = useState("");
  const [indo, setIndo] = useState(false);
  const excluir = async (purge: boolean) => {
    setIndo(true); setErro("");
    try {
      const r = await api(`/managed/${bot.id}${purge ? "?purge=1" : ""}`, { method: "DELETE" });
      if (!r.ok) { const j = await r.json().catch(() => ({} as any)); setErro(j?.error ?? `o Hub respondeu ${r.status}`); setIndo(false); return; }
      void desintegrarAvatar(bot.id);
      onClose();
    } catch (e) { setErro((e as Error).message); setIndo(false); }
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Excluir “{bot.name}”?</h3>
        <p className="muted">
          O processo dele é desligado e ele some do painel. A pasta com o workspace e os arquivos
          continua no disco, a não ser que você peça para apagar junto.
        </p>
        {erro && <div className="err">{erro}</div>}
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn" disabled={indo} onClick={() => void excluir(true)}>Excluir e apagar a pasta</button>
          <button className="btn danger" disabled={indo} onClick={() => void excluir(false)}>{indo ? "Excluindo…" : "Excluir bot"}</button>
        </div>
      </div>
    </div>
  );
}
