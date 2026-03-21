-- Baseline migration — marks existing schema as applied
-- Generated from schema.prisma for Railway deploy

CREATE TABLE IF NOT EXISTS "agencies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "users" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'AGENCY_ADMIN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");

CREATE TABLE IF NOT EXISTS "clients" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "quiet_hours_start" TEXT,
    "quiet_hours_end" TEXT,
    "ghl_location_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "clients_ghl_location_id_key" ON "clients"("ghl_location_id");

CREATE TABLE IF NOT EXISTS "routing_configs" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default',
    "provider" TEXT NOT NULL DEFAULT 'BLAND',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "call_within_seconds" INTEGER NOT NULL DEFAULT 60,
    "instructions" TEXT,
    "questions" JSONB,
    "transfer_number" TEXT,
    "telnyx_assistant_id" TEXT,
    "telnyx_phone_number" TEXT,
    "telnyx_app_id" TEXT,
    "bland_agent_id" TEXT,
    "vapi_assistant_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "routing_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "leads" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "source" TEXT,
    "payload_json" JSONB NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "call_status" TEXT NOT NULL DEFAULT 'NEW',
    "skip_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "leads_client_id_dedupe_key_key" ON "leads"("client_id", "dedupe_key");

CREATE TABLE IF NOT EXISTS "calls" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'BLAND',
    "provider_call_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "outcome" TEXT,
    "transcript" TEXT,
    "recording_url" TEXT,
    "raw_provider_payload" JSONB,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "calls_provider_call_id_key" ON "calls"("provider_call_id");

CREATE TABLE IF NOT EXISTS "bookings" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "business_name" TEXT,
    "city" TEXT,
    "appointment_date" TEXT,
    "appointment_time" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" TEXT NOT NULL,
    "client_id" TEXT,
    "event_type" TEXT NOT NULL DEFAULT 'SYSTEM',
    "message" TEXT NOT NULL,
    "data_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "users" ADD CONSTRAINT "users_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "clients" ADD CONSTRAINT "clients_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "routing_configs" ADD CONSTRAINT "routing_configs_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "leads" ADD CONSTRAINT "leads_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "calls" ADD CONSTRAINT "calls_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "calls" ADD CONSTRAINT "calls_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
