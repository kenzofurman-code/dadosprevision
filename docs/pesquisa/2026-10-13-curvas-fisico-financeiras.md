# Curvas Físico-Financeiras — pesquisa de mercado, base teórica e roadmap

Data: 2026-10-13 · Escopo: módulo **Curvas de Competência e Financeira** (`server/curvas-financeiras-*.js`, `src/CurvasFinanceirasView.tsx`)

---

## 1. Resumo executivo

1. **O mercado inteiro trabalha com a mesma ideia de base que já implantamos**: espalhar o custo pelo cronograma usando uma "curva de distribuição". O que diferencia os produtos maduros não é a curva prevista, e sim **o que vem depois**: versões congeladas da previsão, realizado sobreposto, re-projeção automática do saldo e explicação do desvio.
2. **Hoje o módulo só tem uma curva prevista.** Não guarda versões, não sobrepõe custo real nem pagamento real e não explica diferença nenhuma. O "realizado histórico" atual é, na prática, **valor agregado** (custo orçado × % físico realizado), não gasto real. Essa confusão precisa ser corrigida antes de qualquer comparativo.
3. **Já temos quase todos os dados para um controle completo**:
   - físico base, previsto e realizado mês a mês, por etapa (`cff_itens.pontos_mensais`);
   - custo apropriado real por etapa e data (`mega.analise_realizado`);
   - comprometido em pedidos e contratos (`analise_pedidos_hist`, `analise_contratos_hist`);
   - medições de empreiteiros com período e retenções (`mega.medicoes_contratos`).

   **Faltam dois dados**: o **pagamento real** (contas a pagar e pagas, com vencimento e data de pagamento) e o **histórico de versões** do cronograma e da projeção.
4. **O recurso que responde à pergunta "não gastei, mas também não fiz"** é a **matriz Físico × Custo por etapa**, baseada em valor agregado (EVM). Ela separa quatro situações que a curva consolidada esconde: atraso puro, nota ainda por chegar, gasto sem avanço e execução normal. Nenhum concorrente nacional encontrado na pesquisa expõe isso de forma simples. É o melhor diferencial disponível.
5. Para "analisar mais do que gerar", a recomendação é **projeção automática + snapshot mensal automático + lista de exceções**. O usuário só olha o que desviou, e os parâmetros (antecedência, prazo de pagamento) passam a ser **calibrados pelo histórico real** em vez de digitados.

---

## 2. Diagnóstico do que existe hoje

### 2.1 O que o motor faz
- **Curva econômica (CFF)**: custo total da etapa × peso **previsto** mensal da Prevision.
- **Competência MO**: rateio diário entre início e fim, com corte no dia 20 (21/M-1 a 20/M vai para M).
- **Financeiro MO**: mês de competência + 1.
- **Competência material**: entrega = início − antecedência, em N lotes fixos ou proporcional ao previsto mensal.
- **Financeiro material**: entrega + prazo (28 dias), ou parcelado.
- **Custo**: custo projetado importado do Mega, com prioridade; se não houver, usa o orçamento da Prevision.
- **KPIs**: total, material, MO, pico financeiro e "saldo projetado".

### 2.2 Problemas encontrados no código atual (corrigir primeiro)

| # | Problema | Onde | Efeito |
|---|---|---|---|
| P1 | Parâmetros por etapa indexados só por `codigo_etapa`, mas a tabela é única por `(codigo_etapa, tipo)`. Uma regra de `MAO_DE_OBRA` sobrescreve a de `MATERIAL` no `Map`. | `curvas-financeiras-db.js` → `obterParametrosEtapas` (`mapa.set(r.codigo_etapa, r)`) | O material pode usar antecedência e prazo da regra de MO. |
| P2 | `dia_pagamento_mo` é salvo, mas o motor nunca lê. MO sempre paga em M+1. | `curvas-financeiras-engine.js` | O parâmetro na tela não tem efeito. |
| P3 | O "realizado histórico" é `custo_total × peso_realizado`. Isso é **valor agregado (EV)**, não custo real. | `curvas-financeiras-db.js` | Comparar com a projeção dá a falsa impressão de que gasto = avanço. |
| P4 | Toda a distribuição usa o **previsto**. A linha de base (`base`) e o realizado (`realizado`) dos `pontos_mensais` são ignorados. | motor | Não existe "planejado original × atual × real". |
| P5 | Nada é versionado. Cada sync da Prevision e cada importação de custo projetado sobrescreve a anterior. | `cff_itens` (upsert), cálculo sob demanda | Não dá para responder "o que eu previa para outubro, em julho?". |
| P6 | O material proporcional entrega no dia 1 do mês − antecedência, para todo o volume do mês. | `distribuirMaterialEtapa` | Concentra a competência do material um mês antes, mesmo em etapas longas. Aceitável, mas é preciso saber que é assim. |

