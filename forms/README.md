# AI Teammate Forms - Installation Guide

## 3 Forms for Your Landing Pages

These forms connect your aiteammate.io landing pages to your AI calling system.

### Files:
1. **after-hours-form.html** → Maya (After Hours Coverage)
2. **speed-to-lead-form.html** → Anna (5-Minute Response)
3. **complete-package-form.html** → Riley (Complete Package)

---

## How to Add to Your Landing Pages

### **Option 1: Copy/Paste into HTML Editor**

1. Open your landing page builder (GHL, ClickFunnels, etc.)
2. Find the "Custom HTML" or "Embed Code" element
3. Copy the ENTIRE contents of the form file
4. Paste it where you want the "Call Me Now" form to appear
5. Save and publish

### **Option 2: Add to Existing Page**

If you already have a page layout:

1. Copy just the `<form>` section (including the `<style>` and `<script>` tags)
2. Paste it into your page's HTML
3. Adjust styling to match your brand if needed

---

## What Each Form Does

When a visitor fills out the form:

1. ✅ Validates their info (name, phone required)
2. ✅ Sends data to your API
3. ✅ Shows success message
4. ✅ AI agent calls them within 60 seconds!

**Success Message:**
> "✅ Success! [Agent Name] will call you at [phone] within 60 seconds."

**Error Handling:**
- Duplicate submission: "⚠️ You've already requested a callback"
- Network error: "❌ Failed to submit. Please try again"

---

## Customization

### **Change Colors:**

Find these lines in the `<style>` section:

```css
.ai-submit-btn {
  background: #3182ce;  /* Blue button */
}

.ai-submit-btn:hover {
  background: #2c5aa0;  /* Darker blue on hover */
}
```

Change to your brand colors!

### **Change Button Text:**

Find this line in the HTML:
```html
<button type="submit" class="ai-submit-btn">Call Me Now 📞</button>
```

Change "Call Me Now 📞" to whatever you want!

### **Add More Fields:**

Copy the pattern:
```html
<div class="ai-form-group">
  <label class="ai-form-label" for="ai-newfield">Field Name</label>
  <input type="text" id="ai-newfield" name="newfield" class="ai-form-input">
</div>
```

And add the field to the JavaScript data object.

---

## Testing

### **Test Before Going Live:**

1. Fill out the form with YOUR phone number
2. Submit it
3. You should get a call from the AI agent within 60 seconds!

**Test Numbers:**
- Maya calls from: **+1-321-336-9547**
- Anna calls from: **+1-321-336-9584**
- Riley calls from: **+1-321-732-4022**

### **Clear Test Data:**

If you want to reset and test again:

```powershell
Invoke-RestMethod -Uri "https://digital-switchboard-production.up.railway.app/api/leads/clear-test" -Method DELETE
```

---

## Landing Page Layout Suggestion

### **Recommended Structure:**

```
─────────────────────────────────
│         HEADER / LOGO           │
─────────────────────────────────
│                                 │
│   30-Second Pain Video 🎥       │
│   (Show the problem)            │
│                                 │
─────────────────────────────────
│                                 │
│   Headline: "Never Miss        │
│   Another Lead Again"           │
│                                 │
│   3 Bullets:                   │
│   • AI Calls in 60 Seconds     │
│   • Qualifies Every Lead       │
│   • Books or Transfers         │
│                                 │
─────────────────────────────────
│                                 │
│   📞 CALL ME NOW FORM           │
│   (Your embeddable form)        │
│                                 │
─────────────────────────────────
│                                 │
│   📅 BOOK A DEMO               │
│   (Calendar link)               │
│                                 │
│   💳 BUY NOW                    │
│   (Stripe payment link)         │
│                                 │
─────────────────────────────────
```

---

## Troubleshooting

### **Form doesn't submit?**
- Check browser console for errors (F12)
- Make sure you copied the entire HTML including `<script>` tags
- Verify the API endpoint is correct in the JavaScript

### **No call received?**
- Check if you got a success message
- Wait full 60 seconds
- Check spam/blocked calls on your phone
- Test with a different phone number

### **Duplicate error immediately?**
- The phone+product combo was already submitted
- Use the clear-test command to reset
- Or test with a different phone number

---

## Support

If you have issues:
1. Check the Railway deployment logs
2. Test the API directly with PowerShell (see main README)
3. Verify Vapi assistants are configured correctly

---

## Next Steps

Once forms are live:

1. **Monitor:** Check leads in admin dashboard
2. **Optimize:** Track conversion rates by product
3. **Scale:** Add more products/agents as needed

**You're live! Start sending traffic to your pages!** 🚀
