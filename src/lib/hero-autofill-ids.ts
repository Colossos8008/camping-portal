export type ParseIdsResult = {
  ids?: number[];
  error?: string;
};

export function parseExplicitIds(rawIds: string | null): ParseIdsResult {
  if (!rawIds || !rawIds.trim()) return {};

  const seen = new Set<number>();
  const parsedIds: number[] = [];

  for (const token of rawIds.split(",")) {
    const trimmed = token.trim();
    if (!trimmed) continue;

    const value = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(value) || value <= 0) {
      return { error: `Invalid ids parameter value '${trimmed}'. Expected comma-separated positive integers.` };
    }

    if (!seen.has(value)) {
      seen.add(value);
      parsedIds.push(value);
    }
  }

  if (parsedIds.length === 0) {
    return { error: "ids parameter was provided but no valid IDs were parsed." };
  }

  return { ids: parsedIds };
}
