const crypto = require('crypto');

const BASE_URL = process.env.CLICKPESA_BASE_URL?.replace(/\/$/, '') || 'https://api.clickpesa.com';
const CLIENT_ID = process.env.CLICKPESA_CLIENT_ID || '';
const API_KEY = process.env.CLICKPESA_API_KEY || '';

let cachedToken = null;

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ClickPesa ${init.method || 'GET'} ${url} failed: ${res.status} ${text}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

async function getToken() {
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
function computeChecksum(payload) {
  const body = JSON.stringify(payload);
  return crypto.createHmac('sha256', API_KEY).update(body).digest('hex');
}

async function initiateUssdPush(params) {
  const token = await getToken();
  const url = `${BASE_URL}/third-parties/payments/initiate-ussd-push-request`;
  const bodyCore = {
    amount: String(params.amount),
    currency: params.currency,
    orderReference: params.orderReference,
    phoneNumber: params.phoneNumber,
  };
  const checksum = computeChecksum(bodyCore);
  const body = { ...bodyCore, checksum };
  return fetchJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function checkPaymentStatus(orderReference) {
  const token = await getToken();
  const url = `${BASE_URL}/third-parties/payments/check-payment-status`;
  const bodyCore = { orderReference };
  const checksum = computeChecksum(bodyCore);
  const body = { ...bodyCore, checksum };
  return fetchJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function initiateCardPayment(params) {
  const token = await getToken();
  const url = `${BASE_URL}/third-parties/payments/initiate-card-payment`;
  const bodyCore = {
    amount: String(params.amount),
    currency: params.currency,
    orderReference: params.orderReference,
    cardNumber: params.cardNumber,
    expiryMonth: params.expiryMonth,
    expiryYear: params.expiryYear,
    cvv: params.cvv,
    cardHolderName: params.cardHolderName,
  };
  const checksum = computeChecksum(bodyCore);
  const body = { ...bodyCore, checksum };
  return fetchJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

module.exports = {
  getToken,
  computeChecksum,
  initiateUssdPush,
  checkPaymentStatus,
  initiateCardPayment
};
