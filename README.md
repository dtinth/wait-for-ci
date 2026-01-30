# wait-for-ci

A dependency-free Deno script that automates `gh` CLI to poll and wait for CI checks in a pull request to finish. Main use case is to allow agentic coding agents to push commits and wait for PR to finish.

## Usage

Make sure that you’ve pushed your changes and that there is an active pull request for the current branch, then run:

```sh
deno run --allow-run=gh --allow-env https://github.com/dtinth/wait-for-ci/raw/main/wait-for-ci.ts
```

This command:

- Figures out the current pull request number from the current branch.
- Monitors the GitHub pull request's status checks.
- Periodically polls and prints status updates and any changes.
- When all checks are finished, prints a summary of results, and exits.

## Equipping

Use the [skills CLI](https://github.com/vercel-labs/skills) to equip your coding agent with the skill to wait for CI to finish:

```sh
npx skills add dtinth/agent-skills --skill wait-for-ci --global
```

With this skill, your coding agent will be able to debug failed CI builds autonomously:

<img width="659" height="858" alt="image" src="https://github.com/user-attachments/assets/9d481074-dc0a-4b16-be3a-091f6528e64a" />

<img width="864" height="1015" alt="image" src="https://github.com/user-attachments/assets/c4d06109-e08d-4d66-a1e1-6096a9d34662" />
