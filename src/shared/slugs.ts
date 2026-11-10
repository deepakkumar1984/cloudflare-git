import { RESERVED_SLUGS } from "./constants";

export function slugify(input: string, maxLength = 50): string {
  return input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

export function isReservedSlug(value: string): boolean {
  return RESERVED_SLUGS.has(value);
}
