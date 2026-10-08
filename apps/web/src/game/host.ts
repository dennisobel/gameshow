// The host's script. Nova is the connective tissue between game states (PRD §36):
// every state change is announced by a line from here.

export type Personality = 'funny' | 'dramatic' | 'sarcastic' | 'friendly'

export type Mood =
  | 'neutral'
  | 'happy'
  | 'excited'
  | 'surprised'
  | 'sad'
  | 'thinking'
  | 'smug'
  | 'celebrate'

export type HostEvent =
  | 'home'
  | 'setupP1'
  | 'setupP2'
  | 'create'
  | 'join'
  | 'lobby'
  | 'intro'
  | 'roundIntro'
  | 'doubleIntro'
  | 'finalQuestion'
  | 'suddenQuestion'
  | 'faceoff'
  | 'firstLock'
  | 'bothLocked'
  | 'revealFirst'
  | 'revealOnly'
  | 'revealSteal'
  | 'correct'
  | 'wrong'
  | 'stealChance'
  | 'stealOpen'
  | 'stealSuccess'
  | 'late'
  | 'lateSame'
  | 'lateWrong'
  | 'timeUp'
  | 'stealTimeUp'
  | 'nobody'
  | 'boardReveal'
  | 'roundWrapLead'
  | 'roundWrapClose'
  | 'roundWrapTie'
  | 'roundWrapNobody'
  | 'scoreboard'
  | 'finalIntro'
  | 'suddenIntro'
  | 'winner'
  | 'loser'
  | 'draw'

export type HostVars = Record<string, string | number>

type Script = Partial<Record<HostEvent, string[]>>

const FUNNY: Record<HostEvent, string[]> = {
  home: ['Hey you! Ready to get your answers on the board?', "Lights up. Crowd's warm. All we need is you."],
  setupP1: ["First things first. Who's playing?", 'Contestant number one, introduce yourself!'],
  setupP2: ['And who dares to challenge {p1}?', '{p1} needs a rival. Who is it?'],
  create: ["Your own room! Share the code and I'll warm up the crowd."],
  join: ['Got a room code? Punch it in.'],
  lobby: ['{p1} and {p2}. I can feel the tension already.', '{p1} versus {p2}. Somebody grab the popcorn.'],
  intro: ['Welcome, {p1}! Versus {p2}! {rounds} rounds. One winner.'],
  roundIntro: ['Round {nWord}. Eyes up!', 'Round {nWord}. Here we go!'],
  doubleIntro: ['Round {nWord} is worth DOUBLE. No pressure.'],
  finalQuestion: ['Final round. Triple points. This is it.'],
  suddenQuestion: ['Sudden death. One answer. Winner takes all.'],
  faceoff: ["Clock's running!", 'Go go go!', 'Type fast, think faster!'],
  firstLock: ['{name} locks it in! Clock is ticking, {other}.', 'Ooh, {name} is fast! Your move, {other}.'],
  bothLocked: ["Both answers are in. Let's find out."],
  revealFirst: ['{name} was first. {name} said... {answer}!'],
  revealOnly: ['Only {name} locked in. {name} said... {answer}!'],
  revealSteal: ['{name} goes for the steal with... {answer}!'],
  correct: ["OH! That's on the board!", "YES! {answer} is on the board!"],
  wrong: ["Nope. I'm afraid that's not there.", 'Oooh... not this time.'],
  stealChance: ['{name}, this is your chance to steal!'],
  stealOpen: ['{name}, steal it! You have ten seconds.'],
  stealSuccess: ['STOLEN! {name} takes the points!', 'Snatched it! {answer} for {name}!'],
  late: ['{name} had {answer} too. On the board, but too slow!'],
  lateSame: ['{name} said {answer} as well. Great minds, slower fingers.'],
  lateWrong: ['And {name} said {answer}... not there either.'],
  timeUp: ["Time! Nobody locked in. Really? Nobody?"],
  stealTimeUp: ["Time's up, {name}. The steal slips away."],
  nobody: ['Nobody scores! The board keeps its secrets.'],
  boardReveal: ["Let's see what else was up there."],
  roundWrapLead: ['Round {nWord} is in the books. And {leader} is pulling ahead!', "{leader} leads. {trailer}, don't panic. Yet."],
  roundWrapClose: ['This is getting VERY interesting.', 'Round {nWord} done. And we have got a game!'],
  roundWrapTie: ['All square! Anyone could take this.'],
  roundWrapNobody: ['Nobody scored that round. The board wins... this time.'],
  scoreboard: ['Ready for round {nextWord}?', 'Deep breath. Round {nextWord} is coming.'],
  finalIntro: ['THIS changes everything.'],
  suddenIntro: ['One question. One answer. Winner takes all.'],
  winner: ['WHAT A GAME! {name} takes the crown!'],
  loser: ["That was CLOSE, {name}. Rematch?"],
  draw: ['A draw! Nobody takes the crown... this time.'],
}

