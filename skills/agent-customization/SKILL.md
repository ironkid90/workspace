---
name: create-skill-from-conversation
description: >-
  Convert a recorded multi-step conversation or workflow into a reusable
  `SKILL.md` for the `agent-customization` domain. Guides extraction of steps,
  decision points, quality criteria and example prompts; produces a ready-to-save
  SKILL.md draft.
---

# Create Skill From Conversation

Purpose
- Convert a conversation or ad-hoc workflow into a repeatable, workspace-scoped
  `SKILL.md` that documents the procedure and provides example prompts.

When to use
- You have a multi-step interaction, decision tree, or debugging workflow that
  you'll reuse across projects or want to share with a team.

Outputs
- A draft `SKILL.md` file containing: scope, step-by-step workflow, decision
  points, quality checks, example prompts, and suggested customizations.

Workflow (step-by-step)
1. Gather conversation artifacts: messages, relevant files, and commands used.
2. Identify the atomic steps (1–8 steps recommended) and group them into
   phases (prepare, run, verify, finalize).
3. For each step, record: intent, inputs, outputs, success criteria, failure
   modes and recovery options.
4. Extract decision points (branching logic) and list the condition and
   alternate paths.
5. Draft the SKILL.md frontmatter: `name`, `description`, `scope` (workspace vs
   personal), `applyTo` (optional file globs).
6. Write the step list with short descriptions and quick commands or code
   snippets where appropriate.
7. Add a short checklist of quality criteria and a minimal validation plan.
8. Provide 3–5 example prompts tailored to different user roles (developer,
   reviewer, automation).
9. Save the file under `.github/skills/<name>/SKILL.md` or `skills/<name>/SKILL.md`.
10. Iterate: ask the original participants for ambiguous steps, then update.

Decision Points (examples)
- Is this repo-scoped or user-scoped? -> choose location and visibility.
- Does the step require running tools or only reading files? -> pick `Skill`
  vs `Instruction` vs `Prompt`.
- Is an automated check acceptable or is human review required? -> add
  verification step.

Quality Criteria
- Steps are ordered and reproducible locally.
- Inputs and outputs are explicit (files, env vars, arguments).
- Failure modes have clear recovery actions.
- Each example prompt maps to a specific step or outcome.

Example Prompts
- "Create a `SKILL.md` from this conversation: [paste messages]. Scope: workspace."
- "Draft a step-by-step checklist to reproduce the bug described in message X."
- "Extract decision points and convert them into short yes/no rules for the
  skill's 'Decision Points' section."

Iterate and Verify
- After saving the draft, run a quick validation:
  - Confirm YAML frontmatter parses.
  - Confirm referenced file paths exist or are labeled `optional`.
  - Try the example prompts and verify they produce expected outputs.

Next customizations
- Add `applyTo` globs to limit when the skill is suggested.
- Bundle helper scripts or templates under the skill folder.
- Attach test harness or CI checks that exercise the workflow.

Minimal checklist before merge
- [ ] Frontmatter present and valid
- [ ] Steps <= 12, clear and actionable
- [ ] Example prompts included (3+)
- [ ] Quality checks and recovery steps present

---

If any step is ambiguous, ask: what exact files/commands were used and what
constitutes success for this task?
