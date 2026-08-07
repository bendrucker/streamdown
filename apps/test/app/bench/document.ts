export type DocumentShape = "prose" | "mixed" | "code" | "table" | "list";

// Deterministic so a run is reproducible across machines and commits.
const MODULUS = 0x1_00_00_00_00;
const createRandom = (seed: number) => {
  let state = seed % MODULUS;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % MODULUS;
    return state / MODULUS;
  };
};

const WORDS = [
  "stream",
  "render",
  "markdown",
  "token",
  "buffer",
  "parser",
  "block",
  "incremental",
  "latency",
  "throughput",
  "commit",
  "reconcile",
  "hydrate",
  "boundary",
  "pipeline",
  "heuristic",
  "identifier",
  "schema",
  "adapter",
  "transport",
];

const TRAILING_PERIOD = /\.$/;

const sentence = (random: () => number, words: number) => {
  const picked: string[] = [];
  for (let i = 0; i < words; i += 1) {
    const word = WORDS[Math.floor(random() * WORDS.length)];
    const roll = random();
    if (roll < 0.08) {
      picked.push(`\`${word}_${word}\``);
    } else if (roll < 0.14) {
      picked.push(`**${word}**`);
    } else if (roll < 0.18) {
      picked.push(`[${word}](https://example.com/${word})`);
    } else {
      picked.push(word);
    }
  }
  const text = picked.join(" ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
};

const paragraph = (random: () => number) => {
  const sentences: string[] = [];
  const count = 3 + Math.floor(random() * 3);
  for (let i = 0; i < count; i += 1) {
    sentences.push(sentence(random, 8 + Math.floor(random() * 12)));
  }
  return sentences.join(" ");
};

const codeBlock = (random: () => number, index: number) => {
  const lines = [`export const handler_${index} = (input) => {`];
  const count = 6 + Math.floor(random() * 10);
  for (let i = 0; i < count; i += 1) {
    lines.push(
      `  const ${WORDS[Math.floor(random() * WORDS.length)]}_${i} = input.${WORDS[Math.floor(random() * WORDS.length)]} ?? ${i};`
    );
  }
  lines.push("  return input;");
  lines.push("};");
  return ["```typescript", ...lines, "```"].join("\n");
};

const table = (random: () => number, index: number) => {
  const rows = [
    `| Field ${index} | Type | Default | Notes |`,
    "| --- | --- | --- | --- |",
  ];
  const count = 4 + Math.floor(random() * 6);
  for (let i = 0; i < count; i += 1) {
    rows.push(
      `| \`${WORDS[Math.floor(random() * WORDS.length)]}\` | string | \`null\` | ${sentence(random, 6)} |`
    );
  }
  return rows.join("\n");
};

const list = (random: () => number) => {
  const items: string[] = [];
  const count = 4 + Math.floor(random() * 5);
  for (let i = 0; i < count; i += 1) {
    items.push(`- ${sentence(random, 10)}`);
  }
  return items.join("\n");
};

const sectionsFor = (
  shape: DocumentShape,
  random: () => number,
  index: number
): string[] => {
  switch (shape) {
    case "prose":
      return [paragraph(random), paragraph(random)];
    case "code":
      return [paragraph(random), codeBlock(random, index)];
    case "table":
      return [paragraph(random), table(random, index)];
    case "list":
      return [paragraph(random), list(random)];
    default: {
      const rotation = index % 4;
      if (rotation === 0) {
        return [paragraph(random), list(random)];
      }
      if (rotation === 1) {
        return [paragraph(random), codeBlock(random, index)];
      }
      if (rotation === 2) {
        return [paragraph(random), table(random, index)];
      }
      return [paragraph(random), paragraph(random)];
    }
  }
};

export const buildDocument = (
  shape: DocumentShape,
  targetChars: number,
  seed = 42
): string => {
  const random = createRandom(seed);
  const parts: string[] = ["# Streaming performance report", ""];
  let length = parts.join("\n\n").length;
  let index = 0;

  while (length < targetChars) {
    const section = [
      `## Section ${index}: ${sentence(random, 5).replace(TRAILING_PERIOD, "")}`,
      ...sectionsFor(shape, random, index),
    ];
    for (const part of section) {
      parts.push(part);
      length += part.length + 2;
    }
    index += 1;
  }

  return parts.join("\n\n");
};
