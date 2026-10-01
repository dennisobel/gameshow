// UI fixture data — hardcoded boards for the prototype (PRD §35).

export interface Answer {
  text: string
  points: number
  /** Other ways a player might type this answer. */
  aliases: string[]
}

export interface Question {
  id: string
  prompt: string
  answers: Answer[]
  /** Plausible answers that are NOT on the board — used by the simulated opponent. */
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
export const CATEGORY = 'General Knowledge'

export const ROUNDS: RoundDef[] = [
  {
    kind: 'normal',
    multiplier: 1,
    seconds: 15,
    question: {
      id: 'leave-house',
      prompt: 'Name something people forget when leaving the house.',
      answers: [
        { text: 'Keys', points: 10, aliases: ['key', 'car keys', 'house keys', 'funguo'] },
        { text: 'Phone', points: 8, aliases: ['cell', 'cellphone', 'mobile', 'smartphone', 'iphone', 'simu'] },
        { text: 'Wallet', points: 6, aliases: ['purse', 'money', 'cash', 'handbag', 'bag'] },
        { text: 'ID', points: 4, aliases: ['id card', 'identification', 'license', 'licence', 'passport', 'kitambulisho'] },
        { text: 'Lights', points: 2, aliases: ['light', 'lights on', 'switch', 'turn off lights'] },
      ],
      decoys: ['Umbrella', 'Shoes', 'Glasses', 'Lunch', 'Jacket'],
    },
  },
  {
    kind: 'normal',
    multiplier: 1,
    seconds: 15,
    question: {
      id: 'fridge',
      prompt: 'Name something you might find in a refrigerator.',
      answers: [
        { text: 'Milk', points: 10, aliases: ['maziwa', 'mala'] },
        { text: 'Eggs', points: 8, aliases: ['egg', 'mayai'] },
        { text: 'Cheese', points: 6, aliases: ['cheddar'] },
        { text: 'Vegetables', points: 4, aliases: ['veggies', 'veg', 'sukuma', 'sukuma wiki', 'greens', 'lettuce', 'carrots', 'tomatoes'] },
        { text: 'Juice', points: 2, aliases: ['orange juice', 'juices'] },
      ],
      decoys: ['Bread', 'Ice', 'Cake', 'Leftovers', 'Butter'],
    },
  },
  {
    kind: 'double',
    multiplier: 2,
    seconds: 15,
    question: {
      id: 'cant-sleep',
      prompt: "Name something people do when they can't sleep.",
      answers: [
        { text: 'Scroll their phone', points: 10, aliases: ['phone', 'scroll', 'social media', 'tiktok', 'instagram', 'check phone', 'use phone', 'scrolling'] },
        { text: 'Count sheep', points: 8, aliases: ['count', 'counting sheep', 'sheep'] },
        { text: 'Read', points: 6, aliases: ['read a book', 'book', 'reading'] },
        { text: 'Watch TV', points: 4, aliases: ['tv', 'television', 'netflix', 'movie', 'watch a movie', 'series'] },
        { text: 'Drink water', points: 2, aliases: ['water', 'warm milk', 'tea', 'drink'] },
      ],
      decoys: ['Exercise', 'Cook', 'Clean', 'Meditate', 'Shower'],
    },
  },
  {
    kind: 'normal',
    multiplier: 1,
    seconds: 15,
    question: {
      id: 'late-work',
      prompt: 'Name a reason you might be late for work.',
      answers: [
        { text: 'Traffic', points: 10, aliases: ['jam', 'traffic jam', 'matatu', 'stuck in traffic'] },
        { text: 'Overslept', points: 8, aliases: ['oversleep', 'slept in', 'alarm', 'woke up late', 'sleep', 'slept late'] },
        { text: 'Rain', points: 6, aliases: ['weather', 'bad weather', 'storm', 'raining'] },
        { text: 'Kids', points: 4, aliases: ['children', 'school run', 'baby', 'family'] },
        { text: 'Car trouble', points: 2, aliases: ['car', 'flat tyre', 'flat tire', 'breakdown', 'puncture'] },
      ],
      decoys: ['Breakfast', 'Meeting', 'Gym', 'Hangover', 'Queue'],
    },
  },
  {
    kind: 'final',
    multiplier: 3,
    seconds: 15,
    question: {
      id: 'house-fire',
      prompt: "Name something you'd grab if your house was on fire.",
      answers: [
        { text: 'Phone', points: 10, aliases: ['cell', 'cellphone', 'mobile', 'smartphone', 'simu'] },
        { text: 'Pets', points: 8, aliases: ['pet', 'dog', 'cat', 'dogs', 'cats'] },
        { text: 'Photos', points: 6, aliases: ['photo', 'pictures', 'photo album', 'family photos', 'album'] },
        { text: 'Documents', points: 4, aliases: ['papers', 'passport', 'certificates', 'title deed', 'birth certificate', 'id'] },
        { text: 'Laptop', points: 2, aliases: ['computer', 'pc', 'macbook'] },
      ],
      decoys: ['Shoes', 'TV', 'Clothes', 'Jewelry', 'Blanket'],
    },
  },
]

/** Tie-breakers. One question. One answer. Winner takes all. */
export const SUDDEN_DEATH: RoundDef[] = [
  {
    kind: 'sudden',
    multiplier: 1,
    seconds: 12,
    question: {
      id: 'yellow-fruit',
      prompt: 'Name a fruit that is yellow.',
      answers: [
        { text: 'Banana', points: 10, aliases: ['bananas', 'ndizi'] },
        { text: 'Lemon', points: 8, aliases: ['lemons'] },
        { text: 'Pineapple', points: 6, aliases: ['nanasi'] },
        { text: 'Mango', points: 4, aliases: ['mangoes', 'embe'] },
        { text: 'Pawpaw', points: 2, aliases: ['papaya', 'paw paw'] },
      ],
      decoys: ['Orange', 'Apple', 'Grapes', 'Pear'],
    },
  },
  {
    kind: 'sudden',
    multiplier: 1,
    seconds: 12,
    question: {
      id: 'burger',
      prompt: 'Name something you put on a burger.',
      answers: [
        { text: 'Cheese', points: 10, aliases: ['cheddar'] },
        { text: 'Ketchup', points: 8, aliases: ['tomato sauce', 'sauce'] },
        { text: 'Lettuce', points: 6, aliases: ['salad'] },
        { text: 'Onions', points: 4, aliases: ['onion'] },
        { text: 'Tomato', points: 2, aliases: ['tomatoes'] },
      ],
      decoys: ['Mustard', 'Egg', 'Avocado', 'Mayo'],
    },
  },
]
