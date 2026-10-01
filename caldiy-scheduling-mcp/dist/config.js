/**
 * config.ts — Environment + policy.yaml loading
 *
 * Validates all required env vars and the policy file with zod.
 * Fails fast on missing / invalid config (spec §3, §5).
 * Secrets are never logged.
 */
import { z } from "zod";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
// ---------------------------------------------------------------------------
// Env schema
// ---------------------------------------------------------------------------
const EnvSchema = z.object({
    CAL_API_URL: z.string().url(),
    CAL_API_KEY: z.string().min(1),
    MCP_PROFILE: z.enum(["public", "owner"]),
    MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
    MCP_HTTP_PORT: z.coerce.number().default(3333),
    MCP_HTTP_BEARER_TOKEN: z.string().optional(),
    POLICY_FILE: z.string().default("./policy.yaml"),
    DATA_DIR: z.string().default("./data"),
    DRY_RUN: z
        .string()
        .transform((v) => v === "true")
        .default("false"),
    NOTIFY_WEBHOOK_URL: z.string().url().optional(),
});
// ---------------------------------------------------------------------------
// Policy file schema (see spec §5)
// ---------------------------------------------------------------------------
const PriorityEnum = z.enum(["CRITICAL", "HIGH", "NORMAL", "LOW"]);
const PolicySchema = z.object({
    autonomy_level: z.number().int().min(0).max(4),
    timezone: z.string(),
    working_hours: z.record(z.union([z.string(), z.array(z.string())])),
    default_priority: PriorityEnum.default("NORMAL"),
    priority_rules: z
        .array(z.object({
        match: z.object({
            attendee_domain: z.string().optional(),
            event_type_slug: z.string().optional(),
            attendee_email: z.string().optional(),
            title_regex: z.string().optional(),
        }),
        priority: PriorityEnum,
    }))
        .default([]),
    displacement: z.object({
        matrix: z.record(z.record(z.enum(["auto", "approval", "deny"]))),
        max_displacements_per_plan: z.number().int().default(1),
        max_displacements_per_day: z.number().int().default(3),
        min_notice_hours: z.number().default(24),
        protect_external_attendees: z.boolean().default(true),
        max_reschedules_per_booking: z.number().int().default(2),
        alt_slot_search_days: z.number().int().default(7),
        alt_slot_strategy: z.enum(["earliest"]).default("earliest"),
    }),
    cancel: z.enum(["deny", "approval", "auto"]).default("deny"),
    public: z.object({
        expose_titles: z.boolean().default(false),
        allow_self_reschedule: z.boolean().default(true),
        allow_self_cancel: z.boolean().default(true),
    }),
    limits: z.object({
        tool_calls_per_minute: z.number().int().default(30),
        bookings_per_day_per_attendee: z.number().int().default(3),
    }),
    approval_ttl_minutes: z.number().int().default(60),
    plan_ttl_minutes: z.number().int().default(5),
});
// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------
export function loadConfig() {
    if (process.env.NODE_ENV !== "test") {
        try {
            const envFileContent = readFileSync(".env", "utf8");
            for (const line of envFileContent.split("\n")) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith("#"))
                    continue;
                const eqIdx = trimmed.indexOf("=");
                if (eqIdx !== -1) {
                    const key = trimmed.slice(0, eqIdx).trim();
                    const val = trimmed.slice(eqIdx + 1).trim();
                    if (key && !(key in process.env)) {
                        process.env[key] = val;
                    }
                }
            }
        }
        catch { }
    }
    const env = EnvSchema.parse(process.env);
    const rawPolicy = parseYaml(readFileSync(env.POLICY_FILE, "utf8"));
    const policy = PolicySchema.parse(rawPolicy);
    // HTTP transport requires a bearer token
    if (env.MCP_TRANSPORT === "http" && !env.MCP_HTTP_BEARER_TOKEN) {
        throw new Error("MCP_HTTP_BEARER_TOKEN is required when MCP_TRANSPORT=http");
    }
    return { ...env, policy };
}
//# sourceMappingURL=config.js.map