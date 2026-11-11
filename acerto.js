import {
  sb, esc, fmt, ICONES, nomeMes, abrirJanela, confirmar, toast, mensagemErro, lerDinheiro, dinheiroCampo, hojeISO, mudarMes, plural,
} from "./comum.js";
import { gerarPDFAcerto } from "./pdf-acerto.js";

/**
 * Calcula o acerto entre dois sócios (sociedade 50/50), mês a mês.
 * Saldo positivo = o sócio B deve ao sócio A.
 * Para cada mês k (do primeiro mês com movimento até o mês atual):
 *   1. pagamentos feitos no mês k abatem o saldo;
 *   2. se o mês k já terminou, o saldo que vinha dos meses anteriores rende juros compostos do mês k;
 *   3. soma-se a diferença do mês k: (custo de A − custo de B) ÷ 2.
 * Assim, a dívida de agosto paga em janeiro tem juros de setembro a dezembro.
 */
export function calcularAcerto({ custos, idA, idB, pagamentos, taxa, mesAtual }) {
  const custoMes = new Map();                       // "AAAA-MM-01" → { a, b }
  for (const c of custos) {
    if (c.pagador_id !== idA && c.pagador_id !== idB) continue;
    const m = String(c.mes).slice(0, 10);
    const v = custoMes.get(m) || { a: 0, b: 0 };
    if (c.pagador_id === idA) v.a += c.custo_centavos || 0; else v.b += c.custo_centavos || 0;
    custoMes.set(m, v);
  }
  const pagMes = new Map();                         // mês → efeito no saldo (B paga A = reduz)
  for (const p of pagamentos) {
    const m = p.data.slice(0, 8) + "01";
    const efeito = p.de_pagador_id === idB ? -p.valor_centavos : p.valor_centavos;
    pagMes.set(m, (pagMes.get(m) || 0) + efeito);
  }
  const meses = [...custoMes.keys(), ...pagMes.keys()].filter((m) => m <= mesAtual).sort();
  if (!meses.length) return { linhas: [], saldo: 0, totalDif: 0, totalJuros: 0, totalPagoBA: 0, totalPagoAB: 0, difMesAtual: 0 };

  const linhas = [];
  let saldo = 0, totalDif = 0, totalJuros = 0, difMesAtual = 0;
  for (let m = meses[0]; m <= mesAtual; m = mudarMes(m, 1)) {
    const fechado = m < mesAtual;
    const inicial = saldo;
    const pag = pagMes.get(m) || 0;
    saldo += pag;
    const juros = fechado ? Math.round(saldo * (taxa / 100)) : 0;
    saldo += juros;
    const c = custoMes.get(m) || { a: 0, b: 0 };
    const dif = Math.round((c.a - c.b) / 2);
    saldo += dif;
    totalDif += dif; totalJuros += juros;
    if (!fechado) difMesAtual = dif;
    linhas.push({ mes: m, fechado, inicial, custoA: c.a, custoB: c.b, diferenca: dif, pagamentos: pag, juros, saldo });
  }
  const totalPagoBA = pagamentos.filter((p) => p.de_pagador_id === idB).reduce((s, p) => s + p.valor_centavos, 0);
  const totalPagoAB = pagamentos.filter((p) => p.de_pagador_id === idA).reduce((s, p) => s + p.valor_centavos, 0);
  return { linhas, saldo, totalDif, totalJuros, totalPagoBA, totalPagoAB, difMesAtual };
}

let estado;

export async function render(el, ctx) {
  estado = { el, ctx };
  await carregar();
}