---

## 3. Base teórica (o que a literatura diz e como se aplica)

### 3.1 Não existe "a" curva: existem cinco, e cada uma responde uma pergunta

| Curva | Pergunta | Fonte no nosso sistema |
|---|---|---|
| **Linha de base (PV₀)** | Quanto eu *planejava* ter gasto até a data, no plano original? | `pontos_mensais.base` × custo |
| **Prevista atual (PV)** | Pelo cronograma *atualizado*, quanto deveria estar executado? | `pontos_mensais.previsto` × custo (é o que o motor faz hoje) |
| **Valor agregado (EV)** | Quanto vale, a preço orçado, o que *foi fisicamente feito*? | `pontos_mensais.realizado` × custo |
| **Custo real por competência (AC)** | Quanto foi *lançado/apropriado* (notas, medições)? | `mega.analise_realizado` por `data_documento` |
| **Desembolso real (caixa)** | Quanto *saiu do banco*? | **não temos ainda** (contas pagas do Mega) |

O blog técnico da Sienge separa justamente **desembolso, comprometimento e custo real**: o desembolso é quando o dinheiro sai do banco, e por isso pode divergir do avanço físico. Essa separação é a fundação de todo o resto.

### 3.2 Earned Value Management (EVM): a matemática dos desvios
Com PV, EV e AC por etapa e mês:
- **Variação de prazo (SV)** = EV − PV: o atraso medido em R$. Negativo significa atrasado.
- **Variação de custo (CV)** = EV − AC. Negativo significa que gastou mais do que o feito vale.
- **SPI** = EV/PV e **CPI** = EV/AC.
- **EAC** (estimativa no término) = AC + (BAC − EV)/CPI, ou outras variantes. **VAC** = BAC − EAC.
- Observação da literatura: o CPI tende a se estabilizar quando a obra passa de ~20–30% executada. Antes disso, o EAC por índice é ruidoso e deve ser mostrado com cautela.

### 3.3 Earned Schedule (Lipke): atraso em **meses**, não em R$
O SV clássico tem um defeito conhecido: no fim de uma obra atrasada ele volta a zero (SPI = 1), porque todo o PV acaba "ganho". O **Earned Schedule** corrige isso:
- **ES** = o instante na linha de base em que o PV era igual ao EV de hoje;
- **SPI(t)** = ES / tempo decorrido;
- **término previsto** ≈ prazo planejado / SPI(t).

Estudos de Vanhoucke & Vandevoorde e do próprio Lipke mostram que o ES prevê a duração final melhor que os métodos clássicos. Para nós, isso dá o indicador **"a obra está X meses atrás"** e uma data de término projetada, que desloca a curva financeira inteira.

### 3.4 Curva padrão × curva da própria obra
- A literatura internacional (Kenley & Wilson, 1986, e trabalhos posteriores) mostra que **curvas S padrão por tipologia erram bastante**. As curvas acumuladas variam muito entre obras. A abordagem "idiográfica" (cada obra com a sua curva, vinda do próprio cronograma) é mais precisa, e é o que fazemos ao usar o cronograma da Prevision.
- No Brasil, a **dissertação da UFPE (Dourado, 2014)** estudou três empreendimentos em Recife e encontrou **grandes distorções entre fluxo de caixa planejado e realizado**. A principal causa foi **usar a curva de evolução física para projetar o desembolso**. Isso valida diretamente a nossa decisão de ter curvas de competência e financeira separadas da física (defasagens, lotes, prazos). Também mostra que essas defasagens precisam ser **calibradas com dados reais**, não arbitradas.
- Há também trabalhos de "curvas de agregação de recursos" (UFSC, 1995 e 2016; UFRGS/ABEPRO, 2002) que constroem curvas padrão por regressão. Servem como **fallback** para etapas sem cronograma detalhado e como **benchmark** ("esta obra está gastando mais rápido que a média das nossas obras?").

