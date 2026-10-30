// Separa "pensamentos" do modelo da resposta de verdade.
// Alguns modelos (ex.: big-pickle do OpenCode) escrevem o raciocínio em inglês como texto comum antes de responder
// em português, ou dentro de <think>…</think>. O chefe não quer ver nem ouvir isso.

const EN = /\b(the|i|i'll|i'd|i'm|let|let's|should|maybe|user|asks|says|wants|want|need|needs|can|can't|could|will|would|just|also|then|now|so|is|are|was|be|to|of|and|with|that|this|it|it's|not|but|for|from|on|in|or|an|a|my|we|they|he|she|does|done|check|use|using|respond|answer|explain|keep|short|brief|first|probably|actually|note|ok|okay|hmm|wait|here|there|get|got|make|sure|since|because|which|what|how|before|after|honest|image|generation|limits|team|tools|technically|creative|organize|into|save|folder|screen|capture|terminal|via|permission|prompt|task|tasks|question|options|option|ask|asking|reply|message|messages|file|files|path|run|running|command|output|result|results|try|instead|else|when|where|while|likely|seems|looks|think|thinking|plan|step|steps|next|final|finally|summary|list|must|might|may|have|has|had|mention|show|tell|say|give|provide|friendly|briefly|offer|something|respond|structure|clear|medium|length|too|long|expose|token|bearer|mention)\b/gi;
const PT = /\b(o|os|de|do|da|dos|das|que|você|voce|não|nao|para|pra|com|uma|um|é|e|está|esta|vou|quer|pode|posso|seu|sua|aqui|isso|tudo|bem|oi|olá|ola|chefe|chefe|já|ja|mais|como|mas|se|por|na|nos|nas|ao|aos|ele|ela|eles|te|nós|foi|são|sao|tem|têm|ter|fazer|faço|faco|quero|precisa|precisamos|vamos|então|entao|também|tambem|agora|hoje|sim|obrigado|pronto|segue|arquivo|pasta|comando|tela|print|roteiro|vídeo|video|equipe|estoque|unidades|dia|semana|boa|bom|tranquilo|trabalho|coisa|alguma|qual|quais|onde|quando|porque|certo|claro|beleza|valeu|deu|fiz|feito|consegui|achei|encontrei)\b/gi;

function score(s: string): "en" | "pt" | "?" {
  const en = (s.match(EN) ?? []).length;
  const pt = (s.match(PT) ?? []).length;
  if (en === 0 && pt === 0) return "?";
  if (en >= 2 && en > pt) return "en";
  if (pt >= 1 && pt >= en) return "pt";
  if (en === 1 && pt === 0 && s.length < 40) return "?"; // "OK." / "Estoque ok, 42 unidades."
  return en > pt ? "en" : pt > 0 ? "pt" : "?";
}

/** Divide em frases (também quando falta o espaço depois do ponto: "Keep short.Eae, o chefe!"). */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|(?<=[.!?])(?=[A-ZÁÉÍÓÚÂÊÔÃÕÀ])|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Separa pensamento de resposta.
 *
 * `permiteIngles` existe por causa dos bots que PRECISAM responder em inglês
 * (o professor de idiomas, por exemplo). Para eles, a heurística de "inglês =
 * pensamento" apagaria a resposta inteira, então só os blocos marcados
 * (<think>…</think>) são tratados como pensamento.
 */
export function splitThoughts(text: string, opcoes: { permiteIngles?: boolean; /** sem rede de segurança: na fala ao vivo é melhor calar que ler o raciocínio */ aoVivo?: boolean } = {}): { answer: string; thought: string } {
  let thought = "";
  let t = text;
  // blocos marcados
  t = t.replace(/<(think|thinking|reasoning|scratchpad)>[\s\S]*?<\/\1>/gi, (m) => { thought += m + "\n"; return ""; });
  t = t.replace(/<(think|thinking|reasoning)>[\s\S]*$/i, (m) => { thought += m; return ""; }); // tag aberta sem fechar

  // bot que fala outro idioma: a heurística de inglês não se aplica
  if (opcoes.permiteIngles) return { answer: t.trim(), thought: thought.trim() };

  // raciocínio em inglês no começo
  const parts = sentences(t);
  let i = 0;
  while (i < parts.length) {
    const s = parts[i];
    const sc = score(s);
    if (sc === "en") { thought += s + " "; i++; continue; }
    if (sc === "?" && i + 1 < parts.length && score(parts[i + 1]) === "en" && s.length < 60) { thought += s + " "; i++; continue; }
    break;
  }
  const rest = parts.slice(i);
  let answer = (rest.length ? reassemble(t, rest) : "").trim();

  // Rede de segurança: a heurística NUNCA pode engolir a mensagem toda. Se sobrou
  // nada mas havia texto fora de bloco marcado, a heurística errou — aquilo era a
  // resposta (o bot respondeu em inglês de propósito). Melhor entregar do que calar.
  // (ao vivo a rede não vale: o texto ainda está chegando, e o que parece inglês agora
  //  pode ser só o começo do raciocínio — falar seria ler o pensamento em voz alta)
  if (!answer && t.trim() && !opcoes.aoVivo) {
    return { answer: t.trim(), thought: thought.trim() };
  }
  return { answer, thought: thought.trim() };
}

/** Recupera a resposta a partir da primeira frase mantida, preservando quebras de linha do original. */
function reassemble(original: string, kept: string[]): string {
  const first = kept[0];
  const idx = original.indexOf(first);
  return idx >= 0 ? original.slice(idx) : kept.join(" ");
}
