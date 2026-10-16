// Janelas usadas por Lançamentos e Contas a pagar
import {
  sb, esc, fmt, abrirJanela, confirmar, toast, mensagemErro, cadastros, hojeISO, somarDias,
  lerDinheiro, dinheiroCampo, SITUACAO, CONFERENCIA, TIPO, selo, TIPOS_DOC, anexarDocumento, abrirDocumento,
} from "./comum.js";

const TIPOS_DOCUMENTO_LANC = ["Nota fiscal", "NFS-e", "Cupom fiscal", "Recibo", "Comprovante", "Boleto", "Outro"];
const BOLETO = /boleto/i;
const CARTAO_CREDITO = /cr[eé]dito/i;

function erroNaJanela(el, texto) {
  let a = el.querySelector(".janela-corpo > .aviso-erro");
  if (!a) {
    a = document.createElement("p");
    a.className = "aviso aviso-erro";
    a.setAttribute("role", "alert");
    el.querySelector(".janela-corpo").prepend(a);
  }
  a.textContent = texto;
  a.scrollIntoView({ block: "nearest" });
}
const opcoes = (lista, sel, vazio) =>
  (vazio ? `<option value="">${esc(vazio)}</option>` : "") +
  lista.map((o) => `<option value="${o.id}" ${String(o.id) === String(sel) ? "selected" : ""}>${esc(o.nome)}</option>`).join("");

