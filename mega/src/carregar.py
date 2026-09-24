# -*- coding: utf-8 -*-
"""Le os .xlsx de dados/bruto/<data>/, traduz e grava no schema mega.

Regra conservadora, igual a consolidar.py: so grava as obras que a extracao da
noite marcou como "ok" ou "sem_movimento". Uma obra "falhou" mantem os dados de
ontem intocados no banco.

IMPORTANTE: as colunas obra/obra_nome/data_extracao NAO vem do ERP — a tela do
Mega nao as exibe, entao o .xlsx exportado (via biblioteca.Operador.exportar_grid)
nunca as tem. Elas sao sinteticas e precisam ser inseridas AQUI, uma vez por
obra, logo apos ler o .xlsx e antes de traduzir_colunas — mesmo padrao ja usado
em consolidar.consolidar() para o arquivo consolidado (df.insert(0/1/2, ...)).
"""
import datetime as dt
import json
import math
from pathlib import Path
import re

import pandas as pd

import banco
import config as cfgmod
import situacao
from consolidar import _ler as ler_bruto
from consolidar import conferir_contaminacao
from tradutor import traduzir_colunas

RAIZ = Path(__file__).resolve().parent.parent

# Mapeamento fixo arquivo->tabela. cfgmod.tabela_destino() so serve para
# relatorios de exportacao unica (devolve o proprio rel_id); relatorios com
# varias exportacoes/abas (analise_saldo_solicitacao) precisam de uma tabela
# por arquivo, entao o mapeamento fica explicito aqui.
TABELA_POR_ARQUIVO = {
    "Itens_Solicitados": "itens_solicitados",
    "Visualizacao_Itens": "visualizacao_itens",
    "Pedidos_Compra": "pedidos_compra",
    "Solicitacoes_Por_Etapa": "solicitacoes_por_etapa",
    "Analise_Pedidos": "analise_pedidos_hist",
    "Analise_Contratos": "analise_contratos_hist",
    "Analise_Realizado": "analise_realizado",
    "Medicoes": "medicoes_contratos",
    "Follow_Up_Itens": "contratos_itens",
}

# Colunas que cada tabela de sql/schema_mega.sql realmente declara (sem id, sem
# raw_data e sem obra/obra_nome/data_extracao, que sao sinteticas e sempre vao).
# A traducao devolve DEZENAS de colunas a mais do que o schema curado — mandar
# todas para o INSERT quebraria com UndefinedColumn. O excedente vai para
# raw_data (ver _separar_raw_data).
TABELA_COLUNAS = {
    "itens_solicitados": [
        "codigo_solicitacao", "numero_rm", "sequencial_item", "data_de_emissao",
        "situacao_do_item", "descricao_do_item", "quantidade_solicitada",
        "quantidade_baixada", "unidade",
    ],
    "visualizacao_itens": [
        "orcamento", "solicitacao", "sequencia", "fornecedor", "cod_item",
        "descricao", "qtde_solicitada", "data_de_necessidade", "data_inclusao",
        "valor_total", "situacao_do_item", "cod_cotacao", "cod_pedido", "cod_contrato",
    ],
    "pedidos_compra": [
        "numero_do_pedido", "item_pedido", "situacao_do_pedido", "dt_emissao",
        "nome_fantasia", "descricao_do_item", "quantidade", "total_pedido_compra",
    ],
    "solicitacoes_por_etapa": [
        "codigo_solicitacao", "data_de_emissao", "projeto", "sequencial_item",
        "codigo_etapa", "numero_insumo", "descricao_insumo", "data_de_necessidade",
        "situacao_do_item",
    ],
    "analise_realizado": [
        "documento", "data_documento", "ap", "fornecedor", "valor_apropriacao",
    ],
    "analise_pedidos_hist": [
        "codigo_pedido", "fornecedor", "qtde_pedido", "valor_unitario",
        "qtde_apropriada", "valor_apropriacao",
    ],
    "analise_contratos_hist": [
        "codigo_contrato", "fornecedor", "status_pre_contrato",
        "saldo_qtde_contrato", "valor_unitario", "total",
    ],
    "medicoes_contratos": [
        "numero_contrato", "numero_medicao", "item_sequencial",
        "periodo_inicio", "periodo_fim", "descricao_servico", "unidade",
        "quantidade_medida", "valor_unitario", "valor_total", "valor_faturado",
        "fornecedor_nome", "fornecedor_cnpj", "data_emissao", "situacao_medicao",
        "inss", "iss", "irrf", "caucao",
    ],
    "contratos_itens": [
        "cod_contrato", "cod_item", "cod_alternativo", "consolidador",
        "cod_agrupador", "aditivo", "item_alternativo", "descricao",
        "cod_padrao", "cod_unidade", "unidade", "quantidade",
        "valor_unitario", "total_item", "total_contratado", "situacao",
    ],
}

