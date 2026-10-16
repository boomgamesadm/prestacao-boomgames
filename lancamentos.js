import {
  sb, esc, fmt, ICONES, seletorMes, mesAtual, SITUACAO, CONFERENCIA, selo, mensagemErro, nomeMes, plural,
} from "../comum.js";
import { abrirFormulario, abrirDetalhes, textoPrazo } from "../lancamento-janelas.js";

const ABAS = [
  { id: "todos", nome: "Todos", filtro: (l) => l.situacao !== "cancelado" },
  { id: "pagos", nome: "Pagos", filtro: (l) => l.tipo === "pagamento" && l.situacao === "pago" },
  { id: "apagar", nome: "A pagar", filtro: (l) => l.tipo === "pagamento" && l.saldo_pendente_centavos > 0 },
  { id: "coletas", nome: "Coleta de obra", filtro: (l) => l.tipo === "coleta_obra" && l.situacao !== "cancelado" },
  { id: "receb", nome: "Recebimentos", filtro: (l) => l.tipo === "recebimento" && l.situacao !== "cancelado" },
  { id: "nf", nome: "Com nota fiscal", filtro: (l) => l.situacao !== "cancelado" && temNotaFiscal(l) },
  { id: "nfpend", nome: "Nota a receber", filtro: (l) => l.situacao !== "cancelado" && l.nota_pendente },
  { id: "cpf", nome: "CPF", filtro: (l) => l.situacao !== "cancelado" && l.contraparte_tipo === "cpf" },
  { id: "naoconf", nome: "Não conferidos", filtro: (l) => l.situacao !== "cancelado" && l.tipo !== "coleta_obra" && l.status_conferencia === "pendente" },
  { id: "diverg", nome: "Com divergência", filtro: (l) => l.situacao !== "cancelado" && l.status_conferencia === "divergente" },
  { id: "cancel", nome: "Cancelados", filtro: (l) => l.situacao === "cancelado" },
];
const NOTAS = ["Nota fiscal", "NFS-e", "Cupom fiscal"];
const temNotaFiscal = (l) => NOTAS.includes(l.tipo_documento) && !!l.numero_documento;

const ORDENS = {
  antigos: { nome: "Mais antigos primeiro", fn: (a, b) => a.data_movimentacao.localeCompare(b.data_movimentacao) || a.id - b.id },
  recentes: { nome: "Mais recentes primeiro", fn: (a, b) => b.data_movimentacao.localeCompare(a.data_movimentacao) || b.id - a.id },
  maior: { nome: "Maior valor primeiro", fn: (a, b) => b.valor_centavos - a.valor_centavos || a.id - b.id },
  menor: { nome: "Menor valor primeiro", fn: (a, b) => a.valor_centavos - b.valor_centavos || a.id - b.id },
  categoria: { nome: "Categoria (A a Z)", fn: (a, b) => (a.categoria_nome || "").localeCompare(b.categoria_nome || "", "pt-BR") || a.data_movimentacao.localeCompare(b.data_movimentacao) },
};

let estado;

export async function render(el, ctx) {
  estado = { el, ctx, mes: mesAtual(), aba: "todos", busca: "", ordem: sessionStorage.getItem("bg_ordem") || "antigos", linhas: [] };
  el.innerHTML = `
    <div class="barra">
      <div id="l-mes"></div>
      <label class="busca">${ICONES.busca}<span class="sr">Buscar</span>
        <input class="entrada" id="l-busca" type="search" placeholder="Buscar descrição, fornecedor ou nota"></label>
      <label><span class="sr">Ordenar</span>
        <select class="entrada" id="l-ordem">${Object.entries(ORDENS).map(([k, o]) =>
          `<option value="${k}" ${k === estado.ordem ? "selected" : ""}>${o.nome}</option>`).join("")}</select></label>
      ${ctx.podeEditar ? `<button class="botao botao-principal empurra" type="button" id="l-novo">${ICONES.mais}Novo lançamento</button>` : ""}
    </div>
    <div id="l-totais"></div>
    <section class="painel">
      <div class="abas" role="tablist" id="l-abas"></div>
      <div id="l-tabela"></div>
      <div class="legenda">
        <span><i style="background:var(--amarelo-suave);box-shadow:inset 3px 0 0 var(--amarelo-borda)"></i>A pagar, vence em até <span id="l-dias-am">10</span> dias</span>
        <span><i style="background:var(--vermelho-suave);box-shadow:inset 3px 0 0 var(--vermelho)"></i>A pagar, vence em até <span id="l-dias-vm">3</span> dias ou já venceu</span>
        <span><i style="background:var(--verde-suave);box-shadow:inset 3px 0 0 var(--verde)"></i>Conferido = impresso e arquivado na pasta</span>
      </div>
    </section>`;

  el.querySelector("#l-busca").addEventListener("input", (e) => { estado.busca = e.target.value; desenharTabela(); });
  el.querySelector("#l-ordem").addEventListener("change", (e) => {
    estado.ordem = e.target.value; sessionStorage.setItem("bg_ordem", estado.ordem); desenharTabela();
  });
  el.querySelector("#l-novo")?.addEventListener("click", () => abrirFormulario({ ctx, aoSalvar: carregar }));
  await carregar();
}

