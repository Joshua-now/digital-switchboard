# Digital Switchboard

A production-ready, multi-tenant call routing console that receives inbound lead webhooks and triggers AI-powered phone calls via Bland.

## Features

- Multi-tenant architecture supporting 20-30+ clients
- Webhook ingestion from GoHighLevel (extensible to other sources)
- AI call routing via Bland API
- Idempotent webhook handling with deduplication
- Quiet hours enforcement per client timezone
- Admin-only dashboard for client management
- Real-time call status tracking
- Comprehensive audit logging

## Tech Stack

- **Backend**: Node.js + Express + TypeScript
- **Database**: PostgreSQL (via Supabase)
- **ORM**: Prisma
- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Auth**: JWT with bcrypt password hashing
- **Deployment**: Render (or any Node.js hosting)

## Project Structure

```
digital-switchboard/
├── server/                # Backend Express application
│   ├── index.ts          # Main server entry point
│   ├── lib/              # Utilities (db, utils, audit)
│   ├── middleware/       # Auth and error handling
│   ├── providers/        # Bland API integration
│   └── routes/           # API and webhook routes
├── src/                  # Frontend React application
│   ├── pages/            # Route pages
│   ├── components/       # Reusable components
│   ├── contexts/         # React contexts (Auth)
│   └── lib/              # API client
├── prisma/
│   └── schema.prisma     # Database schema
└── .env                  # Environment variables
```

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL database (Supabase recommended)
- Bland AI API key
- bcrypt for password hashing

## Installation

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd digital-switchboard
npm install
```

### 2. Set Up Environment Variables

Copy and configure your `.env` file:

```env
# Database
DATABASE_URL=postgresql://user:password@host:5432/database

# Server
BASE_URL=https://your-domain.com
PORT=3000
NODE_ENV=production

# Bland AI
BLAND_API_KEY=your_bland_api_key_here

# Authentication
JWT_SECRET=your_secure_random_string_here
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD_HASH=<bcrypt_hash>
```

### 3. Generate Admin Password Hash

Use this script to generate a password hash:

```bash
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('YourPassword123', 10, (e, h) => console.log(h));"
```

Copy the output and set it as `ADMIN_PASSWORD_HASH` in your `.env` file.

### 4. Set Up Database

Push the Prisma schema to your database:

```bash
npm run db:push
```

Or use migrations for production:

```bash
npm run db:migrate
```

### 5. Build and Start

```bash
# Build both frontend and backend
npm run build

# Start the production server
node dist/index.js
```

For development:

```bash
npm run dev
```

This runs both the Express server (port 3000) and Vite dev server (port 5173) concurrently.

## Usage

### Admin Login

1. Navigate to `/login`
2. Use your `ADMIN_EMAIL` and the password you hashed
3. Access the admin dashboard

### Creating a Client

1. Go to the Clients page
2. Click "New Client"
3. Fill in:
   - Client name
   - Timezone
   - Quiet hours (start and end time)
4. Copy the webhook URL provided

### Configuring Call Routing

1. Open a client detail page
2. Click "Edit Configuration"
3. Set:
   - Active toggle (enables/disables calling)
   - Call within seconds (delay before calling)
   - AI instructions (what the AI should say/do)
   - Transfer number (optional, for call transfers)
4. Save configuration

### Setting Up GoHighLevel Webhook

1. In GoHighLevel, go to Settings → Webhooks
2. Create a new webhook
3. Set the URL to: `https://your-domain.com/webhook/gohighlevel/{clientId}`
4. Configure it to trigger on form submissions
5. Ensure the payload includes:
   - `phone` or `contact.phone`
   - Optional: `contactId`, `firstName`, `lastName`, `email`

### Testing the Webhook

```bash
curl -X POST https://your-domain.com/webhook/gohighlevel/{clientId} \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12345678901",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "contactId": "abc123"
  }'
```

## API Endpoints

### Webhooks

- `POST /webhook/gohighlevel/:clientId` - Receive lead webhooks
- `POST /webhook/bland` - Bland callback endpoint

### Admin API (requires auth)

