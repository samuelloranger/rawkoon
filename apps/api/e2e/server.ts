// Worker-less e2e server entry — ONE of only two files that import the framework.
// Started via: bun --preload ./e2e/mocks/preload.ts ./e2e/server.ts
// The preload installs external mocks before this import; initWorkers()/app.listen()
// in src/index.ts are behind `if (import.meta.main)` so importing `app` here starts
// the listener WITHOUT any worker or scheduled job.
import { app } from "@rawkoon/api/index";
import { assertE2eDatabase } from "./boot";

assertE2eDatabase(process.env.DATABASE_URL ?? "");

const port = Number(process.env.E2E_PORT || 3111);
app.listen(port);
console.log(`e2e server listening on http://localhost:${port}`);
