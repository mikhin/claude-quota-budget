#!/usr/bin/env node
// UserPromptSubmit hook: blocks the prompt when a weekly model quota runs ahead of 1/7 per day.
// With --status, prints what is left of today's budget for the status line instead.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DAILY = Number(process.env.BUDGET_DAILY ?? 100 / 7);
const MODEL = process.env.BUDGET_MODEL ?? "fable";
const LIMIT_NAME = process.env.BUDGET_LIMIT ?? "Fable";
const ADVICE = process.env.BUDGET_ADVICE ?? "/model opus";
const CACHE = join(homedir(), ".cache/claude-quota-budget.json");
const TTL = 300_000;

async function readStdin() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

function currentModel(input) {
  if (input.model) return input.model;
  const settings = JSON.parse(readFileSync(join(homedir(), ".claude/settings.json"), "utf8"));
  return settings.model ?? "";
}

function cached() {
  try {
    if (Date.now() - statSync(CACHE).mtimeMs < TTL) return JSON.parse(readFileSync(CACHE, "utf8"));
  } catch {}
  return null;
}

async function usage() {
  const hit = cached();
  if (hit) return hit;
  const creds = JSON.parse(
    execFileSync("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], {
      encoding: "utf8",
    }),
  );
  const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: {
      Authorization: `Bearer ${creds.claudeAiOauth.accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`usage ${response.status}`);
  const data = await response.json();
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(data));
  return data;
}

const weeklyLimit = (data) =>
  data.limits.find(
    (limit) => limit.kind === "weekly_scoped" && limit.scope?.model?.display_name === LIMIT_NAME,
  );

const weeklyAllLimit = (data) => data.limits.find((limit) => limit.kind === "weekly_all");

function budgetFor(resetsAt, now) {
  const remainingDays = (resetsAt - now) / 86_400_000;
  const day = Math.max(1, 7 - Math.floor(remainingDays));
  return { day, budget: Math.min(100, day * DAILY) };
}

const paceOf = (limit) =>
  limit && { percent: limit.percent, ...budgetFor(new Date(limit.resets_at), new Date()) };

async function todayPace() {
  return paceOf(weeklyLimit(await usage()));
}

function statusText(name, { percent, budget }) {
  const left = budget - percent;
  return left < 0
    ? `\x1b[31m${name} ${Math.round(-left)}% over today\x1b[0m`
    : `${name} ${Math.round(left)}% left today`;
}

async function main() {
  const input = JSON.parse((await readStdin()) || "{}");
  if (!currentModel(input).includes(MODEL)) return;
  const pace = await todayPace();
  if (pace && pace.percent > pace.budget) {
    console.error(
      `${LIMIT_NAME}: ${pace.percent}% of the week spent, budget for day ${pace.day}/7 is ` +
        `${pace.budget.toFixed(0)}%. Switch: ${ADVICE}`,
    );
    process.exit(2);
  }
}

async function status() {
  const data = await usage();
  const parts = [
    [LIMIT_NAME, weeklyLimit(data)],
    ["All", weeklyAllLimit(data)],
  ]
    .filter(([, limit]) => limit)
    .map(([name, limit]) => statusText(name, paceOf(limit)));
  if (parts.length) console.log(parts.join(" · "));
}

if (process.argv[2] === "--test") {
  const reset = new Date("2026-09-22T03:00:00Z");
  assert.deepEqual(budgetFor(reset, new Date("2026-09-15T03:01:00Z")), { day: 1, budget: DAILY });
  assert.equal(budgetFor(reset, new Date("2026-09-19T18:00:00Z")).day, 5);
  assert.deepEqual(budgetFor(reset, new Date("2026-09-22T02:59:00Z")), { day: 7, budget: 100 });
  assert.equal(statusText("Fable", { percent: 70, budget: 100 }), "Fable 30% left today");
  assert.equal(statusText("All", { percent: 30, budget: 28.6 }), "\x1b[31mAll 1% over today\x1b[0m");
  console.log("ok");
} else {
  // fail open: a broken hook must not lock Claude out
  (process.argv[2] === "--status" ? status() : main()).catch((error) =>
    console.error(`quota-budget: ${error.message}`),
  );
}