async function carregar() {
  const { el } = estado;
  const [pag, cfg, soc, pgs] = await Promise.all([
    sb.from("pagadores").select("*").order("ordem").order("nome"),
    sb.from("configuracoes").select("*").single(),
    sb.from("vw_resumo_pagador").select("mes, pagador_id, pagador, custo_centavos"),
    sb.from("acerto_pagamentos").select("*").order("data").order("id"),
  ]);
  for (const r of [pag, cfg, soc, pgs]) if (r.error) { el.innerHTML = `<p class="aviso aviso-erro">${esc(mensagemErro(r.error))}</p>`; return; }

  const socios = pag.data.filter((p) => p.ativo).slice(0, 2);
  if (socios.length < 2) {
    el.innerHTML = `<p class="aviso aviso-info">O acerto precisa de dois sócios ativos em Configurações → Sócios pagadores.</p>`;
    return;
  }
  const [A, B] = socios;
  const taxa = Number(cfg.data.acerto_juros_percentual || 0);
  const mesAtual = hojeISO().slice(0, 8) + "01";
  const r = calcularAcerto({ custos: soc.data, idA: A.id, idB: B.id, pagamentos: pgs.data, taxa, mesAtual });
  // Combinado de pagamento e saldo previsto para o início dos pagamentos
  const inicio = cfg.data.acerto_inicio_pagamentos ? String(cfg.data.acerto_inicio_pagamentos).slice(0, 8) + "01" : null;
  const combinado = cfg.data.acerto_combinado || "";
  const previsto = inicio && inicio > mesAtual
    ? calcularAcerto({ custos: soc.data, idA: A.id, idB: B.id, pagamentos: pgs.data, taxa, mesAtual: inicio }).saldo : null;
  Object.assign(estado, { A, B, taxa, pagamentos: pgs.data, socios, r, inicio, combinado, previsto });
  const podeAlterar = estado.ctx.eAdmin;

  const devedor = r.saldo >= 0 ? B : A, credor = r.saldo >= 0 ? A : B;
  const pct = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 3 });

  el.innerHTML = `
    <div class="barra">
      ${podeAlterar ? `<form class="taxa-juros" id="a-taxa">
        <label for="a-taxa-v">Juros compostos</label>
        <input class="entrada num" id="a-taxa-v" inputmode="decimal" value="${pct(taxa)}">
        <span>% ao mês</span>
        <button class="botao botao-secundario botao-acao" type="submit">Salvar taxa</button>
      </form>
      <div class="empurra" style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="botao botao-secundario" type="button" id="a-pdf">${ICONES.pdf}Gerar PDF</button>
        <button class="botao botao-principal" type="button" id="a-novo">${ICONES.mais}Registrar pagamento entre sócios</button>
      </div>`
      : `<div class="taxa-juros"><label>Juros compostos</label><strong class="num">${pct(taxa)}%</strong><span>ao mês</span></div>
         <span class="sec">Somente consulta. Alterações são feitas pelos administradores.</span>
         <button class="botao botao-secundario empurra" type="button" id="a-pdf">${ICONES.pdf}Gerar PDF</button>`}
    </div>

    <div class="totais">
      <div class="total destaque-acerto"><span>${r.saldo ? `${esc(devedor.nome)} deve a ${esc(credor.nome)}` : "Sócios em dia"}</span>
        <strong>${fmt.dinheiro(Math.abs(r.saldo))}</strong>
        <small>${r.difMesAtual ? `Inclui ${fmt.dinheiro(Math.abs(r.difMesAtual))} de ${esc(nomeMes(mesAtual).toLowerCase())}, mês ainda aberto` : "Saldo de hoje, com juros"}</small></div>
      <div class="total"><span>Diferença dos meses</span><strong>${fmt.dinheiro(Math.abs(r.totalDif))}</strong><small>Metade da diferença de custo, sem juros</small></div>
      <div class="total"><span>Juros acumulados</span><strong>${fmt.dinheiro(Math.abs(r.totalJuros))}</strong><small>${pct(taxa)}% ao mês, compostos</small></div>
      <div class="total"><span>Já pago por ${esc(B.nome)}</span><strong>${fmt.dinheiro(r.totalPagoBA)}</strong>
        <small>${r.totalPagoAB ? `${esc(A.nome)} pagou ${fmt.dinheiro(r.totalPagoAB)}` : plural(estado.pagamentos.length, "pagamento registrado", "pagamentos registrados")}</small></div>
    </div>

    <section class="painel combinado">
      <div class="painel-cabeca"><h2 class="titulo">Como será o pagamento</h2>
        ${podeAlterar ? `<button class="botao botao-texto botao-acao" type="button" id="a-combinado" style="margin-left:auto">Editar combinado</button>` : ""}</div>
      <div class="painel-corpo">
        <p style="margin:0 0 14px">${esc(combinado || "Ainda não há combinado registrado.")}</p>
        <div class="combinado-dados">
          <div><span>Início previsto dos pagamentos</span><strong>${inicio ? esc(nomeMes(inicio)) : "—"}</strong></div>
          ${previsto != null ? `<div><span>Saldo previsto em ${esc(nomeMes(inicio).toLowerCase())}</span><strong>${fmt.dinheiro(Math.abs(previsto))}</strong>
            <small>Com os juros até lá, considerando só os custos já registrados</small></div>` : ""}
          <div><span>Forma de pagamento</span><strong>Valores livres</strong><small>Cada pagamento abate o saldo no mês em que é feito</small></div>
        </div>
      </div>
    </section>

    <section class="painel" style="margin-top:16px">
      <div class="painel-cabeca"><h2 class="titulo">Extrato mês a mês</h2>
        <span class="resumo">Saldo positivo: ${esc(B.nome)} deve a ${esc(A.nome)}.</span></div>
      ${r.linhas.length ? `<div class="tabela-rolagem"><table class="tabela tabela-acerto">
        <thead><tr><th>Mês</th><th class="direita">Custo ${esc(A.nome)}</th><th class="direita">Custo ${esc(B.nome)}</th>
          <th class="direita">Diferença ÷ 2</th><th class="direita">Pagamentos</th><th class="direita">Juros do mês</th><th class="direita">Saldo ao fim do mês</th></tr></thead>
        <tbody>${r.linhas.map((l) => `
          <tr class="${l.fechado ? "" : "mes-aberto"}">
            <td class="sem-quebra"><strong>${esc(nomeMes(l.mes))}</strong>${l.fechado ? "" : '<div class="sec">em andamento</div>'}</td>
            <td class="valor" style="font-weight:500">${fmt.dinheiro(l.custoA)}</td>
            <td class="valor" style="font-weight:500">${fmt.dinheiro(l.custoB)}</td>
            <td class="valor">${l.diferenca ? fmt.sinal(l.diferenca) : '<span class="sec">—</span>'}</td>
            <td class="valor">${l.pagamentos ? `<span class="txt-verde">${fmt.sinal(l.pagamentos)}</span>` : '<span class="sec">—</span>'}</td>
            <td class="valor">${l.juros ? fmt.sinal(l.juros) : '<span class="sec">—</span>'}</td>
            <td class="valor"><strong>${fmt.dinheiro(l.saldo)}</strong></td>
          </tr>`).join("")}</tbody></table></div>`
        : `<div class="vazio-tabela">Ainda não há custos lançados.</div>`}
      <div class="legenda" style="display:block">
        <strong>Como é calculado:</strong> em cada mês, a diferença é (custo de ${esc(A.nome)} − custo de ${esc(B.nome)}) ÷ 2,
        com custo = pagamentos efetivados + material reaproveitado. Depois que o mês fecha, o saldo passa a render
        <strong>${pct(taxa)}% ao mês de juros compostos</strong>, até o mês anterior ao pagamento. Os pagamentos abatem o saldo no mês em que são feitos.
        Mudar a taxa recalcula todo o extrato.
      </div>
    </section>

    <section class="painel" style="margin-top:16px">
      <div class="painel-cabeca"><h2 class="titulo">Pagamentos entre os sócios</h2></div>
      ${pgs.data.length ? `<div class="tabela-rolagem"><table class="tabela">
        <thead><tr><th>Data</th><th>De → Para</th><th class="direita">Valor</th><th>Observação</th><th><span class="sr">Ações</span></th></tr></thead>
        <tbody>${[...pgs.data].reverse().map((p) => `
          <tr><td class="data">${fmt.data(p.data)}</td>
            <td class="sem-quebra">${esc(nomeDe(p.de_pagador_id))} → ${esc(nomeDe(p.para_pagador_id))}</td>
            <td class="valor txt-verde">${fmt.dinheiro(p.valor_centavos)}</td>
            <td class="sec">${esc(p.observacoes || "")}</td>
            <td><div class="tabela-acoes">${podeAlterar ? `<button class="botao botao-texto botao-acao" data-editar="${p.id}">Editar</button>` : ""}</div></td></tr>`).join("")}
        </tbody></table></div>`
        : `<div class="vazio-tabela">Nenhum pagamento entre os sócios registrado ainda.</div>`}
    </section>`;

  el.querySelector("#a-pdf").onclick = async (e) => {
    const b = e.currentTarget;
    b.classList.add("carregando");
    try {
      const res = await gerarPDFAcerto({ r: estado.r, A: estado.A, B: estado.B, taxa: estado.taxa, pagamentos: estado.pagamentos, perfil: estado.ctx.perfil,
        inicio: estado.inicio, combinado: estado.combinado, previsto: estado.previsto });
      toast(`PDF gerado: ${res.nomeArquivo}`, "ok");
    } catch (err) { toast(mensagemErro(err), "erro"); }
    finally { b.classList.remove("carregando"); }
  };
  if (!podeAlterar) return;
  el.querySelector("#a-combinado").onclick = janelaCombinado;
  el.querySelector("#a-novo").onclick = () => janelaPagamento();
  el.querySelectorAll("[data-editar]").forEach((b) => b.onclick = () => janelaPagamento(pgs.data.find((p) => p.id === Number(b.dataset.editar))));
  el.querySelector("#a-taxa").onsubmit = async (e) => {
    e.preventDefault();
    const v = Number(String(el.querySelector("#a-taxa-v").value).replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(v) || v < 0 || v > 20) return toast("Informe uma taxa entre 0 e 20% ao mês.", "erro");
    if (v === taxa) return toast("A taxa já é essa.");
    const ok = await confirmar({ titulo: "Mudar a taxa de juros",
      texto: `De ${pct(taxa)}% para ${pct(v)}% ao mês. Todo o extrato é recalculado com a nova taxa, desde o primeiro mês. A mudança fica no histórico.`,
      botao: "Mudar taxa" });
    if (!ok) return;
    const { error } = await sb.from("configuracoes").update({ acerto_juros_percentual: v }).eq("id", 1);
    if (error) return toast(mensagemErro(error), "erro");
    toast("Taxa de juros atualizada.", "ok");
    await carregar();
  };
}

