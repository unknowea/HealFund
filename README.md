 HealFund
This project is aimed to connect sick people need help and the helpers.

## Docker

Copy `.env.docker.example` to `.env` and set `MONGODB_URI` and `JWT_SECRET`.
Then start the backend and both frontends from the repository root:

```bash
docker compose up --build
```

Open the applications at:

- Patient portal: http://localhost:3001
- Admin portal: http://localhost:3000
- Backend health check: http://localhost:5000/api/health

Uploaded files are stored in the persistent `healfund_uploads` Docker volume.

