export function formatArea(area: number) {
  return `${area.toLocaleString('en', { maximumFractionDigits: area < 10 ? 1 : 0 })} m²`
}

export function formatLength(metres: number) {
  return `${metres.toFixed(metres < 10 ? 2 : 1)} m`
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`
}
