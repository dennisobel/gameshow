// The shape of a question as the screens receive it. The questions themselves
// come from the server, one round at a time; nothing is bundled here.

export interface Answer {
  /** Empty until the answer is earned or the round closes. */
  text: string
  points: number
  /** Always empty on a phone: what a board will accept is never sent. */
  aliases: string[]
}

export interface Question {
  id: string
  prompt: string
  answers: Answer[]
  decoys: string[]
}

export type RoundKind = 'normal' | 'double' | 'final' | 'sudden'

export interface RoundDef {
  kind: RoundKind
  multiplier: number
  seconds: number
  question: Question
}

export const SHOW_NAME = 'On The Board'
export const HOST_NAME = 'Nova'
