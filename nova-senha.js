import { sb, mensagemErro, validarSenha, esc } from "./comum.js";

const form = document.getElementById("form");
const avisoEl = document.getElementById("aviso");
const aviso = (t, tipo = "erro") => { avisoEl.innerHTML = t ? `<p class="aviso aviso-${tipo}">${esc(t)}</p>` : ""; };

// O link do e-mail traz a sessão de recuperação na própria URL;
// a biblioteca do Supabase lê isso sozinha ao carregar a página.
let liberado = false;
function liberar() {
  if (liberado) return;
  liberado = true;
  aviso("");
  form.classList.remove("oculto");
  document.getElementById("nova").focus();
}
sb.auth.onAuthStateChange((evento, sessao) => {
  if (evento === "PASSWORD_RECOVERY" || (sessao && evento === "SIGNED_IN")) liberar();
});
const { data: { session } } = await sb.auth.getSession();
if (session) liberar();
setTimeout(() => {
  if (!liberado) aviso("Este link é inválido ou já expirou. Peça um novo em “Esqueci minha senha”, na tela de entrada.");
}, 2500);

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const problema = validarSenha(document.getElementById("nova").value, document.getElementById("nova2").value);
  if (problema) return aviso(problema);
  const botao = form.querySelector("button");
  botao.classList.add("carregando");
  try {
    const { error } = await sb.auth.updateUser({ password: document.getElementById("nova").value });
    if (error) throw error;
    await sb.rpc("fn_senha_trocada");
    aviso("Senha alterada. Entrando…", "ok");
    setTimeout(() => location.replace("index.html"), 1200);
  } catch (e) {
    aviso(mensagemErro(e));
  } finally {
    botao.classList.remove("carregando");
  }
});
