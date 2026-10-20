# Curvas de Competência e Financeira — regras de MO/Material, níveis e versões

Data: 2026-10-19 · Módulo: `server/curvas-financeiras-*.js`, `src/CurvasFinanceirasView.tsx`, `server/schema.sql`

## Intenção

O módulo foi criado para projetar, a partir do cronograma físico (Prevision) e do custo projetado
(Mega), **quando cada custo vira competência e quando vira caixa**, com uma regra para mão de obra e
outra para material. Esta entrega:

- deixa as duas regras exatamente como a operação funciona, incluindo a retenção técnica;
- facilita a configuração por etapa-mãe;
- permite congelar versões do cálculo para consultar depois.

O cálculo do dia a dia continua sempre com os dados mais atuais.

## Objetivos

1. **Regra de mão de obra** fiel à operação, com dia de pagamento configurável e retenção técnica.
2. **Regra de material** fiel à operação:
   - sem regra, o material acompanha a execução;
   - com regra de entrega, o material chega antes do serviço;
   - condições de pagamento parceladas configuráveis por nº de parcelas e intervalo.
3. Regras aplicáveis em **etapas de nível 3, 4 ou 5**.
4. **Salvar versão** do resultado com data e nome e **consultar** versões salvas.
5. Corrigir os problemas encontrados na revisão: chave do mapa de parâmetros, dia de pagamento ignorado e rótulo enganoso do "realizado".

## Fora do escopo

- Pagamentos reais do Mega (contas pagas). Fica para a última fase.
- Realizado de custo do Mega na tela, comparativo gráfico entre versões e a matriz físico × custo. Ficam para depois.
- Disparar sync da Prevision a partir desta tela.

## Anti-objetivos

- O cálculo "atual" **não pode** passar a depender de versão salva. Ele sempre reflete o cronograma e o custo atuais.
- A competência **nunca** é reduzida pela retenção. A retenção só move caixa.

---

## 1. Mão de obra

**Competência** (sem mudança): o rateio diário entre `data_inicio` e `data_fim` da etapa. Dias de 21/M-1 a 20/M vão para o mês M. O corte vem de `dia_corte_medicao_mo` (padrão 20).

**Financeiro**: a competência M é paga em **M+1, no dia `dia_pagamento_mo`** (padrão 5).
- O evento passa a carregar `dataPagamento` (`YYYY-MM-DD`). O mês financeiro é o mês dessa data.
- Hoje o parâmetro é salvo, mas ignorado. Passa a ser usado.
- Se o dia não existir no mês, limita ao último dia do mês. A tela já restringe a 1–28.

**Retenção técnica** (nova):
- Cada competência M com retenção ativa e percentual `p` gera dois eventos com `mesCompetencia = M`:
  - parcela paga: `valor × (1 − p)`, com `mesFinanceiro = M+1` (dia de pagamento);
  - parcela retida: `valor × p`, com `dataPagamento = data_fim_obra + 1 ano` e `retencao: true`.
- Toda retenção da obra é liberada **na mesma data**: um ano após a **data de fim da obra** informada nos parâmetros gerais. Essa é uma decisão do usuário.
- Se a data de fim da obra estiver vazia, usa-se a maior `data_fim` entre as etapas nível 5 (**decisão do builder**). A tela mostra essa data como sugestão.
- **Configuração**:
  - nos parâmetros da obra: `retencao_mo_ativa` (padrão `false`) e `retencao_mo_percentual` (padrão 5);
  - na regra de MO de uma etapa: `retencao_ativa` (`null` = herda da obra, `true`, `false`) e `retencao_percentual` (`null` = herda da obra).
- O total de competência e o total financeiro continuam iguais ao custo de MO. Só a distribuição no tempo muda.

## 2. Material

**Competência = data de chegada na obra.** **Financeiro = chegada + condição de pagamento.**

**Modo proporcional** (padrão, sem número de lotes):
- O material chega conforme a execução, `dias_antecedencia` antes.
- Implementação: o peso mensal previsto da Prevision (`pontos_mensais[].previsto`, com fallback para `base`) é distribuído **uniformemente pelos dias daquele mês dentro do intervalo da etapa**. Cada dia é deslocado `−antecedência` e agrupado por mês.
  - Assim, só a parte dos dias próximos à virada vai para o mês anterior.
  - Hoje o mês inteiro é jogado para o anterior. É isso que corrige.
- **Mudança de comportamento**: sem `pontos_mensais`, mas com datas, o rateio passa a ser uniforme entre início e fim, deslocado da antecedência. Hoje entrega 100% no início.
- Cada mês de chegada gera eventos com `dataEntrega` igual ao **dia médio ponderado dos dias que caíram naquele mês** (**decisão do builder**). A data de vencimento é calculada a partir dela.

**Modo entrega em lotes** (`num_entregas ≥ 1`): sem mudança.
- 1 lote: 100% chega em `início − antecedência`.
- N lotes: uniformes entre `início − antecedência` e `fim − antecedência`.

**Condição de pagamento**:
- `DIAS`: prazo único (padrão da obra: 28). Sem mudança.
- `PARCELADO`: lista de dias (`parcelas_dias`), dividida em partes iguais. O motor não muda.
- A tela ganha um gerador com **nº de parcelas**, **1º vencimento (dias)** e **intervalo (dias)**. Exemplos:
  - 6 × a partir de 15 a cada 15 → 15, 30, 45, 60, 75, 90;
  - 12 × a partir de 28 a cada 28 → 28, 56, …, 336.
- A lista gerada continua editável no campo de texto e é mostrada como prévia ("12× · 28 a 336 dias").
- O rótulo errado "Parcelado em até 6x (ex: 30, 60, 90)" vira "Parcelado". Não há limite de parcelas além de um teto de sanidade de 60.

