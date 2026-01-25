/*
  # Digital Switchboard - Initial Schema
  
  1. New Tables
    - `clients`
      - `id` (uuid, primary key)
      - `name` (text)
      - `status` (enum: ACTIVE, INACTIVE)
      - `timezone` (text, default "America/New_York")
      - `quietHoursStart` (text, default "20:00")
      - `quietHoursEnd` (text, default "08:00")
      - `createdAt` (timestamptz)
      - `updatedAt` (timestamptz)
    
    - `routing_configs`
      - `id` (uuid, primary key)
      - `clientId` (uuid, foreign key to clients)
      - `provider` (enum, default BLAND)
      - `active` (boolean)
      - `callWithinSeconds` (integer)
      - `instructions` (text)
      - `questions` (jsonb, nullable)
      - `transferNumber` (text, nullable)
      - `createdAt` (timestamptz)
      - `updatedAt` (timestamptz)
    
    - `leads`
      - `id` (uuid, primary key)
      - `clientId` (uuid, foreign key to clients)
      - `firstName` (text, nullable)
      - `lastName` (text, nullable)
      - `phone` (text, required)
      - `email` (text, nullable)
      - `source` (text, nullable)
      - `payloadJson` (jsonb)
      - `dedupeKey` (text, unique per client)
      - `callStatus` (enum)
      - `skipReason` (text, nullable)
      - `createdAt` (timestamptz)
    
    - `calls`
      - `id` (uuid, primary key)
      - `clientId` (uuid, foreign key to clients)
      - `leadId` (uuid, foreign key to leads)
      - `provider` (enum)
      - `providerCallId` (text, nullable, unique)
      - `status` (enum)
      - `outcome` (text, nullable)
      - `transcript` (text, nullable)
      - `recordingUrl` (text, nullable)
      - `rawProviderPayload` (jsonb, nullable)
      - `startedAt` (timestamptz, nullable)
      - `endedAt` (timestamptz, nullable)
      - `createdAt` (timestamptz)
    
    - `audit_logs`
      - `id` (uuid, primary key)
      - `clientId` (uuid, foreign key to clients, nullable)
      - `eventType` (text)
      - `message` (text)
      - `dataJson` (jsonb, nullable)
      - `createdAt` (timestamptz)
  
  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated admin access
*/

-- Create enums
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "CallProvider" AS ENUM ('BLAND');
CREATE TYPE "CallStatus" AS ENUM ('NEW', 'QUEUED', 'CALLING', 'COMPLETED', 'FAILED', 'SKIPPED');
CREATE TYPE "CallStatusEnum" AS ENUM ('CREATED', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- Create clients table
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  "quietHoursStart" TEXT NOT NULL DEFAULT '20:00',
  "quietHoursEnd" TEXT NOT NULL DEFAULT '08:00',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create routing_configs table
CREATE TABLE IF NOT EXISTS routing_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "clientId" UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  provider "CallProvider" NOT NULL DEFAULT 'BLAND',
  active BOOLEAN NOT NULL DEFAULT true,
  "callWithinSeconds" INTEGER NOT NULL DEFAULT 60,
  instructions TEXT NOT NULL,
  questions JSONB,
  "transferNumber" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create leads table
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "clientId" UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  "firstName" TEXT,
  "lastName" TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  source TEXT,
  "payloadJson" JSONB NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "callStatus" "CallStatus" NOT NULL DEFAULT 'NEW',
  "skipReason" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("clientId", "dedupeKey")
);

-- Create calls table
CREATE TABLE IF NOT EXISTS calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "clientId" UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  "leadId" UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  provider "CallProvider" NOT NULL DEFAULT 'BLAND',
  "providerCallId" TEXT UNIQUE,
  status "CallStatusEnum" NOT NULL DEFAULT 'CREATED',
  outcome TEXT,
  transcript TEXT,
  "recordingUrl" TEXT,
  "rawProviderPayload" JSONB,
  "startedAt" TIMESTAMPTZ,
  "endedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "clientId" UUID REFERENCES clients(id) ON DELETE CASCADE,
  "eventType" TEXT NOT NULL,
  message TEXT NOT NULL,
  "dataJson" JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_routing_configs_client ON routing_configs("clientId");
CREATE INDEX IF NOT EXISTS idx_leads_client ON leads("clientId");
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads("callStatus");
CREATE INDEX IF NOT EXISTS idx_calls_client ON calls("clientId");
CREATE INDEX IF NOT EXISTS idx_calls_lead ON calls("leadId");
CREATE INDEX IF NOT EXISTS idx_calls_provider_id ON calls("providerCallId");
CREATE INDEX IF NOT EXISTS idx_audit_logs_client ON audit_logs("clientId");
CREATE INDEX IF NOT EXISTS idx_audit_logs_event ON audit_logs("eventType");

-- Enable RLS
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users (admin access)
CREATE POLICY "Authenticated users can view clients"
  ON clients FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert clients"
  ON clients FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update clients"
  ON clients FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete clients"
  ON clients FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view routing configs"
  ON routing_configs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert routing configs"
  ON routing_configs FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update routing configs"
  ON routing_configs FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete routing configs"
  ON routing_configs FOR DELETE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can view leads"
  ON leads FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert leads"
  ON leads FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update leads"
  ON leads FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can view calls"
  ON calls FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert calls"
  ON calls FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update calls"
  ON calls FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can view audit logs"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert audit logs"
  ON audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);
