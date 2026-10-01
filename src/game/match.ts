import type { Question } from './questions'

const FILLER = /^(a|an|the|my|your|their|some)\s+/

export function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(FILLER, '')
}

function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y'
  if (word.length > 3 && word.endsWith('es')) return word.slice(0, -2)
  if (word.length > 2 && word.endsWith('s')) return word.slice(0, -1)
  return word
}

function distance(a: string, b: string): number {
  if (a === b) return 0
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return row[b.length]
}

function close(input: string, target: string): boolean {
  if (input === target || singular(input) === singular(target)) return true
  const tolerance = target.length >= 8 ? 2 : target.length >= 4 ? 1 : 0
  return tolerance > 0 && distance(input, target) <= tolerance
}

/** Returns the board index the answer matches, or null when it is not on the board. */
export function matchAnswer(question: Question, raw: string): number | null {
  const input = normalize(raw)
  if (!input) return null

  // Pass 1: whole-answer match (with typo tolerance).
  for (let i = 0; i < question.answers.length; i++) {
    const a = question.answers[i]
    const forms = [a.text, ...a.aliases].map(normalize)
    if (forms.some((f) => close(input, f))) return i
  }

  // Pass 2: the answer appears as a phrase inside a longer input ("my car keys").
  const words = ` ${input.split(' ').map(singular).join(' ')} `
  for (let i = 0; i < question.answers.length; i++) {
    const a = question.answers[i]
    const forms = [a.text, ...a.aliases].map(normalize).filter((f) => f.length >= 3)
    if (forms.some((f) => words.includes(` ${f.split(' ').map(singular).join(' ')} `))) return i
  }
  return null
}
