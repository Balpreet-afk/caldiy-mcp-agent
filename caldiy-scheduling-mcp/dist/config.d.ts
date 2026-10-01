/**
 * config.ts — Environment + policy.yaml loading
 *
 * Validates all required env vars and the policy file with zod.
 * Fails fast on missing / invalid config (spec §3, §5).
 * Secrets are never logged.
 */
import { z } from "zod";
declare const EnvSchema: z.ZodObject<{
    CAL_API_URL: z.ZodString;
    CAL_API_KEY: z.ZodString;
    MCP_PROFILE: z.ZodEnum<["public", "owner"]>;
    MCP_TRANSPORT: z.ZodDefault<z.ZodEnum<["stdio", "http"]>>;
    MCP_HTTP_PORT: z.ZodDefault<z.ZodNumber>;
    MCP_HTTP_BEARER_TOKEN: z.ZodOptional<z.ZodString>;
    POLICY_FILE: z.ZodDefault<z.ZodString>;
    DATA_DIR: z.ZodDefault<z.ZodString>;
    DRY_RUN: z.ZodDefault<z.ZodEffects<z.ZodString, boolean, string>>;
    NOTIFY_WEBHOOK_URL: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    CAL_API_URL: string;
    CAL_API_KEY: string;
    MCP_PROFILE: "public" | "owner";
    MCP_TRANSPORT: "stdio" | "http";
    MCP_HTTP_PORT: number;
    POLICY_FILE: string;
    DATA_DIR: string;
    DRY_RUN: boolean;
    MCP_HTTP_BEARER_TOKEN?: string | undefined;
    NOTIFY_WEBHOOK_URL?: string | undefined;
}, {
    CAL_API_URL: string;
    CAL_API_KEY: string;
    MCP_PROFILE: "public" | "owner";
    MCP_TRANSPORT?: "stdio" | "http" | undefined;
    MCP_HTTP_PORT?: number | undefined;
    MCP_HTTP_BEARER_TOKEN?: string | undefined;
    POLICY_FILE?: string | undefined;
    DATA_DIR?: string | undefined;
    DRY_RUN?: string | undefined;
    NOTIFY_WEBHOOK_URL?: string | undefined;
}>;
declare const PriorityEnum: z.ZodEnum<["CRITICAL", "HIGH", "NORMAL", "LOW"]>;
declare const PolicySchema: z.ZodObject<{
    autonomy_level: z.ZodNumber;
    timezone: z.ZodString;
    working_hours: z.ZodRecord<z.ZodString, z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>>;
    default_priority: z.ZodDefault<z.ZodEnum<["CRITICAL", "HIGH", "NORMAL", "LOW"]>>;
    priority_rules: z.ZodDefault<z.ZodArray<z.ZodObject<{
        match: z.ZodObject<{
            attendee_domain: z.ZodOptional<z.ZodString>;
            event_type_slug: z.ZodOptional<z.ZodString>;
            attendee_email: z.ZodOptional<z.ZodString>;
            title_regex: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            attendee_domain?: string | undefined;
            event_type_slug?: string | undefined;
            attendee_email?: string | undefined;
            title_regex?: string | undefined;
        }, {
            attendee_domain?: string | undefined;
            event_type_slug?: string | undefined;
            attendee_email?: string | undefined;
            title_regex?: string | undefined;
        }>;
        priority: z.ZodEnum<["CRITICAL", "HIGH", "NORMAL", "LOW"]>;
    }, "strip", z.ZodTypeAny, {
        match: {
            attendee_domain?: string | undefined;
            event_type_slug?: string | undefined;
            attendee_email?: string | undefined;
            title_regex?: string | undefined;
        };
        priority: "CRITICAL" | "HIGH" | "NORMAL" | "LOW";
    }, {
        match: {
            attendee_domain?: string | undefined;
            event_type_slug?: string | undefined;
            attendee_email?: string | undefined;
            title_regex?: string | undefined;
        };
        priority: "CRITICAL" | "HIGH" | "NORMAL" | "LOW";
    }>, "many">>;
    displacement: z.ZodObject<{
        matrix: z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodEnum<["auto", "approval", "deny"]>>>;
        max_displacements_per_plan: z.ZodDefault<z.ZodNumber>;
        max_displacements_per_day: z.ZodDefault<z.ZodNumber>;
        min_notice_hours: z.ZodDefault<z.ZodNumber>;
        protect_external_attendees: z.ZodDefault<z.ZodBoolean>;
        max_reschedules_per_booking: z.ZodDefault<z.ZodNumber>;
        alt_slot_search_days: z.ZodDefault<z.ZodNumber>;
        alt_slot_strategy: z.ZodDefault<z.ZodEnum<["earliest"]>>;
    }, "strip", z.ZodTypeAny, {
        matrix: Record<string, Record<string, "auto" | "approval" | "deny">>;
        max_displacements_per_plan: number;
        max_displacements_per_day: number;
        min_notice_hours: number;
        protect_external_attendees: boolean;
        max_reschedules_per_booking: number;
        alt_slot_search_days: number;
        alt_slot_strategy: "earliest";
    }, {
        matrix: Record<string, Record<string, "auto" | "approval" | "deny">>;
        max_displacements_per_plan?: number | undefined;
        max_displacements_per_day?: number | undefined;
        min_notice_hours?: number | undefined;
        protect_external_attendees?: boolean | undefined;
        max_reschedules_per_booking?: number | undefined;
        alt_slot_search_days?: number | undefined;
        alt_slot_strategy?: "earliest" | undefined;
    }>;
    cancel: z.ZodDefault<z.ZodEnum<["deny", "approval", "auto"]>>;
    public: z.ZodObject<{
        expose_titles: z.ZodDefault<z.ZodBoolean>;
        allow_self_reschedule: z.ZodDefault<z.ZodBoolean>;
        allow_self_cancel: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        expose_titles: boolean;
        allow_self_reschedule: boolean;
        allow_self_cancel: boolean;
    }, {
        expose_titles?: boolean | undefined;
        allow_self_reschedule?: boolean | undefined;
        allow_self_cancel?: boolean | undefined;
    }>;
    limits: z.ZodObject<{
        tool_calls_per_minute: z.ZodDefault<z.ZodNumber>;
        bookings_per_day_per_attendee: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        tool_calls_per_minute: number;
        bookings_per_day_per_attendee: number;
    }, {
        tool_calls_per_minute?: number | undefined;
        bookings_per_day_per_attendee?: number | undefined;
    }>;
    approval_ttl_minutes: z.ZodDefault<z.ZodNumber>;
    plan_ttl_minutes: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    public: {
        expose_titles: boolean;
        allow_self_reschedule: boolean;
        allow_self_cancel: boolean;
    };
    autonomy_level: number;
    timezone: string;
    working_hours: Record<string, string | string[]>;
    default_priority: "CRITICAL" | "HIGH" | "NORMAL" | "LOW";
    priority_rules: {
        match: {
            attendee_domain?: string | undefined;
            event_type_slug?: string | undefined;
            attendee_email?: string | undefined;
            title_regex?: string | undefined;
        };
        priority: "CRITICAL" | "HIGH" | "NORMAL" | "LOW";
    }[];
    displacement: {
        matrix: Record<string, Record<string, "auto" | "approval" | "deny">>;
        max_displacements_per_plan: number;
        max_displacements_per_day: number;
        min_notice_hours: number;
        protect_external_attendees: boolean;
        max_reschedules_per_booking: number;
        alt_slot_search_days: number;
        alt_slot_strategy: "earliest";
    };
    cancel: "auto" | "approval" | "deny";
    limits: {
        tool_calls_per_minute: number;
        bookings_per_day_per_attendee: number;
    };
    approval_ttl_minutes: number;
    plan_ttl_minutes: number;
}, {
    public: {
        expose_titles?: boolean | undefined;
        allow_self_reschedule?: boolean | undefined;
        allow_self_cancel?: boolean | undefined;
    };
    autonomy_level: number;
    timezone: string;
    working_hours: Record<string, string | string[]>;
    displacement: {
        matrix: Record<string, Record<string, "auto" | "approval" | "deny">>;
        max_displacements_per_plan?: number | undefined;
        max_displacements_per_day?: number | undefined;
        min_notice_hours?: number | undefined;
        protect_external_attendees?: boolean | undefined;
        max_reschedules_per_booking?: number | undefined;
        alt_slot_search_days?: number | undefined;
        alt_slot_strategy?: "earliest" | undefined;
    };
    limits: {
        tool_calls_per_minute?: number | undefined;
        bookings_per_day_per_attendee?: number | undefined;
    };
    default_priority?: "CRITICAL" | "HIGH" | "NORMAL" | "LOW" | undefined;
    priority_rules?: {
        match: {
            attendee_domain?: string | undefined;
            event_type_slug?: string | undefined;
            attendee_email?: string | undefined;
            title_regex?: string | undefined;
        };
        priority: "CRITICAL" | "HIGH" | "NORMAL" | "LOW";
    }[] | undefined;
    cancel?: "auto" | "approval" | "deny" | undefined;
    approval_ttl_minutes?: number | undefined;
    plan_ttl_minutes?: number | undefined;
}>;
export type Priority = z.infer<typeof PriorityEnum>;
export type Policy = z.infer<typeof PolicySchema>;
export type Config = z.infer<typeof EnvSchema> & {
    policy: Policy;
};
export declare function loadConfig(): Config;
export {};
//# sourceMappingURL=config.d.ts.map