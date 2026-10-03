ALTER TABLE evm_payment_intents ADD COLUMN buyer_operation_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS evm_payment_intents_buyer_operation_idx ON evm_payment_intents(buyer_operation_id);
