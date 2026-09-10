-- Banco do painel financeiro da Móvel5 (Cloudflare D1 / SQLite).
--
-- Os registros são guardados como JSON numa tabela só. O painel carrega tudo
-- na memória e faz as contas no navegador, então não há consulta complexa no
-- servidor — e o formato pode evoluir sem migração a cada mudança.

CREATE TABLE IF NOT EXISTS registros (
  colecao     TEXT NOT NULL,
  id          TEXT NOT NULL,
  dados       TEXT NOT NULL,          -- JSON do registro
  competencia TEXT,                   -- só para lançamentos e fechamentos
  atualizado  INTEGER NOT NULL,
  PRIMARY KEY (colecao, id)
);

CREATE INDEX IF NOT EXISTS idx_registros_colecao ON registros (colecao);
CREATE INDEX IF NOT EXISTS idx_registros_competencia ON registros (colecao, competencia);

CREATE TABLE IF NOT EXISTS usuarios (
  usuario    TEXT PRIMARY KEY,
  nome       TEXT NOT NULL,
  senha_hash TEXT NOT NULL,           -- pbkdf2$<iterações>$<salt>$<hash>, tudo em base64
  criado_em  INTEGER NOT NULL,
  token_ver  INTEGER NOT NULL DEFAULT 1   -- muda ao trocar a senha e invalida as sessões antigas
);

-- Trilha simples de quem mexeu em quê.
CREATE TABLE IF NOT EXISTS auditoria (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT NOT NULL,
  acao    TEXT NOT NULL,
  colecao TEXT,
  qtd     INTEGER,
  em      INTEGER NOT NULL
);
