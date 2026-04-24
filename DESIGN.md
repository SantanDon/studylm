---
tokens:
  colors:
    primary: "#6366f1" # Indigo 500 (Vibrant but professional)
    secondary: "#ec4899" # Pink 500 (Used for accents)
    background: "#0f172a" # Slate 900 (The canvas)
    surface: "rgba(255, 255, 255, 0.05)" # Translucent glass surface
    text:
      main: "#f8fafc" # Slate 50
      muted: "#94a3b8" # Slate 400
  typography:
    sans: "'Outfit', sans-serif"
    mono: "'JetBrains Mono', monospace"
    base_size: "16px"
  motion:
    duration: "0.3s"
    easing: "cubic-bezier(0.4, 0, 0.2, 1)"
---

# StudyLM Design Language

## 🎨 Color Theory
The palette is designed for high-focus, late-night study sessions. 
- **The Slate Base:** Provides a stable, low-strain background.
- **Glassmorphism:** We use depth to separate concepts. Sources should feel like they are floating above the notebook content.

## 🧱 Components

### Study Card
A premium container for snippets and notes.
- **Style:** 12px backdrop blur, 1px border (`tokens.colors.surface`).
- **Interaction:** On hover, the border color shifts to `tokens.colors.primary` and the card scales up by 2%.

### Sidebar
The navigation spine of the app.
- **Width:** 280px.
- **Effect:** Fixed position, glass texture, blurred background.

## ♿ Accessibility
- All text on `background` must maintain at least 7:1 contrast.
- Focus rings must be visible and use `tokens.colors.primary`.
