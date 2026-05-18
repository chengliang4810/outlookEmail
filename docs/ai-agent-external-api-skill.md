---
name: outlookemail-external-api
description: Use this skill when an AI Agent needs to safely claim an OutlookEmail mailbox, trigger an external verification-code flow, poll the mailbox for the code, and release or complete the mailbox through the OutlookEmail external API.
---

# OutlookEmail External API Skill

## Purpose

Use this skill to integrate an AI Agent with an OutlookEmail service that manages mailbox pools and verification-code extraction.

This skill is designed for concurrent automation. Do not randomly select mailboxes from `/api/external/accounts` for registration tasks. Always claim a mailbox through the claim API first, then complete, fail, or release it when the task ends.

## Required Inputs

- `base_url`: OutlookEmail service URL, for example `http://127.0.0.1:5000`
- `api_key`: External API Key
- `project_key`: Mailbox pool project key, for example `gpt`
- `caller_id`: Stable agent or worker identifier
- `task_id`: Unique task identifier for the current registration/login attempt

## Authentication

Send the API Key in the `X-API-Key` header.

```bash
X-API-Key: ${OUTLOOKEMAIL_API_KEY}
```

Never print, log, or expose the real API Key in final user-facing output.

## Standard Workflow

### 1. Claim A Mailbox

Claim a mailbox before sending any verification code.

```bash
curl -sS -X POST "${BASE_URL}/api/external/accounts/claim" \
  -H "X-API-Key: ${OUTLOOKEMAIL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "project_key": "gpt",
    "caller_id": "agent-1",
    "task_id": "task-001",
    "lease_seconds": 600
  }'
```

Success response:

```json
{
  "success": true,
  "data": {
    "project_key": "gpt",
    "account_id": 12,
    "email": "user@example.com",
    "primary_email": "user@example.com",
    "claim_token": "pclm_xxx",
    "claimed_at": "2026-05-18T10:00:00+00:00",
    "lease_expires_at": "2026-05-18T10:10:00+00:00"
  }
}
```

If `success=false` and the error says no mailbox is available, stop or retry later. Do not fall back to choosing a mailbox from the account list.

### 2. Trigger The Verification Code

Use the claimed `email` as the mailbox for the external website, app, or provider that will send the verification code.

Record the local send time immediately before triggering the code. The verification API requires:

```text
yyyy-MM-dd HH:mm:ss
```

Example:

```text
2026-05-18 10:00:00
```

Use the OutlookEmail app timezone configured on the server, normally `Asia/Shanghai`.

### 3. Poll For The Verification Code

Call the verification-code API with the claimed email and the send time.

```bash
curl -sS --globoff "${BASE_URL}/api/external/verification-code?email=user@example.com&folder=all&since=2026-05-18%2010:00:00&top=10" \
  -H "X-API-Key: ${OUTLOOKEMAIL_API_KEY}"
```

Default extraction behavior:

- If `regex` is omitted, the API first strips HTML tags, scripts, styles, and entities, then extracts an independent 4-6 digit number.
- If a custom `regex` is provided, the API applies it to the cleaned mail text. If the regex contains a capture group, group 1 is returned; otherwise the full match is returned.

Custom regex example:

```bash
curl -sS --globoff "${BASE_URL}/api/external/verification-code?email=user@example.com&folder=all&since=2026-05-18%2010:00:00&regex=code%20is%5Cs*(%5Cd%7B6%7D)&top=10" \
  -H "X-API-Key: ${OUTLOOKEMAIL_API_KEY}"
```

Recommended polling:

- Poll every 5-10 seconds.
- Stop after the provider-specific timeout, commonly 2-5 minutes.
- Keep using the same claimed mailbox and the same `since` time.
- Do not claim a new mailbox unless the current task is failed, released, or the lease expires.

Success response:

```json
{
  "success": true,
  "code": "654321",
  "message_id": "8",
  "subject": "Your verification code",
  "from": "no-reply@example.com",
  "date": "18-May-2026 10:00:30 +0800",
  "folder": "inbox",
  "requested_email": "user@example.com",
  "resolved_email": "user@example.com",
  "checked_count": 1
}
```

## Finish The Mailbox Task

You must finish every claimed mailbox with exactly one terminal action when the task outcome is known.

### Mark Success

Call this after the external registration/login task has succeeded.

```bash
curl -sS -X POST "${BASE_URL}/api/external/accounts/complete-success" \
  -H "X-API-Key: ${OUTLOOKEMAIL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "project_key": "gpt",
    "account_id": 12,
    "claim_token": "pclm_xxx",
    "caller_id": "agent-1",
    "task_id": "task-001",
    "detail": "registered"
  }'
```

### Mark Failed

Call this when the mailbox was used but the task failed permanently, for example provider blocked, account banned, or invalid flow.

```bash
curl -sS -X POST "${BASE_URL}/api/external/accounts/complete-failed" \
  -H "X-API-Key: ${OUTLOOKEMAIL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "project_key": "gpt",
    "account_id": 12,
    "claim_token": "pclm_xxx",
    "caller_id": "agent-1",
    "task_id": "task-001",
    "detail": "provider blocked"
  }'
```

Failed mailboxes do not automatically return to the claim pool. They require manual reset.

### Release

Call this when the mailbox was claimed but should return to the pool, for example task cancelled before use, agent stopped early, or the chosen provider path was abandoned.

```bash
curl -sS -X POST "${BASE_URL}/api/external/accounts/release" \
  -H "X-API-Key: ${OUTLOOKEMAIL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "project_key": "gpt",
    "account_id": 12,
    "claim_token": "pclm_xxx",
    "caller_id": "agent-1",
    "task_id": "task-001",
    "detail": "client cancelled"
  }'
```

## Concurrency Rules

- The claim API is the only safe way to allocate a mailbox for a task.
- Multiple concurrent requests with the same `caller_id` can receive different mailboxes. This is expected.
- `caller_id` and `task_id` are audit fields, not idempotency keys.
- If a claim request times out after the server already claimed a mailbox, retrying may claim another mailbox. Use a reasonable `lease_seconds` so unknown claims are recycled later.
- A claimed mailbox is unavailable to other claim requests until it is completed, failed, released, or its lease expires.

## Error Handling

- `401`: Missing or invalid API Key. Stop and fix authentication.
- `400`: Missing or invalid parameters. Fix the request.
- `200` with `success=false`: Business-level failure, such as no mailbox available or no code found.
- Verification code `404`: No matching code found yet. Continue polling until timeout.

## Minimal Agent Algorithm

1. Claim mailbox with `/api/external/accounts/claim`.
2. Store `email`, `account_id`, `claim_token`, and `lease_expires_at`.
3. Trigger the provider to send a verification code to `email`.
4. Poll `/api/external/verification-code` with `email` and the send time in `yyyy-MM-dd HH:mm:ss`.
5. Use the returned `code`.
6. If the provider task succeeds, call `/api/external/accounts/complete-success`.
7. If the provider task permanently fails, call `/api/external/accounts/complete-failed`.
8. If the task is cancelled before meaningful use, call `/api/external/accounts/release`.

