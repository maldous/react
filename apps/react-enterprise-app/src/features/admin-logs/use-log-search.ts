import { useQuery } from "@tanstack/react-query";
import { searchLogs, type LogSearchFilters, type LogSearchResult } from "./admin-logs-client";

// Operator-triggered search. The query runs only once `filters` is non-null
// (i.e. after the operator submits the form or opens a filtered URL), never on
// every keystroke. The filters object (with start/end captured at trigger time)
// is the query key, so identical searches are cached and time bounds are stable.
export function useLogSearch(filters: LogSearchFilters | null) {
  return useQuery<LogSearchResult, Error>({
    queryKey: ["admin-logs", filters],
    queryFn: () => searchLogs(filters as LogSearchFilters),
    enabled: filters !== null,
    retry: false,
  });
}