// =====================================================================
// FORMULÁRIO (novo ou edição)
// =====================================================================
export async function abrirFormulario({ ctx, lanc = null, base = null, aoSalvar, foco = null }) {
  const cad = await cadastros();
  const novo = !lanc;
  const ultimoSocio = localStorage.getItem("bg_ultimo_socio");
  const v = lanc || {
    tipo: "pagamento",
    data_movimentacao: hojeISO(),
    pagador_id: ultimoSocio && cad.pagadores.some((p) => String(p.id) === ultimoSocio && p.ativo) ? ultimoSocio : "",
    status_pagamento: "liquidado",
    ...(base || {}),
  };
  // Boleto em aberto: o campo "Data" mostra a data da compra; o mês é o do vencimento
  const formaAtual = cad.formas.find((f) => String(f.id) === String(v.forma_pagamento_id));
  const dataCampo = lanc && lanc.data_competencia && !lanc.pago_automatico && formaAtual && BOLETO.test(formaAtual.nome)
    && ["pendente", "agendado", "parcial"].includes(lanc.status_pagamento) ? lanc.data_competencia : v.data_movimentacao;
  const situacaoInicial = v.status_pagamento === "parcial" ? "parcial"
    : ["pendente", "agendado"].includes(v.status_pagamento) ? "aberto" : "pago";
  const socios = cad.pagadores.filter((p) => p.ativo || String(p.id) === String(v.pagador_id));
  const formas = cad.formas.filter((f) => f.ativa || String(f.id) === String(v.forma_pagamento_id));

  const corpo = `
    <div class="campo">
      <span class="rotulo">Tipo</span>
      <div class="segmentos" role="radiogroup">
        ${["pagamento", "coleta_obra", "recebimento"].map((t) => `
          <label><input type="radio" name="tipo" value="${t}" ${v.tipo === t ? "checked" : ""}><span>${TIPO[t]}</span></label>`).join("")}
      </div>
    </div>
    <div class="caixa-nota" data-mostrar="coleta" style="margin-top:14px">
      <strong>Coleta de obra:</strong> material reaproveitado de outra obra, que já tinha sido pago.
      O valor é só referência: aparece em “Material reaproveitado” e não soma no total pago do mês.
    </div>

    <div class="grade" style="margin-top:18px">
      <div class="campo"><label class="obrigatorio" for="f-data">Data</label>
        <input class="entrada" id="f-data" type="date" value="${esc(dataCampo || "")}">
        <p class="ajuda" data-texto-data></p></div>
      <div class="campo"><label class="obrigatorio" for="f-valor" data-rotulo-valor>Valor (R$)</label>
        <input class="entrada num" id="f-valor" inputmode="decimal" placeholder="0,00" value="${dinheiroCampo(v.valor_centavos)}"></div>

      <div class="campo inteira"><label class="obrigatorio" for="f-desc">Descrição</label>
        <input class="entrada" id="f-desc" maxlength="300" placeholder="Ex.: 10 sacos de cimento" value="${esc(v.descricao || "")}"></div>

      <div class="campo"><label class="obrigatorio" for="f-cat">Categoria</label>
        <select class="entrada" id="f-cat"></select></div>
      <div class="campo"><label class="obrigatorio" for="f-socio">Sócio que pagou</label>
        <select class="entrada" id="f-socio">${opcoes(socios, v.pagador_id, "Escolha quem pagou")}</select>
        <p class="ajuda">Quem tirou o dinheiro para este lançamento.</p></div>

      <div class="campo"><label for="f-contra">Fornecedor ou prestador</label>
        <input class="entrada" id="f-contra" maxlength="120" value="${esc(v.contraparte || "")}"></div>
      <div class="campo"><label for="f-ctipo">O fornecedor é</label>
        <select class="entrada" id="f-ctipo">
          <option value="">Não informado</option>
          <option value="cnpj" ${v.contraparte_tipo === "cnpj" ? "selected" : ""}>Empresa (CNPJ)</option>
          <option value="cpf" ${v.contraparte_tipo === "cpf" ? "selected" : ""}>Pessoa física (CPF)</option>
        </select>
        <p class="ajuda">Aparece no PDF para a contabilidade.</p></div>

      <div class="campo" data-mostrar="forma"><label class="obrigatorio" for="f-forma">Forma de pagamento</label>
        <select class="entrada" id="f-forma">${opcoes(formas, v.forma_pagamento_id, "Escolha")}</select></div>
      <div class="campo" data-mostrar="vezes"><label for="f-vezes">Em quantas vezes</label>
        <select class="entrada" id="f-vezes">${Array.from({ length: 24 }, (_, i) =>
          `<option value="${i + 1}" ${(v.vezes || 1) === i + 1 ? "selected" : ""}>${i === 0 ? "À vista (1x)" : `${i + 1}x`}</option>`).join("")}</select>
        <p class="ajuda" data-ajuda-vezes></p></div>
      <div class="campo" data-mostrar="vezes-grupo"><span class="rotulo">Em quantas vezes</span>
        <p class="ajuda" style="font-size:14px">${v.parcela_total ? `Parcela ${v.parcela_numero} de ${v.parcela_total}. Cada parcela é editada separadamente.` : ""}</p></div>

      <div class="campo inteira" data-mostrar="situacao">
        <span class="rotulo">Situação</span>
        <div class="segmentos" role="radiogroup">
          <label><input type="radio" name="sit" value="pago" ${situacaoInicial === "pago" ? "checked" : ""}><span data-txt-pago>Já foi pago</span></label>
          <label><input type="radio" name="sit" value="aberto" ${situacaoInicial === "aberto" ? "checked" : ""}><span data-txt-aberto>A pagar</span></label>
          ${situacaoInicial === "parcial" ? `<label><input type="radio" name="sit" value="parcial" checked><span>Pago em parte</span></label>` : ""}
        </div>
      </div>
      <div class="campo" data-mostrar="vencimento"><label class="obrigatorio" for="f-venc" data-rotulo-venc>Vencimento</label>
        <input class="entrada" id="f-venc" type="date" value="${esc(v.data_vencimento || "")}"></div>

      <div class="inteira" data-mostrar="lista-parcelas">
        <div class="caixa-nota">
          <span data-resumo-parcelas></span>
          Cada parcela vira uma linha própria, no mês do seu vencimento, com a cor do prazo.
          <div class="parcelas-lista" data-lista-parcelas></div>
        </div>
      </div>
      <div class="inteira" data-mostrar="cartao-info">
        <div class="caixa-nota" data-cartao-info></div>
      </div>
    </div>

    <h3 class="secao-titulo">Nota fiscal ou documento</h3>
    <div class="grade">
      <div class="campo"><label for="f-tdoc">Tipo de documento</label>
        <select class="entrada" id="f-tdoc"><option value="">Sem documento</option>
          ${TIPOS_DOCUMENTO_LANC.map((t) => `<option ${v.tipo_documento === t ? "selected" : ""}>${t}</option>`).join("")}
          ${v.tipo_documento && !TIPOS_DOCUMENTO_LANC.includes(v.tipo_documento) ? `<option selected>${esc(v.tipo_documento)}</option>` : ""}
        </select></div>
      <div class="campo"><label for="f-ndoc">Número do documento</label>
        <input class="entrada" id="f-ndoc" maxlength="60" placeholder="Ex.: 93706" value="${esc(v.numero_documento || "")}"></div>
      <div class="campo inteira">
        <label class="marcar"><input type="checkbox" id="f-npend" ${v.nota_pendente ? "checked" : ""}>
          A nota fiscal ainda não chegou. Vou informar depois.</label>
        <p class="ajuda">Não é obrigatório na hora. O lançamento fica na aba “Nota a receber” até a nota ser informada.</p>
      </div>
    </div>

    <details class="mais-detalhes" ${v.observacoes || v.data_emissao ? "open" : ""}>
      <summary>Mais detalhes: datas da nota, pagamento e observações</summary>
      <div class="grade">
        <div class="campo"><label for="f-emissao">Data de emissão da nota</label>
          <input class="entrada" id="f-emissao" type="date" value="${esc(v.data_emissao || "")}"></div>
        <div class="campo"><label for="f-chegou">Data em que a nota chegou</label>
          <input class="entrada" id="f-chegou" type="date" value="${esc(v.data_recebimento_doc || "")}">
          <p class="ajuda">Não muda a data da despesa.</p></div>
        <div class="campo" data-mostrar="pago-detalhe"><label for="f-dpag" data-rotulo-dpag>Data do pagamento</label>
          <input class="entrada" id="f-dpag" type="date" value="${esc(v.data_liquidacao || "")}">
          <p class="ajuda">Em branco = mesma data acima.</p></div>
        <div class="campo" data-mostrar="pago-detalhe"><label for="f-vpago">Valor efetivamente pago (R$)</label>
          <input class="entrada num" id="f-vpago" inputmode="decimal" placeholder="Igual ao valor"
            value="${v.valor_pago_centavos != null && v.valor_pago_centavos !== v.valor_centavos ? dinheiroCampo(v.valor_pago_centavos) : ""}">
          <p class="ajuda">Use quando houve juros, multa ou desconto.</p></div>
        <div class="campo inteira"><label for="f-obs">Observações</label>
          <textarea class="entrada" id="f-obs" rows="3" maxlength="1000">${esc(v.observacoes || "")}</textarea></div>
      </div>
    </details>`;

  const acoes = [{ texto: "Cancelar" }];
  if (novo) acoes.push({ texto: "Salvar e lançar outro", classe: "botao-secundario", aoClicar: (j) => salvar(j, true) });
  acoes.push({ texto: novo ? "Salvar lançamento" : "Salvar alterações", classe: "botao-principal", aoClicar: (j) => salvar(j, false) });

  const janela = abrirJanela({
    titulo: novo ? "Novo lançamento" : `Editar lançamento #${lanc.id}`,
    corpo, acoes,
    aoAbrir: (j) => {
      j.elemento.querySelector(".janela").classList.add("larga");
      const el = j.elemento;
      el.addEventListener("change", () => atualizar(el));
      el.addEventListener("input", (e) => { if (["f-valor", "f-venc", "f-data"].includes(e.target.id)) atualizar(el);
        if (e.target.id === "f-ndoc" && e.target.value.trim()) el.querySelector("#f-npend").checked = false; });
      for (const id of ["f-valor", "f-vpago"]) {
        el.querySelector("#" + id).addEventListener("blur", (e) => {
          const c = lerDinheiro(e.target.value);
          if (c != null) e.target.value = dinheiroCampo(c);
        });
      }
      atualizar(el, true);
      setTimeout(() => el.querySelector(foco || (novo ? "#f-desc" : "#f-valor"))?.focus(), 30);
    },
  });

  // Mostra/esconde campos conforme o tipo, a situação e a forma de pagamento
  function atualizar(el, inicio = false) {
    const tipo = el.querySelector('input[name="tipo"]:checked').value;
    const sit = el.querySelector('input[name="sit"]:checked')?.value || "pago";
    const forma = cad.formas.find((f) => String(f.id) === el.querySelector("#f-forma").value);
    const eBoleto = forma && BOLETO.test(forma.nome);
    const eCartao = forma && CARTAO_CREDITO.test(forma.nome);
    const coleta = tipo === "coleta_obra", receb = tipo === "recebimento";
    const emGrupo = !novo && !!lanc.grupo_parcelas;
    const vezes = Number(el.querySelector("#f-vezes").value);
    const cartaoNovo = novo && tipo === "pagamento" && eCartao;
    const cartaoAuto = !novo && !!lanc.pago_automatico;

    const mostrar = {
      coleta,
      forma: !coleta,
      vezes: !coleta && !emGrupo && !cartaoAuto && (eBoleto || eCartao),
      "vezes-grupo": emGrupo,
      situacao: !coleta && !cartaoNovo && !cartaoAuto,
      vencimento: !coleta && !cartaoNovo && !cartaoAuto && sit === "aberto",
      "lista-parcelas": novo && !coleta && !eCartao && sit === "aberto" && eBoleto && vezes > 1,
      "pago-detalhe": !coleta && !cartaoNovo && !cartaoAuto && sit === "pago",
      "cartao-info": cartaoNovo || cartaoAuto,
    };
    if (cartaoNovo || cartaoAuto) desenharCartao(el, cartaoNovo, vezes);
    el.querySelector("[data-ajuda-vezes]").textContent =
      eBoleto && sit === "aberto" && novo ? "Cada parcela do boleto vira uma linha, com o seu vencimento."
      : eBoleto ? "Fica registrado no lançamento."
      : "Cada parcela entra na fatura do seu mês.";
    el.querySelector("[data-rotulo-venc]").textContent = mostrar["lista-parcelas"] ? "Vencimento da 1ª parcela" : "Vencimento";
    for (const [k, vis] of Object.entries(mostrar)) {
      el.querySelectorAll(`[data-mostrar="${k}"]`).forEach((n) => n.classList.toggle("oculto", !vis));
    }
    el.querySelector("[data-txt-pago]").textContent = receb ? "Já foi recebido" : "Já foi pago";
    el.querySelector("[data-txt-aberto]").textContent = receb ? "A receber" : "A pagar";
    el.querySelector("[data-rotulo-dpag]").textContent = receb ? "Data do recebimento" : "Data do pagamento";
    el.querySelector("[data-rotulo-valor]").textContent = mostrar["lista-parcelas"] ? "Valor total (R$)" : "Valor (R$)";
    el.querySelector("[data-texto-data]").textContent =
      mostrar["lista-parcelas"] ? "Data da compra. Cada parcela entra no mês do vencimento."
      : mostrar["cartao-info"] && novo ? "Data da compra. O custo entra no mês de cada fatura."
      : mostrar["cartao-info"] ? "Data da fatura desta parcela."
      : eBoleto && !coleta && sit === "aberto" ? "Data da compra. O custo entra no mês do vencimento."
      : "Define em qual mês o lançamento aparece.";

    // Categorias do tipo escolhido (coleta usa as de pagamento)
    const catSel = el.querySelector("#f-cat");
    const atual = inicio ? String(v.categoria_id ?? "") : catSel.value;
    const tipoCat = receb ? "recebimento" : "pagamento";
    const cats = cad.categorias.filter((c) => (c.aplica_a || []).includes(tipoCat) && (c.ativa || String(c.id) === atual));
    catSel.innerHTML = opcoes(cats, atual, "Escolha");

    if (mostrar["lista-parcelas"]) desenharParcelas(el, vezes);
  }

  function desenharCartao(el, eNovo, n) {
    const alvo = el.querySelector("[data-cartao-info]");
    if (!eNovo) {
      alvo.innerHTML = `<strong>Parcela no cartão de crédito.</strong>
        Compra em ${esc(fmt.data(lanc.data_competencia))}. Entra na fatura de ${esc(fmt.data(lanc.data_vencimento))} e conta como paga nesse dia.`;
      return;
    }
    const dia = cad.config.dia_fatura_cartao || 10;
    const compra = el.querySelector("#f-data").value;
    const total = lerDinheiro(el.querySelector("#f-valor").value);
    if (!compra) { alvo.innerHTML = "<strong>Cartão de crédito:</strong> informe a data da compra para ver as faturas."; return; }
    const [a, m] = compra.split("-").map(Number);
    const faturas = Array.from({ length: n }, (_, k) => {
      const t = a * 12 + (m - 1) + k + 1;
      return `${String(dia).padStart(2, "0")}/${String((t % 12) + 1).padStart(2, "0")}/${Math.floor(t / 12)}`;
    });
    const parc = total ? Math.floor(total / n) : 0, resto = total ? total - parc * n : 0;
    alvo.innerHTML = `<strong>Cartão de crédito:</strong> o lançamento guarda a data da compra, mas o custo entra no mês de cada fatura (dia ${dia})
      e conta como pago nesse dia.
      <div class="parcelas-lista">${faturas.map((f, k) => `<span><strong>${n > 1 ? `${k + 1}ª` : "Fatura"}</strong> ${f}${total ? `<br>${esc(fmt.dinheiro(parc + (k === 0 ? resto : 0)))}` : ""}</span>`).join("")}</div>`;
  }

  function desenharParcelas(el, n) {
    const lista = el.querySelector("[data-lista-parcelas]");
    const primeiro = el.querySelector("#f-venc").value;
    const atuais = [...lista.querySelectorAll("input")].map((i) => i.value);
    lista.innerHTML = Array.from({ length: n }, (_, k) => {
      const sugestao = primeiro ? somarDias(primeiro, 30 * k) : "";
      const valor = k === 0 ? primeiro : (atuais[k] && atuais.length === n ? atuais[k] : sugestao);
      return `<label>${k + 1}ª parcela<input class="entrada" type="date" value="${valor}" ${k === 0 ? "disabled title=\"Igual ao campo Vencimento\"" : ""}></label>`;
    }).join("");
    const total = lerDinheiro(el.querySelector("#f-valor").value);
    el.querySelector("[data-resumo-parcelas]").innerHTML = total
      ? `<strong>${n} parcelas de ${esc(fmt.dinheiro(Math.floor(total / n)))}</strong>${total % n ? ` (a 1ª com ${esc(fmt.dinheiro(Math.floor(total / n) + (total % n)))})` : ""}. `
      : "";
  }

  async function salvar(j, outro) {
    const el = j.elemento;
    const q = (id) => el.querySelector("#" + id);
    const tipo = el.querySelector('input[name="tipo"]:checked').value;
    const sit = tipo === "coleta_obra" ? "pago" : el.querySelector('input[name="sit"]:checked').value;
    const coleta = tipo === "coleta_obra", receb = tipo === "recebimento";
    const valor = lerDinheiro(q("f-valor").value);
    const vpago = lerDinheiro(q("f-vpago").value);
    const forma = cad.formas.find((f) => String(f.id) === q("f-forma").value);
    const vezesVisivel = !q("f-vezes").closest("[data-mostrar]").classList.contains("oculto");
    const cartaoNovo = novo && !el.querySelector('[data-mostrar="cartao-info"]').classList.contains("oculto");
    const cartaoAuto = !novo && !!lanc.pago_automatico;
    const vezes = vezesVisivel ? Number(q("f-vezes").value) : null;
    const nParc = !el.querySelector('[data-mostrar="lista-parcelas"]').classList.contains("oculto") ? vezes : 1;

    // Validação com mensagens claras
    if (!q("f-data").value) return erroNaJanela(el, "Informe a data."), false;
    if (!valor || valor <= 0) return erroNaJanela(el, "Informe o valor, maior que zero."), false;
    if (!q("f-desc").value.trim()) return erroNaJanela(el, "Preencha a descrição."), false;
    if (!q("f-cat").value) return erroNaJanela(el, "Escolha a categoria."), false;
    if (!q("f-socio").value) return erroNaJanela(el, "Escolha o sócio que pagou."), false;
    if (!coleta && !q("f-forma").value) return erroNaJanela(el, "Escolha a forma de pagamento."), false;
    if (sit === "aberto" && !cartaoNovo && !cartaoAuto && !q("f-venc").value) return erroNaJanela(el, "Informe a data de vencimento."), false;

    const observacoes = q("f-obs").value.trim() || null;

    const dados = {
      tipo,
      data_movimentacao: q("f-data").value,
      valor_centavos: valor,
      descricao: q("f-desc").value.trim(),
      categoria_id: Number(q("f-cat").value),
      pagador_id: Number(q("f-socio").value),
      contraparte: q("f-contra").value.trim() || null,
      contraparte_tipo: q("f-ctipo").value || null,
      nota_pendente: q("f-npend").checked,
      forma_pagamento_id: coleta ? null : Number(q("f-forma").value),
      tipo_documento: q("f-tdoc").value || null,
      numero_documento: q("f-ndoc").value.trim() || null,
      data_emissao: q("f-emissao").value || null,
      data_recebimento_doc: q("f-chegou").value || null,
      observacoes,
    };
    if (vezesVisivel) dados.vezes = vezes;
    else if (!lanc?.grupo_parcelas) dados.vezes = null;
    if (cartaoAuto) {
      dados.data_vencimento = dados.data_movimentacao;   // a fatura acompanha a data editada
    } else if (cartaoNovo) {
      // Cartão novo: situação e datas das faturas são calculadas pelo banco
    } else if (sit === "pago") {
      Object.assign(dados, {
        status_pagamento: "liquidado",
        data_liquidacao: q("f-dpag").value || q("f-data").value,
        valor_pago_centavos: vpago ?? valor,
        data_vencimento: coleta ? null : (q("f-venc").value || null),
      });
    } else if (sit === "aberto") {
      Object.assign(dados, { status_pagamento: "pendente", data_vencimento: q("f-venc").value });
      if (forma && BOLETO.test(forma.nome)) {
        // Boleto: guarda a data da compra e lança no mês do vencimento
        dados.data_competencia = dados.data_movimentacao;
        dados.data_movimentacao = q("f-venc").value;
      }
    } // "parcial": mantém os dados de pagamento como estão

    try {
      // Edição: confirma mudanças de valor, data ou vencimento
      if (!novo) {
        const mudou = [];
        if (dados.valor_centavos !== lanc.valor_centavos) mudou.push(`Valor: ${fmt.dinheiro(lanc.valor_centavos)} → ${fmt.dinheiro(dados.valor_centavos)}`);
        if (dados.data_movimentacao !== lanc.data_movimentacao) mudou.push(`Data: ${fmt.data(lanc.data_movimentacao)} → ${fmt.data(dados.data_movimentacao)}`);
        if ("data_vencimento" in dados && (dados.data_vencimento || null) !== (lanc.data_vencimento || null)) {
          mudou.push(`Vencimento: ${fmt.data(lanc.data_vencimento)} → ${fmt.data(dados.data_vencimento)}`);
        }
        if (mudou.length) {
          const ok = await confirmar({
            titulo: "Confirmar alteração",
            texto: `${mudou.join(". ")}. A mudança fica registrada no histórico.`,
            botao: "Confirmar e salvar",
          });
          if (!ok) return false;
        }
        const { error } = await sb.from("lancamentos").update(dados).eq("id", lanc.id);
        if (error) throw error;
        toast("Alterações salvas.", "ok");
      } else {
        // Novo: avisa se parece repetido
        const repetido = await procurarRepetido(dados, valor);
        if (repetido) {
          const ok = await confirmar({
            titulo: "Parece repetido",
            texto: `Já existe: #${repetido.id}, ${fmt.data(repetido.data_movimentacao)}, ${repetido.descricao}, ${fmt.dinheiro(repetido.valor_centavos)}. Salvar mesmo assim?`,
            botao: "Salvar mesmo assim",
          });
          if (!ok) return false;
        }
        if (cartaoNovo) {
          const { error } = await sb.rpc("fn_registrar_compra_cartao", {
            p_descricao: dados.descricao, p_categoria_id: dados.categoria_id, p_pagador_id: dados.pagador_id,
            p_contraparte: dados.contraparte, p_contraparte_tipo: dados.contraparte_tipo, p_data_compra: dados.data_movimentacao,
            p_tipo_documento: dados.tipo_documento, p_numero_documento: dados.numero_documento, p_nota_pendente: dados.nota_pendente,
            p_valor_total_centavos: valor, p_vezes: vezes || 1, p_forma_pagamento_id: dados.forma_pagamento_id, p_observacoes: dados.observacoes,
          });
          if (error) throw error;
          toast(vezes > 1 ? `Compra lançada em ${vezes} parcelas, nas faturas dos próximos meses.` : "Compra lançada na fatura do próximo mês.", "ok");
        } else if (nParc > 1) {
          const datas = [q("f-venc").value, ...[...el.querySelectorAll("[data-lista-parcelas] input")].slice(1).map((i) => i.value)];
          if (datas.some((d) => !d)) return erroNaJanela(el, "Preencha o vencimento de todas as parcelas."), false;
          const { error } = await sb.rpc("fn_registrar_boleto_parcelado", {
            p_descricao: dados.descricao, p_categoria_id: dados.categoria_id, p_pagador_id: dados.pagador_id,
            p_contraparte: dados.contraparte, p_data_compra: dados.data_movimentacao,
            p_data_emissao: dados.data_emissao || dados.data_movimentacao, p_tipo_documento: dados.tipo_documento,
            p_numero_documento: dados.numero_documento, p_valor_total_centavos: valor,
            p_vencimentos: datas, p_observacoes: dados.observacoes,
            p_contraparte_tipo: dados.contraparte_tipo, p_nota_pendente: dados.nota_pendente,
          });
          if (error) throw error;
          toast(`${nParc} parcelas lançadas.`, "ok");
        } else {
          const { error } = await sb.from("lancamentos").insert(dados);
          if (error) throw error;
          toast("Lançamento salvo.", "ok");
        }
        if (dados.pagador_id) localStorage.setItem("bg_ultimo_socio", String(dados.pagador_id));
      }
      j.fechar();
      await aoSalvar?.();
      if (outro) {
        abrirFormulario({ ctx, aoSalvar, base: {
          tipo: dados.tipo, data_movimentacao: dados.data_movimentacao, pagador_id: dados.pagador_id,
          categoria_id: dados.categoria_id, forma_pagamento_id: dados.forma_pagamento_id,
          status_pagamento: dados.status_pagamento || "liquidado",
        } });
      }
      return false;
    } catch (e) {
      erroNaJanela(el, mensagemErro(e));
      return false;
    }
  }
  return janela;
}

