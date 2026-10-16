import { sb, esc, fmt, cadastros, mensagemErro, nomeMes, hojeISO, somarDias, SITUACAO, CONFERENCIA, TIPO } from "./comum.js";
import { abrirDetalhes } from "./lancamento-janelas.js";

const TABELAS = {
  lancamentos: "Lançamentos", prestacoes: "Prestações mensais", relatorios_emitidos: "Relatórios PDF",
  documentos: "Documentos", perfis: "Usuários", categorias: "Categorias", pagadores: "Sócios",
  formas_pagamento: "Formas de pagamento", configuracoes: "Configurações",
};
const SINGULAR = {
  lancamentos: "lançamento", prestacoes: "prestação do mês", relatorios_emitidos: "relatório PDF", documentos: "documento",
  perfis: "usuário", categorias: "categoria", pagadores: "sócio", formas_pagamento: "forma de pagamento", configuracoes: "configurações",
};
const OPERACOES = {
  INSERT: "Criou", UPDATE: "Alterou", DELETE: "Apagou", CANCELAMENTO: "Cancelou", RESTAURACAO: "Restaurou",
  PAGAMENTO: "Registrou pagamento", ANEXO_DOCUMENTO: "Anexou documento", REMOCAO_DOCUMENTO: "Removeu documento",
  GERACAO_RELATORIO: "Gerou PDF", ENCERRAMENTO: "Concluiu o mês", REABERTURA: "Reabriu o mês",
  EM_CONFERENCIA: "Enviou para conferência", STATUS_PRESTACAO: "Mudou a situação do mês",
};
const CAMPOS = {
  valor_centavos: "Valor", valor_pago_centavos: "Valor pago", data_movimentacao: "Data", data_vencimento: "Vencimento",
  data_liquidacao: "Data do pagamento", data_emissao: "Emissão da nota", data_competencia: "Data da compra",
  data_recebimento_doc: "Nota chegou em", descricao: "Descrição", categoria_id: "Categoria", pagador_id: "Sócio que pagou",
  forma_pagamento_id: "Forma de pagamento", contraparte: "Fornecedor", contraparte_tipo: "CNPJ/CPF",
  tipo_documento: "Tipo de documento", numero_documento: "Nº do documento", observacoes: "Observações",
  status_pagamento: "Situação", status_conferencia: "Conferência", motivo_divergencia: "Divergência",
  motivo_cancelamento: "Motivo do cancelamento", nota_pendente: "Nota a receber", vezes: "Vezes", tipo: "Tipo",
  ativo: "Ativo", ativa: "Ativa", perfil: "Perfil", nome: "Nome", email: "E-mail", status: "Situação",
  dias_amarelo: "Dias da linha amarela", dias_vermelho: "Dias da linha vermelha", dia_fatura_cartao: "Dia da fatura do cartão",
  max_usuarios: "Máximo de contas", pode_conferir: "Pode conferir", pode_cancelar: "Pode cancelar", trocar_senha: "Trocar senha",
  cancelado_em: "Cancelado em", removido_em: "Removido em", principal: "Administrador principal",
};
const IGNORAR = new Set(["id", "atualizado_em", "atualizado_por", "criado_em", "criado_por", "cancelado_por", "enviado_em",
  "enviado_por", "grupo_parcelas", "parcela_numero", "parcela_total", "origem", "ref_planilha", "pago_automatico",
  "concluida_por", "removido_por", "caminho", "mime", "tamanho_bytes", "aplica_a", "ordem", "ultimo_acesso"]);
const STATUS_PAG = { pendente: "A pagar", agendado: "Agendado", parcial: "Pago em parte", liquidado: "Pago", cancelado: "Cancelado" };
const STATUS_PREST = { em_andamento: "Em andamento", em_conferencia: "Em conferência", concluida: "Concluída", reaberta: "Reaberta" };

let estado;

export async function render(el, ctx) {
  estado = { el, ctx, periodo: "30", tabela: "", usuario: "" };
  const { data: perfis } = await sb.from("perfis").select("id, nome").order("nome");
  el.innerHTML = `
    <div class="barra">
      <label><span class="sr">Período</span><select class="entrada" id="h-periodo">
        <option value="7">Últimos 7 dias</option><option value="30" selected>Últimos 30 dias</option>
        <option value="90">Últimos 3 meses</option><option value="tudo">Tudo</option></select></label>
      <label><span class="sr">O que</span><select class="entrada" id="h-tabela"><option value="">Tudo</option>
        ${Object.entries(TABELAS).map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select></label>
      <label><span class="sr">Quem</span><select class="entrada" id="h-usuario"><option value="">Todas as pessoas</option>
        ${(perfis || []).map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join("")}
        <option value="sistema">Sistema (importação e manutenção)</option></select></label>
      <span class="sec empurra">O histórico não pode ser alterado nem apagado.</span>
    </div>
    <section class="painel" id="h-lista"></section>`;
  for (const id of ["h-periodo", "h-tabela", "h-usuario"]) {
    el.querySelector("#" + id).onchange = (e) => { estado[id.slice(2)] = e.target.value; carregar(); };
  }
  await carregar();
}

