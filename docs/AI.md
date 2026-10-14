# AI provider setup (optional)

The app works without any AI: rule-based parsing, scoring and template drafts are the baseline. AI only (a) refines extraction, (b) writes a short fit analysis, (c) writes a more natural email draft.

| `AI_PROVIDER` | Behaviour |
|---|---|
| `mock` (default) | Offline stand-in. No network. Analysis/draft are built from the rule-based results and labelled as mock. |
| `none` | AI fully disabled. |
| `gemini` | Google Gemini REST API. Set `AI_API_KEY`; `AI_MODEL` (default `gemini-2.0-flash`; use any model your key supports). |
| `openai-compatible` | Any `/chat/completions` API (OpenAI, OpenRouter, local Ollama/LM Studio via `AI_BASE_URL`). Set `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`. |

Free tiers: some providers offer free quotas, but plans, limits and data-use terms change — check the provider's current page. Nothing here promises AI is free. When quota runs out the app falls back to rule-based results and shows `AI unavailable (quota)`.

Cost/privacy controls: `AI_MAX_INPUT_CHARS` (default 6000, text is clipped), `AI_DAILY_CALL_CAP` (default 200/day), per-user toggle "Use AI when configured" in Preferences, AI only runs for posts the rule-based filter already flags as jobs, and analysis only for jobs that pass your filters.

**Privacy warning:** with a real provider, job-post text and CV text are sent to that provider. The Integrations page shows a warning whenever this is active. Prompts treat posts/CV as untrusted data (prompt-injection mitigation) and AI-extracted facts are accepted only if they literally appear in the post. Keys live only in backend/worker env vars.