### 3.5 Atualização contínua
Navon (PMI, 1996): obras mudam o tempo todo, então a projeção precisa ser **re-calculada a cada atualização** com modelos simples, em vez de mantida à mão. Fornecedores (Sage, Rabbet, Mastt) repetem a mesma dor: forecast em planilha só tem valor se for revisitado, e revisitar à mão é tedioso. Daí a recomendação de projeção **automática**.

### 3.6 Riscos do fluxo de caixa apontados em pesquisas com construtoras
Odeyinka & Lowe (pesquisa com construtoras) apontam como maiores fontes de erro: mudanças de projeto ou especificação, condições contratuais de pagamento, medições intermediárias e atrasos de programação. Os três últimos são exatamente o que conseguimos modelar com prazos, medições e cronograma atualizado.

---

## 4. Pesquisa de mercado

### 4.1 Nacionais

| Produto | O que faz no tema | Observação |
|---|---|---|
| **Prevision Gestão de Custos (Sienge)** | Custo previsto, realizado e orçado num só lugar; "Análise de Tendência" que cruza planejado × realizado × previsto com **fórmulas personalizáveis**; "**Análise de Desembolso**" ligada ao avanço físico; compara **caixa × competência**; previsão de pagamento por **condições contratuais**; destaca **meses críticos de caixa**; inclui custos fora do ERP; corrige o saldo pelo **CUB**. | É o concorrente mais direto e cobre conceitualmente quase tudo o que queremos. A documentação pública não mostra **versões e snapshots**, **matriz físico × custo por etapa** nem **calibração automática de prazos**. |
| **Sienge Plataforma (ERP)** | Cronograma de desembolso a partir de contratos, pedidos e formas de pagamento (comprometido a incorrer). | Lado financeiro, sem a curva física. |
| **Mais Controle** | Cronograma físico-financeiro por período (semanal, quinzenal ou mensal) dentro do orçamento; curva de custo orçado × realizado. | Mais simples, sem desembolso defasado. |
| **Mobuss Construção** | Apontamento em campo e análises parciais de executado × planejado. | Foco em campo e qualidade, não em caixa. |
| **Planilha Curva S da Sienge / OrçaFascio** | Modelos de planilha: linha de base, medições e comparação. | Referência do que o mercado médio ainda usa: planilha manual. |

### 4.2 Internacionais

| Produto | Recursos relevantes |
|---|---|
| **Procore — Advanced Forecasting** | Espalha o *custo a incorrer* (Projected Cost to Complete) por um período com **curvas Linear, Front-loaded, Back-loaded, Bell e Manual**; edição em lote (datas e curva para várias linhas); usa orçamento, comprometido e gasto; previsão mensal; integração com BI. |
| **Oracle Primavera Unifier (Cash Flow)** | Curvas **Baseline, Forecast, Actuals (Spends), Derived e Custom**, quantas quiser, numa mesma planilha; escolha da baseline de comparação; **forecast começa onde o realizado termina**; **realizado substitui o forecast no fechamento do mês**; saldo não alocado rateado nos períodos restantes; perfis de distribuição por WBS. No P6 Analytics: **baseline inicial × baseline atual × realizado × forecast** no mesmo gráfico. |
| **Autodesk Construction Cloud (Cost)** | Liga orçamento ao cronograma num só lugar, contra a dor de "relatório do ERP + log de compras + curva do planejamento" em ferramentas separadas. |
| **Mastt** | Curva S com PV, EV e AC; SPI e CPI; EAC e VAC; **cenários what-if**; **sobrepõe planos de recuperação**; consolidação de **portfólio**; regras de leitura (curva achatando com SPI < 1 indica atraso; desvio cedo sugere erro de orçamento, no meio sugere escopo ou produtividade, no fim sugere retrabalho ou aditivo). |
| **InEight / Contruent / Primavera Cloud** | Forecast integrado custo + prazo + desempenho, com benchmarking e análise de tendência; custo ligado ao avanço das atividades. |
| **Rabbet** | Forecast conectado a comprometidos, notas e liberações, que **se atualiza sozinho** quando o custo entra; actual × forecast. |

### 4.3 Padrões recorrentes ("features de mesa" do mercado)
1. Várias curvas no mesmo gráfico: **baseline, forecast, realizado**.
2. **Perfis de distribuição** por item (linear, S, front-loaded, back-loaded, manual).
3. **Realizado substitui o previsto** em meses fechados; o forecast parte do realizado.
4. **Comprometido** (pedidos e contratos) como camada entre orçado e realizado.
5. **EAC / tendência** com fórmula configurável.
6. **Caixa × competência** lado a lado.
7. **Meses críticos** e pico de caixa.
8. **Cenários** e planos de recuperação.
9. **Portfólio** multi-obra.
10. **BI / exportação**.

