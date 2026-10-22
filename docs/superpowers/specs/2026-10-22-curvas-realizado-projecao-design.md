# Curvas — visão "Realizado + projeção"

Data: 2026-10-22 (revisado no mesmo dia com o retorno do usuário) · Módulo: Curvas de Competência e Financeira
(`server/curvas-financeiras-*.js`, `src/CurvasFinanceirasView.tsx`)

## Intenção

Hoje as Curvas são **teóricas**: o custo projetado inteiro é distribuído pelo cronograma, inclusive no passado. O
usuário quer uma visão **separada**, que responda "como está e como vai ficar", e que possa ser **comparada com a
teórica na mesma tela**:

- **até o mês de corte**, a competência é o que de fato entrou: apropriado do Mega;
- **dali para frente**, o **saldo** de cada etapa é projetado pelo físico que ainda falta, com as mesmas regras de hoje;
- **o financeiro** do período realizado vem das APs do Mega (vencimento); o resto segue as regras de pagamento.

## Decisões do usuário

- A **curva teórica continua como está**, como base de comparação. A nova visão é **outra aba**, com o seu próprio
  **botão Recalcular**.
- **Seletor do mês de corte.** O padrão é o **último mês fechado** (em 22/10/2026: 09/2026). Com o corte **antes do
  início da obra**, não há realizado e a visão **é igual à teórica**.
- **Nada é salvo.** A visão é calculada sob demanda a partir do corte escolhido; não entra em versões.
- **Apropriado sem etapa no cronograma** não aparece em nenhuma etapa, mas **conta no total e no percentual**.
- **Etapa que gastou mais que o projetado:** o projetado está errado. **Nada é distribuído** e a etapa fica **em
  vermelho**.
- **Etapa com saldo e sem físico pela frente:** o saldo fica **pendente** (não é distribuído no cronograma) e a etapa
  fica **em vermelho**.
- **Comparativo:** teórico e realizado + projeção **na mesma tela**.

## Fontes

- **Competência realizada:** `mega.analise_realizado` (`valor_apropriacao`, `data_documento`, `ap`,
  `raw_data.cod_estruturado`), a mesma do Painel 9 e de Contratações. Só linhas com `cod_estruturado`, o que já
  descarta a linha de total do relatório. Na QOYA: 52,28 mi, sendo 44,71 mi com AP (origens E e R, desde 01/2025) e
  7,57 mi sem AP (origem MVI, saldo de implantação até 12/2024).
- **Pagamentos:** relatório **"Conciliação Financeira"** do Mega (exportado pelo usuário em xlsx), uma linha por AP,
  parcela e rateio, com `Número AP`, `Parcela`, `Tipo documento`, `Data vencimento`, `Valor rateado [A]`,
  `Pagamentos [D]`, `Saldo a pagar [E]`, `Código estruturado`.

### Conferência das planilhas (13/10/2026)

| | QOYA | POTY |
|---|---|---|
| APs do apropriado (Mega) | 2.309 (44,71 mi) | 2.428 (51,50 mi) |
| Encontradas na planilha | 2.273, **44,18 mi (98,8%)** | 2.383, **50,98 mi (99,0%)** |
| Só no Mega | 0,54 mi | 0,51 mi |
| Vencimento no mês do documento / no mês seguinte / depois | 20% / 71% / 9% | 19% / 72% / 9% |

- **Dá para usar.** O cruzamento é pelo **número da AP**; o valor bate (±1%) em 85% das APs, e as diferenças são de
  rateio entre etapas e de impostos (INSS, ISS, IR) e caução lançados como APs próprias.
- **Não há data de pagamento**, só o **vencimento** e quanto já foi pago. A visão usa o **vencimento** como data do
  financeiro (**decisão do builder**).
- **Caução** (`Tipo documento = CAUCAO`) já vem com o vencimento da liberação (até 2030), ou seja, é a retenção técnica
  real.
- Na QOYA há 1,70 mi em aberto com vencimento já passado; na POTY, nenhum.

## Cálculo

Para cada etapa nível 5 e cada tipo (material ou MO; a classificação é a mesma de Contratações:
`classificadorDaObra` + `tipoDe(descricao, cod)`):

1. **Competência realizada:** apropriado do Mega por mês do documento, até o fim do mês de corte. Documentos depois do
   corte são ignorados. Sem data: entram no mês de corte (**decisão do builder**).
2. **Saldo** = custo projetado do tipo − realizado do tipo.
   - **Saldo < 0 (excedente):** nada é projetado; a etapa fica **vermelha** com o valor do excedente.
   - **Saldo > 0 com físico depois do corte:** o motor atual roda com `custo = saldo` e o físico **só a partir do mês
     seguinte ao corte** (pesos até o corte zerados, demais renormalizados), com as mesmas regras de material
     (antecedência, lotes sobre o período que resta, pagamento) e de MO. Chegada de material que cairia antes do corte
     vai para o 1º mês depois dele.
   - **Saldo > 0 sem físico depois do corte:** fica **pendente**, fora do gráfico mês a mês, somado num item à parte
     "Pendente" e com a etapa **vermelha**.
