# -*- coding: utf-8 -*-
"""Carrega e valida o config.yaml. Ponto unico de verdade sobre obras e relatorios."""
from pathlib import Path
import yaml

RAIZ = Path(__file__).resolve().parent.parent


class ConfigInvalido(Exception):
    pass


def carregar(caminho=None):
    caminho = Path(caminho) if caminho else RAIZ / "config.yaml"
    if not caminho.exists():
        raise ConfigInvalido("config.yaml nao encontrado em %s" % caminho)
    with io_open(caminho) as f:
        cfg = yaml.safe_load(f)
    _validar(cfg)
    return cfg


def io_open(caminho):
    return open(str(caminho), encoding="utf-8")


def _validar(cfg):
    for chave in ("destino", "obras", "relatorios"):
        if chave not in cfg:
            raise ConfigInvalido("secao obrigatoria ausente: %s" % chave)

    codigos = set()
    for o in cfg["obras"]:
        for campo in ("codigo", "nome", "orcamento"):
            if not o.get(campo):
                raise ConfigInvalido("obra sem %s: %r" % (campo, o))
        if o["codigo"] in codigos:
            raise ConfigInvalido("codigo de obra repetido: %s" % o["codigo"])
        codigos.add(o["codigo"])

    ids = set()
    for r in cfg["relatorios"]:
        if not r.get("id"):
            raise ConfigInvalido("relatorio sem id: %r" % r)
        if r["id"] in ids:
            raise ConfigInvalido("id de relatorio repetido: %s" % r["id"])
        ids.add(r["id"])
        if not r.get("exportacoes"):
            raise ConfigInvalido("relatorio %s sem exportacoes" % r["id"])
        leitura = r.get("leitura") or {}
        if not isinstance(leitura.get("linha_cabecalho"), int):
            raise ConfigInvalido(
                "relatorio %s sem leitura.linha_cabecalho (inteiro)" % r["id"])
        for e in r["exportacoes"]:
            if not e.get("arquivo"):
                raise ConfigInvalido("exportacao sem 'arquivo' em %s" % r["id"])
            if "retencao" not in r and "retencao" not in e:
                raise ConfigInvalido(
                    "relatorio %s (exportacao %s) sem 'retencao' declarada"
                    % (r["id"], e["arquivo"]))
    return cfg


def obras(cfg):
    return cfg["obras"]


def relatorios(cfg):
    return cfg["relatorios"]


def relatorio(cfg, rid):
    for r in cfg["relatorios"]:
        if r["id"] == rid:
            return r
    raise ConfigInvalido("relatorio desconhecido: %s" % rid)


def obra(cfg, codigo):
    for o in cfg["obras"]:
        if o["codigo"] == str(codigo):
            return o
    raise ConfigInvalido("obra desconhecida: %s" % codigo)


def nome_arquivo(exportacao, codigo_obra, data_iso):
    """Padrao unico: <Relatorio>_<obra>_<AAAA-MM-DD>.xlsx"""
    return "%s_%s_%s.xlsx" % (exportacao["arquivo"], codigo_obra, data_iso)


def retencao(cfg, rid):
    """Retencao de um relatorio. Para 'analise_saldo_solicitacao', que tem
    politicas diferentes por aba, devolve 'historico_ou_atual' — quem precisa
    do valor por arquivo usa as exportacoes diretamente (ver testes)."""
    rel = relatorio(cfg, rid)
    if "retencao" in rel:
        return rel["retencao"]
    valores = {e["retencao"] for e in rel["exportacoes"] if "retencao" in e}
    if len(valores) > 1:
        return "historico_ou_atual"
    return valores.pop() if valores else None


def chave_natural(cfg, rid):
    """Colunas ORIGINAIS do Excel que formam a chave unica do relatorio, ou
    None quando o relatorio usa id sintetico (sem chave natural declarada)."""
    rel = relatorio(cfg, rid)
    return rel.get("chave_natural")


def tabela_destino(cfg, rid):
    """Nome da tabela no schema mega, sem o prefixo. Por ora e o proprio id do
    relatorio; para analise_saldo_solicitacao, quem precisa do nome por
    exportacao usa exp['arquivo'].lower()."""
    return rid
