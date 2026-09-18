// Czech public holidays utility
// Returns a map: { 'YYYY-MM-DD': 'Název svátku' }

export function getCzechHolidays(year: number): Record<string, string> {
  // Fixed-date holidays
  const holidays: { [date: string]: string } = {
    [`${year}-01-01`]: 'Nový rok',
    [`${year}-05-01`]: 'Svátek práce',
    [`${year}-05-08`]: 'Den vítězství',
    [`${year}-07-05`]: 'Den slovanských věrozvěstů',
    [`${year}-07-06`]: 'Upálení mistra Jana Husa',
    [`${year}-09-28`]: 'Den české státnosti',
    [`${year}-10-28`]: 'Den vzniku Československa',
    [`${year}-11-17`]: 'Den boje za svobodu a demokracii',
    [`${year}-12-24`]: 'Štědrý den',
    [`${year}-12-25`]: '1. svátek vánoční',
    [`${year}-12-26`]: '2. svátek vánoční',
  }
  // Easter-related holidays
  const easter = calcEaster(year)
  if (easter) {
    // Velký pátek (Good Friday)
    const goodFriday = new Date(easter)
    goodFriday.setDate(goodFriday.getDate() - 2)
    holidays[goodFriday.toISOString().slice(0, 10)] = 'Velký pátek'
    // Velikonoční pondělí (Easter Monday)
    const easterMonday = new Date(easter)
    easterMonday.setDate(easterMonday.getDate() + 1)
    holidays[easterMonday.toISOString().slice(0, 10)] = 'Velikonoční pondělí'
  }
  return holidays
}

// Meeus/Jones/Butcher algorithm for Gregorian Easter
function calcEaster(year: number): Date | null {
  if (year < 1583) return null
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}