CHAVES_NATURAIS = {
    "medicoes_contratos": ["obra", "numero_contrato", "numero_medicao", "item_sequencial"],
    "contratos_itens": ["obra", "cod_contrato", "cod_item", "aditivo"],
}


def _extrair_insumo(texto):
    """Separa o numero_insumo e a descricao_insumo a partir do texto do Crystal Reports.
    Ex: '7889 -  07889-CONSUMO DE ÁGUA E ESGOTO' -> (7889, 'CONSUMO DE ÁGUA E ESGOTO')."""
    if not texto or not isinstance(texto, str):
        return None, None
    texto = texto.strip()
    partes = texto.split(" - ", 1)
    num_str = partes[0].strip()
    try:
        num = int(num_str)
    except Exception:
        num = None
    desc = partes[1].strip() if len(partes) > 1 else texto
    if "-" in desc:
        desc = desc.split("-", 1)[1].strip()
    return num, desc


def _ler_crystal_solicitacoes_etapa(caminho):
    """Le o .xls do Crystal Reports, descarta cabecalhos de impressao e linhas
    em branco, e extrai as colunas de dados estruturadas."""
    df_raw = pd.read_excel(caminho, header=None)
    mask = df_raw[0].notna() & df_raw[0].apply(lambda x: isinstance(x, (int, float)))
    dados = df_raw[mask].copy()
    colunas_uteis = [0, 2, 4, 8, 10, 12, 14, 17]
    dados = dados[colunas_uteis]
    insumos = dados[12].apply(_extrair_insumo)
    dados["numero_insumo"] = [i[0] for i in insumos]
    dados["descricao_insumo"] = [i[1] for i in insumos]
    renomeio = {
        0: "codigo_solicitacao",
        2: "data_de_emissao",
        4: "projeto",
        8: "sequencial_item",
        10: "codigo_etapa",
        14: "data_de_necessidade",
        17: "situacao_do_item",
    }
    dados = dados.rename(columns=renomeio)
    dados = dados.drop(columns=[12], errors="ignore")
    return dados


