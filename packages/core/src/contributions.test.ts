import { describe, expect, it, vi } from "vitest"
import { CONTRIBUTIONS_QUERY, Contributions } from "./contributions"
import type { GraphQLClient } from "./github/graphql"

const day = {
  date: "2025-09-25",
  weekday: 4,
  contributionCount: 3,
  contributionLevel: "SECOND_QUARTILE",
}
const result = {
  viewer: {
    contributionsCollection: { contributionCalendar: { weeks: [{ contributionDays: [day] }] } },
  },
}

function client(query: ReturnType<typeof vi.fn>) {
  return { query } as unknown as GraphQLClient
}

describe("Contributions", () => {
  it("queries the trailing year and preserves GitHub date strings", async () => {
    const query = vi.fn().mockResolvedValue(result)
    const contributions = new Contributions(client(query), () => Date.parse("2025-09-26T10:30:00Z"))

    await contributions.load("yi")

    expect(query).toHaveBeenCalledWith(CONTRIBUTIONS_QUERY, {
      from: "2024-09-26T10:30:00.000Z",
      to: "2025-09-26T10:30:00.000Z",
    })
    expect(contributions.snapshot().calendar?.weeks[0]?.contributionDays[0]?.date).toBe(
      "2025-09-25",
    )
  })

  it("reuses a fresh snapshot, refreshes after an hour, and coalesces requests", async () => {
    let now = 1_000_000
    let resolve!: (value: typeof result) => void
    const query = vi.fn(
      () =>
        new Promise<typeof result>((done) => {
          resolve = done
        }),
    )
    const contributions = new Contributions(client(query), () => now)

    const first = contributions.load("yi")
    const same = contributions.load("yi")
    expect(same).toBe(first)
    expect(query).toHaveBeenCalledTimes(1)
    resolve(result)
    await first
    await contributions.load("yi")
    expect(query).toHaveBeenCalledTimes(1)

    now += 60 * 60 * 1000
    const refresh = contributions.load("yi")
    expect(query).toHaveBeenCalledTimes(2)
    resolve(result)
    await refresh
  })

  it("retains an error state and retries successfully", async () => {
    const query = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(result)
    const contributions = new Contributions(client(query))

    await contributions.load("yi")
    expect(contributions.snapshot()).toMatchObject({ status: "error", error: "offline" })
    await contributions.load("yi", true)
    expect(contributions.snapshot()).toMatchObject({
      status: "ready",
      calendar: result.viewer.contributionsCollection.contributionCalendar,
    })
  })

  it("drops prior-account responses after account change or reset", async () => {
    const otherResult = structuredClone(result)
    otherResult.viewer.contributionsCollection.contributionCalendar.weeks[0]!
      .contributionDays[0]!.contributionCount = 9
    let resolveFirst!: (value: typeof result) => void
    const query = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<typeof result>((done) => {
            resolveFirst = done
          }),
      )
      .mockResolvedValueOnce(otherResult)
    const contributions = new Contributions(client(query))

    const first = contributions.load("yi")
    await contributions.load("other")
    resolveFirst(result)
    await first
    expect(contributions.snapshot()).toMatchObject({
      status: "ready",
      calendar: otherResult.viewer.contributionsCollection.contributionCalendar,
    })

    let resolvePending!: (value: typeof result) => void
    query.mockImplementationOnce(
      () =>
        new Promise<typeof result>((done) => {
          resolvePending = done
        }),
    )
    const pending = contributions.load("other", true)
    contributions.reset()
    resolvePending(result)
    await pending
    expect(contributions.snapshot()).toEqual({ status: "idle" })
  })
  it("keeps the last successful snapshot labeled as an error after refresh fails", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(result)
      .mockRejectedValueOnce(new Error("rate limited"))
    const contributions = new Contributions(client(query), () => 1234)
    await contributions.load("yi")
    await contributions.load("yi", true)
    expect(contributions.snapshot()).toMatchObject({
      status: "error",
      fetchedAt: 1234,
      error: "rate limited",
      calendar: result.viewer.contributionsCollection.contributionCalendar,
    })
  })

  it("does not turn malformed calendar data into zero activity", async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ viewer: { contributionsCollection: { contributionCalendar: null } } })
    const contributions = new Contributions(client(query))
    await contributions.load("yi")
    expect(contributions.snapshot()).toMatchObject({ status: "error" })
    expect(contributions.snapshot().calendar).toBeUndefined()
  })
})
