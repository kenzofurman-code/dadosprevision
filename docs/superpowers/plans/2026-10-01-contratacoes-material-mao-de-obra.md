# Contratações — Material × Mão de obra, pedido/contrato com realizado, micro rápido em tabela e flags — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Separar Contratações em abas Material | Mão de obra a partir da classificação de insumos, fazer Pedido + Contrato = Comprometido (incluindo o realizado), mostrar o total da obra, abrir grupos rápido, micro em tabela com medições resumidas e flags por fase.

**Architecture:** Regras puras em `server/contratacoes.js` (classificação, leitura da projeção por insumo, macro por tipo, flags, resumo de medições), testadas com `node:test`. Banco em `server/contratacoes-db.js`: valores por **etapa|tipo**; nova tabela `insumo_classificacao`; `custo_projetado_itens` ganha `descricao`; `contratacao_grupo_etapas` ganha `tipo` (unicidade por etapa **e tipo**). Tela: abas no macro, aba "Insumos" na configuração, micro em tabela.

**Tech Stack:** Node ESM + `node:test`, Postgres, React/TS (Vite), `xlsx`.

**Spec:** `docs/superpowers/specs/2026-09-30-contratacoes-material-mao-de-obra-design.md` (+ decisões de 2026-10-01 abaixo).

## Decisões de 2026-10-01 (usuário)

- Pedido = realizado vindo de pedido + saldo de pedido; Contrato = realizado vindo de contrato + saldo de contrato; Comprometido = Pedido + Contrato; Realizado é coluna à parte.
- Origem da apropriação (Análise Realizado, `raw_data.origem`): **E = empreiteiro → contrato**; **R → pedido** (recebimento de material; confirmado nos dados: chapa/perfil/fita = R, MO = E); **MVI** (movimento inicial), **CPA** e vazio → pelo tipo do insumo (mão de obra → contrato, material → pedido).
- Total da obra = total importado da projeção (R$ 95,9 mi no POTY), separado em material e mão de obra; resumo mostra também "em grupos" e "fora de grupos".
- Custos indiretos (16, 21–24…): nada especial agora; entram como qualquer etapa (fora de grupo até o usuário atribuir).

## Global Constraints

- Classificação: `SE` = mão de obra; `MT`, `EQ`, `OU` = material. Descrição normalizada "ITENS FORA DE ORCAMENTO" = material sempre.
- Prioridade: override da obra (por descrição) > empresa por código > empresa por descrição > heurística (descrição começa com "MO " = mão de obra, senão material) — itens resolvidos pela heurística são listados como "sem classificação".
- Projeção: usar as linhas **N5** (somam exatamente as N4; conferido no POTY = R$ 95.899.744). Sem coluna NÍVEL, todas as linhas de 5 níveis.
- Insumo em cada fonte: projeção = DESCRIÇÃO; solicitações = `solicitacoes_por_etapa.numero_insumo`/`descricao_insumo`; saldos = `raw_data.cod_insumo`/`descricao_insumo`; realizado = `raw_data.cod_item`/`descricao_1`.
- Uma etapa: no máximo um grupo de **cada tipo** por obra.
- Schema `mega` só leitura para o `app`.

## Review Focus

1. Importação antiga sem `descricao` → tudo entra como material (não quebra); aviso para reimportar. Teste em Task 1.
2. Etapa em grupo de material e de mão de obra → cada um soma só o seu tipo, total da obra não duplica. Teste em Task 2.
3. Realizado com origem desconhecida → cai pelo tipo. Teste em Task 2.
4. Grupo sem cronograma/sem prazos → flags "sem data", nunca atrasado. Teste em Task 4.
5. Contrato com dezenas de medições → uma célula resumida. Teste em Task 5.

---

### Task 1: Classificação de insumos e projeção por insumo (regra pura)

**Files:** `server/contratacoes.js`, `server/contratacoes.test.js`

