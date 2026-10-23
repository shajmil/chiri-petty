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
  name: "Chiri Petty",
  malayalam: "ചിരി പെട്ടി",
  tagline: "ഒന്ന് അനുകരിക്കൂ. പിന്നെ ചിരിക്കൂ.",
};

export const AVATAR_COLORS = [
  "#c6f24e",
  "#eea68c",
  "#b7d5e4",
  "#e8c36f",
  "#ddc1b0",
  "#c3cec5",
];

export interface CharacterLook {
  skin: string;
  hair: string;
  hairStyle: "classic" | "spiky" | "long" | "bun" | "curly" | "band";
  outfit: "placket" | "patch" | "collar" | "stripes" | "straps" | "border";
  pants: string;
  shoes: string;
  glasses: boolean;
  moustache: boolean;
}

/** One look per avatar choice; the shirt colour comes from AVATAR_COLORS. */
export const CHARACTER_LOOKS: CharacterLook[] = [
  { skin: "#e9a56d", hair: "#241e29", hairStyle: "classic", outfit: "placket", pants: "#241e29", shoes: "#ffedc0", glasses: false, moustache: false },
  { skin: "#c98a5a", hair: "#c9541e", hairStyle: "spiky", outfit: "patch", pants: "#2f4d7a", shoes: "#f6ba55", glasses: false, moustache: false },
  { skin: "#8d5a3b", hair: "#1b1418", hairStyle: "long", outfit: "collar", pants: "#5b3b6e", shoes: "#ffedc0", glasses: true, moustache: false },
  { skin: "#f1c08f", hair: "#5a3420", hairStyle: "bun", outfit: "stripes", pants: "#2e6b5c", shoes: "#e7787f", glasses: false, moustache: false },
  { skin: "#a86b43", hair: "#2a1d17", hairStyle: "curly", outfit: "straps", pants: "#3a3a3a", shoes: "#ffffff", glasses: false, moustache: false },
  { skin: "#d79a6a", hair: "#241e29", hairStyle: "band", outfit: "border", pants: "#f3ead2", shoes: "#7a4b2a", glasses: false, moustache: true },
];

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
