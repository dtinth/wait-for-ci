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

## Add the skill to your coding agent

```sh
npx skills add dtinth/agent-skills --skill wait-for-ci --global
```
