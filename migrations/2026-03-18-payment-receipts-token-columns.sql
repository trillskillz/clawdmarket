ALTER TABLE payment_receipts ADD COLUMN token_address text;
ALTER TABLE payment_receipts ADD COLUMN chain_id integer;
ALTER TABLE payment_receipts ADD COLUMN token_symbol text;
ALTER TABLE payment_receipts ADD COLUMN token_amount text;
ALTER TABLE payment_receipts ADD COLUMN usd_value_at_payment real;
