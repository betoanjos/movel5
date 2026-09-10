// Ajustes: contas, categorias próprias, regras, contatos, backup e conta de acesso.
import { estado, salvar, remover, categorias, nomeCategoria, apagarTudo,
         exportarTudo, importarBackup, modoNuvem, getBackend } from '../store.js';
import { CATEGORIAS } from '../engine/seed.js';
import { recategorizar, reavaliarGateway } from '../engine/motor.js';
import { brl, esc, uid, download, brDate } from '../lib/util.js';
import { icone, bloco, avisar, liga, modal, vazio, selectCategorias } from '../lib/ui.js';

let aba = 'contas';

export function telaAjustes(raiz, ctx) { desenhar(raiz, ctx); }

function desenhar(raiz, ctx) {
  const abas = [
    ['contas', 'Contas'], ['categorias', 'Categorias'], ['regras', 'Regras automáticas'],
    ['contatos', 'Contatos'], ['dados', 'Backup e dados'], ['acesso', 'Acesso'],
  ];
  raiz.innerHTML = `
  <div class="pilha">
    <div class="cartao">
      <div class="cartao-cabeca" style="padding-bottom:0;border-bottom:none">
        <div class="abas" style="flex:1">
          ${abas.map(([k, r]) => `<button class="aba" data-aba="${k}" aria-selected="${aba === k}">${r}</button>`).join('')}
        </div>
      </div>
      <div class="cartao-corpo" id="painel-aba">${conteudo()}</div>
    </div>
  </div>`;

  liga(raiz, 'click', '[data-aba]', (e, alvo) => { aba = alvo.dataset.aba; desenhar(raiz, ctx); });
  ligarAcoes(raiz, () => desenhar(raiz, ctx));
}

const conteudo = () => ({
  contas: abaContas, categorias: abaCategorias, regras: abaRegras,
  contatos: abaContatos, dados: abaDados, acesso: abaAcesso,
}[aba]());

// ------------------------------------------------------------------ contas --

