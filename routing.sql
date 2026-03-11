INSERT INTO routing_configs (
  id,
  client_id,
  provider,
  active,
  call_within_seconds,
  instructions,
  created_at,
  updated_at
)
VALUES (
  gen_random_uuid(),
  'a11f9e96-708f-4173-90c4-46c43b408671',
  'VAPI',
  true,
  60,
  'Test outbound AI call',
  NOW(),
  NOW()
);