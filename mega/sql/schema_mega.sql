-- Schema mega: dados extraidos do Mega ERP. Dono: o servico "mega" (Python).
-- O schema "public" e do app Node (server/schema.sql) — nunca escrever la.
-- Idempotente: pode ser reaplicado a cada subida do container, como o
-- server/db.js do Dados Prevision ja faz com o schema public.

CREATE SCHEMA IF NOT EXISTS mega;

-- Ponte com a Prevision. SEM chave estrangeira de proposito: o sync da
-- Prevision recria projetos com ON DELETE CASCADE, e uma FK rigida faria a
-- carga do Mega falhar sempre que o lado Prevision mudasse.
CREATE TABLE IF NOT EXISTS mega.obra_projeto (
  obra          TEXT PRIMARY KEY,
  id_prevision  TEXT,
  observacao    TEXT
);

-- ---------------------------------------------------------------------------
-- Tabelas "atual": recarregadas por obra (DELETE+INSERT transacional) a cada
-- execucao noturna. raw_data guarda a linha original inteira em JSON, para as
-- colunas cujo nome final ainda nao foi fixado (ver tradutor.RENOMEIO_MANUAL).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mega.itens_solicitados (
  obra                    TEXT NOT NULL,
  obra_nome               TEXT,
  data_extracao           DATE NOT NULL,
  codigo_solicitacao      BIGINT,
  numero_rm               BIGINT,
  sequencial_item         INTEGER,
  data_de_emissao         DATE,
  situacao_do_item        TEXT,
  descricao_do_item       TEXT,
  quantidade_solicitada   NUMERIC,
  quantidade_baixada      NUMERIC,
  unidade                 TEXT,
  raw_data                JSONB DEFAULT '{}'::jsonb,
  PRIMARY KEY (obra, codigo_solicitacao, numero_rm, sequencial_item)
);
CREATE INDEX IF NOT EXISTS idx_mega_itens_solicitados_obra
  ON mega.itens_solicitados(obra);

CREATE TABLE IF NOT EXISTS mega.visualizacao_itens (
  obra                TEXT NOT NULL,
  obra_nome           TEXT,
  data_extracao       DATE NOT NULL,
  orcamento           BIGINT,
  solicitacao         BIGINT NOT NULL,
  sequencia           INTEGER NOT NULL,
  fornecedor          TEXT NOT NULL,
  cod_item            BIGINT,
  descricao           TEXT,
  qtde_solicitada     NUMERIC,
  data_de_necessidade DATE,
  data_inclusao       TIMESTAMPTZ,
  valor_total         NUMERIC,
  situacao_do_item    TEXT,
  cod_cotacao         BIGINT,
  cod_pedido          BIGINT,
  cod_contrato        BIGINT,
  raw_data            JSONB DEFAULT '{}'::jsonb,
  PRIMARY KEY (obra, solicitacao, sequencia, fornecedor)
);
CREATE INDEX IF NOT EXISTS idx_mega_visualizacao_itens_obra
  ON mega.visualizacao_itens(obra);
CREATE INDEX IF NOT EXISTS idx_mega_visualizacao_itens_necessidade
  ON mega.visualizacao_itens(data_de_necessidade);

-- Trilha de situacao: so existe para visualizacao_itens (e a unica com
-- historico de etapa aprovado). ate = NULL significa "vigente hoje".
CREATE TABLE IF NOT EXISTS mega.item_situacao_hist (
  obra        TEXT NOT NULL,
  solicitacao BIGINT NOT NULL,
  sequencia   INTEGER NOT NULL,
  fornecedor  TEXT NOT NULL,
  situacao    TEXT,
  etapa       TEXT NOT NULL,
  desde       DATE NOT NULL,
  ate         DATE,
  PRIMARY KEY (obra, solicitacao, sequencia, fornecedor, desde)
);
CREATE INDEX IF NOT EXISTS idx_mega_item_situacao_vigente
  ON mega.item_situacao_hist(obra, solicitacao, sequencia, fornecedor)
  WHERE ate IS NULL;

CREATE TABLE IF NOT EXISTS mega.pedidos_compra (
  obra                TEXT NOT NULL,
  obra_nome           TEXT,
  data_extracao       DATE NOT NULL,
  numero_do_pedido    BIGINT NOT NULL,
  item_pedido         INTEGER NOT NULL,
  situacao_do_pedido  TEXT,
  dt_emissao          DATE,
  nome_fantasia       TEXT,
  descricao_do_item   TEXT,
  quantidade          NUMERIC,
  total_pedido_compra NUMERIC,
  raw_data            JSONB DEFAULT '{}'::jsonb,
  PRIMARY KEY (obra, numero_do_pedido, item_pedido)
);
CREATE INDEX IF NOT EXISTS idx_mega_pedidos_compra_obra
  ON mega.pedidos_compra(obra);