---

## 5. Dores do mercado → como respondemos

| Dor relatada | Fonte | Nossa resposta |
|---|---|---|
| "Físico na planilha do engenheiro, caixa no financeiro, ninguém conversa": ponto cego que só aparece quando o desvio é grande | Blogs Sienge e Senior; Autodesk | Já cruzamos Prevision + Mega automaticamente. Falta expor o **realizado** do Mega na mesma tela. |
| Forecast manual em Excel é tedioso, fica desatualizado | Sage, Mastt, Rabbet, Navon | Projeção **recalculada a cada sync** + **snapshot mensal automático**. Zero digitação. |
| Usar a curva física como curva de caixa gera grandes distorções | UFPE 2014 | Já separamos competência e caixa. Próximo passo: **calibrar defasagens com dados reais**. |
| Curvas padrão erram muito | Kenley & Wilson e sucessores | Curva vinda do cronograma da própria obra; curva padrão interna só como fallback e benchmark. |
| Prazos e condições de pagamento variam por fornecedor | Sage | Prazo **aprendido** por fornecedor e etapa a partir do histórico (pedido → nota → pagamento). |
| Medição de empreiteiro pode mostrar avanço que não bate com o cronograma | LARES 2019 | Cruzar **medição (R$) × avanço físico Prevision (%)** por etapa e sinalizar divergência. |
| Curvas exigem leitura especializada e interpretação subjetiva | Mastt | Em vez de só gráfico: **diagnóstico em texto** e **lista de exceções classificadas** (matriz 2×2). |
| Retenções, aditivos e liberação de caução bagunçam o caixa | Mastt; dados do Mega | Usar `caucao`, `inss`, `iss` e `irrf` das medições: caixa **líquido** e liberação de caução no fim do contrato. |

---

## 6. Catálogo de features propostas

Legenda: **Dados** = ✅ já temos · 🟡 temos parcialmente · ❌ falta extrair.

### A. Comparativo e versões

**A1. Snapshot mensal automático da projeção** · Dados ✅
- Ao fechar o mês (ou em todo sync), gravar uma "foto" da série mensal: econômica, competência e financeira, por etapa e tipo.
- Tabela nova, por exemplo `curva_snapshot (projeto_id, versao, data_ref, origem, mes, codigo_etapa, tipo, competencia, financeiro, economico)`.
- Viabiliza: "previsto em julho para outubro × previsto hoje para outubro × realizado em outubro".
- **É o pré-requisito de todo comparativo.** Sem ele, cada sync apaga a história (P5).

**A2. Seletor "comparar com…"** · ✅ após A1
- Linha de base original, versão do mês anterior ou qualquer versão.
- Gráfico com a curva atual + a curva de comparação tracejada + a diferença mês a mês.
- Inspirado no Unifier (escolha de baseline) e no P6 (baseline inicial × atual).

**A3. Curva de linha de base pura** · ✅
- Rodar o motor com `pontos_mensais.base` em vez de `previsto`: mostra o fluxo de caixa *do plano original* contra o do cronograma reprogramado. Custo baixo, porque o motor já aceita os pontos.

### B. Previsto × realizado

**B1. Custo real por competência (AC)** · ✅
- `mega.analise_realizado` agrupado por `data_documento` (mês) e `cod_estruturado` (etapa), separando material e MO pela mesma classificação já usada em contratações.
- Somar `medicoes_contratos.valor_total` por período de medição para a MO empreitada, com o cuidado de não contar em dobro o que já está apropriado.

**B2. Desembolso real (caixa)** · ❌
- Precisa extrair do Mega o relatório de **contas a pagar e pagas** (título, fornecedor, obra, centro de custo, vencimento, data de pagamento, valor).
- **É o maior gap de dados.** Sem ele, o "financeiro realizado" é só estimado (AC + prazo médio).

**B3. Realizado substitui o previsto em mês fechado** · ✅ para competência
- Meses passados mostram o real. Meses futuros mostram a projeção do **saldo** (custo projetado − AC), espalhado pelo cronograma atualizado.
- Total sempre fecha em: realizado + a realizar = custo projetado (padrão Unifier e Procore).

