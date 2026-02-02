#!/usr/bin/env -S deno run --allow-run --allow-env
import { execFileSync } from "node:child_process"
import process from "node:process"

const CHECK_INTERVAL = 30e3
const MAX_CHECKS = 720
const CHECK_START_GRACE_PERIOD = 60e3

interface StatusCheckRollup {
  __typename: "CheckRun" | "StatusContext"
  // CheckRun fields
  workflowName?: string
  name?: string
  status?: string
  conclusion?: string
  completedAt?: string
  detailsUrl?: string
  startedAt?: string
  // StatusContext fields
  context?: string
  state?: string
  targetUrl?: string
}

interface CheckState {
  status: string
  conclusion: string
  workflow: string
  name: string
  completedAt: string
  detailsUrl?: string
}

interface Change {
  type: "new" | "change"
  workflow: string
  name: string
  status?: string
  conclusion?: string
  from?: string
  to?: string
  fromConclusion?: string
  toConclusion?: string
  sig: string
  detailsUrl?: string
}

function getCheckRuns(): StatusCheckRollup[] {
  try {
    const output = execFileSync(
      "gh",
      ["pr", "view", "--json", "statusCheckRollup", "-q", ".statusCheckRollup"],
      { encoding: "utf-8" },
    )
    return JSON.parse(output)
  } catch {
    return []
  }
}

function statusEmoji(
  status: string,
  conclusion: string | null | undefined,
): string {
  switch (status) {
    case "COMPLETED":
      return conclusion === "SUCCESS"
        ? "✅"
        : conclusion === "SKIPPED"
          ? "⊘"
          : "❌"
    case "IN_PROGRESS":
      return "🔄"
    case "QUEUED":
      return "⏳"
    case "PENDING":
      return "⏳"
    default:
      return "❓"
  }
}

function groupChecksByStatus(
  checks: StatusCheckRollup[],
): Record<string, StatusCheckRollup[]> {
  const grouped: Record<string, StatusCheckRollup[]> = {}
  for (const check of checks) {
    const status = getCheckStatus(check)
    if (!grouped[status]) {
      grouped[status] = []
    }
    grouped[status].push(check)
  }
  return grouped
}

function getCheckStatus(check: StatusCheckRollup): string {
  if (check.__typename === "StatusContext") {
    return "COMPLETED"
  }
  return check.status || "UNKNOWN"
}

function getCheckConclusion(check: StatusCheckRollup): string {
  if (check.__typename === "StatusContext") {
    return check.state || "UNKNOWN"
  }
  return check.conclusion || "UNKNOWN"
}

function getCheckName(check: StatusCheckRollup): string {
  if (check.__typename === "StatusContext") {
    return check.context || "Unknown"
  }
  return check.name || "Unknown"
}

function getCheckWorkflow(check: StatusCheckRollup): string {
  if (check.__typename === "StatusContext") {
    return "Status"
  }
  return check.workflowName || "Unknown"
}

function checkSignature(check: StatusCheckRollup): string {
  const workflow = getCheckWorkflow(check)
  const name = getCheckName(check)
  return `${workflow}:${name}`
}

function getCurrentTime(): string {
  const now = new Date()
  const hours = String(now.getHours()).padStart(2, "0")
  const minutes = String(now.getMinutes()).padStart(2, "0")
  const seconds = String(now.getSeconds()).padStart(2, "0")
  return `${hours}:${minutes}:${seconds}`
}

function extractActionsJobDetails(
  detailsUrl?: string,
): { owner: string; repo: string; jobId: string } | null {
  if (!detailsUrl) return null
  const match = detailsUrl.match(
    /github\.com\/([^/]+)\/([^/]+)\/actions\/runs\/\d+\/job\/(\d+)/,
  )
  if (!match) return null
  const [, owner, repo, jobId] = match
  return { owner, repo, jobId }
}

function extractJobId(detailsUrl?: string): string | null {
  const details = extractActionsJobDetails(detailsUrl)
  if (details) return details.jobId
  const match = detailsUrl?.match(/\/job\/(\d+)$/)
  return match ? match[1] : null
}

function getJobViewCommand(detailsUrl?: string): string | null {
  const jobId = extractJobId(detailsUrl)
  return jobId ? `gh run view --job=${jobId}` : null
}

function getAnnotationsCommand(detailsUrl?: string): string | null {
  const details = extractActionsJobDetails(detailsUrl)
  if (!details) return null
  const { owner, repo, jobId } = details
  return `gh api '/repos/${owner}/${repo}/check-runs/${jobId}/annotations'`
}

