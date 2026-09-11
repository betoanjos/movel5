// Back-end local: IndexedDB. Funciona offline e sem nenhum servidor —
// é o modo em que o painel roda direto no navegador.
const BANCO = 'movel5-financeiro';
const VERSAO = 3;   // 2: contasReceber (Bling); 3: movimentos (caixas e bancos)

export const COLECOES = [
  'contas', 'lancamentos', 'categorias', 'regras', 'fechamentos',
  'vendas', 'compras', 'contasPagar', 'contasReceber', 'contrapartes',
  'enriquecimentos', 'diasVenda', 'config', 'importacoes', 'movimentos',
];

let _db = null;

function abrir() {
  if (_db) return Promise.resolve(_db);
  return new Promise((ok, err) => {
    const req = indexedDB.open(BANCO, VERSAO);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const c of COLECOES) {
        if (!db.objectStoreNames.contains(c)) {
          const st = db.createObjectStore(c, { keyPath: 'id' });
          if (c === 'lancamentos') {
            st.createIndex('competencia', 'competencia');
            st.createIndex('conta_id', 'conta_id');
            st.createIndex('dedupe', 'dedupe', { unique: false });
          }
          if (c === 'contrapartes') st.createIndex('documento', 'documento');
        }
      }
    };
    req.onsuccess = () => { _db = req.result; ok(_db); };
    req.onerror = () => err(req.error);
  });
}

const transacao = async (colecoes, modo) => {
  const db = await abrir();
  return db.transaction(colecoes, modo);
};

const promessa = (req) => new Promise((ok, err) => {
  req.onsuccess = () => ok(req.result);
  req.onerror = () => err(req.error);
});

export const backendLocal = {
  nome: 'local',

  async listar(colecao) {
    const tx = await transacao([colecao], 'readonly');
    return promessa(tx.objectStore(colecao).getAll());
  },

  async gravar(colecao, registros) {
    if (!registros.length) return 0;
    const tx = await transacao([colecao], 'readwrite');
    const st = tx.objectStore(colecao);
    for (const r of registros) st.put(r);
    await new Promise((ok, err) => { tx.oncomplete = ok; tx.onerror = () => err(tx.error); });
    return registros.length;
  },

  async remover(colecao, ids) {
    const lista = Array.isArray(ids) ? ids : [ids];
    if (!lista.length) return 0;
    const tx = await transacao([colecao], 'readwrite');
    const st = tx.objectStore(colecao);
    for (const id of lista) st.delete(id);
    await new Promise((ok, err) => { tx.oncomplete = ok; tx.onerror = () => err(tx.error); });
    return lista.length;
  },

  async limpar(colecao) {
    const tx = await transacao([colecao], 'readwrite');
    tx.objectStore(colecao).clear();
    return new Promise((ok, err) => { tx.oncomplete = () => ok(true); tx.onerror = () => err(tx.error); });
  },

  async apagarTudo() {
    for (const c of COLECOES) await this.limpar(c);
  },
};
