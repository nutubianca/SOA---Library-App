# Library SOA Backend

This folder contains minimal Node/Express microservice templates and a `docker-compose.yml` to run them with Postgres, RabbitMQ, and NGINX.

Quick start:

```powershell
cd library-system/backend
docker compose up --build
```

Services:
- `UserAPI` - port 3000
- `BookAPI` - port 3001
- `BorrowAPI` - port 3002
- `NotificationAPI` - port 3003
- `Postgres` - port 5432
- `RabbitMQ Management` - port 15672
- `NGINX` reverse proxy - port 8080

Health & initialization:
- Postgres initialization SQL is in `init/init.sql` and will run on first container startup.
- Services expose `/health` endpoints; `docker compose ps` and `docker compose logs -f` help diagnose issues.
- RabbitMQ management UI is remapped to host port `15673` (container `15672`) to avoid conflicts with a local RabbitMQ installation.

Useful commands:
```powershell
# Show service status
docker compose ps

# Follow logs
docker compose logs -f

# Call API via NGINX reverse proxy
curl http://localhost:8080/userapi/health
```