function abaContas() {
  return `
  <div class="linha-flex" style="margin-bottom:14px">
    <p class="mini secundario" style="flex:1;margin:0">
      Cada conta tem seu próprio saldo. O saldo inicial só é usado enquanto não houver
      um mês fechado antes — depois disso vale sempre o fechamento anterior.
    </p>
    <button class="btn btn-principal btn-pequeno" data-nova-conta>${icone('mais', 14)} Nova conta</button>
  </div>
  <div class="tabela-rolagem"><table class="tabela">
    <thead><tr><th>Conta</th><th>Tipo</th><th class="num">Saldo inicial</th>
      <th class="num">Lançamentos</th><th>Situação</th><th></th></tr></thead>
    <tbody>${estado.contas.map((c) => {
      const n = estado.lancamentos.filter((l) => l.conta_id === c.id).length;
      return `<tr>
        <td><span class="linha-flex" style="gap:8px">
          <span class="ponto" style="background:${esc(c.cor || 'var(--ink-3)')}"></span>
          <span class="forte">${esc(c.nome)}</span></span></td>
        <td class="mini secundario">${esc(rotuloTipo(c.tipo))}
          ${padrao(c, 'entra_no_caixa') ? '' : '<span class="selo" title="Não soma no saldo em caixa">passagem</span>'}</td>
        <td class="num">${brl(c.saldo_inicial || 0)}</td>
        <td class="num mudo">${n}</td>
        <td>${c.ativo === 0 ? '<span class="selo">arquivada</span>' : '<span class="selo selo-pos">ativa</span>'}</td>
        <td class="nowrap">
          <button class="btn btn-sutil btn-pequeno" data-editar-conta="${c.id}">${icone('lapis', 14)}</button>
          <button class="btn btn-sutil btn-pequeno" data-apagar-conta="${c.id}">${icone('lixo', 14)}</button>
        </td></tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

const rotuloTipo = (t) => ({
  banco: 'Conta bancária', gateway: 'Gateway de pagamento',
  marketplace: 'Conta de marketplace', caixa: 'Caixa / dinheiro',
}[t] || t);

// -------------------------------------------------------------- categorias --

function abaCategorias() {
  const grupos = new Map();
  for (const c of [...CATEGORIAS, ...estado.categorias]) {
    if (!grupos.has(c.grupo)) grupos.set(c.grupo, []);
    grupos.get(c.grupo).push(c);
  }
  const usoDe = (id) => estado.lancamentos.filter((l) => l.categoria === id).length;

  return `
  <div class="linha-flex" style="margin-bottom:14px">
    <p class="mini secundario" style="flex:1;margin:0">
      As categorias em cinza vêm prontas e não podem ser removidas. Crie as suas quando
      precisar de um detalhe que não existe aqui.
    </p>
    <button class="btn btn-principal btn-pequeno" data-nova-cat>${icone('mais', 14)} Nova categoria</button>
  </div>
  ${[...grupos].map(([g, itens]) => `
    <div style="margin-bottom:18px">
      <div class="micro" style="margin-bottom:6px">${esc(g)}</div>
      <div class="tabela-rolagem"><table class="tabela tabela-compacta">
        <tbody>${itens.map((c) => {
          const propria = estado.categorias.some((x) => x.id === c.id);
          return `<tr>
            <td>${esc(c.nome)} ${propria ? '<span class="selo selo-acento">sua</span>' : ''}</td>
            <td class="mini mudo">${esc(rotuloNatureza(c.natureza))}</td>
            <td class="num mini mudo">${usoDe(c.id)} lanç.</td>
            <td class="nowrap" style="width:70px">${propria
              ? `<button class="btn btn-sutil btn-pequeno" data-editar-cat="${c.id}">${icone('lapis', 14)}</button>
                 <button class="btn btn-sutil btn-pequeno" data-apagar-cat="${c.id}">${icone('lixo', 14)}</button>`
              : ''}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>`).join('')}`;
}

const rotuloNatureza = (n) => ({
  receita: 'entra e conta como resultado', despesa: 'sai e conta como resultado',
  transferencia: 'só move dinheiro entre contas', holding: 'conta corrente com os sócios',
  investimento: 'aplicação ou resgate', emprestimo: 'principal de empréstimo',
}[n] || n);

// ------------------------------------------------------------------ regras --

function abaRegras() {
  if (!estado.regras.length) {
    return `${bloco('info', `Ainda não há regras suas. Toda vez que você classificar um lançamento
      na tela de revisão e marcar <em>“vale para todas as parecidas”</em>, uma regra aparece aqui.`)}
      <div style="margin-top:14px">${vazio('Sem regras próprias',
        'As regras prontas já reconhecem impostos, energia, telefone, tarifas e os principais fornecedores.')}</div>`;
  }
  return `
  <div class="linha-flex" style="margin-bottom:14px">
    <p class="mini secundario" style="flex:1;margin:0">
      Suas regras valem antes de todas as outras e são aplicadas em cada importação.
    </p>
    <button class="btn btn-pequeno" data-reaplicar>${icone('raio', 14)} Reaplicar em tudo</button>
  </div>
  <div class="tabela-rolagem"><table class="tabela">
    <thead><tr><th>Quando encontrar</th><th>Aplica a</th><th>Categoria</th><th>Criada em</th><th></th></tr></thead>
    <tbody>${estado.regras.map((r) => `<tr>
      <td><code class="mini">${esc(r.padrao)}</code></td>
      <td class="mini secundario">${r.sinal === 'D' ? 'saídas' : r.sinal === 'C' ? 'entradas' : 'entradas e saídas'}</td>
      <td><span class="selo">${esc(nomeCategoria(r.categoria))}</span></td>
      <td class="mini mudo">${r.criada_em ? brDate(r.criada_em.slice(0, 10)) : '—'}</td>
      <td><button class="btn btn-sutil btn-pequeno" data-apagar-regra="${r.id}">${icone('lixo', 14)}</button></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

// ---------------------------------------------------------------- contatos --

function abaContatos() {
  const lista = [...estado.contrapartes].sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
  return `
  <p class="mini secundario">
    Este é o cadastro que faz o painel reconhecer sozinho quem recebeu ou pagou.
    Importe o relatório <em>“Clientes e Fornecedor — Visão de Contatos”</em> do Bling para
    preencher de uma vez, ou acrescente manualmente.
  </p>
  <div class="linha-flex" style="margin:12px 0">
    <span class="mini forte">${lista.length} contato(s) cadastrados</span>
    <span class="espaco"></span>
    <button class="btn btn-principal btn-pequeno" data-novo-contato>${icone('mais', 14)} Novo contato</button>
  </div>
  ${lista.length ? `<div class="tabela-rolagem" style="max-height:520px;overflow-y:auto">
    <table class="tabela tabela-compacta">
      <thead><tr><th>Nome</th><th>CNPJ / CPF</th><th>Tipo</th><th>Categoria automática</th><th></th></tr></thead>
      <tbody>${lista.slice(0, 400).map((c) => `<tr>
        <td class="mini">${esc(c.nome)}</td>
        <td class="mini mudo num">${esc(formatarDoc(c.documento))}</td>
        <td class="mini secundario">${esc(c.tipo || '—')}</td>
        <td class="mini">${c.categoriaSugerida ? `<span class="selo">${esc(nomeCategoria(c.categoriaSugerida))}</span>` : '—'}</td>
        <td><button class="btn btn-sutil btn-pequeno" data-editar-contato="${c.id}">${icone('lapis', 14)}</button></td>
      </tr>`).join('')}</tbody>
    </table>
    ${lista.length > 400 ? `<p class="mini mudo centro" style="padding:10px">Mostrando 400 de ${lista.length}.</p>` : ''}
  </div>` : vazio('Nenhum contato', 'Importe o relatório de contatos do Bling na tela de importação.')}`;
}

const formatarDoc = (d) => {
  const s = String(d || '').replace(/\D/g, '');
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return s || '—';
};

// ------------------------------------------------------------------- dados --

function abaDados() {
  const n = estado.lancamentos.length;
  const comps = [...new Set(estado.lancamentos.map((l) => l.competencia))].filter(Boolean).sort();
  return `
  <div class="grade g2" style="gap:20px">
    <div>
      <h3>Backup</h3>
      <p class="mini secundario">Baixa tudo num arquivo só: lançamentos, contas, regras, contatos e fechamentos.
        Guarde uma cópia de vez em quando.</p>
      <div class="linha-flex" style="margin-top:10px">
        <button class="btn" data-backup>${icone('baixar', 15)} Baixar backup</button>
        <button class="btn" data-restaurar>Restaurar backup</button>
      </div>
      <p class="mini mudo" style="margin-top:10px">
        ${n} lançamentos${comps.length ? ` · de ${comps[0]} a ${comps[comps.length - 1]}` : ''}
        · ${estado.contrapartes.length} contatos · ${estado.regras.length} regras suas
      </p>
    </div>
    <div>
      <h3>Onde os dados ficam</h3>
      <p class="mini secundario">
        ${modoNuvem()
          ? 'No banco de dados da Cloudflare. Você e seu sócio veem exatamente os mesmos números, de qualquer computador.'
          : 'Só neste navegador, neste computador. Ninguém mais vê. Se limpar os dados do navegador, some — por isso vale baixar backup.'}
      </p>
    </div>
  </div>
  <div style="margin-top:26px;padding-top:20px;border-top:1px solid var(--linha)">
    <h3>Reavaliar lançamentos já importados</h3>
    <p class="mini secundario">
      A classificação dos movimentos de gateway (venda, movimento interno ou saída para o
      banco) é feita na importação. Quando essa regra melhora, o que já foi importado
      continua com a classificação antiga. Este botão roda a regra atual sobre o que já
      está gravado. Nada que você tenha definido à mão é alterado.
    </p>
    <button class="btn btn-pequeno" style="margin-top:8px" data-reavaliar>${icone('raio', 14)} Reavaliar agora</button>
  </div>

  <div style="margin-top:26px;padding-top:20px;border-top:1px solid var(--linha)">
    <h3 class="neg">Apagar tudo</h3>
    <p class="mini secundario">Remove todos os lançamentos, contas, regras e fechamentos. Não tem como desfazer.</p>
    <button class="btn btn-perigo btn-pequeno" style="margin-top:8px" data-apagar-tudo>${icone('lixo', 14)} Apagar todos os dados</button>
  </div>`;
}

// ------------------------------------------------------------------ acesso --

function abaAcesso() {
  if (!modoNuvem()) {
    return bloco('info', `Você está no <strong>modo local</strong>: os dados ficam só neste navegador
      e não há login. Para você e seu sócio verem os mesmos números, publique o painel na Cloudflare
      seguindo o guia <code>docs/DEPLOY.md</code> do repositório.`);
  }
  return `
  <p class="mini secundario">Conectado como <strong>${esc(estado.usuario?.nome || estado.usuario?.usuario || '—')}</strong>.</p>
  <div style="max-width:380px;margin-top:16px">
    <h3>Trocar minha senha</h3>
    <label class="campo"><span class="campo-rotulo">Senha atual</span>
      <input type="password" id="s-atual" autocomplete="current-password"></label>
    <label class="campo"><span class="campo-rotulo">Nova senha</span>
      <input type="password" id="s-nova" autocomplete="new-password"></label>
    <label class="campo"><span class="campo-rotulo">Repita a nova senha</span>
      <input type="password" id="s-nova2" autocomplete="new-password"></label>
    <button class="btn btn-principal" data-trocar-senha>Trocar senha</button>
  </div>
  ${bloco('info', `Os usuários são definidos quando o painel é publicado. Para criar ou remover
    acessos, veja a seção “Usuários” do guia <code>docs/DEPLOY.md</code>.`)}`;
}

// ------------------------------------------------------------------- ações --

function ligarAcoes(raiz, re) {
  liga(raiz, 'click', '[data-nova-conta]', () => editarConta(null, re));
  liga(raiz, 'click', '[data-editar-conta]', (e, a) =>
    editarConta(estado.contas.find((c) => c.id === a.dataset.editarConta), re));

  liga(raiz, 'click', '[data-apagar-conta]', async (e, a) => {
    const conta = estado.contas.find((c) => c.id === a.dataset.apagarConta);
    const n = estado.lancamentos.filter((l) => l.conta_id === conta.id).length;
    if (n) {
      const arquivar = await modal({
        titulo: 'Conta com lançamentos',
        corpo: `<p>“${esc(conta.nome)}” tem ${n} lançamento(s). Apagar a conta deixaria esses
          lançamentos órfãos e mudaria os saldos.</p>
          <p>Prefiro arquivar: ela some das telas mas o histórico continua correto.</p>`,
        confirmar: 'Arquivar conta',
      });
      if (arquivar) { await salvar('contas', [{ ...conta, ativo: 0 }]); avisar('Conta arquivada.'); re(); }
      return;
    }
    const ok = await modal({ titulo: 'Apagar conta', perigo: true, confirmar: 'Apagar',
      corpo: `<p>Apagar “${esc(conta.nome)}”?</p>` });
    if (ok) { await remover('contas', conta.id); avisar('Conta apagada.'); re(); }
  });

  liga(raiz, 'click', '[data-nova-cat]', () => editarCategoria(null, re));
  liga(raiz, 'click', '[data-editar-cat]', (e, a) =>
    editarCategoria(estado.categorias.find((c) => c.id === a.dataset.editarCat), re));
  liga(raiz, 'click', '[data-apagar-cat]', async (e, a) => {
    const id = a.dataset.apagarCat;
    const n = estado.lancamentos.filter((l) => l.categoria === id).length;
    const ok = await modal({ titulo: 'Apagar categoria', perigo: true, confirmar: 'Apagar',
      corpo: n ? `<p>${n} lançamento(s) usam esta categoria e vão ficar sem categoria.</p>`
               : '<p>Apagar esta categoria?</p>' });
    if (!ok) return;
    if (n) {
      await salvar('lancamentos', estado.lancamentos.filter((l) => l.categoria === id)
        .map((l) => ({ ...l, categoria: null, confianca: null, conciliado: 0 })));
    }
    await remover('categorias', id);
    avisar('Categoria apagada.'); re();
  });

  liga(raiz, 'click', '[data-apagar-regra]', async (e, a) => {
    await remover('regras', a.dataset.apagarRegra); avisar('Regra removida.'); re();
  });
  liga(raiz, 'click', '[data-reaplicar]', async () => {
    const copia = estado.lancamentos.map((l) => ({ ...l }));
    const n = recategorizar(copia, estado.regras, { apenasPendentes: false });
    if (!n) return avisar('Nada mudou — tudo já estava de acordo com as regras.');
    await salvar('lancamentos', copia.filter((c, i) => c.categoria !== estado.lancamentos[i].categoria));
    avisar(`${n} lançamento(s) reclassificados.`); re();
  });

  liga(raiz, 'click', '[data-novo-contato]', () => editarContato(null, re));
  liga(raiz, 'click', '[data-editar-contato]', (e, a) =>
    editarContato(estado.contrapartes.find((c) => c.id === a.dataset.editarContato), re));

  liga(raiz, 'click', '[data-backup]', () => {
    download(new Blob([JSON.stringify(exportarTudo(), null, 2)], { type: 'application/json' }),
      `movel5-backup-${new Date().toISOString().slice(0, 10)}.json`);
    avisar('Backup baixado.');
  });
  liga(raiz, 'click', '[data-restaurar]', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const ok = await modal({ titulo: 'Restaurar backup', perigo: true, confirmar: 'Substituir tudo',
        corpo: '<p>Todos os dados atuais serão substituídos pelo conteúdo do backup. Confirma?</p>' });
      if (!ok) return;
      try {
        await importarBackup(JSON.parse(await f.text()));
        avisar('Backup restaurado.'); location.reload();
      } catch (err) { avisar('Arquivo inválido: ' + err.message, 5000); }
    };
    inp.click();
  });
  liga(raiz, 'click', '[data-reavaliar]', async (e, alvo) => {
    alvo.disabled = true;
    const rotulo = alvo.innerHTML;
    alvo.innerHTML = '<span class="carregando"></span> Reavaliando…';
    try {
      const { classificarMovimentoGateway } = await import('../parsers/gateways.js');
      const { alterados, resumo } = reavaliarGateway(
        estado.lancamentos.map((l) => ({ ...l })), classificarMovimentoGateway
      );
      if (!alterados.length) {
        avisar(`Nada mudou — os ${resumo.analisados} lançamentos de gateway já estão de acordo.`, 4500);
        return;
      }
      await salvar('lancamentos', alterados);
      avisar(`${alterados.length} lançamento(s) reclassificados: ${resumo.virouInterno} viraram movimento interno do gateway.`, 6000);
      re();
    } catch (err) {
      avisar('Não consegui reavaliar: ' + err.message, 5000);
    } finally {
      alvo.disabled = false;
      alvo.innerHTML = rotulo;
    }
  });

  liga(raiz, 'click', '[data-apagar-tudo]', async () => {
    const ok = await modal({
      titulo: 'Apagar todos os dados', perigo: true, confirmar: 'Apagar tudo',
      corpo: `<p>Isso remove <strong>${estado.lancamentos.length} lançamentos</strong>,
        contas, regras, contatos e fechamentos. Não dá para desfazer.</p>
        <p class="mini mudo">Baixe um backup antes, se tiver qualquer dúvida.</p>`,
    });
    if (!ok) return;
    await apagarTudo(); avisar('Tudo apagado.'); location.reload();
  });

  liga(raiz, 'click', '[data-trocar-senha]', async () => {
    const atual = raiz.querySelector('#s-atual').value;
    const nova = raiz.querySelector('#s-nova').value;
    const nova2 = raiz.querySelector('#s-nova2').value;
    if (!atual || !nova) return avisar('Preencha a senha atual e a nova.');
    if (nova !== nova2) return avisar('As duas senhas novas não são iguais.');
    if (nova.length < 8) return avisar('A senha nova precisa de pelo menos 8 caracteres.');
    try {
      await getBackend().trocarSenha(atual, nova);
      avisar('Senha alterada.'); re();
    } catch (e) { avisar(e.message, 5000); }
  });
}

// --------------------------------------------------------------- diálogos ---

/** Valor efetivo de um interruptor de conta, com o padrão por tipo. */
function padrao(c, campo) {
  if (c && c[campo] != null) return !!c[campo];
  const tipo = c?.tipo || 'banco';
  return tipo === 'banco' || tipo === 'caixa';
}

function editarConta(c, re) {
  const cores = ['#3b7dd8', '#00b0ea', '#7b61ff', '#e8562f', '#f0a500', '#12855e', '#c9302f', '#6b7280'];
  modal({
    titulo: c ? 'Editar conta' : 'Nova conta',
    corpo: `
      <label class="campo"><span class="campo-rotulo">Nome</span>
        <input id="c-nome" value="${esc(c?.nome || '')}" placeholder="ex.: Sicoob 13.666-2" required></label>
      <label class="campo"><span class="campo-rotulo">Tipo</span>
        <select id="c-tipo">${['banco', 'gateway', 'marketplace', 'caixa'].map((t) =>
          `<option value="${t}"${c?.tipo === t ? ' selected' : ''}>${esc(rotuloTipo(t))}</option>`).join('')}</select></label>
      <label class="campo"><span class="campo-rotulo">Saldo inicial</span>
        <input type="number" step="0.01" id="c-saldo" value="${(c?.saldo_inicial || 0).toFixed(2)}"></label>
      <div class="campo-dica">Quanto havia nesta conta antes do primeiro mês que você vai lançar.</div>
      <label class="campo" style="margin-top:12px"><span class="campo-rotulo">Cor</span>
        <div class="linha-flex" id="c-cores">${cores.map((cor) =>
          `<button type="button" data-cor="${cor}" style="width:26px;height:26px;border-radius:7px;background:${cor};
            border:2px solid ${c?.cor === cor ? 'var(--ink-1)' : 'transparent'};cursor:pointer"
            aria-label="Cor ${cor}"></button>`).join('')}</div></label>
      <label class="check"><input type="checkbox" id="c-ativo" ${c?.ativo === 0 ? '' : 'checked'}>
        <span>Conta ativa</span></label>
      <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--linha)">
        <div class="micro" style="margin-bottom:8px">Como esta conta entra nas contas</div>
        <label class="check" style="margin-bottom:8px">
          <input type="checkbox" id="c-caixa" ${padrao(c, 'entra_no_caixa') ? 'checked' : ''}>
          <span>Somar no saldo em caixa</span></label>
        <div class="campo-dica" style="margin:-4px 0 12px 24px">
          Desligue para gateways e marketplaces: o saldo aparece à parte, como dinheiro em trânsito.</div>
        <label class="check">
          <input type="checkbox" id="c-receita" ${padrao(c, 'reconhece_receita') ? 'checked' : ''}>
          <span>Contar as entradas desta conta como receita</span></label>
        <div class="campo-dica" style="margin:4px 0 0 24px">
          Deixe desligado se todo o dinheiro desta conta é transferido para o banco —
          assim a venda é contada uma vez só, quando cai no banco.</div>
      </div>`,
    aoAbrir: (m) => {
      m.dataset.cor = c?.cor || cores[0];
      m.querySelector('#c-cores').onclick = (e) => {
        const b = e.target.closest('[data-cor]'); if (!b) return;
        m.dataset.cor = b.dataset.cor;
        m.querySelectorAll('[data-cor]').forEach((x) =>
          x.style.borderColor = x === b ? 'var(--ink-1)' : 'transparent');
      };
    },
    aoConfirmar: async (m) => {
      const nome = m.querySelector('#c-nome').value.trim();
      if (!nome) { avisar('Dê um nome à conta.'); return false; }
      await salvar('contas', [{
        ...(c || {}), id: c?.id || uid(), nome,
        tipo: m.querySelector('#c-tipo').value,
        saldo_inicial: Number(m.querySelector('#c-saldo').value) || 0,
        cor: m.dataset.cor,
        ativo: m.querySelector('#c-ativo').checked ? 1 : 0,
        entra_no_caixa: m.querySelector('#c-caixa').checked,
        reconhece_receita: m.querySelector('#c-receita').checked,
      }]);
      avisar(c ? 'Conta atualizada.' : 'Conta criada.');
      return true;
    },
  }).then((r) => { if (r) re(); });
}

function editarCategoria(c, re) {
  const grupos = [...new Set([...CATEGORIAS.map((x) => x.grupo), ...estado.categorias.map((x) => x.grupo)])];
  modal({
    titulo: c ? 'Editar categoria' : 'Nova categoria',
    corpo: `
      <label class="campo"><span class="campo-rotulo">Nome</span>
        <input id="k-nome" value="${esc(c?.nome || '')}" placeholder="ex.: Feiras e eventos" required></label>
      <label class="campo"><span class="campo-rotulo">Grupo</span>
        <input id="k-grupo" list="lista-grupos" value="${esc(c?.grupo || 'Estrutura')}">
        <datalist id="lista-grupos">${grupos.map((g) => `<option value="${esc(g)}">`).join('')}</datalist></label>
      <label class="campo"><span class="campo-rotulo">O que ela representa</span>
        <select id="k-natureza">${['despesa', 'receita', 'holding', 'transferencia', 'investimento', 'emprestimo']
          .map((n) => `<option value="${n}"${c?.natureza === n ? ' selected' : ''}>${esc(rotuloNatureza(n))}</option>`).join('')}</select></label>
      <div class="campo-dica">Só receita e despesa entram no resultado da empresa. As demais movem
        dinheiro sem virar lucro ou prejuízo.</div>`,
    aoConfirmar: async (m) => {
      const nome = m.querySelector('#k-nome').value.trim();
      if (!nome) { avisar('Dê um nome à categoria.'); return false; }
      await salvar('categorias', [{
        ...(c || {}), id: c?.id || 'usr_' + uid(), nome,
        grupo: m.querySelector('#k-grupo').value.trim() || 'Outros',
        natureza: m.querySelector('#k-natureza').value,
      }]);
      avisar(c ? 'Categoria atualizada.' : 'Categoria criada.');
      return true;
    },
  }).then((r) => { if (r) re(); });
}

function editarContato(c, re) {
  modal({
    titulo: c ? 'Editar contato' : 'Novo contato',
    corpo: `
      <label class="campo"><span class="campo-rotulo">Nome</span>
        <input id="t-nome" value="${esc(c?.nome || '')}" required></label>
      <label class="campo"><span class="campo-rotulo">CNPJ ou CPF</span>
        <input id="t-doc" value="${esc(c?.documento || '')}" placeholder="só números"></label>
      <div class="campo-dica">É por aqui que o painel reconhece o lançamento no extrato.</div>
      <label class="campo" style="margin-top:12px"><span class="campo-rotulo">Tipo</span>
        <input id="t-tipo" value="${esc(c?.tipo || '')}" placeholder="ex.: Fornecedor, Transportador, Cliente"></label>
      <label class="campo"><span class="campo-rotulo">Categoria automática</span>
        <select id="t-cat">${selectCategorias(categorias(), c?.categoriaSugerida || '', { vazioTexto: 'Nenhuma' })}</select></label>
      ${c ? `<button class="btn btn-perigo btn-pequeno" id="t-apagar">${icone('lixo', 14)} Remover contato</button>` : ''}`,
    aoAbrir: (m) => {
      m.querySelector('#t-apagar')?.addEventListener('click', async () => {
        await remover('contrapartes', c.id); m.remove(); avisar('Contato removido.'); re();
      });
    },
    aoConfirmar: async (m) => {
      const nome = m.querySelector('#t-nome').value.trim();
      if (!nome) { avisar('Informe o nome.'); return false; }
      await salvar('contrapartes', [{
        ...(c || {}), id: c?.id || uid(), nome,
        documento: m.querySelector('#t-doc').value.replace(/\D/g, ''),
        tipo: m.querySelector('#t-tipo').value.trim(),
        categoriaSugerida: m.querySelector('#t-cat').value || null,
      }]);
      avisar(c ? 'Contato atualizado.' : 'Contato criado.');
      return true;
    },
  }).then((r) => { if (r) re(); });
}
