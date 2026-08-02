import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const intendedFiles = git(["ls-files", "--cached", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
const forbiddenTrackedPaths = intendedFiles.filter((path) =>
  /(^|\/)\.env(?:\..+)?$/.test(path) && path !== ".env.example"
  || path.startsWith("supabase/.temp/")
  || path.startsWith("supabase/.branches/")
  || /(^|\/)(?:\.DS_Store|Thumbs\.db)$/.test(path)
);

const findings = [];
for (const path of intendedFiles) {
  let body;
  try { body = readFileSync(path, "utf8"); }
  catch { continue; }

  const patterns = [
    { label: "private key", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
    { label: "OpenAI secret key", regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/ },
    { label: "Supabase secret key", regex: /\bsb_secret_[A-Za-z0-9_-]{20,}/ },
    { label: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
    { label: "GitHub token", regex: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/ },
    { label: "Supabase access token", regex: /\bsbp_[A-Za-z0-9_-]{20,}/ },
    { label: "JWT-like credential", regex: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/ },
    { label: "Postgres connection string", regex: /\bpostgres(?:ql)?:\/\/[^\s<]+/i },
    { label: "Slack token", regex: /\bxox[baprs]-[A-Za-z0-9-]{16,}/ },
    { label: "assigned service-role secret", regex: /(?:SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY)\s*=\s*["']?(?!your-|<|\$\{|Deno\.env)[A-Za-z0-9._-]{20,}/ },
  ];
  for (const pattern of patterns) {
    if (pattern.regex.test(body)) findings.push(`${path}: ${pattern.label}`);
  }
}

if (forbiddenTrackedPaths.length || findings.length) {
  if (forbiddenTrackedPaths.length) console.error(`Forbidden tracked local files:\n- ${forbiddenTrackedPaths.join("\n- ")}`);
  if (findings.length) console.error(`Potential committed secrets:\n- ${findings.join("\n- ")}`);
  process.exit(1);
}

console.log(`Secret hygiene passed across ${intendedFiles.length} tracked-or-intended files; no local environment or Supabase link metadata is included.`);
