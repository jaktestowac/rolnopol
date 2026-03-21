import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.js"],
        },
      },
      {
        test: {
          name: "property",
          include: ["tests/property/**/*.pbt.test.js"],
          exclude: ["tests/unit/**/*.test.js"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/**/*.test.js"],
          exclude: ["tests/unit/**/*.test.js", "tests/property/**/*.test.js"],
          poolOptions: {
            forks: {
              singleFork: true,
              isolate: true,
            },
          },
        },
      },
    ],
  },
});
