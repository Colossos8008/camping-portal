import { parseExplicitIds } from "../src/lib/hero-autofill-ids";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function run(): void {
  const normal = parseExplicitIds("1270,1284,1290");
  assert(!normal.error, `Unexpected parse error: ${normal.error ?? ""}`);
  const normalIds = normal.ids;
  assert(Array.isArray(normalIds), "Expected parsed ids for normal input");
  assert(normalIds.length === 3, `Expected 3 ids, got ${normalIds.length}`);
  assert(normalIds[0] === 1270 && normalIds[1] === 1284 && normalIds[2] === 1290, "Unexpected ids order for normal input");

  const deduped = parseExplicitIds("1270,1284,1270,1290,1284");
  assert(!deduped.error, `Unexpected dedupe parse error: ${deduped.error ?? ""}`);
  const dedupedIds = deduped.ids;
  assert(Array.isArray(dedupedIds), "Expected parsed ids for dedupe input");
  assert(dedupedIds.length === 3, `Expected 3 deduped ids, got ${dedupedIds.length}`);
  assert(dedupedIds[0] === 1270 && dedupedIds[1] === 1284 && dedupedIds[2] === 1290, "Unexpected deduped ids");

  const invalid = parseExplicitIds("12,abc,13");
  assert(Boolean(invalid.error), "Expected invalid ids parsing to fail");
  assert(invalid.ids === undefined, "Expected invalid ids result to omit ids");

  const empty = parseExplicitIds("   ");
  assert(!empty.error, `Unexpected parse error for empty input: ${empty.error ?? ""}`);
  assert(empty.ids === undefined, "Expected empty input to produce undefined ids");

  const requestedIds = normal.ids ?? [];
  const fakePlaces = [
    { id: 1269, name: "x" },
    { id: 1270, name: "a" },
    { id: 1284, name: "c" },
    { id: 1290, name: "e" },
    { id: 1300, name: "y" },
  ];

  const filtered = fakePlaces.filter((place) => requestedIds.includes(place.id));
  assert(filtered.length === requestedIds.length, "Filtered places length mismatch for explicit ids mode");
  assert(filtered.every((place) => requestedIds.includes(place.id)), "Found unrelated place in explicit ids mode");

  console.log("hero-autofill ids mode verification passed", {
    explicitIdsMode: true,
    parsedIds: requestedIds,
    processedIds: filtered.map((x) => x.id),
    nextCursor: null,
  });
}

run();
