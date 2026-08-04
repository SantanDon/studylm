import { pathToFileURL } from "node:url";

const MIN_JWT_SECRET_LENGTH = 32;

export function validateProductionEnvironment(env = process.env) {
  const isVercelProduction = env.VERCEL === "1" && env.VERCEL_ENV === "production";
  if (!isVercelProduction) {
    return { checked: false, environment: env.VERCEL_ENV || "local" };
  }

  const jwtSecret = String(env.JWT_SECRET || "");
  if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must contain at least ${MIN_JWT_SECRET_LENGTH} characters before a production deployment can be built.`,
    );
  }

  return { checked: true, environment: "production" };
}

const isDirectExecution =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectExecution) {
  try {
    const result = validateProductionEnvironment();
    if (result.checked) {
      console.log("[production-env] PASS production secrets meet deployment requirements.");
    } else {
      console.log("[production-env] SKIP not a Vercel production build.");
    }
  } catch (error) {
    console.error(`[production-env] FAIL ${error.message}`);
    process.exitCode = 1;
  }
}
