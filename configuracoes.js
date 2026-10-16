import { sb, esc, ICONES, toast, mensagemErro, cadastros, abrirJanela } from "./comum.js";

let raiz;
const ehReceb = (c) => (c.aplica_a || []).includes("recebimento");
const ordenarCategorias = (lista) => [...lista].sort((a, b) =>
  ehReceb(a) - ehReceb(b) || a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"));

export async function render(el) {
  raiz = el;
  await desenhar();
}

async function desenhar() {
  const cad = await cadastros(true);
  const { data: ativos } = await sb.from("perfis").select("id").eq("ativo", true);
  const cfg = cad.config;
  const lista = (titulo, ajuda, itens, tabela, extra = () => "") => `
    <section class="painel">
      <div class="painel-cabeca"><h2 class="titulo">${titulo}</h2><span class="resumo">${ajuda}</span></div>
      <table class="tabela"><tbody>
        ${itens.map((i) => `<tr class="${(i.ativo ?? i.ativa) ? "" : "inativo"}">
          <td><strong>${esc(i.nome)}</strong>${extra(i)}</td>
          <td><div class="tabela-acoes">
            <button class="botao botao-texto botao-acao" data-renomear="${tabela}:${i.id}">Renomear</button>
            <button class="botao botao-texto botao-acao" data-ativo="${tabela}:${i.id}">${(i.ativo ?? i.ativa) ? "Desativar" : "Reativar"}</button>
          </div></td></tr>`).join("")}
      </tbody></table>
      <form class="linha-add" data-novo="${tabela}">
        <input class="entrada" name="nome" placeholder="Nome" maxlength="60" required>
        ${tabela === "categorias" ? `<select class="entrada" name="aplica"><option value="pagamento">Para pagamentos</option><option value="recebimento">Para recebimentos</option></select>` : ""}
        <button class="botao botao-secundario" type="submit">${ICONES.mais}Adicionar</button>
      </form>
    </section>`;

  raiz.innerHTML = `
    <div class="config-grade">
      <div class="config-coluna">
      ${lista("Sócios pagadores", "Aparecem na lista “Sócio que pagou”.", cad.pagadores, "pagadores")}
      ${lista("Formas de pagamento", "Boleto e cartão de crédito mostram “Em quantas vezes”.", cad.formas, "formas_pagamento")}
      <section class="painel">
        <div class="painel-cabeca"><h2 class="titulo">Vencimentos e acesso</h2></div>
        <form class="painel-corpo" id="c-geral">
          <div class="campo"><label for="c-am">Linha amarela quando faltarem até</label>
            <div class="campo-dias"><input class="entrada num" id="c-am" type="number" min="1" max="60" value="${cfg.dias_amarelo}"> dias</div></div>
          <div class="campo"><label for="c-vm">Linha vermelha quando faltarem até</label>
            <div class="campo-dias"><input class="entrada num" id="c-vm" type="number" min="0" max="30" value="${cfg.dias_vermelho}"> dias</div>
            <p class="ajuda">Contas vencidas e ainda não pagas também ficam vermelhas.</p></div>
          <div class="campo"><label for="c-max">Máximo de contas ativas</label>
            <div class="campo-dias"><input class="entrada num" id="c-max" type="number" min="${Math.max(1, ativos?.length || 1)}" max="5" value="${cfg.max_usuarios}"> de 5</div>
            <p class="ajuda">Hoje: ${ativos?.length === 1 ? "1 conta ativa" : `${ativos?.length ?? 0} contas ativas`}.</p></div>
          <button class="botao botao-principal" type="submit" style="margin-top:18px">Salvar</button>
        </form>
      </section>
      </div>
      <div class="config-coluna">
      ${lista("Categorias", "Desativar esconde da lista, sem mudar lançamentos antigos.", ordenarCategorias(cad.categorias), "categorias",
        (c) => `<div class="sec">${(c.aplica_a || []).includes("recebimento") ? "Recebimentos" : "Pagamentos e coleta de obra"}</div>`)}
      </div>
    </div>`;

  const achar = (chave) => {
    const [tabela, id] = chave.split(":");
    const fonte = { pagadores: cad.pagadores, categorias: cad.categorias, formas_pagamento: cad.formas }[tabela];
    return { tabela, item: fonte.find((x) => String(x.id) === id) };
  };
  raiz.querySelectorAll("[data-ativo]").forEach((b) => b.onclick = async () => {
    const { tabela, item } = achar(b.dataset.ativo);
    const campo = "ativo" in item ? "ativo" : "ativa";
    const { error } = await sb.from(tabela).update({ [campo]: !item[campo] }).eq("id", item.id);
    if (error) return toast(mensagemErro(error), "erro");
    toast(item[campo] ? `“${item.nome}” desativado.` : `“${item.nome}” reativado.`, "ok");
    desenhar();
  });
  raiz.querySelectorAll("[data-renomear]").forEach((b) => b.onclick = () => {
    const { tabela, item } = achar(b.dataset.renomear);
    abrirJanela({
      titulo: "Renomear",
      corpo: `<div class="campo"><label for="r-nome">Novo nome</label><input class="entrada" id="r-nome" maxlength="60" value="${esc(item.nome)}"></div>
        <p class="ajuda" style="margin-top:10px">Os lançamentos antigos passam a mostrar o novo nome.</p>`,
      acoes: [{ texto: "Cancelar" }, { texto: "Salvar", classe: "botao-principal", aoClicar: async (j) => {
        const nome = j.elemento.querySelector("#r-nome").value.trim();
        if (nome.length < 2) return false;
        const { error } = await sb.from(tabela).update({ nome }).eq("id", item.id);
        if (error) { toast(mensagemErro(error), "erro"); return false; }
        toast("Nome atualizado.", "ok");
        desenhar();
      } }],
    });
  });
  raiz.querySelectorAll("[data-novo]").forEach((f) => f.onsubmit = async (e) => {
    e.preventDefault();
    const tabela = f.dataset.novo;
    const nome = f.nome.value.trim();
    if (nome.length < 2) return toast("Informe um nome com pelo menos 2 letras.", "erro");
    const dados = { nome, ordem: 90 };
    if (tabela === "categorias") dados.aplica_a = [f.aplica.value];
    const { error } = await sb.from(tabela).insert(dados);
    if (error) return toast(/unico|unique|duplicate/i.test(error.message) ? "Já existe um item com esse nome." : mensagemErro(error), "erro");
    toast(`“${nome}” adicionado.`, "ok");
    desenhar();
  });
  raiz.querySelector("#c-geral").onsubmit = async (e) => {
    e.preventDefault();
    const am = Number(raiz.querySelector("#c-am").value), vm = Number(raiz.querySelector("#c-vm").value);
    const max = Number(raiz.querySelector("#c-max").value);
    if (!(vm < am)) return toast("Os dias da linha vermelha precisam ser menores que os da amarela.", "erro");
    const { error } = await sb.from("configuracoes").update({ dias_amarelo: am, dias_vermelho: vm, max_usuarios: max }).eq("id", 1);
    if (error) return toast(mensagemErro(error), "erro");
    toast("Configurações salvas.", "ok");
    desenhar();
  };
}
