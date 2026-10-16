import { sb, esc, fmt, mensagemErro, plural } from "../comum.js";
import { abrirDetalhes, registrarPagamento, textoPrazo } from "../lancamento-janelas.js";

let estado;

export async function render(el, ctx) {
  estado = { el, ctx };
  await carregar();
}

async function carregar() {
  const { el, ctx } = estado;
  const [r, cfg] = await Promise.all([
    sb.from("vw_contas_pagar").select("*").order("data_vencimento").order("id"),
    sb.from("configuracoes").select("dias_amarelo, dias_vermelho").single(),
  ]);
  if (r.error) { el.innerHTML = `<p class="aviso aviso-erro">${esc(mensagemErro(r.error))}</p>`; return; }
  const contas = r.data;
  const dAm = cfg.data?.dias_amarelo ?? 10, dVm = cfg.data?.dias_vermelho ?? 3;
  const soma = (lista) => lista.reduce((s, c) => s + c.saldo_pendente_centavos, 0);
  const vencidas = contas.filter((c) => c.dias_para_vencer < 0);
  const vermelho = contas.filter((c) => c.dias_para_vencer >= 0 && c.dias_para_vencer <= dVm);
  const amarelo = contas.filter((c) => c.dias_para_vencer > dVm && c.dias_para_vencer <= dAm);

  el.innerHTML = `
    <div class="totais">
      <div class="total ${vencidas.length ? "destaque-vermelho" : ""}"><span>Vencidas</span><strong>${fmt.dinheiro(soma(vencidas))}</strong><small>${plural(vencidas.length, "conta")}</small></div>
      <div class="total ${vermelho.length ? "destaque-vermelho" : ""}"><span>Vencem em até ${dVm} dias</span><strong>${fmt.dinheiro(soma(vermelho))}</strong><small>${plural(vermelho.length, "conta")}</small></div>
      <div class="total ${amarelo.length ? "destaque-amarelo" : ""}"><span>Vencem em até ${dAm} dias</span><strong>${fmt.dinheiro(soma(amarelo))}</strong><small>${plural(amarelo.length, "conta")}</small></div>
      <div class="total"><span>Total a pagar</span><strong>${fmt.dinheiro(soma(contas))}</strong><small>${plural(contas.length, "conta")} em aberto</small></div>
    </div>
    <section class="painel">
      <div class="painel-cabeca">
        <h2 class="titulo">Em aberto, por vencimento</h2>
        <span class="resumo">As mais urgentes aparecem primeiro.</span>
      </div>
      ${contas.length ? `
      <div class="tabela-rolagem">
        <table class="tabela cartoes">
          <thead><tr><th>Vencimento</th><th>Descrição</th><th>Pago por</th><th>Forma</th>
            <th class="direita">A pagar</th>${ctx.podeEditar ? '<th><span class="sr">Ação</span></th>' : ""}</tr></thead>
          <tbody>${contas.map((c) => `
            <tr class="clicavel ${c.cor_vencimento ? `cor-${c.cor_vencimento}` : ""}" data-id="${c.id}" tabindex="0">
              <td class="data td-data"><strong>${fmt.data(c.data_vencimento)}</strong><span class="prazo">${esc(textoPrazo(c.dias_para_vencer))}</span></td>
              <td class="td-desc"><span class="desc-principal">${esc(c.descricao)}</span>${c.parcela_rotulo ? `<span class="etiqueta">${esc(c.parcela_rotulo)}</span>` : ""}
                <div class="sec">${esc(c.categoria_nome || "")}${c.contraparte ? `, ${esc(c.contraparte)}` : ""}${c.numero_documento ? `, nº ${esc(c.numero_documento)}` : ""}</div></td>
              <td class="sem-quebra td-socio">${esc(c.pagador_nome || "—")}</td>
              <td class="sec td-forma">${esc(c.forma_pagamento_nome || "—")}</td>
              <td class="valor td-valor">${fmt.dinheiro(c.saldo_pendente_centavos)}</td>
              ${ctx.podeEditar ? `<td class="td-acao"><div class="tabela-acoes"><button class="botao botao-secundario botao-acao" data-pagar="${c.id}">Registrar pagamento</button></div></td>` : ""}
            </tr>`).join("")}
          </tbody>
        </table>
      </div>` : `<div class="vazio-tabela"><strong>Nenhuma conta em aberto.</strong>Tudo o que tinha vencimento já foi registrado como pago.</div>`}
      <div class="legenda">
        <span><i style="background:var(--amarelo-suave);box-shadow:inset 3px 0 0 var(--amarelo-borda)"></i>Vence em até ${dAm} dias</span>
        <span><i style="background:var(--vermelho-suave);box-shadow:inset 3px 0 0 var(--vermelho)"></i>Vence em até ${dVm} dias ou já venceu</span>
      </div>
    </section>`;

  el.querySelectorAll("tr[data-id]").forEach((tr) => {
    const abrir = () => abrirDetalhes({ ctx, id: Number(tr.dataset.id), aoMudar: carregar });
    tr.onclick = (e) => { if (!e.target.closest("[data-pagar]")) abrir(); };
    tr.onkeydown = (e) => { if (e.key === "Enter") abrir(); };
  });
  el.querySelectorAll("[data-pagar]").forEach((b) => b.onclick = () => {
    const lanc = contas.find((c) => c.id === Number(b.dataset.pagar));
    registrarPagamento({ lanc, aoSalvar: carregar });
  });
}
