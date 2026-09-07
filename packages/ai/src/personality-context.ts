/**
 * Contextual tone + personality preference resolution (Aurum original).
 * Mode names are internal only — never expose to the user.
 */

export const PERSONALITY_CANONICAL_KEYS = {
  style: "preference:personality_style",
  humor: "preference:humor_level",
  sarcasm: "preference:sarcasm_level",
  formality: "preference:formality",
} as const;

export type PersonalityStyle = "refined";
export type HumorLevel = "none" | "subtle" | "more";
export type SarcasmLevel = "none" | "subtle" | "more";
export type FormalityLevel = "polished" | "casual" | "serious";

export type PersonalityPreferences = {
  style: PersonalityStyle;
  humor: HumorLevel;
  sarcasm: SarcasmLevel;
  formality: FormalityLevel;
};

export const DEFAULT_PERSONALITY_PREFERENCES: PersonalityPreferences = {
  style: "refined",
  humor: "subtle",
  sarcasm: "subtle",
  formality: "polished",
};

/** Internal tone — never shown to users. */
export type ConversationTone =
  | "normal"
  | "focused"
  | "relaxed"
  | "success"
  | "frustrating"
  | "serious";

export type TemporaryToneOverride = {
  humor: HumorLevel | null;
  sarcasm: SarcasmLevel | null;
  formality: FormalityLevel | null;
  /** True when user asked for a temporary shift ("for now") */
  temporary: boolean;
  /** True when user asked for a permanent preference change */
  permanent: boolean;
};

export type PersonalityMemoryLike = {
  canonical_key?: string | null;
  content?: string | null;
};

export function parsePersonalityPreferences(
  memories: PersonalityMemoryLike[],
): PersonalityPreferences {
  const prefs = { ...DEFAULT_PERSONALITY_PREFERENCES };
  for (const m of memories) {
    const key = (m.canonical_key ?? "").toLowerCase();
    const content = (m.content ?? "").toLowerCase();
    if (key === PERSONALITY_CANONICAL_KEYS.style) {
      prefs.style = "refined";
    }
    if (key === PERSONALITY_CANONICAL_KEYS.humor) {
      prefs.humor = parseHumor(content) ?? prefs.humor;
    }
    if (key === PERSONALITY_CANONICAL_KEYS.sarcasm) {
      prefs.sarcasm = parseSarcasm(content) ?? prefs.sarcasm;
    }
    if (key === PERSONALITY_CANONICAL_KEYS.formality) {
      prefs.formality = parseFormality(content) ?? prefs.formality;
    }
  }
  return prefs;
}

function parseHumor(content: string): HumorLevel | null {
  if (/\b(none|no humor|serious|zero)\b/.test(content)) return "none";
  if (/\b(more|higher|wittier|funnier)\b/.test(content)) return "more";
  if (/\b(subtle|light|low|less)\b/.test(content)) return "subtle";
  return null;
}

function parseSarcasm(content: string): SarcasmLevel | null {
  if (/\b(none|no sarcasm|off)\b/.test(content)) return "none";
  if (/\b(more|higher|drier)\b/.test(content)) return "more";
  if (/\b(subtle|light|low|less|tone down)\b/.test(content)) return "subtle";
  return null;
}

function parseFormality(content: string): FormalityLevel | null {
  if (/\b(casual|informal|relaxed)\b/.test(content)) return "casual";
  if (/\b(serious|strict|no.?nonsense)\b/.test(content)) return "serious";
  if (/\b(polished|formal|professional)\b/.test(content)) return "polished";
  return null;
}

/**
 * Detect temporary vs permanent tone requests in the user message.
 * Temporary must NOT auto-write permanent memory.
 */
export function detectTemporaryToneOverride(
  userMessage: string,
): TemporaryToneOverride | null {
  const text = userMessage.trim();
  if (!text) return null;

  const temporary =
    /\b(for now|this (time|conversation|chat)|temporarily|just for)\b/i.test(
      text,
    );
  const permanent =
    /\b(from now on|always|going forward|by default|prefer)\b/i.test(text) &&
    !temporary;

  let humor: HumorLevel | null = null;
  let sarcasm: SarcasmLevel | null = null;
  let formality: FormalityLevel | null = null;

  if (/\b(be serious|no humor|no jokes|tone it down|tone down the humor)\b/i.test(text)) {
    humor = "none";
    sarcasm = "none";
    if (/\bbe serious\b/i.test(text)) formality = "serious";
  }
  if (/\b(more sarcastic|a little more sarcastic|drier)\b/i.test(text)) {
    sarcasm = "more";
  }
  if (/\b(less sarcastic|tone down the sarcasm)\b/i.test(text)) {
    sarcasm = temporary || permanent ? "subtle" : "none";
  }
  if (/\b(more (humor|wit|personality)|be funnier)\b/i.test(text)) {
    humor = "more";
  }
  if (/\b(more casual|be casual|loosen up)\b/i.test(text)) {
    formality = "casual";
  }
  if (/\b(more formal|be more polished|more professional)\b/i.test(text)) {
    formality = "polished";
  }

  if (humor == null && sarcasm == null && formality == null) return null;
  return { humor, sarcasm, formality, temporary, permanent };
}

