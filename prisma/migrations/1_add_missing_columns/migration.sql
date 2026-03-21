-- Add missing columns that were added to schema after initial deploy

-- RoutingConfig: name field
ALTER TABLE "routing_configs" ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL DEFAULT 'Default';

-- RoutingConfig: provider-agnostic fields
ALTER TABLE "routing_configs" ADD COLUMN IF NOT EXISTS "bland_agent_id" TEXT;
ALTER TABLE "routing_configs" ADD COLUMN IF NOT EXISTS "vapi_assistant_id" TEXT;

-- Booking: business fields added post-launch
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "business_name" TEXT;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "city" TEXT;

-- Client: agency scoping
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "agency_id" TEXT REFERENCES "agencies"("id") ON DELETE SET NULL;
