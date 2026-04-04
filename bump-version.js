#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const jsonFiles = ["package.json", "app-data.json", "public/schema/openapi.json"];
const lockFile = "package-lock.json";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function bumpVersion(currentVersion, bump) {
  const versionRe = /^(\d+)\.(\d+)\.(\d+)$/;
  const match = currentVersion.match(versionRe);
  if (!match) {
    throw new Error(`Current version ${currentVersion} is not a valid semver version`);
  }

  const [, major, minor, patch] = match.map(Number);

  if (versionRe.test(bump)) {
    return bump;
  }

  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Unknown bump type: ${bump}. Use major, minor, patch or a full version.`);
  }
}

function updateJsonFile(filePath, newVersion) {
  if (!fs.existsSync(filePath)) {
    console.warn(`Skipping missing file: ${filePath}`);
    return;
  }

  const json = readJson(filePath);
  if (Object.prototype.hasOwnProperty.call(json, "version")) {
    json.version = newVersion;
    writeJson(filePath, json);
    console.log(`Updated ${filePath}`);
  } else {
    console.warn(`No top-level version field found in ${filePath}; file not updated.`);
  }
}

function updatePackageLock(filePath, newVersion) {
  if (!fs.existsSync(filePath)) {
    console.warn(`Skipping missing file: ${filePath}`);
    return;
  }

  const json = readJson(filePath);
  json.version = newVersion;
  if (json.packages && Object.prototype.hasOwnProperty.call(json.packages, "")) {
    json.packages[""].version = newVersion;
  }
  writeJson(filePath, json);
  console.log(`Updated ${filePath}`);
}

function main() {
  const bump = process.argv[2] || "patch";
  const packageJsonPath = path.resolve("package.json");
  const packageJson = readJson(packageJsonPath);
  const currentVersion = packageJson.version;

  if (!currentVersion) {
    throw new Error("package.json does not contain a version field.");
  }

  const newVersion = bumpVersion(currentVersion, bump);
  if (newVersion === currentVersion) {
    console.log(`Version already is ${newVersion}; no changes made.`);
    process.exit(0);
  }

  packageJson.version = newVersion;
  writeJson(packageJsonPath, packageJson);
  console.log(`Updated package.json: ${currentVersion} -> ${newVersion}`);

  jsonFiles.forEach((file) => updateJsonFile(path.resolve(file), newVersion));
  updatePackageLock(path.resolve(lockFile), newVersion);

  const verified = readJson(packageJsonPath).version === newVersion;
  if (!verified) {
    throw new Error(`Verification failed: expected package.json version ${newVersion}`);
  }

  console.log(`Version bump complete: ${newVersion}`);
}

try {
  main();
} catch (error) {
  console.error("ERROR:", error.message || error);
  process.exit(1);
}
