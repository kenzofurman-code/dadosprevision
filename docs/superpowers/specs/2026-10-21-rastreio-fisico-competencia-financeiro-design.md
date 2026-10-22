# Rastreio físico → competência → financeiro

Data: 2026-10-21 · Módulo: Curvas de Competência e Financeira (`server/curvas-financeiras-engine.js`,
`src/components/curvas-financeiras/`)

## Intenção

Responder, olhando um mês da curva: **de onde veio este valor?**
- O **físico-financeiro** (cronograma × custo) gera a competência.
- A **competência** de material e de MO gera o financeiro, aplicando as condições de pagamento e a retenção.

Ao clicar numa célula, o usuário vê a cadeia com valores, e **a soma sempre fecha**.

## Decisões do usuário

- **Layout:** é o esboço "A". A etapa abre em 5 linhas (físico, competência material, competência MO, financeiro material, financeiro MO), com setas na própria planilha. Ao lado, o painel de **Rastreio** do esboço "C" mostra a tabela que fecha o valor.
- **Cores das setas:** **material em laranja**, **mão de obra em roxo**.
- **Setas carregam valor e fecham:**
  - o que sai de uma célula de físico soma o valor dela, dividido em material e MO;
  - o que chega numa célula de competência ou financeiro soma o valor dela.
- **Sentido:**
  - clicar no **físico** mostra **para onde vai**;
  - clicar em **competência** mostra **de onde veio** (físico) e **para onde vai** (financeiro);
  - clicar em **financeiro** mostra **de onde veio**, subindo até o físico.
- **A MO se divide entre dois meses** por causa do corte do dia 20, e o rastreio mostra essa divisão.
- **Interação (aceita):**
  - passar o mouse mostra a prévia das setas, clara;
  - o clique fixa as setas e abre o painel;
  - clicar numa origem dentro do painel continua subindo a cadeia;
  - `Esc` ou clique fora limpa.
  - **Não é tooltip.**

## Pré-requisito: as três curvas partem do mesmo físico

Hoje a soma **não fecharia**, porque a MO e o físico sem pesos mensais usam regras diferentes da do material. A proposta é alinhar tudo no **físico diário da etapa**:

- **Físico diário:** o peso mensal do cronograma (`pontos_mensais[].previsto`, com fallback para `base`) é espalhado igualmente pelos dias daquele mês dentro do intervalo da etapa. É exatamente o que o material proporcional já faz hoje. Sem pesos mensais, o rateio é uniforme entre o início e o fim.
- **Físico mensal:** é a soma dos dias. **Muda:** sem pesos mensais, hoje 100% da etapa cai no mês de início.
- **Competência de material:**
  - modo proporcional: sem mudança;
  - **modo em lotes (regra do usuário, muda o comportamento):** o prazo da atividade (início → fim) é dividido em **N períodos iguais**, um por entrega.
    - **Chegada:** a entrega k chega **`dias_antecedencia` antes do início do seu período**. A 1ª chega antes do início da atividade. Com 10 meses e 2 entregas, a 2ª chega pouco antes do mês 6. No último período não chega nada além da entrega dele.
    - **Valor:** a entrega k leva **o material do físico do seu período** (soma do físico diário nos dias do período × parte de material). Execução uniforme dá N partes iguais; períodos mais carregados geram entregas mais pesadas.
    - **Origem nas setas:** a entrega k abastece exatamente os dias físicos do seu período.
    - **Hoje é diferente:** as entregas têm valores iguais (1/N) e são espaçadas entre "início − antecedência" e "fim − antecedência", então a última chega no fim da atividade.
- **Aprovações do usuário (2026-10-21):**
  - MO seguindo o físico mês a mês;
  - físico espalhado entre início e fim quando não há peso mensal;
  - nova regra de lotes.
- **Competência de MO:** passa a usar o **físico diário**, com o corte do dia 20 sobre cada dia. **Muda:** hoje é rateio uniforme entre início e fim, ignorando o peso mensal do cronograma. **Consequência esperada:** a curva de MO de obras com cronograma irregular vai mudar.
- **Financeiro:** sem mudança. Cada parcela, a retenção e o dia de pagamento da MO saem da competência que os gerou.