def _ler_crystal_medicoes(caminho):
    """Le o .xls/.xlsx do Crystal Reports de medicoes de contratos (dados2.xlsx).
    Extrai as linhas de medicao estruturadas e soma retencoes fiscais/caucao."""
    df_raw = pd.read_excel(caminho, header=None)
    col_contrato = 5
    for c in df_raw.columns:
        if df_raw[c].astype(str).str.contains('Contrato', case=False, na=False).any():
            col_contrato = c
            break

    col_med = col_contrato + 1 if (col_contrato + 1) in df_raw.columns else 6
    for c in df_raw.columns:
        if df_raw[c].astype(str).str.contains('Medi', case=False, na=False).any():
            col_med = c
            break

    mask_contrato = df_raw[col_contrato].astype(str).str.contains('Contrato', case=False, na=False)
    indices_contrato = df_raw[mask_contrato].index.tolist()

    if not indices_contrato:
        print("[AVISO] _ler_crystal_medicoes: nenhuma linha com 'Contrato' encontrada na planilha %s (shape %s)" % (caminho.name, df_raw.shape), flush=True)

    registros = []
    total_linhas = len(df_raw)
    contadores = {}

    for i, idx in enumerate(indices_contrato):
        prox_idx = indices_contrato[i + 1] if i + 1 < len(indices_contrato) else total_linhas
        row = df_raw.iloc[idx]

        c_qtd = row[0]
        c_und = str(row[1]).strip() if pd.notna(row[1]) else None
        c_desc = str(row[2]).strip() if pd.notna(row[2]) else None
        c_unit = row[3]
        c_tot = row[4]

        c_cont_str = str(row[col_contrato])
        m_cont = re.search(r'(\d+)', c_cont_str)
        num_contrato = int(m_cont.group(1)) if m_cont else 0

        c_med_str = str(row[col_med])
        m_med = re.search(r'Medi[^\d]*(\d+)', c_med_str)
        num_medicao = int(m_med.group(1)) if m_med else 0

        m_per_ini = re.search(r'Per[^\d]*(\d{2}/\d{2}/\d{4})', c_med_str)
        per_ini = m_per_ini.group(1) if m_per_ini else None
        if per_ini:
            try:
                per_ini = dt.datetime.strptime(per_ini, "%d/%m/%Y").date()
            except Exception:
                pass

        m_per_fim = re.search(r'a\s+(\d{2}/\d{2}/\d{4})', c_med_str)
        per_fim = m_per_fim.group(1) if m_per_fim else None
        if per_fim:
            try:
                per_fim = dt.datetime.strptime(per_fim, "%d/%m/%Y").date()
            except Exception:
                pass

        c_faturado = row[7]
        c_fornec = str(row[8]).strip() if pd.notna(row[8]) else None

        c_cnpj_str = str(row[9]) if pd.notna(row[9]) else ''
        m_cnpj = re.search(r'(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2})', c_cnpj_str)
        cnpj = m_cnpj.group(1) if m_cnpj else None

        c_emiss_str = str(row[10]) if pd.notna(row[10]) else ''
        m_emiss = re.search(r'(\d{2}/\d{2}/\d{4})', c_emiss_str)
        dt_emiss = m_emiss.group(1) if m_emiss else None
        if dt_emiss:
            try:
                dt_emiss = dt.datetime.strptime(dt_emiss, "%d/%m/%Y").date()
            except Exception:
                pass

        status = str(row[11]).strip() if pd.notna(row[11]) else None

        # Sublinhas entre idx+1 e prox_idx para retenções
        inss = 0.0
        iss = 0.0
        irrf = 0.0
        caucao = 0.0

        for sub_i in range(idx + 1, prox_idx):
            sub_tipo = str(df_raw.iloc[sub_i, 3] or '').strip().upper()
            sub_val = df_raw.iloc[sub_i, 2]
            if pd.notna(sub_val) and isinstance(sub_val, (int, float)):
                if 'INSS' in sub_tipo:
                    inss += float(sub_val)
                elif 'ISS' in sub_tipo:
                    iss += float(sub_val)
                elif 'IRRF' in sub_tipo:
                    irrf += float(sub_val)
                elif 'CAU' in sub_tipo:
                    caucao += float(sub_val)

        chave_med = (num_contrato, num_medicao)
        contadores[chave_med] = contadores.get(chave_med, 0) + 1
        item_seq = contadores[chave_med]

        registros.append({
            'numero_contrato': num_contrato,
            'numero_medicao': num_medicao,
            'item_sequencial': item_seq,
            'periodo_inicio': per_ini,
            'periodo_fim': per_fim,
            'descricao_servico': c_desc,
            'unidade': c_und,
            'quantidade_medida': float(c_qtd) if pd.notna(c_qtd) else 0.0,
            'valor_unitario': float(c_unit) if pd.notna(c_unit) else 0.0,
            'valor_total': float(c_tot) if pd.notna(c_tot) else 0.0,
            'valor_faturado': float(c_faturado) if pd.notna(c_faturado) else 0.0,
            'fornecedor_nome': c_fornec,
            'fornecedor_cnpj': cnpj,
            'data_emissao': dt_emiss,
            'situacao_medicao': status,
            'inss': inss,
            'iss': iss,
            'irrf': irrf,
            'caucao': caucao,
        })

    return pd.DataFrame(registros)