const DRAMATIC: Script = {
  home: ['Tonight... two players enter. Only one leaves with the crown.'],
  lobby: ['{p1}. {p2}. Destiny has brought you here.'],
  intro: ['Welcome, {p1}! Versus... {p2}! {rounds} rounds. ONE winner.'],
  roundIntro: ['Round {nWord}. Everything hangs on this.'],
  faceoff: ['The clock... is... running.'],
  correct: ['YES! It is ON. THE. BOARD!'],
  wrong: ['No... It is not there. The crowd gasps.'],
  stealChance: ['{name}. The door is open. STEAL IT.'],
  stealSuccess: ['A daring steal! {name} seizes the points!'],
  roundWrapClose: ['This could decide the entire game.'],
  finalIntro: ['This... changes... EVERYTHING.'],
  winner: ['History is made! {name} is your champion!'],
  loser: ['A valiant battle, {name}. Legends return.'],
}

const SARCASTIC: Script = {
  home: ['Oh good, a human. Shall we play a game?'],
  lobby: ['{p1} and {p2}. Well, this should be... something.'],
  intro: ['Welcome, {p1}. And {p2}, I suppose. {rounds} rounds. Try to keep up.'],
  faceoff: ['Take your time. Actually, please do not.'],
  correct: ['Well, look at that. {answer} is actually on the board.'],
  wrong: ['{answer}? Bold. Wrong, but bold.', "Nope. Did you even read the question?"],
  stealChance: ['{name}, try not to fumble this steal.'],
  stealSuccess: ['A steal. How rude. I love it.'],
  nobody: ['Nobody? Wow. The board is embarrassed for you.'],
  roundWrapClose: ['Close game. Almost like you are both trying.'],
  finalIntro: ['Final round. Please, surprise me.'],
  winner: ['{name} wins. I am... mildly impressed.'],
  loser: ['Tough luck, {name}. It happens. Mostly to you.'],
}

const FRIENDLY: Script = {
  home: ["Hi there! Let's play something fun together."],
  lobby: ["{p1} and {p2}, great to have you both. Let's have fun!"],
  intro: ["Welcome, {p1} and {p2}! {rounds} rounds. Let's have a great game!"],
  correct: ['Brilliant! {answer} is on the board!'],
  wrong: ["Ah, so close! That one's not up there."],
  stealChance: ["{name}, you've got a chance to steal it!"],
  stealSuccess: ['Lovely steal, {name}!'],
  roundWrapClose: ["What a close game. You're both doing great!"],
  finalIntro: ['Last round, big points. You can do this!'],
  winner: ['Congratulations, {name}! What a game!'],
  loser: ['Great game, {name}! You were so close.'],
}

const SCRIPTS: Record<Personality, Script> = {
  funny: FUNNY,
  dramatic: DRAMATIC,
  sarcastic: SARCASTIC,
  friendly: FRIENDLY,
}

export const PERSONALITIES: { id: Personality; label: string }[] = [
  { id: 'funny', label: 'Funny' },
  { id: 'dramatic', label: 'Dramatic' },
  { id: 'sarcastic', label: 'Sarcastic' },
  { id: 'friendly', label: 'Friendly' },
]

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven']
export const numberWord = (n: number) => WORDS[n] ?? String(n)

export function hostLine(personality: Personality, event: HostEvent, vars: HostVars, seed: number): string {
  const lines = SCRIPTS[personality][event] ?? FUNNY[event]
  const template = lines[Math.abs(seed) % lines.length]
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

/** Voice pacing per personality for the Web Speech API. */
export const VOICE_TUNING: Record<Personality, { rate: number; pitch: number }> = {
  funny: { rate: 1.08, pitch: 1.12 },
  dramatic: { rate: 0.92, pitch: 0.85 },
  sarcastic: { rate: 1.0, pitch: 0.95 },
  friendly: { rate: 1.02, pitch: 1.15 },
}
