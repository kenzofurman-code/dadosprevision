# Colunas a confirmar com o usuário — Tarefa 2 (tradutor.py)

Perguntas levantadas durante a implementação de `src/tradutor.py` (Step 13 do
brief da Tarefa 2). Todas as 4 foram respondidas pelo usuário em 2026-09-08 e
já aplicadas em `src/tradutor.py`/`tests/test_tradutor.py`. Nada pendente.

1. **Itens Solicitados — "Código da cotação" duplicada.** Resposta: usar a
   coluna com mais valores preenchidos — confirmado contra
   `dados/consolidado/itens_solicitados.xlsx`: `Código da cotação.1` tem
   25358/25358 não-nulos contra 25024/25358 da coluna sem sufixo. Mantida
   como `codigo_cotacao`; a outra descartada.

2. **Visualização de Itens — cadeia Código/Descrição × 4.** Resposta: não é
   hierarquia, são 4 dimensões diferentes. Confirmado inspecionando a linha 1
   do Excel bruto (mesclada, descartada por `linha_cabecalho: 2`): os rótulos
   reais são **Classe**, **Aplicação**, **Centro de Custo**, **Projeto**,
   nessa ordem. Renomeado para `codigo_classe`/`descricao_classe`,
   `codigo_aplicacao`/`descricao_aplicacao`,
   `codigo_centro_custo`/`descricao_centro_custo`,
   `codigo_projeto`/`descricao_projeto`.

3. **Análise de Saldo (Pedidos) — "Código.1" vs "Código Processo".** Resposta:
   manter a que tem mais valores — empate na amostra (184/184 nos dois);
   mantida `Código Processo` (normaliza sozinha para `codigo_processo`),
   descartada `Código.1`.

4. **Análise de Contratos / Pedidos de Compra — colunas sempre vazias.**
   Resposta: descartar como as fiscais. `Cód. Alternativo.3`/`Descrição.2`
   (Contratos) e `Característica Estoque.1`/`Código` (Pedidos de Compra) foram
   para `COLUNAS_DESCARTAR`.
