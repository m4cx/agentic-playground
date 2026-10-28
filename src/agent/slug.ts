import { AgentError } from "./errors.js";

const TRANSLITERATION: Record<string, string> = {
  ß: "ss",
  ä: "ae",
  Ä: "Ae",
  ö: "oe",
  Ö: "Oe",
  ü: "ue",
  Ü: "Ue",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
  ø: "o",
  Ø: "O",
  å: "a",
  Å: "A",
  ł: "l",
  Ł: "L",
  đ: "d",
  Đ: "D",
  ð: "d",
  Ð: "D",
  þ: "th",
  Þ: "TH",
};

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: string, maxLength = 50): boolean {
  return slug.length >= 1 && slug.length <= maxLength && SLUG_PATTERN.test(slug);
}

export function deriveSlug(title: string, maxLength = 50): string {
  if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > 50) {
    throw new AgentError("environment", "slugMaxLength must be an integer in 1..50");
  }

  let value = title
    .split("")
    .map((character) => TRANSLITERATION[character] ?? character)
    .join("");

  value = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (value.length > maxLength) {
    const truncated = value.slice(0, maxLength);
    const lastHyphen = truncated.lastIndexOf("-");
    value = lastHyphen > 0 ? truncated.slice(0, lastHyphen) : truncated;
    value = value.replace(/-+$/g, "");
  }

  if (value.length === 0) {
    value = "issue";
  }

  if (!isValidSlug(value, maxLength)) {
    throw new AgentError("environment", `cannot derive a valid slug from title: ${JSON.stringify(title)}`);
  }

  return value;
}