async function carregar() {
  const { el, ctx } = estado;
  const alvo = el.querySelector("#h-lista");
  alvo.innerHTML = `<p class="carregando-pagina">Carregando…</p>`;
  let q = sb.from("auditoria").select("*").order("ocorrido_em", { ascending: false }).limit(300);
  if (estado.periodo !== "tudo") q = q.gte("ocorrido_em", somarDias(hojeISO(), -Number(estado.periodo)) + "T00:00:00");
  if (estado.tabela) q = q.eq("tabela", estado.tabela);
  const [{ data, error }, cad] = await Promise.all([q, cadastros()]);
  if (error) { alvo.innerHTML = `<p class="aviso aviso-erro" style="margin:16px">${esc(mensagemErro(error))}</p>`; return; }
  const lista = data.filter((a) => !estado.usuario || (estado.usuario === "sistema" ? !a.usuario_id : a.usuario_id === estado.usuario));
  const nomes = {
    categoria_id: new Map(cad.categorias.map((c) => [String(c.id), c.nome])),
    pagador_id: new Map(cad.pagadores.map((c) => [String(c.id), c.nome])),
    forma_pagamento_id: new Map(cad.formas.map((c) => [String(c.id), c.nome])),
  };

  const valor = (campo, v) => {
    if (v === null || v === undefined || v === "") return "—";
    if (campo.endsWith("_centavos")) return fmt.dinheiro(v);
    if (nomes[campo]) return nomes[campo].get(String(v)) || `#${v}`;
    if (typeof v === "boolean") return v ? "Sim" : "Não";
    if (campo === "status_pagamento") return STATUS_PAG[v] || v;
    if (campo === "status_conferencia") return CONFERENCIA[v]?.[0] || v;
    if (campo === "status") return STATUS_PREST[v] || v;
    if (campo === "tipo") return TIPO[v] || v;
    if (campo === "contraparte_tipo") return v === "cpf" ? "Pessoa física (CPF)" : "Empresa (CNPJ)";
    if (/^\d{4}-\d{2}-\d{2}T/.test(String(v))) return fmt.dataHora(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return fmt.data(v);
    return String(v);
  };
  const resumoRegistro = (a) => {
    const r = a.depois || a.antes || {};
    if (a.tabela === "lancamentos") return `${r.descricao || `Lançamento #${a.registro_id}`}${r.valor_centavos ? `, ${fmt.dinheiro(r.valor_centavos)}` : ""}`;
    if (a.tabela === "prestacoes") return nomeMes(a.registro_id.slice(0, 10));
    if (a.tabela === "relatorios_emitidos") return `${r.codigo || "PDF"}${r.mes ? `, ${nomeMes(r.mes).toLowerCase()}` : ""}`;
    if (a.tabela === "documentos") return r.nome_original || "Documento";
    return r.nome || r.email || TABELAS[a.tabela] || a.tabela;
  };
  const mudancas = (a) => {
    if (a.operacao === "INSERT" || !a.campos_alterados?.length) return "";
    const linhas = a.campos_alterados.filter((c) => !IGNORAR.has(c)).map((c) =>
      `<li><span class="campo-nome">${esc(CAMPOS[c] || c)}:</span> <span class="antes">${esc(valor(c, a.antes?.[c]))}</span> → <strong>${esc(valor(c, a.depois?.[c]))}</strong></li>`);
    return linhas.length ? `<ul class="mudancas">${linhas.join("")}</ul>` : "";
  };

  if (!lista.length) {
    alvo.innerHTML = `<div class="vazio-tabela"><strong>Nada registrado com esses filtros.</strong>Tente um período maior.</div>`;
    return;
  }
  alvo.innerHTML = `
    <div class="painel-cabeca"><h2 class="titulo">Atividades</h2>
      <span class="resumo">${lista.length === 300 ? "Mostrando as 300 mais recentes" : lista.length === 1 ? "1 registro" : `${lista.length} registros`}</span></div>
    <div class="tabela-rolagem"><table class="tabela historico">
      <thead><tr><th>Quando</th><th>Quem</th><th>O que aconteceu</th><th><span class="sr">Abrir</span></th></tr></thead>
      <tbody>${lista.map((a) => `
        <tr>
          <td class="sec num sem-quebra">${fmt.dataHora(a.ocorrido_em)}</td>
          <td class="sem-quebra">${esc(a.usuario_id ? a.usuario_nome : "Sistema")}</td>
          <td><strong>${esc(OPERACOES[a.operacao] || a.operacao)}</strong> <span class="sec">${esc(SINGULAR[a.tabela] || a.tabela)}</span>
            <div>${esc(resumoRegistro(a))}</div>${mudancas(a)}</td>
          <td>${a.tabela === "lancamentos" ? `<button class="botao botao-texto botao-acao" data-abrir="${esc(a.registro_id)}">Abrir</button>` : ""}</td>
        </tr>`).join("")}</tbody></table></div>`;
  alvo.querySelectorAll("[data-abrir]").forEach((b) => b.onclick = () =>
    abrirDetalhes({ ctx, id: Number(b.dataset.abrir), aoMudar: carregar }));
}
