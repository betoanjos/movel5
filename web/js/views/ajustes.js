// Ajustes: contas, categorias próprias, regras, contatos, backup e conta de acesso.
import { estado, salvar, remover, categorias, nomeCategoria, apagarTudo,
         exportarTudo, importarBackup, modoNuvem, getBackend,
         destinosHolding, salvarDestinosHolding, ehHolding,
         recarregarColecoes } from '../store.js';
import { CATEGORIAS } from '../engine/seed.js';
import { recategorizar, reavaliarGateway, rotuloRegra, regraCombina, conciliarVendas, conciliarPagamentos,
         docContraparte, indexarContrapartes, aplicarContrapartes } from '../engine/motor.js';
import { brl, esc, uid, download, brDate, formatarDoc, normalize } from '../lib/util.js';
import { icone, bloco, avisar, liga, modal, vazio, selectCategorias,
         campoDestinoHolding, ligarDestinoHolding } from '../lib/ui.js';

let aba = 'contas';

export function telaAjustes(raiz, ctx) {
  // Volta da autorização do Bling: #/ajustes?bling=ok
  const retorno = (location.hash.split('?')[1] || '');
  const marca = new URLSearchParams(retorno).get('bling');
  if (marca) {
    aba = 'integracoes';
    avisar(marca === 'ok' ? 'Conectado ao Bling.' : `Bling: ${marca}`, marca === 'ok' ? 4000 : 8000);
    history.replaceState(null, '', '#/ajustes');
  }
  desenhar(raiz, ctx);
}