async function main() {
  const prNumber = execFileSync(
    "gh",
    ["pr", "view", "--json", "number", "-q", ".number"],
    { encoding: "utf-8" },
  ).trim()

  console.log(`🔍 Monitoring PR #${prNumber} checks...`)
  console.log("")

  const lastState: Record<string, CheckState> = {}
  let checkCount = 0
  let hasSeenChecks = false
  let waitingForChecksSince: number | null = null

  while (checkCount < MAX_CHECKS) {
    const checks = getCheckRuns()
    const now = Date.now()
    if (checks.length > 0) {
      hasSeenChecks = true
      waitingForChecksSince = null
    } else if (!hasSeenChecks && waitingForChecksSince === null) {
      waitingForChecksSince = now
    }
    const currentState: Record<string, CheckState> = {}

    // Build current state map
    for (const check of checks) {
      const sig = checkSignature(check)
      currentState[sig] = {
        status: getCheckStatus(check),
        conclusion: getCheckConclusion(check),
        workflow: getCheckWorkflow(check),
        name: getCheckName(check),
        completedAt: check.completedAt || check.startedAt || "",
        detailsUrl: check.detailsUrl,
      }
    }

    // Detect changes
    const changes: Change[] = []

    // Check for status changes
    for (const [sig, state] of Object.entries(currentState)) {
      if (!lastState[sig]) {
        // New check
        changes.push({
          type: "new",
          workflow: state.workflow,
          name: state.name,
          status: state.status,
          conclusion: state.conclusion,
          sig,
          detailsUrl: state.detailsUrl,
        })
      } else if (lastState[sig].status !== state.status) {
        // Status change
        changes.push({
          type: "change",
          workflow: state.workflow,
          name: state.name,
          from: lastState[sig].status,
          to: state.status,
          fromConclusion: lastState[sig].conclusion,
          toConclusion: state.conclusion,
          sig,
          detailsUrl: state.detailsUrl,
        })
      }
    }

    // Display changes
    if (changes.length > 0) {
      console.log(`[${getCurrentTime()}] Changes detected:`)
      for (const change of changes) {
        if (change.type === "new") {
          console.log(
            `  ${statusEmoji(change.status!, change.conclusion)} ${change.workflow} > ${change.name}`,
          )
          // Show job view command if failed
          if (change.conclusion === "FAILURE") {
            const cmd = getJobViewCommand(change.detailsUrl)
            if (cmd) {
              console.log(`     → ${cmd}`)
            }
            const annotationsCmd = getAnnotationsCommand(change.detailsUrl)
            if (annotationsCmd) {
              console.log(`     → ${annotationsCmd}`)
            }
          }
        } else if (change.type === "change") {
          const fromEmoji = statusEmoji(change.from!, change.fromConclusion)
          const toEmoji = statusEmoji(change.to!, change.toConclusion)
          console.log(
            `  ${fromEmoji} → ${toEmoji} ${change.workflow} > ${change.name}`,
          )
          // Show job view command if changed to failure
          if (change.toConclusion === "FAILURE") {
            const cmd = getJobViewCommand(change.detailsUrl)
            if (cmd) {
              console.log(`     → ${cmd}`)
            }
            const annotationsCmd = getAnnotationsCommand(change.detailsUrl)
            if (annotationsCmd) {
              console.log(`     → ${annotationsCmd}`)
            }
          }
        }
      }
      console.log("")
    }

    // Check if all done
    const byStatus = groupChecksByStatus(checks)
    const inProgress = byStatus["IN_PROGRESS"]?.length || 0
    const pending = byStatus["PENDING"]?.length || 0
    const queued = byStatus["QUEUED"]?.length || 0
    const unknown = byStatus["UNKNOWN"]?.length || 0

    if (inProgress + pending + queued + unknown === 0) {
      if (!hasSeenChecks) {
        const elapsed = now - (waitingForChecksSince ?? now)
        if (elapsed < CHECK_START_GRACE_PERIOD) {
          if (changes.length === 0) {
            const remaining = Math.ceil(
              (CHECK_START_GRACE_PERIOD - elapsed) / 1000,
            )
            console.log(
              `[${getCurrentTime()}] Waiting for checks to start... (${remaining}s)`,
            )
          }
          Object.assign(lastState, currentState)
          checkCount += 1
          await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL))
          continue
        }
      }
      console.log(`[${getCurrentTime()}] ✅ All checks complete!`)
      console.log("")

      // Summary
      for (const [status, statusChecks] of Object.entries(byStatus)) {
        if (status === "COMPLETED") {
          continue
        }

        const byConclusion: Record<string, StatusCheckRollup[]> = {}
        for (const check of statusChecks) {
          const conclusion = getCheckConclusion(check)
          if (!byConclusion[conclusion]) {
            byConclusion[conclusion] = []
          }
          byConclusion[conclusion].push(check)
        }

        for (const [conclusion, group] of Object.entries(byConclusion)) {
          console.log(`${status}: ${conclusion} (${group.length})`)
        }
      }

      const completed = byStatus["COMPLETED"] || []
      const byConclusion: Record<string, StatusCheckRollup[]> = {}
      for (const check of completed) {
        const conclusion = getCheckConclusion(check)
        if (!byConclusion[conclusion]) {
          byConclusion[conclusion] = []
        }
        byConclusion[conclusion].push(check)
      }

      for (const [conclusion, group] of Object.entries(byConclusion)) {
        const emoji =
          conclusion === "SUCCESS"
            ? "✅"
            : conclusion === "SKIPPED"
              ? "⊘"
              : "❌"
        console.log(`${emoji} ${conclusion}: ${group.length}`)
      }

      break
    }

    // Display current summary every check
    if (changes.length === 0) {
      console.log(
        `[${getCurrentTime()}] Waiting... (In Progress: ${inProgress}, Pending: ${pending}, Queued: ${queued}, Unknown: ${unknown})`,
      )
    }

    Object.assign(lastState, currentState)
    checkCount += 1
    await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL))
  }

  if (checkCount >= MAX_CHECKS) {
    console.error(`❌ Timeout waiting for checks (${MAX_CHECKS} checks)`)
    process.exit(1)
  }
}

await main()
