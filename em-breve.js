import { esc } from "./comum.js";

const DESCRICOES = {
  painel: "Totais do mês (pagamentos, pendências, material reaproveitado), totais por sócio e gráficos.",
  prestacoes: "Uma página por mês com os totais, a situação da prestação e o botão de gerar PDF.",
  lancamentos: "Cadastro e edição de pagamentos, com nota fiscal, sócio pagador, ordem por data e filtros.",
  contas: "Boletos a pagar, com a linha amarela a 10 dias e vermelha a 3 dias do vencimento.",
  documentos: "Notas fiscais, recibos e comprovantes anexados aos lançamentos.",
  relatorios: "PDF da prestação mensal para a contabilidade.",
  historico: "Quem alterou cada registro, quando, e o valor antes e depois.",
  configuracoes: "Categorias, sócios pagadores, formas de pagamento e os dias das cores de vencimento.",
};

export function render(el, { pagina, eAdmin }) {
  el.innerHTML = `
    <div class="painel vazio">
      <h2 class="titulo">${esc(pagina.nome)}</h2>
      <p>${esc(DESCRICOES[pagina.rota] || "")}</p>
      <p>Esta área entra na etapa ${pagina.etapa} do projeto.${eAdmin ? " Por enquanto, a página <strong>Usuários e permissões</strong> já está funcionando." : ""}</p>
    </div>`;
}
