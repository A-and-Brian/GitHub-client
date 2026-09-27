import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { RateLimits } from "../github/rate-limit"
import { Poller, type PollJob } from "./poller"

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

function job(overrides: Partial<PollJob> = {}) {
  const run = vi.fn(async () => undefined as number | undefined)
  return { run, job: { key: "k", activeMs: 1_000, idleMs: 10_000, run, ...overrides } }
}

test("background jobs poll at the idle interval, watched jobs at the active one", async () => {
  const poller = new Poller(new RateLimits())
  const { run, job: j } = job()
  poller.register(j)
  await vi.advanceTimersByTimeAsync(0)
  expect(run).toHaveBeenCalledTimes(1)

  await vi.advanceTimersByTimeAsync(9_000)
  expect(run).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1_000)
  expect(run).toHaveBeenCalledTimes(2)

  const release = poller.watch(j)
  await vi.advanceTimersByTimeAsync(3_000)
  expect(run).toHaveBeenCalledTimes(5)

  release()
  await vi.advanceTimersByTimeAsync(3_000)
  expect(run).toHaveBeenCalledTimes(5)
  poller.stop()
})

test("watch-only jobs stop when the last watcher releases", async () => {
  const poller = new Poller(new RateLimits())
  const { run, job: j } = job({ idleMs: Number.POSITIVE_INFINITY })
  const release = poller.watch(j)
  await vi.advanceTimersByTimeAsync(2_500)
  expect(run).toHaveBeenCalledTimes(3)
  release()
  await vi.advanceTimersByTimeAsync(10_000)
  expect(run).toHaveBeenCalledTimes(3)
  expect(poller.status("k")).toBeUndefined()
})

test("the server poll interval is a lower bound", async () => {
  const poller = new Poller(new RateLimits())
  const { run, job: j } = job({ idleMs: Number.POSITIVE_INFINITY })
  run.mockResolvedValue(5)
  poller.watch(j)
  await vi.advanceTimersByTimeAsync(4_000)
  expect(run).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1_000)
  expect(run).toHaveBeenCalledTimes(2)
  poller.stop()
})

test("failures back off and are reported", async () => {
  const poller = new Poller(new RateLimits())
  const { run, job: j } = job({ idleMs: Number.POSITIVE_INFINITY })
  run.mockRejectedValue(new Error("boom"))
  poller.watch(j)
  await vi.advanceTimersByTimeAsync(0)
  expect(poller.status("k")?.error).toEqual(new Error("boom"))
  await vi.advanceTimersByTimeAsync(1_999)
  expect(run).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(run).toHaveBeenCalledTimes(2)
  poller.stop()
})

test("jobs wait while their rate limit is exhausted", async () => {
  const limits = new RateLimits()
  vi.setSystemTime(0)
  limits.update(
    new Headers({
      "X-RateLimit-Resource": "graphql",
      "X-RateLimit-Limit": "5000",
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": "60",
    }),
  )
  const poller = new Poller(limits)
  const { run, job: j } = job({ resource: "graphql", idleMs: Number.POSITIVE_INFINITY })
  poller.watch(j)
  await vi.advanceTimersByTimeAsync(59_000)
  expect(run).not.toHaveBeenCalled()
  poller.stop()
})

test("refresh requested during a run gets a fresh pass after it", async () => {
  const poller = new Poller(new RateLimits())
  const { run, job: j } = job()
  let releaseFirst!: () => void
  let releaseSecond!: () => void
  run
    .mockImplementationOnce(
      () => new Promise<undefined>((resolve) => (releaseFirst = () => resolve(undefined))),
    )
    .mockImplementationOnce(
      () => new Promise<undefined>((resolve) => (releaseSecond = () => resolve(undefined))),
    )
  poller.watch(j)

  const first = poller.refresh("k")
  const refreshes = Promise.all([poller.refresh("k"), poller.refresh("k")])
  expect(run).toHaveBeenCalledTimes(1)

  releaseFirst()
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2))
  const nextRefresh = poller.refresh("k")
  releaseSecond()
  await Promise.all([first, refreshes, nextRefresh])
  expect(run).toHaveBeenCalledTimes(3)

  poller.stop()
})
