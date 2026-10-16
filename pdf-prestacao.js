// =====================================================================
// PDF da prestação de contas (A4 deitado)
// Monta o PDF no navegador com os dados salvos no banco no momento da
// emissão. Cada emissão é registrada (código e versão) antes do download.
// =====================================================================
import { sb, fmt, nomeMes, TIPO } from "./comum.js";

const PDF_LIB = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
const NOTAS = ["Nota fiscal", "NFS-e", "Cupom fiscal"];

// O PDF sempre traz TODOS os lançamentos do mês (CPF, CNPJ, sem documento,
// coleta de obra, a pagar e cancelados à parte), para a análise mensal.
export const FILTROS = {
  completo: { nome: "Prestação completa", sufixo: "", filtro: () => true },
};

const SIT = {
  pago: "Pago", recebido: "Recebido", a_pagar: "A pagar", a_receber: "A receber", agendado: "Agendado",
  parcialmente_pago: "Pago em parte", recebimento_parcial: "Receb. em parte", vencido: "Vencido",
  atrasado: "Atrasado", material_reaproveitado: "Reaproveitado", cancelado: "Cancelado", no_cartao: "No cartão",
};

let carregando = null;
function carregarPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  carregando ??= new Promise((ok, falha) => {
    const s = document.createElement("script");
    s.src = PDF_LIB;
    s.onload = () => ok(window.PDFLib);
    s.onerror = () => { carregando = null; falha(new Error("Não foi possível carregar o gerador de PDF. Verifique a internet.")); };
    document.head.append(s);
  });
  return carregando;
}

// A fonte padrão do PDF (Helvetica) só tem caracteres do alfabeto latino.
const EXTRAS = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
function limpo(texto) {
  return Array.from(String(texto ?? "")).map((c) => {
    const n = c.codePointAt(0);
    if (c === "\n" || c === "\t") return " ";
    if ((n >= 32 && n <= 126) || (n >= 160 && n <= 255) || EXTRAS.includes(c)) return c;
    if (c === "→") return "->";
    return "";
  }).join("");
}

/**
 * Gera, registra e baixa o PDF.
 * Devolve { codigo, nomeArquivo, bytes, url }.
 */
