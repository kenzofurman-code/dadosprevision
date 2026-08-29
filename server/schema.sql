-- Dados Prevision: esquema PostgreSQL idempotente para a aplicacao VPS.

CREATE TABLE IF NOT EXISTS projetos (
  id_prevision TEXT PRIMARY KEY,
  nome_projeto TEXT NOT NULL,
  empresa_nome TEXT DEFAULT '-',
  endereco TEXT,
  area NUMERIC,
  tipologia TEXT,
  fase TEXT,
  tipo_entrega TEXT,
  tipo_cronograma TEXT,
  imagem_url TEXT,
  secao_id TEXT,
  secao_nome TEXT,
  criado_em TIMESTAMPTZ,
  data_inicio DATE,
  data_fim DATE,
  ultima_medicao DATE,
  progresso_esperado NUMERIC,
  progresso_realizado NUMERIC,
  custo_orcado NUMERIC,
  custo_realizado NUMERIC,
  atraso_dias NUMERIC,
  idp NUMERIC,
  dias_desde_inicio NUMERIC,
  dias_ate_fim NUMERIC,
  status_dashboard TEXT,
  status TEXT,
  desativado BOOLEAN DEFAULT FALSE,
  total_atividades INTEGER DEFAULT 0,
  total_medicoes INTEGER DEFAULT 0,
  total_microservicos INTEGER DEFAULT 0,
  total_pavimentos INTEGER DEFAULT 0,
  total_servicos INTEGER DEFAULT 0,
  total_marcos INTEGER DEFAULT 0,
  total_linhas_base INTEGER DEFAULT 0,
  total_responsaveis INTEGER DEFAULT 0,
  total_restricoes INTEGER DEFAULT 0,
  total_orcamentos INTEGER DEFAULT 0,
  total_itens_cff INTEGER DEFAULT 0,
  total_pesos_orcamento INTEGER DEFAULT 0,
  total_dashboards INTEGER DEFAULT 0,
  restricoes JSONB DEFAULT '[]'::jsonb,
  resumo JSONB DEFAULT '{}'::jsonb,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS atividades (
  projeto_id TEXT NOT NULL REFERENCES projetos(id_prevision) ON DELETE CASCADE,
  id_prevision TEXT NOT NULL,
  projeto_nome TEXT,
  codigo_eap TEXT,
  servico_id TEXT,
  servico_nome TEXT,
  pavimento_id TEXT,
  pavimento_nome TEXT,
  grupo_repeticao TEXT,
  posicao_servico INTEGER,
  posicao_pavimento INTEGER,
  contador_parte TEXT,
  nivel_atividade TEXT,
  categorizacao TEXT,
  caminho_critico TEXT,
  linha_base_inicio DATE,
  linha_base_fim DATE,
  data_inicio DATE,
  data_fim DATE,
  duracao_dias NUMERIC,
  recursos_materiais TEXT,
  responsavel TEXT,
  custo_vinculado NUMERIC,
  custo_linha_base NUMERIC,
  primeira_medicao_em DATE,
  ultima_medicao_em DATE,
  predecessoras TEXT,
  sucessoras TEXT,
  ultima_medicao_data DATE,
  ultima_medicao_base NUMERIC,
  ultima_medicao_esperado NUMERIC,
  ultima_medicao_realizado NUMERIC,
  data_referencia DATE,
  progresso_fisico_base NUMERIC,
  progresso_esperado NUMERIC,
  progresso_realizado NUMERIC,
  data_referencia_unidade DATE,
  unidade_nome TEXT,
  unidade_simbolo TEXT,
  progresso_unidade_base NUMERIC,
  progresso_unidade_esperado NUMERIC,
  progresso_unidade_realizado NUMERIC,
  progresso_unidade_descricao TEXT,
  quantidade_unidade NUMERIC,
  saldo_unidade NUMERIC,
  ultima_medicao_progresso_unidade NUMERIC,
  data_real_inicio DATE,
  data_real_fim DATE,
  duracao_real TEXT,
  motivos_atraso TEXT,
  parte NUMERIC,
  possui_etapas BOOLEAN DEFAULT FALSE,
  total_microservicos INTEGER DEFAULT 0,
  microservicos_nomes TEXT,
  microservicos JSONB DEFAULT '[]'::jsonb,
  excluido_em TIMESTAMPTZ,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (projeto_id, id_prevision)
);

CREATE TABLE IF NOT EXISTS medicoes (
  projeto_id TEXT NOT NULL REFERENCES projetos(id_prevision) ON DELETE CASCADE,
  id_prevision TEXT NOT NULL,
  projeto_nome TEXT,
  atividade_id TEXT,
  codigo_eap TEXT,
  atividade_nome TEXT,
  servico_id TEXT,
  servico_nome TEXT,
  pavimento_id TEXT,
  pavimento_nome TEXT,
  unidade_simbolo TEXT,
  data_medicao DATE,
  progresso_base NUMERIC,
  progresso_esperado NUMERIC,
  progresso_realizado NUMERIC,
  motivos_atraso TEXT,
  observacoes TEXT,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (projeto_id, id_prevision)
);

CREATE TABLE IF NOT EXISTS pavimentos (
  projeto_id TEXT NOT NULL REFERENCES projetos(id_prevision) ON DELETE CASCADE,
  id_prevision TEXT NOT NULL,
  projeto_nome TEXT,
  nome TEXT,
  posicao INTEGER,
  area NUMERIC,
  tag TEXT,
  grupo_repeticao TEXT,
  data_inicio DATE,
  data_fim DATE,
  excluido_em TIMESTAMPTZ,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (projeto_id, id_prevision)
);

CREATE TABLE IF NOT EXISTS servicos (
  projeto_id TEXT NOT NULL REFERENCES projetos(id_prevision) ON DELETE CASCADE,
  id_prevision TEXT NOT NULL,
  projeto_nome TEXT,
  nome TEXT,
  posicao INTEGER,
  cor TEXT,
  unidade TEXT,
  data_inicio DATE,
  data_fim DATE,
  possui_atividades BOOLEAN DEFAULT FALSE,
  possui_etapas BOOLEAN DEFAULT FALSE,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (projeto_id, id_prevision)
);

CREATE TABLE IF NOT EXISTS marcos (
  projeto_id TEXT NOT NULL REFERENCES projetos(id_prevision) ON DELETE CASCADE,
  id_prevision TEXT NOT NULL,
  projeto_nome TEXT,
  nome TEXT,
  data DATE,
  cor TEXT,
  atributo_base TEXT,
  defasagem_dias NUMERIC,
  operacao_tempo TEXT,
  visivel_na_obra BOOLEAN DEFAULT FALSE,
  origem_incorporacao BOOLEAN DEFAULT FALSE,
  atividade_id TEXT,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (projeto_id, id_prevision)
);

CREATE TABLE IF NOT EXISTS linhas_base (
  projeto_id TEXT NOT NULL REFERENCES projetos(id_prevision) ON DELETE CASCADE,
  id_prevision TEXT NOT NULL,
  projeto_nome TEXT,
  nome TEXT,
  ativa BOOLEAN DEFAULT FALSE,
  criado_em TIMESTAMPTZ,
  versao_lob_id TEXT,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (projeto_id, id_prevision)
);

CREATE TABLE IF NOT EXISTS responsaveis (
  projeto_id TEXT NOT NULL REFERENCES projetos(id_prevision) ON DELETE CASCADE,
  id_prevision TEXT NOT NULL,
  projeto_nome TEXT,
  nome TEXT,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (projeto_id, id_prevision)
);

CREATE TABLE IF NOT EXISTS cff_itens (
  projeto_id TEXT NOT NULL REFERENCES projetos(id_prevision) ON DELETE CASCADE,
  id_prevision TEXT NOT NULL,
  projeto_nome TEXT,
  orcamento_id TEXT,
  orcamento_nome TEXT,
  codigo TEXT,
  descricao TEXT,
  nivel INTEGER,
  tipo_grupo TEXT,
  data_inicio_obra DATE,
  data_fim_obra DATE,
  data_inicio DATE,
  data_fim DATE,
  custo_mao_obra NUMERIC,
  custo_material NUMERIC,
  custo_total NUMERIC,
  ignorado_erp BOOLEAN DEFAULT FALSE,
  peso_base NUMERIC,
  peso_previsto NUMERIC,
  peso_realizado NUMERIC,
  peso_vinculado NUMERIC,
  total_pesos_atividades INTEGER DEFAULT 0,
  total_pesos_etapas INTEGER DEFAULT 0,
  atividades TEXT,
  servicos TEXT,
  lotes TEXT,
  pontos_mensais JSONB DEFAULT '[]'::jsonb,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (projeto_id, id_prevision)
);

CREATE TABLE IF NOT EXISTS pesos_orcamento (
  projeto_id TEXT NOT NULL REFERENCES projetos(id_prevision) ON DELETE CASCADE,
  id_prevision TEXT NOT NULL,
  projeto_nome TEXT,
  orcamento_id TEXT,
  orcamento_nome TEXT,
  id_item_orcamento TEXT,
  codigo TEXT,
  descricao TEXT,
  nivel INTEGER,
  porcentagem NUMERIC,
  id_atividade TEXT,
  servico_nome TEXT,
  pavimento_nome TEXT,
  microservicos JSONB DEFAULT '[]'::jsonb,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (projeto_id, id_prevision)
);

CREATE TABLE IF NOT EXISTS analiticos (
  projeto_id TEXT NOT NULL REFERENCES projetos(id_prevision) ON DELETE CASCADE,
  id_prevision TEXT NOT NULL,
  projeto_nome TEXT,
  orcamentos JSONB DEFAULT '[]'::jsonb,
  cff_resumo JSONB DEFAULT '[]'::jsonb,
  dashboard_geral JSONB DEFAULT '[]'::jsonb,
  dashboard_semanal JSONB DEFAULT '[]'::jsonb,
  dashboard_mensal JSONB DEFAULT '[]'::jsonb,
  dashboard_servicos JSONB DEFAULT '[]'::jsonb,
  dashboard_lotes JSONB DEFAULT '[]'::jsonb,
  dashboard_estados JSONB DEFAULT '[]'::jsonb,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (projeto_id, id_prevision)
);

-- Migra volumes criados pelas primeiras versoes da stack VPS.
ALTER TABLE projetos
  ADD COLUMN IF NOT EXISTS area NUMERIC,
  ADD COLUMN IF NOT EXISTS tipologia TEXT,
  ADD COLUMN IF NOT EXISTS fase TEXT,
  ADD COLUMN IF NOT EXISTS tipo_entrega TEXT,
  ADD COLUMN IF NOT EXISTS tipo_cronograma TEXT,
  ADD COLUMN IF NOT EXISTS imagem_url TEXT,
  ADD COLUMN IF NOT EXISTS secao_id TEXT,
  ADD COLUMN IF NOT EXISTS secao_nome TEXT,
  ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ultima_medicao DATE,
  ADD COLUMN IF NOT EXISTS progresso_esperado NUMERIC,
  ADD COLUMN IF NOT EXISTS custo_orcado NUMERIC,
  ADD COLUMN IF NOT EXISTS custo_realizado NUMERIC,
  ADD COLUMN IF NOT EXISTS atraso_dias NUMERIC,
  ADD COLUMN IF NOT EXISTS idp NUMERIC,
  ADD COLUMN IF NOT EXISTS dias_desde_inicio NUMERIC,
  ADD COLUMN IF NOT EXISTS dias_ate_fim NUMERIC,
  ADD COLUMN IF NOT EXISTS status_dashboard TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS desativado BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS total_atividades INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_medicoes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_microservicos INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_pavimentos INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_servicos INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_marcos INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_linhas_base INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_responsaveis INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_restricoes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_orcamentos INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_itens_cff INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_pesos_orcamento INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_dashboards INTEGER DEFAULT 0;

ALTER TABLE atividades
  ADD COLUMN IF NOT EXISTS posicao_pavimento INTEGER,
  ADD COLUMN IF NOT EXISTS contador_parte TEXT, ADD COLUMN IF NOT EXISTS nivel_atividade TEXT,
  ADD COLUMN IF NOT EXISTS categorizacao TEXT, ADD COLUMN IF NOT EXISTS caminho_critico TEXT,
  ADD COLUMN IF NOT EXISTS linha_base_inicio DATE, ADD COLUMN IF NOT EXISTS linha_base_fim DATE,
  ADD COLUMN IF NOT EXISTS recursos_materiais TEXT, ADD COLUMN IF NOT EXISTS responsavel TEXT,
  ADD COLUMN IF NOT EXISTS custo_vinculado NUMERIC, ADD COLUMN IF NOT EXISTS custo_linha_base NUMERIC,
  ADD COLUMN IF NOT EXISTS primeira_medicao_em DATE, ADD COLUMN IF NOT EXISTS ultima_medicao_em DATE,
  ADD COLUMN IF NOT EXISTS predecessoras TEXT, ADD COLUMN IF NOT EXISTS sucessoras TEXT,
  ADD COLUMN IF NOT EXISTS ultima_medicao_data DATE, ADD COLUMN IF NOT EXISTS ultima_medicao_base NUMERIC,
  ADD COLUMN IF NOT EXISTS ultima_medicao_esperado NUMERIC, ADD COLUMN IF NOT EXISTS ultima_medicao_realizado NUMERIC,
  ADD COLUMN IF NOT EXISTS data_referencia DATE, ADD COLUMN IF NOT EXISTS progresso_fisico_base NUMERIC,
  ADD COLUMN IF NOT EXISTS progresso_esperado NUMERIC, ADD COLUMN IF NOT EXISTS data_referencia_unidade DATE,
  ADD COLUMN IF NOT EXISTS unidade_nome TEXT, ADD COLUMN IF NOT EXISTS unidade_simbolo TEXT,
  ADD COLUMN IF NOT EXISTS progresso_unidade_base NUMERIC, ADD COLUMN IF NOT EXISTS progresso_unidade_esperado NUMERIC,
  ADD COLUMN IF NOT EXISTS progresso_unidade_realizado NUMERIC, ADD COLUMN IF NOT EXISTS progresso_unidade_descricao TEXT,
  ADD COLUMN IF NOT EXISTS quantidade_unidade NUMERIC, ADD COLUMN IF NOT EXISTS saldo_unidade NUMERIC,
  ADD COLUMN IF NOT EXISTS ultima_medicao_progresso_unidade NUMERIC, ADD COLUMN IF NOT EXISTS data_real_inicio DATE,
  ADD COLUMN IF NOT EXISTS data_real_fim DATE, ADD COLUMN IF NOT EXISTS duracao_real TEXT,
  ADD COLUMN IF NOT EXISTS motivos_atraso TEXT, ADD COLUMN IF NOT EXISTS parte NUMERIC,
  ADD COLUMN IF NOT EXISTS possui_etapas BOOLEAN DEFAULT FALSE, ADD COLUMN IF NOT EXISTS total_microservicos INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS microservicos_nomes TEXT, ADD COLUMN IF NOT EXISTS excluido_em TIMESTAMPTZ;

ALTER TABLE medicoes
  ADD COLUMN IF NOT EXISTS codigo_eap TEXT, ADD COLUMN IF NOT EXISTS atividade_nome TEXT,
  ADD COLUMN IF NOT EXISTS servico_id TEXT, ADD COLUMN IF NOT EXISTS servico_nome TEXT,
  ADD COLUMN IF NOT EXISTS pavimento_id TEXT, ADD COLUMN IF NOT EXISTS pavimento_nome TEXT,
  ADD COLUMN IF NOT EXISTS unidade_simbolo TEXT, ADD COLUMN IF NOT EXISTS progresso_base NUMERIC,
  ADD COLUMN IF NOT EXISTS progresso_esperado NUMERIC, ADD COLUMN IF NOT EXISTS progresso_realizado NUMERIC,
  ADD COLUMN IF NOT EXISTS motivos_atraso TEXT, ADD COLUMN IF NOT EXISTS observacoes TEXT;
ALTER TABLE medicoes ALTER COLUMN data_medicao DROP NOT NULL;

ALTER TABLE pavimentos
  ADD COLUMN IF NOT EXISTS area NUMERIC, ADD COLUMN IF NOT EXISTS tag TEXT,
  ADD COLUMN IF NOT EXISTS data_inicio DATE, ADD COLUMN IF NOT EXISTS data_fim DATE,
  ADD COLUMN IF NOT EXISTS excluido_em TIMESTAMPTZ;
ALTER TABLE servicos
  ADD COLUMN IF NOT EXISTS cor TEXT, ADD COLUMN IF NOT EXISTS unidade TEXT,
  ADD COLUMN IF NOT EXISTS data_inicio DATE, ADD COLUMN IF NOT EXISTS data_fim DATE,
  ADD COLUMN IF NOT EXISTS possui_atividades BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS possui_etapas BOOLEAN DEFAULT FALSE;
ALTER TABLE marcos
  ADD COLUMN IF NOT EXISTS data DATE, ADD COLUMN IF NOT EXISTS cor TEXT,
  ADD COLUMN IF NOT EXISTS atributo_base TEXT, ADD COLUMN IF NOT EXISTS defasagem_dias NUMERIC,
  ADD COLUMN IF NOT EXISTS operacao_tempo TEXT, ADD COLUMN IF NOT EXISTS visivel_na_obra BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS origem_incorporacao BOOLEAN DEFAULT FALSE, ADD COLUMN IF NOT EXISTS atividade_id TEXT;
ALTER TABLE linhas_base
  ADD COLUMN IF NOT EXISTS ativa BOOLEAN DEFAULT FALSE, ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS versao_lob_id TEXT;
ALTER TABLE linhas_base ALTER COLUMN nome DROP NOT NULL;

ALTER TABLE cff_itens
  ADD COLUMN IF NOT EXISTS orcamento_id TEXT, ADD COLUMN IF NOT EXISTS orcamento_nome TEXT,
  ADD COLUMN IF NOT EXISTS tipo_grupo TEXT, ADD COLUMN IF NOT EXISTS data_inicio_obra DATE,
  ADD COLUMN IF NOT EXISTS data_fim_obra DATE, ADD COLUMN IF NOT EXISTS data_inicio DATE,
  ADD COLUMN IF NOT EXISTS data_fim DATE, ADD COLUMN IF NOT EXISTS custo_mao_obra NUMERIC,
  ADD COLUMN IF NOT EXISTS custo_material NUMERIC, ADD COLUMN IF NOT EXISTS custo_total NUMERIC,
  ADD COLUMN IF NOT EXISTS ignorado_erp BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS peso_base NUMERIC, ADD COLUMN IF NOT EXISTS peso_previsto NUMERIC,
  ADD COLUMN IF NOT EXISTS peso_realizado NUMERIC, ADD COLUMN IF NOT EXISTS peso_vinculado NUMERIC,
  ADD COLUMN IF NOT EXISTS total_pesos_atividades INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_pesos_etapas INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS atividades TEXT, ADD COLUMN IF NOT EXISTS servicos TEXT,
  ADD COLUMN IF NOT EXISTS lotes TEXT, ADD COLUMN IF NOT EXISTS pontos_mensais JSONB DEFAULT '[]'::jsonb;
ALTER TABLE pesos_orcamento
  ADD COLUMN IF NOT EXISTS orcamento_id TEXT, ADD COLUMN IF NOT EXISTS orcamento_nome TEXT,
  ADD COLUMN IF NOT EXISTS id_item_orcamento TEXT, ADD COLUMN IF NOT EXISTS codigo TEXT,
  ADD COLUMN IF NOT EXISTS descricao TEXT, ADD COLUMN IF NOT EXISTS nivel INTEGER,
  ADD COLUMN IF NOT EXISTS porcentagem NUMERIC, ADD COLUMN IF NOT EXISTS id_atividade TEXT,
  ADD COLUMN IF NOT EXISTS servico_nome TEXT, ADD COLUMN IF NOT EXISTS pavimento_nome TEXT,
  ADD COLUMN IF NOT EXISTS microservicos JSONB DEFAULT '[]'::jsonb;

-- IDs da Prevision podem se repetir entre projetos; toda entidade filha usa chave composta.
DO $$
DECLARE
  item RECORD;
  current_constraint_name TEXT;
  current_definition TEXT;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('atividades'), ('medicoes'), ('pavimentos'), ('servicos'), ('marcos'),
      ('linhas_base'), ('responsaveis'), ('cff_itens'), ('pesos_orcamento'), ('analiticos')
    ) AS keys(table_name)
  LOOP
    SELECT conname, pg_get_constraintdef(oid)
      INTO current_constraint_name, current_definition
      FROM pg_constraint
     WHERE conrelid = to_regclass(item.table_name) AND contype = 'p';

    IF current_definition IS DISTINCT FROM 'PRIMARY KEY (projeto_id, id_prevision)' THEN
      IF current_constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', item.table_name, current_constraint_name);
      END IF;
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I PRIMARY KEY (projeto_id, id_prevision)',
        item.table_name,
        item.table_name || '_pkey'
      );
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_atividades_projeto ON atividades(projeto_id);
CREATE INDEX IF NOT EXISTS idx_atividades_ordem_v2
  ON atividades(projeto_id, posicao_servico, posicao_pavimento, servico_nome, pavimento_nome);
CREATE INDEX IF NOT EXISTS idx_medicoes_projeto_data ON medicoes(projeto_id, data_medicao);
CREATE INDEX IF NOT EXISTS idx_medicoes_atividade_data ON medicoes(projeto_id, atividade_id, data_medicao);
CREATE INDEX IF NOT EXISTS idx_pavimentos_projeto ON pavimentos(projeto_id);
CREATE INDEX IF NOT EXISTS idx_servicos_projeto ON servicos(projeto_id);
CREATE INDEX IF NOT EXISTS idx_marcos_projeto ON marcos(projeto_id);
CREATE INDEX IF NOT EXISTS idx_linhas_base_projeto ON linhas_base(projeto_id);
CREATE INDEX IF NOT EXISTS idx_responsaveis_projeto ON responsaveis(projeto_id);
CREATE INDEX IF NOT EXISTS idx_cff_itens_projeto ON cff_itens(projeto_id, nivel);
CREATE INDEX IF NOT EXISTS idx_pesos_orcamento_projeto ON pesos_orcamento(projeto_id);
CREATE INDEX IF NOT EXISTS idx_analiticos_projeto ON analiticos(projeto_id);
