# -*- coding: utf-8 -*-
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import config as cfgmod
import consolidar


def test_recolher_nao_depende_de_pasta_local_removida_do_config(tmp_path, monkeypatch):
    # Regressao: a Task 1 removeu destino.pasta_local do config.yaml. recolher()
    # tinha esse caminho como fallback default e quebrava com KeyError quando
    # chamado sem 'origem' explicito (o caminho padrao de main(), sem
    # --pular-recolher). Confirma que o fallback agora e dados/downloads, nao
    # uma chave de config que nao existe mais.
    cfg = cfgmod.carregar()
    assert "pasta_local" not in cfg["destino"]

    monkeypatch.setattr(consolidar, "BRUTO", tmp_path / "bruto")
    destino, copiados = consolidar.recolher(cfg, "2026-09-07")  # sem 'origem'
    assert destino == tmp_path / "bruto" / "2026-09-07"
    assert copiados == []  # pasta dados/downloads real esta vazia neste teste
