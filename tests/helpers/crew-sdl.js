/**
 * Reading a crew pillar's SDL from inside a unit test.
 *
 * The resolver tests assert that every `__typename` an outcome table can emit is
 * actually a member of the union it is returned from. The only way for that check
 * to be worth anything is to read the union from `schema.graphql` itself — a list
 * copied into the test would drift alongside the resolver it is supposed to
 * police, and would agree with it right up to the moment both were wrong.
 *
 * Parsed with `graphql`'s own parser rather than a regex, because a union may be
 * written on one line or spread over six and both spellings are already in use.
 * Parsing is syntax-only, so a fragment that references types defined in another
 * pillar is fine here.
 */
const fs = require("fs");
const path = require("path");
const { parse } = require("graphql");

const PILLARS_DIR = path.join(__dirname, "..", "..", "services", "crew", "pillars");

/** Raw SDL text for one pillar, e.g. `readPillarSdl("leave")`. */
function readPillarSdl(pillar) {
  return fs.readFileSync(path.join(PILLARS_DIR, pillar, "schema.graphql"), "utf8");
}

/**
 * Every union in a pillar's SDL, as `{ [unionName]: string[] }`.
 * @param {string} pillar - directory name under services/crew/pillars
 */
function pillarUnions(pillar) {
  const document = parse(readPillarSdl(pillar));
  const unions = {};

  for (const definition of document.definitions) {
    if (definition.kind !== "UnionTypeDefinition") continue;
    unions[definition.name.value] = definition.types.map((type) => type.name.value);
  }

  return unions;
}

/**
 * Members of one union, sorted. Throws rather than returning an empty list, so a
 * renamed union fails loudly instead of vacuously passing an "every member is
 * declared" assertion over nothing.
 */
function unionMembers(pillar, unionName) {
  const unions = pillarUnions(pillar);
  const members = unions[unionName];
  if (!members) {
    throw new Error(`union ${unionName} not found in the ${pillar} SDL (found: ${Object.keys(unions).join(", ")})`);
  }
  return [...members].sort();
}

module.exports = { readPillarSdl, pillarUnions, unionMembers };