**B4. Comprometido a incorrer** · 🟡
- Pedidos e contratos com saldo não apropriado viram uma camada entre "realizado" e "a contratar".
- Pedido: data de necessidade + prazo indica quando vira caixa.
- Contrato: saldo distribuído pelo cronograma da etapa.
- Mostra quanto do caixa futuro **já está travado** e quanto ainda é decisão.

### C. Onde estão as diferenças (análise de desvio)

**C1. Matriz Físico × Custo por etapa (EVM simplificado)** · ✅

Ela responde diretamente ao "não gastei, mas também não fiz":

| | **Custo ≤ esperado** | **Custo > esperado** |
|---|---|---|
| **Físico em dia** (EV ≥ PV) | ✅ **Saudável** | 🔴 **Estouro**: gastou mais do que o feito vale (CPI < 1) |
| **Físico atrasado** (EV < PV) | 🟠 **Atraso puro**: não fez e não gastou. O caixa não sumiu, **foi empurrado para frente** e vai voltar comprimido. | ⚫ **Pior caso**: gastou e não fez. É adiantamento, desperdício ou material parado na obra. |

Uma quinta classe importante: **fez e não lançou** (EV > AC por muito tempo). Indica **nota ou medição ainda por chegar**, um passivo oculto que vai bater no caixa.

Implementação: para cada etapa, compara PV, EV e AC acumulados até o mês, com tolerância (por exemplo ±5%). A saída é uma **lista** ordenada pelo impacto em R$, não um gráfico.

**C2. Ponte de variação (waterfall) "previsto × realizado do mês"**
- Decompõe a diferença de caixa do mês em:
  1. **Efeito prazo**: físico deslocado (PV − EV);
  2. **Efeito custo e eficiência**: EV − AC;
  3. **Efeito escopo e orçamento**: o custo projetado mudou entre versões (só com A1);
  4. **Efeito defasagem de pagamento**: a nota entrou, mas o pagamento caiu em outro mês;
  5. **Fora do cronograma**: custo apropriado em etapa sem físico.
- Essa é a resposta formal a "onde estão as diferenças".

**C3. Atraso em meses (Earned Schedule) e término projetado** · ✅
- SPI(t) por obra e por etapa macro; data de término projetada; "a obra está 2,3 meses atrás".
- Opcional: re-projetar a curva financeira usando o término projetado em vez do cronograma oficial (cenário "se o ritmo atual continuar").

**C4. Medição × físico** · 🟡
- Para etapas empreitadas: compara % medido (R$ medido / valor do contrato) com % físico da Prevision. Divergência acima do limite indica medição adiantada (risco de pagar à frente) ou atrasada (passivo).

**C5. Indicadores de cabeçalho**
- SPI, CPI, SPI(t), EAC, VAC, % comprometido, pico de caixa remanescente, desvio do mês e desvio acumulado.
- Mostrar o EAC com aviso quando o físico estiver abaixo de ~20%.

### D. Reduzir o trabalho manual ("analisar, não gerar")

**D1. Calibração automática dos parâmetros** · 🟡 / ❌
- **Antecedência real**: `data_de_necessidade` / `dt_emissao` do pedido × início real da etapa.
- **Prazo real de pagamento**: data do documento × data de pagamento (precisa de B2).
- **Corte e pagamento de MO**: a partir das medições (`periodo_fim` × `data_emissao`).
- O sistema **sugere** o parâmetro ("o prazo médio real em Revestimento foi 42 dias, e o configurado é 28") e o usuário aceita com um clique. Isso substitui o preenchimento manual da tela de regras.

**D2. Painel de exceções em vez de tabelas**
- Tela inicial: "5 etapas pedem atenção", com a classe da matriz C1, o R$ de impacto e o mês afetado. Tabelas completas ficam um clique abaixo.

**D3. Diagnóstico em linguagem natural**
- Texto curto e gerado por regra: "Outubro ficou R$ 380 mil abaixo do previsto: R$ 310 mil por atraso em Estrutura (não executado, caixa deslocado para nov/dez), R$ 70 mil por notas de Instalações ainda não lançadas."

**D4. Justificativa do desvio**
- Campo de comentário por etapa e mês, guardado junto do snapshot. Cria memória do porquê (chuva, falta de material, aditivo) e alimenta reuniões de obra.

