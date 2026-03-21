-- Add missing columns and tables added to schema after initial deploy

-- Create bookings table if it doesn't exist yet
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
    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bookings_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RoutingConfig: name field
ALTER TABLE "routing_configs" ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL DEFAULT 'Default';

-- RoutingConfig: provider-agnostic fields
ALTER TABLE "routing_configs" ADD COLUMN IF NOT EXISTS "bland_agent_id" TEXT;
ALTER TABLE "routing_configs" ADD COLUMN IF NOT EXISTS "vapi_assistant_id" TEXT;

-- Client: agency scoping
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "agency_id" TEXT REFERENCES "agencies"("id") ON DELETE SET NULL;
