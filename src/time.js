function formatDateParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  return map;
}

function toDateKey(date, timezone) {
  const p = formatDateParts(date, timezone);
  return `${p.year}-${p.month}-${p.day}`;
}

function toTimeKey(date, timezone) {
  const p = formatDateParts(date, timezone);
  return `${p.hour}:${p.minute}`;
}

function nowDateAndTimeKeys(timezone) {
  const now = new Date();
  return {
    now,
    dateKey: toDateKey(now, timezone),
    timeKey: toTimeKey(now, timezone)
  };
}

module.exports = {
  toDateKey,
  toTimeKey,
  nowDateAndTimeKeys
};
