---
name: skill-authoring-evals
description: Use when creating or revising Customer Service Bot runtime skills. Requires trigger examples, negative cases and measurable routing behavior.
---

# Skill Authoring and Evals

Write skills for a narrow business job with explicit evidence and safety boundaries.

## Authoring

- Give the skill a unique kebab-case slug and human-readable name.
- Description explains when the skill is useful, not how the implementation works.
- Keep triggers concrete in Vietnamese and English when the bot serves both.
- Instructions should state the business outcome, grounding source and forbidden guesses.
- Avoid duplicating another skill; prefer extending an existing one when scope overlaps.
- Do not embed secrets, provider tokens, customer data or environment-specific credentials.

## Evaluation

For a new skill create:
- clear positive trigger examples;
- ambiguous examples where another skill should win;
- negative examples that should not select the skill;
- expected handoff behavior when evidence is missing.

Use `/api/skills/evaluate` or direct registry tests. Compare expected skill slug with actual selection. A skill change is not complete if it improves one trigger while broadly stealing traffic from unrelated intents.
