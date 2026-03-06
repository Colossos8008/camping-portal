import { parseExplicitIds } from "../src/lib/hero-autofill-ids.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function run(): void {
  const sample = "1270,1284,1290,1287,1278";
  const parsed = parseExplicitIds(sample);

  assert(!parsed.error, `Unexpected parse error: ${parsed.error ?? ""}`);
  assert(parsed.ids?.length === 5, `Expected 5 ids, got ${parsed.ids?.length ?? 0}`);

  const requestedIds = parsed.ids ?? [];
  const fakePlaces = [
    { id: 1269, name: "x" },
    { id: 1270, name: "a" },
    { id: 1278, name: "b" },
    { id: 1284, name: "c" },
    { id: 1287, name: "d" },
    { id: 1290, name: "e" },
    { id: 1300, name: "y" },
  ];

  const filtered = fakePlaces.filter((place) => requestedIds.includes(place.id));

  assert(filtered.length === requestedIds.length, "Filtered places length mismatch for explicit ids mode");
  assert(filtered.every((place) => requestedIds.includes(place.id)), "Found unrelated place in explicit ids mode");

  const invalid = parseExplicitIds("12,abc,13");
  assert(Boolean(invalid.error), "Expected invalid ids parsing to fail");

  console.log("hero-autofill ids mode verification passed", {
    explicitIdsMode: true,
    parsedIds: requestedIds,
    processedIds: filtered.map((x) => x.id),
    nextCursor: null,
  });
}

run();
