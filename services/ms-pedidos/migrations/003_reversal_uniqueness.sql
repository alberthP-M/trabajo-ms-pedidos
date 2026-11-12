CREATE UNIQUE INDEX IF NOT EXISTS one_reversal_command_per_order
ON outbox(aggregate_id, event_type)
WHERE event_type = 'ReversionSolicitada';
