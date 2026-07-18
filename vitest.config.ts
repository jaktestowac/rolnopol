import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 20000,
    setupFiles: ["tests/setup.js"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.js"],
        },
      },
      {
        extends: true,
        test: {
          name: "property",
          include: ["tests/property/**/*.pbt.test.js"],
          exclude: ["tests/unit/**/*.test.js"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/**/*.test.js"],
          exclude: ["tests/unit/**/*.test.js", "tests/property/**/*.test.js"],
          // Integration tests share the on-disk JSON databases, so they must
          // run sequentially in a single process (vitest 4 replacement for
          // the removed poolOptions.forks.singleFork).
          pool: "forks",
          fileParallelism: false,
          isolate: true,
        },
      },
    ],
  },
});
