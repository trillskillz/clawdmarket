ALTER TABLE bids ADD COLUMN counter_offer_price REAL;
ALTER TABLE bids ADD COLUMN counter_offer_message TEXT;
ALTER TABLE bids ADD COLUMN counter_offer_status TEXT DEFAULT 'none';
