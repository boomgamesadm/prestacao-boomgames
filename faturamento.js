import {
  sb, esc, fmt, ICONES, seletorMes, mesAtual, nomeMes, abrirJanela, confirmar, toast, mensagemErro,
  lerDinheiro, dinheiroCampo, hojeISO, plural,
} from "./comum.js";
import { gerarPDFFaturamento } from "./pdf-faturamento.js";

export const FORMAS_FAT = [
  ["dinheiro", "Dinheiro"], ["pix", "PIX"], ["debito", "Cartão de débito"], ["credito", "Cartão de crédito"], ["outros", "Outros"],
];
const CORES = { dinheiro: "#16764A", pix: "#1F7A8C", debito: "#5C5F66", credito: "#000000", outros: "#C9A227" };
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export const diaSemana = (iso) => DIAS[new Date(iso + "T12:00:00").getDay()];

let estado;

export async function render(el, ctx) {
  estado = { el, ctx, mes: mesAtual(), linhas: [] };
  el.innerHTML = `
    <div class="barra">
      <div id="f-mes"></div>
      <span class="sec">Valores brutos recebidos, por dia.</span>
      <div class="empurra" style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="botao botao-secundario" type="button" id="f-pdf">${ICONES.pdf}Gerar PDF do mês</button>
        <button class="botao botao-principal" type="button" id="f-novo">${ICONES.mais}Lançar dia</button>
      </div>
    </div>
    <div id="f-corpo"></div>`;
  el.querySelector("#f-novo").onclick = () => abrirDia();
  el.querySelector("#f-pdf").onclick = gerarPDF;
  await carregar();
}

