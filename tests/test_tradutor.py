# -*- coding: utf-8 -*-
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from tradutor import normalizar_nome_coluna, traduzir_colunas


def test_normaliza_acentos_espacos_e_pontuacao():
    assert normalizar_nome_coluna("Data de emissão") == "data_de_emissao"
    assert normalizar_nome_coluna("Situação do Item") == "situacao_do_item"
    assert normalizar_nome_coluna("Qtde. Convertida") == "qtde_convertida"
    assert normalizar_nome_coluna("Cód.Agente") == "cod_agente"
    assert normalizar_nome_coluna("% Desconto Geral") == "pct_desconto_geral"
    assert normalizar_nome_coluna("Nr.Processo") == "nr_processo"


def test_traduzir_colunas_aplica_normalizacao_automatica_por_padrao():
    df = pd.DataFrame({"obra": [340], "Data de emissão": ["2025-01-02"],
                       "Situação do Item": ["Baixado"]})
    saida = traduzir_colunas(df, "itens_solicitados")
    assert list(saida.columns) == ["obra", "data_de_emissao", "situacao_do_item"]


def test_pedidos_compra_descarta_as_49_colunas_fiscais():
    colunas_fiscais = [
        "Vlr. Base IPI", "% I.P.I", "Vlr. IPI", "Vlr. Isento IPI", "Vlr. Outros IPI",
        "IPI Recuperado", "Incide IPI", "Operação IPI",
        "Vlr. Base ICMS", "% I.C.M.S.", "Vlr. ICMS", "Vlr. Isento ICMS",
        "Vlr. Outros ICMS", "ICMS Recuperado", "ICMS Retido", "% Dif.ICMS",
        "Vlr.Dif. ICMS", "Vlr.Base Sub.Trib.", "ICMS definido pelo peso",
        "Incide ICMS", "Operação ICMS", "Vlr. do ICMS retido anteriormente",
        "Vlr. da base de substituição anteriormente",
        "Vlr.Base ISS Devido", "% ISS Devido", "Valor ISS Devido",
        "Vlr.Base ISS Retido", "% ISS Retido", "Valor ISS Retido", "Incide ISS",
        "Base I.R.R.F.", "% I.R.R.F", "Vlr. I.R.R.F.",
        "Vlr.Base I.N.S.S.", "% I.N.S.S", "Valor INSS",
        "Vlr. do PIS retido", "Vlr. PIS recupera", "% PIS", "Vlr. PIS",
        "Vlr. da base do PIS",
        "Vlr. do COFINS retido", "Vlr. COFINS recupera", "% COFINS", "Vlr. COFINS",
        "Vlr. da base do COFINS",
        "% CSLL", "Vlr. da base do CSLL", "Vlr. CSLL",
    ]
    assert len(colunas_fiscais) == 49
    dados = {"obra": [340], "Número do pedido": [4], "Item Pedido": [1]}
    dados.update({c: [0] for c in colunas_fiscais})
    df = pd.DataFrame(dados)
    saida = traduzir_colunas(df, "pedidos_compra")
    for c in colunas_fiscais:
        assert c not in saida.columns
    assert "obra" in saida.columns
    assert "numero_do_pedido" in saida.columns


def test_renomeio_manual_desambigua_colunas_homonimas_em_itens_solicitados():
    # "Codigo da cotacao" aparece duas vezes no Excel de Itens Solicitados —
    # confirmado com o usuario: a coluna com sufixo ".1" tem mais valores
    # preenchidos (25358 de 25358, contra 25024 de 25358 da coluna sem
    # sufixo) — mantida como codigo_cotacao; a outra e descartada.
    df = pd.DataFrame({
        "obra": [340],
        "Código da cotação": [None],
        "Código da cotação.1": [1],
    })
    saida = traduzir_colunas(df, "itens_solicitados")
    assert "codigo_cotacao" in saida.columns
    assert "Código da cotação" not in saida.columns


def test_renomeio_manual_das_4_dimensoes_em_visualizacao_itens():
    # NAO e uma hierarquia de niveis — confirmado com o usuario: sao 4
    # dimensoes de classificacao independentes (Classe/Aplicacao/Centro de
    # Custo/Projeto), reveladas pela linha de titulo mesclada do Excel
    # (Excel linha 1, descartada por linha_cabecalho=2) acima de cada par
    # Codigo/Descricao.
    df = pd.DataFrame({
        "obra": [340],
        "Código": [189], "Descrição.1": ["Viagens/Hospedagens (Obras)"],
        "Código.1": [109], "Descrição.2": ["Obra-Outras Entradas"],
        "Código.2": [35], "Descrição.3": ["Obras - Custos"],
        "Código.3": [13], "Descrição.4": ["Amáz (BALNEARIO ...)"],
        "Fornecedor": ["9966 - RAMIRO GIL SOBRADO JUNIOR"],
        "Fornecedor.1": ["5414 - WD3 CONSTRUCOES LTDA"],
    })
    saida = traduzir_colunas(df, "visualizacao_itens")
    esperado = {
        "codigo_classe", "descricao_classe",
        "codigo_aplicacao", "descricao_aplicacao",
        "codigo_centro_custo", "descricao_centro_custo",
        "codigo_projeto", "descricao_projeto",
        "fornecedor", "fornecedor_contrato",
    }
    assert esperado.issubset(set(saida.columns))


def test_renomeio_manual_por_chave_composta_para_analise_saldo_solicitacao():
    # "Codigo" e ambiguo entre pedido e contrato so nesta tela: o rel_id e
    # sempre "analise_saldo_solicitacao" (a config nao tem relatorios
    # separados "analise_pedidos"/"analise_contratos"), entao o renomeio so
    # pode ser resolvido pela aba.
    df_pedidos = pd.DataFrame({"obra": [340], "Código": [4]})
    saida_pedidos = traduzir_colunas(df_pedidos, "analise_saldo_solicitacao", aba="Pedidos")
    assert "codigo_pedido" in saida_pedidos.columns

    df_contratos = pd.DataFrame({"obra": [340], "Código": [449]})
    saida_contratos = traduzir_colunas(df_contratos, "analise_saldo_solicitacao", aba="Contratos")
    assert "codigo_contrato" in saida_contratos.columns
