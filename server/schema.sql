-- ==========================================================================
-- DADOS PREVISION - Esquema PostgreSQL para VPS
-- ==========================================================================

CREATE TABLE IF NOT EXISTS projetos (
  id_prevision VARCHAR(64) PRIMARY KEY,
  nome_projeto TEXT NOT NULL,
  empresa_nome TEXT DEFAULT '-',
  endereco TEXT,
  data_inicio DATE,
  data_fim DATE,
  data_inicio_real DATE,
  data_fim_real DATE,
  progresso_realizado NUMERIC(8, 4) DEFAULT 0,
  progresso_planejado NUMERIC(8, 4) DEFAULT 0,
  progresso_revisado NUMERIC(8, 4) DEFAULT 0,
  percentual_previsto NUMERIC(8, 4) DEFAULT 0,
  percentual_realizado NUMERIC(8, 4) DEFAULT 0,
  percentual_revisado NUMERIC(8, 4) DEFAULT 0,
  restricoes JSONB DEFAULT '[]'::jsonb,
  resumo JSONB DEFAULT '{}'::jsonb,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS atividades (
  id_prevision VARCHAR(64) PRIMARY KEY,
  projeto_id VARCHAR(64) NOT NULL REFERENCES projetos(id_prevision) ON DELETE CASCADE,
  projeto_nome TEXT,
  codigo_eap TEXT,
  servico_id VARCHAR(64),
  servico_nome TEXT,
  pavimento_id VARCHAR(64),
  pavimento_nome TEXT,
  grupo_repeticao TEXT,
  posicao_servico INTEGER DEFAULT 999,
  posicao_pavimento INTEGER DEFAULT 999,
  data_inicio DATE,
  data_fim DATE,
  data_inicio_real DATE,
  data_fim_real DATE,
  duracao_dias NUMERIC(10, 2) DEFAULT 0,
  progresso_realizado NUMERIC(8, 4) DEFAULT 0,
  progresso_planejado NUMERIC(8, 4) DEFAULT 0,
  progresso_revisado NUMERIC(8, 4) DEFAULT 0,
  status TEXT,
  responsavel_nome TEXT,
  microservicos JSONB DEFAULT '[]'::jsonb,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_atividades_projeto ON atividades(projeto_id);
CREATE INDEX IF NOT EXISTS idx_atividades_datas ON atividades(data_inicio, data_fim);
CREATE INDEX IF NOT EXISTS idx_atividades_servico ON atividades(servico_nome);
CREATE INDEX IF NOT EXISTS idx_atividades_pavimento ON atividades(pavimento_nome);
CREATE INDEX IF NOT EXISTS idx_atividades_grupo ON atividades(grupo_repeticao);
CREATE INDEX IF NOT EXISTS idx_atividades_eap ON atividades(codigo_eap);

CREATE TABLE IF NOT EXISTS pavimentos (
  id_prevision VARCHAR(64) PRIMARY KEY,
  projeto_id VARCHAR(64) NOT NULL REFERENCES projetos(id_prevision) ON DELETE CASCADE,
  projeto_nome TEXT,
  nome TEXT NOT NULL,
  posicao INTEGER DEFAULT 0,
  grupo_repeticao TEXT,
  progresso_realizado NUMERIC(8, 4) DEFAULT 0,
  progresso_planejado NUMERIC(8, 4) DEFAULT 0,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pavimentos_projeto ON pavimentos(projeto_id);

CREATE TABLE IF NOT EXISTS servicos (
  id_prevision VARCHAR(64) PRIMARY KEY,
  projeto_id VARCHAR(64) NOT NULL REFERENCES projetos(id_prevision) ON DELETE CASCADE,
  projeto_nome TEXT,
  nome TEXT NOT NULL,
  posicao INTEGER DEFAULT 0,
  progresso_realizado NUMERIC(8, 4) DEFAULT 0,
  progresso_planejado NUMERIC(8, 4) DEFAULT 0,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_servicos_projeto ON servicos(projeto_id);

CREATE TABLE IF NOT EXISTS marcos (
  id_prevision VARCHAR(64) PRIMARY KEY,
  projeto_id VARCHAR(64) NOT NULL REFERENCES projetos(id_prevision) ON DELETE CASCADE,
  projeto_nome TEXT,
  nome TEXT NOT NULL,
  data_prevista DATE,
  data_realizada DATE,
  status TEXT,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marcos_projeto ON marcos(projeto_id);

CREATE TABLE IF NOT EXISTS linhas_base (
  id_prevision VARCHAR(64) PRIMARY KEY,
  projeto_id VARCHAR(64) NOT NULL REFERENCES projetos(id_prevision) ON DELETE CASCADE,
  projeto_nome TEXT,
  nome TEXT NOT NULL,
  descricao TEXT,
  data_criacao TIMESTAMP WITH TIME ZONE,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_linhas_base_projeto ON linhas_base(projeto_id);

CREATE TABLE IF NOT EXISTS responsaveis (
  id_prevision VARCHAR(64) PRIMARY KEY,
  projeto_id VARCHAR(64) NOT NULL REFERENCES projetos(id_prevision) ON DELETE CASCADE,
  projeto_nome TEXT,
  nome TEXT NOT NULL,
  email TEXT,
  funcao TEXT,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_responsaveis_projeto ON responsaveis(projeto_id);

CREATE TABLE IF NOT EXISTS cff_itens (
  id_prevision VARCHAR(64) PRIMARY KEY,
  projeto_id VARCHAR(64) NOT NULL REFERENCES projetos(id_prevision) ON DELETE CASCADE,
  projeto_nome TEXT,
  codigo TEXT,
  descricao TEXT NOT NULL,
  nivel INTEGER DEFAULT 1,
  unidade TEXT,
  quantidade NUMERIC(14, 4) DEFAULT 0,
  valor_unitario NUMERIC(14, 2) DEFAULT 0,
  valor_total NUMERIC(14, 2) DEFAULT 0,
  peso_percentual NUMERIC(8, 4) DEFAULT 0,
  distribuicao_mensal JSONB DEFAULT '[]'::jsonb,
  distribuicao_semanal JSONB DEFAULT '[]'::jsonb,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cff_itens_projeto ON cff_itens(projeto_id, nivel);

CREATE TABLE IF NOT EXISTS pesos_orcamento (
  id_prevision VARCHAR(64) PRIMARY KEY,
  projeto_id VARCHAR(64) NOT NULL REFERENCES projetos(id_prevision) ON DELETE CASCADE,
  projeto_nome TEXT,
  item_orcamento_id VARCHAR(64),
  atividade_id VARCHAR(64),
  peso NUMERIC(8, 4) DEFAULT 0,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pesos_orcamento_projeto ON pesos_orcamento(projeto_id);

CREATE TABLE IF NOT EXISTS medicoes (
  id_prevision VARCHAR(64) PRIMARY KEY,
  projeto_id VARCHAR(64) NOT NULL REFERENCES projetos(id_prevision) ON DELETE CASCADE,
  projeto_nome TEXT,
  data_medicao DATE NOT NULL,
  atividade_id VARCHAR(64),
  progresso_medido NUMERIC(8, 4) DEFAULT 0,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_medicoes_projeto_data ON medicoes(projeto_id, data_medicao);

CREATE TABLE IF NOT EXISTS analiticos (
  id_prevision VARCHAR(64) PRIMARY KEY,
  projeto_id VARCHAR(64) NOT NULL REFERENCES projetos(id_prevision) ON DELETE CASCADE,
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
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analiticos_projeto ON analiticos(projeto_id);
