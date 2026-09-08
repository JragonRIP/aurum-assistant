/**
 * Shared spoken-text helpers (markup strip + clock/date phrasing).
 * Used by prepareSpokenText — keep this module free of pipeline imports.
 */

export function stripSpeechMarkup(text: string): string {
  let t = text.replace(/\r\n/g, "\n").trim();
  if (!t) return "";

  t = t
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\((https?:\/\/[^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  t = t
    .replace(/\s*[/|]\s*/g, " ")
    .replace(/&/g, " and ")
    .replace(/@/g, " at ")
    .replace(/°/g, " degrees ")
    .replace(/\s{2,}/g, " ")
    .trim();

  return t;
}

/** "3:30 PM" → "three-thirty"; "4:00" → "four o'clock" (12h when am/pm present). */
export function speakClockTimes(text: string): string {
  return text.replace(
    /\b([01]?\d|2[0-3]):([0-5]\d)\s*(a\.?m\.?|p\.?m\.?)?\b/gi,
    (_full, hRaw: string, mRaw: string, meridiem?: string) => {
      let hour = Number(hRaw);
      const minute = Number(mRaw);
      const mer = meridiem?.replace(/\./g, "").toLowerCase() ?? null;
      if (mer === "pm" && hour < 12) hour += 12;
      if (mer === "am" && hour === 12) hour = 0;
      const displayHour = ((hour + 11) % 12) + 1;
      const hourWord = NUMBER_WORDS[displayHour] ?? String(displayHour);
      if (minute === 0) {
        return `${hourWord} o'clock`;
      }
      if (minute < 10) {
        return `${hourWord} oh ${NUMBER_WORDS[minute] ?? minute}`;
      }
      const minuteWord =
        NUMBER_WORDS[minute] ??
        `${NUMBER_WORDS[Math.floor(minute / 10) * 10]}-${NUMBER_WORDS[minute % 10]}`;
      return `${hourWord}-${minuteWord}`;
    },
  );
}

/** Light-touch date phrasing for common numeric dates. */
export function speakSimpleDates(text: string): string {
  return text.replace(
    /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g,
    (_full, m: string, d: string, y?: string) => {
      const month = MONTH_NAMES[Number(m)] ?? m;
      const day = Number(d);
      const dayWord = NUMBER_WORDS[day] ?? String(day);
      if (y) {
        return `${month} ${dayWord}, ${y}`;
      }
      return `${month} ${dayWord}`;
    },
  );
}

const NUMBER_WORDS: Record<number, string> = {
  0: "zero",
  1: "one",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  8: "eight",
  9: "nine",
  10: "ten",
  11: "eleven",
  12: "twelve",
  13: "thirteen",
  14: "fourteen",
  15: "fifteen",
  16: "sixteen",
  17: "seventeen",
  18: "eighteen",
  19: "nineteen",
  20: "twenty",
  21: "twenty-one",
  22: "twenty-two",
  23: "twenty-three",
  24: "twenty-four",
  25: "twenty-five",
  26: "twenty-six",
  27: "twenty-seven",
  28: "twenty-eight",
  29: "twenty-nine",
  30: "thirty",
  31: "thirty-one",
  40: "forty",
  50: "fifty",
};

const MONTH_NAMES: Record<number, string> = {
  1: "January",
  2: "February",
  3: "March",
  4: "April",
  5: "May",
  6: "June",
  7: "July",
  8: "August",
  9: "September",
  10: "October",
  11: "November",
  12: "December",
};
