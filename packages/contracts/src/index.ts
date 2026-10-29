import { z } from 'zod';

export const eventEnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().min(1),
  schemaVersion: z.string().min(1),
  orderId: z.string().uuid(),
  correlationId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  payload: z.record(z.unknown()),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export const paymentRequestedSchema = eventEnvelopeSchema.extend({
  eventType: z.literal('CobroSolicitado'),
  payload: z.object({
    paymentToken: z.string().min(1),
    amountCents: z.number().int().positive(),
    currency: z.string().length(3),
  }),
});

export const paymentReversalRequestedSchema = eventEnvelopeSchema.extend({
  eventType: z.literal('ReversionSolicitada'),
  payload: z.object({
    paymentId: z.string().min(1),
    amountCents: z.number().int().positive(),
    currency: z.string().length(3),
  }),
});

export const paymentApprovedSchema = eventEnvelopeSchema.extend({
  eventType: z.literal('PagoAprobado'),
  payload: z.object({ paymentId: z.string().min(1), amountCents: z.number().int().positive(), currency: z.string().length(3) }),
});

export const paymentRejectedSchema = eventEnvelopeSchema.extend({
  eventType: z.literal('PagoRechazado'),
  payload: z.object({ reason: z.string().min(1), paymentId: z.string().optional(), amountCents: z.number().int().positive(), currency: z.string().length(3) }),
});

export const reversalResultSchema = eventEnvelopeSchema.extend({
  eventType: z.literal('ReversionResultado'),
  payload: z.object({ paymentId: z.string().min(1), reversed: z.boolean(), reason: z.string().optional() }),
});

export type PaymentCommand = z.infer<typeof paymentRequestedSchema> | z.infer<typeof paymentReversalRequestedSchema>;
export type PaymentResult = z.infer<typeof paymentApprovedSchema> | z.infer<typeof paymentRejectedSchema> | z.infer<typeof reversalResultSchema>;

export const TOPICS = {
  COMMANDS: 'payments.commands.v1',
  RESULTS: 'payments.results.v1',
} as const;