**Produces:**
- `definicaoParaTipo(def) → 'MATERIAL'|'MAO_DE_OBRA'|null`
- `lerClassificacaoInsumos(matriz) → { itens: [{ cod_insumo, descricao, definicao, tipo }], erros }` (cabeçalhos "Cód.Item", "Descrição do Item", "Definição Item", tolerante a acento/caixa).
- `classificador({ empresa: [{cod_insumo, descricao, tipo}], obra: [{descricao, tipo}] }) → (descricao, cod?) → { tipo, fonte: 'FORA_ORCAMENTO'|'OBRA'|'CODIGO'|'DESCRICAO'|'HEURISTICA' }`
- `lerCustoProjetado` passa a devolver também `linhas: [{ codigo_etapa, descricao, custo_projetado }]` (N5; ou todas quando não há NÍVEL); `itens`/`total` iguais a hoje.

- [ ] Testes: SE→MO, MT/EQ/OU→material; fora de orçamento sempre material mesmo com override; override da obra vence código; código vence descrição; heurística "MO "; leitura da planilha de classificação; `lerCustoProjetado` com N4+N5 devolve linhas N5 com descrição e total igual.
- [ ] Ver falhar → implementar → `npm run test:server` verde → commit.

### Task 2: Macro por tipo, Pedido/Contrato com realizado, total da obra (regra pura)

**Files:** `server/contratacoes.js`, `server/contratacoes.test.js`

**Consumes:** `valores: Map<'etapa|TIPO', { solicitado, cotado, em_pedido, em_contrato, realizado_pedido, realizado_contrato }>`, `projetado: Map<'etapa|TIPO', number>`.
**Produces:** `origemParaCanal(origem, tipo) → 'pedido'|'contrato'`. `calcularMacro({ grupos, projetado, valores, inicio, hoje })`: cada grupo soma só chaves do seu `tipo`; linha com `projetado, solicitado, solicitado_efetivo, cotado, pedido, contrato, comprometido, realizado, em_pedido, em_contrato, falta_solicitar, falta_fechar, pct{solicitado,pedido,contrato,comprometido,realizado}`; `pedido = realizado_pedido + em_pedido`, `contrato = realizado_contrato + em_contrato`, `comprometido = pedido + contrato`. `resumo[TIPO] = { projetado_obra, projetado_grupos, fora_grupos, comprometido, falta_solicitar, falta_fechar, porSinal }`, `resumo.total_obra`.

- [ ] Testes: E→contrato, R→pedido, MVI/CPA/vazio pelo tipo; pedido+contrato=comprometido; mesma etapa em grupo MAT e MO soma só o próprio tipo; resumo por tipo com fora de grupos; sinais (sem regra dos 95%, >100% PENDENCIA) mantidos.
- [ ] Ver falhar → implementar → verde → commit.

### Task 3: Banco — classificação, projetado e valores por etapa|tipo, grupos por tipo

**Files:** `server/schema.sql`, `server/contratacoes-db.js`, `server/index.js`, `src/components/contratacoes/contratacoes-api.ts`

- `insumo_classificacao (id, projeto_id TEXT NULL, cod_insumo BIGINT NULL, descricao TEXT NOT NULL (normalizada), definicao TEXT, tipo TEXT NOT NULL, atualizado_em)`; índice único `(COALESCE(projeto_id,''), descricao)`.
- `custo_projetado_itens ADD COLUMN IF NOT EXISTS descricao TEXT`; importação grava as `linhas` (N5) com descrição; `custo_projetado_itens` passa a ter várias linhas por etapa (sem PK por etapa — conferir constraint e remover se existir).
- `contratacao_grupo_etapas ADD COLUMN IF NOT EXISTS tipo TEXT`, backfill pelo grupo, troca do índice único para `(projeto_id, codigo_etapa, tipo)`.
- `atrelarEtapas`: conflito/remoção só entre grupos do mesmo tipo; `soltarEtapa`/`confirmarEtapa` por `grupoId`.
- `obterConfig`: pendências **por tipo** (`pendencias: { MATERIAL: [...], MAO_DE_OBRA: [...] }`, só etapas com projetado > 0 daquele tipo quando há descrição), projetado por grupo pelo seu tipo; `classificacao: { empresa: n, sem_classificacao: [{descricao, projetado}] }`.
- Rotas: `POST /api/contratacoes/insumos/importar` (matriz → empresa, substitui), `POST /api/contratacoes/insumos/obra` (`{descricao, tipo}` override; `tipo null` remove).
- `valoresPorEtapa`: tudo por `etapa|tipo` com o classificador; realizado dividido por `origemParaCanal`; `cotado` = solicitado de itens com cotação/pedido/contrato.
- Verificação ao vivo (só leitura) do drywall: material ≈ R$ 834 mil projetado, mão de obra ≈ R$ 611 mil.

