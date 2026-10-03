# RR Capital UI component guidelines

Keep the existing RR Capital palette, typography, spacing, and theme behavior. Treat the supplied glass examples as interaction and material references; do not copy their demo page backgrounds or global body styles into the product.

## Sliders

Use `src/components/ui/LiquidRange.tsx` for every new range/slider control. It wraps a native `input[type="range"]`, so keyboard interaction, screen-reader semantics, pointer dragging, and responsive sizing remain available. Keep its glass thumb, subtle track, progress fill, and colors tied to the current brand and theme. Extend this shared component when a new slider variant is needed instead of implementing a one-off drag interaction.

## Toggles and buttons

Use the shared `LiquidSwitch` for boolean settings and preferences; keep it theme-aware and expose the checked state accessibly. For buttons, preserve the existing RR Capital button system and use restrained glass highlights/material cues where they fit. Keep labels, focus states, contrast, and touch targets clear. Do not apply the reference's `filter: contrast(3)` or global layout/background rules to the application.

## Navigation and floating actions

Keep desktop and mobile navigation behavior intentionally distinct where the product already does so. The desktop quick-add action floats at the lower right; the mobile quick-add action remains centered in the bottom navigation. Maintain safe-area spacing and avoid introducing extra top padding where the app shell already offsets page content beneath fixed navigation.
