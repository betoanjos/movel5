// Ponto de entrada: monta o layout, cuida da navegação e do login.
import { estado, iniciar, entrar, sair, aoMudar, usarModoLocal, usarModoNuvem,
         definirCompetencia, competenciasDisponiveis, modoNuvem,
         configurarPrimeiroAcesso } from './store.js';
import { el, icone, avisar, bloco } from './lib/ui.js';
import { labelCompetencia, esc } from './lib/util.js';

import { telaPainel } from './views/painel.js';
import { telaImportar } from './views/importar.js';
import { telaRevisar } from './views/revisar.js';
import { telaLancamentos } from './views/lancamentos.js';
import { telaFechamento } from './views/fechamento.js';
import { telaRelatorio } from './views/relatorio.js';
import { telaAjustes } from './views/ajustes.js';

const TELAS = {
  painel:      { nome: 'Painel',        icone: 'painel',     render: telaPainel,      titulo: 'Painel do mês' },
  importar:    { nome: 'Importar',      icone: 'importar',   render: telaImportar,    titulo: 'Importar arquivos' },
  revisar:     { nome: 'Revisar',       icone: 'revisar',    render: telaRevisar,     titulo: 'Revisar lançamentos' },
  lancamentos: { nome: 'Lançamentos',   icone: 'lista',      render: telaLancamentos, titulo: 'Todos os lançamentos' },
  fechamento:  { nome: 'Fechar o mês',  icone: 'fechar',     render: telaFechamento,  titulo: 'Fechamento do mês' },
  relatorio:   { nome: 'Relatório',     icone: 'relatorio',  render: telaRelatorio,   titulo: 'Relatório mensal' },
  ajustes:     { nome: 'Ajustes',       icone: 'ajustes',    render: telaAjustes,     titulo: 'Ajustes' },
};

const raiz = document.getElementById('raiz');
let telaAtual = 'painel';

/**
 * Logo da Móvel5. Vão as duas versões no HTML e o CSS mostra a que combina
 * com o tema — o texto da logo é escuro e sumiria no tema escuro.
 */
const logo = (largura) => `
  <img class="logo logo-claro" src="assets/logo.png" alt="Móvel5"
       width="${largura}" height="${Math.round(largura * 143 / 600)}">
  <img class="logo logo-escuro" src="assets/logo-escuro.png" alt="" aria-hidden="true"
       width="${largura}" height="${Math.round(largura * 143 / 600)}">`;

// ------------------------------------------------------------------ boot ---

(async function boot() {
  aplicarTemaSalvo();
  try {
    const { precisaLogin, precisaConfigurar } = await iniciar();
    if (precisaConfigurar) return montarPrimeiroAcesso();
    if (precisaLogin) return montarLogin();
    montarApp();
  } catch (e) {
    raiz.innerHTML = `<div style="padding:40px;max-width:620px;margin:0 auto">
      ${bloco('erro', `Não consegui iniciar o painel: ${esc(e.message)}`)}
      <p class="mini mudo" style="margin-top:12px">Recarregue a página. Se o problema continuar, seus dados continuam salvos — nada foi perdido.</p>
    </div>`;
  }
})();

function aplicarTemaSalvo() {
  const t = localStorage.getItem('movel5:tema');
  if (t) document.documentElement.dataset.tema = t;
}

// -------------------------------------------------------- primeiro acesso ---