**D5. Alertas proativos**
- Pico de caixa que mudou de mês, SPI(t) que caiu de faixa, etapa que entrou em "pior caso" ou nota vencendo acima do previsto.

### E. Realismo do modelo

**E1. Perfis de distribuição por etapa**: linear, S, front-loaded, back-loaded e manual (padrão Procore e Unifier), para etapas sem pesos mensais confiáveis.

**E2. Retenções e impostos**: caixa líquido × bruto. Caução retida e liberada no fim do contrato; INSS, ISS e IRRF retidos e recolhidos em outro mês. Os dados já estão em `medicoes_contratos`.

**E3. Reajuste do saldo** por INCC ou CUB: o saldo a realizar corrigido pelo índice. A Prevision Gestão de Custos já oferece isso.

**E4. Cenários**: otimista (cronograma oficial), tendência (SPI e CPI atuais aplicados ao saldo) e pessimista (tendência + margem). Três curvas de caixa futuras no mesmo gráfico.

**E5. Portfólio**: soma de todas as obras para o caixa da empresa, com o pico consolidado e as obras que mais contribuem para ele.

---

## 7. Lacunas de dados (o que falta para fechar redondo)

| Lacuna | Para quê | Como resolver |
|---|---|---|
| **Contas a pagar e pagas do Mega** (vencimento, pagamento, valor, fornecedor, obra) | B2, D1 (prazo real), C2 (efeito defasagem) | Novo relatório no robô `mega` (módulo Financeiro). Mesmo padrão de extração noturna. |
| **Histórico de versões** do cronograma e da projeção | A1, A2, C2 (efeito escopo) | Tabela de snapshot no schema `public`, gravada pelo app no sync. Não depende de nada externo. |
| **Vínculo pedido → etapa** confiável | B4, D1 (antecedência por etapa) | Verificar se `solicitacoes_por_etapa` / `visualizacao_itens` trazem `cod_estruturado`. Caso sim, já resolve. |
| **Linha de base ativa da Prevision** | A3 | `pontos_mensais.base` já existe. Confirmar que reflete a linha de base ativa (`linhas_base.ativa`). |
| Correspondência obra Mega ↔ projeto Prevision | tudo que cruza AC com físico | `mega.obra_projeto` (parcial, já mapeado no AGENTS.md). |

---

## 8. Roadmap sugerido

**Fase 0 — Correções (pequena, primeiro):** P1 (chave do mapa por etapa + tipo), P2 (usar `dia_pagamento_mo` ou removê-lo da tela), P3 (renomear para "Valor agregado" e separar do custo real). Testes no `curvas-financeiras-engine.test.js`.

**Fase 1 — Comparativo (maior valor por esforço):**
- A1 (snapshot automático);
- A3 (curva de linha de base);
- B1 (AC do Mega por competência);
- B3 (realizado substitui o previsto e o saldo é re-projetado);
- C1 (matriz físico × custo).

Com isso, o módulo passa a responder "previsto × realizado" e "não fiz / não gastei". Tudo isso **só com dados que já existem**.

**Fase 2 — Explicação e automação:**
- C2 (ponte de variação);
- C3 (Earned Schedule);
- D2 e D3 (painel de exceções e diagnóstico em texto);
- B4 (comprometido);
- D4 (justificativas).

**Fase 3 — Caixa real:**
- extração de contas a pagar e pagas no robô `mega`;
- B2 (desembolso real);
- D1 (calibração automática de prazos);
- E2 (retenções).

**Fase 4 — Refinamentos:** E1 (perfis), E3 (INCC/CUB), E4 (cenários), E5 (portfólio), D5 (alertas).

---

## 9. Fontes

