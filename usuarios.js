import {
  sb, esc, fmt, ICONES, NOMES_PERFIL, abrirJanela, confirmar, toast,
  mensagemErro, chamarFuncaoUsuarios, validarSenha,
} from "../comum.js";

const DESCRICAO_PERFIL = {
  administrador: "Acesso total, inclusive usuários e configurações.",
  editor: "Cadastra e corrige lançamentos e anexa documentos.",
  leitor: "Só consulta e baixa o PDF do mês. Indicado para a contabilidade.",
};
const classeSelo = (p) => (p === "administrador" ? "admin" : p);

let raiz, eu;

export async function render(el, { perfil }) {
  raiz = el;
  eu = perfil;
  await desenhar();
}

async function desenhar() {
  const [{ data: usuarios, error }, { data: cfg }] = await Promise.all([
    sb.from("perfis").select("*").order("principal", { ascending: false }).order("nome"),
    sb.from("configuracoes").select("max_usuarios").single(),
  ]);
  if (error) throw error;

  const maximo = cfg?.max_usuarios ?? 5;
  const ativos = usuarios.filter((u) => u.ativo).length;
  const noLimite = ativos >= maximo;

  raiz.innerHTML = `
    <section class="painel">
      <div class="painel-cabeca">
        <h2 class="titulo">Equipe</h2>
        <span class="resumo num">${ativos} de ${maximo} contas ativas</span>
        <div class="acoes">
          <button class="botao botao-principal" type="button" id="novo" ${noLimite ? "disabled" : ""}>
            ${ICONES.mais}Cadastrar usuário
          </button>
        </div>
      </div>
      ${noLimite ? `<div class="painel-corpo" style="padding-bottom:0"><p class="aviso aviso-info">O limite de ${maximo} contas ativas foi atingido. Desative uma conta para cadastrar outra.</p></div>` : ""}
      <div class="tabela-rolagem">
        <table class="tabela">
          <thead>
            <tr>
              <th>Usuário</th><th>Perfil</th><th>Situação</th><th>Último acesso</th>
              <th class="direita"><span class="sr">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            ${usuarios.map(linha).join("")}
          </tbody>
        </table>
      </div>
    </section>`;

  raiz.querySelector("#novo").onclick = janelaCadastro;
  raiz.querySelectorAll("[data-acao]").forEach((b) => {
    const u = usuarios.find((x) => x.id === b.dataset.id);
    b.onclick = () => ({
      editar: janelaEditar,
      senha: redefinirSenha,
      ativar: alternarAtivo,
      minha_senha: janelaMinhaSenha,
    })[b.dataset.acao](u);
  });
}

function linha(u) {
  const souEu = u.id === eu.id;
  let acoes = "";
  if (souEu) {
    acoes = `<button class="botao botao-texto botao-acao" data-acao="minha_senha" data-id="${u.id}">Trocar senha</button>`;
  } else if (!u.principal) {
    acoes = `
      ${u.ativo ? `<button class="botao botao-texto botao-acao" data-acao="editar" data-id="${u.id}">Editar</button>
      <button class="botao botao-texto botao-acao" data-acao="senha" data-id="${u.id}" title="Gerar nova senha temporária">Nova senha</button>` : ""}
      <button class="botao botao-texto botao-acao" data-acao="ativar" data-id="${u.id}">${u.ativo ? "Desativar" : "Reativar"}</button>`;
  }
  return `
    <tr class="${u.ativo ? "" : "inativo"}">
      <td class="celula-usuario">
        <strong>${esc(u.nome)}</strong>${souEu ? ' <span class="sec">(você)</span>' : ""}
        <div class="sec">${esc(u.email)}</div>
        ${u.principal ? '<div class="marca-principal">Administrador principal</div>' : ""}
      </td>
      <td><span class="selo selo-${classeSelo(u.perfil)}">${esc(NOMES_PERFIL[u.perfil])}</span></td>
      <td>${
        !u.ativo ? '<span class="selo selo-off">Desativado</span>'
        : u.trocar_senha ? '<span class="selo selo-alerta">Aguardando 1º acesso</span>'
        : '<span class="selo selo-ok">Ativo</span>'}
      </td>
      <td class="sec num sem-quebra">${u.ultimo_acesso ? fmt.dataHora(u.ultimo_acesso) : "Nunca entrou"}</td>
      <td><div class="tabela-acoes">${acoes}</div></td>
    </tr>`;
}