async function carregar() {
  const { el, mes } = estado;
  el.querySelector("#f-mes").replaceChildren(seletorMes(mes, (n) => { estado.mes = n; carregar(); }));
  const corpo = el.querySelector("#f-corpo");
  const { data, error } = await sb.from("faturamento_diario").select("*").eq("mes_referencia", mes).order("data");
  if (error) { corpo.innerHTML = `<p class="aviso aviso-erro">${esc(mensagemErro(error))}</p>`; return; }
  estado.linhas = data;

  const total = data.reduce((s, d) => s + d.total_centavos, 0);
  const porForma = FORMAS_FAT.map(([k, n]) => [k, n, data.reduce((s, d) => s + (d[`${k}_centavos`] || 0), 0)]);
  const dias = data.filter((d) => d.total_centavos > 0);
  const maior = dias.reduce((m, d) => (!m || d.total_centavos > m.total_centavos ? d : m), null);

  if (!data.length) {
    corpo.innerHTML = `<section class="painel"><div class="vazio-tabela"><strong>Nenhum dia lançado em ${esc(nomeMes(mes).toLowerCase())}.</strong>
      Use “Lançar dia” para registrar o que a loja recebeu em cada forma de pagamento.</div></section>`;
    return;
  }

  // Gráfico: um traço por dia do mês
  const [a, m] = mes.split("-").map(Number);
  const nDias = new Date(a, m, 0).getDate();
  const porDia = new Map(data.map((d) => [Number(d.data.slice(8, 10)), d]));
  const max = Math.max(1, ...data.map((d) => d.total_centavos));

  corpo.innerHTML = `
    <div class="totais">
      <div class="total"><span>Faturamento do mês</span><strong class="txt-verde">${fmt.dinheiro(total)}</strong><small>Valor bruto</small></div>
      <div class="total"><span>Dias com movimento</span><strong>${dias.length}</strong><small>de ${nDias} dias no mês</small></div>
      <div class="total"><span>Média por dia</span><strong>${fmt.dinheiro(dias.length ? Math.round(total / dias.length) : 0)}</strong><small>Dias com movimento</small></div>
      <div class="total"><span>Maior dia</span><strong>${maior ? fmt.dinheiro(maior.total_centavos) : "—"}</strong>
        <small>${maior ? `${fmt.data(maior.data).slice(0, 5)}, ${diaSemana(maior.data)}` : ""}</small></div>
    </div>

    <div class="painel-grade">
      <section class="painel largo">
        <div class="painel-cabeca"><h2 class="titulo">Faturamento por dia</h2></div>
        <div class="grafico-dias" role="img" aria-label="Faturamento de cada dia do mês">
          ${Array.from({ length: nDias }, (_, i) => {
            const d = porDia.get(i + 1);
            const v = d?.total_centavos || 0;
            return `<div class="dia-col" title="${String(i + 1).padStart(2, "0")}/${String(m).padStart(2, "0")}: ${fmt.dinheiro(v)}">
              <div class="barra-dia"><i style="height:${(v / max) * 100}%"></i></div>
              <span>${(i + 1) % 5 === 0 || i === 0 ? i + 1 : ""}</span></div>`;
          }).join("")}
        </div>
      </section>
      <section class="painel">
        <div class="painel-cabeca"><h2 class="titulo">Por forma de recebimento</h2></div>
        <div class="painel-corpo"><div class="barras-h">
          ${porForma.filter((f) => f[2] > 0).map(([k, n, v]) => `
            <div class="barra-h"><span class="rot">${n}</span>
              <span class="trilho"><i style="width:${Math.max(2, (v / total) * 100)}%;background:${CORES[k]}"></i></span>
              <span class="val num">${fmt.dinheiro(v)} <span class="sec" style="font-weight:400">${Math.round((v / total) * 100)}%</span></span></div>`).join("")}
        </div></div>
      </section>
      <section class="painel">
        <div class="painel-cabeca"><h2 class="titulo">Para que serve</h2></div>
        <div class="painel-corpo"><p class="sec" style="margin:0">Registro diário do faturamento bruto da loja, com PDF para apresentar à fiscalização.
          Na prestação de contas com os sócios, o faturamento do mês continua sendo lançado em <strong>Lançamentos</strong>, tipo Faturamento da loja.
          Só administradores e editores veem esta página.</p></div>
      </section>
    </div>

    <section class="painel" style="margin-top:16px">
      <div class="painel-cabeca"><h2 class="titulo">Movimento diário</h2><span class="resumo">${plural(data.length, "dia lançado", "dias lançados")}</span></div>
      <div class="tabela-rolagem"><table class="tabela tabela-fat">
        <thead><tr><th>Data</th>${["Dinheiro", "PIX", "Débito", "Crédito", "Outros"].map((n) => `<th class="direita">${n}</th>`).join("")}
          <th class="direita">Total do dia</th><th><span class="sr">Editar</span></th></tr></thead>
        <tbody>${data.map((d) => `
          <tr class="clicavel" data-id="${d.id}" tabindex="0">
            <td class="sem-quebra"><strong>${fmt.data(d.data).slice(0, 5)}</strong> <span class="sec">${diaSemana(d.data)}</span>
              ${d.observacoes || d.outros_descricao ? `<div class="sec">${esc([d.outros_descricao, d.observacoes].filter(Boolean).join(". "))}</div>` : ""}</td>
            ${FORMAS_FAT.map(([k]) => `<td class="valor" style="font-weight:500">${d[`${k}_centavos`] ? fmt.dinheiro(d[`${k}_centavos`]) : '<span class="sec">—</span>'}</td>`).join("")}
            <td class="valor txt-verde">${fmt.dinheiro(d.total_centavos)}</td>
            <td><div class="tabela-acoes"><button class="botao botao-texto botao-acao" data-editar="${d.id}">Editar</button></div></td>
          </tr>`).join("")}</tbody>
        <tfoot><tr><td><strong>Total do mês</strong></td>
          ${porForma.map(([, , v]) => `<td class="valor">${fmt.dinheiro(v)}</td>`).join("")}
          <td class="valor txt-verde">${fmt.dinheiro(total)}</td><td></td></tr></tfoot>
      </table></div>
    </section>`;

  corpo.querySelectorAll("tr[data-id]").forEach((tr) => {
    const abrir = () => abrirDia(data.find((d) => d.id === Number(tr.dataset.id)));
    tr.onclick = abrir;
    tr.onkeydown = (e) => { if (e.key === "Enter") abrir(); };
  });
}