### Task 4: Flags por fase (regra pura + macro)

**Files:** `server/contratacoes.js`, `server/contratacoes.test.js`, consulta de grupos em `obterMacro` (prazos).

`flagsDoGrupo({ inicio, lead_time, levantamento, prazo_solicitacao, prazo_emissao, prazo_entrega, P, solicitado_efetivo, cotado_efetivo, comprometido, hoje })` → `[{ fase: 'LEVANTAMENTO'|'SOLICITACAO'|'MAPA'|'PEDIDO_CONTRATO', limite, dias, estado: 'FEITO'|'ATRASADO'|'ATENCAO'|'NO_PRAZO'|'LEMBRETE'|'SEM_DATA' }]`.
Limites: solicitação = início − lead_time; levantamento = limite solicitação − (levantamento + prazo_solicitacao), estado só `LEMBRETE` (≤ 7 dias ou passado) / `NO_PRAZO` / `FEITO` (solicitado ≥ P); mapa = início − (emissão + entrega), feito quando max(cotado, comprometido) ≥ P; pedido/contrato = início − entrega, feito quando comprometido ≥ P. `cotado_efetivo = max(cotado, comprometido)`.

### Task 5: Micro rápido em tabela

**Files:** `server/contratacoes.js` (`resumirMedicoes`), `server/contratacoes-db.js` (`obterMicro`), `src/components/contratacoes/ContratacoesMicro.tsx`, CSS.

- `obterMicro`: filtra no SQL por etapas do grupo (`codigo_etapa = ANY`), só itens do tipo do grupo; documentos/ocorrências do Approvo só dos números usados; medições só dos contratos usados.
- `resumirMedicoes(passosMedicao) → { total, aprovadas, pendente: { numero, dias } | null }`; trilha devolve medições à parte (`medicoes`) e `passos` sem medições.
- Tabela: Solicitação (rowspan, status aprovação x/y, aprovadores no title) · Insumo · Etapa · Fornecedor/valor · Mapa · Pedido/Contrato · Medições ("5/7 aprovadas · 6ª pendente há N dias", clique expande lista) · Parado em. Alerta quando insumo de mão de obra tem pedido.

### Task 6: Tela — abas, resumo, configuração de insumos

**Files:** `ContratacoesMacro.tsx`, `ContratacoesConfig.tsx`, `contratacoes-api.ts`, CSS.

- Macro: abas Material | Mão de obra (estado local); resumo da aba: Total da obra (tipo), Em grupos, Fora de grupos, Comprometido, Falta fechar, Falta solicitar; total geral da obra pequeno ao lado. Colunas: Projetado, Solicitado, Pedido, Contrato, Comprometido, Realizado, Falta solicitar, Falta fechar, Flags (4 chips), Situação.
- Config: aba "Insumos" (upload da planilha da empresa, contagem, lista "sem classificação" com botões Material/Mão de obra); aba "Etapas fora de grupo" com seletor de tipo; aviso para reimportar a projeção quando a importação não tem descrição.
- `tsc --noEmit` + `npm run build`.

### Task 7: Docs + revisão final + entrega

- Atualizar spec 2026-09-30 (decisões de 2026-10-01, origem E/R). Revisão final por subagente. Usuário faz push/Redeploy, **reimporta a projeção** e **importa a planilha de insumos** (Configurar → Insumos).