// ---------- Formulário de perfil (usado no cadastro e na edição) ----------
function camposPerfil(u = { perfil: "leitor", pode_conferir: true, pode_cancelar: false }) {
  return `
    <div class="campo">
      <span class="rotulo">Perfil de acesso</span>
      <div class="opcoes-perfil" role="radiogroup">
        ${["leitor", "editor", "administrador"].map((p) => `
          <label class="opcao-perfil">
            <input type="radio" name="perfil" value="${p}" ${u.perfil === p ? "checked" : ""}>
            <div><strong>${NOMES_PERFIL[p]}</strong><span>${DESCRICAO_PERFIL[p]}</span></div>
          </label>`).join("")}
      </div>
      <div class="permissoes-editor ${u.perfil === "editor" ? "" : "oculto"}" id="perm-editor">
        <label class="marcar"><input type="checkbox" id="pode_conferir" ${u.pode_conferir ? "checked" : ""}>
          Pode marcar lançamentos como conferidos ou com divergência</label>
        <label class="marcar"><input type="checkbox" id="pode_cancelar" ${u.pode_cancelar ? "checked" : ""}>
          Pode cancelar lançamentos</label>
      </div>
    </div>`;
}
function ligarPerfil(janela) {
  const el = janela.elemento;
  el.querySelectorAll('input[name="perfil"]').forEach((r) => {
    r.onchange = () => el.querySelector("#perm-editor").classList.toggle("oculto", r.value !== "editor" || !r.checked);
  });
}
function lerPerfil(el) {
  return {
    perfil: el.querySelector('input[name="perfil"]:checked')?.value,
    pode_conferir: el.querySelector("#pode_conferir").checked,
    pode_cancelar: el.querySelector("#pode_cancelar").checked,
  };
}
function erroNaJanela(el, texto) {
  let a = el.querySelector(".aviso-erro");
  if (!a) {
    a = document.createElement("p");
    a.className = "aviso aviso-erro";
    a.setAttribute("role", "alert");
    el.querySelector(".janela-corpo").prepend(a);
  }
  a.textContent = texto;
}

// ---------- Cadastrar ----------
function janelaCadastro() {
  abrirJanela({
    titulo: "Cadastrar usuário",
    corpo: `
      <div class="campo"><label for="u-nome">Nome</label>
        <input class="entrada" id="u-nome" autocomplete="off" maxlength="80"></div>
      <div class="campo"><label for="u-email">E-mail</label>
        <input class="entrada" id="u-email" type="email" autocomplete="off" maxlength="120"></div>
      ${camposPerfil()}`,
    aoAbrir: ligarPerfil,
    acoes: [
      { texto: "Cancelar" },
      {
        texto: "Cadastrar",
        classe: "botao-principal",
        aoClicar: async (j) => {
          const el = j.elemento;
          const nome = el.querySelector("#u-nome").value.trim();
          const email = el.querySelector("#u-email").value.trim();
          if (nome.length < 2) { erroNaJanela(el, "Informe o nome."); return false; }
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { erroNaJanela(el, "Informe um e-mail válido."); return false; }
          try {
            const r = await chamarFuncaoUsuarios({ acao: "criar", nome, email, ...lerPerfil(el) });
            j.fechar();
            mostrarSenha({ titulo: "Usuário cadastrado", nome, email, senha: r.senha_temporaria });
            await desenhar();
          } catch (e) {
            erroNaJanela(el, mensagemErro(e));
          }
          return false;
        },
      },
    ],
  });
}

