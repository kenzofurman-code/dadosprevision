const PREVISION_ENDPOINT = 'https://api.prevision.com.br/graphql'

const PROJECTS_QUERY = `
  query Projects($first: Int!, $after: String) {
    me {
      projectsPage(first: $first, after: $after, archivedLast: true) {
        nodes {
          id
          name
          archivedAt
          finishProjectDate
          activeBaselineEndDate
          updateProcessStatus
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`

const PROJECT_DETAILS_QUERY = `
  query ProjectDetails($id: ID!) {
    me {
      project(id: $id) {
        id
        name
        address
        area
        typology
        phase
        deliveryType
        scheduleType
        pictureUrl
        createdAt
        finishProjectDate
        activeBaselineEndDate
        archivedAt
        updateProcessStatus
        criticalPath
        dashboardStatus { status }
        projectSection { id name }
        summary {
          startAt
          endAt
          expected
          realized
          cost
          realizedCost
          delay
          idp
          daysSinceStart
          daysToEnd
          lastMeasurement
        }
      }
    }
  }
`

const ACTIVITIES_QUERY = `
  query Activities($id: ID!, $first: Int!, $after: String) {
    me {
      project(id: $id) {
        activitiesPageWithoutFilters(first: $first, after: $after) {
          nodes {
            id
            wbsCode
            startAt
            endAt
            workDuration
            percentageCompleted
            expectedPercentageCompleted
            budgetCost
            part
            deletedAt
            hasJobs
            floor { id name replicationGroupName }
            service { id name position }
            measurementUnit { id name symbol type }
            predecessorsPage(first: 20) {
              nodes { predecessor { id wbsCode } delay }
            }
            successorsPage(first: 20) {
              nodes { successor { id wbsCode } delay }
            }
            measuresPage(first: 30) {
              nodes {
                id
                measuredIn
                basePercentageCompleted
                expectedPercentageCompleted
                percentageCompleted
                progress { base expected realized }
              }
            }
            jobs(withDates: true) {
              id
              name
              wbsCode
              percentageCompleted
              expectedPercentageCompleted
              startAt
              endAt
              duration
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`

const BASELINE_STEPS_QUERY = `
  query BaselineSteps($id: ID!, $first: Int!, $after: String) {
    me {
      project(id: $id) {
        activeBaseline {
          baselineStepsPage(first: $first, after: $after) {
            nodes {
              id
              startAt
              endAt
              workDuration
              budgetCost
              activities { id }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }
  }
`

const FLOORS_QUERY = `
  query Floors($id: ID!, $first: Int!, $after: String) {
    me {
      project(id: $id) {
        floorsPage(first: $first, after: $after) {
          nodes {
            id
            name
            position
            area
            tag
            startAt
            endAt
            deletedAt
            replicationGroupName
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`

const SERVICES_QUERY = `
  query Services($id: ID!, $first: Int!, $after: String) {
    me {
      project(id: $id) {
        servicesPage(first: $first, after: $after) {
          nodes {
            id
            name
            position
            color
            unit
            startAt
            endAt
            hasActivities
            hasJobs
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`

const MILESTONES_QUERY = `
  query Milestones($id: ID!, $first: Int!, $after: String) {
    me {
      project(id: $id) {
        milestonesPage(first: $first, after: $after) {
          nodes {
            id
            name
            date
            color
            baseAttribute
            lag
            timeOperation
            visibleInConstruction
            isFromIncorporation
            activity { id }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`

const BASELINES_QUERY = `
  query Baselines($id: ID!, $first: Int!, $after: String) {
    me {
      project(id: $id) {
        baselinesPage(first: $first, after: $after) {
          nodes { id active createdAt lobVersionId }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`

const RESPONSIBLES_QUERY = `
  query Responsibles($id: ID!, $first: Int!, $after: String) {
    me {
      responsiblePage(projectId: $id, first: $first, after: $after) {
        nodes { id name }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`

const TASKS_QUERY = `
  query KanbanStepsAndTasks($first: Int!, $after: String) {
    me {
      taskSummary { userTasks lateTasks weekTasks }
      kanbanStepsPage(first: 100) {
        nodes { id name phase position }
      }
      tasksPage(first: $first, after: $after) {
        nodes {
          id
          title
          description
          createdAt
          dueAt
          doneAt
          delay
          baseAttribute
          timeOperation
          kanbanStep { id name phase position }
          project { id name }
          activity {
            id
            wbsCode
            floor { id name }
            service { id name }
          }
          labels { id name color }
          users { id profile { id name email department job } }
          taskChecklists { id description status dueAt doneAt position }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`

