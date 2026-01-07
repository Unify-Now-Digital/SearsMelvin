# Sears Melvin Memorials Website

Modern memorial masonry website for Sears Melvin Memorials, South London.

## 🚀 Deployment

This site is automatically deployed via **Cloudflare Pages**. Any push to the `main` branch triggers a new deployment.

**Live URL:** [Your Cloudflare Pages URL]

## 📁 Project Structure

```
├── index.html      # Main website (single-page)
├── images/         # Local images (when added)
└── README.md       # This file
```

## ✏️ Making Updates

### Option 1: Ask Claude
In your Claude Project, simply say:
- "Update the phone number to..."
- "Change the pricing to..."
- "Add a new testimonial..."
- "Swap the hero image to..."

Claude will provide the updated `index.html` — commit and push to deploy.

### Option 2: Direct Edit
Edit `index.html` directly. Key sections are commented for easy navigation:
- `<!-- Navigation -->` — Menu and logo
- `<!-- Hero Section -->` — Main headline and CTA
- `<!-- About Section -->` — Company story
- `<!-- Services Section -->` — Headstones, Kerbs, Renovations
- `<!-- Process Section -->` — 4-step timeline
- `<!-- Testimonial Section -->` — Customer quote
- `<!-- Gallery Section -->` — Portfolio images
- `<!-- Contact Section -->` — Form and contact details
- `<!-- Footer -->` — Links and copyright

## 🎨 Brand Guidelines

### Colors
- Stone/Charcoal: `#2C2C2C`
- Cream: `#FAF8F5`
- Warm: `#E8E4DD`
- Accent (Bronze): `#8B7355`

### Fonts
- Display: Cormorant Garamond (Google Fonts)
- Body: DM Sans (Google Fonts)

## 📞 Contact Details (Current)

- **Phone:** 01268 208 559
- **Email:** info@searsmelvin.co.uk
- **Location:** South London & Beyond

## 📸 Replacing Stock Images

Current images are from Unsplash. To use your own:

1. Add images to the `images/` folder
2. Update the `src` attributes in `index.html`:
   ```html
   <!-- Change from -->
   <img src="https://images.unsplash.com/..." alt="...">
   
   <!-- To -->
   <img src="images/your-memorial-photo.jpg" alt="...">
   ```

## 🔧 Future Enhancements

- [ ] Contact form backend (n8n workflow or Cloudflare Workers)
- [ ] Google Maps embed for coverage area
- [ ] More gallery images from actual work
- [ ] Customer reviews integration

---

**Maintained by:** Unify Now Digital  
**Last updated:** January 2026