function abrirDia(dia = null) {
  const novo = !dia;
  const dataInicial = dia?.data || (estado.mes === hojeISO().slice(0, 8) + "01" ? hojeISO() : estado.mes);
  abrirJanela({
    titulo: novo ? "Lançar faturamento do dia" : `Faturamento de ${fmt.data(dia.data)}`,
    corpo: `
      <div class="grade">
        <div class="campo"><label class="obrigatorio" for="d-data">Data</label>
          <input class="entrada" id="d-data" type="date" value="${esc(dataInicial)}"></div>
        <div class="campo"><span class="rotulo">Total do dia</span><div class="total-dia num" id="d-total">R$ 0,00</div></div>
        ${FORMAS_FAT.map(([k, n]) => `
          <div class="campo"><label for="d-${k}">${n} (R$)</label>
            <input class="entrada num" id="d-${k}" inputmode="decimal" placeholder="0,00" value="${dia?.[`${k}_centavos`] ? dinheiroCampo(dia[`${k}_centavos`]) : ""}"></div>`).join("")}
        <div class="campo" id="d-outros-desc-campo"><label for="d-outros-desc">O que é “Outros”?</label>
          <input class="entrada" id="d-outros-desc" maxlength="120" placeholder="Ex.: vale-refeição, transferência" value="${esc(dia?.outros_descricao || "")}"></div>
        <div class="campo inteira"><label for="d-obs">Observação (opcional)</label>
          <input class="entrada" id="d-obs" maxlength="300" placeholder="Ex.: feriado, evento, máquina parada" value="${esc(dia?.observacoes || "")}"></div>
      </div>
      <p class="aviso aviso-info oculto" id="d-existe" style="margin-top:14px"></p>`,
    aoAbrir: (j) => {
      const el = j.elemento;
      el.querySelector(".janela").classList.add("larga");
      const atualizar = () => {
        const t = FORMAS_FAT.reduce((s, [k]) => s + (lerDinheiro(el.querySelector(`#d-${k}`).value) || 0), 0);
        el.querySelector("#d-total").textContent = fmt.dinheiro(t);
        el.querySelector("#d-outros-desc-campo").classList.toggle("oculto", !(lerDinheiro(el.querySelector("#d-outros").value) > 0));
        const d = el.querySelector("#d-data").value;
        const outro = estado.linhas.find((x) => x.data === d && x.id !== dia?.id);
        const aviso = el.querySelector("#d-existe");
        aviso.classList.toggle("oculto", !outro);
        if (outro) aviso.textContent = `O dia ${fmt.data(d)} já foi lançado (${fmt.dinheiro(outro.total_centavos)}). Feche e clique na linha do dia para editar.`;
      };
      el.addEventListener("input", atualizar);
      el.querySelectorAll('[id^="d-"][inputmode="decimal"]').forEach((i) => i.addEventListener("blur", () => {
        const c = lerDinheiro(i.value); if (c != null) i.value = dinheiroCampo(c);
      }));
      atualizar();
      setTimeout(() => el.querySelector(novo ? "#d-dinheiro" : "#d-dinheiro")?.focus(), 30);
    },
    acoes: [
      ...(novo ? [] : [{ texto: "Excluir dia", classe: "botao-texto", aoClicar: async (j) => {
        const ok = await confirmar({ titulo: "Excluir dia", texto: `Excluir o faturamento de ${fmt.data(dia.data)} (${fmt.dinheiro(dia.total_centavos)})? A exclusão fica registrada no histórico.`, botao: "Excluir", perigo: true });
        if (!ok) return false;
        const { error } = await sb.from("faturamento_diario").delete().eq("id", dia.id);
        if (error) { toast(mensagemErro(error), "erro"); return false; }
        toast("Dia excluído.", "ok");
        await carregar();
      } }]),
      { texto: "Cancelar" },
      { texto: novo ? "Salvar dia" : "Salvar alterações", classe: "botao-principal", aoClicar: async (j) => {
        const el = j.elemento;
        const erro = (t) => { const a = el.querySelector("#d-existe"); a.textContent = t; a.className = "aviso aviso-erro"; return false; };
        const data = el.querySelector("#d-data").value;
        if (!data) return erro("Informe a data.");
        if (data > hojeISO()) return erro("Não é possível lançar faturamento de um dia que ainda não aconteceu.");
        if (estado.linhas.some((x) => x.data === data && x.id !== dia?.id)) return erro(`O dia ${fmt.data(data)} já foi lançado. Abra a linha do dia para editar.`);
        const valores = {};
        for (const [k, n] of FORMAS_FAT) {
          const v = lerDinheiro(el.querySelector(`#d-${k}`).value);
          if (v != null && v < 0) return erro(`Valor inválido em ${n}.`);
          valores[`${k}_centavos`] = v || 0;
        }
        const total = Object.values(valores).reduce((s, v) => s + v, 0);
        if (!total) return erro("Informe o valor recebido em pelo menos uma forma de pagamento.");
        const dados = { data, ...valores,
          outros_descricao: valores.outros_centavos ? (el.querySelector("#d-outros-desc").value.trim() || null) : null,
          observacoes: el.querySelector("#d-obs").value.trim() || null };
        const { error } = novo
          ? await sb.from("faturamento_diario").insert(dados)
          : await sb.from("faturamento_diario").update(dados).eq("id", dia.id);
        if (error) return erro(mensagemErro(error));
        toast(novo ? `Dia ${fmt.data(data)} lançado: ${fmt.dinheiro(total)}.` : "Alterações salvas.", "ok");
        if (data.slice(0, 7) !== estado.mes.slice(0, 7)) estado.mes = data.slice(0, 8) + "01";
        await carregar();
      } },
    ],
  });
}

async function gerarPDF() {
  const b = estado.el.querySelector("#f-pdf");
  if (!estado.linhas.length) return toast(`Não há dias lançados em ${nomeMes(estado.mes).toLowerCase()}.`, "erro");
  b.classList.add("carregando");
  try {
    const r = await gerarPDFFaturamento({ mes: estado.mes, linhas: estado.linhas, perfil: estado.ctx.perfil });
    toast(`PDF gerado: ${r.nomeArquivo}`, "ok");
  } catch (e) {
    toast(mensagemErro(e), "erro");
  } finally {
    b.classList.remove("carregando");
  }
}
