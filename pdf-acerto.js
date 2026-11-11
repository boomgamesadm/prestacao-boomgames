// =====================================================================
// PDF do Acerto entre Sócios (A4 em pé)
// =====================================================================
import { sb, fmt, nomeMes, hojeISO } from "./comum.js";
import { carregarPdfLib, limpo } from "./pdf-prestacao.js";

export async function gerarPDFAcerto({ r, A, B, taxa, pagamentos, perfil, inicio = null, combinado = "", previsto = null, baixar = true }) {
  const PDFLib = await carregarPdfLib();
  const [{ data: cfg }, logoBytes] = await Promise.all([
    sb.from("configuracoes").select("*").single(),
    fetch(document.querySelector(".menu-logo img, img[alt^='Boom Games']")?.src || "logo-boomgames-web.png").then((x) => x.arrayBuffer()).catch(() => null),
  ]);
  const hoje = hojeISO();
  const emitido = new Date();
  const pct = (v) => `${(Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 3 })}%`;
  const devedor = r.saldo >= 0 ? B : A, credor = r.saldo >= 0 ? A : B;

  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  doc.setTitle(`Acerto entre Sócios - ${fmt.data(hoje)} - Boom Games`);
  doc.setAuthor(cfg?.empresa_razao_social || "Boom Games");
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = logoBytes ? await doc.embedPng(logoBytes).catch(() => null) : null;

  const LARG = 595.28, ALT = 841.89, M = 36, UTIL = LARG - 2 * M;
  const COR = {
    preto: rgb(0, 0, 0), texto: rgb(0.1, 0.1, 0.1), cinza: rgb(0.36, 0.37, 0.4), claro: rgb(0.55, 0.56, 0.58),
    linha: rgb(0.86, 0.87, 0.88), zebra: rgb(0.965, 0.967, 0.972), laranja: rgb(1, 0.329, 0), laranjaForte: rgb(0.85, 0.28, 0),
    laranjaSuave: rgb(1, 0.94, 0.9), verde: rgb(0.09, 0.46, 0.29),
  };
  let pagina, y;
  const escrever = (t, x, topo, { f = fonte, tam = 9, cor = COR.texto, alinhar = "esq", largura = 0 } = {}) => {
    const txt = limpo(t);
    let px = x;
    if (alinhar === "dir") px = x + largura - f.widthOfTextAtSize(txt, tam);
    if (alinhar === "centro") px = x + (largura - f.widthOfTextAtSize(txt, tam)) / 2;
    pagina.drawText(txt, { x: px, y: ALT - topo - tam, size: tam, font: f, color: cor });
  };
  const ret = (x, topo, w, h, cor, borda) =>
    pagina.drawRectangle({ x, y: ALT - topo - h, width: w, height: h, color: cor, borderColor: borda, borderWidth: borda ? 0.6 : 0 });
  const linhaH = (topo, x1 = M, x2 = LARG - M, cor = COR.linha, esp = 0.6) =>
    pagina.drawLine({ start: { x: x1, y: ALT - topo }, end: { x: x2, y: ALT - topo }, thickness: esp, color: cor });
  function quebrar(texto, f, tam, largura) {
    const palavras = limpo(texto).split(/\s+/).filter(Boolean);
    const linhas = []; let atual = "";
    for (const p of palavras) {
      const t = atual ? `${atual} ${p}` : p;
      if (f.widthOfTextAtSize(t, tam) <= largura) atual = t; else { if (atual) linhas.push(atual); atual = p; }
    }
    if (atual) linhas.push(atual);
    return linhas;
  }

  function novaPagina() {
    pagina = doc.addPage([LARG, ALT]);
    let x = M;
    if (logo) {
      const h = 38, w = (logo.width / logo.height) * h;
      pagina.drawImage(logo, { x: M, y: ALT - M - h, width: w, height: h });
      x = M + w + 14;
    }
    escrever("Acerto entre Sócios", x, M + 2, { f: negrito, tam: 16, cor: COR.preto });
    escrever(`Posição em ${fmt.data(hoje)}`, x, M + 22, { tam: 11, cor: COR.cinza });
    const d = 220;
    const empresa = [cfg?.empresa_razao_social, cfg?.empresa_cnpj ? `CNPJ ${cfg.empresa_cnpj}` : null].filter(Boolean);
    empresa.forEach((t, i) => escrever(t, LARG - M - d, M + 2 + i * 11, { f: i ? fonte : negrito, tam: i ? 7.5 : 8.5, cor: i ? COR.cinza : COR.texto, alinhar: "dir", largura: d }));
    escrever(`Sociedade 50/50: ${A.nome} e ${B.nome}`, LARG - M - d, M + 2 + empresa.length * 11, { tam: 7.5, cor: COR.cinza, alinhar: "dir", largura: d });
    pagina.drawRectangle({ x: M, y: ALT - M - 50, width: UTIL, height: 2.2, color: COR.laranja });
    y = M + 64;
  }
  const espaco = (h) => { if (y + h > ALT - M - 26) { novaPagina(); return true; } return false; };

  // ------------------------------- Resumo -------------------------------
  novaPagina();
  ret(M, y, UTIL, 50, COR.laranjaSuave);
  pagina.drawRectangle({ x: M, y: ALT - y - 50, width: 4, height: 50, color: COR.laranja });
  escrever(r.saldo ? `${devedor.nome} deve a ${credor.nome}` : "Os sócios estão em dia", M + 14, y + 8, { tam: 9, cor: rgb(0.42, 0.15, 0) });
  escrever(fmt.dinheiro(Math.abs(r.saldo)), M + 14, y + 21, { f: negrito, tam: 18, cor: COR.laranjaForte });
  escrever(`Saldo em ${fmt.data(hoje)}, já com os juros dos meses fechados.`, M + 230, y + 12, { tam: 8, cor: COR.cinza });
  if (r.difMesAtual) escrever(`Inclui ${fmt.dinheiro(Math.abs(r.difMesAtual))} do mês atual, ainda aberto (sem juros até fechar).`, M + 230, y + 25, { tam: 8, cor: COR.cinza });
  y += 52;

  const caixas = [
    ["Diferença dos meses", fmt.dinheiro(Math.abs(r.totalDif)), "Metade da diferença de custo"],
    ["Juros acumulados", fmt.dinheiro(Math.abs(r.totalJuros)), `${pct(taxa)} ao mês, compostos`],
    [`Já pago por ${B.nome}`, fmt.dinheiro(r.totalPagoBA), r.totalPagoAB ? `${A.nome} pagou ${fmt.dinheiro(r.totalPagoAB)}` : `${pagamentos.length} pagamento(s)`],
  ];
  const cw = UTIL / caixas.length;
  ret(M, y, UTIL, 46, rgb(1, 1, 1), COR.linha);
  caixas.forEach(([rot, val, sub], i) => {
    const x = M + i * cw;
    if (i) pagina.drawLine({ start: { x, y: ALT - y }, end: { x, y: ALT - y - 46 }, thickness: 0.6, color: COR.linha });
    escrever(rot, x + 9, y + 7, { tam: 7.5, cor: COR.cinza });
    escrever(val, x + 9, y + 18, { f: negrito, tam: 12, cor: COR.preto });
    escrever(sub, x + 9, y + 34, { tam: 6.8, cor: COR.claro });
  });
  y += 52;

  // ------------------------ Como será o pagamento ------------------------
  if (combinado || inicio) {
    escrever("Como será o pagamento", M, y, { f: negrito, tam: 11, cor: COR.preto }); y += 16;
    const linhasTxt = combinado ? quebrar(combinado, fonte, 8.6, UTIL - 24) : [];
    const altCaixa = 14 + linhasTxt.length * 12 + 50;
    ret(M, y, UTIL, altCaixa, COR.zebra);
    let yy = y + 10;
    for (const l of linhasTxt) { escrever(l, M + 12, yy, { tam: 8.6, cor: COR.texto }); yy += 12; }
    yy += 6;
    const metade = (UTIL - 24) / 2;
    escrever("Início previsto dos pagamentos", M + 12, yy, { tam: 7.5, cor: COR.cinza });
    escrever(inicio ? nomeMes(inicio) : "-", M + 12, yy + 11, { f: negrito, tam: 10.5, cor: COR.preto });
    escrever("Pagamentos em valores livres, conforme a disponibilidade.", M + 12, yy + 25, { tam: 7, cor: COR.cinza });
    if (previsto != null && inicio) {
      escrever(`Saldo previsto em ${nomeMes(inicio).toLowerCase()}`, M + 12 + metade, yy, { tam: 7.5, cor: COR.cinza });
      escrever(fmt.dinheiro(Math.abs(previsto)), M + 12 + metade, yy + 11, { f: negrito, tam: 10.5, cor: COR.laranjaForte });
      escrever("Com os juros até lá, considerando só os custos já registrados.", M + 12 + metade, yy + 25, { tam: 7, cor: COR.cinza });
    }
    y += altCaixa + 10;
  }

  // --------------------------- Como é calculado ---------------------------
  escrever("Como é calculado", M, y, { f: negrito, tam: 11, cor: COR.preto }); y += 16;
  const regras = [
    `1. A sociedade é 50/50: cada sócio arca com metade do custo da loja.`,
    `2. Custo de cada mês = pagamentos efetivados + material reaproveitado (coleta de obra), conforme a prestação de contas.`,
    `3. Diferença do mês = (custo de ${A.nome} − custo de ${B.nome}) ÷ 2. Valor positivo: ${B.nome} deve a ${A.nome}.`,
    `4. Depois que o mês fecha, o saldo rende juros compostos de ${pct(taxa)} ao mês, até o mês anterior ao pagamento.`,
    `5. Os pagamentos entre os sócios abatem o saldo no mês em que são feitos.`,
  ];
  for (const t of regras) {
    for (const [i, l] of quebrar(t, fonte, 8.3, UTIL - 10).entries()) { escrever(l, M + (i ? 10 : 0), y, { tam: 8.3, cor: COR.cinza }); y += 10.5; }
  }
  y += 6;

  // ----------------------------- Extrato -----------------------------
  const COLS = [["Mês", 88, "esq"], [`Custo ${A.nome}`, 72, "dir"], [`Custo ${B.nome}`, 72, "dir"], ["Diferença ÷ 2", 70, "dir"],
    ["Pagamentos", 70, "dir"], ["Juros do mês", 66, "dir"], ["Saldo no fim", UTIL - 438, "dir"]];
  const cab = () => {
    ret(M, y, UTIL, 16, COR.preto);
    let x = M;
    for (const [t, w, a] of COLS) {
      escrever(t, x + 5, y + 4.5, { f: negrito, tam: 7, cor: rgb(1, 1, 1), alinhar: a === "dir" ? "dir" : "esq", largura: w - 10 });
      x += w;
    }
    y += 16;
  };
  espaco(80);
  escrever("Extrato mês a mês", M, y, { f: negrito, tam: 11, cor: COR.preto }); y += 16;
  cab();
  const sinal = (v) => (v ? fmt.sinal(v) : "—");
  r.linhas.forEach((l, i) => {
    if (espaco(16)) cab();
    if (i % 2) ret(M, y, UTIL, 16, COR.zebra);
    const vals = [`${nomeMes(l.mes)}${l.fechado ? "" : " *"}`, fmt.dinheiro(l.custoA), fmt.dinheiro(l.custoB), sinal(l.diferenca),
      sinal(l.pagamentos), sinal(l.juros), fmt.dinheiro(l.saldo)];
    let x = M;
    COLS.forEach(([, w, a], c) => {
      escrever(vals[c], x + 5, y + 4, { f: c === 6 || c === 0 ? negrito : fonte, tam: 7.8,
        cor: vals[c] === "—" ? COR.claro : c === 4 ? COR.verde : COR.texto, alinhar: a === "dir" ? "dir" : "esq", largura: w - 10 });
      x += w;
    });
    y += 16;
  });
  espaco(20);
  ret(M, y, UTIL, 18, COR.laranjaSuave);
  let x = M;
  const tot = ["Total", fmt.dinheiro(r.linhas.reduce((s, l) => s + l.custoA, 0)), fmt.dinheiro(r.linhas.reduce((s, l) => s + l.custoB, 0)),
    sinal(r.totalDif), sinal(r.linhas.reduce((s, l) => s + l.pagamentos, 0)), sinal(r.totalJuros), fmt.dinheiro(r.saldo)];
  COLS.forEach(([, w, a], c) => {
    escrever(tot[c], x + 5, y + 5, { f: negrito, tam: 8, cor: c === 6 ? COR.laranjaForte : COR.texto, alinhar: a === "dir" ? "dir" : "esq", largura: w - 10 });
    x += w;
  });
  y += 22;
  if (r.linhas.some((l) => !l.fechado)) { escrever("* Mês em andamento: os valores ainda podem mudar e só passam a render juros depois que o mês fechar.", M, y, { tam: 7.3, cor: COR.claro }); y += 14; }

  // ----------------------------- Pagamentos -----------------------------
  espaco(70);
  y += 4;
  escrever("Pagamentos entre os sócios", M, y, { f: negrito, tam: 11, cor: COR.preto }); y += 16;
  if (!pagamentos.length) {
    escrever(inicio ? `Nenhum pagamento registrado até esta data. Início previsto: ${nomeMes(inicio).toLowerCase()}.` : "Nenhum pagamento registrado até esta data.",
      M, y, { tam: 8.5, cor: COR.cinza });
    y += 22;
  } else {
    const nome = (id) => (id === A.id ? A.nome : id === B.id ? B.nome : `#${id}`);
    linhaH(y, M, LARG - M, COR.linha);
    pagamentos.forEach((p, i) => {
      const alt = p.observacoes ? 38 : 28;          // mais respiro entre os itens
      if (espaco(alt + 4)) {
        escrever("Pagamentos entre os sócios (continuação)", M, y, { f: negrito, tam: 11, cor: COR.preto }); y += 16;
        linhaH(y, M, LARG - M, COR.linha);
      }
      if (i % 2) ret(M, y, UTIL, alt, rgb(0.982, 0.983, 0.986));
      const meio = y + alt / 2;                      // centro vertical do item
      const topoTexto = p.observacoes ? meio - 11 : meio - 5;
      pagina.drawCircle({ x: M + 12, y: ALT - meio, size: 9, color: COR.laranjaSuave });
      escrever(String(i + 1), M + 3, meio - 4, { f: negrito, tam: 8, cor: COR.laranjaForte, alinhar: "centro", largura: 18 });
      escrever(fmt.data(p.data), M + 32, topoTexto, { f: negrito, tam: 9.5, cor: COR.preto });
      escrever(`${nome(p.de_pagador_id)} pagou a ${nome(p.para_pagador_id)}`, M + 108, topoTexto, { tam: 9.5, cor: COR.texto });
      if (p.observacoes) escrever(p.observacoes, M + 108, topoTexto + 13.5, { tam: 8, cor: COR.cinza });
      escrever(fmt.dinheiro(p.valor_centavos), LARG - M - 150, meio - 5.5, { f: negrito, tam: 11, cor: COR.verde, alinhar: "dir", largura: 140 });
      y += alt;
      linhaH(y, M, LARG - M, rgb(0.91, 0.915, 0.92));
    });
    y += 10;
    escrever(`Total pago por ${B.nome}`, LARG - M - 360, y, { tam: 9, cor: COR.cinza, alinhar: "dir", largura: 210 });
    escrever(fmt.dinheiro(r.totalPagoBA), LARG - M - 140, y - 1, { f: negrito, tam: 11, cor: COR.verde, alinhar: "dir", largura: 140 });
    if (r.totalPagoAB) {
      y += 15;
      escrever(`Total pago por ${A.nome}`, LARG - M - 360, y, { tam: 9, cor: COR.cinza, alinhar: "dir", largura: 210 });
      escrever(fmt.dinheiro(r.totalPagoAB), LARG - M - 140, y - 1, { f: negrito, tam: 11, cor: COR.verde, alinhar: "dir", largura: 140 });
    }
    y += 12;
  }

  // ----------------------------- Assinaturas -----------------------------
  // Bloco sempre inteiro na mesma página, com espaço confortável para assinar à mão.
  const ALT_ASSINATURA = 18 + 12 + 62 + 30;
  if (y + ALT_ASSINATURA > ALT - M - 26) novaPagina(); else y += 18;
  escrever(`Estamos de acordo com a posição acima, em ${fmt.data(hoje)}.`, M, y, { tam: 8.5, cor: COR.cinza });
  y += 12 + 62;                                  // espaço livre para a assinatura
  const larg = (UTIL - 40) / 2;
  [[A.nome, M], [B.nome, M + larg + 40]].forEach(([n, xx]) => {
    pagina.drawLine({ start: { x: xx, y: ALT - y }, end: { x: xx + larg, y: ALT - y }, thickness: 0.8, color: COR.texto });
    escrever(n, xx, y + 6, { f: negrito, tam: 9, alinhar: "centro", largura: larg });
    escrever("Sócio", xx, y + 18, { tam: 7.5, cor: COR.cinza, alinhar: "centro", largura: larg });
  });
  y += 30;

  // Rodapé
  const paginas = doc.getPages();
  paginas.forEach((p, i) => {
    pagina = p;
    linhaH(ALT - M - 12);
    escrever(`Boom Games · Acerto entre sócios · posição em ${fmt.data(hoje)} · juros de ${pct(taxa)} ao mês`, M, ALT - M - 8, { tam: 7, cor: COR.claro });
    escrever(`Emitido em ${fmt.dataHora(emitido.toISOString())} por ${perfil?.nome || "—"}  ·  Página ${i + 1} de ${paginas.length}`,
      LARG - M - 300, ALT - M - 8, { tam: 7, cor: COR.claro, alinhar: "dir", largura: 300 });
  });

  const bytes = await doc.save();
  const nomeArquivo = `BoomGames_AcertoSocios_${hoje}.pdf`;
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  if (baixar) {
    const a = document.createElement("a");
    a.href = url; a.download = nomeArquivo;
    document.body.append(a); a.click(); a.remove();
  }
  return { nomeArquivo, bytes, url };
}
