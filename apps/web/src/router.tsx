import { createRouter } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";

export const router = createRouter({
  routeTree,
  context: {
    queryClient: undefined!,
  },
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
