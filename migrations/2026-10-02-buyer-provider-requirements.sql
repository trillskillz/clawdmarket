-- Additive; legacy orders retain NULL rather than fabricated historical terms.
ALTER TABLE service_orders ADD COLUMN provider_requirements_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE service_orders ADD COLUMN execution_contract_json TEXT;
ALTER TABLE route_plans ADD COLUMN provider_requirements_json TEXT NOT NULL DEFAULT '{}';
