export function monthWeeks(month: { start: Date; end: Date }) {
  const day = 86_400_000
  return [1, 8, 15, 22].map(firstDay => {
    const start = month.start.getTime() + (firstDay - 1) * day
    const end = firstDay === 22 ? month.end.getTime() : start + 7 * day - 1
    return { start, end, label: `${firstDay}–${new Date(end).getUTCDate()}` }
  })
}

export function weeklyActivities(
  activities: { data_inicio?: string; data_fim?: string; pavimento_nome?: string; progresso_realizado?: number }[],
  weeks: ReturnType<typeof monthWeeks>,
  pendingFloorsOnly: boolean,
) {
  const cells = weeks.map(() => ({ count: 0, floors: new Set<string>() }))
  for (const act of activities) {
    if (!act.data_inicio || !act.data_fim) continue
    const start = Date.parse(act.data_inicio)
    const end = Date.parse(act.data_fim)
    weeks.forEach((week, i) => {
      if (start <= week.end && end >= week.start) {
        cells[i].count++
        if (act.pavimento_nome && (!pendingFloorsOnly || (Number(act.progresso_realizado) || 0) < 1)) {
          cells[i].floors.add(act.pavimento_nome)
        }
      }
    })
  }
  return cells
}
