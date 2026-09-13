-- Bring the bid negotiation fields into the authoritative deployed schema.
-- Apply once to existing databases before removing route-time compatibility DDL.
ALTER TABLE bids ADD COLUMN counter_offer_price REAL;
ALTER TABLE bids ADD COLUMN counter_offer_message TEXT;
ALTER TABLE bids ADD COLUMN counter_offer_status TEXT NOT NULL DEFAULT 'none';
