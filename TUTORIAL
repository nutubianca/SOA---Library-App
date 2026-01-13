# Tutorial: Securing a FaaS-Style Microservice with JWT + an API Gateway
## 1. Introduction

In a microservice architecture you often end up with multiple backend services:

- authentication/user management
- business logic (books, borrowing)
- notifications
- small utilities (date math, formatting, etc.)

If each service implements its own auth rules, security becomes inconsistent and hard to maintain.

This tutorial demonstrates a clean pattern implemented in this system:

- A small **FaaSAPI** service exposes “invoke named functions” over HTTP.
- A central **API Gateway** verifies **JWT** on protected routes.
- **NGINX** exposes one public port (`8080`) for both the frontend and gateway APIs.

Concrete goal:

> **Only authenticated users can call `POST /faasapi/invoke/:name`.**

---

## 2. Core Concepts

### 2.1 Function-as-a-Service (FaaS) as an HTTP pattern

In this repo, “FaaS” means a simple pattern:

- A service exposes a set of named functions, e.g. `echo`, `add`, `dueDate`.
- A client calls `POST /invoke/<functionName>` with JSON input.
- The service runs the function and returns JSON output.

This is not a full AWS Lambda replacement. It’s a lightweight, microservice-friendly way to centralize utility functionality.

### 2.2 JWT (JSON Web Token)

JWT is used to prove identity without server-side sessions.

- Users log in and receive a token.
- The frontend (or CLI client) sends the token on every protected request:

```
Authorization: Bearer <token>
```

### 2.3 API Gateway

The API Gateway is the single public entry point for internal APIs. In this system it:

- exposes routes like `/userapi/*`, `/bookapi/*`, `/faasapi/*`
- validates JWT for protected paths
- forwards the request to the appropriate backend service

This centralizes security and keeps each microservice smaller.

---

## 3. Example Scenario

We’ll implement and test this flow:

1. Register and login via UserAPI to obtain a JWT.
2. Call the FaaS endpoint through the gateway:
	 - `GET /faasapi/functions` (list functions)
	 - `POST /faasapi/invoke/dueDate` (invoke a function)
3. Verify unauthenticated calls are blocked.

---

## 4. Prerequisites

- Windows + PowerShell
- Docker Desktop + Docker Compose
- Ports available: `8080`, `3000-3004`, `4000`, `5432` (plus any broker ports if enabled)

---

## 5. Implementation Guide (using the code in this repo)

### Step 1 — Start the services

```powershell
Set-Location "./library-system/backend"
docker compose up -d --build
docker compose ps
```

NGINX is exposed on:

- `http://localhost:8080`

### Step 2 — Obtain a JWT

Register (public route):

```powershell
$reg = Invoke-RestMethod -Method Post -Uri "http://localhost:8080/userapi/register" -ContentType "application/json" -Body (
	@{ name="FaaS Test"; email="faas.test@example.com"; password="Password123!" } | ConvertTo-Json
)
$reg
```

Login (public route):

```powershell
$login = Invoke-RestMethod -Method Post -Uri "http://localhost:8080/userapi/login" -ContentType "application/json" -Body (
	@{ email="faas.test@example.com"; password="Password123!" } | ConvertTo-Json
)
$token = $login.token
$token
```

### Step 3 — Verify the gateway blocks unauthenticated access

If you call the FaaS endpoint without a JWT, it should fail with `401`:

```powershell
try {
	Invoke-RestMethod -Method Get -Uri "http://localhost:8080/faasapi/functions" -ErrorAction Stop
} catch {
	$_.Exception.Message
}
```

Expected outcome: a 401-style error, because the gateway protects `/faasapi/*`.

### Step 4 — Call FaaS functions through the gateway (authenticated)

List functions:

```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:8080/faasapi/functions" -Headers @{ Authorization = "Bearer $token" }
```

Invoke `add`:

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:8080/faasapi/invoke/add" -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body (
	@{ a=10; b=32 } | ConvertTo-Json
)
```

Invoke `dueDate` (useful in a library domain):

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:8080/faasapi/invoke/dueDate" -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body (
	@{ days=14 } | ConvertTo-Json
)
```

### Step 5 — How it’s implemented (key code points)

#### 5.1 FaaSAPI: the function registry and invoke endpoint

FaaSAPI defines a small in-memory function registry and exposes:

- `GET /functions`
- `POST /invoke/:name`

See the implementation in:

- `library-system/backend/FaaSAPI/index.js`

At a high level:

```js
const functions = {
	add: async (input) => ({ output: Number(input.a) + Number(input.b) }),
	dueDate: async (input) => ({ output: { due_at: "..." } }),
};

app.post('/invoke/:name', async (req, res) => {
	const fn = functions[req.params.name];
	if (!fn) return res.status(404).json({ error: 'Unknown function' });
	const result = await fn(req.body);
	res.json(result);
});
```

The important design choice: **FaaSAPI itself does not implement JWT verification**. It trusts the gateway to enforce authentication.

#### 5.2 API Gateway: route protection with JWT middleware

The gateway proxies `/faasapi/*` and applies JWT verification before proxying.

See:

- `library-system/backend/APIGateway/index.js`

The key pattern is:

```js
app.get('/faasapi/health', serviceProxy('faasapi', targets.faasapi));
app.use('/faasapi', authMiddleware, serviceProxy('faasapi', targets.faasapi));
```

Meaning:

- Health is public.
- Everything else under `/faasapi` requires a valid JWT.

#### 5.3 NGINX: single public entrypoint

NGINX routes requests to the gateway:

- `/userapi/*`, `/faasapi/*`, etc. → API Gateway

See:

- `library-system/backend/nginx.conf`

---

## 6. Extending the example: add a new FaaS function

To add a new function:

1. Open `library-system/backend/FaaSAPI/index.js`.
2. Add a new entry to `functions`, e.g.:

```js
uppercase: async (input) => {
	const text = String(input?.text ?? '');
	return { output: text.toUpperCase() };
},
```

3. Rebuild the service:

```powershell
Set-Location "./library-system/backend"
docker compose up -d --build faasapi
```

4. Invoke it (still secured by the gateway):

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:8080/faasapi/invoke/uppercase" -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body (
	@{ text="hello" } | ConvertTo-Json
)
```

---

## 7. Why this pattern is useful (discussion)

- **Centralized auth**: JWT validation happens once (gateway), not repeated across every service.
- **Reduced service complexity**: FaaSAPI stays focused on function execution and input validation.
- **Consistent external API**: clients only talk to NGINX/Gateway, not internal container URLs.
- **Good SOA story**: shows separation of concerns (routing/auth vs business logic).

---

## 8. Troubleshooting

- **401 when calling FaaS with a token**: re-login and ensure you pass `Authorization: Bearer <token>`.
- **404 Unknown function**: confirm the function name exists and you rebuilt `faasapi`.
- **CORS issues in browser**: the gateway enables CORS; verify you’re calling `http://localhost:8080/...`.

