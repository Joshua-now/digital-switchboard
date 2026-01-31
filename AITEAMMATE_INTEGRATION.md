# AI Teammate Integration Guide

## Overview
This guide shows how to integrate the "Call Me Now" forms on aiteammate.io with the Digital Switchboard app for instant AI callbacks.

## API Endpoint

**POST** `https://your-switchboard-app.railway.app/api/leads/create`

## Products & Agents

| Product | Agent | Assistant ID | Phone Number |
|---------|-------|--------------|--------------|
| After Hours Coverage | Maya | `02b7b95b-d522-4750-ae79-97323af6473b` | +1-321-336-9547 |
| Speed to Lead | Anna | `c65e4f2c-be50-4d6f-b2f8-8c8a28cd7ccc` | +1-321-336-9584 |
| Complete Package | Riley | `2c902658-5f8d-4ac7-aa87-43e3916f53bb` | +1-321-732-4022 |

## Request Format

```json
{
  "firstName": "John",
  "lastName": "Smith",
  "phone": "+13215551234",
  "email": "john@example.com",
  "company": "Smith Roofing",
  "product": "after-hours",
  "source": "aiteammate.io"
}
```

### Required Fields
- `phone` - Customer phone number (will be normalized automatically)
- `product` - Must be one of:
  - `after-hours` - Routes to Maya
  - `speed-to-lead` - Routes to Anna
  - `complete-package` - Routes to Riley

### Optional Fields
- `firstName` - Used in AI greeting
- `lastName` - For full name
- `email` - Stored for follow-up
- `company` - Business name (passed to AI)
- `source` - Tracking (default: "aiteammate.io")

## Response

### Success (201)
```json
{
  "success": true,
  "leadId": "uuid-here",
  "callId": "vapi-call-id",
  "message": "AI will call +13215551234 within 60 seconds",
  "agent": "After Hours - Maya"
}
```

### Duplicate (200)
```json
{
  "message": "Lead already exists",
  "leadId": "uuid-here",
  "duplicate": true
}
```

### Error (400/500)
```json
{
  "error": "Phone number required"
}
```

## HTML Form Examples

### After Hours Page Form
```html
<form id="after-hours-form">
  <input type="text" name="firstName" placeholder="First Name" required />
  <input type="text" name="lastName" placeholder="Last Name" required />
  <input type="tel" name="phone" placeholder="Phone Number" required />
  <input type="email" name="email" placeholder="Email" required />
  <input type="text" name="company" placeholder="Company Name" />
  <button type="submit">Call Me Now</button>
</form>

<script>
document.getElementById('after-hours-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const formData = new FormData(e.target);
  const data = {
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    phone: formData.get('phone'),
    email: formData.get('email'),
    company: formData.get('company'),
    product: 'after-hours',
    source: 'aiteammate.io'
  };

  try {
    const response = await fetch('https://your-app.railway.app/api/leads/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    const result = await response.json();
    
    if (result.success) {
      alert(`Success! ${result.agent} will call you within 60 seconds.`);
      e.target.reset();
    } else {
      alert(`Error: ${result.error || 'Something went wrong'}`);
    }
  } catch (error) {
    alert('Failed to submit. Please try again.');
  }
});
</script>
```

### Speed to Lead Page Form
Change the product value:
```javascript
product: 'speed-to-lead'
```

### Complete Package Page Form
Change the product value:
```javascript
product: 'complete-package'
```

## Environment Variables

Make sure these are set in Railway:

```bash
# Vapi Configuration
VAPI_API_KEY=8a651cd7-0e94-4801-964e-524b5b0e4521
TRANSFER_NUMBER=+13214719858

# Database
DATABASE_URL=your_postgres_url

# Base URL for webhooks
BASE_URL=https://your-app.railway.app
```

## Testing

### Test with cURL

**After Hours:**
```bash
curl -X POST https://your-app.railway.app/api/leads/create \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Test",
    "lastName": "User",
    "phone": "+13215551234",
    "email": "test@example.com",
    "company": "Test Roofing",
    "product": "after-hours"
  }'
```

**Speed to Lead:**
```bash
curl -X POST https://your-app.railway.app/api/leads/create \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Test",
    "phone": "+13215551234",
    "product": "speed-to-lead"
  }'
```

**Complete Package:**
```bash
curl -X POST https://your-app.railway.app/api/leads/create \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Test",
    "phone": "+13215551234",
    "product": "complete-package"
  }'
```

## What Happens Next

1. Form submits → API creates lead in database
2. API immediately triggers Vapi call with correct assistant
3. AI calls customer within 60 seconds
4. AI qualifies lead based on your Vapi assistant prompts
5. AI either books appointment OR transfers to: **+1-321-471-9858**
6. Call data is tracked in admin dashboard

## Admin Dashboard

View all leads and calls at:
`https://your-app.railway.app`

Login with admin credentials to see:
- All leads by product
- Call recordings & transcripts
- Conversion tracking
- Real-time call status

## Support

Issues? Check:
1. Railway logs for errors
2. Vapi dashboard for call status
3. Database for lead/call records
4. Environment variables are set correctly