export async function gerarPDF({ mes, filtro = "completo", perfil, baixar = true }) {
  const F = FILTROS[filtro];
  const filtrado = filtro !== "completo";
  const PDFLib = await carregarPdfLib();

  const [lin, porSocio, logoBytes] = await Promise.all([
    sb.from("vw_lancamentos").select("*").eq("mes_referencia", mes).order("data_movimentacao").order("id"),
    sb.from("vw_resumo_pagador").select("*").eq("mes", mes).order("pagador"),
    fetch(document.querySelector(".menu-logo img, img[alt^='Boom Games']")?.src || "logo-boomgames-web.png").then((r) => r.arrayBuffer()).catch(() => null),
  ]);
  if (lin.error) throw lin.error;
  const todos = lin.data;
  const ativos = todos.filter((l) => l.situacao !== "cancelado");
  const linhas = ativos.filter(F.filtro);
  const cancelados = filtrado ? [] : todos.filter((l) => l.situacao === "cancelado");
  if (!linhas.length && !cancelados.length) {
    throw new Error(filtrado ? `Nenhum lançamento de ${nomeMes(mes)} atende ao filtro escolhido.` : `Não há lançamentos em ${nomeMes(mes)}.`);
  }

  // Totais calculados aqui (para o filtro) ou pelo próprio banco (completo)
  const somar = (lista, f, campo) => lista.filter(f).reduce((s, l) => s + (l[campo] || 0), 0);
  const totaisLocais = {
    pagamentos_efetivados_centavos: somar(linhas, (l) => l.tipo === "pagamento", "valor_efetivo_centavos"),
    recebimentos_efetivados_centavos: somar(linhas, (l) => l.tipo === "recebimento", "valor_efetivo_centavos"),
    pagar_pendente_centavos: somar(linhas, (l) => l.tipo === "pagamento", "saldo_pendente_centavos"),
    vencidas_centavos: somar(linhas, (l) => l.situacao === "vencido", "saldo_pendente_centavos"),
    coletas_obra_centavos: somar(linhas, (l) => l.tipo === "coleta_obra", "valor_centavos"),
    qtd_lancamentos: linhas.length,
    qtd_conferidos: linhas.filter((l) => l.status_conferencia === "conferido").length,
    qtd_aguardando_conferencia: linhas.filter((l) => l.tipo !== "coleta_obra" && l.status_conferencia === "pendente").length,
    qtd_divergencias: linhas.filter((l) => l.status_conferencia === "divergente").length,
  };
  totaisLocais.custo_mes_centavos = totaisLocais.pagamentos_efetivados_centavos + totaisLocais.coletas_obra_centavos;
  totaisLocais.saldo_liquido_centavos = totaisLocais.recebimentos_efetivados_centavos - totaisLocais.pagamentos_efetivados_centavos;

  // Registro da emissão (código + versão). Na prestação completa o banco devolve os totais oficiais.
  const { data: reg, error: eReg } = await sb.rpc("fn_registrar_relatorio", {
    p_mes: mes, p_filtrado: filtrado, p_filtros: filtrado ? { filtro, nome: F.nome } : null,
    p_totais: filtrado ? totaisLocais : null,
  });
  if (eReg) throw eReg;
  const T = { ...totaisLocais, ...(reg?.totais || {}) };
  const codigo = reg?.codigo || `BG-${mes.slice(0, 7)}`;
  const emitidoEm = new Date();

  // Conferência: os totais impressos precisam bater com a soma das linhas
  if (!filtrado && T.pagamentos_efetivados_centavos !== totaisLocais.pagamentos_efetivados_centavos) {
    throw new Error("Os totais do banco e das linhas não conferem. Recarregue a página e gere o PDF de novo.");
  }

  // ------------------------------------------------------------------
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  doc.setTitle(`Prestação de Contas - ${nomeMes(mes)} - Boom Games`);
  doc.setAuthor("Boom Games");
  doc.setCreator("Boom Games · Prestação de Contas");
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = logoBytes ? await doc.embedPng(logoBytes).catch(() => null) : null;

  const LARG = 841.89, ALT = 595.28, M = 28;
  const UTIL = LARG - 2 * M;
  const COR = {
    preto: rgb(0, 0, 0), texto: rgb(0.1, 0.1, 0.1), cinza: rgb(0.36, 0.37, 0.4), claro: rgb(0.55, 0.56, 0.58),
    linha: rgb(0.86, 0.87, 0.88), zebra: rgb(0.965, 0.967, 0.972), laranja: rgb(1, 0.329, 0),
    laranjaSuave: rgb(1, 0.94, 0.9), vermelho: rgb(0.77, 0.17, 0.11), verde: rgb(0.09, 0.46, 0.29),
  };
  let pagina, y; // y = distância do topo

  const larg = (t, f, tam) => f.widthOfTextAtSize(limpo(t), tam);
  const escrever = (t, x, topo, { f = fonte, tam = 8, cor = COR.texto, alinhar = "esq", largura = 0 } = {}) => {
    const txt = limpo(t);
    let px = x;
    if (alinhar === "dir") px = x + largura - f.widthOfTextAtSize(txt, tam);
    if (alinhar === "centro") px = x + (largura - f.widthOfTextAtSize(txt, tam)) / 2;
    pagina.drawText(txt, { x: px, y: ALT - topo - tam, size: tam, font: f, color: cor });
  };
  const retangulo = (x, topo, w, h, cor, borda) =>
    pagina.drawRectangle({ x, y: ALT - topo - h, width: w, height: h, color: cor, borderColor: borda, borderWidth: borda ? 0.6 : 0 });
  const linhaH = (topo, x1 = M, x2 = LARG - M, cor = COR.linha, esp = 0.6) =>
    pagina.drawLine({ start: { x: x1, y: ALT - topo }, end: { x: x2, y: ALT - topo }, thickness: esp, color: cor });

  function quebrar(texto, f, tam, largura) {
    const palavras = limpo(texto).split(/\s+/).filter(Boolean);
    const linhas = [];
    let atual = "";
    for (let p of palavras) {
      while (f.widthOfTextAtSize(p, tam) > largura) {          // palavra maior que a coluna
        let i = p.length - 1;
        while (i > 1 && f.widthOfTextAtSize(p.slice(0, i), tam) > largura) i--;
        if (atual) { linhas.push(atual); atual = ""; }
        linhas.push(p.slice(0, i)); p = p.slice(i);
      }
      const teste = atual ? `${atual} ${p}` : p;
      if (f.widthOfTextAtSize(teste, tam) <= largura) atual = teste;
      else { linhas.push(atual); atual = p; }
    }
    if (atual) linhas.push(atual);
    return linhas.length ? linhas : [""];
  }

  function novaPagina() {
    pagina = doc.addPage([LARG, ALT]);
    // Cabeçalho (repete em todas as páginas)
    let x = M;
    if (logo) {
      const h = 40, w = (logo.width / logo.height) * h;
      pagina.drawImage(logo, { x: M, y: ALT - M - h, width: w, height: h });
      x = M + w + 16;
    }
    escrever("Prestação de Contas", x, M + 2, { f: negrito, tam: 17, cor: COR.preto });
    escrever(nomeMes(mes) + (filtrado ? "  ·  relatório filtrado" : ""), x, M + 23, { f: fonte, tam: 11, cor: COR.cinza });
    const d = 260;
    escrever(`Relatório ${codigo}`, LARG - M - d, M + 2, { f: negrito, tam: 8.5, alinhar: "dir", largura: d });
    escrever(`Emitido em ${fmt.dataHora(emitidoEm.toISOString())}`, LARG - M - d, M + 15, { tam: 8, cor: COR.cinza, alinhar: "dir", largura: d });
    escrever(`Por ${perfil?.nome || "—"}`, LARG - M - d, M + 26, { tam: 8, cor: COR.cinza, alinhar: "dir", largura: d });
    pagina.drawRectangle({ x: M, y: ALT - M - 50, width: UTIL, height: 2.2, color: COR.laranja });
    y = M + 62;
  }
  const espaco = (h) => { if (y + h > ALT - M - 22) { novaPagina(); return true; } return false; };

  // ---------------------------- Página 1 ------------------------------
  novaPagina();
  if (filtrado) {
    retangulo(M, y, UTIL, 22, COR.laranjaSuave);
    pagina.drawRectangle({ x: M, y: ALT - y - 22, width: 3, height: 22, color: COR.laranja });
    escrever(`Relatório filtrado: ${F.nome[0].toLowerCase()}${F.nome.slice(1)}. Não substitui a prestação de contas completa do mês.`, M + 10, y + 7, { f: negrito, tam: 8.5, cor: rgb(0.42, 0.15, 0) });
    y += 32;
  }

  // Resumo financeiro
  escrever("Resumo financeiro", M, y, { f: negrito, tam: 11, cor: COR.preto }); y += 18;
  const caixas = [
    ["Custo do mês", fmt.dinheiro(T.custo_mes_centavos), "Pago + material reaproveitado"],
    ["Total pago", fmt.dinheiro(T.pagamentos_efetivados_centavos), "Pagamentos efetivados"],
    ["Material reaproveitado", fmt.dinheiro(T.coletas_obra_centavos), "Coleta de obra"],
    ["A pagar (em aberto)", fmt.dinheiro(T.pagar_pendente_centavos), T.vencidas_centavos ? `${fmt.dinheiro(T.vencidas_centavos)} vencido` : "Boletos e cartão deste mês"],
    ["Recebido no mês", fmt.dinheiro(T.recebimentos_efetivados_centavos), "Recebimentos efetivados"],
    ["Lançamentos", String(T.qtd_lancamentos ?? linhas.length), `${T.qtd_conferidos ?? 0} conferidos`],
  ];
  const cw = UTIL / caixas.length;
  retangulo(M, y, UTIL, 50, rgb(1, 1, 1), COR.linha);
  caixas.forEach(([rot, val, sub], i) => {
    const x = M + i * cw;
    if (i) pagina.drawLine({ start: { x, y: ALT - y }, end: { x, y: ALT - y - 50 }, thickness: 0.6, color: COR.linha });
    escrever(rot, x + 9, y + 8, { tam: 7.5, cor: COR.cinza });
    escrever(val, x + 9, y + 20, { f: negrito, tam: 12.5, cor: i === 3 && T.vencidas_centavos ? COR.vermelho : i === 0 ? COR.laranja : COR.preto });
    escrever(sub, x + 9, y + 37, { tam: 6.8, cor: COR.claro });
  });
  y += 58;
  escrever(`Custo do mês = pagamentos efetivados + material reaproveitado (coleta de obra). Boletos entram no mês do vencimento e o cartão de crédito no mês da fatura. Saldo líquido (recebido menos pago): ${fmt.dinheiro(T.saldo_liquido_centavos)}.`, M, y, { tam: 7.2, cor: COR.cinza });
  y += 11;
  escrever(`Conferência: ${T.qtd_conferidos ?? 0} de ${T.qtd_lancamentos ?? 0} lançamentos conferidos (conferido = impresso e arquivado na pasta)` +
    `${T.qtd_aguardando_conferencia ? `, ${T.qtd_aguardando_conferencia} não conferidos` : ""}${T.qtd_divergencias ? `, ${T.qtd_divergencias} com divergência` : ""}` +
    `${cancelados.length ? `. ${cancelados.length} cancelado(s), fora dos totais` : ""}.`, M, y, { tam: 7.2, cor: COR.cinza });
  y += 20;

  // Por sócio (só na prestação completa)
  const socios = (porSocio.data || []).filter((s) => s.pago_centavos || s.pendente_centavos || s.coletas_obra_centavos || s.recebido_centavos);
  if (!filtrado && socios.length) {
    escrever("Por sócio (quem pagou)", M, y, { f: negrito, tam: 11, cor: COR.preto }); y += 17;
    const cs = [["Sócio", 160, "esq"], ["Custo", 110, "dir"], ["Pago", 110, "dir"], ["Material reaproveitado", 130, "dir"], ["A pagar", 110, "dir"], ["Recebido", 100, "dir"]];
    let x = M;
    retangulo(M, y, 720, 16, COR.zebra);
    for (const [t, w, a] of cs) { escrever(t, x + 6, y + 4.5, { f: negrito, tam: 7.5, cor: COR.cinza, alinhar: a, largura: w - 12 }); x += w; }
    y += 16;
    for (const s of socios) {
      x = M;
      const vals = [s.pagador, fmt.dinheiro(s.custo_centavos ?? (s.pago_centavos + s.coletas_obra_centavos)), fmt.dinheiro(s.pago_centavos),
        fmt.dinheiro(s.coletas_obra_centavos), fmt.dinheiro(s.pendente_centavos), fmt.dinheiro(s.recebido_centavos || 0)];
      cs.forEach(([, w, a], i) => { escrever(vals[i], x + 6, y + 4.5, { f: i ? fonte : negrito, tam: 8, alinhar: a, largura: w - 12 }); x += w; });
      y += 16; linhaH(y, M, M + 720);
    }
    y += 16;
  }

  // ---------------------- Tabela de lançamentos -----------------------
  const COLS = [
    { t: "Nº", w: 30 }, { t: "Data", w: 50 }, { t: "Descrição / categoria", w: 196 }, { t: "Fornecedor", w: 92 },
    { t: "CNPJ/CPF", w: 42 }, { t: "Documento", w: 76 }, { t: "Pago por", w: 62 }, { t: "Forma", w: 66 },
    { t: "Situação", w: 58 }, { t: "Conferido", w: 42 }, { t: "Valor", w: 72, a: "dir" },
  ];
  const TAM = 7.4, LH = 9.2, PAD = 4;
  const cabecalhoTabela = () => {
    retangulo(M, y, UTIL, 17, COR.preto);
    let x = M;
    for (const c of COLS) { escrever(c.t, x + PAD, y + 5, { f: negrito, tam: 7.2, cor: rgb(1, 1, 1), alinhar: c.a === "dir" ? "dir" : "esq", largura: c.w - 2 * PAD }); x += c.w; }
    y += 17;
  };
  const celulas = (l) => {
    const documento = [l.tipo_documento === "Nota fiscal" ? "NF" : l.tipo_documento, l.numero_documento].filter(Boolean).join(" ");
    const forma = l.tipo === "coleta_obra" ? "—"
      : (l.forma_pagamento_nome || "—") + (l.parcela_rotulo ? ` (${l.parcela_numero}/${l.parcela_total})` : l.vezes > 1 ? ` ${l.vezes}x` : "");
    let sit = SIT[l.situacao] || l.situacao;
    if (l.saldo_pendente_centavos > 0 && l.data_vencimento) sit += l.pago_automatico ? ` (fatura ${fmt.data(l.data_vencimento).slice(0, 5)})` : ` venc. ${fmt.data(l.data_vencimento).slice(0, 5)}`;
    return [
      { v: String(l.id) }, { v: fmt.data(l.data_movimentacao) },
      { v: l.descricao, sub: [l.categoria_nome, l.tipo !== "pagamento" ? TIPO[l.tipo] : "",
          l.data_competencia && l.data_competencia !== l.data_movimentacao ? `compra em ${fmt.data(l.data_competencia)}` : ""].filter(Boolean).join(" · ") },
      { v: l.contraparte || "—" }, { v: l.contraparte_tipo ? l.contraparte_tipo.toUpperCase() : "—" },
      { v: (documento || "Sem documento") + (l.nota_pendente ? " (nota a receber)" : "") },
      { v: l.pagador_nome || "—" }, { v: forma }, { v: sit },
      { v: l.tipo === "coleta_obra" ? "—" : l.status_conferencia === "conferido" ? "Sim" : l.status_conferencia === "divergente" ? "Diverg." : "Não" },
      { v: fmt.dinheiro(l.valor_centavos), dir: true, neg: true },
    ];
  };

  espaco(60);
  escrever(`Lançamentos do mês, em ordem cronológica (${linhas.length})`, M, y, { f: negrito, tam: 11, cor: COR.preto }); y += 17;
  cabecalhoTabela();
  linhas.forEach((l, idx) => {
    const cel = celulas(l);
    const quebras = cel.map((c, i) => {
      const w = COLS[i].w - 2 * PAD;
      const princ = quebrar(c.v, c.neg || i === 2 ? negrito : fonte, TAM, w);
      const sub = c.sub ? quebrar(c.sub, fonte, 6.6, w) : [];
      return { princ, sub };
    });
    const nl = Math.max(...quebras.map((q) => q.princ.length + q.sub.length * 0.9));
    const h = nl * LH + 2 * PAD + 1;
    if (espaco(h)) cabecalhoTabela();
    if (idx % 2) retangulo(M, y, UTIL, h, COR.zebra);
    let x = M;
    quebras.forEach((q, i) => {
      const c = cel[i], w = COLS[i].w - 2 * PAD;
      let ty = y + PAD + 0.5;
      for (const t of q.princ) {
        escrever(t, x + PAD, ty, { f: c.neg || i === 2 ? negrito : fonte, tam: TAM,
          cor: l.situacao === "vencido" && i === 8 ? COR.vermelho : l.tipo === "coleta_obra" && i === 10 ? COR.cinza : COR.texto,
          alinhar: c.dir ? "dir" : "esq", largura: w });
        ty += LH;
      }
      for (const t of q.sub) { escrever(t, x + PAD, ty - 0.5, { tam: 6.6, cor: COR.claro }); ty += LH * 0.9; }
      x += COLS[i].w;
    });
    y += h;
    linhaH(y);
  });

  // Totais ao fim da tabela
  espaco(52);
  y += 6;
  const fim = [
    ["Custo do mês (pago + material reaproveitado)", T.custo_mes_centavos],
    ["Total pago no mês", T.pagamentos_efetivados_centavos],
    ["Total a pagar (em aberto)", T.pagar_pendente_centavos],
    ...(T.recebimentos_efetivados_centavos ? [["Total recebido no mês", T.recebimentos_efetivados_centavos]] : []),
    ...(T.coletas_obra_centavos ? [["Material reaproveitado", T.coletas_obra_centavos]] : []),
  ];
  for (const [rot, v] of fim) {
    escrever(rot, LARG - M - 330, y, { tam: 8.5, cor: COR.cinza, alinhar: "dir", largura: 240 });
    escrever(fmt.dinheiro(v), LARG - M - 90, y, { f: negrito, tam: 8.5, alinhar: "dir", largura: 90 - PAD });
    y += 13;
  }

  // Cancelados (só na prestação completa)
  if (cancelados.length) {
    y += 10;
    espaco(50);
    escrever("Cancelados (registrados, fora dos totais)", M, y, { f: negrito, tam: 10, cor: COR.preto }); y += 15;
    for (const l of cancelados) {
      const txt = `Nº ${l.id}, ${fmt.data(l.data_movimentacao)}, ${l.descricao}, ${fmt.dinheiro(l.valor_centavos)}. Motivo: ${l.motivo_cancelamento || "—"}`;
      const ls = quebrar(txt, fonte, 7.6, UTIL);
      espaco(ls.length * 10 + 4);
      for (const t of ls) { escrever(t, M, y, { tam: 7.6, cor: COR.cinza }); y += 10; }
      y += 3;
    }
  }

  // Rodapé em todas as páginas
  const paginas = doc.getPages();
  paginas.forEach((p, i) => {
    pagina = p;
    linhaH(ALT - M - 12, M, LARG - M, COR.linha);
    escrever(`Boom Games · Prestação de contas de ${nomeMes(mes).toLowerCase()} · ${codigo}`, M, ALT - M - 8, { tam: 7, cor: COR.claro });
    escrever(`Emitido em ${fmt.dataHora(emitidoEm.toISOString())}   ·   Página ${i + 1} de ${paginas.length}`, LARG - M - 300, ALT - M - 8,
      { tam: 7, cor: COR.claro, alinhar: "dir", largura: 300 });
  });

  const bytes = await doc.save();
  const nomeArquivo = `BoomGames_PrestacaoContas_${mes.slice(0, 7)}${F.sufixo}.pdf`;
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  if (baixar) {
    const a = document.createElement("a");
    a.href = url; a.download = nomeArquivo;
    document.body.append(a); a.click(); a.remove();
  }
  return { codigo, nomeArquivo, bytes, url };
}