/** Infer situational tone from the user message (internal). */
export function inferConversationTone(userMessage: string): ConversationTone {
  const t = userMessage.toLowerCase();

  if (
    /\b(suicid|self[- ]harm|abuse|assault|emergency|911|hospital|diagnos|cancer|overdose|weapon|shoot|kill myself)\b/.test(
      t,
    ) ||
    /\b(password|breach|hacked|ransomware|security incident|leak(ed)? (data|credentials))\b/.test(
      t,
    ) ||
    /\b(wire transfer|life savings|bankruptcy|evict|foreclos)\b/.test(t) ||
    /\b(delete (all|everything)|format (the )?disk|rm -rf|destroy (the )?(server|database))\b/.test(
      t,
    ) ||
    /\b(shutdown|restart|factory reset).{0,40}\b(now|force|immediately)\b/.test(t)
  ) {
    return "serious";
  }

  if (
    /\b(still (broken|failing|not working)|again|keeps? (failing|crashing)|won't cooperate|refusing)\b/.test(
      t,
    )
  ) {
    return "frustrating";
  }

  if (
    /\b(deploy|migration|stack trace|typeerror|typescript|sql|api|latency|profiler|refactor|pull request|ci\/cd|research|pricing model|contract|invoice|client proposal)\b/.test(
      t,
    )
  ) {
    return "focused";
  }

  if (
    /\b(lol|haha|what's up|how are you|bored|random|just chatting|tell me something)\b/.test(
      t,
    )
  ) {
    return "relaxed";
  }

  if (/\b(it worked|finally|fixed|success|healthy|shipped|resolved)\b/.test(t)) {
    return "success";
  }

  return "normal";
}

export function applyTemporaryOverride(
  base: PersonalityPreferences,
  override: TemporaryToneOverride | null,
): PersonalityPreferences {
  if (!override) return base;
  return {
    style: base.style,
    humor: override.humor ?? base.humor,
    sarcasm: override.sarcasm ?? base.sarcasm,
    formality: override.formality ?? base.formality,
  };
}

export function buildPersonalityGuidance(opts: {
  preferences: PersonalityPreferences;
  tone: ConversationTone;
  temporaryOverride?: TemporaryToneOverride | null;
}): string {
  const prefs = applyTemporaryOverride(
    opts.preferences,
    opts.temporaryOverride ?? null,
  );
  const tone = opts.tone;

  const lines: string[] = [
    "Personality expression for this turn (internal guidance — never name these modes to the user):",
    `- Baseline: refined Aurum — composed, intelligent, observant, articulate, efficient, subtly confident, slightly formal, understated. Competent first; wit second.`,
    `- Humor level: ${prefs.humor}. Sarcasm level: ${prefs.sarcasm}. Formality: ${prefs.formality}.`,
  ];

  if (tone === "serious" || prefs.humor === "none" || prefs.formality === "serious") {
    lines.push(
      "- This turn requires seriousness: NO sarcasm, NO irony, NO dry wit. Be clear, calm, and helpful. Do not soft-pedal real risk.",
    );
  } else if (tone === "focused") {
    lines.push(
      "- Technical/business focus: mostly serious. Minimal wit. Prioritize precision and brevity.",
    );
  } else if (tone === "relaxed") {
    lines.push(
      "- Casual conversation: a little more personality and dry observation is fine — still understated, never meme-y.",
    );
  } else if (tone === "frustrating" && prefs.sarcasm !== "none") {
    lines.push(
      "- Harmless repeated friction: a touch of restrained dry irony is appropriate after the diagnostic point is clear. First failure stays mostly diagnostic.",
    );
  } else if (tone === "success") {
    lines.push(
      "- Success: understated satisfaction (“There we are. Much better.” / “Yes. Production is healthy.”) — never exaggerated celebration.",
    );
  } else {
    lines.push(
      "- Normal: polished, concise, calm. Occasional restrained wit only when it lands naturally.",
    );
  }

  if (opts.temporaryOverride?.temporary) {
    lines.push(
      "- The user requested a temporary tone shift for this conversation context. Honor it for this turn without treating it as a permanent preference change unless they clearly said “from now on / always”.",
    );
  }

  lines.push(
    "- You may politely disagree: “I wouldn't do that. There's a cleaner option.”",
    "- Routine confirmations stay extremely short: “Done.” “Certainly.” “That's handled.”",
    "- Do not force humor. Do not tell jokes. Do not roast the user. No emojis by default. No slang-heavy voice. No theatrical AI / superhero roleplay.",
    "- Never imitate JARVIS, Iron Man, Paul Bettany, or any copyrighted character voice or catchphrases. You are Aurum.",
  );

  return lines.join("\n");
}
