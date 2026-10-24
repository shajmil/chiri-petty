import type { Category, Difficulty, Prompt, World } from "./types";
import libraryJson from "./library.json";
import mimicryJson from "./mimicry.json";

/** One entry written by scripts/import-library.mjs. */
export interface LibraryClip {
  id: string;
  world: World;
  title: string;
  phrase: string;
  difficulty: Difficulty;
  duration: number;
  source: string;
  sourceUrl: string;
  license: string;
  sourceSha256: string | null;
  fileSha256: string;
}

export interface MimicryLine {
  id: string;
  title: string;
  malayalam: string;
  meaning: string;
  delivery: string;
  duration: number | null;
}

const libraryClips = libraryJson as LibraryClip[];
const mimicryLines: MimicryLine[] = mimicryJson;

export const BRAND = {
  name: "Chiri Party",
  malayalam: "ചിരി പാർട്ടി",
  tagline: "ഒന്ന് അനുകരിക്കൂ. പിന്നെ ചിരിക്കൂ.",
};

export interface CharacterLook {
  /** Shirt, blouse or dress colour, also the background of the face in menus. */
  shirt: string;
  skin: string;
  /** Hair colour; for a headscarf, the scarf's colour. */
  hair: string;
  hairStyle:
    | "classic"
    | "spiky"
    | "long"
    | "bun"
    | "curly"
    | "band"
    | "ponytail"
    | "braid"
    | "pigtails"
    | "bob"
    | "mohawk"
    | "bald"
    | "cap"
    | "scarf";
  outfit:
    | "placket"
    | "patch"
    | "collar"
    | "stripes"
    | "straps"
    | "border"
    | "saree"
    | "kurta"
    | "dress"
    | "jacket"
    | "tie";
  /** Trousers, mundu, leggings or saree colour; a jacket matches it. */
  pants: string;
  shoes: string;
  glasses?: boolean;
  moustache?: boolean;
  beard?: boolean;
  earrings?: boolean;
  bindi?: boolean;
  /** A string of jasmine flowers in the hair. */
  flower?: boolean;
}

/** Every player gets one of these characters; the index is the player's avatar number. */
export const CHARACTER_LOOKS: CharacterLook[] = [
  { shirt: "#c6f24e", skin: "#e9a56d", hair: "#241e29", hairStyle: "classic", outfit: "placket", pants: "#241e29", shoes: "#ffedc0" },
  { shirt: "#eea68c", skin: "#c98a5a", hair: "#c9541e", hairStyle: "spiky", outfit: "patch", pants: "#2f4d7a", shoes: "#f6ba55" },
  { shirt: "#b7d5e4", skin: "#8d5a3b", hair: "#1b1418", hairStyle: "long", outfit: "collar", pants: "#5b3b6e", shoes: "#ffedc0", glasses: true, earrings: true },
  { shirt: "#e8c36f", skin: "#f1c08f", hair: "#5a3420", hairStyle: "bun", outfit: "stripes", pants: "#2e6b5c", shoes: "#e7787f", flower: true },
  { shirt: "#ddc1b0", skin: "#a86b43", hair: "#2a1d17", hairStyle: "curly", outfit: "straps", pants: "#3a3a3a", shoes: "#ffffff" },
  { shirt: "#c3cec5", skin: "#d79a6a", hair: "#241e29", hairStyle: "band", outfit: "border", pants: "#f3ead2", shoes: "#7a4b2a", moustache: true },
  { shirt: "#d94f70", skin: "#c98a5a", hair: "#1b1418", hairStyle: "long", outfit: "saree", pants: "#f4d35e", shoes: "#c9a227", bindi: true, earrings: true },
  { shirt: "#f28cb1", skin: "#e9a56d", hair: "#2a1d17", hairStyle: "ponytail", outfit: "jacket", pants: "#3b5b8c", shoes: "#ffffff", earrings: true },
  { shirt: "#f5e6c8", skin: "#a86b43", hair: "#2a1d17", hairStyle: "bald", outfit: "kurta", pants: "#f3ead2", shoes: "#5a3a22", glasses: true, moustache: true },
  { shirt: "#6cc4a1", skin: "#8d5a3b", hair: "#1b1418", hairStyle: "braid", outfit: "kurta", pants: "#f6f1e1", shoes: "#d4a24c", flower: true, bindi: true, earrings: true },
  { shirt: "#4a90d9", skin: "#c98a5a", hair: "#241e29", hairStyle: "cap", outfit: "jacket", pants: "#2b2b2b", shoes: "#e8e8e8" },
  { shirt: "#f7a072", skin: "#f1c08f", hair: "#7a3b1e", hairStyle: "pigtails", outfit: "dress", pants: "#f6e7d7", shoes: "#e7787f" },
  { shirt: "#8e7cc3", skin: "#d79a6a", hair: "#4caf50", hairStyle: "mohawk", outfit: "stripes", pants: "#1f1f1f", shoes: "#c6f24e" },
  { shirt: "#5ec2b7", skin: "#a86b43", hair: "#1b1418", hairStyle: "bob", outfit: "dress", pants: "#2d2d2d", shoes: "#2d2d2d", glasses: true },
  { shirt: "#f2efe6", skin: "#8d5a3b", hair: "#b9b4ad", hairStyle: "classic", outfit: "border", pants: "#f3ead2", shoes: "#6b4a2f", glasses: true, beard: true },
  { shirt: "#9b5de5", skin: "#e9a56d", hair: "#2a9d8f", hairStyle: "scarf", outfit: "kurta", pants: "#f1e3d3", shoes: "#3b2a20" },
  { shirt: "#f4a259", skin: "#6e4428", hair: "#2a1d17", hairStyle: "curly", outfit: "jacket", pants: "#354f52", shoes: "#f2f2f2", beard: true },
  { shirt: "#e8eef7", skin: "#f1c08f", hair: "#3b2a20", hairStyle: "classic", outfit: "tie", pants: "#2f3e5c", shoes: "#3a2a1e", glasses: true },
  { shirt: "#ffd166", skin: "#c98a5a", hair: "#7b2cbf", hairStyle: "bob", outfit: "jacket", pants: "#264653", shoes: "#ffffff" },
  { shirt: "#2e7d32", skin: "#a86b43", hair: "#1b1418", hairStyle: "bun", outfit: "saree", pants: "#f6f1e1", shoes: "#d4a24c", flower: true, bindi: true, earrings: true },
];