async function procurarRepetido(dados, valor) {
  const { data: mesmoValor } = await sb.from("lancamentos").select("id, data_movimentacao, descricao, valor_centavos, status_pagamento")
    .eq("valor_centavos", valor).eq("data_movimentacao", dados.data_movimentacao).neq("status_pagamento", "cancelado").limit(1);
  if (mesmoValor?.length) return mesmoValor[0];
  if (dados.numero_documento) {
    const { data: mesmoDoc } = await sb.from("lancamentos").select("id, data_movimentacao, descricao, valor_centavos, status_pagamento")
      .eq("numero_documento", dados.numero_documento).neq("status_pagamento", "cancelado").limit(1);
    if (mesmoDoc?.length) return mesmoDoc[0];
  }
  return null;
}

// =====================================================================
// DETALHES
// =====================================================================
export async function abrirDetalhes({ ctx, id, aoMudar }) {
  const { data: l, error } = await sb.from("vw_lancamentos").select("*").eq("id", id).single();
  if (error) return toast(mensagemErro(error), "erro");
  let idsDocs = [l.id];
  if (l.grupo_parcelas) {
    const { data: grupo } = await sb.from("lancamentos").select("id").eq("grupo_parcelas", l.grupo_parcelas);
    idsDocs = (grupo || []).map((g) => g.id);
  }
  const { data: docs } = await sb.from("documentos").select("*").in("lancamento_id", idsDocs).order("enviado_em");
  const docsAtivos = (docs || []).filter((d) => !d.removido_em);

  const cancelado = l.status_pagamento === "cancelado";
  const aberto = ["pendente", "agendado", "parcial"].includes(l.status_pagamento);
  const podeConferir = ctx.eAdmin || (ctx.perfil.perfil === "editor" && ctx.perfil.pode_conferir);
  const podeCancelar = ctx.eAdmin || (ctx.perfil.perfil === "editor" && ctx.perfil.pode_cancelar);
  const pagoDif = l.diferenca_centavos;
  const item = (rot, val, inteira = false) =>
    val == null || val === "" ? "" : `<div class="${inteira ? "inteira" : ""}"><dt>${esc(rot)}</dt><dd>${val}</dd></div>`;

  const corpo = `
    <div class="cabeca-detalhe">
      <span class="valor-grande">${esc(fmt.dinheiro(l.valor_centavos))}</span>
      ${selo(SITUACAO[l.situacao] || [l.situacao, "neutro"])}
      ${l.tipo !== "coleta_obra" ? selo(CONFERENCIA[l.status_conferencia]) : ""}
      ${l.parcela_rotulo ? `<span class="etiqueta">${esc(l.parcela_rotulo)}</span>` : ""}
    </div>
    <p style="margin:0 0 6px;font-size:17px;font-weight:600;color:var(--texto)">${esc(l.descricao)}</p>
    ${l.cor_vencimento ? `<p class="aviso ${l.cor_vencimento === "vermelho" ? "aviso-erro" : "aviso-info"}">${esc(textoPrazo(l.dias_para_vencer, true))}</p>` : ""}
    ${l.pago_automatico && l.situacao === "no_cartao" ? `<p class="aviso aviso-info">Compra no cartão de crédito: entra na fatura de ${esc(fmt.data(l.data_vencimento))} e conta como paga nesse dia.</p>` : ""}
    ${l.nota_pendente && !cancelado ? `<p class="aviso aviso-info">A nota fiscal ainda não chegou.${ctx.podeEditar ? " Use “Informar nota fiscal” quando ela chegar." : ""}</p>` : ""}
    ${cancelado ? `<p class="aviso aviso-erro">Cancelado em ${esc(fmt.dataHora(l.cancelado_em))}. Motivo: ${esc(l.motivo_cancelamento)}</p>` : ""}
    ${l.status_conferencia === "divergente" ? `<p class="aviso aviso-erro">Divergência: ${esc(l.motivo_divergencia)}</p>` : ""}
    <dl class="detalhes">
      ${item("Tipo", esc(TIPO[l.tipo]))}
      ${item(l.pago_automatico ? "Fatura" : "Data", esc(fmt.data(l.data_movimentacao)))}
      ${item("Data da compra", l.data_competencia && l.data_competencia !== l.data_movimentacao ? esc(fmt.data(l.data_competencia)) : null)}
      ${item("Categoria", esc(l.categoria_nome))}
      ${item("Fornecedor ou prestador", esc(l.contraparte))}
      ${item("O fornecedor é", l.contraparte_tipo ? (l.contraparte_tipo === "cpf" ? "Pessoa física (CPF)" : "Empresa (CNPJ)") : null)}
      ${item("Sócio que pagou", esc(l.pagador_nome))}
      ${item("Forma de pagamento", l.forma_pagamento_nome ? esc(l.forma_pagamento_nome) + (l.vezes > 1 && !l.grupo_parcelas ? ` em ${l.vezes}x` : "") : null)}
      ${item("Vencimento", l.data_vencimento ? esc(fmt.data(l.data_vencimento)) : null)}
      ${item(l.tipo === "recebimento" ? "Recebido em" : "Pago em", l.data_pagamento_efetiva && l.tipo !== "coleta_obra" ? esc(fmt.data(l.data_pagamento_efetiva)) : null)}
      ${item("Valor efetivamente pago", l.valor_pago_centavos != null && l.valor_pago_centavos !== l.valor_centavos && l.tipo !== "coleta_obra"
        ? esc(fmt.dinheiro(l.valor_pago_centavos)) + (pagoDif ? ` <span class="sec">(${pagoDif > 0 ? "juros/multa de " : "desconto de "}${esc(fmt.dinheiro(Math.abs(pagoDif)))})</span>` : "")
        : null)}
      ${item("Ainda falta pagar", l.status_pagamento === "parcial" ? esc(fmt.dinheiro(l.saldo_pendente_centavos)) : null)}
      ${item("Documento", [l.tipo_documento, l.numero_documento].filter(Boolean).map(esc).join(" nº ") || null)}
      ${item("Emissão da nota", l.data_emissao ? esc(fmt.data(l.data_emissao)) : null)}
      ${item("Nota chegou em", l.data_recebimento_doc ? esc(fmt.data(l.data_recebimento_doc)) : null)}
      ${item("Observações", esc(l.observacoes), true)}
      ${item("Lançado por", `${esc(l.criado_por_nome || "—")} <span class="sec">em ${esc(fmt.dataHora(l.criado_em))}</span>`)}
      ${item("Última alteração", l.atualizado_em && l.atualizado_em !== l.criado_em
        ? `${esc(l.atualizado_por_nome || "—")} <span class="sec">em ${esc(fmt.dataHora(l.atualizado_em))}</span>` : null)}
      ${item("Nº do lançamento", `#${l.id}`)}
    </dl>

    <h3 class="secao-titulo">Documentos${l.grupo_parcelas ? " (valem para todas as parcelas)" : ""}</h3>
    ${docsAtivos.length ? `<ul class="lista-docs">${docsAtivos.map((d) => `
      <li><span class="nome" title="${esc(d.nome_original)}">${esc(d.nome_original)}</span>
        <span class="sec">${esc(TIPOS_DOC[d.tipo] || d.tipo)}</span>
        <button type="button" class="botao botao-texto botao-acao" data-abrir="${esc(d.caminho)}">Abrir</button></li>`).join("")}</ul>`
      : `<p class="sec" style="margin:0">Nenhum documento anexado.</p>`}
    ${ctx.podeEditar && !cancelado ? `
      <div class="anexar">
        <select class="entrada" id="d-tipo">${Object.entries(TIPOS_DOC).map(([k, t]) => `<option value="${k}">${t}</option>`).join("")}</select>
        <label class="botao botao-secundario">${"Anexar arquivo"}<input type="file" id="d-arquivo" accept="application/pdf,image/jpeg,image/png" class="sr"></label>
        <span class="sec">PDF, JPG ou PNG, até 15 MB.</span>
      </div>` : ""}

    ${podeConferir && !cancelado && l.tipo !== "coleta_obra" ? `
      <h3 class="secao-titulo">Conferência</h3>
      <p class="sec" style="margin:0 0 10px">Conferido = documento impresso e arquivado na pasta.</p>
      <div class="acoes-detalhe">
        ${l.status_conferencia !== "conferido" ? `<button type="button" class="botao botao-secundario" data-conf="conferido">Marcar como conferido (arquivado na pasta)</button>` : ""}
        ${l.status_conferencia !== "divergente" ? `<button type="button" class="botao botao-secundario" data-conf="divergente">Registrar divergência</button>` : ""}
        ${l.status_conferencia !== "pendente" ? `<button type="button" class="botao botao-texto" data-conf="pendente">Voltar para não conferido</button>` : ""}
      </div>` : ""}`;

  const acoes = [];
  if (ctx.podeEditar && !cancelado) {
    if (podeCancelar) acoes.push({ texto: "Cancelar lançamento", classe: "botao-texto", aoClicar: (j) => { j.fechar(); cancelarLancamento(l, aoMudar); } });
    if (l.nota_pendente || !l.numero_documento) {
      acoes.push({ texto: "Informar nota fiscal", classe: "botao-secundario", aoClicar: async (j) => {
        j.fechar();
        const { data: bruto } = await sb.from("lancamentos").select("*").eq("id", l.id).single();
        abrirFormulario({ ctx, lanc: { ...bruto, tipo_documento: bruto.tipo_documento || "Nota fiscal" }, aoSalvar: aoMudar, foco: "#f-ndoc" });
      } });
    }
    acoes.push({ texto: "Editar", classe: "botao-secundario", aoClicar: async (j) => {
      j.fechar();
      const { data: bruto } = await sb.from("lancamentos").select("*").eq("id", l.id).single();
      abrirFormulario({ ctx, lanc: bruto, aoSalvar: aoMudar });
    } });
    if (aberto && l.tipo !== "coleta_obra" && !l.pago_automatico) {
      acoes.push({ texto: l.tipo === "recebimento" ? "Registrar recebimento" : "Registrar pagamento", classe: "botao-principal",
        aoClicar: (j) => { j.fechar(); registrarPagamento({ lanc: l, aoSalvar: aoMudar }); } });
    }
  }
  if (!acoes.length) acoes.push({ texto: "Fechar", classe: "botao-secundario" });

  const j = abrirJanela({
    titulo: `${TIPO[l.tipo]} de ${fmt.data(l.data_movimentacao)}`,
    corpo, acoes,
    aoAbrir: (jj) => {
      jj.elemento.querySelector(".janela").classList.add("larga");
      if (acoes.length > 1 && podeCancelar && ctx.podeEditar && !cancelado) jj.elemento.querySelector(".janela-rodape").classList.add("separado");
    },
  });
  const el = j.elemento;
  el.querySelectorAll("[data-abrir]").forEach((b) => b.onclick = async () => {
    try { await abrirDocumento(b.dataset.abrir); } catch (e) { toast(mensagemErro(e), "erro"); }
  });
  el.querySelector("#d-arquivo")?.addEventListener("change", async (e) => {
    const arq = e.target.files[0];
    if (!arq) return;
    const rot = e.target.closest("label");
    rot.classList.add("carregando");
    try {
      await anexarDocumento(l.id, arq, el.querySelector("#d-tipo").value);
      toast("Documento anexado.", "ok");
      j.fechar();
      await aoMudar?.();
      abrirDetalhes({ ctx, id, aoMudar });
    } catch (err) {
      toast(mensagemErro(err), "erro");
      rot.classList.remove("carregando");
    }
  });
  el.querySelectorAll("[data-conf]").forEach((b) => b.onclick = async () => {
    const novo = b.dataset.conf;
    let motivo = null;
    if (novo === "divergente") {
      motivo = await pedirTexto("Registrar divergência", "O que não confere? Ex.: valor da nota diferente do comprovante.", "Registrar divergência");
      if (!motivo) return;
    }
    const { error: e2 } = await sb.from("lancamentos").update({ status_conferencia: novo, motivo_divergencia: motivo }).eq("id", l.id);
    if (e2) return toast(mensagemErro(e2), "erro");
    toast(novo === "conferido" ? "Marcado como conferido." : novo === "divergente" ? "Divergência registrada." : "Voltou para não conferido.", "ok");
    j.fechar();
    await aoMudar?.();
    abrirDetalhes({ ctx, id, aoMudar });
  });
}

/** Janela com um campo de texto obrigatório. Resolve o texto ou null. */
function pedirTexto(titulo, ajuda, botao, perigo = false) {
  return new Promise((resolve) => {
    let feito = false;
    const j = abrirJanela({
      titulo,
      corpo: `<div class="campo"><label for="p-txt">${esc(ajuda)}</label><textarea class="entrada" id="p-txt" rows="3" maxlength="500"></textarea></div>`,
      acoes: [
        { texto: "Voltar" },
        { texto: botao, classe: perigo ? "botao-perigo" : "botao-principal", aoClicar: (jj) => {
          const t = jj.elemento.querySelector("#p-txt").value.trim();
          if (!t) { erroNaJanela(jj.elemento, "Preencha o campo para continuar."); return false; }
          feito = true; resolve(t);
        } },
      ],
    });
    new MutationObserver((_, o) => { if (!document.body.contains(j.elemento)) { o.disconnect(); if (!feito) resolve(null); } })
      .observe(document.body, { childList: true });
  });
}

async function cancelarLancamento(l, aoMudar) {
  const motivo = await pedirTexto(
    "Cancelar lançamento",
    `Por que cancelar “${l.descricao}” (${fmt.dinheiro(l.valor_centavos)})? O registro não é apagado: fica como cancelado, fora dos totais, com este motivo.`,
    "Cancelar lançamento", true);
  if (!motivo) return;
  const { error } = await sb.from("lancamentos").update({ status_pagamento: "cancelado", motivo_cancelamento: motivo }).eq("id", l.id);
  if (error) return toast(mensagemErro(error), "erro");
  toast("Lançamento cancelado.", "ok");
  await aoMudar?.();
}

// =====================================================================
// REGISTRAR PAGAMENTO (um clique: data de hoje e valor já preenchidos)
// =====================================================================
export async function registrarPagamento({ lanc, aoSalvar }) {
  const cad = await cadastros();
  const receb = lanc.tipo === "recebimento";
  const jaPago = lanc.status_pagamento === "parcial" ? (lanc.valor_pago_centavos || 0) : 0;
  const falta = lanc.valor_centavos - jaPago;
  const formas = cad.formas.filter((f) => f.ativa || f.id === lanc.forma_pagamento_id);
  abrirJanela({
    titulo: receb ? "Registrar recebimento" : "Registrar pagamento",
    corpo: `
      <p><strong>${esc(lanc.descricao)}</strong>${lanc.parcela_rotulo ? ` <span class="etiqueta">${esc(lanc.parcela_rotulo)}</span>` : ""}<br>
        Valor: ${esc(fmt.dinheiro(lanc.valor_centavos))}${jaPago ? `, já pago ${esc(fmt.dinheiro(jaPago))}` : ""}${lanc.data_vencimento ? `, vencimento ${esc(fmt.data(lanc.data_vencimento))}` : ""}</p>
      <p class="sec" style="margin-top:-6px">Aqui você só anota o que já aconteceu. O sistema não faz pagamentos.</p>
      <div class="grade">
        <div class="campo"><label for="r-data">${receb ? "Recebido em" : "Pago em"}</label>
          <input class="entrada" id="r-data" type="date" value="${hojeISO()}"></div>
        <div class="campo"><label for="r-valor">${receb ? "Valor recebido (R$)" : "Valor pago (R$)"}</label>
          <input class="entrada num" id="r-valor" inputmode="decimal" value="${dinheiroCampo(falta)}">
          <p class="ajuda" id="r-dif"></p></div>
        <div class="campo"><label for="r-forma">Forma de pagamento</label>
          <select class="entrada" id="r-forma">${opcoes(formas, lanc.forma_pagamento_id)}</select></div>
        <div class="campo" style="align-self:end">
          <label class="marcar"><input type="checkbox" id="r-parcial"> Ainda falta ${receb ? "receber" : "pagar"} uma parte</label></div>
        <div class="campo inteira"><label for="r-arq">Comprovante (opcional)</label>
          <input class="entrada" id="r-arq" type="file" accept="application/pdf,image/jpeg,image/png"></div>
      </div>`,
    aoAbrir: (j) => {
      const el = j.elemento;
      const dif = () => {
        const v = lerDinheiro(el.querySelector("#r-valor").value);
        const d = v == null ? 0 : v - falta;
        el.querySelector("#r-dif").textContent = !d || el.querySelector("#r-parcial").checked ? ""
          : d > 0 ? `${fmt.dinheiro(d)} a mais (juros ou multa).` : `${fmt.dinheiro(-d)} a menos (desconto).`;
      };
      el.querySelector("#r-valor").addEventListener("input", dif);
      el.querySelector("#r-parcial").addEventListener("change", dif);
      el.querySelector("#r-valor").addEventListener("blur", (e) => { const c = lerDinheiro(e.target.value); if (c != null) e.target.value = dinheiroCampo(c); });
    },
    acoes: [
      { texto: "Cancelar" },
      { texto: receb ? "Registrar recebimento" : "Registrar pagamento", classe: "botao-principal", aoClicar: async (j) => {
        const el = j.elemento;
        const valor = lerDinheiro(el.querySelector("#r-valor").value);
        const data = el.querySelector("#r-data").value;
        const parcial = el.querySelector("#r-parcial").checked;
        if (!data) return erroNaJanela(el, "Informe a data."), false;
        if (!valor || valor <= 0) return erroNaJanela(el, "Informe o valor, maior que zero."), false;
        const total = jaPago + valor;
        const { error } = await sb.from("lancamentos").update({
          status_pagamento: parcial ? "parcial" : "liquidado",
          data_liquidacao: data,
          valor_pago_centavos: total,
          forma_pagamento_id: Number(el.querySelector("#r-forma").value) || lanc.forma_pagamento_id,
        }).eq("id", lanc.id);
        if (error) return erroNaJanela(el, mensagemErro(error)), false;
        const arq = el.querySelector("#r-arq").files[0];
        if (arq) {
          try { await anexarDocumento(lanc.id, arq, "comprovante"); }
          catch (e) { toast(`Pagamento registrado, mas o comprovante não foi anexado: ${mensagemErro(e)}`, "erro"); }
        }
        toast(receb ? "Recebimento registrado." : "Pagamento registrado.", "ok");
        await aoSalvar?.();
      } },
    ],
  });
}

/** "vence em 5 dias" / "vence hoje" / "venceu há 2 dias" */
export function textoPrazo(dias, completo = false) {
  if (dias == null) return "";
  if (dias === 0) return completo ? "Vence hoje." : "vence hoje";
  if (dias === 1) return completo ? "Vence amanhã." : "vence amanhã";
  if (dias > 1) return completo ? `Vence em ${dias} dias.` : `vence em ${dias} dias`;
  const n = -dias;
  return completo ? `Venceu há ${n} dia${n > 1 ? "s" : ""} e ainda não foi pago.` : `venceu há ${n} dia${n > 1 ? "s" : ""}`;
}