def _serializavel(valor):
    """JSON nao entende NaN, Timestamp nem os escalares do numpy; normaliza
    para algo que entenda. As colunas numericas do .xlsx viram numpy.int64 /
    numpy.float64, que json.dumps rejeita com TypeError."""
    if valor is None or (isinstance(valor, float) and math.isnan(valor)):
        return None
    if hasattr(valor, "isoformat"):
        return valor.isoformat()
    if hasattr(valor, "item"):   # numpy.int64, numpy.float64, numpy.bool_
        valor = valor.item()
        if isinstance(valor, float) and math.isnan(valor):
            return None
    return valor


def _separar_raw_data(df, tabela):
    """Mantem so as colunas que a tabela de destino conhece (mais
    obra/obra_nome/data_extracao, sempre presentes); tudo o mais vai
    serializado em raw_data — a tabela sempre tem essa coluna JSONB para
    isso, em vez de o INSERT falhar por coluna desconhecida."""
    fixas = ["obra", "obra_nome", "data_extracao"]
    conhecidas = fixas + [c for c in TABELA_COLUNAS[tabela] if c in df.columns]
    extras = [c for c in df.columns if c not in conhecidas]
    saida = df[conhecidas].copy()
    if tabela == "visualizacao_itens" and "solicitacao" in saida.columns:
        # O grid do ERP inclui uma linha de RODAPE com o total geral (so
        # "Valor Total" preenchido, tudo mais vazio) — sobrevive ao
        # dropna(how="all") de consolidar._ler porque nao esta 100% vazia.
        # Nao e um item real: nao tem Solicitacao, que e parte da PRIMARY
        # KEY. Confirmado contra um Postgres 16 real em 2026-09-08 (violava
        # NOT NULL em "solicitacao"; a mesma linha aparecia com Valor Total
        # = 47853338.57, o valor maximo da coluna, batendo com um total).
        saida = saida[saida["solicitacao"].notna()]
    if tabela == "visualizacao_itens" and "fornecedor" in saida.columns:
        # "fornecedor" e NOT NULL (parte da PRIMARY KEY, chave_natural
        # verificada em config.yaml) mas fica vazio em ~28% das linhas reais
        # (item ainda sem fornecedor definido, nao so quando falta cotacao —
        # confirmado contra dados/bruto/2026-09-02: 912 de 3203 linhas da
        # obra 340). Substituir por string vazia preserva a unicidade da
        # chave (verificado sem colisao nas 25.244 linhas reais das 8 obras)
        # sem violar o NOT NULL.
        saida["fornecedor"] = saida["fornecedor"].fillna("")
    if tabela == "contratos_itens":
        # Descarta linhas de rodapé ou vazias que não têm cod_contrato / cod_item
        if "cod_contrato" in saida.columns and "cod_item" in saida.columns:
            saida = saida[saida["cod_contrato"].notna() & saida["cod_item"].notna()].copy()
            try:
                saida["cod_contrato"] = saida["cod_contrato"].astype(int)
                saida["cod_item"] = saida["cod_item"].astype(int)
            except Exception:
                pass
        if "aditivo" in saida.columns:
            saida["aditivo"] = saida["aditivo"].fillna("").astype(str)
    # NaN do pandas nao vira NULL sozinho: o Postgres recusa NaN num campo
    # BIGINT/NUMERIC com "out of range" (confirmado contra um Postgres 16 real
    # em 2026-09-08 — cod_contrato vazio, comum quando o item ainda nao foi
    # contratado, quebrava TODA a carga). Converter para None aqui, coluna a
    # coluna, antes de qualquer INSERT usar esses valores.
    for c in conhecidas:
        saida[c] = saida[c].astype(object).where(saida[c].notna(), None)
    if extras:
        saida["raw_data"] = df[extras].apply(
            lambda linha: json.dumps(
                {c: _serializavel(linha[c]) for c in extras}, ensure_ascii=False),
            axis=1)
    else:
        saida["raw_data"] = "{}"
    return saida


def _sem_nan(valor):
    """pd.read_excel devolve NaN (float) para celula vazia. Em Python, bool(nan)
    e True — se passassemos o NaN direto para situacao.derivar_etapa, uma
    coluna "Cod. Cotacao" vazia seria lida como "tem cotacao". Normalizar para
    None aqui evita esse falso positivo."""
    return None if pd.isna(valor) else valor