3. **Apropriado fora do cronograma** (sem etapa nível 5: taxas, itens fora de orçamento): entra na **competência
   realizada do mês** como uma parcela à parte ("fora do cronograma"), **conta no total e no %**, mas não aparece em
   nenhuma etapa.
4. **Financeiro:**
   - **Competência realizada com AP na planilha:** o valor de cada AP vai para o **mês de vencimento** das suas
     parcelas, na proporção do valor rateado. Parcela vencida e ainda em aberto vai para o mês seguinte ao corte.
   - **Competência realizada sem AP** (MVI, ou AP ausente da planilha): estimada pelas condições de pagamento da etapa
     (material: prazo/parcelas; MO: dia de pagamento de M+1 com retenção).
   - **Projeção:** as mesmas regras da teórica.
   - **Obra sem planilha carregada:** todo o financeiro do realizado é estimado, com aviso.
5. **Base do %:** o **custo projetado** (o mesmo da teórica), para que as duas curvas fiquem na mesma escala. Excedentes
   e fora do cronograma fazem a curva realizada passar de 100%, o que é o sinal de estouro (**decisão do builder**).

**Invariantes (testes):**

- Corte antes do início da obra → séries idênticas às da teórica.
- Para cada etapa e tipo: realizado + projetado + pendente = máx(custo projetado, realizado).
- Total da curva = custo projetado + excedentes + fora do cronograma − pendente.

## Carga dos pagamentos

- Upload do xlsx "Conciliação Financeira" na própria aba, por obra, gravado em `public.pagamentos_ap`
  (`projeto_id`, `ap`, `parcela`, `tipo_documento`, `vencimento`, `valor_rateado`, `pago`, `saldo`,
  `cod_estruturado`, `importado_em`). Um novo upload **substitui** o anterior daquela obra.
- O schema `mega` não é tocado. A extração automática desse relatório pelo robô `mega` fica para depois.

## Resultado devolvido

`GET /api/curvas-financeiras/realizado?projectId=&corte=YYYY-MM` → `{ corte, cortePadrao, seriesMensal, etapas, kpis, avisos }`

- **`seriesMensal`** (por mês): competência e financeiro (mensal, acumulado, material, MO, fora do cronograma),
  `realizado: boolean` (mês ≤ corte) e as mesmas séries da **teórica** para sobrepor.
- **`etapas`:** por etapa, projetado, realizado, saldo projetado, excedente, pendente e `alerta`
  (`'excedente' | 'pendente' | null`).
- **`kpis`:** realizado até o corte, teórico até o corte, **desvio no corte** (R$ e %), saldo projetado, excedente,
  pendente, fora do cronograma, custo final estimado.
- **`avisos`:** carga do Mega anterior ao fim do mês de corte ("o realizado de MM/AAAA pode estar incompleto");
  planilha de pagamentos ausente ou mais antiga que o corte; APs do apropriado sem pagamento na planilha.

## Tela

- Nova aba nas Curvas: **"Realizado + projeção"**.
- **Topo:** seletor do **mês de corte** (padrão: último mês fechado), botão **Recalcular**, upload da planilha de
  pagamentos (com a data da última carga).
- **Gráfico comparativo:** teórica e realizado + projeção juntas.
  - Realizado + projeção: **linha cheia até o corte e tracejada depois**; linha vertical no corte ("Realizado até
    MM/AAAA").
  - Teórica: as mesmas medidas em **cinza**, com um botão para mostrar ou esconder.
  - Mesmos modos da teórica (acumulado R$/%, mensal R$/%) e o mesmo filtro material/MO; seletor
    competência/financeiro.
- **Tabela comparativa mensal:** por mês, teórico, realizado/projetado e diferença, em R$ e %, com o mês de corte
  destacado.
- **Cartões:** realizado até o corte, desvio no corte, saldo a projetar, excedente, pendente, fora do cronograma.
- **Etapas em alerta:** lista das etapas **em vermelho** (excedente ou pendente), com valores.
- Projeto **sem obra do Mega** vinculada: a aba mostra um aviso e não calcula.

## Fora do escopo

- Data de pagamento efetiva (o relatório só traz vencimento).
- Extração automática da Conciliação Financeira pelo robô `mega`.
- Rastreio e planilha analítica para esta visão.
- Salvar em versões.
- Cronograma "como estava" no mês de corte: a projeção usa sempre o cronograma atual da Prevision.

## Verificação

- **Testes puros** em `projetarRealizado(...)` no motor: as três invariantes; realizado parcial; excedente; pendente;
  antecedência antes do corte; fora do cronograma no total; financeiro pela AP (vencimento, parcela vencida em aberto)
  e estimado sem AP.
- **Teste do leitor do xlsx** com uma planilha mínima (cabeçalho do Mega, linhas de nível, AP com duas parcelas).
- `npm run test:server` e `npm run build`.
- **Conferência na POTY e na QOYA:** competência realizada até 09/2026 = apropriado do Mega no período (SQL); financeiro
  realizado = soma da planilha por vencimento; corte antes do início = teórica.