function janelaCombinado() {
  abrirJanela({
    titulo: "Combinado de pagamento",
    corpo: `
      <div class="campo"><label for="c-inicio">Início previsto dos pagamentos</label>
        <input class="entrada" id="c-inicio" type="month" value="${esc((estado.inicio || "").slice(0, 7))}"></div>
      <div class="campo"><label for="c-texto">Como vai funcionar (aparece no PDF)</label>
        <textarea class="entrada" id="c-texto" rows="6" maxlength="1200">${esc(estado.combinado)}</textarea></div>`,
    acoes: [
      { texto: "Cancelar" },
      { texto: "Salvar combinado", classe: "botao-principal", aoClicar: async (j) => {
        const mes = j.elemento.querySelector("#c-inicio").value;
        const texto = j.elemento.querySelector("#c-texto").value.trim();
        const { error } = await sb.from("configuracoes").update({
          acerto_inicio_pagamentos: mes ? `${mes}-01` : null, acerto_combinado: texto || null }).eq("id", 1);
        if (error) { toast(mensagemErro(error), "erro"); return false; }
        toast("Combinado salvo.", "ok");
        await carregar();
      } },
    ],
  });
}

const nomeDe = (id) => estado.socios.find((s) => s.id === id)?.nome || `#${id}`;

