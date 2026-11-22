See [AGENTS.md](./AGENTS.md).

## Prompt log (required)

Log every prompt the user gives in [PROMPTS.md](./PROMPTS.md), so judges can follow the workflow.

- **When:** add the entry in the same turn you handle the prompt, before you reply.
- **Format:** a new `## Prompt N: <short title>` section, numbered after the last one. Quote the prompt **word for word** (keep typos) in a `>` block, then add a short **What the agent did** note: actions taken, decisions the user made, and what was verified.
- **Short follow-ups** like "continue" go in their own entry, or with the prompt they continue.
- **Never edit or reword** earlier prompts. You may fill in an earlier entry's outcome when it finishes.
- **Commit** `PROMPTS.md` with the related work and push it when you push that branch.
- **Never** put credentials, tokens, or other secrets in the log.