## 3. Regras em nível 3, 4 e 5

- O formulário de regra ganha:
  - um seletor **Nível (3, 4 ou 5)**;
  - um seletor de etapa filtrado pelo nível;
  - um seletor **Tipo (Material ou Mão de obra)**.
- O formulário mostra os campos do tipo escolhido: material (antecedência, lotes, pagamento) ou MO (retenção).
- A API passa a devolver as etapas de nível 3 e 4 do `cff_itens` (código e descrição) para popular o seletor.
- **Armazenamento**: mesma tabela `curva_parametros_etapa`, com `codigo_etapa` contendo:
  - o **código da etapa-mãe da Prevision** (`dd.dd.dd` no nível 3, `dd.dd.dd.dd` no nível 4);
  - ou o código Mega do nível 5, como hoje.
  - O nível é deduzido pelo número de segmentos. A chave única continua `(projeto_id, codigo_etapa, tipo)`.
- **Resolução** (por etapa nível 5 e tipo):
  1. regra nível 5 (código Mega);
  2. regra do pai nível 4 (4 primeiros segmentos do código Prevision);
  3. regra do avô nível 3 (3 primeiros segmentos);
  4. padrão da obra.
  - A regra mais específica vence **inteira**, sem mistura campo a campo, exceto pelos campos `null` que já herdam da obra (**decisão do builder**).
  - Etapas novas que surgirem sob uma mãe herdam a regra automaticamente.
- **Corrige o P1**: o mapa de parâmetros passa a ser indexado por `codigo|tipo`. MO e Material não se sobrescrevem mais.
- O resultado por etapa passa a informar a regra efetiva: `regraMaterial` e `regraMo` com `codigo_origem` e `nivel` (ou `null` = padrão). A tabela de etapas mostra a origem, por exemplo "Herdado de 01.02.03 (N3)".
- A lista de regras salvas mostra nível, tipo e quantas etapas nível 5 a regra atinge.

## 4. Versões

- Nova tabela `curva_versoes`: `id`, `projeto_id`, `nome`, `criado_em`, `payload JSONB`.
- O payload contém o resultado completo do cálculo no momento: `kpis`, `meses`, `seriesMensal`, `etapas` (sem a lista de eventos, para limitar tamanho), `parametrosObra`, `parametrosEtapas` e `importacaoCustoProjetado`.
- O servidor **recalcula** na hora de salvar. Não confia em payload vindo do cliente.
- **Endpoints**:
  - `GET  /api/curvas-financeiras/versoes?projectId=` → lista (`id`, `nome`, `criado_em`, `totalOrcado`);
  - `POST /api/curvas-financeiras/versoes` `{ projectId, nome }` → salva;
  - `GET  /api/curvas-financeiras/versoes/:id` → payload;
  - `DELETE /api/curvas-financeiras/versoes/:id` → remove.
- **Tela**:
  - botão **"Salvar versão"**, com nome padrão "Versão dd/mm/aaaa hh:mm" editável;
  - seletor **"Visualizando: Atual / <versões>"**.
  - Com uma versão aberta: faixa "Versão X salva em dd/mm — somente leitura · Voltar ao atual". Os parâmetros ficam bloqueados, e gráfico, tabela mensal e etapas mostram o payload salvo.
  - Excluir versão pede confirmação.
- O botão "Recarregar" vira **"Recalcular"**. Ele refaz o cálculo com os dados atuais do banco (cronograma da última sincronização com a Prevision e última importação de custo projetado).

## 5. Ajustes de rótulo

- O KPI "Realizado Histórico" vira **"Avanço Físico Valorizado"**, com a dica "custo orçado × % físico executado (Prevision); não é gasto real". O cálculo não muda.
- O KPI "Saldo a Realizar" continua igual.
- O card informativo dos parâmetros da obra passa a citar a retenção técnica.

## Mudanças de schema (idempotentes, em `server/schema.sql`)

```sql
ALTER TABLE curva_parametros_obra ADD COLUMN IF NOT EXISTS retencao_mo_ativa BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE curva_parametros_obra ADD COLUMN IF NOT EXISTS retencao_mo_percentual NUMERIC NOT NULL DEFAULT 5;
ALTER TABLE curva_parametros_obra ADD COLUMN IF NOT EXISTS data_fim_obra DATE;
ALTER TABLE curva_parametros_etapa ADD COLUMN IF NOT EXISTS retencao_ativa BOOLEAN;
ALTER TABLE curva_parametros_etapa ADD COLUMN IF NOT EXISTS retencao_percentual NUMERIC;
CREATE TABLE IF NOT EXISTS curva_versoes (...);
```

## Verificação

Testes de motor em `server/curvas-financeiras-engine.test.js` (`node --test`):

- **MO**:
  - dia de pagamento configurável gera `dataPagamento` no dia certo de M+1;
  - com retenção de 5%, competência = 100% em M, financeiro = 95% em M+1 e 5% em `data_fim_obra + 1 ano`;
  - os totais fecham.
- **Material proporcional**: etapa no mês inteiro de abril com antecedência de 10 dias → cerca de 1/3 da competência em março e 2/3 em abril; os totais fecham.
- **Material sem `pontos_mensais`**: rateio uniforme deslocado, não 100% no início.
- **Parcelado**: 12 parcelas de 28 em 28 → 12 eventos de 1/12.
- **Resolução de regras**: N5 vence N4, que vence N3; MO e Material da mesma etapa não colidem.

Também: build TypeScript (`npm run build`) sem erros, e conferência manual na tela com uma obra real (salvar regra N3, ver herança, salvar versão, abrir versão).
