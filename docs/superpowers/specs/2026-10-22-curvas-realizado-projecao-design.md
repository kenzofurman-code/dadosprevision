# Curvas — visão "Realizado + projeção"

Data: 2026-10-22 · Módulo: Curvas de Competência e Financeira (`server/curvas-financeiras-*.js`,
`src/CurvasFinanceirasView.tsx`)

## Intenção

Hoje as Curvas são **teóricas**: o custo projetado inteiro é distribuído pelo cronograma, inclusive no passado. O usuário quer uma visão **separada**, que responda "como está e como vai ficar":

- **até o último mês fechado**, a competência é o que de fato entrou: apropriado do Mega;
- **dali para frente**, o **saldo** de cada etapa é projetado pelo físico que ainda falta, com as mesmas regras de hoje;
- **o financeiro** segue a competência.

## Decisões do usuário

- A **curva teórica continua como está**, como base de comparação. A nova visão é **outra aba/gráfico**, com o seu próprio **botão Recalcular**.
- **Data de corte = último mês fechado.** Em 22/10/2026, o realizado vai até 09/2026 e de 10/2026 em diante é projeção.
- Vale tanto para a **competência** quanto para o **financeiro**.

## Contexto validado (2026-10-22)

- Depois do PR #13, o CFF teórico bate mês a mês com a curva **monetária** da Prevision. Na QOYA, em out/26, as duas dão 56,4%.
- **Fonte do realizado:** `mega.analise_realizado` (`valor_apropriacao`, `data_documento`, `raw_data.cod_estruturado`). É a mesma usada pelo Painel 9 e por Contratações.
- O Mega **não traz pagamentos**. Por isso o financeiro do período realizado é **estimado**, aplicando as condições de pagamento sobre a competência realizada.

## Cálculo

Para cada etapa nível 5 e cada tipo (material ou MO; a classificação é a mesma de Contratações: `classificadorDaObra` + `tipoDe(descricao, cod)`):

1. **Competência realizada:** apropriado do Mega por mês do documento, até o fim do mês de corte. Documentos com data **depois** do corte são ignorados nesta visão, porque o mês ainda está aberto. Sem data: entram no mês de corte (**decisão do builder**).
2. **Saldo** = custo projetado do tipo − realizado do tipo, com mínimo 0. Se a etapa gastou mais que o projetado, o saldo é 0 e o excedente aparece no aviso.
3. **Projeção do saldo:** o motor atual roda com `custo = saldo` e com o **físico só a partir do mês seguinte ao corte**. Os pesos mensais até o corte são zerados e os demais são renormalizados.
   - **Material:** valem as mesmas regras (antecedência, lotes, pagamento).
     - **Lotes:** o motor divide o período com físico **que resta**.
     - **Chegada antes do corte:** se a antecedência joga a chegada para antes do corte, a competência vai para o 1º mês após o corte, porque o passado já é realidade.
   - **MO:** o mesmo corte do dia 20 e o mesmo dia de pagamento.
   - **Saldo sem físico pela frente**, porque o cronograma da etapa já acabou: a competência vai toda para o 1º mês após o corte, marcada como **"pendente"**.
4. **Financeiro:**
   - **Da competência realizada:**
     - material: data do documento + condição de pagamento da regra da etapa (prazo ou parcelas);
     - MO: dia de pagamento de M+1, com retenção se estiver ativa.
     - Tudo isso é **estimado**, e o que vence depois do corte aparece nos meses futuros.
   - **Da projeção:** igual ao teórico.
5. **Fora do cronograma:** o apropriado sem etapa nível 5 no cronograma (taxas, itens fora de orçamento) **não entra na curva**, para manter a mesma base do custo projetado. Aparece num aviso com o valor e a lista (**decisão do builder**, com o mesmo critério da conciliação do PR #11).

**Invariante (teste):** realizado + projeção de cada etapa e tipo = máx(custo projetado, realizado). O total da curva fecha com o custo projetado mais os excedentes.

## Resultado devolvido

`GET /api/curvas-financeiras/realizado?projectId=` → `{ corte: 'YYYY-MM', seriesMensal: [...], kpis, avisos }`

- **`seriesMensal`:** para cada mês:
  - `competenciaMensal/Acumulado`, `competenciaMaterial`, `competenciaMaoDeObra`;
  - `financeiroMensal/Acumulado`, `financeiroMaterial`, `financeiroMaoDeObra`;
  - `realizado: boolean` (mês ≤ corte);
  - e, para sobrepor, `teoricoCompetenciaAcumulado`, `teoricoFinanceiroAcumulado`, `teoricoEconomicoAcumulado`.
- **`kpis`:**
  - competência realizada até o corte;
  - teórico até o corte;
  - **desvio no corte** (R$ e %);
  - saldo projetado;
  - **excedente** (etapas acima do projetado);
  - pendente.
- **`avisos`:**
  - apropriado fora do cronograma (valor e lista);
  - etapas com excedente;
  - etapas com saldo pendente;
  - data da última carga do Mega. Se for anterior ao fim do mês de corte, o aviso diz "o realizado de MM/AAAA pode estar incompleto".

O cálculo é **sob demanda**, a cada abertura ou clique em Recalcular, e **não é salvo** nas versões (**decisão do builder**, fora do escopo).

## Tela

- Nova aba nas Curvas: **"Realizado + projeção"**, ao lado de "Gráfico S Comparativo".
- **Gráfico:**
  - competência e financeiro com **linha cheia até o corte** e **tracejada depois**;
  - uma **linha vertical** no mês de corte, com o rótulo "Realizado até MM/AAAA";
  - as curvas **teóricas** em cinza claro ao fundo, com um botão para mostrar ou esconder;
  - os mesmos modos do gráfico teórico (acumulado R$/%, mensal R$/%) e o mesmo filtro material/MO.
- **Cartões:** realizado até o corte, desvio contra o teórico no corte, saldo a projetar, excedente/pendente.
- **Botão Recalcular** próprio.
- Projeto **sem obra do Mega** vinculada: a aba mostra um aviso e não calcula.

## Fora do escopo

- Pagamentos reais do Mega (financeiro realizado de verdade).
- Rastreio e planilha analítica para esta visão.
- Salvar em versões.
- Corte escolhido manualmente pelo usuário.

## Verificação

- **Testes puros**, numa função nova `projetarRealizado(...)` no motor:
  - etapa com realizado parcial: o saldo é projetado só depois do corte;
  - excedente → saldo 0;
  - saldo sem físico futuro → pendente no mês seguinte ao corte;
  - antecedência que cairia antes do corte → competência no 1º mês após o corte;
  - financeiro estimado do realizado (material com prazo; MO com dia 5 e retenção);
  - invariante de fechamento.
- `npm run test:server` e `npm run build`.
- Conferência na POTY e na QOYA:
  - a competência realizada até 09/2026 bate com o apropriado do Mega no mesmo período (soma via SQL);
  - o desvio no corte faz sentido contra a curva monetária realizada da Prevision (54,2% na QOYA).