async function carregar() {
  const { el, mes } = estado;
  const m = el.querySelector("#l-mes");
  m.replaceChildren(seletorMes(mes, (novo) => { estado.mes = novo; carregar(); }));

  const [lin, res, cfg] = await Promise.all([
    sb.from("vw_lancamentos").select("*").eq("mes_referencia", mes).order("data_movimentacao").order("id"),
    sb.from("vw_resumo_mensal").select("*").eq("mes", mes).maybeSingle(),
    sb.from("configuracoes").select("dias_amarelo, dias_vermelho").single(),
  ]);
  if (lin.error) { el.querySelector("#l-tabela").innerHTML = `<p class="aviso aviso-erro" style="margin:16px">${esc(mensagemErro(lin.error))}</p>`; return; }
  estado.linhas = lin.data;
  if (cfg.data) {
    el.querySelector("#l-dias-am").textContent = cfg.data.dias_amarelo;
    el.querySelector("#l-dias-vm").textContent = cfg.data.dias_vermelho;
  }

  const r = res.data || {};
  el.querySelector("#l-totais").innerHTML = `
    <div class="totais">
      <div class="total"><span>Pago no mês</span><strong>${fmt.dinheiro(r.pagamentos_efetivados_centavos)}</strong></div>
      <div class="total ${r.pagar_pendente_centavos ? "destaque-amarelo" : ""}"><span>A pagar</span><strong>${fmt.dinheiro(r.pagar_pendente_centavos)}</strong>
        ${r.vencidas_centavos ? `<small>${fmt.dinheiro(r.vencidas_centavos)} vencido</small>` : ""}</div>
      <div class="total"><span>Material reaproveitado</span><strong>${fmt.dinheiro(r.coletas_obra_centavos)}</strong><small>Coleta de obra, fora do total pago</small></div>
      ${r.recebimentos_efetivados_centavos ? `<div class="total"><span>Recebido no mês</span><strong>${fmt.dinheiro(r.recebimentos_efetivados_centavos)}</strong></div>` : ""}
      <div class="total"><span>Lançamentos</span><strong>${r.qtd_lancamentos || 0}</strong>
        <small>${plural(r.qtd_conferidos || 0, "conferido")}${r.qtd_divergencias ? `, ${r.qtd_divergencias} com divergência` : ""}</small></div>
    </div>`;
  desenharTabela();
}

