#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const MANIFEST_PATH = path.join(PROJECT_ROOT, "cloudbase", "account-foundation.json");
const DEFAULT_EXPERIENCE_ENV_ID = "experience-d2gxlf5bta2349f3e";
const PRODUCTION_ENV_ID = "cloudbase-d6gvny27ib05e0ede";

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const output = {};
  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    output[match[1]] = value;
  }
  return output;
}

function environment() {
  return {
    ...parseEnvFile(path.join(PROJECT_ROOT, ".env")),
    ...parseEnvFile(path.join(PROJECT_ROOT, ".env.local")),
    ...process.env,
  };
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseArgs(argv, config = environment()) {
  const options = {
    envId: config.CLOUDBASE_EXPERIENCE_ENV_ID || DEFAULT_EXPERIENCE_ENV_ID,
    run: false,
    allowProduction: false,
    confirmation: "",
    skipFunction: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env-id") {
      options.envId = requiredValue(argv, (index += 1), arg);
    } else if (arg === "--run") {
      options.run = true;
    } else if (arg === "--allow-production") {
      options.allowProduction = true;
    } else if (arg === "--confirm-env") {
      options.confirmation = requiredValue(argv, (index += 1), arg);
    } else if (arg === "--skip-function") {
      options.skipFunction = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.envId) {
    throw new Error("Missing CloudBase environment ID.");
  }
  if (options.envId === PRODUCTION_ENV_ID && !options.allowProduction) {
    throw new Error("Production deployment requires --allow-production.");
  }
  if (options.run && options.confirmation !== options.envId) {
    throw new Error(`--run requires --confirm-env ${options.envId}.`);
  }

  return options;
}

function createClient(envId, config = environment()) {
  const secretId =
    config.TENCENT_SECRET_ID || config.TENCENTCLOUD_SECRETID || config.TENCENT_CLOUD_SECRET_ID;
  const secretKey =
    config.TENCENT_SECRET_KEY || config.TENCENTCLOUD_SECRETKEY || config.TENCENT_CLOUD_SECRET_KEY;

  if (!secretId || !secretKey) {
    throw new Error("Missing Tencent credentials. Set TENCENT_SECRET_ID and TENCENT_SECRET_KEY.");
  }

  return CloudBase.init({
    envId,
    secretId,
    secretKey,
  });
}

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

function indexDefinition(index) {
  return {
    IndexName: index.name,
    MgoKeySchema: {
      MgoIndexKeys: index.keys.map((key) => ({
        Name: key.name,
        Direction: key.direction,
      })),
      MgoIsUnique: index.unique === true,
    },
  };
}

async function ensureCollection(database, collection) {
  let result = null;
  try {
    result = await database.createCollectionIfNotExists(collection.name);
  } catch (error) {
    const message = String((error && (error.message || error.errMsg)) || error || "");
    if (!/resource\s+exist|already\s+exist/i.test(message)) {
      throw error;
    }
  }
  const detail = await database.describeCollection(collection.name);
  const existingIndexes = new Set((detail.Indexes || []).map((index) => index.Name));
  const missingIndexes = collection.indexes
    .filter((index) => !existingIndexes.has(index.name))
    .map(indexDefinition);

  if (missingIndexes.length > 0) {
    await database.updateCollection(collection.name, {
      CreateIndexes: missingIndexes,
    });
  }

  return {
    name: collection.name,
    created: Boolean(result && result.IsCreated === true),
    indexes_created: missingIndexes.map((index) => index.IndexName),
  };
}

async function ensurePermission(permissionService, collection) {
  await permissionService.modifyResourcePermission({
    resourceType: "collection",
    resource: collection.name,
    permission: collection.permission,
  });

  const result = await permissionService.describeResourcePermission({
    resourceType: "collection",
    resources: [collection.name],
  });
  const record = (result.Data && result.Data.PermissionList ? result.Data.PermissionList : []).find(
    (item) => item.Resource === collection.name,
  );

  if (!record || record.Permission !== collection.permission) {
    throw new Error(`Permission verification failed for ${collection.name}.`);
  }

  return {
    name: collection.name,
    permission: record.Permission,
  };
}

function resolveFunctionEnvironment(definition, config) {
  return Object.fromEntries(
    (Array.isArray(definition.environmentVariables) ? definition.environmentVariables : []).map(
      (name) => [name, String(config[name] || "")],
    ),
  );
}

async function deployFunction(functionService, definition, config) {
  const functionPath = path.join(PROJECT_ROOT, definition.source);
  const functionRootPath = path.dirname(functionPath);

  await functionService.createFunction({
    func: {
      name: definition.name,
      description: "Masterpiece account identity and profile foundation",
      runtime: definition.runtime,
      handler: definition.handler,
      timeout: definition.timeout,
      memorySize: definition.memorySize,
      envVariables: resolveFunctionEnvironment(definition, config),
      installDependency: true,
      ignore: ["*.test.mjs", "**/*.test.mjs"],
    },
    functionPath,
    functionRootPath,
    force: true,
    deployMode: "zip",
  });

  const detail = await functionService.getFunctionDetail(definition.name);
  if (detail.Status !== "Active") {
    throw new Error(`Function ${definition.name} is not active: ${detail.Status || "unknown"}.`);
  }

  return {
    name: definition.name,
    runtime: detail.Runtime,
    handler: detail.Handler,
    status: detail.Status,
  };
}

function printPlan(options, manifest) {
  const plan = {
    mode: options.run ? "run" : "dry-run",
    env_id: options.envId,
    production: options.envId === PRODUCTION_ENV_ID,
    collections: manifest.collections.map((collection) => ({
      name: collection.name,
      permission: collection.permission,
      indexes: collection.indexes.map((index) => index.name),
    })),
    function: options.skipFunction
      ? null
      : {
          ...manifest.function,
          environmentVariables: manifest.function.environmentVariables || [],
        },
  };
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

async function main() {
  const config = environment();
  const options = parseArgs(process.argv.slice(2), config);
  const manifest = readManifest();
  printPlan(options, manifest);

  if (!options.run) return;

  const app = createClient(options.envId, config);
  const collections = [];
  const permissions = [];

  for (const collection of manifest.collections) {
    collections.push(await ensureCollection(app.database, collection));
    permissions.push(await ensurePermission(app.permission, collection));
  }

  const cloudFunction = options.skipFunction
    ? null
    : await deployFunction(app.functions, manifest.function, config);

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        env_id: options.envId,
        collections,
        permissions,
        function: cloudFunction,
      },
      null,
      2,
    )}\n`,
  );
}

export {
  DEFAULT_EXPERIENCE_ENV_ID,
  PRODUCTION_ENV_ID,
  ensureCollection,
  indexDefinition,
  parseArgs,
  resolveFunctionEnvironment,
};

if (
  process.argv[1] &&
  path.basename(process.argv[1]).toLowerCase() ===
    path.basename(fileURLToPath(import.meta.url)).toLowerCase()
) {
  main().catch((error) => {
    console.error(`[account-foundation] ${error.message}`);
    process.exitCode = 1;
  });
}