## Dado novo: fluxos

O motor passa a devolver, por etapa, a lista de **fluxos**. Cada fluxo é uma fatia de dinheiro com a origem e os dois destinos conhecidos:

```
{ tipo: 'MATERIAL'|'MAO_DE_OBRA', fis: 'YYYY-MM', comp: 'YYYY-MM', fin: 'YYYY-MM', valor, motivo }
```

- **`motivo`**: texto curto do que explica o salto. Exemplos: "chega 35 dias antes", "lote 3 de 6", "dias 21 a 31 (corte dia 20)", "parcela 2/12 (56 dias)", "retenção 5%, liberada em 06/2028", "pago dia 5".
- **Invariantes** (testes):
  - Σ fluxos por (tipo, fis) = parte daquele tipo no físico do mês;
  - Σ por (tipo, comp) = competência do mês;
  - Σ por (tipo, fin) = financeiro do mês.
  
  Tolerância de 1 centavo por arredondamento.
- **Agregação:** fluxos com o mesmo (tipo, fis, comp, fin, motivo) são somados.
- **Envio:** os fluxos vão no payload da API (`etapas[].fluxos`). As versões salvas **não** guardam fluxos (decisão do builder, para não inflar o banco), e o rastreio fica indisponível em versão salva, com aviso.
- **Compatibilidade:** `mensal` e as séries consolidadas passam a ser derivados dos fluxos, uma fonte só.

## Tela

- **Onde:** na **Planilha Mensal Analítica**, que ganha o modo **"Rastreio"** ao lado do seletor de medida.
- **No modo Rastreio:**
  - **Linhas:** etapas nível 5, cada uma com as 5 linhas. As etapas-mãe ficam como cabeçalho de grupo, recolhíveis, sem setas (**decisão do builder**: o rastreio é por etapa).
  - **Tela compacta (decisão do usuário):** fonte e altura de linha reduzidas (≈11px de fonte, ≈16px por linha). O bloco das 5 linhas de uma etapa ocupa mais ou menos a altura de 4 linhas da planilha de hoje, para caber várias etapas na tela. O código e o nome da etapa ficam numa célula mesclada à esquerda do bloco, e o rótulo de cada linha é abreviado (Físico · Comp. Mat · Comp. MO · Fin. Mat · Fin. MO).
  - **Só etapas com valor (decisão do usuário):** etapas com tudo zerado no período ficam ocultas por padrão, inclusive na Planilha Analítica comum. O botão "Mostrar etapas sem valor" traz de volta. Etapas-mãe sem nenhum filho visível também somem.
  - **Filtro de etapa:** busca por código ou nome, porque uma obra tem cerca de 390 etapas.
  - **Setas em SVG** sobre a tabela:
    - cada seta tem o valor escrito;
    - a espessura é proporcional ao valor;
    - setas abaixo de 1% do valor da célula são agrupadas no painel como "outras".
  - **Painel de Rastreio** à direita:
    - cabeçalho com etapa, linha, mês e valor;
    - a tabela de origens e destinos (mês, tipo, valor, motivo);
    - a linha **Total ✓ fecha**;
    - cada linha é clicável e continua a cadeia.
- **Destaques:**
  - célula clicada: borda vermelha;
  - células de origem ou destino: borda na cor do tipo.

## Fora do escopo

- Rastreio no gráfico (curva S).
- Rastreio de valores realizados.
- Exportar o rastreio.

## Verificação

- **Testes do motor:**
  - as três invariantes de soma, em etapas com: pesos mensais irregulares; sem pesos; material em lotes; parcelado; retenção; corte do dia 20 entre meses;
  - MO seguindo o físico (mês com peso 0 não gera MO);
  - os fluxos reproduzem `mensal` e as séries.
- `npm run build`.
- Conferência manual na POTY: clicar em 3 células (uma de físico, uma de competência MO na virada do mês e uma de financeiro material parcelado) e verificar que o painel fecha.