function janelaPagamento(p = null) {
  const { A, B } = estado;
  const de = p?.de_pagador_id ?? B.id;
  abrirJanela({
    titulo: p ? "Editar pagamento entre sócios" : "Registrar pagamento entre sócios",
    corpo: `
      <p class="sec" style="margin-top:-4px">Só anota o que já aconteceu: o sistema não faz pagamentos.</p>
      <div class="grade">
        <div class="campo"><label for="p-data">Data do pagamento</label>
          <input class="entrada" id="p-data" type="date" value="${esc(p?.data || hojeISO())}"></div>
        <div class="campo"><label for="p-valor">Valor (R$)</label>
          <input class="entrada num" id="p-valor" inputmode="decimal" placeholder="0,00" value="${p ? dinheiroCampo(p.valor_centavos) : ""}"></div>
        <div class="campo inteira"><span class="rotulo">Quem pagou a quem</span>
          <div class="segmentos" role="radiogroup">
            <label><input type="radio" name="dir" value="${B.id}" ${de === B.id ? "checked" : ""}><span>${esc(B.nome)} → ${esc(A.nome)}</span></label>
            <label><input type="radio" name="dir" value="${A.id}" ${de === A.id ? "checked" : ""}><span>${esc(A.nome)} → ${esc(B.nome)}</span></label>
          </div></div>
        <div class="campo inteira"><label for="p-obs">Observação (opcional)</label>
          <input class="entrada" id="p-obs" maxlength="200" placeholder="Ex.: PIX, 1ª parcela do acerto" value="${esc(p?.observacoes || "")}"></div>
      </div>`,
    aoAbrir: (j) => j.elemento.querySelector("#p-valor").addEventListener("blur", (e) => {
      const c = lerDinheiro(e.target.value); if (c != null) e.target.value = dinheiroCampo(c);
    }),
    acoes: [
      ...(p ? [{ texto: "Excluir", classe: "botao-texto", aoClicar: async () => {
        const ok = await confirmar({ titulo: "Excluir pagamento", texto: `Excluir o pagamento de ${fmt.dinheiro(p.valor_centavos)} de ${fmt.data(p.data)}? O extrato é recalculado e a exclusão fica no histórico.`, botao: "Excluir", perigo: true });
        if (!ok) return false;
        const { error } = await sb.from("acerto_pagamentos").delete().eq("id", p.id);
        if (error) { toast(mensagemErro(error), "erro"); return false; }
        toast("Pagamento excluído.", "ok");
        await carregar();
      } }] : []),
      { texto: "Cancelar" },
      { texto: p ? "Salvar alterações" : "Registrar pagamento", classe: "botao-principal", aoClicar: async (j) => {
        const el = j.elemento;
        const data = el.querySelector("#p-data").value;
        const valor = lerDinheiro(el.querySelector("#p-valor").value);
        const deId = Number(el.querySelector('input[name="dir"]:checked').value);
        const erro = (t) => { toast(t, "erro"); return false; };
        if (!data) return erro("Informe a data.");
        if (data > hojeISO()) return erro("Não é possível registrar um pagamento com data futura.");
        if (!valor || valor <= 0) return erro("Informe o valor, maior que zero.");
        const dados = { data, valor_centavos: valor, de_pagador_id: deId, para_pagador_id: deId === A.id ? B.id : A.id,
          observacoes: el.querySelector("#p-obs").value.trim() || null };
        const { error } = p
          ? await sb.from("acerto_pagamentos").update(dados).eq("id", p.id)
          : await sb.from("acerto_pagamentos").insert(dados);
        if (error) return erro(mensagemErro(error));
        toast(p ? "Pagamento atualizado." : "Pagamento registrado.", "ok");
        await carregar();
      } },
    ],
  });
}
