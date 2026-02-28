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
          name: "integration",
          include: ["tests/**/*.test.js"],
          exclude: ["tests/unit/**/*.test.js"],
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
