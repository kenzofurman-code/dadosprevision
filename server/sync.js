import { query } from './db.js'
import {
  fetchAllProjectIds,
  fetchAnalyticsData,
  fetchKanbanData,
  fetchProjectData,
} from '../lib/prevision-client.js'

function clean(value) {
  return JSON.parse(JSON.stringify(value || {}))
}

export async function syncProjects(apiKey, restToken = '', requestedProjectId = '') {
  console.log('Iniciando sincronizacao com a API da Prevision...')
  const projectIds = requestedProjectId
    ? [requestedProjectId]
    : await fetchAllProjectIds(apiKey)

  console.log(`Projetos a sincronizar: ${projectIds.length}`)
  const totals = {
    projects: 0,
    activities: 0,
    floors: 0,
    services: 0,
    milestones: 0,
    baselines: 0,
    responsibles: 0,
    cffItems: 0,
    budgetWeights: 0,
    measurements: 0,
    analytics: 0,
  }

  for (const projectId of projectIds) {
    try {
      console.log(`Sincronizando projeto ${projectId}...`)
      const projectData = await fetchProjectData(apiKey, projectId)
      const kanbanData = restToken
        ? await fetchKanbanData(apiKey, restToken, projectId, {
            activities: projectData.activities || [],
            floors: projectData.floors || [],
            services: projectData.services || [],
          })
        : { measurements: [], cffItems: [], budgetWeights: [] }

      const analyticsData = await fetchAnalyticsData(apiKey, projectId).catch(() => null)

      // 1. Salvar Projeto
      await query(
        `INSERT INTO projetos (
          id_prevision, nome_projeto, empresa_nome, endereco, data_inicio, data_fim,
          data_inicio_real, data_fim_real, progresso_realizado, progresso_planejado,
          progresso_revisado, percentual_previsto, percentual_realizado, percentual_revisado,
          restricoes, resumo, raw_data, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
        ON CONFLICT (id_prevision) DO UPDATE SET
          nome_projeto = EXCLUDED.nome_projeto,
          empresa_nome = EXCLUDED.empresa_nome,
          endereco = EXCLUDED.endereco,
          data_inicio = EXCLUDED.data_inicio,
          data_fim = EXCLUDED.data_fim,
          data_inicio_real = EXCLUDED.data_inicio_real,
          data_fim_real = EXCLUDED.data_fim_real,
          progresso_realizado = EXCLUDED.progresso_realizado,
          progresso_planejado = EXCLUDED.progresso_planejado,
          progresso_revisado = EXCLUDED.progresso_revisado,
          percentual_previsto = EXCLUDED.percentual_previsto,
          percentual_realizado = EXCLUDED.percentual_realizado,
          percentual_revisado = EXCLUDED.percentual_revisado,
          restricoes = EXCLUDED.restricoes,
          resumo = EXCLUDED.resumo,
          raw_data = EXCLUDED.raw_data,
          updated_at = NOW()`,
        [
          String(projectData.id),
          projectData.name || `Projeto ${projectId}`,
          projectData.companyName || '-',
          projectData.address || null,
          projectData.startDate || null,
          projectData.endDate || null,
          projectData.actualStartDate || null,
          projectData.actualEndDate || null,
          Number(projectData.actualProgress) || 0,
          Number(projectData.plannedProgress) || 0,
          Number(projectData.revisedProgress) || 0,
          Number(projectData.expectedPercentage) || 0,
          Number(projectData.actualPercentage) || 0,
          Number(projectData.revisedPercentage) || 0,
          JSON.stringify(projectData.restrictions || []),
          JSON.stringify(projectData.summary || {}),
          JSON.stringify(clean(projectData)),
        ],
      )
      totals.projects += 1

      // 2. Salvar Pavimentos
      for (const f of projectData.floors || []) {
        await query(
          `INSERT INTO pavimentos (id_prevision, projeto_id, projeto_nome, nome, posicao, grupo_repeticao, progresso_realizado, progresso_planejado, raw_data, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
           ON CONFLICT (id_prevision) DO UPDATE SET
            nome = EXCLUDED.nome,
            posicao = EXCLUDED.posicao,
            grupo_repeticao = EXCLUDED.grupo_repeticao,
            progresso_realizado = EXCLUDED.progresso_realizado,
            progresso_planejado = EXCLUDED.progresso_planejado,
            raw_data = EXCLUDED.raw_data,
            updated_at = NOW()`,
          [
            String(f.id_prevision || f.id),
            String(projectData.id),
            projectData.name,
            f.nome || f.name,
            Number(f.posicao ?? f.position) || 0,
            f.grupo_repeticao || null,
            Number(f.progresso_realizado) || 0,
            Number(f.progresso_planejado) || 0,
            JSON.stringify(clean(f)),
          ],
        )
        totals.floors += 1
      }

      // 3. Salvar Servicos
      for (const s of projectData.services || []) {
        await query(
          `INSERT INTO servicos (id_prevision, projeto_id, projeto_nome, nome, posicao, progresso_realizado, progresso_planejado, raw_data, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT (id_prevision) DO UPDATE SET
            nome = EXCLUDED.nome,
            posicao = EXCLUDED.posicao,
            progresso_realizado = EXCLUDED.progresso_realizado,
            progresso_planejado = EXCLUDED.progresso_planejado,
            raw_data = EXCLUDED.raw_data,
            updated_at = NOW()`,
          [
            String(s.id_prevision || s.id),
            String(projectData.id),
            projectData.name,
            s.nome || s.name,
            Number(s.posicao ?? s.position) || 0,
            Number(s.progresso_realizado) || 0,
            Number(s.progresso_planejado) || 0,
            JSON.stringify(clean(s)),
          ],
        )
        totals.services += 1
      }

      // 4. Salvar Atividades
      for (const a of projectData.activities || []) {
        await query(
          `INSERT INTO atividades (
            id_prevision, projeto_id, projeto_nome, codigo_eap, servico_id, servico_nome,
            pavimento_id, pavimento_nome, grupo_repeticao, posicao_servico, posicao_pavimento,
            data_inicio, data_fim, data_inicio_real, data_fim_real, duracao_dias,
            progresso_realizado, progresso_planejado, progresso_revisado, status, responsavel_nome,
            microservicos, raw_data, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, NOW())
          ON CONFLICT (id_prevision) DO UPDATE SET
            codigo_eap = EXCLUDED.codigo_eap,
            servico_nome = EXCLUDED.servico_nome,
            pavimento_nome = EXCLUDED.pavimento_nome,
            grupo_repeticao = EXCLUDED.grupo_repeticao,
            posicao_servico = EXCLUDED.posicao_servico,
            posicao_pavimento = EXCLUDED.posicao_pavimento,
            data_inicio = EXCLUDED.data_inicio,
            data_fim = EXCLUDED.data_fim,
            data_inicio_real = EXCLUDED.data_inicio_real,
            data_fim_real = EXCLUDED.data_fim_real,
            duracao_dias = EXCLUDED.duracao_dias,
            progresso_realizado = EXCLUDED.progresso_realizado,
            progresso_planejado = EXCLUDED.progresso_planejado,
            progresso_revisado = EXCLUDED.progresso_revisado,
            status = EXCLUDED.status,
            responsavel_nome = EXCLUDED.responsavel_nome,
            microservicos = EXCLUDED.microservicos,
            raw_data = EXCLUDED.raw_data,
            updated_at = NOW()`,
          [
            String(a.id_prevision || a.id),
            String(projectData.id),
            projectData.name,
            a.codigo_eap || a.eapCode || null,
            String(a.servico_id || a.serviceId || ''),
            a.servico_nome || a.serviceName || null,
            String(a.pavimento_id || a.floorId || ''),
            a.pavimento_nome || a.floorName || null,
            a.grupo_repeticao || null,
            Number(a.posicao_servico ?? a.servicePosition) || 999,
            Number(a.posicao_pavimento ?? a.floorPosition) || 999,
            a.data_inicio || a.startDate || null,
            a.data_fim || a.endDate || null,
            a.data_inicio_real || a.actualStartDate || null,
            a.data_fim_real || a.actualEndDate || null,
            Number(a.duracao_dias ?? a.durationDays) || 0,
            Number(a.progresso_realizado ?? a.actualProgress) || 0,
            Number(a.progresso_planejado ?? a.plannedProgress) || 0,
            Number(a.progresso_revisado ?? a.revisedProgress) || 0,
            a.status || null,
            a.responsavel_nome || a.responsibleName || null,
            JSON.stringify(a.microservicos || []),
            JSON.stringify(clean(a)),
          ],
        )
        totals.activities += 1
      }

      // 5. Salvar CFF Itens
      for (const item of kanbanData.cffItems || []) {
        await query(
          `INSERT INTO cff_itens (
            id_prevision, projeto_id, projeto_nome, codigo, descricao, nivel, unidade,
            quantidade, valor_unitario, valor_total, peso_percentual, distribuicao_mensal,
            distribuicao_semanal, raw_data, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
          ON CONFLICT (id_prevision) DO UPDATE SET
            codigo = EXCLUDED.codigo,
            descricao = EXCLUDED.descricao,
            nivel = EXCLUDED.nivel,
            unidade = EXCLUDED.unidade,
            quantidade = EXCLUDED.quantidade,
            valor_unitario = EXCLUDED.valor_unitario,
            valor_total = EXCLUDED.valor_total,
            peso_percentual = EXCLUDED.peso_percentual,
            distribuicao_mensal = EXCLUDED.distribuicao_mensal,
            distribuicao_semanal = EXCLUDED.distribuicao_semanal,
            raw_data = EXCLUDED.raw_data,
            updated_at = NOW()`,
          [
            String(item.id_prevision || item.id),
            String(projectData.id),
            projectData.name,
            item.codigo || item.code || null,
            item.descricao || item.description || '-',
            Number(item.nivel ?? item.level) || 1,
            item.unidade || null,
            Number(item.quantidade) || 0,
            Number(item.valor_unitario) || 0,
            Number(item.valor_total) || 0,
            Number(item.peso_percentual) || 0,
            JSON.stringify(item.distribuicao_mensal || []),
            JSON.stringify(item.distribuicao_semanal || []),
            JSON.stringify(clean(item)),
          ],
        )
        totals.cffItems += 1
      }

      // 6. Salvar Pesos Orcamento
      for (const w of kanbanData.budgetWeights || []) {
        await query(
          `INSERT INTO pesos_orcamento (id_prevision, projeto_id, projeto_nome, item_orcamento_id, atividade_id, peso, raw_data, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (id_prevision) DO UPDATE SET
            peso = EXCLUDED.peso,
            raw_data = EXCLUDED.raw_data,
            updated_at = NOW()`,
          [
            String(w.id_prevision || w.id),
            String(projectData.id),
            projectData.name,
            String(w.item_orcamento_id || ''),
            String(w.atividade_id || ''),
            Number(w.peso) || 0,
            JSON.stringify(clean(w)),
          ],
        )
        totals.budgetWeights += 1
      }

      // 7. Salvar Analiticos
      if (analyticsData) {
        await query(
          `INSERT INTO analiticos (
            id_prevision, projeto_id, projeto_nome, orcamentos, cff_resumo, dashboard_geral,
            dashboard_semanal, dashboard_mensal, dashboard_servicos, dashboard_lotes,
            dashboard_estados, raw_data, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
          ON CONFLICT (id_prevision) DO UPDATE SET
            orcamentos = EXCLUDED.orcamentos,
            cff_resumo = EXCLUDED.cff_resumo,
            dashboard_geral = EXCLUDED.dashboard_geral,
            dashboard_semanal = EXCLUDED.dashboard_semanal,
            dashboard_mensal = EXCLUDED.dashboard_mensal,
            dashboard_servicos = EXCLUDED.dashboard_servicos,
            dashboard_lotes = EXCLUDED.dashboard_lotes,
            dashboard_estados = EXCLUDED.dashboard_estados,
            raw_data = EXCLUDED.raw_data,
            updated_at = NOW()`,
          [
            String(projectData.id),
            String(projectData.id),
            projectData.name,
            JSON.stringify(analyticsData.orcamentos || []),
            JSON.stringify(analyticsData.cff_resumo || []),
            JSON.stringify(analyticsData.dashboard_geral || []),
            JSON.stringify(analyticsData.dashboard_semanal || []),
            JSON.stringify(analyticsData.dashboard_mensal || []),
            JSON.stringify(analyticsData.dashboard_servicos || []),
            JSON.stringify(analyticsData.dashboard_lotes || []),
            JSON.stringify(analyticsData.dashboard_estados || []),
            JSON.stringify(clean(analyticsData)),
          ],
        )
        totals.analytics += 1
      }

      console.log(`Projeto ${projectData.name} (${projectId}) sincronizado com sucesso.`)
    } catch (projectError) {
      console.error(`Erro ao sincronizar projeto ${projectId}:`, projectError)
    }
  }

  console.log('Sincronizacao concluida!', totals)
  return totals
}
