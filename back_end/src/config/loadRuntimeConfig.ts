import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const rootDir = path.resolve(__dirname, "..", "..");

const loadEnvFile = (filePath: string, target: Record<string, string>): void => {
  if (!fs.existsSync(filePath)) return;
  const parsed = dotenv.parse(fs.readFileSync(filePath));
  Object.assign(target, parsed);
};

const loadJsonConfig = (filePath: string, target: Record<string, string>): void => {
  if (!fs.existsSync(filePath)) return;
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  for (const [key, value] of Object.entries(parsed)) {
    if (value === undefined || value === null) continue;
    target[key] = String(value);
  }
};

const explicitConfigPath = process.env.XINJIN_CONFIG_FILE?.trim();
const candidateFiles = [path.join(rootDir, ".env"), path.join(rootDir, ".env.local")];

if (explicitConfigPath) {
  candidateFiles.push(path.isAbsolute(explicitConfigPath) ? explicitConfigPath : path.resolve(rootDir, explicitConfigPath));
}

const staged: Record<string, string> = {};

for (const filePath of candidateFiles) {
  if (filePath.toLowerCase().endsWith(".json")) {
    loadJsonConfig(filePath, staged);
  } else {
    loadEnvFile(filePath, staged);
  }
}

for (const [key, value] of Object.entries(staged)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}
