# Quick Start Guide

Get Digital Switchboard running in minutes.

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Set Up Environment

Copy `.env.example` to `.env` and update the values:

```bash
cp .env.example .env
```

Key variables to set:
- `DATABASE_URL` - Your PostgreSQL connection string
- `BLAND_API_KEY` - Get from https://bland.ai
- `ADMIN_EMAIL` - Your admin email
- `JWT_SECRET` - Generate with: `openssl rand -base64 32`

## Step 3: Generate Admin Password

```bash
npm run hash-password YourSecurePassword123
```

Copy the hash output and set it as `ADMIN_PASSWORD_HASH` in your `.env` file.

## Step 4: Set Up Database

The database schema is already created in Supabase. Generate the Prisma client:

```bash
npm run db:generate
```

## Step 5: Run Development Server

```bash
npm run dev
```

This starts:
- Backend API on http://localhost:3000
- Frontend on http://localhost:5173

## Step 6: Login

1. Open http://localhost:5173
2. Login with your `ADMIN_EMAIL` and password
3. Start creating clients

## Step 7: Create Your First Client

1. Click "New Client"
2. Enter client name and configure timezone/quiet hours
3. Copy the webhook URL
4. Set up routing configuration with AI instructions

## Step 8: Test Webhook

```bash
curl -X POST http://localhost:3000/webhook/gohighlevel/{CLIENT_ID} \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+12345678901",
    "firstName": "Test",
    "lastName": "User",
    "contactId": "test123"
  }'
```

## Production Deployment

1. Push to Git repository
2. Deploy to Render, Heroku, or Railway
3. Set environment variables in hosting platform
4. Database will be automatically provisioned (if using Render)
5. Build and start commands are in `package.json`

## Troubleshooting

**Can't login?**
- Verify password hash was generated correctly
- Check `ADMIN_EMAIL` matches exactly
- Clear browser cookies

**Calls not working?**
- Verify `BLAND_API_KEY` is valid
- Check client status is ACTIVE
- Ensure routing config exists and is active
- Check not in quiet hours

**Database errors?**
- Verify `DATABASE_URL` is correct
- Check Prisma client is generated: `npm run db:generate`
- Test connection: `curl http://localhost:3000/health`

## Next Steps

- Set up GoHighLevel webhook integration
- Configure AI instructions for your use case
- Monitor calls and leads in the dashboard
- Review audit logs for troubleshooting

## Support

See full documentation in `README.md`