function desenhar(raiz, ctx) {
  const abas = [
    ['contas', 'Contas'], ['categorias', 'Categorias'], ['regras', 'Regras automáticas'],
    ['contatos', 'Contatos'], ['integracoes', 'Integrações'],
    ['dados', 'Backup e dados'], ['acesso', 'Acesso'],
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
  contatos: abaContatos, integracoes: abaIntegracoes,
  dados: abaDados, acesso: abaAcesso,
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
    </div>`).join('')}
  ${blocoDestinos()}`;
}

// ------------------------------------------------- destinos da holding --

/**
 * Quem “pega” dinheiro da Móvel5. Não é categoria: é um rótulo de destino
 * dentro da conta corrente com a holding, para ele enxergar depois para onde
 * foi cada valor e lançar no financeiro de cada lugar.
 */
function blocoDestinos() {
  const destinos = destinosHolding();
  const usoDe = (d) => estado.lancamentos.filter((l) => l.destino_holding === d).length;
  return `
  <div style="margin-top:26px;border-top:1px solid var(--linha);padding-top:18px">
    <div class="linha-flex" style="margin-bottom:10px">
      <div style="flex:1">
        <div class="micro" style="margin-bottom:2px">Destinos da holding</div>
        <p class="mini secundario" style="margin:0">
          Quando um lançamento é da holding, você escolhe de quem é o dinheiro.
          O saldo continua sendo um só, mas o relatório mostra a quebra por pessoa/negócio.
        </p>
      </div>
      <button class="btn btn-principal btn-pequeno" data-novo-destino>${icone('mais', 14)} Novo destino</button>
    </div>
    <div class="tabela-rolagem"><table class="tabela tabela-compacta"><tbody>
      ${destinos.map((d) => `<tr>
        <td class="forte">${esc(d)}</td>
        <td class="num mini mudo">${usoDe(d)} lanç.</td>
        <td class="nowrap" style="width:70px">
          <button class="btn btn-sutil btn-pequeno" data-editar-destino="${esc(d)}">${icone('lapis', 14)}</button>
          <button class="btn btn-sutil btn-pequeno" data-apagar-destino="${esc(d)}">${icone('lixo', 14)}</button>
        </td></tr>`).join('')}
    </tbody></table></div>
  </div>`;
}

const rotuloNatureza = (n) => ({
  receita: 'entra e conta como resultado', despesa: 'sai e conta como resultado',
  transferencia: 'só move dinheiro entre contas', holding: 'conta corrente com os sócios',
  investimento: 'aplicação no próprio banco — continua no saldo',
  emprestimo: 'principal de empréstimo',
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
      <td><code class="mini">${esc(rotuloRegra(r))}</code></td>
      <td class="mini secundario">${r.sinal === 'D' ? 'saídas' : r.sinal === 'C' ? 'entradas' : 'entradas e saídas'}</td>
      <td><span class="selo">${esc(nomeCategoria(r.categoria))}</span>
        ${r.destino_holding ? `<span class="selo" style="color:var(--holding)">${esc(r.destino_holding)}</span>` : ''}</td>
      <td class="mini mudo">${r.criada_em ? brDate(r.criada_em.slice(0, 10)) : '—'}</td>
      <td class="nowrap">
        <button class="btn btn-sutil btn-pequeno" data-editar-regra="${r.id}">${icone('lapis', 14)}</button>
        <button class="btn btn-sutil btn-pequeno" data-apagar-regra="${r.id}">${icone('lixo', 14)}</button>
      </td>
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
    ${cnpjsDesconhecidos().length ? `<button class="btn btn-pequeno" data-buscar-receita>${icone('busca', 14)}
      Buscar nome de ${cnpjsDesconhecidos().length} CNPJ(s) na Receita</button>` : ''}
    <button class="btn btn-principal btn-pequeno" data-novo-contato>${icone('mais', 14)} Novo contato</button>
  </div>
  <p class="mini mudo" style="margin-top:-4px">
    CNPJ sem nome no extrato pode ser buscado nas bases públicas da Receita
    (BrasilAPI / Minha Receita). CPF não: é dado pessoal e não tem consulta aberta.
  </p>
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
      A classificação é feita na importação. Quando as regras melhoram, o que já foi
      importado continua do jeito antigo. Este botão roda tudo de novo sobre o que está
      gravado: os movimentos de gateway e o aviso de “pode ser transferência”, que sai
      dos créditos sem conta do outro lado para parear. Nada que você tenha definido à
      mão é alterado.
    </p>
    <button class="btn btn-pequeno" style="margin-top:8px" data-reavaliar>${icone('raio', 14)} Reavaliar agora</button>
  </div>

  <div style="margin-top:26px;padding-top:20px;border-top:1px solid var(--linha)">
    <h3>Ligar entradas aos pedidos de venda</h3>
    <p class="mini secundario">
      O extrato mostra só “PIX RECEBIDO — OUTRA IF”. Cruzando com os pedidos importados do
      Bling (que vêm da Tray) dá para saber de qual pedido é cada entrada. O cruzamento é
      pelo valor exato, com nome, CNPJ/CPF e data como desempate — quando dois pedidos
      empatam, nenhum é escolhido, para não colar o número errado.
      Hoje há ${estado.vendas.length} pedido(s) e
      ${estado.lancamentos.filter((l) => l.venda_numero).length} entrada(s) já ligadas.
    </p>
    <button class="btn btn-pequeno" style="margin-top:8px" data-conciliar-vendas>${icone('busca', 14)} Ligar agora</button>
  </div>

  <div style="margin-top:26px;padding-top:20px;border-top:1px solid var(--linha)">
    <h3>Ligar pagamentos aos títulos do Bling</h3>
    <p class="mini secundario">
      O extrato mostra “DÉB.TÍTULO COBRANÇA” e um número de agendamento, sem dizer quem
      recebeu. Cruzando com o relatório de contas a pagar e com as notas de entrada dá para
      saber o fornecedor. Também é pelo valor exato, com vencimento, número do título e nome
      como desempate — em caso de empate, nenhum é escolhido.
      Hoje há ${estado.contasPagar.length} título(s), ${estado.compras.length} nota(s) de entrada e
      ${estado.lancamentos.filter((l) => l.titulo_fornecedor).length} saída(s) já ligadas.
    </p>
    <button class="btn btn-pequeno" style="margin-top:8px" data-conciliar-pagamentos>${icone('busca', 14)} Ligar agora</button>
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

  liga(raiz, 'click', '[data-novo-destino]', () => editarDestino(null, re));
  liga(raiz, 'click', '[data-editar-destino]', (e, a) => editarDestino(a.dataset.editarDestino, re));
  liga(raiz, 'click', '[data-apagar-destino]', async (e, a) => {
    const destino = a.dataset.apagarDestino;
    const usados = estado.lancamentos.filter((l) => l.destino_holding === destino);
    const ok = await modal({ titulo: 'Apagar destino', perigo: true, confirmar: 'Apagar',
      corpo: usados.length
        ? `<p>${usados.length} lançamento(s) apontam para “${esc(destino)}”. Eles continuam na conta
           da holding, só ficam sem destino.</p>`
        : `<p>Apagar “${esc(destino)}” da lista?</p>` });
    if (!ok) return;
    await salvarDestinosHolding(destinosHolding().filter((d) => d !== destino));
    if (usados.length) {
      await salvar('lancamentos', usados.map((l) => ({ ...l, destino_holding: '' })));
    }
    avisar('Destino apagado.'); re();
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

  liga(raiz, 'click', '[data-editar-regra]', (e, a) =>
    editarRegra(estado.regras.find((r) => r.id === a.dataset.editarRegra), re));

  liga(raiz, 'click', '[data-apagar-regra]', async (e, a) => {
    await remover('regras', a.dataset.apagarRegra); avisar('Regra removida.'); re();
  });
  liga(raiz, 'click', '[data-reaplicar]', async () => {
    const copia = estado.lancamentos.map((l) => ({ ...l }));
    const contasPassagem = estado.contas
      .filter((c) => c.tipo === 'gateway' || c.tipo === 'marketplace')
      .map((c) => normalize(c.nome));
    const n = recategorizar(copia, estado.regras, {
      apenasPendentes: false,
      contasPassagem: contasPassagem.length ? contasPassagem : null,
    });
    if (!n) return avisar('Nada mudou — tudo já estava de acordo com as regras.');
    const mudados = copia.filter((c, i) =>
      c.categoria !== estado.lancamentos[i].categoria ||
      (c.possivel_transferencia || 0) !== (estado.lancamentos[i].possivel_transferencia || 0));
    await salvar('lancamentos', mudados);
    avisar(`${n} lançamento(s) atualizados.`); re();
  });

  // ---- Bling ----
  const api = () => getBackend();
  const saida = (html) => { const el = raiz.querySelector('#bl-saida'); if (el) el.innerHTML = html; };

  liga(raiz, 'click', '[data-bling-cred]', async (e, alvo) => {
    const client_id = raiz.querySelector('#bl-id').value.trim();
    const client_secret = raiz.querySelector('#bl-secret').value.trim();
    if (!client_id || !client_secret) return avisar('Cole os dois campos.');
    alvo.disabled = true;
    try {
      await api().pedir('/bling/credenciais', { method: 'POST', body: { client_id, client_secret } });
      raiz.querySelector('#bl-secret').value = '';
      avisar('Credenciais guardadas no servidor.');
      blingInfo = null; re();
    } catch (err) { avisar('Não consegui guardar: ' + err.message, 6000); }
    finally { alvo.disabled = false; }
  });

  liga(raiz, 'click', '[data-bling-conectar]', async () => {
    try {
      const { url } = await api().pedir('/bling/conectar');
      location.href = url;                       // vai ao Bling e volta no callback
    } catch (err) { avisar(err.message, 6000); }
  });

  liga(raiz, 'click', '[data-bling-sair]', async () => {
    const ok = await modal({ titulo: 'Desconectar do Bling', confirmar: 'Desconectar',
      corpo: '<p>O painel para de sincronizar. Os dados já trazidos continuam aqui.</p>' });
    if (!ok) return;
    await api().pedir('/bling/desconectar', { method: 'POST' });
    blingInfo = null; re();
  });

  liga(raiz, 'click', '[data-bling-sinc]', async (e, alvo) => {
    alvo.disabled = true;
    const rotulo = alvo.innerHTML;
    alvo.innerHTML = '<span class="carregando"></span> Sincronizando…';
    try {
      const modo = alvo.dataset.modo || 'incremental';
      const r = await api().pedir('/bling/sincronizar', { method: 'POST', body: { modo } });
      // Quem gravou foi o servidor: o painel precisa buscar de novo.
      await recarregarColecoes(['vendas', 'compras', 'contasPagar', 'contasReceber', 'movimentos']);
      avisar('Sincronizado.');
      blingInfo = null;
      re();
      if (r?.erro) saida(bloco('atencao', `<code class="mini">${esc(JSON.stringify(r.erro).slice(0, 400))}</code>`));
    } catch (err) { avisar('Falhou: ' + err.message, 8000); }
    finally { alvo.disabled = false; alvo.innerHTML = rotulo; }
  });

  liga(raiz, 'click', '[data-bling-descobrir]', async (e, alvo) => {
    alvo.disabled = true;
    try {
      const { rotas } = await api().pedir('/bling/descobrir', { method: 'POST', body: {} });
      saida(`<div class="tabela-rolagem"><table class="tabela tabela-compacta">
        <thead><tr><th>Recurso</th><th>Status</th><th>Retorno</th></tr></thead>
        <tbody>${rotas.map((x) => `<tr>
          <td class="mini"><code>${esc(x.rota)}</code></td>
          <td class="mini ${x.ok ? 'pos' : 'neg'}">${x.status}</td>
          <td class="mini mudo">${x.ok ? `${x.itens} registro(s)` : esc(String(x.erro || '').slice(0, 90))}</td>
        </tr>`).join('')}</tbody></table></div>`);
    } catch (err) { avisar(err.message, 6000); }
    finally { alvo.disabled = false; }
  });

  liga(raiz, 'click', '[data-buscar-receita]', () => buscarNaReceita(re));
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
  liga(raiz, 'click', '[data-conciliar-vendas]', async (e, alvo) => {
    if (!estado.vendas.length) {
      return avisar('Importe primeiro o CSV de pedidos de venda do Bling.', 5000);
    }
    alvo.disabled = true;
    const copia = estado.lancamentos.map((l) => ({ ...l }));
    const { alterados, resumo } = conciliarVendas(copia, estado.vendas);
    if (alterados.length) await salvar('lancamentos', alterados);
    alvo.disabled = false;
    avisar(alterados.length
      ? `${resumo.ligados} entrada(s) ligadas a pedidos${resumo.ambiguos ? ` — ${resumo.ambiguos} ficaram em dúvida e não foram tocadas` : ''}.`
      : 'Nenhuma entrada nova para ligar.', 6000);
    re();
  });
  liga(raiz, 'click', '[data-conciliar-pagamentos]', async (e, alvo) => {
    if (!estado.contasPagar.length && !estado.compras.length) {
      return avisar('Importe primeiro o relatório de contas a pagar ou as notas de entrada do Bling.', 6000);
    }
    alvo.disabled = true;
    const copia = estado.lancamentos.map((l) => ({ ...l }));
    const { alterados, resumo } = conciliarPagamentos(copia, estado.contasPagar, estado.compras);
    if (alterados.length) await salvar('lancamentos', alterados);
    alvo.disabled = false;
    avisar(alterados.length
      ? `${resumo.ligados} pagamento(s) ligados (${resumo.porTitulo} por título, ${resumo.porNota} por nota de entrada)${resumo.ambiguos ? ` — ${resumo.ambiguos} em dúvida, não tocados` : ''}.`
      : 'Nenhum pagamento novo para ligar.', 6000);
    re();
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

      // Além das linhas de gateway, roda as regras de novo sobre tudo: é o
      // que tira o "pode ser transferência" de crédito que não tem conta do
      // outro lado para parear (Pagar.me, por exemplo).
      const copia = estado.lancamentos.map((l) => ({ ...l }));
      const contasPassagem = estado.contas
        .filter((c) => c.tipo === 'gateway' || c.tipo === 'marketplace')
        .map((c) => normalize(c.nome));
      recategorizar(copia, estado.regras, {
        apenasPendentes: false,
        contasPassagem: contasPassagem.length ? contasPassagem : null,
      });
      const revistos = copia.filter((c, i) =>
        c.categoria !== estado.lancamentos[i].categoria ||
        (c.possivel_transferencia || 0) !== (estado.lancamentos[i].possivel_transferencia || 0));

      // O que a reavaliação de gateway mudou tem preferência sobre a cópia.
      const porId = new Map(revistos.map((l) => [l.id, l]));
      for (const l of alterados) porId.set(l.id, l);
      const tudo = [...porId.values()];

      if (!tudo.length) {
        avisar(`Nada mudou — os ${resumo.analisados} lançamentos de gateway já estão de acordo.`, 4500);
        return;
      }
      await salvar('lancamentos', tudo);
      const semAviso = revistos.filter((c) => !c.possivel_transferencia).length;
      avisar(`${tudo.length} lançamento(s) atualizados` +
        (resumo.virouInterno ? ` · ${resumo.virouInterno} viraram movimento interno do gateway` : '') +
        (semAviso ? ` · ${semAviso} deixaram de pedir pareamento` : '') + '.', 6000);
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

/** Cria ou renomeia um destino da holding, arrastando junto os lançamentos. */
function editarDestino(destino, re) {
  modal({
    titulo: destino ? 'Renomear destino' : 'Novo destino da holding',
    confirmar: 'Salvar',
    corpo: `
      <label class="campo"><span class="campo-rotulo">Nome</span>
        <input id="d-nome" value="${esc(destino || '')}" placeholder="ex.: Chácara" required></label>
      <p class="mini mudo">Pessoa ou negócio que recebe ou coloca dinheiro através da Móvel5.</p>`,
    aoConfirmar: async (m) => {
      const nome = m.querySelector('#d-nome').value.trim();
      if (!nome) { avisar('Escreva um nome.'); return false; }
      const lista = destinosHolding();
      if (lista.includes(nome) && nome !== destino) { avisar('Já existe um destino com esse nome.'); return false; }
      await salvarDestinosHolding(destino ? lista.map((d) => (d === destino ? nome : d)) : [...lista, nome]);
      if (destino) {
        const usados = estado.lancamentos.filter((l) => l.destino_holding === destino);
        if (usados.length) await salvar('lancamentos', usados.map((l) => ({ ...l, destino_holding: nome })));
      }
      avisar(destino ? 'Destino renomeado.' : 'Destino criado.');
      return true;
    },
  }).then((r) => { if (r) re(); });
}

// -------------------------------------------------- nomes na Receita --

/**
 * CNPJs que aparecem nos lançamentos mas ainda não têm nome: são os que
 * valem uma consulta. CPF fica de fora — não existe consulta pública.
 */
function cnpjsDesconhecidos() {
  const conhecidos = new Set(estado.contrapartes.map((c) => String(c.documento || '').replace(/\D/g, '')));
  const docs = new Set();
  for (const l of estado.lancamentos) {
    const doc = docContraparte(l);
    if (doc && doc.length === 14 && !conhecidos.has(doc) && cnpjValido(doc)) docs.add(doc);
  }
  return [...docs];
}

/**
 * Busca a razão social de cada CNPJ desconhecido e guarda no cadastro de
 * contatos. Daí em diante o nome aparece sozinho em todo lançamento daquele
 * CNPJ — inclusive nas próximas importações.
 */
async function buscarNaReceita(re) {
  const docs = cnpjsDesconhecidos();
  if (!docs.length) return avisar('Todos os CNPJs dos lançamentos já têm nome.');

  const segundos = Math.ceil((docs.length * 0.9) / 5) * 5;
  const ok = await modal({
    titulo: 'Buscar nomes na Receita',
    corpo: `<p>Vou consultar <strong>${docs.length} CNPJ(s)</strong> nas bases públicas
        (BrasilAPI e Minha Receita) e guardar a razão social no cadastro de contatos.</p>
      <p class="mini secundario">Leva mais ou menos ${segundos} segundos — as bases são gratuitas
        e limitam consultas seguidas, então vou devagar. Pode deixar a tela aberta.</p>
      <p class="mini mudo">Nada é enviado além do próprio CNPJ.</p>`,
    confirmar: 'Buscar agora',
  });
  if (!ok) return;

  // A caixa de progresso não é esperada: ela fica na tela enquanto a fila roda.
  let painel = null;
  modal({
    titulo: 'Buscando na Receita', confirmar: '', cancelar: '',
    corpo: `<p class="mini secundario" id="rec-status">Consultando 0 de ${docs.length}…</p>
      <div class="barra-progresso"><div id="rec-barra" style="width:0%"></div></div>
      <p class="mini mudo" id="rec-ultimo">&nbsp;</p>`,
    aoAbrir: (m) => { painel = m; },
  });

  const { achados, interrompido } = await consultarVarios(docs, (feito, total, achado) => {
    const st = document.getElementById('rec-status');
    const barra = document.getElementById('rec-barra');
    const ultimo = document.getElementById('rec-ultimo');
    if (st) st.textContent = `Consultando ${feito} de ${total}…`;
    if (barra) barra.style.width = `${Math.round((feito / total) * 100)}%`;
    if (ultimo && achado) ultimo.textContent = `${formatarDoc(achado.documento)} — ${achado.nome}`;
  });

  painel?.remove();

  if (!achados.length) {
    return avisar(interrompido
      ? 'Não consegui falar com as bases da Receita. Verifique a internet e tente de novo mais tarde.'
      : 'Nenhum nome encontrado para esses CNPJs.', 6000);
  }

  const contatos = achados.map((a) => ({
    id: uid(),
    nome: a.nome,
    documento: a.documento,
    tipo: '',
    detalhe: [a.fantasia, a.atividade, [a.municipio, a.uf].filter(Boolean).join('/')].filter(Boolean).join(' · '),
    fonte: a.fonte,
  }));
  await salvar('contrapartes', contatos);

  // Aplica nos lançamentos que já estavam lá.
  const copia = estado.lancamentos.map((l) => ({ ...l }));
  const n = aplicarContrapartes(copia, indexarContrapartes(estado.contrapartes));
  if (n) {
    await salvar('lancamentos', copia.filter((c, i) =>
      c.contraparte !== estado.lancamentos[i].contraparte || c.identificado !== estado.lancamentos[i].identificado));
  }
  avisar(`${achados.length} nome(s) encontrados — ${n} lançamento(s) identificados.`, 6000);
  re();
}

// ------------------------------------------------- consulta de CNPJ --
//
// Consulta de CNPJ em bases públicas, para trocar o número pelo nome da
// empresa. Fica aqui dentro, e não num arquivo próprio, porque o Worker
// publicado só serve os arquivos que existiam quando foi empacotado —
// um arquivo novo voltaria como index.html e derrubaria o painel.
//
// Só CNPJ: CPF é dado pessoal e não existe consulta pública — nesses casos o
// painel continua mostrando o documento formatado.
//
// Duas fontes gratuitas e sem cadastro, tentadas em ordem. Se as duas
// falharem (sem internet, fora do ar, limite de consultas), a busca devolve
// null e o painel segue funcionando como antes.

const FONTES = [
  {
    nome: 'BrasilAPI',
    url: (doc) => `https://brasilapi.com.br/api/cnpj/v1/${doc}`,
    ler: (d) => ({
      nome: d.razao_social || d.nome_fantasia || '',
      fantasia: d.nome_fantasia || '',
      atividade: d.cnae_fiscal_descricao || '',
      municipio: d.municipio || '',
      uf: d.uf || '',
      situacao: d.descricao_situacao_cadastral || '',
    }),
  },
  {
    nome: 'Minha Receita',
    url: (doc) => `https://minhareceita.org/${doc}`,
    ler: (d) => ({
      nome: d.razao_social || d.nome_fantasia || '',
      fantasia: d.nome_fantasia || '',
      atividade: d.cnae_fiscal_descricao || '',
      municipio: d.municipio || '',
      uf: d.uf || '',
      situacao: d.descricao_situacao_cadastral || '',
    }),
  },
];

/** Dígito verificador: evita gastar consulta com número que nem é CNPJ. */
function cnpjValido(doc) {
  const s = String(doc || '').replace(/\D/g, '');
  if (s.length !== 14 || /^(\d)\1{13}$/.test(s)) return false;
  const calc = (base) => {
    let peso = base.length - 7, soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(s.slice(0, 12)) === Number(s[12]) && calc(s.slice(0, 13)) === Number(s[13]);
}

/**
 * Busca a razão social de um CNPJ.
 * @returns {Promise<null|{documento,nome,fantasia,atividade,municipio,uf,situacao,fonte}>}
 */
async function consultarCNPJ(documento, { timeoutMs = 6000 } = {}) {
  const doc = String(documento || '').replace(/\D/g, '');
  if (!cnpjValido(doc)) return null;

  for (const fonte of FONTES) {
    // Sem prazo, uma base fora do ar deixa a fila inteira pendurada.
    const corta = new AbortController();
    const relogio = setTimeout(() => corta.abort(), timeoutMs);
    try {
      const r = await fetch(fonte.url(doc), { signal: corta.signal });
      if (!r.ok) continue;
      const dados = fonte.ler(await r.json());
      if (dados.nome) return { documento: doc, ...dados, fonte: fonte.nome };
    } catch {
      // Rede fora, CORS, limite de consultas: tenta a próxima fonte.
    } finally {
      clearTimeout(relogio);
    }
  }
  return null;
}

/**
 * Busca vários CNPJs em fila, com uma pausa entre um e outro para não bater
 * no limite das bases públicas.
 * @param {string[]} documentos
 * @param {(feito:number, total:number, achado:Object|null)=>void} aoAndar
 */
async function consultarVarios(documentos, aoAndar, { pausaMs = 350, desistirApos = 2 } = {}) {
  const achados = [];
  let seguidasEmBranco = 0;
  for (let i = 0; i < documentos.length; i++) {
    const r = await consultarCNPJ(documentos[i]);
    if (r) { achados.push(r); seguidasEmBranco = 0; } else seguidasEmBranco++;
    aoAndar?.(i + 1, documentos.length, r);

    // Se nem os primeiros vieram, é a internet ou as bases — não adianta
    // insistir nos outros e fazer ele esperar à toa.
    if (seguidasEmBranco >= desistirApos && !achados.length) {
      return { achados, interrompido: true, feitos: i + 1 };
    }
    if (i < documentos.length - 1) await new Promise((ok) => setTimeout(ok, pausaMs));
  }
  return { achados, interrompido: false, feitos: documentos.length };
}

// ------------------------------------------------------- editar regra --

/**
 * Edita uma regra existente. Mudar o texto ou o valor de uma regra é comum:
 * ela pegou de menos, ou pegou demais. Antes só dava para apagar e criar
 * outra, perdendo a data e tendo que reclassificar tudo de novo.
 */
function editarRegra(regra, re) {
  if (!regra) return;
  const combinam = (r) => estado.lancamentos.filter((l) => !l.transfer_id && regraCombina(r, l)).length;

  modal({
    titulo: 'Editar regra',
    confirmar: 'Salvar',
    corpo: `
      <p class="mini secundario">A regra vale para as próximas importações. Se quiser, aplica
      também no que já está no painel — sem mexer no que você travou à mão.</p>

      <label class="campo"><span class="campo-rotulo">Texto a procurar</span>
        <input id="er-padrao" value="${esc(regra.padrao || '')}" placeholder="ex.: CELESC">
        <span class="campo-dica">Procura na descrição, no nome e no CNPJ/CPF. Deixe vazio para
          usar só valor e dia.</span></label>

      <div class="grade g2" style="gap:12px">
        <label class="campo"><span class="campo-rotulo">Valor exato (opcional)</span>
          <input type="number" step="0.01" min="0" id="er-valor"
            value="${regra.valor != null && regra.valor !== '' ? Math.abs(Number(regra.valor)).toFixed(2) : ''}"
            placeholder="qualquer valor"></label>
        <label class="campo"><span class="campo-rotulo">Dia do mês (opcional)</span>
          <input type="number" min="1" max="31" id="er-dia"
            value="${regra.dia_mes || ''}" placeholder="qualquer dia"></label>
      </div>

      <label class="campo"><span class="campo-rotulo">Categoria</span>
        <select id="er-cat">${selectCategorias(categorias(), regra.categoria || '', { vazioTexto: '— escolher —' })}</select></label>
      ${campoDestinoHolding(destinosHolding(), regra.destino_holding || '', 'er-destino')}

      <label class="campo"><span class="campo-rotulo">Aplicar a</span>
        <select id="er-sinal">
          <option value=""${!regra.sinal ? ' selected' : ''}>entradas e saídas</option>
          <option value="D"${regra.sinal === 'D' ? ' selected' : ''}>somente saídas</option>
          <option value="C"${regra.sinal === 'C' ? ' selected' : ''}>somente entradas</option>
        </select></label>

      <p class="mini mudo" id="er-conta"></p>
      <label class="check"><input type="checkbox" id="er-retro">
        <span>Aplicar agora nos lançamentos que combinam</span></label>`,
    aoAbrir: (m) => {
      ligarDestinoHolding(m, 'er-cat', ehHolding, 'er-destino');
      const contar = () => {
        const previa = {
          padrao: m.querySelector('#er-padrao').value.trim(),
          valor: m.querySelector('#er-valor').value || null,
          dia_mes: m.querySelector('#er-dia').value || null,
          sinal: m.querySelector('#er-sinal').value || null,
        };
        const n = previa.padrao || previa.valor || previa.dia_mes ? combinam(previa) : 0;
        m.querySelector('#er-conta').textContent = `${n} lançamento(s) combinam com isso hoje.`;
      };
      for (const id of ['#er-padrao', '#er-valor', '#er-dia', '#er-sinal']) {
        m.querySelector(id).addEventListener('input', contar);
        m.querySelector(id).addEventListener('change', contar);
      }
      contar();
    },
    aoConfirmar: async (m) => {
      const padrao = m.querySelector('#er-padrao').value.trim();
      const valor = m.querySelector('#er-valor').value;
      const dia = m.querySelector('#er-dia').value;
      const categoria = m.querySelector('#er-cat').value;
      if (!padrao && !valor && !dia) { avisar('Informe ao menos texto, valor ou dia.'); return false; }
      if (!categoria) { avisar('Escolha a categoria.'); return false; }

      const nova = {
        ...regra,
        padrao,
        valor: valor ? Number(valor) : null,
        dia_mes: dia ? Number(dia) : null,
        categoria,
        destino_holding: ehHolding(categoria) ? (m.querySelector('#er-destino')?.value || '') : '',
        sinal: m.querySelector('#er-sinal').value || null,
        editada_em: new Date().toISOString(),
      };
      await salvar('regras', [nova]);

      if (m.querySelector('#er-retro').checked) {
        const alvo = estado.lancamentos.filter(
          (l) => !l.travado && !l.transfer_id && regraCombina(nova, l) && l.categoria !== nova.categoria
        );
        if (alvo.length) {
          await salvar('lancamentos', alvo.map((l) => ({
            ...l, categoria: nova.categoria, confianca: 'alta', conciliado: 1,
            regra_aplicada: rotuloRegra(nova),
            ...(ehHolding(nova.categoria) ? { destino_holding: nova.destino_holding } : {}),
          })));
        }
        avisar(`Regra salva — ${alvo.length} lançamento(s) reclassificados.`);
      } else {
        avisar('Regra salva.');
      }
      return true;
    },
  }).then((r) => { if (r) re(); });
}

// -------------------------------------------------------- integrações --

let blingInfo = null;      // estado devolvido pelo Worker

/**
 * Integração com o Bling — só leitura.
 *
 * O painel não escreve nada no Bling: puxa pedidos de venda e de compra,
 * contas a pagar e a receber, notas de entrada e o cadastro de contatos, e
 * usa isso para dar nome e origem ao dinheiro que aparece no extrato.
 *
 * As credenciais ficam no Worker, nunca no navegador: por isso esta tela
 * envia o `client_secret` e nunca o recebe de volta.
 */
function abaIntegracoes() {
  if (!modoNuvem()) {
    return bloco('info', `A integração com o Bling roda no servidor, então só funciona no
      painel publicado (modo nuvem). Neste modo local, a importação continua sendo por arquivo.`);
  }

  const i = blingInfo;
  if (!i) {
    setTimeout(carregarBling, 0);
    return `<p class="mini mudo"><span class="carregando"></span> Consultando a integração…</p>`;
  }

  const estadoTexto = !i.temCredenciais
    ? bloco('atencao', 'Falta cadastrar o aplicativo: cole abaixo o <strong>client_id</strong> e o <strong>client_secret</strong> que o Bling mostrou ao criar o app.')
    : !i.conectado
      ? bloco('info', 'Credenciais guardadas. Agora é só autorizar uma vez — o Bling vai perguntar se você permite, e volta para cá.')
      : bloco('ok', `<strong>Conectado.</strong> A sincronização roda sozinha todo dia às 6h.
          ${i.ultimaSync ? `Última: ${brDate(i.ultimaSync.slice(0, 10))} às ${i.ultimaSync.slice(11, 16)}.` : 'Ainda não sincronizou.'}`);

  return `
  <p class="mini secundario">
    O painel <strong>lê</strong> o Bling — nunca escreve. Nenhum pedido, nenhuma conta e nenhum
    cadastro é criado lá. Serve para cruzar dados: de onde veio e para onde foi o dinheiro que
    aparece no extrato.
  </p>

  <div style="margin:14px 0">${estadoTexto}</div>

  <div class="grade g2" style="gap:12px">
    <label class="campo"><span class="campo-rotulo">client_id</span>
      <input id="bl-id" placeholder="${i.temCredenciais ? esc(i.clientId || 'já cadastrado') : 'cole aqui'}"></label>
    <label class="campo"><span class="campo-rotulo">client_secret</span>
      <input id="bl-secret" type="password" placeholder="${i.temCredenciais ? '••••••• (guardado)' : 'cole aqui'}">
      <span class="campo-dica">Fica guardado no servidor. O painel nunca mostra de volta.</span></label>
  </div>
  <div class="linha-flex" style="gap:8px;flex-wrap:wrap">
    <button class="btn btn-pequeno" data-bling-cred>Guardar credenciais</button>
    ${i.temCredenciais ? `<button class="btn btn-principal btn-pequeno" data-bling-conectar>
      ${i.conectado ? 'Reconectar' : 'Conectar ao Bling'}</button>` : ''}
    ${i.conectado ? `
      <button class="btn btn-pequeno" data-bling-sinc title="Olha as últimas três semanas e completa os valores das notas">${icone('raio', 14)} Sincronizar agora</button>
      <button class="btn btn-pequeno" data-bling-sinc data-modo="completo" title="Volta no tempo um ano por vez; clique de novo para ir mais fundo">Buscar histórico</button>
      <button class="btn btn-pequeno" data-bling-descobrir title="Pergunta ao Bling quais recursos a sua conta expõe">Ver recursos</button>
      <button class="btn btn-sutil btn-pequeno" data-bling-sair>Desconectar</button>` : ''}
  </div>

  ${i.resumo ? `
    <div style="margin-top:18px">
      <div class="micro" style="margin-bottom:6px">Última sincronização${
        i.periodo ? ` — ${i.modo === 'completo' ? 'histórico' : 'dia a dia'},
        de ${esc(brDate(i.periodo.de))} a ${esc(brDate(i.periodo.ate))}` : ''}</div>
      <div class="tabela-rolagem"><table class="tabela tabela-compacta">
        <thead><tr><th>Recurso</th><th class="mini">Período</th><th class="num">Lidos</th><th class="num">Gravados</th></tr></thead>
        <tbody>${Object.entries(i.resumo).map(([nome, r]) => `<tr>
          <td class="mini">${esc(rotuloRecurso(nome))}
            ${r.parcial ? '<span class="selo selo-alerta">continua</span>' : ''}
            ${r.faltando ? `<span class="mudo">faltam ${r.faltando}</span>` : ''}</td>
          <td class="mini mudo">${r.periodo
            ? esc(r.periodo.split(' a ').map(brDate).join(' a ')) : '—'}</td>
          <td class="num mini">${r.lidos}</td>
          <td class="num mini forte">${r.gravados}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>` : ''}

  ${i.continua ? `<div style="margin-top:12px">${bloco('info',
    `O histórico vem por partes: o Bling não aceita filtro de período maior que um ano,
     e o servidor tem limite de chamadas por rodada. <strong>Clique em "Buscar histórico"
     de novo</strong> — cada clique avança um pedaço (páginas que faltaram, depois o ano
     anterior), e o que já veio está aqui e não se perde.`)}</div>` : ''}

  ${i.erro ? `<div style="margin-top:12px">${bloco('atencao',
    `Alguns recursos não vieram:<br><code class="mini">${esc(JSON.stringify(i.erro).slice(0, 400))}</code>`)}</div>` : ''}

  ${resumoCaixasBancos()}

  <div id="bl-saida" style="margin-top:14px"></div>

  <p class="mini mudo" style="margin-top:18px">
    O que é puxado: pedidos de venda, pedidos de compra, contas a pagar, contas a receber,
    notas fiscais de entrada, os lançamentos de caixas e bancos e o nome dos fornecedores. Com a sincronização
    ligada, você não precisa mais importar esses relatórios em arquivo.<br>
    Todo dia às 6h o painel olha sozinho as últimas três semanas e vai completando o valor das
    notas de entrada, que o Bling só entrega uma a uma. “Buscar histórico” volta no tempo um
    ano por vez (o Bling não aceita filtro maior que isso) — clique de novo para ir mais fundo.
  </p>`;
}

/**
 * Caixas e bancos: o extrato que era mantido dentro do Bling.
 *
 * Não vira lançamento — fica aqui como espelho, para conferir os meses
 * antigos contra o que o painel apurou.
 */
function resumoCaixasBancos() {
  const movs = estado.movimentos || [];
  if (!movs.length) return '';

  const datas = movs.map((m) => m.data).filter(Boolean).sort();
  const porConta = new Map();
  for (const m of movs) {
    const nome = m.conta || 'sem conta';
    const c = porConta.get(nome) || { entra: 0, sai: 0, n: 0 };
    c[m.entrada ? 'entra' : 'sai'] += Number(m.valor) || 0;
    c.n++;
    porConta.set(nome, c);
  }

  return `<div style="margin-top:18px">
    <div class="micro" style="margin-bottom:6px">Caixas e bancos do Bling —
      ${movs.length} lançamento(s), de ${esc(brDate(datas[0]))} a ${esc(brDate(datas[datas.length - 1]))}</div>
    <div class="tabela-rolagem"><table class="tabela tabela-compacta">
      <thead><tr><th>Conta</th><th class="num">Lanç.</th><th class="num">Entradas</th><th class="num">Saídas</th></tr></thead>
      <tbody>${[...porConta.entries()].map(([nome, c]) => `<tr>
        <td class="mini">${esc(nome)}</td>
        <td class="num mini">${c.n}</td>
        <td class="num mini pos">${brl(c.entra)}</td>
        <td class="num mini neg">${brl(c.sai)}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="mini mudo" style="margin-top:6px">Só para conferência: nada daqui entra no
      resultado do painel — o que vale são os extratos das contas.</p>
  </div>`;
}

const rotuloRecurso = (n) => ({
  pedidosVenda: 'Pedidos de venda', pedidosCompra: 'Pedidos de compra',
  notasEntrada: 'Notas fiscais de entrada', contasPagar: 'Contas a pagar',
  contasReceber: 'Contas a receber', contatos: 'Contatos',
  fornecedores: 'Nomes de fornecedor buscados',
  fornecedoresPendentes: 'Fornecedores ainda sem nome',
  caixas: 'Caixas e bancos (lançamentos)',
  contasContabeis: 'Caixas e bancos (as contas)',
  valoresDeNota: 'Valores de nota completados',
}[n] || n);

async function carregarBling() {
  try {
    blingInfo = await getBackend().pedir('/bling/estado');
  } catch (e) {
    blingInfo = { erroTela: String(e.message || e) };
  }
  const painel = document.querySelector('#painel-aba');
  if (painel && aba === 'integracoes') painel.innerHTML = conteudo();
}
