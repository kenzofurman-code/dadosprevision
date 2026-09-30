# Gestão de Contratações na Gestão à Vista — Design

Data: 2026-09-28 · Obra piloto: POTY (Mega 650 ↔ Prevision 40661)

## 1. Objetivo

Automatizar, na **Gestão à Vista**, o acompanhamento das contratações que hoje
é feito em duas planilhas manuais:

- **Macro** (planilha "NIZZA – Gestão das Contratações"): por **grupo de
  contratação**, comparar o **custo projetado** (orçamento atualizado no
  término da obra) com o que já foi lançado no sistema (solicitado, cotado,
  pedido/contratado, apropriado) e sinalizar atraso contra datas-limite
  calculadas a partir do cronograma.
- **Micro** (planilha "AMIZ – Follow-up de Suprimentos"): por **etapa de
  orçamento nível 5** e por solicitação, mostrar a trilha solicitação →
  cotação → pedido/contrato → nota, o tempo em cada fase, com quem está
  parado e há quanto tempo.

A aba "Conciliação de Contratações" no Dados Mega foi um passo intermediário
e não é o destino final.

### Critérios de sucesso

1. No POTY, a equipe cria/ajusta grupos e atrela etapas pelo site, vendo a
   lista de etapas fora de grupo, sem editar código ou banco.
2. Importando a planilha de custo projetado do POTY, o painel macro mostra,
   por grupo, projetado × lançado × falta e o sinalizador correto.
3. Abrindo um grupo, cada solicitação mostra trilha, dias por fase e com
   quem está parada.
4. Os números de amostra de grupos conferem com consulta manual no Mega.

## 2. Decisões tomadas com o usuário

| Tema | Decisão |
|---|---|
| Padrão de grupos | Grupos da planilha do Nizza (103 de material + 40 de mão de obra) com seus prazos; ajustáveis por obra |
| Padrão × obra | Obra recebe **cópia** do padrão na primeira configuração; ajustes da obra não afetam padrão nem outras obras |
| Etapas do grupo | Nível 4 ou 5. Nível 4 é agrupador: atrela **todos os níveis 5** abaixo dele. Uma etapa em no máximo um grupo por obra |
| Mão de obra | Os 40 grupos entram **sem etapas**; vínculo feito pela equipe na tela |
| Custo projetado | Importado **mensalmente por obra**; campos: etapa de orçamento e custo projetado |
| Lançado | Cada item conta **uma vez, pela fase mais avançada** (apropriado > pedido/contrato > cotação > solicitação) |
| Fase "feita" no grupo | Por cobertura de valor da fase (ou posteriores) sobre o projetado: ≥ 100% feita; 95–100% **pendência (rever projeção ou dados)**; > 100% do lançado total também **pendência**; < 95% não feita |
| Atraso | **Por fase**, com datas-limite de trás para frente a partir do início; **atenção 7 dias** antes do limite |
| Prazos | Dias **corridos**, como na planilha |
| Com quem está parado | Pedido/contrato: pela alçada; mapa/solicitação: último aprovador + sequência típica |
| Alçadas (pedido e contrato) | 1ª Luis Bronqueti (contrato também Natalia Barbosa); ≥ R$ 50 mil Rafael Medeiros (substituto Ricardo Kitamura); ≥ R$ 100 mil Filipe Biscaia Demeterco. Valem para todas as obras |
| Arquitetura | Dentro do `app`, calculado na hora da consulta (sem pré-cálculo noturno) |

## 3. Vínculos entre as fontes

- **Etapa Mega ↔ orçamento Prevision:** código Mega `XX.XX.XX.XX.XXX`;
  Prevision `XX.XX.XX.XX.XX`. Regra: somar um zero à esquerda do último
  nível da Prevision. Validado: POTY 86% das etapas / 93% das linhas.
- **Orçamento ↔ cronograma:** `pesos_orcamento.id_atividade` →
  `atividades.id_prevision` (data de início/fim).
- **Obra Mega ↔ projeto Prevision:** `mega.obra_projeto` (já preenchida:
  340→41833, 490→37933, 650→40661).
- **Itens do Mega por etapa:** `mega.solicitacoes_por_etapa` (solicitação +
  sequência → etapa); valores e status em `mega.visualizacao_itens`
  (cotação, pedido, contrato); apropriação em `mega.analise_realizado`
  (`raw_data.cod_estruturado`, data do documento = nota).
