import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      // Meaningful because connectivity.ts feeds focusManager from AppState:
      // foregrounding refetches whatever went stale while backgrounded.
      refetchOnWindowFocus: true,
    },
  },
});
