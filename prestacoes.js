import { sb, esc, fmt, nomeMes, definirMes, confirmar, toast, mensagemErro, plural, abrirJanela } from "./comum.js";
import { gerarPDF } from "./pdf-prestacao.js";

const STATUS = {
  em_andamento: ["Em andamento", "pendente"], em_conferencia: ["Em conferência", "alerta"],
  concluida: ["Concluída", "ok"], reaberta: ["Reaberta", "neutro"],
};
let estado;

export async function render(el, ctx) {
  estado = { el, ctx };
  await carregar();
}

async function carregar() {
  const { el, ctx } = estado;
  const { data, error } = await sb.from("vw_resumo_mensal").select("*").order("mes", { ascending: false });
  if (error) { el.innerHTML = `<p class="aviso aviso-erro">${esc(mensagemErro(error))}</p>`; return; }
  el.innerHTML = `
    <section class="painel">
      <div class="painel-cabeca"><h2 class="titulo">Prestações por mês</h2>
        <span class="resumo">Concluir trava o mês contra alterações; reabrir libera de novo. Tudo fica no histórico.</span></div>
      ${data.length ? `<div class="tabela-rolagem"><table class="tabela cartoes">
        <thead><tr><th>Mês</th><th class="direita">Pago</th><th class="direita">A pagar</th>
          <th>Conferidos</th><th>Situação</th><th><span class="sr">Ações</span></th></tr></thead>
        <tbody>${data.map((r) => {
          const st = STATUS[r.status_prestacao] || STATUS.em_andamento;
          const extra = [plural(r.qtd_lancamentos || 0, "lançamento", "lançamentos"),
            r.coletas_obra_centavos ? `${fmt.dinheiro(r.coletas_obra_centavos)} reaproveitado` : "",
            r.concluida_em ? `concluída em ${fmt.data(r.concluida_em)}` : ""].filter(Boolean).join(", ");
          return `<tr data-mes="${r.mes}">
            <td class="td-desc"><span class="desc-principal sem-quebra">${esc(nomeMes(r.mes))}</span><div class="sec">${esc(extra)}</div></td>
            <td class="valor td-valor"><span class="so-cel">Pago </span>${fmt.dinheiro(r.pagamentos_efetivados_centavos)}</td>
            <td class="valor td-data" style="text-align:right"><span class="so-cel">A pagar </span>${fmt.dinheiro(r.pagar_pendente_centavos)}</td>
            <td class="td-socio sem-quebra"><span class="so-cel">Conferidos </span>${r.qtd_conferidos || 0} de ${r.qtd_lancamentos || 0}${r.qtd_divergencias ? ` <span class="selo selo-erro">${r.qtd_divergencias} diverg.</span>` : ""}</td>
            <td class="td-sit"><span class="selo selo-${st[1]}">${st[0]}</span></td>
            <td class="td-acao"><div class="tabela-acoes">
              <button class="botao botao-texto botao-acao" data-ver="${r.mes}" title="Ver os lançamentos deste mês">Abrir</button>
              <button class="botao botao-secundario botao-acao" data-pdf="${r.mes}">Gerar PDF</button>
              ${acoesStatus(r, ctx)}
            </div></td></tr>`;
        }).join("")}</tbody></table></div>`
        : `<div class="vazio-tabela"><strong>Nenhuma prestação ainda.</strong>Os meses aparecem aqui assim que houver lançamentos.</div>`}
    </section>`;

  el.querySelectorAll("[data-ver]").forEach((b) => b.onclick = () => { definirMes(b.dataset.ver); location.hash = "#/lancamentos"; });
  el.querySelectorAll("[data-pdf]").forEach((b) => b.onclick = async () => {
    b.classList.add("carregando");
    try {
      const r = await gerarPDF({ mes: b.dataset.pdf, perfil: ctx.perfil });
      toast(`PDF ${r.codigo} gerado: ${r.nomeArquivo}`, "ok");
    } catch (e) { toast(mensagemErro(e), "erro"); }
    finally { b.classList.remove("carregando"); }
  });
  el.querySelectorAll("[data-status]").forEach((b) => b.onclick = () => mudarStatus(b.dataset.mes, b.dataset.status, data.find((r) => r.mes === b.dataset.mes)));
}

function acoesStatus(r, ctx) {
  const s = r.status_prestacao;
  if (ctx.eAdmin) {
    if (s === "concluida") return `<button class="botao botao-texto botao-acao" data-mes="${r.mes}" data-status="reaberta">Reabrir</button>`;
    return `<button class="botao botao-principal botao-acao" data-mes="${r.mes}" data-status="concluida">Concluir</button>`;
  }
  if (ctx.podeEditar && s !== "concluida" && s !== "em_conferencia") {
    return `<button class="botao botao-texto botao-acao" data-mes="${r.mes}" data-status="em_conferencia">Em conferência</button>`;
  }
  return "";
}

async function mudarStatus(mes, status, r) {
  const nome = nomeMes(mes);
  if (status === "concluida") {
    const pend = [];
    if (r.qtd_aguardando_conferencia) pend.push(plural(r.qtd_aguardando_conferencia, "lançamento não conferido", "lançamentos não conferidos"));
    if (r.qtd_divergencias) pend.push(plural(r.qtd_divergencias, "divergência", "divergências"));
    const ok = await confirmar({
      titulo: `Concluir ${nome}`,
      texto: `${pend.length ? `Atenção: ainda há ${pend.join(" e ")}. ` : "Todos os lançamentos estão conferidos. "}Depois de concluída, ninguém consegue alterar lançamentos deste mês até o administrador reabrir.`,
      botao: "Concluir prestação",
    });
    if (!ok) return;
  } else if (status === "reaberta") {
    const ok = await confirmar({ titulo: `Reabrir ${nome}`, texto: "Os lançamentos deste mês voltam a poder ser alterados. A reabertura fica registrada no histórico.", botao: "Reabrir prestação" });
    if (!ok) return;
  }
  const { error } = await sb.rpc("fn_alterar_status_prestacao", { p_mes: mes, p_status: status });
  if (error) return toast(mensagemErro(error), "erro");
  toast(status === "concluida" ? `${nome} concluída.` : status === "reaberta" ? `${nome} reaberta.` : `${nome} enviada para conferência.`, "ok");
  await carregar();
}