/** Tela que aparece uma única vez, quando ainda não há nenhum usuário. */
function montarPrimeiroAcesso() {
  raiz.innerHTML = `
  <div class="entrada-login">
    <div class="caixa-login" style="max-width:460px">
      <div style="text-align:center;margin-bottom:22px">
        <div class="marca-login">${logo(168)}</div>
        <h1 style="font-size:1.25rem">Vamos criar os acessos</h1>
        <p class="secundario mini" style="margin-top:6px">
          Esta tela aparece só uma vez. Crie um acesso para cada pessoa que vai usar o painel.
        </p>
      </div>
      <form class="cartao" style="padding:22px" id="f-setup">
        <div id="pessoas"></div>
        <button type="button" class="btn btn-pequeno" id="add-pessoa" style="margin-bottom:14px">
          ${icone('mais', 14)} Adicionar outra pessoa</button>
        <div id="erro-setup"></div>
        <button class="btn btn-principal" style="width:100%" type="submit">Criar acessos e entrar</button>
      </form>
      <p class="centro mini mudo" style="margin-top:14px">
        Guarde as senhas: não há como recuperá-las depois, só redefinir pela linha de comando.
      </p>
    </div>
  </div>`;

  const pessoas = raiz.querySelector('#pessoas');
  const adicionar = (i) => {
    pessoas.appendChild(el(`
      <div style="padding-bottom:14px;margin-bottom:14px;border-bottom:1px solid var(--linha)">
        <div class="micro" style="margin-bottom:8px">Pessoa ${i + 1}</div>
        <label class="campo"><span class="campo-rotulo">Nome</span>
          <input name="nome" placeholder="ex.: Roberto" required></label>
        <label class="campo"><span class="campo-rotulo">Usuário</span>
          <input name="usuario" placeholder="ex.: roberto" autocapitalize="off" required></label>
        <label class="campo" style="margin-bottom:0"><span class="campo-rotulo">Senha</span>
          <input name="senha" type="password" minlength="8" placeholder="mínimo 8 caracteres" required></label>
      </div>`));
  };
  adicionar(0); adicionar(1);
  raiz.querySelector('#add-pessoa').onclick = () => adicionar(pessoas.children.length);

  raiz.querySelector('#f-setup').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    const caixaErro = raiz.querySelector('#erro-setup');
    const usuarios = [...pessoas.children].map((bloco) => ({
      nome: bloco.querySelector('[name=nome]').value.trim(),
      usuario: bloco.querySelector('[name=usuario]').value.trim().toLowerCase(),
      senha: bloco.querySelector('[name=senha]').value,
    })).filter((u) => u.usuario && u.senha);

    if (!usuarios.length) { caixaErro.innerHTML = bloco('erro', 'Preencha ao menos um acesso.'); return; }
    btn.disabled = true; btn.textContent = 'Criando…';
    try {
      await configurarPrimeiroAcesso(usuarios);
      montarApp();
    } catch (err) {
      caixaErro.innerHTML = bloco('erro', esc(err.message || 'Não consegui criar os acessos.'));
      btn.disabled = false; btn.textContent = 'Criar acessos e entrar';
    }
  };
}

// ----------------------------------------------------------------- login ---

function montarLogin() {
  raiz.innerHTML = `
  <div class="entrada-login">
    <div class="caixa-login">
      <div style="text-align:center;margin-bottom:22px">
        <div class="marca-login">${logo(168)}</div>
        <h1 style="font-size:1.1rem;font-weight:600">Financeiro</h1>
        <p class="secundario mini" style="margin-top:4px">Entre para ver e editar os lançamentos.</p>
      </div>
      <form class="cartao" style="padding:22px" id="f-login">
        <label class="campo"><span class="campo-rotulo">Usuário</span>
          <input name="usuario" autocomplete="username" required autofocus></label>
        <label class="campo"><span class="campo-rotulo">Senha</span>
          <input type="password" name="senha" autocomplete="current-password" required></label>
        <div id="erro-login"></div>
        <button class="btn btn-principal" style="width:100%;margin-top:6px" type="submit">Entrar</button>
      </form>
      <p class="centro mini mudo" style="margin-top:16px">
        Sem conta agora? <a href="#" id="ir-local">use o modo local neste navegador</a> —
        os dados ficam só neste computador.
      </p>
    </div>
  </div>`;

  raiz.querySelector('#ir-local').onclick = (e) => { e.preventDefault(); usarModoLocal(); };
  raiz.querySelector('#f-login').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    const caixaErro = raiz.querySelector('#erro-login');
    btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      await entrar(e.target.usuario.value.trim(), e.target.senha.value);
      montarApp();
    } catch (err) {
      caixaErro.innerHTML = bloco('erro', esc(err.message || 'Usuário ou senha incorretos.'));
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  };
}

// ------------------------------------------------------------------- app ---

function montarApp() {
  raiz.innerHTML = `
  <div id="app">
    <aside class="lateral">
      <div class="marca">
        ${logo(104)}
        <span class="marca-sub">Financeiro</span>
      </div>
      <nav class="nav" id="nav"></nav>
      <div class="lateral-pe" id="rodape-lateral"></div>
    </aside>
    <main class="principal">
      <header class="topo">
        <h1 id="titulo-tela">Painel</h1>
        <div class="linha-flex" id="acoes-topo"></div>
      </header>
      <div class="conteudo" id="conteudo"></div>
    </main>
  </div>`;

  desenharNav();
  desenharRodape();
  desenharAcoesTopo();

  addEventListener('hashchange', roteador);
  aoMudar(() => { desenharNav(); desenharAcoesTopo(); });
  roteador();
}