def _atualizar_trilha_situacao(conn, obra, df, data_iso, marcador_parametro):
    """So se aplica a visualizacao_itens (retencao 'atual_com_trilha'): deriva
    a etapa de cada linha de hoje e grava as transicoes na trilha
    mega.item_situacao_hist (situacao.py da Tarefa 3 + banco.py da Tarefa 5)."""
    atual = []
    for linha in df.to_dict("records"):
        etapa = situacao.derivar_etapa({
            "cod_cotacao": _sem_nan(linha.get("cod_cotacao")),
            "cod_pedido": _sem_nan(linha.get("cod_pedido")),
            "cod_contrato": _sem_nan(linha.get("cod_contrato")),
        })
        atual.append({
            "obra": obra,
            "solicitacao": linha.get("solicitacao"),
            "sequencia": linha.get("sequencia"),
            "fornecedor": linha.get("fornecedor"),
            "situacao": linha.get("situacao_do_item"),
            "etapa": etapa,
        })
    abertas = banco.buscar_abertas(conn, obra, marcador_parametro=marcador_parametro)
    fechar, abrir = situacao.calcular_transicoes(atual, abertas, data_iso)
    banco.aplicar_transicoes_situacao(conn, fechar, abrir,
                                      marcador_parametro=marcador_parametro)


