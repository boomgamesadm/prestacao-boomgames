import { sb, esc, fmt, seletorMes, mesAtual, nomeMes, TIPOS_DOC, abrirDocumento, toast, mensagemErro, plural } from "./comum.js";
import { abrirDetalhes } from "./lancamento-janelas.js";

let estado;

export async function render(el, ctx) {
  estado = { el, ctx, mes: mesAtual() };
  el.innerHTML = `<div class="barra"><div id="d-mes"></div>
    <span class="sec">Para anexar, abra o lançamento em Lançamentos ou Contas a pagar.</span></div>
    <section class="painel" id="d-lista"></section>`;
  await carregar();
}

async function carregar() {
  const { el, ctx, mes } = estado;
  el.querySelector("#d-mes").replaceChildren(seletorMes(mes, (novo) => { estado.mes = novo; carregar(); }));
  const alvo = el.querySelector("#d-lista");
  const { data: lancs, error } = await sb.from("vw_lancamentos").select("id, descricao, data_movimentacao, valor_centavos, criado_por_nome")
    .eq("mes_referencia", mes);
  if (error) { alvo.innerHTML = `<p class="aviso aviso-erro" style="margin:16px">${esc(mensagemErro(error))}</p>`; return; }
  const porId = new Map(lancs.map((l) => [l.id, l]));
  let docs = [];
  if (lancs.length) {
    const r = await sb.from("documentos").select("*").in("lancamento_id", lancs.map((l) => l.id)).order("enviado_em");
    if (r.error) { alvo.innerHTML = `<p class="aviso aviso-erro" style="margin:16px">${esc(mensagemErro(r.error))}</p>`; return; }
    docs = r.data.filter((d) => !d.removido_em);
  }
  const semDoc = lancs.length - new Set(docs.map((d) => d.lancamento_id)).size;
  alvo.innerHTML = `
    <div class="painel-cabeca"><h2 class="titulo">${esc(nomeMes(mes))}</h2>
      <span class="resumo">${plural(docs.length, "documento")}${lancs.length ? `, ${plural(semDoc, "lançamento")} sem documento` : ""}</span></div>
    ${docs.length ? `<div class="tabela-rolagem"><table class="tabela">
      <thead><tr><th>Arquivo</th><th>Tipo</th><th>Lançamento</th><th>Enviado em</th><th><span class="sr">Ações</span></th></tr></thead>
      <tbody>${docs.map((d) => {
        const l = porId.get(d.lancamento_id) || {};
        return `<tr>
          <td><strong>${esc(d.nome_original)}</strong><div class="sec">${(d.tamanho_bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB</div></td>
          <td>${esc(TIPOS_DOC[d.tipo] || d.tipo)}</td>
          <td><button class="botao botao-texto botao-acao" data-lanc="${d.lancamento_id}">${esc(fmt.data(l.data_movimentacao))}, ${esc(l.descricao || "")}</button></td>
          <td class="sec num sem-quebra">${fmt.dataHora(d.enviado_em)}</td>
          <td><div class="tabela-acoes"><button class="botao botao-secundario botao-acao" data-abrir="${esc(d.caminho)}">Abrir</button></div></td>
        </tr>`; }).join("")}</tbody></table></div>`
      : `<div class="vazio-tabela"><strong>Nenhum documento em ${esc(nomeMes(mes))}.</strong>Notas e comprovantes anexados aos lançamentos aparecem aqui.</div>`}`;
  alvo.querySelectorAll("[data-abrir]").forEach((b) => b.onclick = async () => {
    try { await abrirDocumento(b.dataset.abrir); } catch (e) { toast(mensagemErro(e), "erro"); }
  });
  alvo.querySelectorAll("[data-lanc]").forEach((b) => b.onclick = () =>
    abrirDetalhes({ ctx, id: Number(b.dataset.lanc), aoMudar: carregar }));
}
