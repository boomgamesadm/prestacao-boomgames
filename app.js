import { sb, carregarPerfil, esc, ICONES, NOMES_PERFIL, mensagemErro } from "./comum.js";

// ---------- Quem está logado ----------
let perfil;
try {
  perfil = await carregarPerfil();
} catch (e) {
  document.getElementById("conteudo").innerHTML = `<p class="aviso aviso-erro">${esc(mensagemErro(e))}</p>`;
  throw e;
}
if (!perfil || !perfil.ativo || perfil.trocar_senha) {
  location.replace("index.html");
  throw new Error("sem acesso");
}
const eAdmin = perfil.perfil === "administrador";
const podeEditar = eAdmin || perfil.perfil === "editor";

// ---------- Páginas ----------
// "pronta: false" = chega numa próxima etapa (mostra aviso honesto, sem botões falsos)
const PAGINAS = [
  { grupo: 1, rota: "painel",      nome: "Painel",               icone: "painel",     pronta: false, etapa: 4 },
  { grupo: 1, rota: "prestacoes",  nome: "Prestações mensais",   icone: "calendario", pronta: false, etapa: 4 },
  { grupo: 1, rota: "lancamentos", nome: "Lançamentos",          icone: "lista",      pronta: true },
  { grupo: 1, rota: "contas",      nome: "Contas a pagar",       icone: "boleto",     pronta: true },
  { grupo: 1, rota: "documentos",  nome: "Documentos",           icone: "documento",  pronta: true },
  { grupo: 1, rota: "relatorios",  nome: "Relatórios PDF",       icone: "pdf",        pronta: false, etapa: 4 },
  { grupo: 2, rota: "historico",   nome: "Histórico de alterações", icone: "historico", pronta: false, etapa: 5, so: "admin" },
  { grupo: 2, rota: "usuarios",    nome: "Usuários e permissões", icone: "usuarios",  pronta: true,  so: "admin" },
  { grupo: 2, rota: "configuracoes", nome: "Configurações",      icone: "config",     pronta: true, so: "admin" },
].filter((p) => !p.so || (p.so === "admin" && eAdmin));

// ---------- Menu ----------
const nav = document.getElementById("menu-itens");
for (const g of [1, 2]) {
  const itens = PAGINAS.filter((p) => p.grupo === g);
  if (!itens.length) continue;
  const div = document.createElement("div");
  div.className = "menu-grupo";
  div.innerHTML = itens.map((p) =>
    `<a class="menu-item" href="#/${p.rota}" data-rota="${p.rota}" title="${esc(p.nome)}">${ICONES[p.icone]}<span>${esc(p.nome)}</span></a>`
  ).join("");
  nav.append(div);
}
document.getElementById("menu-usuario").innerHTML =
  `<strong>${esc(perfil.nome)}</strong><span>${esc(NOMES_PERFIL[perfil.perfil])}</span>`;
document.getElementById("topo-usuario").innerHTML =
  `<span class="nome">${esc(perfil.nome)}</span><span class="selo selo-${perfil.perfil === "administrador" ? "admin" : perfil.perfil}">${esc(NOMES_PERFIL[perfil.perfil])}</span>`;

const sair = document.getElementById("sair");
sair.innerHTML = `${ICONES.sair}<span>Sair</span>`;
sair.title = "Sair";
sair.onclick = async () => { await sb.auth.signOut(); location.replace("index.html"); };

// Recolher / abrir menu (no celular vira gaveta)
const app = document.getElementById("app");
const botaoMenu = document.getElementById("recolher");
const celular = () => matchMedia("(max-width: 900px)").matches;
const atualizarIconeMenu = () => { botaoMenu.innerHTML = celular() ? ICONES.menu : ICONES.recolher; };
atualizarIconeMenu();
matchMedia("(max-width: 900px)").addEventListener("change", atualizarIconeMenu);
if (localStorage.getItem("bg_menu_recolhido") === "1") app.classList.add("recolhido");
botaoMenu.onclick = () => {
  if (celular()) return app.classList.toggle("menu-aberto");
  app.classList.toggle("recolhido");
  localStorage.setItem("bg_menu_recolhido", app.classList.contains("recolhido") ? "1" : "0");
};
document.getElementById("cobertura").onclick = () => app.classList.remove("menu-aberto");

// Sessão encerrada em outra aba → volta para a entrada
sb.auth.onAuthStateChange((evento) => { if (evento === "SIGNED_OUT") location.replace("index.html"); });

// ---------- Navegação ----------
const conteudo = document.getElementById("conteudo");
const contexto = { perfil, eAdmin, podeEditar };

async function abrir() {
  const rota = location.hash.replace(/^#\/?/, "").split("?")[0] || "lancamentos";
  const pagina = PAGINAS.find((p) => p.rota === rota) || PAGINAS.find((p) => p.rota === "lancamentos");
  document.getElementById("titulo-pagina").textContent = pagina.nome;
  document.title = `${pagina.nome} · Boom Games`;
  for (const a of nav.querySelectorAll(".menu-item")) {
    if (a.dataset.rota === pagina.rota) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  app.classList.remove("menu-aberto");
  conteudo.innerHTML = `<p class="carregando-pagina">Carregando…</p>`;
  try {
    const modulo = pagina.pronta
      ? await import(`./paginas/${pagina.rota}.js`)
      : await import("./paginas/em-breve.js");
    await modulo.render(conteudo, { ...contexto, pagina });
  } catch (e) {
    console.error(e);
    conteudo.innerHTML = `<p class="aviso aviso-erro">${esc(mensagemErro(e))}</p>`;
  }
}
addEventListener("hashchange", abrir);
abrir();
