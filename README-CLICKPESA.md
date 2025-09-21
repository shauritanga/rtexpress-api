ClickPesa Integration Notes

Endpoints used
- POST /third-parties/generate-token
  - headers: client-id, api-key
  - response: { token, expiresIn }
- POST /third-parties/payments/initiate-ussd-push-request
  - headers: Authorization: Bearer <token>
  - body: { amount, currency, orderReference, phoneNumber, checksum }
- GET /third-parties/payments/{orderReference}
  - headers: Authorization: Bearer <token>
- POST /third-parties/payments/preview-card-payment
  - headers: Authorization: Bearer <token>
  - body: { amount, currency, orderReference, checksum }
- POST /third-parties/payments/initiate-card-payment
  - headers: Authorization: Bearer <token>
  - body: { amount, currency, orderReference, customer: { id }, checksum }

Checksum
- Implemented as HMAC-SHA256 of the JSON stringified body with API_KEY as the secret
- Update computeChecksum() if ClickPesa requires a different checksum formula

Environment
- CLICKPESA_CLIENT_ID
- CLICKPESA_API_KEY
- CLICKPESA_BASE_URL (default https://api.clickpesa.com)
- CLICKPESA_WEBHOOK_URL (informational; used in docs or future flows)
- CLICKPESA_WEBHOOK_SECRET (for verifying incoming webhook signatures)

Flow
1) Frontend calls POST /payments/clickpesa/init with invoiceId, amount, currency, and phoneNumber if USSD
2) Backend creates Payment (pending), optionally calls ClickPesa to initiate USSD push
3) Frontend uses response.reference/checkoutUrl to proceed
4) Webhook updates payment + recomputes invoice

