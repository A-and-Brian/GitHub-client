import type { GraphQLClient } from "./github/graphql"

export const CONTRIBUTIONS_QUERY = `
  query Contributions($from: DateTime!, $to: DateTime!) {
    viewer {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          weeks {
            contributionDays { date weekday contributionCount contributionLevel }
          }
        }
      }
    }
  }
`

export interface ContributionDay {
  date: string
  weekday: number
  contributionCount: number
  contributionLevel: string
}

export interface ContributionCalendarData {
  weeks: Array<{ contributionDays: ContributionDay[] }>
}

export interface ContributionState {
  status: "idle" | "loading" | "ready" | "error"
  calendar?: ContributionCalendarData
  fetchedAt?: number
  error?: string
}

const FRESH_FOR_MS = 60 * 60 * 1000

function trailingYear(now: Date): { from: string; to: string } {
  const to = new Date(now)
  const from = new Date(to)
  from.setUTCFullYear(from.getUTCFullYear() - 1)
  return { from: from.toISOString(), to: to.toISOString() }
}

function isCalendar(value: unknown): value is ContributionCalendarData {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as ContributionCalendarData).weeks)
  )
    return false
  return (value as ContributionCalendarData).weeks.every(
    (week) =>
      week &&
      Array.isArray(week.contributionDays) &&
      week.contributionDays.every(
        (day) =>
          day &&
          /^\d{4}-\d{2}-\d{2}$/.test(day.date) &&
          Number.isInteger(day.weekday) &&
          day.weekday >= 0 &&
          day.weekday <= 6 &&
          Number.isInteger(day.contributionCount) &&
          day.contributionCount >= 0 &&
          typeof day.contributionLevel === "string",
      ),
  )
}

export class Contributions {
  private readonly graphql: GraphQLClient
  private readonly now: () => number
  private account?: string
  private generation = 0
  private state: ContributionState = { status: "idle" }
  private inFlight?: Promise<void>
  private listeners = new Set<() => void>()

  constructor(graphql: GraphQLClient, now = Date.now) {
    this.graphql = graphql
    this.now = now
  }

  snapshot = (): ContributionState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Loads the signed-in viewer's contribution calendar, reusing a fresh snapshot for one hour. */
  load(account: string, force = false): Promise<void> {
    if (this.account !== account) {
      this.account = account
      this.generation++
      this.inFlight = undefined
      this.state = { status: "idle" }
      this.emit()
    }
    if (this.inFlight) return this.inFlight
    if (
      !force &&
      this.state.calendar &&
      this.state.fetchedAt !== undefined &&
      this.now() - this.state.fetchedAt < FRESH_FOR_MS
    )
      return Promise.resolve()

    const generation = this.generation
    const existing = this.state
    this.state = { ...existing, status: "loading", error: undefined }
    this.emit()
    const range = trailingYear(new Date(this.now()))
    const request = this.graphql
      .query<{
        viewer: { contributionsCollection: { contributionCalendar: ContributionCalendarData } }
      }>(CONTRIBUTIONS_QUERY, range)
      .then(({ viewer }) => {
        if (generation !== this.generation || account !== this.account) return
        const calendar = viewer.contributionsCollection.contributionCalendar
        if (!isCalendar(calendar))
          throw new Error("GitHub returned an invalid contribution calendar")
        this.state = {
          status: "ready",
          calendar,
          fetchedAt: this.now(),
        }
        this.emit()
      })
      .catch((error: unknown) => {
        if (generation !== this.generation || account !== this.account) return
        this.state = {
          ...existing,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }
        this.emit()
      })
      .finally(() => {
        if (generation === this.generation && this.inFlight === request) this.inFlight = undefined
      })
    this.inFlight = request
    return request
  }

  /** Drops account-owned memory and makes any pending response obsolete. */
  reset(): void {
    this.generation++
    this.account = undefined
    this.inFlight = undefined
    this.state = { status: "idle" }
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}
