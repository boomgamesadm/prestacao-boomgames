// Funções compartilhadas por todas as páginas
import { CONFIG } from "./config.js";

if (!window.supabase?.createClient) {
  document.body.innerHTML =
    '<p style="padding:24px;font-family:sans-serif">Não foi possível carregar o sistema. Verifique a conexão com a internet e recarregue a página.</p>';
  throw new Error("supabase-js não carregou");
}

export const sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseChave, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const NOMES_PERFIL = { administrador: "Administrador", editor: "Editor", leitor: "Leitor" };

/** Perfil do usuário logado (ou null se não houver sessão/perfil). */
export async function carregarPerfil() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const { data, error } = await sb.from("perfis").select("*").eq("id", session.user.id).maybeSingle();
  if (error) throw error;
  return data;
}

/** Escapa texto antes de colocar dentro de HTML (evita injeção de código). */
export function esc(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const fusoBR = { timeZone: "America/Fortaleza" };
export const fmt = {
  /** 2026-10-15T21:14:26Z → 15/10/2026 18:14 */
  dataHora(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR", fusoBR) + " " +
           d.toLocaleTimeString("pt-BR", { ...fusoBR, hour: "2-digit", minute: "2-digit" });
  },
  /** 2026-10-15 → 15/10/2026 (sem conversão de fuso: é uma data pura) */
  data(isoData) {
    if (!isoData) return "—";
    const [a, m, d] = String(isoData).slice(0, 10).split("-");
    return `${d}/${m}/${a}`;
  },
  /** resultado com sinal: +R$ 1.234,56 / −R$ 500,00 */
  sinal(centavos) {
    const v = Number(centavos || 0);
    return (v > 0 ? "+" : v < 0 ? "−" : "") + fmt.dinheiro(Math.abs(v));
  },
  /** 123456 centavos → R$ 1.234,56 */
  dinheiro(centavos) {
    return (Number(centavos || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  },
};

/** Traduz mensagens de erro técnicas para português claro. */
export function mensagemErro(erro) {
  const m = String(erro?.message ?? erro ?? "");
  if (/Invalid login credentials/i.test(m)) return "E-mail ou senha incorretos.";
  if (/banned/i.test(m)) return "Esta conta está desativada. Fale com o administrador.";
  if (/rate limit|too many/i.test(m)) return "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Sem conexão com o servidor. Verifique a internet.";
  if (/JWT|session/i.test(m)) return "Sua sessão expirou. Entre novamente.";
  if (/row-level security|permission denied/i.test(m)) return "Seu perfil não tem permissão para esta ação.";
  if (/should be different/i.test(m)) return "A nova senha precisa ser diferente da atual.";
  // Regras do banco, em linguagem clara
  const regras = {
    socio_obrigatorio: "Escolha o sócio que pagou.",
    liquidado_tem_data: "Informe a data do pagamento.",
    parcial_tem_valor: "Informe quanto já foi pago.",
    cancelado_com_motivo: "Informe o motivo do cancelamento.",
    divergente_com_motivo: "Descreva a divergência encontrada.",
    agendado_tem_vencimento: "Informe a data de vencimento.",
    lancamentos_valor_centavos_check: "O valor precisa ser maior que zero.",
    lancamentos_descricao_check: "Preencha a descrição.",
    lanc_faturamento_por_mes: "Já existe faturamento lançado neste mês. Abra o existente para corrigir o valor.",
  };
  for (const [regra, texto] of Object.entries(regras)) if (m.includes(regra)) return texto;
  return m || "Algo deu errado. Tente novamente.";
}

/** Chama a Edge Function de usuários e devolve o JSON (ou lança erro legível). */
export async function chamarFuncaoUsuarios(corpo) {
  const { data, error } = await sb.functions.invoke("gerenciar-usuarios", { body: corpo });
  if (error) {
    let msg = error.message;
    try {
      const det = await error.context?.json?.();
      if (det?.erro) msg = det.erro;
    } catch { /* resposta sem JSON */ }
    if (/Failed to send|non-2xx/i.test(msg) && !/erro/i.test(msg)) {
      msg = "O serviço de usuários não respondeu. Confira se a função gerenciar-usuarios foi publicada no Supabase.";
    }
    throw new Error(msg);
  }
  if (data?.erro) throw new Error(data.erro);
  return data;
}

/** Regras de senha: mínimo 10 caracteres, com letras e números. */
export function validarSenha(senha, confirmacao) {
  if (senha.length < 10) return "A senha precisa ter pelo menos 10 caracteres.";
  if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return "Use letras e números na senha.";
  if (confirmacao !== undefined && senha !== confirmacao) return "As duas senhas não são iguais.";
  return null;
}

// ---------------- Notificação rápida ----------------
export function toast(texto, tipo = "") {
  let area = document.querySelector(".toast-area");
  if (!area) {
    area = document.createElement("div");
    area.className = "toast-area";
    area.setAttribute("role", "status");
    area.setAttribute("aria-live", "polite");
    document.body.append(area);
  }
  const t = document.createElement("div");
  t.className = `toast ${tipo}`;
  t.textContent = texto;
  area.append(t);
  setTimeout(() => t.remove(), 4500);
}

// ---------------- Janela (modal) ----------------
/**
 * Abre uma janela. `corpo` é HTML já escapado. `acoes` é uma lista de
 * { texto, classe, aoClicar(janela) } — se aoClicar devolver false, a janela fica aberta.
 */
export function abrirJanela({ titulo, corpo, acoes = [], aoAbrir }) {
  const fundo = document.createElement("div");
  fundo.className = "janela-fundo";
  fundo.innerHTML = `
    <div class="janela" role="dialog" aria-modal="true" aria-labelledby="janela-titulo">
      <div class="janela-cabeca">
        <h2 class="titulo" id="janela-titulo">${esc(titulo)}</h2>
        <button type="button" class="janela-fechar" aria-label="Fechar">${ICONES.fechar}</button>
      </div>
      <div class="janela-corpo">${corpo}</div>
      <div class="janela-rodape"></div>
    </div>`;
  const anterior = document.activeElement;
  const fechar = () => {
    fundo.remove();
    document.removeEventListener("keydown", aoTeclar);
    anterior?.focus?.();
  };
  const aoTeclar = (e) => { if (e.key === "Escape") fechar(); };
  document.addEventListener("keydown", aoTeclar);
  fundo.querySelector(".janela-fechar").onclick = fechar;
  fundo.addEventListener("mousedown", (e) => { if (e.target === fundo) fechar(); });

  const rodape = fundo.querySelector(".janela-rodape");
  const api = { elemento: fundo, fechar };
  for (const a of acoes) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `botao ${a.classe || "botao-secundario"}`;
    b.textContent = a.texto;
    b.onclick = async () => {
      if (!a.aoClicar) return fechar();
      b.classList.add("carregando");
      try {
        const manter = await a.aoClicar(api);
        if (manter !== false) fechar();
      } finally {
        b.classList.remove("carregando");
      }
    };
    rodape.append(b);
  }
  document.body.append(fundo);
  aoAbrir?.(api);
  (fundo.querySelector("input, select, textarea") || fundo.querySelector(".janela-rodape .botao:last-child"))?.focus();
  return api;
}

/** Pergunta de confirmação simples. Resolve true/false. */
export function confirmar({ titulo, texto, botao = "Confirmar", perigo = false }) {
  return new Promise((resolve) => {
    let decidido = false;
    const j = abrirJanela({
      titulo,
      corpo: `<p>${esc(texto)}</p>`,
      acoes: [
        { texto: "Cancelar", classe: "botao-secundario" },
        { texto: botao, classe: perigo ? "botao-perigo" : "botao-principal", aoClicar: () => { decidido = true; resolve(true); } },
      ],
    });
    new MutationObserver((_, obs) => {
      if (!document.body.contains(j.elemento)) { obs.disconnect(); if (!decidido) resolve(false); }
    }).observe(document.body, { childList: true });
  });
}

// ---------------- Ícones (traço simples, 24×24) ----------------
const svg = (d) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICONES = {
  painel: svg('<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>'),
  calendario: svg('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  lista: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  boleto: svg('<path d="M4 4h16v16H4z"/><path d="M8 8v8M11 8v8M14 8v8M17 8v8"/>'),
  documento: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>'),
  pdf: svg('<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 15h6M12 12v6"/>'),
  historico: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 3"/>'),
  usuarios: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>'),
  config: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  sair: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
  menu: svg('<path d="M3 6h18M3 12h18M3 18h18"/>'),
  recolher: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 10l-2 2 2 2"/>'),
  fechar: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  mais: svg('<path d="M12 5v14M5 12h14"/>'),
  esquerda: svg('<path d="m15 18-6-6 6-6"/>'),
  direita: svg('<path d="m9 18 6-6-6-6"/>'),
  anexo: svg('<path d="m21 12-8.6 8.6a5.7 5.7 0 0 1-8-8L13 4a3.8 3.8 0 0 1 5.4 5.4l-8.6 8.6a1.9 1.9 0 0 1-2.7-2.7l8-8"/>'),
  busca: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  copiar: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
};


// ---------------- Datas e meses ----------------
/** Hoje no fuso de Fortaleza, como 'AAAA-MM-DD'. */
export function hojeISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" });
}
/** Soma dias a uma data 'AAAA-MM-DD' (sem problemas de fuso). */
export function somarDias(iso, dias) {
  const [a, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
               "agosto", "setembro", "outubro", "novembro", "dezembro"];
export function nomeMes(iso) {
  const [a, m] = iso.split("-").map(Number);
  const n = MESES[m - 1];
  return `${n[0].toUpperCase()}${n.slice(1)} de ${a}`;
}
/** Mês escolhido (vale para todas as páginas até fechar o navegador). */
export function mesAtual() {
  return sessionStorage.getItem("bg_mes") || hojeISO().slice(0, 7) + "-01";
}
export function definirMes(iso) { sessionStorage.setItem("bg_mes", iso); }
export function mudarMes(iso, delta) {
  const [a, m] = iso.split("-").map(Number);
  const t = a * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`;
}
/** Seletor ‹ Outubro de 2026 › — chama aoMudar(novoMes). */
export function seletorMes(mes, aoMudar) {
  const div = document.createElement("div");
  div.className = "seletor-mes";
  div.innerHTML = `
    <button type="button" class="seta" aria-label="Mês anterior">${ICONES.esquerda}</button>
    <label class="mes-nome"><span>${esc(nomeMes(mes))}</span>
      <input type="month" value="${mes.slice(0, 7)}" aria-label="Escolher mês"></label>
    <button type="button" class="seta" aria-label="Próximo mês">${ICONES.direita}</button>`;
  const [ant, prox] = div.querySelectorAll(".seta");
  const ir = (novo) => { definirMes(novo); aoMudar(novo); };
  ant.onclick = () => ir(mudarMes(mes, -1));
  prox.onclick = () => ir(mudarMes(mes, 1));
  div.querySelector("input").onchange = (e) => { if (e.target.value) ir(e.target.value + "-01"); };
  return div;
}

// ---------------- Dinheiro ----------------
/** "1.234,56" / "1234,5" / "R$ 15" → centavos (inteiro) ou null. */
export function lerDinheiro(texto) {
  let t = String(texto ?? "").replace(/[R$\s]/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const v = Number(t);
  return Number.isFinite(v) ? Math.round(v * 100) : null;
}
export function dinheiroCampo(centavos) {
  if (centavos == null) return "";
  return (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------- Cadastros de apoio (cache por página) ----------------
let cacheCadastros = null;
export async function cadastros(recarregar = false) {
  if (cacheCadastros && !recarregar) return cacheCadastros;
  const [c, f, p, cfg] = await Promise.all([
    sb.from("categorias").select("*").order("ordem").order("nome"),
    sb.from("formas_pagamento").select("*").order("ordem").order("nome"),
    sb.from("pagadores").select("*").order("ordem").order("nome"),
    sb.from("configuracoes").select("*").single(),
  ]);
  for (const r of [c, f, p, cfg]) if (r.error) throw r.error;
  cacheCadastros = { categorias: c.data, formas: f.data, pagadores: p.data, config: cfg.data };
  return cacheCadastros;
}

// ---------------- Situações (texto e cor do selo) ----------------
export const SITUACAO = {
  pago: ["Pago", "ok"], recebido: ["Recebido", "ok"],
  a_pagar: ["A pagar", "pendente"], a_receber: ["A receber", "pendente"],
  agendado: ["Agendado", "pendente"],
  parcialmente_pago: ["Pago em parte", "pendente"], recebimento_parcial: ["Recebido em parte", "pendente"],
  vencido: ["Vencido", "erro"], atrasado: ["Atrasado", "erro"],
  material_reaproveitado: ["Reaproveitado", "neutro"],
  no_cartao: ["No cartão", "neutro"],
  faturado: ["Faturamento", "ok"],
  cancelado: ["Cancelado", "off"],
};
export const CONFERENCIA = {
  pendente: ["Não conferido", "off"], conferido: ["Conferido", "ok"], divergente: ["Divergência", "erro"],
};
export const TIPO = { pagamento: "Pagamento", recebimento: "Recebimento", coleta_obra: "Coleta de obra", faturamento: "Faturamento da loja", transferencia_interna: "Transferência interna" };
export function selo([texto, cor]) { return `<span class="selo selo-${cor}">${esc(texto)}</span>`; }

// ---------------- Documentos ----------------
export const TIPOS_DOC = { nota_fiscal: "Nota fiscal", nfs_e: "NFS-e", recibo: "Recibo", boleto: "Boleto", comprovante: "Comprovante", outro: "Outro" };
const MIMES = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
export async function anexarDocumento(lancamentoId, arquivo, tipo) {
  const ext = MIMES[arquivo.type];
  if (!ext) throw new Error("Use arquivos PDF, JPG ou PNG.");
  if (arquivo.size > 15 * 1024 * 1024) throw new Error("O arquivo passa de 15 MB. Reduza o tamanho e tente de novo.");
  const caminho = `lancamentos/${lancamentoId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.from("documentos").insert({
    caminho, nome_original: arquivo.name, mime: arquivo.type, tamanho_bytes: arquivo.size, tipo, lancamento_id: lancamentoId,
  });
  if (error) throw error;
  const { error: e2 } = await sb.storage.from("documentos").upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
  if (e2) throw new Error("O registro foi criado, mas o envio do arquivo falhou. Tente anexar de novo.");
}
/** Abre o documento numa nova aba com um link que expira em 60 segundos. */
export async function abrirDocumento(caminho) {
  const aba = window.open("", "_blank");
  const { data, error } = await sb.storage.from("documentos").createSignedUrl(caminho, 60);
  if (error || !data?.signedUrl) { aba?.close(); throw error || new Error("Não foi possível abrir o arquivo."); }
  if (aba) aba.location = data.signedUrl; else location.href = data.signedUrl;
}

/** plural(1, "conta") → "1 conta"; plural(3, "conta") → "3 contas" */
export function plural(n, singular, pluralForma = singular + "s") {
  return `${n} ${n === 1 ? singular : pluralForma}`;
}
