import { sb, esc, fmt, seletorMes, mesAtual, mudarMes, nomeMes, mensagemErro } from "./comum.js";
import { abrirDetalhes, textoPrazo } from "./lancamento-janelas.js";

let estado;
const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export async function render(el, ctx) {
  estado = { el, ctx, mes: mesAtual() };
  el.innerHTML = `<div class="barra"><div id="p-mes"></div><span class="sec">Valores pela data do lançamento.</span></div><div id="p-corpo"></div>`;
  await carregar();
}

async function carregar() {
  const { el, ctx, mes } = estado;
  el.querySelector("#p-mes").replaceChildren(seletorMes(mes, (n) => { estado.mes = n; carregar(); }));
  const corpo = el.querySelector("#p-corpo");
  const [res, soc, lin, contas] = await Promise.all([
    sb.from("vw_resumo_mensal").select("*").order("mes"),
    sb.from("vw_resumo_pagador").select("*").eq("mes", mes).order("pagador"),
    sb.from("vw_lancamentos").select("*").eq("mes_referencia", mes),
    sb.from("vw_contas_pagar").select("*").order("data_vencimento").limit(5),
  ]);
  for (const r of [res, soc, lin]) if (r.error) { corpo.innerHTML = `<p class="aviso aviso-erro">${esc(mensagemErro(r.error))}</p>`; return; }

  const r = res.data.find((x) => x.mes === mes) || {};
  const ativos = lin.data.filter((l) => l.situacao !== "cancelado");
  const pagos = ativos.filter((l) => l.tipo === "pagamento" && l.valor_efetivo_centavos > 0);

  // Últimos 6 meses até o mês escolhido
  const seis = Array.from({ length: 6 }, (_, i) => mudarMes(mes, i - 5));
  const serie = seis.map((m) => res.data.find((x) => x.mes === m) || { mes: m });
  const maxBarra = Math.max(1, ...serie.map((s) => Math.max(s.pagamentos_efetivados_centavos || 0, s.pagar_pendente_centavos || 0)));

  const agrupar = (lista, chave) => {
    const mapa = new Map();
    for (const l of lista) mapa.set(l[chave] || "Não informada", (mapa.get(l[chave] || "Não informada") || 0) + l.valor_efetivo_centavos);
    return [...mapa].sort((a, b) => b[1] - a[1]);
  };
  const barrasH = (pares, vazio) => {
    if (!pares.length) return `<p class="sec" style="margin:0">${vazio}</p>`;
    const max = Math.max(...pares.map((p) => p[1]));
    return `<div class="barras-h">${pares.map(([n, v]) => `
      <div class="barra-h"><span class="rot">${esc(n)}</span>
        <span class="trilho"><i style="width:${Math.max(2, (v / max) * 100)}%"></i></span>
        <span class="val num">${fmt.dinheiro(v)}</span></div>`).join("")}</div>`;
  };

  const socios = soc.data.filter((s) => s.pago_centavos || s.pendente_centavos || s.coletas_obra_centavos || s.recebido_centavos);
  corpo.innerHTML = `
    <div class="totais">
      <div class="total"><span>Pago no mês</span><strong>${fmt.dinheiro(r.pagamentos_efetivados_centavos)}</strong></div>
      <div class="total ${r.pagar_pendente_centavos ? "destaque-amarelo" : ""}"><span>A pagar</span><strong>${fmt.dinheiro(r.pagar_pendente_centavos)}</strong>
        ${r.vencidas_centavos ? `<small class="txt-vermelho">${fmt.dinheiro(r.vencidas_centavos)} vencido</small>` : "<small>Lançados neste mês</small>"}</div>
      <div class="total"><span>Material reaproveitado</span><strong>${fmt.dinheiro(r.coletas_obra_centavos)}</strong><small>Fora do total pago</small></div>
      <div class="total"><span>Recebido no mês</span><strong>${fmt.dinheiro(r.recebimentos_efetivados_centavos)}</strong>
        <small>Saldo ${fmt.dinheiro(r.saldo_liquido_centavos ?? ((r.recebimentos_efetivados_centavos || 0) - (r.pagamentos_efetivados_centavos || 0)))}</small></div>
      <div class="total"><span>Conferidos</span><strong>${r.qtd_conferidos || 0} de ${r.qtd_lancamentos || 0}</strong>
        <small>${r.qtd_divergencias ? `${r.qtd_divergencias} com divergência` : "Impressos e arquivados na pasta"}</small></div>
    </div>

    <div class="painel-grade">
      <section class="painel">
        <div class="painel-cabeca"><h2 class="titulo">Por sócio</h2><span class="resumo">Quem pagou em ${esc(nomeMes(mes).toLowerCase())}</span></div>
        ${socios.length ? `<div class="tabela-rolagem"><table class="tabela">
          <thead><tr><th>Sócio</th><th class="direita">Pago</th><th class="direita">A pagar</th><th class="direita">Reaproveitado</th></tr></thead>
          <tbody>${socios.map((s) => `<tr><td><strong>${esc(s.pagador)}</strong></td>
            <td class="valor">${fmt.dinheiro(s.pago_centavos)}</td><td class="valor">${fmt.dinheiro(s.pendente_centavos)}</td>
            <td class="valor" style="color:var(--texto-2)">${fmt.dinheiro(s.coletas_obra_centavos)}</td></tr>`).join("")}</tbody></table></div>`
          : `<div class="vazio-tabela">Nenhum lançamento neste mês.</div>`}
      </section>

      <section class="painel">
        <div class="painel-cabeca"><h2 class="titulo">Próximos vencimentos</h2><a class="botao botao-texto botao-acao" href="#/contas" style="margin-left:auto">Ver todos</a></div>
        ${contas.data?.length ? `<table class="tabela"><tbody>${contas.data.map((c) => `
          <tr class="clicavel ${c.cor_vencimento ? `cor-${c.cor_vencimento}` : ""}" data-id="${c.id}" tabindex="0">
            <td class="data"><strong>${fmt.data(c.data_vencimento).slice(0, 5)}</strong><span class="prazo">${esc(textoPrazo(c.dias_para_vencer))}</span></td>
            <td><span class="desc-principal">${esc(c.descricao)}</span>${c.parcela_rotulo ? `<span class="etiqueta">${esc(c.parcela_rotulo)}</span>` : ""}</td>
            <td class="valor">${fmt.dinheiro(c.saldo_pendente_centavos)}</td></tr>`).join("")}</tbody></table>`
          : `<div class="vazio-tabela">Nenhuma conta em aberto.</div>`}
      </section>

      <section class="painel largo">
        <div class="painel-cabeca"><h2 class="titulo">Últimos 6 meses</h2>
          <span class="legenda-mini"><i class="pago"></i>Pago <i class="apagar"></i>A pagar</span></div>
        <div class="grafico-meses" role="img" aria-label="Pago e a pagar nos últimos 6 meses">
          ${serie.map((s) => {
            const [a, m] = s.mes.split("-").map(Number);
            const p = s.pagamentos_efetivados_centavos || 0, ap = s.pagar_pendente_centavos || 0;
            return `<div class="mes-col ${s.mes === mes ? "atual" : ""}" title="${esc(nomeMes(s.mes))}: pago ${fmt.dinheiro(p)}, a pagar ${fmt.dinheiro(ap)}">
              <span class="val num">${p ? fmt.dinheiro(p).replace(/,\d\d$/, "") : ""}</span>
              <div class="barras"><i class="pago" style="height:${(p / maxBarra) * 100}%"></i><i class="apagar" style="height:${(ap / maxBarra) * 100}%"></i></div>
              <span class="rot">${MESES_CURTOS[m - 1]}${m === 1 ? `/${String(a).slice(2)}` : ""}</span></div>`;
          }).join("")}
        </div>
      </section>

      <section class="painel">
        <div class="painel-cabeca"><h2 class="titulo">Pago por categoria</h2></div>
        <div class="painel-corpo">${barrasH(agrupar(pagos, "categoria_nome"), "Nenhum pagamento neste mês.")}</div>
      </section>
      <section class="painel">
        <div class="painel-cabeca"><h2 class="titulo">Pago por forma de pagamento</h2></div>
        <div class="painel-corpo">${barrasH(agrupar(pagos, "forma_pagamento_nome"), "Nenhum pagamento neste mês.")}</div>
      </section>
    </div>`;

  corpo.querySelectorAll("tr[data-id]").forEach((tr) => {
    const abrir = () => abrirDetalhes({ ctx, id: Number(tr.dataset.id), aoMudar: carregar });
    tr.onclick = abrir;
    tr.onkeydown = (e) => { if (e.key === "Enter") abrir(); };
  });
}
