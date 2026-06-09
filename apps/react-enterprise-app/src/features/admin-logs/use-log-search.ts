import { useMutation } from "@tanstack/react-query";
import { searchLogs, type LogSearchFilters, type LogSearchResult } from "./admin-logs-client";

// Explicit, operator-triggered search (a mutation, not a background query):
// results refresh only when the operator submits the filter form.
export function useLogSearch() {
  return useMutation<LogSearchResult, Error, LogSearchFilters>({
    mutationFn: searchLogs,
  });
}
