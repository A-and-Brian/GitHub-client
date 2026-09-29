import { eq } from "@tanstack/db"
import { useLiveQuery } from "@tanstack/react-db"
import { useMemo } from "react"
import { useSession } from "@/app/client"
import { showError } from "@/app/errors"

/** Viewed markers belong to the signed-in account and the exact reviewed head. */
export function useViewedFiles(prKey: string, headOid: string) {
  const { client } = useSession()
  const rows = useLiveQuery(
    (q) =>
      q
        .from({ row: client.collections.viewedFiles.collection })
        .where(({ row }) => eq(row.prKey, prKey))
        .where(({ row }) => eq(row.headOid, headOid)),
    [client, prKey, headOid],
  ).data
  const viewed = useMemo(() => new Set(rows.map((row) => row.path)), [rows])
  const toggle = (path: string) => {
    const row = rows.find((row) => row.path === path)
    const operation = row
      ? client.collections.viewedFiles.collection.delete(row.key)
      : client.collections.viewedFiles.collection.insert({
          key: JSON.stringify([prKey, headOid, path]),
          prKey,
          headOid,
          path,
        })
    void operation.isPersisted.promise.catch((error) =>
      showError("Could not save viewed file", error),
    )
  }
  return { viewed, toggle }
}
