// =====================================================================
// PDF do faturamento da loja (A4 em pé) — para apresentar à fiscalização
// =====================================================================
import { sb, fmt, nomeMes } from "./comum.js";
import { carregarPdfLib, limpo } from "./pdf-prestacao.js";

const FORMAS = [["dinheiro", "Dinheiro"], ["pix", "PIX"], ["debito", "Cartão de débito"], ["credito", "Cartão de crédito"], ["outros", "Outros"]];
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export async function gerarPDFFaturamento({ mes, linhas, perfil, baixar = true }) {
  const PDFLib = await carregarPdfLib();
  const [{ data: cfg }, logoBytes] = await Promise.all([
    sb.from("configuracoes").select("*").single(),
    fetch(document.querySelector(".menu-logo img, img[alt^='Boom Games']")?.src || "logo-boomgames-web.png").then((r) => r.arrayBuffer()).catch(() => null),
  ]);
  const dados = [...linhas].sort((a, b) => a.data.localeCompare(b.data));
  const total = dados.reduce((s, d) => s + d.total_centavos, 0);
  const porForma = FORMAS.map(([k, n]) => [k, n, dados.reduce((s, d) => s + (d[`${k}_centavos`] || 0), 0)]);
  const comMov = dados.filter((d) => d.total_centavos > 0);
  const maior = comMov.reduce((m, d) => (!m || d.total_centavos > m.total_centavos ? d : m), null);
  const [ano, m] = mes.split("-").map(Number);
  const nDias = new Date(ano, m, 0).getDate();
  const emitido = new Date();

  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  doc.setTitle(`Faturamento - ${nomeMes(mes)} - Boom Games`);
  doc.setAuthor(cfg?.empresa_razao_social || "Boom Games");
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = logoBytes ? await doc.embedPng(logoBytes).catch(() => null) : null;

  const LARG = 595.28, ALT = 841.89, M = 36, UTIL = LARG - 2 * M;
  const COR = {
    preto: rgb(0, 0, 0), texto: rgb(0.1, 0.1, 0.1), cinza: rgb(0.36, 0.37, 0.4), claro: rgb(0.55, 0.56, 0.58),
    linha: rgb(0.86, 0.87, 0.88), zebra: rgb(0.965, 0.967, 0.972), laranja: rgb(1, 0.329, 0), verde: rgb(0.09, 0.46, 0.29),
    verdeClaro: rgb(0.18, 0.62, 0.42),
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
  const linhaH = (topo, x1 = M, x2 = LARG - M, cor = COR.linha) =>
    pagina.drawLine({ start: { x: x1, y: ALT - topo }, end: { x: x2, y: ALT - topo }, thickness: 0.6, color: cor });

  function novaPagina() {
    pagina = doc.addPage([LARG, ALT]);
    let x = M;
    if (logo) {
      const h = 38, w = (logo.width / logo.height) * h;
      pagina.drawImage(logo, { x: M, y: ALT - M - h, width: w, height: h });
      x = M + w + 14;
    }
    escrever("Relatório de Faturamento", x, M + 2, { f: negrito, tam: 16, cor: COR.preto });
    escrever(nomeMes(mes), x, M + 22, { tam: 11, cor: COR.cinza });
    const d = 220;
    const empresa = [cfg?.empresa_razao_social, cfg?.empresa_cnpj ? `CNPJ ${cfg.empresa_cnpj}` : null, cfg?.empresa_endereco].filter(Boolean);
    empresa.forEach((t, i) => escrever(t, LARG - M - d, M + 2 + i * 11, { f: i ? fonte : negrito, tam: i ? 7.5 : 8.5, cor: i ? COR.cinza : COR.texto, alinhar: "dir", largura: d }));
    pagina.drawRectangle({ x: M, y: ALT - M - 50, width: UTIL, height: 2.2, color: COR.laranja });
    y = M + 64;
  }
  const espaco = (h) => { if (y + h > ALT - M - 26) { novaPagina(); return true; } return false; };

  // ---------------------------- Resumo ----------------------------
  novaPagina();
  const caixas = [
    ["Faturamento bruto do mês", fmt.dinheiro(total), "Soma de todas as formas"],
    ["Dias com movimento", String(comMov.length), `de ${nDias} dias no mês`],
    ["Média por dia", fmt.dinheiro(comMov.length ? Math.round(total / comMov.length) : 0), "Dias com movimento"],
    ["Maior dia", maior ? fmt.dinheiro(maior.total_centavos) : "—", maior ? `${fmt.data(maior.data)}, ${DIAS[new Date(maior.data + "T12:00:00").getDay()]}` : ""],
  ];
  const cw = UTIL / caixas.length;
  ret(M, y, UTIL, 52, rgb(1, 1, 1), COR.linha);
  caixas.forEach(([rot, val, sub], i) => {
    const x = M + i * cw;
    if (i) pagina.drawLine({ start: { x, y: ALT - y }, end: { x, y: ALT - y - 52 }, thickness: 0.6, color: COR.linha });
    escrever(rot, x + 9, y + 8, { tam: 7.5, cor: COR.cinza });
    escrever(val, x + 9, y + 20, { f: negrito, tam: i === 0 ? 13.5 : 12, cor: i === 0 ? COR.verde : COR.preto });
    escrever(sub, x + 9, y + 38, { tam: 6.8, cor: COR.claro });
  });
  y += 70;

  // ------------------------ Por forma de recebimento ------------------------
  escrever("Por forma de recebimento", M, y, { f: negrito, tam: 11, cor: COR.preto }); y += 18;
  for (const [, n, v] of porForma) {
    const pct = total ? v / total : 0;
    escrever(n, M, y + 2, { tam: 9 });
    ret(M + 110, y + 2, 250, 8, COR.zebra);
    if (v) ret(M + 110, y + 2, Math.max(1.5, 250 * pct), 8, COR.verdeClaro);
    escrever(`${Math.round(pct * 100)}%`, M + 368, y + 2, { tam: 8.5, cor: COR.cinza });
    escrever(fmt.dinheiro(v), LARG - M - 120, y + 2, { f: negrito, tam: 9, alinhar: "dir", largura: 120 });
    y += 17;
  }
  linhaH(y + 2); y += 8;
  escrever("Total", M, y + 2, { f: negrito, tam: 9.5 });
  escrever(fmt.dinheiro(total), LARG - M - 120, y + 2, { f: negrito, tam: 9.5, cor: COR.verde, alinhar: "dir", largura: 120 });
  y += 30;

  // ---------------------------- Gráfico diário ----------------------------
  escrever("Faturamento por dia", M, y, { f: negrito, tam: 11, cor: COR.preto }); y += 18;
  const gH = 120, gTop = y, porDia = new Map(dados.map((d) => [Number(d.data.slice(8, 10)), d.total_centavos]));
  const max = Math.max(1, ...dados.map((d) => d.total_centavos));
  const eixoX = M + 54, gW = UTIL - 54, passo = gW / nDias, bw = Math.max(2, passo * 0.62);
  for (const f of [0, 0.5, 1]) {
    const yy = gTop + gH - gH * f;
    linhaH(yy, eixoX, LARG - M, f ? COR.linha : COR.claro);
    escrever(fmt.dinheiro(Math.round(max * f)).replace(/,\d\d$/, ""), M, yy - 4, { tam: 6.5, cor: COR.claro, alinhar: "dir", largura: 48 });
  }
  for (let d = 1; d <= nDias; d++) {
    const v = porDia.get(d) || 0, h = (v / max) * gH, x = eixoX + (d - 1) * passo + (passo - bw) / 2;
    if (v) pagina.drawRectangle({ x, y: ALT - gTop - gH, width: bw, height: h, color: COR.verdeClaro });
    if (d === 1 || d % 5 === 0) escrever(String(d), eixoX + (d - 1) * passo, gTop + gH + 4, { tam: 6.5, cor: COR.claro, alinhar: "centro", largura: passo });
  }
  y = gTop + gH + 26;

  // ---------------------------- Tabela diária ----------------------------
  const COLS = [["Data", 58, "esq"], ["Dia", 50, "esq"], ["Dinheiro", 66, "dir"], ["PIX", 66, "dir"], ["Débito", 66, "dir"],
    ["Crédito", 66, "dir"], ["Outros", 58, "dir"], ["Total do dia", UTIL - 430, "dir"]];
  const cabecalho = () => {
    ret(M, y, UTIL, 17, COR.preto);
    let x = M;
    for (const [t, w, a] of COLS) { escrever(t, x + 5, y + 5, { f: negrito, tam: 7.5, cor: rgb(1, 1, 1), alinhar: a === "dir" ? "dir" : "esq", largura: w - 10 }); x += w; }
    y += 17;
  };
  espaco(80);
  escrever("Movimento diário", M, y, { f: negrito, tam: 11, cor: COR.preto }); y += 17;
  cabecalho();
  dados.forEach((d, i) => {
    if (espaco(16)) cabecalho();
    if (i % 2) ret(M, y, UTIL, 16, COR.zebra);
    const vals = [fmt.data(d.data), DIAS[new Date(d.data + "T12:00:00").getDay()],
      ...FORMAS.map(([k]) => (d[`${k}_centavos`] ? fmt.dinheiro(d[`${k}_centavos`]) : "—")), fmt.dinheiro(d.total_centavos)];
    let x = M;
    COLS.forEach(([, w, a], c) => {
      escrever(vals[c], x + 5, y + 4.5, { f: c === 7 ? negrito : fonte, tam: 8, cor: vals[c] === "—" ? COR.claro : COR.texto, alinhar: a === "dir" ? "dir" : "esq", largura: w - 10 });
      x += w;
    });
    y += 16;
  });
  espaco(22);
  ret(M, y, UTIL, 19, rgb(0.93, 0.97, 0.94));
  let x = M;
  const tot = ["Total do mês", "", ...porForma.map(([, , v]) => fmt.dinheiro(v)), fmt.dinheiro(total)];
  COLS.forEach(([, w, a], c) => {
    escrever(tot[c], x + 5, y + 5.5, { f: negrito, tam: 8.2, cor: c === 7 ? COR.verde : COR.texto, alinhar: a === "dir" ? "dir" : "esq", largura: w - 10 });
    x += w;
  });
  y += 30;

  // Observações dos dias
  const obs = dados.filter((d) => d.observacoes || d.outros_descricao);
  if (obs.length) {
    espaco(40);
    escrever("Observações", M, y, { f: negrito, tam: 10, cor: COR.preto }); y += 15;
    for (const d of obs) {
      espaco(12);
      escrever(`${fmt.data(d.data)}: ${[d.outros_descricao ? `Outros = ${d.outros_descricao}` : "", d.observacoes || ""].filter(Boolean).join(". ")}`, M, y, { tam: 8, cor: COR.cinza });
      y += 12;
    }
  }

  // Rodapé
  const paginas = doc.getPages();
  paginas.forEach((p, i) => {
    pagina = p;
    linhaH(ALT - M - 12);
    escrever(`Valores brutos de vendas informados pela ${cfg?.empresa_razao_social || "Boom Games"} · ${nomeMes(mes)}`, M, ALT - M - 8, { tam: 7, cor: COR.claro });
    escrever(`Emitido em ${fmt.dataHora(emitido.toISOString())} por ${perfil?.nome || "—"}  ·  Página ${i + 1} de ${paginas.length}`,
      LARG - M - 300, ALT - M - 8, { tam: 7, cor: COR.claro, alinhar: "dir", largura: 300 });
  });

  const bytes = await doc.save();
  const nomeArquivo = `BoomGames_Faturamento_${mes.slice(0, 7)}.pdf`;
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  if (baixar) {
    const a = document.createElement("a");
    a.href = url; a.download = nomeArquivo;
    document.body.append(a); a.click(); a.remove();
  }
  return { nomeArquivo, bytes, url };
}
