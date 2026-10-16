import { sb, esc, fmt, seletorMes, mesAtual, nomeMes, toast, mensagemErro } from "./comum.js";
import { gerarPDF, FILTROS } from "./pdf-prestacao.js";

let estado;

export async function render(el, ctx) {
  estado = { el, ctx, mes: mesAtual(), filtro: "completo" };
  el.innerHTML = `
    <div class="barra"><div id="r-mes"></div></div>
    <div class="painel-grade">
      <section class="painel">
        <div class="painel-cabeca"><h2 class="titulo">Prestação de contas do mês</h2></div>
        <div class="painel-corpo">
          <p style="margin:0 0 12px">O PDF traz <strong>todos os lançamentos do mês</strong>, em ordem de data:</p>
          <ul class="lista-simples">
            <li>Resumo: total pago, a pagar, material reaproveitado e conferidos</li>
            <li>Quanto cada sócio pagou</li>
            <li>Cada lançamento com fornecedor, CNPJ ou CPF, nota fiscal, quem pagou, forma e se foi conferido</li>
            <li>Os cancelados aparecem à parte, com o motivo, fora dos totais</li>
          </ul>
          <button class="botao botao-principal" type="button" id="r-gerar" style="margin-top:18px;width:100%">Gerar PDF da prestação mensal</button>
          <p class="ajuda" style="margin-top:10px">O arquivo é baixado direto, com o nome <span id="r-nome" class="num"></span>.</p>
        </div>
      </section>
      <section class="painel">
        <div class="painel-cabeca"><h2 class="titulo">Já emitidos neste mês</h2></div>
        <div id="r-hist"></div>
      </section>
    </div>`;
  el.querySelector("#r-gerar").onclick = gerar;
  await carregar();
}

function nomeArquivo() {
  estado.el.querySelector("#r-nome").textContent = `BoomGames_PrestacaoContas_${estado.mes.slice(0, 7)}${FILTROS[estado.filtro].sufixo}.pdf`;
}

async function carregar() {
  const { el, mes } = estado;
  el.querySelector("#r-mes").replaceChildren(seletorMes(mes, (n) => { estado.mes = n; carregar(); }));
  nomeArquivo();
  const [h, p] = await Promise.all([
    sb.from("relatorios_emitidos").select("*").eq("mes", mes).order("emitido_em", { ascending: false }),
    sb.from("perfis").select("id, nome"),
  ]);
  const alvo = el.querySelector("#r-hist");
  if (h.error) { alvo.innerHTML = `<p class="aviso aviso-erro" style="margin:16px">${esc(mensagemErro(h.error))}</p>`; return; }
  const nomes = new Map((p.data || []).map((x) => [x.id, x.nome]));
  alvo.innerHTML = h.data.length ? `<table class="tabela"><tbody>${h.data.map((r) => `
    <tr><td><strong class="num">${esc(r.codigo)}</strong><div class="sec">${r.filtrado ? esc(r.filtros?.nome || "Filtrado") : `Versão ${r.versao}`}</div></td>
      <td class="sec">${esc(nomes.get(r.emitido_por) || "—")}<div class="num">${fmt.dataHora(r.emitido_em)}</div></td>
      <td class="valor">${fmt.dinheiro(r.totais?.pagamentos_efetivados_centavos)}<div class="sec" style="font-weight:400">total pago</div></td></tr>`).join("")}
    </tbody></table>
    <p class="sec" style="padding:12px 16px;margin:0;border-top:1px solid var(--linha)">Cada emissão ganha um código e uma versão. Se um lançamento mudar depois, gere de novo: o PDF novo terá a versão seguinte.</p>`
    : `<div class="vazio-tabela">Nenhum PDF emitido para ${esc(nomeMes(mes).toLowerCase())} ainda.</div>`;
}

async function gerar() {
  const b = estado.el.querySelector("#r-gerar");
  b.classList.add("carregando");
  try {
    const r = await gerarPDF({ mes: estado.mes, filtro: estado.filtro, perfil: estado.ctx.perfil });
    toast(`PDF ${r.codigo} gerado.`, "ok");
    await carregar();
  } catch (e) {
    toast(mensagemErro(e), "erro");
  } finally {
    b.classList.remove("carregando");
  }
}
