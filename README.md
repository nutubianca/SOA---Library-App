
# Library SOA System Documentation

This repository contains a Service-Oriented Architecture (SOA) **Library System** implemented as multiple Node.js microservices, fronted by an **API Gateway** and **NGINX**.

The system demonstrates:

- Secured REST APIs (JWT)
- Multiple microservices (User, Book, Borrow, Notifications, FaaS)
- Async communication via **RabbitMQ**
- Event streaming via **Kafka**
- Real-time server-side notifications via **SSE (Server-Sent Events)**
- Containerized deployment with Docker Compose

---

## 1. System Overview

The Library system is designed as a set of independently deployable services:

- **UserAPI** issues JWT tokens (login/register) and provides user endpoints.
- **BookAPI** exposes book catalogue endpoints.
- **BorrowAPI** handles borrow/return logic and emits domain events (`book.borrowed`, `book.returned`).
- **NotificationAPI** consumes events and pushes real-time notifications to clients.
- **FaaSAPI** exposes a small “serverless-style” function invocation API (`/invoke/:name`).
- **API Gateway** is the single public entrypoint for the backend and enforces JWT for protected routes.
- **NGINX** reverse-proxies everything on port `8080` and is configured for correct SSE streaming.

---

## 2. C4 Model: System Context

This diagram shows how a user interacts with the Library system. Authentication is done using JWT, validated at the API Gateway.

> Note: Mermaid C4 diagrams require Mermaid C4 support in your renderer.

```mermaid
C4Context
	title System Context Diagram - Library SOA

	Person(user, "User", "Browses books, borrows/returns, receives notifications.")
	System(library, "Library System", "Microservices backend + frontend for a library.")

	Rel(user, library, "Uses", "HTTPS (REST) + SSE")

	UpdateLayoutConfig($c4ShapeInRow="2")
```

---

## 3. C4 Model: Container Diagram

This diagram breaks down the internal containers in the docker-compose stack.

```mermaid
C4Container
	title Container Diagram - Library SOA Architecture

	Person(user, "User", "Web Browser")

	Container_Boundary(edge, "Edge Layer") {
		Container(nginx, "NGINX", "nginx", "Reverse proxy + static frontend hosting. SSE tuned (no buffering).")
		Container(gateway, "API Gateway", "Node.js/Express", "Single entrypoint; routes to services; enforces JWT.")
	}

	Container_Boundary(services, "Microservices") {
		Container(userapi, "UserAPI", "Node.js/Express", "Register/Login; issues JWT.")
		Container(bookapi, "BookAPI", "Node.js/Express", "Book catalogue CRUD/search.")
		Container(borrowapi, "BorrowAPI", "Node.js/Express", "Borrow/return workflow; emits domain events.")
		Container(notificationapi, "NotificationAPI", "Node.js/Express", "Consumes events; pushes realtime updates via SSE/WebSocket.")
		Container(faasapi, "FaaSAPI", "Node.js/Express", "Invoke named functions via HTTP (serverless-style utilities).")
	}

	Container_Boundary(infra, "Infrastructure") {
		ContainerDb(postgres, "PostgreSQL", "PostgreSQL 15", "Stores users, books, borrows.")
		ContainerDb(rabbitmq, "RabbitMQ", "rabbitmq:3-management", "Message broker for async microservice communication.")
		ContainerDb(zookeeper, "Zookeeper", "confluentinc/cp-zookeeper", "Kafka coordination.")
		ContainerDb(kafka, "Kafka", "confluentinc/cp-kafka", "Event streaming topic(s) for domain events.")
	}

	Rel(user, nginx, "Loads UI / calls APIs", "HTTPS")
	Rel(nginx, gateway, "Proxies API requests", "HTTP")

	Rel(gateway, userapi, "Routes /userapi/*", "HTTP/JSON")
	Rel(gateway, bookapi, "Routes /bookapi/*", "HTTP/JSON")
	Rel(gateway, borrowapi, "Routes /borrowapi/*", "HTTP/JSON")
	Rel(gateway, notificationapi, "Routes /notificationapi/*", "HTTP (SSE)")
	Rel(gateway, faasapi, "Routes /faasapi/*", "HTTP/JSON")

	Rel(userapi, postgres, "Reads/Writes users", "SQL")
	Rel(bookapi, postgres, "Reads/Writes books", "SQL")
	Rel(borrowapi, postgres, "Reads/Writes borrows/books", "SQL")

	Rel(borrowapi, rabbitmq, "Publishes events", "AMQP")
	Rel(notificationapi, rabbitmq, "Consumes events", "AMQP")

	Rel(borrowapi, kafka, "Produces events", "TCP")
	Rel(notificationapi, kafka, "Consumes events", "TCP")
	Rel(kafka, zookeeper, "Coordination / metadata", "TCP/2181")

	UpdateLayoutConfig($c4ShapeInRow="4", $c4BoundaryInRow="1")
```

---

## 4. UML Sequence Diagram: The "Borrow Book" Flow

This diagram describes the synchronous borrow request and the asynchronous notification pipeline.

```mermaid
sequenceDiagram
	autonumber
	actor User
	participant UI as Frontend (Browser)
	participant NGINX as NGINX
	participant GW as API Gateway
	participant Borrow as BorrowAPI
	participant DB as PostgreSQL
	participant RMQ as RabbitMQ
	participant K as Kafka
	participant Notif as NotificationAPI

	Note over UI,GW: User is authenticated (JWT)

	User->>UI: Click "Borrow"
	UI->>NGINX: POST /borrowapi/borrow (Authorization: Bearer JWT)
	NGINX->>GW: Proxy request
	GW->>GW: Verify JWT
	GW->>Borrow: Forward request

	activate Borrow
	Borrow->>DB: UPDATE books (copies_available - 1)
	Borrow->>DB: INSERT borrows (...)

	par Publish domain event
		Borrow->>RMQ: Publish book.borrowed (topic exchange)
		Borrow->>K: Produce book.borrowed to topic library.events
	end
	Borrow-->>GW: 201 Created (borrow record)
	deactivate Borrow

	GW-->>NGINX: Response
	NGINX-->>UI: Response

	Note over UI,Notif: Client maintains SSE connection for notifications
	RMQ-->>Notif: Consume book.borrowed
	K-->>Notif: Consume book.borrowed
	Notif-->>UI: SSE event: book.borrowed
```

---

## 5. Technology Stack Summary

| Component | Technology | Role |
|---|---|---|
| Reverse Proxy | NGINX | Single public entrypoint; proxies APIs; hosts frontend; SSE-friendly proxy config |
| API Gateway | Node.js + Express + http-proxy-middleware | JWT validation + routing to services |
| Microservices | Node.js + Express | UserAPI, BookAPI, BorrowAPI, NotificationAPI, FaaSAPI |
| Database | PostgreSQL 15 | Persistent storage for users/books/borrows |
| Message Broker | RabbitMQ | Async event delivery between services |
| Event Streaming | Kafka (+ Zookeeper) | Event stream for domain events (`library.events`) |
| Real-time Notifications | SSE (Server-Sent Events) | Server → browser streaming notifications |
| Deployment | Docker Compose | Runs full system locally in containers |

---

## 6. Run Locally (Quick Start)

From the backend folder:

```powershell
Set-Location "./library-system/backend"
docker compose up -d --build
```

Open:

- Frontend: `http://localhost:8080`
- Gateway health: `http://localhost:8080/health`

