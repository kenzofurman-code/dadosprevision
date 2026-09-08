# -*- coding: utf-8 -*-
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from situacao import derivar_etapa, calcular_transicoes


def test_derivar_etapa_pela_presenca_dos_codigos_do_ciclo():
    assert derivar_etapa({"cod_cotacao": None, "cod_pedido": None,
                          "cod_contrato": None}) == "solicitado"
    assert derivar_etapa({"cod_cotacao": 1, "cod_pedido": None,
                          "cod_contrato": None}) == "cotado"
    assert derivar_etapa({"cod_cotacao": 1, "cod_pedido": 4,
                          "cod_contrato": None}) == "pedido"
    assert derivar_etapa({"cod_cotacao": 1, "cod_pedido": 4,
                          "cod_contrato": 449}) == "contratado"


def _chave(obra, sol, seq, forn):
    return (obra, sol, seq, forn)


def test_item_novo_abre_linha_sem_fechar_nada():
    atual = [{"obra": "340", "solicitacao": 1, "sequencia": 1,
              "fornecedor": "X", "situacao": "Aberto", "etapa": "solicitado"}]
    fechar, abrir = calcular_transicoes(atual, abertas={}, data_iso="2026-09-07")
    assert fechar == []
    assert abrir == [{"obra": "340", "solicitacao": 1, "sequencia": 1,
                      "fornecedor": "X", "situacao": "Aberto",
                      "etapa": "solicitado", "desde": "2026-09-07"}]


def test_item_sem_mudanca_nao_gera_transicao():
    linha_aberta = {"obra": "340", "solicitacao": 1, "sequencia": 1,
                    "fornecedor": "X", "situacao": "Aberto",
                    "etapa": "solicitado", "desde": "2026-09-01"}
    atual = [{"obra": "340", "solicitacao": 1, "sequencia": 1,
              "fornecedor": "X", "situacao": "Aberto", "etapa": "solicitado"}]
    abertas = {_chave("340", 1, 1, "X"): linha_aberta}
    fechar, abrir = calcular_transicoes(atual, abertas, data_iso="2026-09-07")
    assert fechar == []
    assert abrir == []


def test_item_que_mudou_de_etapa_fecha_a_antiga_e_abre_a_nova():
    linha_aberta = {"obra": "340", "solicitacao": 1, "sequencia": 1,
                    "fornecedor": "X", "situacao": "Aberto",
                    "etapa": "solicitado", "desde": "2026-09-01"}
    atual = [{"obra": "340", "solicitacao": 1, "sequencia": 1,
              "fornecedor": "X", "situacao": "Cotado", "etapa": "cotado"}]
    abertas = {_chave("340", 1, 1, "X"): linha_aberta}
    fechar, abrir = calcular_transicoes(atual, abertas, data_iso="2026-09-07")
    assert fechar == [{"obra": "340", "solicitacao": 1, "sequencia": 1,
                       "fornecedor": "X", "desde": "2026-09-01",
                       "ate": "2026-09-07"}]
    assert abrir == [{"obra": "340", "solicitacao": 1, "sequencia": 1,
                      "fornecedor": "X", "situacao": "Cotado",
                      "etapa": "cotado", "desde": "2026-09-07"}]


def test_item_que_sumiu_da_extracao_de_hoje_fecha_sem_abrir_novo():
    # Ex.: item cancelado no ERP. A trilha registra ate quando ficou vigente,
    # mas nao inventa um estado novo sem evidencia.
    linha_aberta = {"obra": "340", "solicitacao": 1, "sequencia": 1,
                    "fornecedor": "X", "situacao": "Aberto",
                    "etapa": "solicitado", "desde": "2026-09-01"}
    abertas = {_chave("340", 1, 1, "X"): linha_aberta}
    fechar, abrir = calcular_transicoes(atual=[], abertas=abertas,
                                        data_iso="2026-09-07")
    assert fechar == [{"obra": "340", "solicitacao": 1, "sequencia": 1,
                       "fornecedor": "X", "desde": "2026-09-01",
                       "ate": "2026-09-07"}]
    assert abrir == []