CREATE TABLE IF NOT EXISTS mega.solicitacoes_por_etapa (
  id                  BIGSERIAL PRIMARY KEY,
  obra                TEXT NOT NULL,
  obra_nome           TEXT,
  data_extracao       DATE NOT NULL,
  codigo_solicitacao  BIGINT NOT NULL,
  data_de_emissao     DATE,
  projeto             TEXT,
  sequencial_item     INTEGER NOT NULL,
  codigo_etapa        TEXT,
  numero_insumo       BIGINT,
  descricao_insumo    TEXT,
  data_de_necessidade DATE,
  situacao_do_item    TEXT,
  raw_data            JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_mega_solicitacoes_etapa_obra
  ON mega.solicitacoes_por_etapa(obra);
CREATE INDEX IF NOT EXISTS idx_mega_solicitacoes_etapa_chave
  ON mega.solicitacoes_por_etapa(obra, codigo_solicitacao, sequencial_item);


CREATE TABLE IF NOT EXISTS mega.analise_realizado (
  id              BIGSERIAL PRIMARY KEY,   -- sintetico: nao ha chave natural limpa
  obra            TEXT NOT NULL,
  obra_nome       TEXT,
  data_extracao   DATE NOT NULL,
  documento       BIGINT,
  data_documento  DATE,
  ap              NUMERIC,
  fornecedor      TEXT,
  valor_apropriacao NUMERIC,
  raw_data        JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_mega_analise_realizado_obra
  ON mega.analise_realizado(obra);

-- ---------------------------------------------------------------------------
-- Tabelas "historico": so recebem INSERT, empilhadas por data_extracao.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mega.analise_pedidos_hist (
  id                BIGSERIAL PRIMARY KEY,
  obra              TEXT NOT NULL,
  obra_nome         TEXT,
  data_extracao     DATE NOT NULL,
  codigo_pedido     BIGINT,
  fornecedor        TEXT,
  qtde_pedido       NUMERIC,
  valor_unitario    NUMERIC,
  qtde_apropriada   NUMERIC,
  valor_apropriacao NUMERIC,
  raw_data          JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_mega_analise_pedidos_hist_obra_data
  ON mega.analise_pedidos_hist(obra, data_extracao);

CREATE TABLE IF NOT EXISTS mega.analise_contratos_hist (
  id                     BIGSERIAL PRIMARY KEY,
  obra                   TEXT NOT NULL,
  obra_nome              TEXT,
  data_extracao          DATE NOT NULL,
  codigo_contrato        BIGINT,
  fornecedor             TEXT,
  status_pre_contrato    TEXT,
  saldo_qtde_contrato    NUMERIC,
  valor_unitario         NUMERIC,
  total                  NUMERIC,
  raw_data               JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_mega_analise_contratos_hist_obra_data
  ON mega.analise_contratos_hist(obra, data_extracao);

-- Manifesto de cada carga: o que rodou, quando, o que falhou.
CREATE TABLE IF NOT EXISTS mega.carga (
  id            BIGSERIAL PRIMARY KEY,
  relatorio     TEXT NOT NULL,
  arquivo       TEXT NOT NULL,
  data_extracao DATE NOT NULL,
  obras_ok            TEXT[] DEFAULT '{}',
  obras_sem_movimento TEXT[] DEFAULT '{}',
  obras_falhou        TEXT[] DEFAULT '{}',
  bloqueado     BOOLEAN NOT NULL DEFAULT FALSE,
  motivo_bloqueio TEXT,
  executado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mega_carga_data
  ON mega.carga(data_extracao);

-- ---------------------------------------------------------------------------
-- Approvo Mega ERP: Documentos e Trilha de Ocorrências / Aprovações
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mega.approvo_documentos (
  id                    BIGSERIAL PRIMARY KEY,
  obra                  TEXT,
  numero                BIGINT NOT NULL,
  tipo_documento        TEXT NOT NULL,
  data_documento        DATE,
  status                TEXT,
  valor                 NUMERIC,
  filial                TEXT NOT NULL,
  agente                TEXT,
  solicitante           TEXT,
  data_envio_aprovacao  DATE,
  classe_financeira     TEXT,
  centro_custo          TEXT,
  projeto               TEXT,
  regra_aprovacao       TEXT,
  data_extracao         DATE NOT NULL,
  raw_data              JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT uq_approvo_documentos UNIQUE (filial, tipo_documento, numero)
);
CREATE INDEX IF NOT EXISTS idx_mega_approvo_documentos_obra
  ON mega.approvo_documentos(obra);
CREATE INDEX IF NOT EXISTS idx_mega_approvo_documentos_status
  ON mega.approvo_documentos(status);
CREATE INDEX IF NOT EXISTS idx_mega_approvo_documentos_data
  ON mega.approvo_documentos(data_documento);

CREATE TABLE IF NOT EXISTS mega.approvo_ocorrencias (
  id                  BIGSERIAL PRIMARY KEY,
  obra                TEXT,
  numero_documento    BIGINT NOT NULL,
  acao                TEXT NOT NULL,
  data_aprovacao      DATE,
  hora_aprovacao      TIME,
  data_hora           TIMESTAMP,
  data_hora_texto     TEXT,
  aprovador           TEXT NOT NULL,
  motivo_operacao     TEXT,
  tipo_documento      TEXT NOT NULL,
  data_documento      DATE,
  valor               NUMERIC,
  filial              TEXT NOT NULL,
  agente              TEXT,
  solicitante         TEXT,
  data_extracao       DATE NOT NULL,
  raw_data            JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT uq_approvo_ocorrencias UNIQUE (filial, tipo_documento, numero_documento, data_aprovacao, hora_aprovacao, aprovador, acao)
);
CREATE INDEX IF NOT EXISTS idx_mega_approvo_ocorrencias_doc
  ON mega.approvo_ocorrencias(numero_documento);
CREATE INDEX IF NOT EXISTS idx_mega_approvo_ocorrencias_obra
  ON mega.approvo_ocorrencias(obra);
CREATE INDEX IF NOT EXISTS idx_mega_approvo_ocorrencias_data
  ON mega.approvo_ocorrencias(data_aprovacao);

-- ---------------------------------------------------------------------------
-- medicoes_contratos: espelho de medições de contratos de empreiteiros
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mega.medicoes_contratos (
  obra                    TEXT NOT NULL,
  obra_nome               TEXT,
  data_extracao           DATE NOT NULL,
  numero_contrato         BIGINT NOT NULL,
  numero_medicao          BIGINT NOT NULL,
  item_sequencial         INTEGER NOT NULL,
  periodo_inicio          DATE,
  periodo_fim             DATE,
  descricao_servico       TEXT,
  unidade                 TEXT,
  quantidade_medida       NUMERIC,
  valor_unitario          NUMERIC,
  valor_total             NUMERIC,
  valor_faturado          NUMERIC,
  fornecedor_nome         TEXT,
  fornecedor_cnpj         TEXT,
  data_emissao            DATE,
  situacao_medicao        TEXT,
  inss                    NUMERIC DEFAULT 0,
  iss                     NUMERIC DEFAULT 0,
  irrf                    NUMERIC DEFAULT 0,
  caucao                  NUMERIC DEFAULT 0,
  raw_data                JSONB DEFAULT '{}'::jsonb,
  PRIMARY KEY (obra, numero_contrato, numero_medicao, item_sequencial)
);
CREATE INDEX IF NOT EXISTS idx_mega_medicoes_obra
  ON mega.medicoes_contratos(obra);
CREATE INDEX IF NOT EXISTS idx_mega_medicoes_contrato
  ON mega.medicoes_contratos(numero_contrato);

-- ---------------------------------------------------------------------------
-- contratos_itens: follow-up de itens de contratos de empreiteiros
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mega.contratos_itens (
  obra                    TEXT NOT NULL,
  obra_nome               TEXT,
  data_extracao           DATE NOT NULL,
  cod_contrato            BIGINT NOT NULL,
  cod_item                BIGINT NOT NULL,
  cod_alternativo         TEXT,
  consolidador            TEXT,
  cod_agrupador           BIGINT,
  aditivo                 TEXT NOT NULL DEFAULT '',
  item_alternativo        TEXT,
  descricao               TEXT,
  cod_padrao              TEXT,
  cod_unidade             TEXT,
  unidade                 TEXT,
  quantidade              NUMERIC,
  valor_unitario          NUMERIC,
  total_item              NUMERIC,
  total_contratado        NUMERIC,
  situacao                TEXT,
  raw_data                JSONB DEFAULT '{}'::jsonb,
  PRIMARY KEY (obra, cod_contrato, cod_item, aditivo)
);
CREATE INDEX IF NOT EXISTS idx_mega_contratos_itens_obra
  ON mega.contratos_itens(obra);
CREATE INDEX IF NOT EXISTS idx_mega_contratos_itens_contrato
  ON mega.contratos_itens(cod_contrato);

