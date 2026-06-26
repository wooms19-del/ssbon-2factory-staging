# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. No Closing Colons (Korean Output)

**End Korean sentences with a period, not a colon.**

When the user writes in Korean, your output is Korean too:
- Don't end a sentence with `:` even when a list or example follows.
- LLMs leak the English colon habit into Korean. Catch it.
- Every Korean sentence should end in `.`, `?`, or `!` — not `:`.
- Colons are fine inside code, key-value pairs, or labels — not as sentence enders.

## 6. Korean File Header Comment

**First line of every new JS file: a one-line Korean comment stating its role.**

- e.g. `// 파쇄 공정: 입력·저장·잔량(FIFO) 계산 — sh2*`
- Agents read files selectively, not whole codebases. One Korean line gives the next session instant context.
- Skip vendor/config files.

## 7. Plan First, Log Decisions (Obsidian)

**Before any non-trivial task, state a brief plan. Capture decisions as you go.**

- Plan: what we're building and why, with a verify step per item (see #4).
- ssbon has no `checklist.md`/`context-notes.md` convention — record decisions and their reasoning so they can drop into the Obsidian troubleshooting log.
- Don't start a multi-step change without naming the success check first.

## 8. Verify Before "Done" (no test suite)

**ssbon has no test harness. Self-verify instead — every time, before push.**

- `node -c <file>.js` for syntax on any touched JS.
- Run the actual computed value against real Firestore data (or a LibreOffice render for xlsx/pdf) and eyeball it.
- The user must never be the one to find the error via screenshot.
- Verify proactively, before the user says "끝", "완료", "다 됐어".

## 9. Semantic Commits + 3-Set Deploy

**One logical change = one commit. Ship it through the full deploy chain.**

- The test: can you describe the commit in one sentence? If not, split it.
- Every code change to a live `js/*.js` ships as 3 ordered steps:
  1. code commit + push
  2. `index.html` `?v=` bump — increase only, and to a NEW value (reusing the same `?v=` serves the stale cached file)
  3. Firestore `_config/version` PATCH (`value` stringValue) to trigger auto-reload
- Back up to `/home/claude/backups/` before any destructive Firestore op.

## 10. Read What Actually Runs — Don't Guess

**Read the real error/log. When a screen value is wrong, confirm which code actually executes.**

- Read the full error/stack, not the keyword. Don't apply a "common fix" before confirming the cause.
- When a displayed number is wrong, don't jump to "cache" or any single theory. First find the exact function the browser runs and trace it on the real data.
- Watch for: a function redefined/overridden later in the same file (the override runs, not the top definition); a stale file cached at an unchanged `?v=`; the wrong render function for that screen.
- If unclear, add a probe (independent page, or a node trace on live data) to see the real value — then fix.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