const ANALYTICS_METADATA_QUERY = `
  query AnalyticsMetadata($id: ID!) {
    me {
      project(id: $id) {
        dashboardsPage(first: 20) {
          nodes {
            id
            name
            category
            perspective
            primary
            hasBudgetLink
            dashboardStatus { status updatedAt }
          }
        }
        budgetReportsPage(first: 20) {
          nodes {
            id
            name
            externalBudgetId
            integrationStatus
            lastIntegrationDate
            isSourceFromErp
            totalCost
            totalPhysicalCost
            weightsCost
            validBudgetWeights
            dashboardWeight { id name perspective primary }
          }
        }
        contractWhitelistedBudgetReports { id name }
      }
    }
  }
`

const DASHBOARD_DETAILS_QUERY = `
  query DashboardDetails($id: ID!, $perspective: String!) {
    me {
      project(id: $id) {
        detailedDashboard(perspective: $perspective) {
          generalInfo
          monthlyProgress
          sCurve
        }
        floorEvolution(perspective: $perspective)
        workPackageEvolution(perspective: $perspective)
      }
    }
  }
`

const CFF_QUERY = `
  query BudgetCff($projectId: ID!, $budgetId: ID!) {
    me {
      project(id: $projectId) {
        budgetReport(id: $budgetId) {
          cffTable {
            dates
            rows {
              budgetItem {
                id
                code
                description
                groupType
                level
                materialCost
                laborCost
                totalCost
                ignoredOnErp
                budgetWeights {
                  percentage
                  activity {
                    id
                    service { name }
                    floor { name }
                  }
                  jobBudgetWeights {
                    percentage
                    job { name part activityId }
                  }
                }
              }
              startAt
              endAt
              basePoints { x y }
              expectedPoints { x y }
              realizedPoints { x y }
            }
          }
        }
      }
    }
  }
`

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function sanitizePrevisionApiKey(value) {
  return value
    .trim()
    .replace(/^PREVISION_API_KEY=/i, '')
    .replace(/^["']|["']$/g, '')
    .replace(/^(token|bearer)\s+/i, '')
    .trim()
}

export function sanitizeRestToken(value) {
  return value
    .trim()
    .replace(/^PREVISION_REST_TOKEN=/i, '')
    .replace(/^["']|["']$/g, '')
    .replace(/^bearer\s+/i, '')
    .trim()
}

async function graphqlRequest(apiKey, query, variables, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(PREVISION_ENDPOINT, {
      method: 'POST',
      headers: {
        UserAuthorization: `token ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'dadosprevision/2.0',
      },
      body: JSON.stringify({ query, variables }),
    })
    const payload = await response.json().catch(() => null)

    if (response.status === 429 && attempt < attempts) {
      const retryAfter = Number(response.headers.get('retry-after') || 0)
      await wait(retryAfter > 0 ? retryAfter * 1000 : attempt * 5000)
      continue
    }

    if (!response.ok) {
      const details = payload?.error?.message || payload?.message || payload?.error || ''
      throw new Error(`Prevision retornou HTTP ${response.status}${details ? `: ${details}` : ''}.`)
    }

    if (payload?.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message).join(' | '))
    }

    return payload?.data
  }

  throw new Error('A Prevision nao respondeu apos varias tentativas.')
}

async function fetchConnection(apiKey, query, projectId, selectConnection) {
  const nodes = []
  let after = null

  for (let page = 0; page < 100; page += 1) {
    const data = await graphqlRequest(apiKey, query, {
      id: projectId,
      first: 100,
      after,
    })
    const connection = selectConnection(data)
    nodes.push(...(connection?.nodes || []))

    if (!connection?.pageInfo?.hasNextPage) break
    after = connection.pageInfo.endCursor
    await wait(75)
  }

  return nodes
}

export async function fetchAllProjectIds(apiKey) {
  const projects = []
  let after = null

  for (let page = 0; page < 20; page += 1) {
    const data = await graphqlRequest(apiKey, PROJECTS_QUERY, { first: 100, after })
    const connection = data?.me?.projectsPage
    projects.push(...(connection?.nodes || []))

    if (!connection?.pageInfo?.hasNextPage) break
    after = connection.pageInfo.endCursor
  }

  return projects
}

export async function fetchKanbanData(apiKey) {
  const tasks = []
  let after = null
  let summary = null
  let steps = []

  for (let page = 0; page < 100; page += 1) {
    const data = await graphqlRequest(apiKey, TASKS_QUERY, { first: 100, after })
    const connection = data?.me?.tasksPage
    tasks.push(...(connection?.nodes || []))
    summary ||= data?.me?.taskSummary || null
    if (!steps.length) steps = data?.me?.kanbanStepsPage?.nodes || []

    if (!connection?.pageInfo?.hasNextPage) break
    after = connection.pageInfo.endCursor
    await wait(75)
  }

  return { tasks, summary, steps }
}

export async function fetchAnalyticsData(apiKey, project, projectDetails = null) {
  const projectId = String(project.id)
  let resolvedProjectDetails = projectDetails
  if (!resolvedProjectDetails) {
    const detailsData = await graphqlRequest(apiKey, PROJECT_DETAILS_QUERY, {
      id: projectId,
    })
    resolvedProjectDetails = detailsData?.me?.project || {}
  }
  const metadataData = await graphqlRequest(apiKey, ANALYTICS_METADATA_QUERY, {
    id: projectId,
  })
  const metadata = metadataData?.me?.project || {}
  const budgetReports = metadata.budgetReportsPage?.nodes || []
  const cffReports = []

  for (const budget of budgetReports) {
    try {
      const data = await graphqlRequest(apiKey, CFF_QUERY, {
        projectId,
        budgetId: String(budget.id),
      })
      cffReports.push({
        budgetId: String(budget.id),
        name: budget.name || null,
        data: data?.me?.project?.budgetReport?.cffTable || null,
      })
    } catch (error) {
      console.warn(`CFF indisponivel para o orcamento ${budget.id}.`, error)
    }
  }

  const perspectives = [
    ...new Set(
      (metadata.dashboardsPage?.nodes || [])
        .map((dashboard) => dashboard.perspective)
        .filter(Boolean),
    ),
  ]
  const dashboards = []

  for (const perspective of perspectives) {
    try {
      const data = await graphqlRequest(apiKey, DASHBOARD_DETAILS_QUERY, {
        id: projectId,
        perspective,
      })
      dashboards.push({
        perspective,
        data: data?.me?.project || {},
      })
    } catch (error) {
      console.warn(`Dashboard ${perspective} indisponivel para o projeto ${projectId}.`, error)
    }
  }

  return {
    projectDetails: resolvedProjectDetails,
    projectSummary: resolvedProjectDetails.summary || null,
    budgetReports,
    contractWhitelistedBudgetReports: metadata.contractWhitelistedBudgetReports || [],
    dashboardWeights: metadata.dashboardsPage?.nodes || [],
    cffReports,
    dashboards,
  }
}

export function fetchProjectActivities(apiKey, projectId) {
  return fetchConnection(
    apiKey,
    ACTIVITIES_QUERY,
    String(projectId),
    (data) => data?.me?.project?.activitiesPageWithoutFilters,
  )
}

async function fetchScheduleReport(restToken, projectId) {
  if (!restToken) return []

  const response = await fetch(
    `https://api.prevision.com.br/construction/api/v1/projects/${projectId}/schedule`,
    {
      headers: {
        Authorization: `Bearer ${restToken}`,
        Accept: 'application/json',
        'User-Agent': 'dadosprevision/2.0',
      },
    },
  )
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const details = payload?.message || payload?.error || ''
    throw new Error(
      `Relatorio de atividades retornou HTTP ${response.status}${details ? `: ${details}` : ''}.`,
    )
  }

  return payload?.activities || []
}

export async function fetchProjectData(apiKey, project, restToken = '') {
  const projectId = String(project.id)
  const detailsData = await graphqlRequest(apiKey, PROJECT_DETAILS_QUERY, { id: projectId })
  const details = detailsData?.me?.project || project

  const activities = await fetchProjectActivities(apiKey, projectId)
  const floors = await fetchConnection(
    apiKey,
    FLOORS_QUERY,
    projectId,
    (data) => data?.me?.project?.floorsPage,
  )
  const services = await fetchConnection(
    apiKey,
    SERVICES_QUERY,
    projectId,
    (data) => data?.me?.project?.servicesPage,
  )
  const milestones = await fetchConnection(
    apiKey,
    MILESTONES_QUERY,
    projectId,
    (data) => data?.me?.project?.milestonesPage,
  )
  const baselines = await fetchConnection(
    apiKey,
    BASELINES_QUERY,
    projectId,
    (data) => data?.me?.project?.baselinesPage,
  )
  const responsibles = await fetchConnection(
    apiKey,
    RESPONSIBLES_QUERY,
    projectId,
    (data) => data?.me?.responsiblePage,
  )
  const baselineSteps = await fetchConnection(
    apiKey,
    BASELINE_STEPS_QUERY,
    projectId,
    (data) => data?.me?.project?.activeBaseline?.baselineStepsPage,
  )
  const scheduleActivities = await fetchScheduleReport(restToken, projectId)

  return {
    details,
    activities,
    floors,
    services,
    milestones,
    baselines,
    responsibles,
    baselineSteps,
    scheduleActivities,
  }
}
