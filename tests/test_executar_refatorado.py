# -*- coding: utf-8 -*-
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import executar


def test_executar_relatorio_existe_e_aceita_a_assinatura_esperada():
    import inspect
    assinatura = inspect.signature(executar.executar_relatorio)
    parametros = list(assinatura.parameters)
    assert parametros == ["op", "v", "s", "rel", "obras", "data_iso", "pasta",
                          "falhas_dir", "log"]


def test_executar_relatorio_devolve_dict_com_as_tres_chaves_do_resultado():
    # Teste de contrato, nao de comportamento: usa uma obra vazia para nao
    # exigir sessao real, so verificando a FORMA do retorno.
    resultado = executar.executar_relatorio(
        op=None, v=None, s=None, rel={"id": "x", "exportacoes": []},
        obras=[], data_iso="2026-09-07", pasta=Path("."), falhas_dir=Path("."),
        log=lambda *a: None)
    assert set(resultado.keys()) == {"ok", "sem_movimento", "falhou"}
    assert resultado == {"ok": [], "sem_movimento": [], "falhou": []}
