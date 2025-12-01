import type { Config } from "jest";
import nextJest from "next/jest";

const createJestConfig = nextJest({
  dir: "./",
});

const config: Config = {
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageProvider: "v8",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@auth/prisma-adapter$": "<rootDir>/test/__mocks__/auth-prisma-adapter.js",
    "^next-auth$": "<rootDir>/test/__mocks__/next-auth.js",
    "^.+\\.(css|less|scss|sass)$": "<rootDir>/test/__mocks__/styleMock.js",
  },
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testMatch: ["**/?(*.)+(test).[tj]s?(x)"],
  testPathIgnorePatterns: ["/node_modules/", "/.next/", "/.devcontainer/"],
  watchPathIgnorePatterns: ["/.next/"],
};

export default createJestConfig(config);
