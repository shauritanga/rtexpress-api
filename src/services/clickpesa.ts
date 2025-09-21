import crypto from 'crypto';

const BASE_URL = process.env.CLICKPESA_BASE_URL?.replace(/\/$/, '') || 'https://api.clickpesa.com';
const CLIENT_ID = process.env.CLICKPESA_CLIENT_ID || '';
const API_KEY = process.env.CLICKPESA_API_KEY || '';

let cachedToken: { token: string; expiresAt: number } | null = null;

async function fetchJson(url: string, init: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ClickPesa ${init.method || 'GET'} ${url} failed: ${res.status} ${text}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

export async function getToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 30 > now) {
    return cachedToken.token;
  }
  if (!CLIENT_ID || !API_KEY) throw new Error('CLICKPESA_CLIENT_ID or CLICKPESA_API_KEY missing');
  const url = `${BASE_URL}/third-parties/generate-token`;
  const resp = await fetchJson(url, {
    method: 'POST',
    headers: { 'client-id': CLIENT_ID, 'api-key': API_KEY },
  });
  // Response shape is not specified; assume { token, expiresIn }
  const token = resp.token || resp.access_token || resp.data?.token;
  const expiresIn = Number(resp.expiresIn || resp.expires_in || 300);
  if (!token) throw new Error('ClickPesa token not present in response');
  cachedToken = { token, expiresAt: now + (expiresIn || 300) };
  return token;
}

// NOTE: Checksum formula is not public here. As a safe default we use HMAC-SHA256 of the stringified body with API KEY.
// If ClickPesa requires a different formula, update this to match their docs.
export function computeChecksum(payload: Record<string, any>): string {
  const body = JSON.stringify(payload);
  return crypto.createHmac('sha256', API_KEY).update(body).digest('hex');
}

export async function initiateUssdPush(params: { amount: string | number; currency: string; orderReference: string; phoneNumber: string; }): Promise<any> {
  const token = await getToken();
  const url = `${BASE_URL}/third-parties/payments/initiate-ussd-push-request`;
  const bodyCore = {
    amount: String(params.amount),
    currency: params.currency,
    orderReference: params.orderReference,
    phoneNumber: params.phoneNumber,
  } as const;
  const checksum = computeChecksum(bodyCore as any);
  const body = { ...bodyCore, checksum };
  return fetchJson(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function getPayment(orderReference: string): Promise<any> {
  const token = await getToken();
  const url = `${BASE_URL}/third-parties/payments/${encodeURIComponent(orderReference)}`;
  return fetchJson(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
}

export async function previewCardPayment(params: { amount: string | number; currency: string; orderReference: string; }): Promise<any> {
  const token = await getToken();
  const url = `${BASE_URL}/third-parties/payments/preview-card-payment`;
  const bodyCore = { amount: String(params.amount), currency: params.currency, orderReference: params.orderReference } as const;
  const checksum = computeChecksum(bodyCore as any);
  return fetchJson(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...bodyCore, checksum }),
  });
}

export async function initiateCardPayment(params: { amount: string | number; currency: string; orderReference: string; customerId: string; }): Promise<any> {
  const token = await getToken();
  const url = `${BASE_URL}/third-parties/payments/initiate-card-payment`;
  const bodyCore = { amount: String(params.amount), currency: params.currency, orderReference: params.orderReference, customer: { id: params.customerId } } as const;
  const checksum = computeChecksum(bodyCore as any);
  return fetchJson(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...bodyCore, checksum }),
  });
}