function desenharTabela() {
  const { el, ctx, linhas } = estado;
  const termo = estado.busca.trim().toLowerCase();
  const casa = (l) => !termo || [l.descricao, l.contraparte, l.numero_documento, l.categoria_nome, l.pagador_nome, l.observacoes]
    .some((t) => (t || "").toLowerCase().includes(termo));

  el.querySelector("#l-abas").innerHTML = ABAS.map((a) => {
    const n = linhas.filter((l) => a.filtro(l) && casa(l)).length;
    if (!n && !["todos", estado.aba].includes(a.id)) return "";
    return `<button class="aba" role="tab" aria-selected="${a.id === estado.aba}" data-aba="${a.id}">${a.nome}<span class="qtd">${n}</span></button>`;
  }).join("");
  el.querySelectorAll("[data-aba]").forEach((b) => b.onclick = () => { estado.aba = b.dataset.aba; desenharTabela(); });

  const aba = ABAS.find((a) => a.id === estado.aba);
  const lista = linhas.filter((l) => aba.filtro(l) && casa(l)).sort(ORDENS[estado.ordem].fn);
  const alvo = el.querySelector("#l-tabela");

  if (!lista.length) {
    alvo.innerHTML = `<div class="vazio-tabela">${
      termo ? `<strong>Nada encontrado para “${esc(estado.busca)}”.</strong>Tente outra palavra ou limpe a busca.`
      : linhas.length ? `<strong>Nenhum lançamento nesta aba.</strong>Escolha outra aba acima.`
      : `<strong>Nenhum lançamento em ${esc(nomeMes(estado.mes))}.</strong>${ctx.podeEditar ? "Use “Novo lançamento” para registrar o primeiro." : "Escolha outro mês no seletor acima."}`
    }</div>`;
    return;
  }

  alvo.innerHTML = `
    <div class="tabela-rolagem">
      <table class="tabela cartoes">
        <thead><tr>
          <th>Data</th><th>Descrição</th><th>Pago por</th><th>Forma</th>
          <th class="direita">Valor</th><th>Situação</th><th>Conferência</th>
        </tr></thead>
        <tbody>${lista.map(linha).join("")}</tbody>
      </table>
    </div>`;
  alvo.querySelectorAll("tr[data-id]").forEach((tr) => {
    const abrir = () => abrirDetalhes({ ctx, id: Number(tr.dataset.id), aoMudar: carregar });
    tr.onclick = abrir;
    tr.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); } };
  });
}

function linha(l) {
  const classes = ["clicavel", l.cor_vencimento ? `cor-${l.cor_vencimento}` : "", l.situacao === "cancelado" ? "cancelado" : ""].join(" ");
  const aberto = l.saldo_pendente_centavos > 0 && l.data_vencimento;
  return `
    <tr class="${classes}" data-id="${l.id}" tabindex="0" aria-label="Abrir lançamento ${esc(l.descricao)}">
      <td class="data td-data">${fmt.data(l.data_movimentacao)}
        ${aberto ? `<span class="prazo">Venc. ${fmt.data(l.data_vencimento).slice(0, 5)}, ${esc(textoPrazo(l.dias_para_vencer))}</span>` : ""}</td>
      <td class="td-desc">
        <span class="desc-principal">${esc(l.descricao)}</span>${l.parcela_rotulo ? `<span class="etiqueta">${esc(l.parcela_rotulo)}</span>` : ""}${l.qtd_documentos ? `<span class="clipe" title="${l.qtd_documentos === 1 ? "1 arquivo anexado" : `${l.qtd_documentos} arquivos anexados`}">${ICONES.anexo}${l.qtd_documentos}</span>` : ""}
        <div class="sec">${esc(l.categoria_nome || "")}${l.contraparte ? `, ${esc(l.contraparte)}` : ""}
          ${temNotaFiscal(l) ? `<span class="marca-doc">${l.tipo_documento === "Nota fiscal" ? "NF" : esc(l.tipo_documento)} ${esc(l.numero_documento)}</span>` : ""}
          ${l.nota_pendente ? `<span class="marca-doc pendente">Nota a receber</span>` : ""}
          ${l.contraparte_tipo === "cpf" ? `<span class="marca-doc">CPF</span>` : ""}</div>
      </td>
      <td class="sem-quebra td-socio">${esc(l.pagador_nome || "—")}</td>
      <td class="sec td-forma">${esc(l.forma_pagamento_nome || "—")}${l.vezes > 1 && !l.grupo_parcelas ? ` ${l.vezes}x` : ""}</td>
      <td class="valor td-valor">${fmt.dinheiro(l.valor_centavos)}</td>
      <td class="td-sit">${selo(SITUACAO[l.situacao] || [l.situacao, "neutro"])}</td>
      <td class="td-conf">${l.tipo === "coleta_obra" ? '<span class="sec">—</span>' : selo(CONFERENCIA[l.status_conferencia])}</td>
    </tr>`;
}