/** A random character, never the one given, so a shuffle always changes something. */
export function randomLookIndex(except = -1): number {
  const choices = CHARACTER_LOOKS.map((_, index) => index).filter((index) => index !== except);
  return choices[randomInt(choices.length)];
}

/** Every character in a random order, for picking a crowd. */
export function shuffledLookIndexes(): number[] {
  return shuffle(CHARACTER_LOOKS.map((_, index) => index));
}

/** Funny Malayalam movie characters, offered as a name to start with. */
export const FUNNY_NAMES = [
  "Damu",
  "Dikru",
  "Manavalan",
  "Ramanan",
  "Pavanayi",
  "Gafoor",
  "Dasan",
  "Vijayan",
  "Dinesan",
  "Mannar Mathai",
  "Kittunni",
  "Appukuttan",
  "Shaji Pappan",
  "Arakkal Abu",
  "Sarbath Shameer",
  "Ramji Rao",
  "Kunjappan",
  "Kumbidi",
  "Pattalam Purushu",
  "Kuttan Pillai",
];

export function randomFunnyName(except = ""): string {
  const choices = FUNNY_NAMES.filter((name) => name !== except);
  return choices[randomInt(choices.length)];
}

export const PACKS: {
  id: Category;
  name: string;
  malayalam: string;
  description: string;
  symbol: string;
}[] = [
  {
    id: "malayalam-movies",
    name: "Malayalam Movie Memes",
    malayalam: "മലയാളം സിനിമ മീമുകൾ",
    description: "Famous film dialogues, laughs and reactions.",
    symbol: "🎬",
  },
  {
    id: "meme-classics",
    name: "Meme Classics",
    malayalam: "മീം ക്ലാസിക്കുകൾ",
    description: "Booms, bruhs, bonks and airhorns.",
    symbol: "💥",
  },
  {
    id: "viral-reactions",
    name: "Viral Reactions",
    malayalam: "വൈറൽ റിയാക്ഷൻസ്",
    description: "Shouts, stings and dramatic fails.",
    symbol: "😱",
  },
  {
    id: "cartoon-chaos",
    name: "Cartoon Chaos",
    malayalam: "കാർട്ടൂൺ ബഹളം",
    description: "Screams, splats and cartoon physics.",
    symbol: "🌀",
  },
  {
    id: "music",
    name: "Music",
    malayalam: "സംഗീതം",
    description: "Hooks, fanfares and dramatic stings.",
    symbol: "🎵",
  },
  {
    id: "daily-drama",
    name: "Daily Drama",
    malayalam: "ഡെയ്‌ലി ഡ്രാമ",
    description: "Snacks, kitchens and household plot twists.",
    symbol: "🍝",
  },
  {
    id: "wild-calls",
    name: "Wild Calls",
    malayalam: "കാട്ടിലെ വിളികൾ",
    description: "Birds, sheep and creatures with opinions.",
    symbol: "🐦",
  },
  {
    id: "machine-room",
    name: "Machine Room",
    malayalam: "യന്ത്രങ്ങളുടെ ലോകം",
    description: "Pings, startups, beeps and robots.",
    symbol: "🤖",
  },
  {
    id: "mimicry",
    name: "Mimicry",
    malayalam: "മിമിക്രി",
    description: "Original Malayalam meme-style lines.",
    symbol: "മ",
  },
  {
    id: "mixed",
    name: "Full chaos",
    malayalam: "എല്ലാം കൂടി",
    description: "A little bit of every world.",
    symbol: "↗",
  },
  {
    id: "custom",
    name: "Your clips",
    malayalam: "നിങ്ങളുടെ ക്ലിപ്പുകൾ",
    description: "The host adds clips. Private to the room, deleted with it.",
    symbol: "+",
  },
];