- `POST /api/auth/login` - Admin login
- `POST /api/auth/logout` - Admin logout
- `GET /api/auth/me` - Get current user
- `GET /api/clients` - List all clients
- `POST /api/clients` - Create client
- `GET /api/clients/:id` - Get client details
- `PUT /api/clients/:id` - Update client
- `DELETE /api/clients/:id` - Delete client
- `GET /api/clients/:id/routing-config` - Get routing config
- `POST /api/clients/:id/routing-config` - Update routing config
- `GET /api/leads` - List leads (filterable by client)
- `GET /api/leads/:id` - Get lead details
- `GET /api/calls` - List calls (filterable by client)
- `GET /api/audit-logs` - List audit logs

### Health Check

- `GET /health` - Server and database health status

## Database Schema

### Tables

- **clients** - Customer businesses
- **routing_configs** - Call configuration per client
- **leads** - Inbound lead records
- **calls** - Outbound call attempts
- **audit_logs** - System activity log

### Key Features

- Unique constraint on `(clientId, dedupeKey)` prevents duplicate leads
- Cascade deletes maintain referential integrity
- Comprehensive indexes for query performance
- Row-level security enabled (configured for authenticated access)

## Deployment

### Render

1. Create a new Blueprint from `render.yaml`
2. Configure environment variables:
   - `BASE_URL` - Your application URL
   - `BLAND_API_KEY` - Your Bland API key
   - `ADMIN_EMAIL` - Admin email
   - `ADMIN_PASSWORD_HASH` - Bcrypt hash of admin password
3. Deploy
4. Run database migrations if needed

### Other Platforms (Heroku, Railway, etc.)

1. Ensure Node.js 18+ is supported
2. Set all environment variables
3. Build command: `npm install && npm run build`
4. Start command: `node dist/index.js`
5. Ensure PostgreSQL database is connected
6. Health check endpoint: `/health`

## Architecture Decisions

### Deduplication Strategy

Leads are deduplicated using a `dedupeKey`:
- If `contactId` is present, use `contact_{contactId}`
- Otherwise, use `phone_{phone}_{date}`

This prevents the same lead from triggering multiple calls on the same day.

### Quiet Hours

The system checks the client's timezone and quiet hours before placing calls:
- If current time is within quiet hours, the lead is marked as `SKIPPED`
- Leads are still logged but no call is placed
- Quiet hours can span midnight (e.g., 20:00 to 08:00)

### Security

- Admin-only access (no client logins)
- JWT authentication with HTTP-only cookies
- Password hashing with bcrypt (10 rounds)
- Rate limiting on webhook and API endpoints
- CORS configured for frontend origin
- Database RLS enabled for all tables

### Call Flow

1. Webhook received → Lead created with `NEW` status
2. Validation checks (client active, config exists, not quiet hours)
3. Lead status → `QUEUED`
4. Bland API call initiated
5. Lead status → `CALLING`, Call record created
6. Bland webhook callback updates Call and Lead status
7. Final status: `COMPLETED` or `FAILED`

## Troubleshooting

### Calls Not Being Placed

1. Check client status is `ACTIVE`
2. Ensure routing config exists and is active
3. Verify not in quiet hours for client's timezone
4. Check `BLAND_API_KEY` is valid
5. Review audit logs for error messages

### Webhook Issues

1. Verify webhook URL includes correct `clientId`
2. Check request includes `phone` field
3. Ensure phone number is valid E.164 format
4. Review server logs for webhook errors
5. Test with curl command

### Database Connection

1. Verify `DATABASE_URL` is correct
2. Check database is accessible from server
3. Test connection with: `curl https://your-domain.com/health`
4. Review database logs for connection issues

### Authentication

1. Verify `ADMIN_EMAIL` matches login email
2. Ensure `ADMIN_PASSWORD_HASH` is a valid bcrypt hash
3. Check `JWT_SECRET` is set and consistent
4. Clear browser cookies and try again

## Monitoring

The system provides extensive logging via:
- **Console logs** - Server activity and errors
- **Audit logs** - Stored in database for all key events
- **Health endpoint** - Database connectivity status

Key events logged:
- `LEAD_CREATED` - New lead received
- `CALL_INITIATED` - Call started
- `CALL_UPDATED` - Call status changed
- `CALL_FAILED` - Call failed
- `WEBHOOK_ERROR` - Webhook processing error
- `CLIENT_CREATED/UPDATED/DELETED` - Client management

## Support

For issues or questions:
1. Check the audit logs in the admin dashboard
2. Review server logs
3. Test with the health endpoint
4. Verify environment variables are correct

## License

Proprietary - All rights reserved
