# claude-quota-budget

A Claude Code hook that paces a **weekly** model quota across the week: it blocks the prompt when
usage runs ahead of `1/7` per day.

Existing usage tools show what you have spent. This one stops you from spending it all on Monday.

```
Fable: 100% of the week spent, budget for day 7/7 is 0%. Switch: /model opus
```

## Install

```sh
curl -o ~/.claude/hooks/quota-budget.mjs \
  https://raw.githubusercontent.com/mikhin/claude-quota-budget/main/quota-budget.mjs
```

Then in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/quota-budget.mjs" }] }
    ]
  }
}
```

Needs Node 18+ and macOS (the OAuth token is read from the Keychain).

## Configure

| Variable        | Default    | What it is                                              |
| --------------- | ---------- | ------------------------------------------------------- |
| `BUDGET_MODEL`  | `fable`    | Substring of the model id the budget applies to          |
| `BUDGET_LIMIT`  | `Fable`    | `display_name` of the weekly limit to read               |
| `BUDGET_DAILY`  | `100 / 7`  | Percent of the weekly quota allowed per day              |
| `BUDGET_ADVICE` | `/model opus` | What the block message tells you to switch to         |

Any other model passes through untouched.

## How it works

On every prompt: if the current model matches `BUDGET_MODEL`, read `/api/oauth/usage` (cached for 5
minutes in `~/.cache/claude-quota-budget.json`), find the weekly limit named `BUDGET_LIMIT`, and
compare its `percent` against `day × BUDGET_DAILY`, where `day` is 1..7 derived from `resets_at`.
Over budget exits `2`, which is how a `UserPromptSubmit` hook blocks the prompt.

Day 3 of the week means 43% is fine and 60% is not — the block is on the pace, not the total.

## Status line

`--status` prints the same numbers for the Claude Code status line — spent of the week against
today's budget, red when over:

```
Fable 70/100%
```

```json
{ "statusLine": { "type": "command", "command": "node ~/.claude/hooks/quota-budget.mjs --status" } }
```

It shows whatever model is selected and shares the 5-minute cache with the hook.

## Caveats

- `/api/oauth/usage` is not a documented API. It can change or disappear without notice.
- Any failure fails open: the hook prints the error and lets the prompt through. It will never lock
  you out of Claude Code.
- Subscription quotas only (the endpoint has nothing to say about API billing).

## Test

```sh
node quota-budget.mjs --test
```

## License

MIT