function roteador() {
  const alvo = (location.hash.replace('#/', '') || 'painel').split('?')[0];
  telaAtual = TELAS[alvo] ? alvo : 'painel';
  desenharNav();
  const tela = TELAS[telaAtual];
  document.getElementById('titulo-tela').textContent = tela.titulo;
  const conteudo = document.getElementById('conteudo');
  // Ajustes é a única tela que não depende do mês.
  const doMes = telaAtual !== 'ajustes';
  conteudo.innerHTML = `<div class="pensando">
    <span class="carregando"></span>
    <span>Montando ${esc(tela.titulo.toLowerCase())}${
      doMes ? ` de ${esc(labelCompetencia(estado.competencia))}` : ''}…</span>
  </div>`;
  scrollTo(0, 0);

  // Montar a tela é trabalho pesado e síncrono: percorre milhares de
  // lançamentos. Feito na mesma volta, o navegador nunca chega a desenhar o
  // "pensando" — a tela fica parada e parece travada. Dois quadros de espera
  // garantem que o aviso apareça antes de o trabalho começar.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    Promise.resolve(tela.render(conteudo, { ir })).catch((e) => {
      console.error(e);
      conteudo.innerHTML = bloco('erro', `Erro ao montar a tela: ${esc(e.message)}`);
    });
  }));
}

export function ir(tela, params = '') {
  location.hash = `#/${tela}${params}`;
  if ((location.hash.replace('#/', '').split('?')[0] || 'painel') === telaAtual) roteador();
}

function desenharNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const pendentes = estado.lancamentos.filter(
    (l) => l.competencia === estado.competencia && !l.travado &&
           (!l.categoria || l.confianca === 'baixa')
  ).length;

  nav.innerHTML = Object.entries(TELAS).map(([id, t]) => {
    const sep = id === 'ajustes' ? '<div class="nav-sep"></div>' : '';
    const badge = id === 'revisar' && pendentes ? `<span class="nav-badge">${pendentes}</span>` : '';
    return `${sep}<a class="nav-item" href="#/${id}"${id === telaAtual ? ' aria-current="page"' : ''}>
      ${icone(t.icone)}<span>${t.nome}</span>${badge}</a>`;
  }).join('');
}

function desenharRodape() {
  const pe = document.getElementById('rodape-lateral');
  if (!pe) return;
  const nuvem = modoNuvem();
  pe.innerHTML = `
    <div class="linha-flex mini" style="gap:6px;margin-bottom:8px">
      ${icone(nuvem ? 'nuvem' : 'banco', 14)}
      <span>${nuvem ? esc(estado.usuario?.nome || estado.usuario?.usuario || 'Conectado') : 'Modo local'}</span>
    </div>
    <div class="linha-flex" style="gap:6px">
      <button class="btn btn-sutil btn-pequeno" id="btn-tema">Tema</button>
      ${nuvem
        ? '<button class="btn btn-sutil btn-pequeno" id="btn-sair">Sair</button>'
        : '<button class="btn btn-sutil btn-pequeno" id="btn-nuvem">Entrar</button>'}
    </div>`;

  pe.querySelector('#btn-tema').onclick = () => {
    const atual = document.documentElement.dataset.tema;
    const proximo = atual === 'escuro' ? 'claro' : atual === 'claro' ? 'auto' : 'escuro';
    document.documentElement.dataset.tema = proximo;
    localStorage.setItem('movel5:tema', proximo);
    avisar(`Tema: ${{ escuro: 'escuro', claro: 'claro', auto: 'automático' }[proximo]}`);
    roteador();
  };
  pe.querySelector('#btn-sair')?.addEventListener('click', sair);
  pe.querySelector('#btn-nuvem')?.addEventListener('click', usarModoNuvem);
}

/** Seletor de mês, presente no topo de todas as telas que dependem dele. */
function desenharAcoesTopo() {
  const caixa = document.getElementById('acoes-topo');
  if (!caixa) return;
  const comps = competenciasDisponiveis();
  const atual = estado.competencia;
  const opcoes = comps.includes(atual) ? comps : [atual, ...comps];

  caixa.innerHTML = `
    <label class="linha-flex mini" style="gap:6px">
      <span class="micro">Mês</span>
      <select id="sel-competencia" style="width:auto;min-width:128px">
        ${opcoes.map((c) => `<option value="${c}"${c === atual ? ' selected' : ''}>${labelCompetencia(c)}</option>`).join('')}
      </select>
    </label>
    <button class="btn btn-pequeno" id="btn-mes-novo" title="Trabalhar em outro mês">${icone('mais', 14)}</button>`;

  caixa.querySelector('#sel-competencia').onchange = (e) => {
    // Sem esperar a gravação: o mês troca na hora e o painel já começa a
    // montar. Guardar qual mês ficou em foco é detalhe, corre por fora.
    definirCompetencia(e.target.value);
    roteador();
  };
  caixa.querySelector('#btn-mes-novo').onclick = async () => {
    const v = prompt('Qual mês você quer abrir? Use o formato AAAA-MM (por exemplo 2024-03).', estado.competencia);
    if (!v) return;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v.trim())) return avisar('Formato inválido. Use AAAA-MM.');
    definirCompetencia(v.trim());
    roteador();
  };
}

export { roteador };
