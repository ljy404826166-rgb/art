import fs from "node:fs";

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

const env = {
  ...readEnvFile(".env"),
  ...readEnvFile(".env.local"),
  ...process.env,
};

const requiredKeys = ["VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
let hasError = false;

for (const key of requiredKeys) {
  const value = String(env[key] || "");
  const present = value.length > 0;
  console.log(`${key}: ${present ? "present" : "missing"}${present ? ` (${value.length} chars)` : ""}`);
  if (!present) hasError = true;
}

if (env.SUPABASE_SERVICE_ROLE_KEY && env.VITE_SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("Warning: SUPABASE_SERVICE_ROLE_KEY must not use a VITE_ prefix.");
}

if (hasError) {
  console.error("Missing required Supabase environment variables. Copy .env.local.example to .env.local and fill local values.");
  process.exit(1);
}
