import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

export function useFocusedRecord<T>({
  queryKeys,
  records,
  getMatchValue,
  onFound,
}: {
  queryKeys: string[];
  records: T[];
  getMatchValue: (record: T, queryKey: string) => string | null | undefined;
  onFound: (record: T, queryKey: string, value: string) => void;
}) {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (!records.length) return;
    for (const queryKey of queryKeys) {
      const value = searchParams.get(queryKey);
      if (!value) continue;
      const match = records.find((record) => getMatchValue(record, queryKey) === value);
      if (match) onFound(match, queryKey, value);
      return;
    }
  }, [getMatchValue, onFound, queryKeys, records, searchParams]);
}
