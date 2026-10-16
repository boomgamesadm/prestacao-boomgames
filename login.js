import { sb, carregarPerfil, mensagemErro, validarSenha, esc } from "./comum.js";

const $ = (id) => document.getElementById(id);
const ETAPAS = ["entrar", "trocar", "esqueci"];

function mostrar(etapa) {
  for (const e of ETAPAS) $(`etapa-${e}`).classList.toggle("oculto", e !== etapa);
  $(`etapa-${etapa}`).querySelector("input")?.focus();
}
function aviso(etapa, texto, tipo = "erro") {
  $(`aviso-${etapa}`).innerHTML = texto ? `<p class="aviso aviso-${tipo}">${esc(texto)}</p>` : "";
}
function ocupado(form, sim) {
  const b = form.querySelector("button[type=submit]");
  b.classList.toggle("carregando", sim);
  b.disabled = sim;
}

// Proteção extra no navegador: após 5 erros seguidos, espera 60 segundos.
// (O Supabase também limita tentativas no servidor.)
const TRAVA = "bg_login_trava";
function travado() {
  const t = JSON.parse(sessionStorage.getItem(TRAVA) || '{"erros":0,"ate":0}');
  return t.ate > Date.now() ? Math.ceil((t.ate - Date.now()) / 1000) : 0;
}
function registrarErro() {
  const t = JSON.parse(sessionStorage.getItem(TRAVA) || '{"erros":0,"ate":0}');
  t.erros += 1;
  if (t.erros >= 5) { t.ate = Date.now() + 60_000; t.erros = 0; }
  sessionStorage.setItem(TRAVA, JSON.stringify(t));
}

/** Decide para onde ir depois que existe uma sessão. */
async function seguir() {
  const perfil = await carregarPerfil();
  if (!perfil) {
    await sb.auth.signOut();
    aviso("entrar", "Esta conta ainda não tem acesso ao sistema. Fale com o administrador.");
    mostrar("entrar");
    return;
  }
  if (!perfil.ativo) {
    await sb.auth.signOut();
    aviso("entrar", "Esta conta está desativada. Fale com o administrador.");
    mostrar("entrar");
    return;
  }
  if (perfil.trocar_senha) {
    mostrar("trocar");
    return;
  }
  await sb.rpc("fn_registrar_acesso");
  location.replace("app.html");
}

$("form-entrar").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  aviso("entrar", "");
  const espera = travado();
  if (espera) return aviso("entrar", `Muitas tentativas. Tente de novo em ${espera} segundos.`);
  const email = $("email").value.trim();
  const senha = $("senha").value;
  if (!email || !senha) return aviso("entrar", "Preencha e-mail e senha.");
  ocupado(ev.target, true);
  try {
    const { error } = await sb.auth.signInWithPassword({ email, password: senha });
    if (error) { registrarErro(); throw error; }
    sessionStorage.removeItem(TRAVA);
    await seguir();
  } catch (e) {
    aviso("entrar", mensagemErro(e));
  } finally {
    ocupado(ev.target, false);
  }
});

$("form-trocar").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  aviso("trocar", "");
  const problema = validarSenha($("nova").value, $("nova2").value);
  if (problema) return aviso("trocar", problema);
  ocupado(ev.target, true);
  try {
    const { error } = await sb.auth.updateUser({ password: $("nova").value });
    if (error) throw error;
    const { error: e2 } = await sb.rpc("fn_senha_trocada");
    if (e2) throw e2;
    await seguir();
  } catch (e) {
    aviso("trocar", mensagemErro(e));
  } finally {
    ocupado(ev.target, false);
  }
});

$("form-esqueci").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const email = $("email-rec").value.trim();
  if (!email) return aviso("esqueci", "Informe o e-mail.");
  ocupado(ev.target, true);
  try {
    const destino = new URL("nova-senha.html", location.href).href;
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: destino });
    if (error) throw error;
    aviso("esqueci", "Se este e-mail estiver cadastrado, o link chega em alguns minutos. Confira também a caixa de spam.", "ok");
  } catch (e) {
    aviso("esqueci", mensagemErro(e));
  } finally {
    ocupado(ev.target, false);
  }
});

$("ir-esqueci").onclick = () => { $("email-rec").value = $("email").value; aviso("esqueci", ""); mostrar("esqueci"); };
$("voltar-entrar").onclick = () => mostrar("entrar");

// Já está logado? Vai direto.
const { data: { session } } = await sb.auth.getSession();
if (session) await seguir();