- **Aprovações:** `mega.approvo_documentos` (status, inclusive "Em
  aprovação") e `mega.approvo_ocorrencias` (aprovador, data/hora).

### Gafes de orçamento (mesmo código com outro nome entre orçamentos)

Ao copiar o padrão para uma obra, compara-se código e nome normalizado
(sem acento, maiúsculas, espaços extras):

| Situação | Resultado |
|---|---|
| código e nome batem | vínculo automático |
| código bate, nome difere | **vínculo sugerido — confirmar** (mostra os dois nomes) |
| nome bate, código difere | **sugestão** na lista de pendências |

Nome do padrão: aba CUSTOS da planilha do Nizza. Nome da obra: orçamento
Prevision (`pesos_orcamento`/`cff_itens`).

## 4. Modelo de dados (schema `public`, dono: `app`)

- `contratacao_grupos`: `id`, `projeto_id` (NULL = padrão), `tipo`
  (`MATERIAL`/`MAO_DE_OBRA`), `item`, `insumos`, `pacote_servicos`,
  `ordem`, prazos em dias (`prazo_levantamento`, `prazo_solicitacao`,
  `prazo_negociacao`, `prazo_emissao`, `prazo_entrega`; para mão de obra
  `prazo_entrega` = entrega do QC e `prazo_emissao` = emissão do contrato +
  integrações), `criado_em`, `atualizado_em`.
- `contratacao_grupo_etapas`: `grupo_id`, `projeto_id`, `codigo_etapa`
  (formato Mega), `nivel` (4/5), `situacao` (`CONFIRMADO`/`SUGERIDO`),
  `nome_padrao`, `nome_obra`. Única por (`projeto_id`, etapa nível 5
  resultante) — validação na aplicação para nível 4 expandido.
- `custo_projetado_importacoes`: `id`, `projeto_id`, `referencia` (mês),
  `arquivo`, `total`, `importado_em`.
- `custo_projetado_itens`: `importacao_id`, `codigo_etapa` (formato Mega,
  nível 5), `custo_projetado`.
- `aprovacao_alcadas`: `tipo_documento`, `ordem`, `valor_minimo`,
  `aprovador`, `substituto`.

O schema `mega` continua exclusivo do serviço `mega`; o `app` só lê dele.

## 5. Painel "Contratações" (Gestão à Vista)

- Botão ao lado dos Painéis 1–5; segue o projeto selecionado; obra via
  `mega.obra_projeto`. Sem obra ou sem custo projetado: mensagem dizendo o
  que falta.
- **Resumo:** total projetado, lançado, falta lançar; contagem de grupos por
  sinalizador.
- **Macro:** uma linha por grupo (Material e Mão de obra separados):
  projetado, lançado, falta, valor em cada fase, data de início (menor
  início das etapas no cronograma), data-limite por fase, sinalizador.
  Ordem: atrasados primeiro, depois data-limite mais próxima.
- **Sinalizador:** atrasado (data-limite de fase não feita já passou),
  atenção (≤ 7 dias), pendência (rever projeção/dados), no prazo,
  concluído, **sem data** (nenhuma etapa com cronograma), **sem projeção**.
- **Micro** (carregado ao abrir o grupo): etapas nível 5 (projetado ×
  lançado) e, por etapa, itens/solicitações com trilha e datas, dias por
  fase, ciclo total, com quem está parado e há quantos dias, atraso contra a
  data-limite do grupo.
- Divergências (etapa sem vínculo Prevision ou sem cronograma) marcadas no
  próprio painel.

## 6. Tela de configuração

Dentro das configurações da Gestão à Vista, para a obra selecionada:

1. **Grupos:** criar, editar (nome, pacote, prazos), excluir (etapas voltam
   às pendências); atrelar/soltar etapas nível 4/5 (mostrando quantos níveis
   5 um nível 4 inclui); confirmar ou soltar vínculos sugeridos; aplicar
   padrão na primeira vez e "Restaurar padrão" com confirmação na página.
2. **Pendências (fora de grupo):** etapas nível 5 sem grupo, com projetado e
   lançado; busca, filtro, seleção múltipla; atrelar a grupo existente ou
   criar grupo com as selecionadas; aceitar sugestões por nome. Etapa já em
   outro grupo: aviso e opção de mover.
3. **Importar custo projetado:** .xlsx ou .csv; colunas localizadas pelo
   nome ("CÓDIGO"/"ETAPA" e "CUSTO PROJETADO"); aceita código Mega ou
   Prevision; ignora níveis 1–4; prévia (linhas lidas, total, etapas
   inexistentes no orçamento, diferença para a importação anterior) antes de
   gravar; mês de referência; histórico mantido.
4. **Alçadas:** tabela editável (tipo, ordem, a partir de, aprovador,
   substituto), já preenchida com as alçadas da seção 2.

## 7. Cálculo e código

- Consultas SQL trazem dados brutos da obra; **regras de negócio num módulo
  puro** `server/contratacoes.js` (fase mais avançada, datas-limite,
  cobertura, sinalizador, com quem está parado) — testável sem banco.
- Front em arquivos próprios (painel e configuração), sem crescer o
  `App.tsx` além da ligação do novo painel.
- Leitura da planilha **no navegador** com a biblioteca `xlsx` (SheetJS) —
  única dependência nova, já que o projeto não tem nenhuma para planilhas
  nem para upload. O navegador envia ao servidor só as linhas (etapa,
  custo) em JSON; o servidor valida, monta a prévia e grava na
  confirmação. Evita adicionar tratamento de upload de arquivo no servidor.

## 8. Testes

- `node --test` (nativo, sem dependência nova) para o módulo de regras:
  fase mais avançada, datas-limite de trás para frente, limites 95/100%,
  sinalizador (incl. sem data / sem projeção), alçadas com substituto.
- Validação com dados reais do POTY (somente leitura) antes de publicar:
  conferir amostra de grupos contra o Mega.

## 9. Entrega em etapas

1. Tabelas + carga do padrão (Nizza) + configuração (grupos, pendências,
   sugestões) + importação de custo projetado.
2. Painel macro com sinalizador (depende do custo projetado do POTY).
3. Painel micro (trilha, alçadas, com quem está parado).

Cada etapa: commit, push e Redeploy do `app` no Coolify pelo usuário.
Criação de tabelas e cargas no banco de produção só com confirmação
explícita do usuário no momento.

## 10. Fora do escopo agora

- Pré-cálculo noturno (só se o tempo de abertura incomodar).
- Alçadas por quantidade/estoque (solicitações) — só sequência típica.
- Campos manuais da aba Mão de Obra (responsável, ação prevista).
- Obras além do POTY (a estrutura já suporta; ativação depois).

## 11. Revisão de 2026-09-29 (após uso da etapa 1)

Decisões do usuário que **substituem** trechos anteriores desta spec:

- **Local:** o Painel 6 "Contratações" é o painel de acompanhamento (macro e
  micro). A configuração da etapa 1 (grupos, etapas fora de grupo, importação
  do custo projetado) muda para as **configurações da Gestão à Vista**.
- **Prazos → lead time:** cada grupo tem `lead_time` (dias corridos da
  solicitação até a entrega em obra) e `levantamento` (informativo, fora do
  cálculo). Padrão: soma das fases da planilha do Nizza — material:
  solicitação + negociação + emissão OC + entrega (45 dias); mão de obra:
  entrega do QC + negociação + emissão do contrato. Editável por grupo. Os 5
  prazos por fase saem da tela.
- **Macro (substitui "fase feita por cobertura" e "atraso por fase"):** por
  grupo, custo projetado; % do projetado solicitado, pedido, contratado e
  realizado; lançado; falta lançar; início (1ª etapa no cronograma);
  data-limite de solicitação = início − lead time. Sinalizador:
  atrasado (passou da data-limite sem 100% solicitado), atenção (≤ 7 dias),
  pendência (lançado 95–100% ou > 100%: rever projeção ou dados), no prazo,
  concluído (100% realizado), sem projeção / sem data. Resumo da obra no topo.
- **Micro:** por etapa (código, nome, %), uma linha por item: solicitação
  (nº, data), insumo, quantidade, trilha de aprovações (pessoa e data por
  passo), mapa de cotação, pedido/contrato (nº, fornecedor, valor), data da
  nota, com quem está parado e há quantos dias, lead time real × do grupo.
- **Checkbox:** padrão minimalista (pequeno, neutro) no site inteiro.
- **Entrega:** etapa 2 = macro + mudança da configuração + checkbox;
  etapa 3 = micro.

## 12. Trilha de aprovação pelo Approvo (levantamento de 2026-09-30)

Dados já extraídos todo dia às 22h em `mega.approvo_documentos` e
`mega.approvo_ocorrencias` (desde 01/2025, com aprovador, data/hora e
aprovação/reprovação). Amostra de 8 trilhas da POTY (jan/2026) mostrou a
cadeia abaixo. Os vínculos vêm de `mega.visualizacao_itens`
(`solicitacao`, `cod_cotacao`, `cod_pedido`, `cod_contrato`).

| Passo | Documento no Approvo | Número usado |
|---|---|---|
| 1 | Solicitação de Obra | nº da solicitação |
| 2 | Estouro de Orçamento (opcional) | nº do mapa de cotação |
| 3 | Mapa de Cotação | nº do mapa de cotação |
| 4 | Pedido de Compra **ou** Contrato de Cotação e Materiais / Contrato Livre | nº do pedido / contrato |
| 5 | Aditivo de Contrato (opcional) | nº do contrato |

Regras decididas:

- **Sem nomes de aprovadores na regra.** A configuração guarda só
  **quantas aprovações** cada passo exige; o sistema conta as aprovações de
  pessoas distintas registradas no Approvo. Nomes aparecem só na tela, como
  informação. Motivo: troca de equipe não pode quebrar a regra.
- Quantidades sugeridas pela amostra (editáveis nas Configurações):
  Solicitação 3, Estouro 1, Mapa 2, Pedido/Contrato 1 até R$ 50 mil e 2
  acima (alçadas Bronqueti → Rafael/Kitamura → Biscaia), Aditivo 2.
- Reprovação zera a contagem do passo: contam só as aprovações depois da
  última reprovação.
- **Valor da Solicitação não é parâmetro.** É frequentemente genérico
  (R$ 1, R$ 5…) porque o solicitante não preenche. Valor do item vem do Mega
  (mapa/pedido/contrato). O valor do Estouro também não é valor do item (é o
  estouro acumulado da etapa).
- Pendências a verificar no plano: contratos sem aprovação no Approvo
  (ex.: POTY 3136, 3166); tipo material × mão de obra vem do grupo
  configurado, não de pedido × contrato.
- Dados Mega ganha uma aba **Approvo** (Documentos e Ocorrências por obra).
