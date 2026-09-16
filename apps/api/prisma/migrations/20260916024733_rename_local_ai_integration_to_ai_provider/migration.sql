-- The integration is no longer local-only: it takes an API key and talks to
-- hosted OpenAI-compatible providers as well as llama.cpp/Ollama.
UPDATE "integrations" SET "type" = 'ai-provider' WHERE "type" = 'local-ai';
