import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

export function extractQuotedCheckValues(sql: string, column: string): string[] {
  const match = sql.match(new RegExp(`check\\s*\\(\\s*${column}\\s+in\\s*\\(([^)]+)\\)`, "i"));
  if (!match) {
    throw new Error(`No CHECK (${column} in (...)) found`);
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}
