# -*- coding: utf-8 -*-
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import config as cfgmod


def _cfg():
    return cfgmod.carregar()


def test_retencao_por_relatorio_bate_com_o_decidido_com_o_usuario():
    cfg = _cfg()
    # Decisões da spec (Seção "Política de retenção"), uma por uma.
    assert cfgmod.retencao(cfg, "itens_solicitados") == "atual"
    assert cfgmod.retencao(cfg, "visualizacao_itens") == "atual_com_trilha"
    assert cfgmod.retencao(cfg, "pedidos_compra") == "atual"
    assert cfgmod.retencao(cfg, "analise_saldo_solicitacao") == "historico_ou_atual"


def test_retencao_por_aba_da_analise_de_saldo():
    # analise_saldo_solicitacao tem 3 exportacoes (abas) com politicas DIFERENTES:
    # Pedidos e Contratos = historico; Realizado = atual.
    cfg = _cfg()
    rel = cfgmod.relatorio(cfg, "analise_saldo_solicitacao")
    por_arquivo = {e["arquivo"]: e["retencao"] for e in rel["exportacoes"]}
    assert por_arquivo["Analise_Pedidos"] == "historico"
    assert por_arquivo["Analise_Contratos"] == "historico"
    assert por_arquivo["Analise_Realizado"] == "atual"


def test_tabela_destino_usa_nome_em_snake_case():
    cfg = _cfg()
    assert cfgmod.tabela_destino(cfg, "itens_solicitados") == "itens_solicitados"
    assert cfgmod.tabela_destino(cfg, "visualizacao_itens") == "visualizacao_itens"


def test_chave_natural_declarada_para_quem_tem_e_ausente_para_quem_nao_tem():
    cfg = _cfg()
    rel = cfgmod.relatorio(cfg, "itens_solicitados")
    assert rel["chave_natural"] == [
        "Código da solicitação", "Nr. RM", "Sequencial do item",
    ]
    rel_realizado = cfgmod.relatorio(cfg, "analise_saldo_solicitacao")
    exp_realizado = next(e for e in rel_realizado["exportacoes"]
                         if e["arquivo"] == "Analise_Realizado")
    assert exp_realizado.get("chave_natural") is None  # usa id sintetico


def test_destino_pasta_local_morta_foi_removido():
    # dados/bruto/<data> ja e onde o exportar_grid grava (biblioteca.py); a
    # pasta_local do Windows Downloads nunca chega a ser lida por ninguem no
    # pipeline novo. Mantida no config seria um convite a reintroduzir o bug.
    cfg = _cfg()
    assert "pasta_local" not in cfg["destino"]
    assert "notificacao" not in cfg   # decisao do usuario: sem alerta ativo