export const PROMPTS: Prompt[] = libraryClips.filter(clip => clip.world !== "music").map((clip) => ({
  id: clip.id,
  category: clip.world,
  title: clip.title,
  cue: clip.phrase,
  difficulty: clip.difficulty,
  instruction:
    "Listen once, then copy its rhythm, pitch changes and texture in one take.",
  reference: `/audio/library/${clip.id}.wav`,
  duration: clip.duration,
  license: `${clip.source} · ${clip.license} · ${clip.sourceUrl}`,
  referenceKind: "recorded",
}));

// Script lines become playable only after scripts/import-mimicry.mjs records their duration.
export const MIMICRY_LINES = mimicryLines;

for (const line of mimicryLines) {
  if (line.duration === null) continue;
  PROMPTS.push({
    id: line.id,
    category: "mimicry",
    title: line.title,
    cue: line.malayalam,
    difficulty: null,
    instruction: `“${line.meaning}” · ${line.delivery}`,
    reference: `/audio/mimicry/${line.id}.wav`,
    duration: line.duration,
    license: `Original ${BRAND.name} performance, recorded for this game.`,
    referenceKind: "recorded",
  });
}

// Worlds without any sounds yet (such as an unrecorded Mimicry pack) are hidden from players.
export const PLAYABLE_PACKS = PACKS.filter(
  (pack) =>
    pack.id !== "music" && (pack.id === "mixed" ||
    pack.id === "custom" ||
    PROMPTS.some((prompt) => prompt.category === pack.id)),
);

export function findPrompt(id: string, customClips: Prompt[] = []): Prompt {
  return (
    PROMPTS.find((prompt) => prompt.id === id) ??
    customClips.find((clip) => clip.id === id) ??
    PROMPTS[0]
  );
}

function randomInt(limit: number): number {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return random[0] % limit;
}

function shuffle<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const nextIndex = randomInt(index + 1);
    [shuffled[index], shuffled[nextIndex]] = [shuffled[nextIndex], shuffled[index]];
  }
  return shuffled;
}

/** Sounds from the previous match go last, so a rematch starts with fresh ones. */
function freshFirst(ids: string[], previousDeck: string[]): string[] {
  const recent = new Set(previousDeck);
  return [
    ...shuffle(ids.filter((id) => !recent.has(id))),
    ...shuffle(ids.filter((id) => recent.has(id))),
  ];
}

/** Takes `count` ids in order, starting over only after every id has been used once. */
function takeWithoutRepeats(ids: string[], count: number): string[] {
  if (!ids.length) return [];
  return Array.from({ length: count }, (_, index) => ids[index % ids.length]);
}

/** Moves a sound away from an identical neighbour, which can only happen once a pool runs out. */
function separateNeighbours(deck: string[]): string[] {
  const result = [...deck];
  for (let index = 1; index < result.length; index++) {
    if (result[index] !== result[index - 1]) continue;
    const swapWith = result.findIndex(
      (id, other) =>
        id !== result[index] &&
        result[other - 1] !== result[index] &&
        result[other + 1] !== result[index],
    );
    if (swapWith >= 0)
      [result[index], result[swapWith]] = [result[swapWith], result[index]];
  }
  return result;
}

export function createDeck(
  category: Category,
  count: number,
  customClips: Prompt[] = [],
  previousDeck: string[] = [],
): string[] {
  if (category === "custom")
    return separateNeighbours(
      takeWithoutRepeats(freshFirst(customClips.map((clip) => clip.id), previousDeck), count),
    );
  if (category !== "mixed") {
    const worldIds = PROMPTS.filter((prompt) => prompt.category === category).map((prompt) => prompt.id);
    return separateNeighbours(takeWithoutRepeats(freshFirst(worldIds, previousDeck), count));
  }
  // Full chaos: Malayalam movie clips fill about half the rounds (3 or 4 of 7).
  // No other sound appears twice; Malayalam clips repeat only after all of them have been used.
  const malayalamIds = PROMPTS.filter((prompt) => prompt.category === "malayalam-movies").map((prompt) => prompt.id);
  const otherIds = PROMPTS.filter((prompt) => prompt.category !== "malayalam-movies").map((prompt) => prompt.id);
  const malayalamRounds = malayalamIds.length
    ? Math.min(count, Math.floor(count / 2) + (count % 2 === 1 ? randomInt(2) : 0))
    : 0;
  const deck = [
    ...takeWithoutRepeats(freshFirst(malayalamIds, previousDeck), malayalamRounds),
    ...takeWithoutRepeats(freshFirst(otherIds, previousDeck), count - malayalamRounds),
  ];
  return separateNeighbours(shuffle(deck));
}
