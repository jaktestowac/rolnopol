/**
 * Documents resolvers.
 *
 * Thin, like every pillar before it: take arguments, call the per-request service,
 * shape the answer. No scoping, no validation, no filesystem — those live in the
 * service so a second transport (the download route) cannot skip them.
 *
 * One thing this file deliberately does NOT do: touch `input.files`. The Upload
 * scalar has already refused anything that did not arrive as a multipart part, so
 * by the time a resolver runs, a file is a file. Re-checking here would suggest
 * the scalar is advisory.
 */
const resolvers = {
  Query: {
    crewDocument: (_source, { id }, context) => context.services.documents.findDocument(id),
  },

  Mutation: {
    // Errors travel as errors. A `CrewError` here refuses the WHOLE batch — unknown
    // member, unusable session, no files at all — and carries its own code, so it
    // must not be flattened into `rejected`, which is only ever about one file
    // among several. Nothing to catch: the executor formats it.
    uploadCrewDocuments: (_source, { input }, context) => context.services.documents.uploadDocuments(input),
  },

  CrewMember: {
    documents: (member, _args, context) => context.services.documents.folderFor(member.staffId),
  },
};

module.exports = { resolvers };