def carregar_relatorio(cfg, conn, rel_id, data_iso, pasta, resultado_execucao,
                       marcador_parametro="%s"):
    """Carrega TODAS as exportacoes de um relatorio (um relatorio pode ter
    varias abas, cada uma com seu proprio arquivo/tabela/retencao — ver
    analise_saldo_solicitacao em config.yaml). Devolve um relato por
    exportacao processada."""
    rel = cfgmod.relatorio(cfg, rel_id)
    pasta = Path(pasta)

    obras_a_carregar = resultado_execucao.get("ok", []) + resultado_execucao.get(
        "sem_movimento", [])

    # Se NENHUMA obra teve sucesso nem sem_movimento (todas falharam), bloqueia a carga
    if not obras_a_carregar:
        motivo = "todas as obras falharam: %s" % ",".join(
            f["obra"] if isinstance(f, dict) else f for f in resultado_execucao.get("falhou", []))
        for exp in rel["exportacoes"]:
            banco.registrar_carga(conn, rel_id, exp["arquivo"], data_iso,
                                  resultado_execucao, bloqueado=True, motivo=motivo,
                                  marcador_parametro=marcador_parametro)
        return [{"arquivo": exp["arquivo"], "estado": "BLOQUEADO", "obras": 0,
                "motivo": motivo} for exp in rel["exportacoes"]]

    relatos = []
    for exp in rel["exportacoes"]:
        arquivo_base = exp["arquivo"]
        aba = exp.get("aba")
        retencao = exp.get("retencao", rel.get("retencao"))
        tabela = TABELA_POR_ARQUIVO[arquivo_base]

        por_obra = {}
        # o traduzido INTEIRO (antes de _separar_raw_data mover o excedente para
        # raw_data): a checagem de contaminacao precisa da coluna `filial`, que
        # nao esta entre as colunas conhecidas de nenhuma tabela.
        por_obra_traduzido = {}
        for obra in obras_a_carregar:
            caminho = pasta / ("%s_%s_%s.xlsx" % (arquivo_base, obra, data_iso))
            if not caminho.exists():
                caminho = pasta / ("%s_%s_%s.xls" % (arquivo_base, obra, data_iso))
            if not caminho.exists():
                continue
            if arquivo_base == "Solicitacoes_Por_Etapa":
                df = _ler_crystal_solicitacoes_etapa(caminho)
            elif arquivo_base == "Medicoes":
                df = _ler_crystal_medicoes(caminho)
            else:
                df = ler_bruto(caminho, rel["leitura"])
            df.insert(0, "obra", obra)
            df.insert(1, "obra_nome", cfgmod.obra(cfg, obra)["nome"])
            df.insert(2, "data_extracao", data_iso)
            df_traduzido = traduzir_colunas(df, rel_id, aba=aba)
            por_obra_traduzido[obra] = df_traduzido
            por_obra[obra] = _separar_raw_data(df_traduzido, tabela)
            if len(df) == 0:
                print("   [AVISO] %s: 0 registros extraidos da planilha para a obra %s" % (arquivo_base, obra), flush=True)
            else:
                print("   [CARGA] %s: %d registros preparados para insercao (obra %s)" % (arquivo_base, len(df), obra), flush=True)

        if not por_obra:
            if resultado_execucao.get("sem_movimento"):
                banco.registrar_carga(conn, rel_id, arquivo_base, data_iso, resultado_execucao,
                                      bloqueado=False, motivo="sem movimento",
                                      marcador_parametro=marcador_parametro)
                relatos.append({"arquivo": arquivo_base, "estado": "SEM_MOVIMENTO", "obras": 0,
                                "motivo": "sem movimento"})
                continue
            relatos.append({"arquivo": arquivo_base, "estado": "VAZIO", "obras": 0,
                            "motivo": "nenhum arquivo encontrado"})
            continue

        # Robo trocou de empresa e a tela nao acompanhou: a unica falha que
        # passaria despercebida por semanas. Bloqueia a exportacao INTEIRA.
        problemas_contaminacao = []
        for obra, df in por_obra_traduzido.items():
            problemas_contaminacao.extend(
                conferir_contaminacao(df, coluna_filial="filial"))

        if problemas_contaminacao:
            motivo = "contaminacao entre obras: %s" % "; ".join(problemas_contaminacao)
            banco.registrar_carga(conn, rel_id, arquivo_base, data_iso,
                                  resultado_execucao, bloqueado=True, motivo=motivo,
                                  marcador_parametro=marcador_parametro)
            relatos.append({"arquivo": arquivo_base, "estado": "BLOQUEADO", "obras": 0,
                            "motivo": motivo})
            continue

        for obra, df in por_obra.items():
            colunas = list(df.columns)
            linhas = [tuple(row) for row in df.itertuples(index=False, name=None)]
            if retencao == "historico":
                banco.inserir_historico(conn, tabela, colunas, linhas,
                                        marcador_parametro=marcador_parametro)
            elif retencao == "upsert":
                chaves = CHAVES_NATURAIS.get(tabela, ["obra"])
                banco.upsert_linhas(conn, tabela, colunas, chaves, linhas,
                                    marcador_parametro=marcador_parametro)
            else:
                banco.substituir_obra(conn, tabela, colunas, obra, linhas,
                                      marcador_parametro=marcador_parametro)
            if arquivo_base == "Visualizacao_Itens":
                _atualizar_trilha_situacao(conn, obra, df, data_iso, marcador_parametro)

        motivo_parcial = None
        if resultado_execucao.get("falhou"):
            motivo_parcial = "carga parcial; obras com falha: %s" % ",".join(
                f["obra"] if isinstance(f, dict) else f for f in resultado_execucao["falhou"])

        banco.registrar_carga(conn, rel_id, arquivo_base, data_iso, resultado_execucao,
                              bloqueado=False, motivo=motivo_parcial,
                              marcador_parametro=marcador_parametro)
        relatos.append({"arquivo": arquivo_base, "estado": "OK", "obras": len(por_obra),
                        "obras_carregadas": list(por_obra.keys()),
                        "motivo": motivo_parcial})

    return relatos


def purgar_arquivos(pasta, relatos, data_iso):
    """Apaga os .xlsx e .xls das obras cuja carga foi efetuada com sucesso (estado OK)."""
    pasta = Path(pasta)
    apagados = []
    for relato in relatos:
        if relato.get("estado") != "OK":
            continue
        obras_carregadas = relato.get("obras_carregadas")
        extensoes = ("xlsx", "xls")
        if obras_carregadas is not None:
            for obra in obras_carregadas:
                for ext in extensoes:
                    for caminho in pasta.glob("%s_%s_%s.%s" % (relato["arquivo"], obra, data_iso, ext)):
                        caminho.unlink(missing_ok=True)
                        apagados.append(caminho)
        else:
            for ext in extensoes:
                for caminho in pasta.glob("%s_*_%s.%s" % (relato["arquivo"], data_iso, ext)):
                    caminho.unlink(missing_ok=True)
                    apagados.append(caminho)
    return apagados