**Mercado**
- [Prevision Gestão de Custos — Sienge](https://sienge.com.br/prevision-gestao-custos/)
- [Sienge — Cronograma de desembolso](https://sienge.com.br/blog/cronograma-de-desembolso/)
- [Sienge — Previsibilidade de fluxo de caixa](https://sienge.com.br/blog/previsibilidade-de-fluxo-de-caixa/)
- [Sienge — Conexão planejamento físico e financeiro](https://sienge.com.br/blog/como-a-conexao-entre-planejamento-fisico-e-financeiro-pode-ajudar-na-estrategia-da-empresa/)
- [Sienge — Custo técnico da obra (desembolso × comprometido × custo)](https://sienge.com.br/blog/custo-tecnico-da-obra/)
- [Sienge — Curva S da obra](https://sienge.com.br/blog/curva-s-da-obra/)
- [Mais Controle — Cronograma físico-financeiro](https://intercom.help/mais_controle/pt/articles/4895702-cronograma-fisico-financeiro)
- [OrçaFascio — Cronograma físico-financeiro](https://www.orcafascio.com/papodeengenheiro/cronograma-fisico-financeiro)
- [Baguete — Mobuss Construção](https://www.baguete.com.br/noticias/r-franco-adota-mobuss-construcao)
- [Procore — Advanced Forecasting](https://www.procore.com/blog/produce-cost-forecasts-across-the-project-lifecycle-with-procores-new-advanced-forecasting-solution)
- [Procore — Apply Advanced Forecasting Curves](https://support.procore.com/products/online/user-guide/project-level/budget/tutorials/apply-advanced-forecasting-curves)
- [Procore — Como as curvas distribuem o custo a incorrer](https://support.procore.com/faq/how-do-procores-advanced-forecasting-curves-distribute-projected-cost-to-complete-amounts)
- [Oracle Unifier — Forecast Curve for Cash Flow](https://docs.oracle.com/cd/F37375_01/help/user/en/10298212.htm)
- [Oracle Unifier — Baseline, Forecast e Spends](https://docs.oracle.com/cd/F37375_01/English/User_Guides/evm/10296005.htm)
- [Cash flow curve: P6 schedule + Unifier cost (perfis por WBS)](https://drmcnatty.com/?p=704)
- [Autodesk — Cash flow forecasting](https://www.autodesk.com/blogs/construction/cash-flow-forecasting/)
- [InEight — Forecasting software em construção pesada (2026)](https://ineight.com/the-best-software-for-forecasting-in-capital-construction/)
- [Mastt — S-curve analysis](https://www.mastt.com/blogs/s-curve-analysis)
- [Rabbet — Cash flow management](https://rabbet.com/developers/capabilities/cash-flow-management)
- [Rabbet — Boas práticas de forecast](https://help.rabbet.com/en/articles/9599179-best-practices-for-effectively-forecasting-project-financials)
- [Sage — Forecasting de caixa](https://www.sage.com/en-us/blog/forecasting-software-can-help-you-manage-cash-flow/)

**Teoria e acadêmico**
- [Dourado (UFPE, 2014) — fluxo de caixa planejado × realizado em incorporações](https://repositorio.ufpe.br/jspui/bitstream/123456789/16231/1/Disserta%c3%a7%c3%a3o_2014_12_19_Michelle%20Hofmann%20Dourado.pdf)
- [UFSC — curvas de agregação de recursos](https://repositorio.ufsc.br/handle/123456789/171416)
- [LARES 2019 — vínculo orçamento-cronograma nas medições](https://lares.architexturez.net/system/files/LARES-2019-16_Fiorentino_DiezelMunhoz.pdf)
- [Navon (PMI, 1996) — Cash flow forecasting and updating for building projects](https://www.pmi.org/learning/library/cash-flow-forecasting-updating-building-projects-2045)
- [Odeyinka & Lowe — fatores de risco no forecast de caixa](https://pure.ulster.ac.uk/en/publications/an-assessment-of-risk-factors-involved-in-modeling-cash-flow-fore-3/)
- [Kenley & Wilson (1986) — abordagem idiográfica](https://ibl.kb.nl/article/0000000120211/4/3/1)
- [Precisão de curvas padrão (Emerald)](https://www.emeraldinsight.com/insight/content/doi/10.1108/eb021061/full/html)
- [Lipke — Project Duration Forecasting (Earned Schedule)](https://www.earnedschedule.com/Docs/Project%20Duration%20Forecasting%20%20-%20Walt%20Lipke.pdf)
- [Lipke — Testing ES Forecasting Reliability](https://www.earnedschedule.com/Docs/Testing%20Earned%20Schedule%20Forecasting%20Reliability.pdf)
- [Cioffi & Warburton (PMI) — Refining earned schedule](https://www.pmi.org/learning/library/temporal-schedule-earned-value-parameters-6345)
- [Czarnigowska — Project Performance Reporting](https://www.earnedschedule.com/Docs/Czarnigowska%20-%20Project%20Performance%20Reporting.pdf)
- [PMI — Practical calculation of schedule variance](https://www.pmi.org/learning/library/practical-calculation-schedule-variance-7028)
