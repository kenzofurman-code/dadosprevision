import sqlite3
import sys
from pathlib import Path
import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "src"))

import carregar
import banco
import config as cfgmod

print("Testando _extrair_insumo()...")
num, desc = carregar._extrair_insumo("7889 -  07889-CONSUMO DE ÁGUA E ESGOTO")
assert num == 7889, f"Esperava 7889, obteve {num}"
assert desc == "CONSUMO DE ÁGUA E ESGOTO", f"Esperava CONSUMO DE ÁGUA E ESGOTO, obteve {desc}"

num, desc = carregar._extrair_insumo("287 - 00287-AÇO CA-50 8,0 MM")
assert num == 287
assert desc == "AÇO CA-50 8,0 MM"

num, desc = carregar._extrair_insumo("100 - AREIA MEDIA")
assert num == 100
assert desc == "AREIA MEDIA"

num, desc = carregar._extrair_insumo("INVALIDO")
assert num is None
assert desc == "INVALIDO"
print("OK!")

print("Testando carga de solicitacoes_por_etapa no SQLite...")
conn = sqlite3.connect(":memory:")
conn.execute(
    "CREATE TABLE solicitacoes_por_etapa ("
    "id INTEGER PRIMARY KEY AUTOINCREMENT, obra TEXT, obra_nome TEXT, "
    "data_extracao TEXT, codigo_solicitacao INTEGER, data_de_emissao TEXT, "
    "projeto TEXT, sequencial_item INTEGER, codigo_etapa TEXT, "
    "numero_insumo INTEGER, descricao_insumo TEXT, "
    "data_de_necessidade TEXT, situacao_do_item TEXT, raw_data TEXT)"
)
df = pd.DataFrame({
    "codigo_solicitacao": [861],
    "data_de_emissao": ["2025-01-02"],
    "projeto": ["POTY"],
    "sequencial_item": [1],
    "codigo_etapa": ["01.01.04.03.001"],
    "numero_insumo": [7889],
    "descricao_insumo": ["CONSUMO DE ÁGUA E ESGOTO"],
    "data_de_necessidade": ["2025-01-23"],
    "situacao_do_item": ["Baixada"],
})
df["obra"] = "650"
df["obra_nome"] = "PIEMONTE P78 CARNEIRO LOBO"
df["data_extracao"] = "2026-09-19"
df_final = carregar._separar_raw_data(df, "solicitacoes_por_etapa")
colunas = list(df_final.columns)
linhas = [tuple(row) for row in df_final.itertuples(index=False, name=None)]
banco.substituir_obra(conn, "solicitacoes_por_etapa", colunas, "650", linhas, marcador_parametro="?")
conn.commit()

linhas_bd = conn.execute("SELECT obra, codigo_solicitacao, numero_insumo, descricao_insumo FROM solicitacoes_por_etapa").fetchall()
assert len(linhas_bd) == 1
assert linhas_bd[0] == ("650", 861, 7889, "CONSUMO DE ÁGUA E ESGOTO")
print("OK!")

print("Testando leitura da planilha real gerada...")
caminho_real = RAIZ / "dados" / "bruto" / "2026-09-19" / "Solicitacoes_Por_Etapa_650_2026-09-19.xls"
if caminho_real.exists():
    df_lido = carregar._ler_crystal_solicitacoes_etapa(caminho_real)
    print(f"Linhas extraidas com sucesso da planilha real: {len(df_lido)}")
    assert len(df_lido) > 3000, f"Esperava > 3000 linhas, leu {len(df_lido)}"
    linha_consumo = df_lido[df_lido["numero_insumo"] == 7889]
    assert not linha_consumo.empty
    assert linha_consumo.iloc[0]["descricao_insumo"] == "CONSUMO DE ÁGUA E ESGOTO"
    print("Planilha real testada e validada com perfeicao!")

print("\nTODOS OS TESTES PASSARAM COM SUCESSO!")
