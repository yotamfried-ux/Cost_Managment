import type { LedgerRepository } from "./repository";

export interface Money {
  minor: number;
  currency: string;
}

export interface ProviderEvent {
  id: string;
  resourceId: string;
  type: string;
  occurredAt: string;
}

export interface PaymentProvider {
  readonly providerId: string;
  createCheckout(input: { orderId: string; money: Money; idempotencyKey: string }): Promise<{ id: string; url: URL }>;
  fetchPayment(id: string): Promise<{ id: string; state: "pending" | "settled" | "failed" | "refunded"; money: Money }>;
  refund(input: { paymentId: string; money: Money; idempotencyKey: string }): Promise<{ id: string }>;
  verifyWebhook(payload: Uint8Array, headers: Headers): Promise<ProviderEvent>;
}

export interface OfficialDocument {
  id: string;
  number: string;
  paymentId: string;
}

export interface InvoiceProvider {
  readonly providerId: string;
  issueDocument(input: { paymentId: string; customerId: string; money: Money; idempotencyKey: string }): Promise<OfficialDocument>;
  fetchDocument(id: string): Promise<OfficialDocument>;
  fetchPdf(id: string): Promise<Uint8Array>;
  verifyWebhook(payload: Uint8Array, headers: Headers): Promise<ProviderEvent>;
}

export class PaymentsDisabled extends Error {
  constructor() { super("Payment and invoice issuance are disabled"); }
}

async function disabled(): Promise<never> { throw new PaymentsDisabled(); }

export const nullPayment: PaymentProvider = {
  providerId: "disabled", createCheckout: disabled, fetchPayment: disabled, refund: disabled, verifyWebhook: disabled,
};
export const nullInvoice: InvoiceProvider = {
  providerId: "disabled", issueDocument: disabled, fetchDocument: disabled, fetchPdf: disabled, verifyWebhook: disabled,
};

export class ProviderRegistry {
  constructor(
    private readonly payments: ReadonlyMap<string, PaymentProvider> = new Map(),
    private readonly invoices: ReadonlyMap<string, InvoiceProvider> = new Map(),
  ) {}

  payment(id?: string) { return id ? this.payments.get(id) ?? nullPayment : nullPayment; }
  invoice(id?: string) { return id ? this.invoices.get(id) ?? nullInvoice : nullInvoice; }
}

export interface WebhookInbox {
  enqueueOnce(scope: { organizationId: string; providerId: string; kind: "payment" | "invoice" }, event: ProviderEvent): Promise<boolean>;
}

export async function receiveVerifiedEvent(
  inbox: WebhookInbox,
  organizationId: string,
  kind: "payment" | "invoice",
  provider: PaymentProvider | InvoiceProvider,
  payload: Uint8Array,
  headers: Headers,
) {
  const event = await provider.verifyWebhook(payload, headers);
  return inbox.enqueueOnce({ organizationId, kind, providerId: provider.providerId }, event);
}

export function reconcilePayment(expected: Money, settled?: Money) {
  if (!settled) return "UNMATCHED";
  return expected.minor === settled.minor && expected.currency === settled.currency ? "MATCHED" : "REVIEW_REQUIRED";
}

export interface FutureFinance {
  features: { customers: boolean; products: boolean; revenue: boolean; payments: boolean };
  customers: { id: string; displayName: string; createdAt: string }[];
  products: { id: string; name: string; active: boolean }[];
  revenue: { id: string; customerId: string; productId?: string; money: Money; settledAt?: string }[];
  inbox: { key: string; receivedAt: string; event: ProviderEvent }[];
}

export function emptyFutureFinance(): FutureFinance {
  return { features: { customers: false, products: false, revenue: false, payments: false }, customers: [], products: [], revenue: [], inbox: [] };
}

export function storedWebhookInbox(ledger: LedgerRepository): WebhookInbox {
  return {
    enqueueOnce(scope, event) {
      const key = JSON.stringify([scope.organizationId, scope.kind, scope.providerId, event.id]);
      return ledger.transaction(data => {
        const future = data.futureFinance ?? emptyFutureFinance();
        if (future.inbox.some(item => item.key === key)) return { result: false, changed: false };
        future.inbox.push({ key, receivedAt: new Date().toISOString(), event });
        data.futureFinance = future;
        return { result: true };
      });
    },
  };
}
