import { describe, it, expect } from "vitest";

// Error normalisation, masking, and the 400-vs-200 contract (PRD §14.1, §7.3).
//
// The masking assertions are the security-relevant ones: an unexpected error must
// lose its message and its stack on the way out. The status assertions pin the
// distinction testers most often get wrong — a validation failure has NO `data`
// key at all, while a resolver failure has both `data` and `errors`.
const { GraphQLError } = require("graphql");
const { formatError, formatErrors, CODES, MASKED_MESSAGE } = require("../../services/graphql/errors");
const { runOperation } = require("../../services/graphql");
const { assembleSchema } = require("../../services/graphql/schema");
const { SCALAR_TYPE_DEFS } = require("../../services/graphql/scalars");

const { schema } = assembleSchema({
  typeDefs: `
    ${SCALAR_TYPE_DEFS}
    type Thing { id: ID! safe: String boom: String required: String! }
    type Query { thing: Thing! plain: String }
  `,
  resolvers: {
    Query: {
      thing: () => ({ id: "1" }),
      plain: () => "ok",
    },
    Thing: {
      safe: () => "fine",
      boom: () => {
        const error = new Error("connection string user=admin password=hunter2");
        throw error;
      },
      required: () => {
        // A non-null field that fails: null propagation makes the PARENT null.
        throw Object.assign(new Error("declared failure"), { extensions: { code: "DECLARED_CODE" } });
      },
    },
  },
});

describe("formatError", () => {
  it("passes through a declared code from the thrown error", () => {
    const wrapped = new GraphQLError("nope", { originalError: Object.assign(new Error("nope"), { code: "MEMBER_NOT_FOUND" }) });
    const formatted = formatError(wrapped);
    expect(formatted.extensions.code).toBe("MEMBER_NOT_FOUND");
    expect(formatted.message).toBe("nope");
  });

  it("masks an undeclared error: no message, no stack, but a correlation id", () => {
    const secret = new Error("password=hunter2 at /srv/app/secrets.js:12");
    const formatted = formatError(new GraphQLError(secret.message, { originalError: secret }));

    expect(formatted.message).toBe(MASKED_MESSAGE);
    expect(formatted.message).not.toMatch(/hunter2/);
    expect(JSON.stringify(formatted)).not.toMatch(/hunter2|secrets\.js/);
    expect(formatted.extensions.code).toBe(CODES.INTERNAL);
    expect(formatted.extensions.correlationId).toMatch(/^crew-\d+-\d+$/);
  });

  it("issues a fresh correlation id per error, so two failures are distinguishable in the log", () => {
    const one = formatError(new GraphQLError("a", { originalError: new Error("a") }));
    const two = formatError(new GraphQLError("b", { originalError: new Error("b") }));
    expect(one.extensions.correlationId).not.toBe(two.extensions.correlationId);
  });

  it("keeps the message for parse and validation errors — it names the real problem", () => {
    const formatted = formatError(new GraphQLError('Cannot query field "vacation" on type "CrewMember".'), {
      defaultCode: CODES.VALIDATION_FAILED,
    });
    expect(formatted.message).toMatch(/Cannot query field "vacation"/);
    expect(formatted.extensions.code).toBe(CODES.VALIDATION_FAILED);
  });

  it("preserves path and locations, which are how a client points at the failure", () => {
    const error = new GraphQLError("boom", {
      nodes: undefined,
      path: ["crewMember", "leave", "balance"],
      originalError: new Error("boom"),
    });
    const formatted = formatError(error);
    expect(formatted.path).toEqual(["crewMember", "leave", "balance"]);
  });

  it("formats a list without dropping any", () => {
    const formatted = formatErrors([new GraphQLError("one"), new GraphQLError("two")], { defaultCode: CODES.VALIDATION_FAILED });
    expect(formatted).toHaveLength(2);
  });
});

describe("the 400 vs 200 contract", () => {
  it("a syntax error is 400 with NO data key", async () => {
    const { status, body } = await runOperation({ schema, source: "{ thing { " });
    expect(status).toBe(400);
    expect("data" in body).toBe(false);
    expect(body.errors[0].extensions.code).toBe(CODES.PARSE_FAILED);
  });

  it("a validation error is 400 with NO data key", async () => {
    const { status, body } = await runOperation({ schema, source: "{ thing { vacation } }" });
    expect(status).toBe(400);
    expect("data" in body).toBe(false);
    expect(body.errors[0].extensions.code).toBe(CODES.VALIDATION_FAILED);
    expect(body.errors[0].message).toMatch(/Cannot query field "vacation"/);
  });

  it("an empty query is 400, not a 500", async () => {
    const { status, body } = await runOperation({ schema, source: "" });
    expect(status).toBe(400);
    expect(body.errors[0].extensions.code).toBe(CODES.PARSE_FAILED);
  });

  it("a resolver failure is 200 WITH data and errors — partial success", async () => {
    const { status, body } = await runOperation({ schema, source: "{ thing { safe boom } }" });
    expect(status).toBe(200);
    expect(body.data.thing.safe).toBe("fine");
    expect(body.data.thing.boom).toBeNull();
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].extensions.code).toBe(CODES.INTERNAL);
    expect(body.errors[0].path).toEqual(["thing", "boom"]);
  });

  it("propagates null up to the nearest nullable parent, per the spec", async () => {
    // `Thing.required` is non-null and `Query.thing` is non-null, so the failure
    // bubbles all the way to `data: null`. Getting this wrong is exactly the
    // mis-teaching §7.2 refuses to risk — and it is graphql-js that gets it right.
    const { status, body } = await runOperation({ schema, source: "{ thing { required } }" });
    expect(status).toBe(200);
    expect(body.data).toBeNull();
    expect(body.errors[0].extensions.code).toBe("DECLARED_CODE");
  });

  it("reports cost, depth and duration in extensions on success", async () => {
    const { body } = await runOperation({ schema, source: "{ plain }" });
    expect(body.extensions).toMatchObject({ cost: 1, depth: 1 });
    expect(typeof body.extensions.durationMs).toBe("number");
  });

  it("charges nothing for a query it refused — a rejected query has no extensions", async () => {
    const { body } = await runOperation({ schema, source: "{ thing { vacation } }" });
    expect(body.extensions).toBeUndefined();
  });

  it("lets a caller add extensions of their own", async () => {
    const { body } = await runOperation({ schema, source: "{ plain }", extensions: () => ({ storeReads: 7 }) });
    expect(body.extensions.storeReads).toBe(7);
  });
});