// ---------- Senha temporária (mostrada uma única vez) ----------
function mostrarSenha({ titulo, nome, email, senha }) {
  const endereco = new URL("index.html", location.href).href;
  const mensagem =
    `Olá, ${nome}! Seu acesso à Prestação de Contas da Boom Games:\n` +
    `Endereço: ${endereco}\nE-mail: ${email}\nSenha temporária: ${senha}\n` +
    `No primeiro acesso, o sistema vai pedir para você criar a sua própria senha.`;
  abrirJanela({
    titulo,
    corpo: `
      <p>Senha temporária de <strong>${esc(nome)}</strong>. Ela aparece só agora; copie antes de fechar.</p>
      <div class="senha-caixa"><code>${esc(senha)}</code></div>
      <p>No primeiro acesso, ${esc(nome)} vai criar a própria senha. Envie a mensagem abaixo por WhatsApp ou e-mail:</p>
      <textarea class="entrada" rows="7" readonly id="msg-acesso">${esc(mensagem)}</textarea>`,
    acoes: [
      {
        texto: "Copiar mensagem",
        classe: "botao-secundario",
        aoClicar: async () => {
          try { await navigator.clipboard.writeText(mensagem); toast("Mensagem copiada.", "ok"); }
          catch { document.getElementById("msg-acesso").select(); toast("Selecione o texto e copie com Ctrl+C."); }
          return false;
        },
      },
      { texto: "Concluir", classe: "botao-principal" },
    ],
  });
}

// ---------- Editar perfil ----------
function janelaEditar(u) {
  abrirJanela({
    titulo: `Editar ${u.nome}`,
    corpo: `<p>${esc(u.email)}</p>${camposPerfil(u)}`,
    aoAbrir: ligarPerfil,
    acoes: [
      { texto: "Cancelar" },
      {
        texto: "Salvar alterações",
        classe: "botao-principal",
        aoClicar: async (j) => {
          const dados = lerPerfil(j.elemento);
          const { error } = await sb.from("perfis").update(dados).eq("id", u.id);
          if (error) { erroNaJanela(j.elemento, mensagemErro(error)); return false; }
          toast("Alterações salvas.", "ok");
          await desenhar();
        },
      },
    ],
  });
}

// ---------- Redefinir senha de outra pessoa ----------
async function redefinirSenha(u) {
  const ok = await confirmar({
    titulo: "Redefinir senha",
    texto: `Gerar uma nova senha temporária para ${u.nome}? A senha atual deixa de funcionar na hora.`,
    botao: "Gerar nova senha",
  });
  if (!ok) return;
  try {
    const r = await chamarFuncaoUsuarios({ acao: "redefinir_senha", id: u.id });
    mostrarSenha({ titulo: "Nova senha temporária", nome: u.nome, email: u.email, senha: r.senha_temporaria });
    await desenhar();
  } catch (e) {
    toast(mensagemErro(e), "erro");
  }
}

// ---------- Ativar / desativar ----------
async function alternarAtivo(u) {
  const desativar = u.ativo;
  const ok = await confirmar({
    titulo: desativar ? "Desativar conta" : "Reativar conta",
    texto: desativar
      ? `${u.nome} não vai mais conseguir entrar. O histórico de tudo o que essa pessoa fez continua guardado.`
      : `${u.nome} volta a ter acesso com o mesmo perfil de antes.`,
    botao: desativar ? "Desativar" : "Reativar",
    perigo: desativar,
  });
  if (!ok) return;
  try {
    await chamarFuncaoUsuarios({ acao: "definir_ativo", id: u.id, ativo: !desativar });
    toast(desativar ? "Conta desativada." : "Conta reativada.", "ok");
    await desenhar();
  } catch (e) {
    toast(mensagemErro(e), "erro");
  }
}

// ---------- Trocar a própria senha ----------
function janelaMinhaSenha() {
  abrirJanela({
    titulo: "Trocar minha senha",
    corpo: `
      <div class="campo"><label for="s1">Nova senha</label>
        <input class="entrada" id="s1" type="password" autocomplete="new-password">
        <p class="ajuda">Pelo menos 10 caracteres, com letras e números.</p></div>
      <div class="campo"><label for="s2">Repita a nova senha</label>
        <input class="entrada" id="s2" type="password" autocomplete="new-password"></div>`,
    acoes: [
      { texto: "Cancelar" },
      {
        texto: "Salvar nova senha",
        classe: "botao-principal",
        aoClicar: async (j) => {
          const el = j.elemento;
          const problema = validarSenha(el.querySelector("#s1").value, el.querySelector("#s2").value);
          if (problema) { erroNaJanela(el, problema); return false; }
          const { error } = await sb.auth.updateUser({ password: el.querySelector("#s1").value });
          if (error) { erroNaJanela(el, mensagemErro(error)); return false; }
          toast("Senha alterada.", "ok");
        },
      },
    ],
  });
}
