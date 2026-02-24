const dayMap: Record<string, number> = {
  "Вс": 0,
  "Пн": 1,
  "Вт": 2,
  "Ср": 3,
  "Чт": 4,
  "Пт": 5,
  "Сб": 6,
};

export function generateSessions(
  startDate: string,
  schedule: string,
  weeksForward = 4
) {
  const sessions: { date: string; time: string }[] = [];

  const start = new Date(startDate);
  const end = new Date(start);
  end.setDate(end.getDate() + weeksForward * 7);

  // "Вт 20:30, Пт 20:00"
  const parts = schedule.split(",");

  const rules = parts.map((p) => {
    const [day, time] = p.trim().split(" ");
    return { day, time };
  });

  // идём по дням от start до end
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    for (const rule of rules) {
      if (d.getDay() === dayMap[rule.day]) {
        sessions.push({
          date: d.toISOString().split("T")[0],
          time: rule.time,
        });
      }
    }
  }

  return sessions;
}
