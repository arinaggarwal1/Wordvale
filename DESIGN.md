---
name: Wordvale
description: A calm, private workspace for local transcription.
colors:
  workspace: "#faf8f3"
  sidebar: "#e5e8df"
  sidebar-border: "#d3dbd1"
  surface: "#ffffff"
  surface-soft: "#edf1e9"
  ink: "#253d3b"
  muted: "#62746d"
  accent: "#426c59"
  accent-hover: "#315646"
  navigation-hover: "#d8e1d6"
  divider: "#dce4dc"
  success: "#287450"
  warning: "#8a5a06"
  danger: "#b13f3e"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "23px"
    fontWeight: 700
    letterSpacing: "-0.02em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 650
    lineHeight: 1.3
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
rounded:
  control: "8px"
  brand: "10px"
  card: "12px"
  pill: "999px"
spacing:
  compact: "8px"
  control: "12px"
  standard: "16px"
  section: "20px"
  workspace: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  navigation-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  privacy-badge:
    textColor: "{colors.accent}"
    rounded: "{rounded.pill}"
    padding: "6px 10px"
---

# Design System: Wordvale

## Overview

**Creative North Star: "The Reading Room"**

Wordvale is a quiet, task-led Mac workspace. Warm paper and muted green frame the work; familiar navigation and restrained system typography keep attention on recordings and transcripts.

Keep the primary workflow easy to scan. Reveal advanced transcription controls when needed, and use status and motion to explain activity rather than decorate it.

**Key Characteristics:**
- Warm off-white workspace and muted green navigation.
- Familiar Mac navigation and compact system typography.
- Focused recording workflow with progressive disclosure.
- Quiet borders, restrained elevation, and accessible interaction states.

## Colors

The palette pairs warm paper with soft botanical greens and dark green ink.

### Primary
- **Reading green:** Active navigation, primary actions, and privacy cues; deepen it on hover.

### Neutral
- **Warm paper:** The main workspace background.
- **Soft sage:** The navigation background and subtle surface layering.
- **White:** Cards and raised surfaces.
- **Green ink and muted text:** Primary content and supporting explanations respectively.
- **Pale dividers:** Separate regions without competing with the work.

### Status
- Success, warning, and danger colors communicate state and potential consequences.

## Typography

The macOS system sans stack carries the interface. The hierarchy is compact and functional: a 23px bold workspace heading, 20px introductory title, 14px controls, and 12–13px supporting copy. Headings use modestly tightened tracking; labels and navigation remain readily scannable.

## Layout

A persistent 232px sidebar anchors navigation beside a scrolling workspace. The header uses 48px horizontal padding, while the main column is centered at a maximum width of 1000px with 20px gaps. At 900px the sidebar narrows to 180px and workspace padding to 28px. At 650px the sidebar becomes a 64px icon rail, workspace padding becomes 20px, and settings and start controls stack. Keep the recording action prominent and advanced settings behind a descriptive disclosure.

## Elevation & Depth

The shell is mostly flat, using tonal surfaces and fine dividers to establish hierarchy. Cards use a subtle shadow (`0 1px 3px rgba(37, 61, 59, 0.05)`); elevated cards use `0 8px 24px rgba(37, 61, 59, 0.12)`. Dialogs and popovers rise above the workspace with stronger shadows and overlays.

## Shapes

Controls and selected navigation use gently rounded 8px corners. Cards use 12px corners; the brand mark uses 10px. Privacy and status badges use a pill silhouette. Borders are quiet and low contrast.

## Components

### Buttons

Primary buttons use reading green, white text, 8px corners, and 10px by 16px padding. Hover deepens the green; active controls scale slightly and disabled controls fade. Secondary buttons use a pale surface and border, while ghost buttons recede until hovered.

### Navigation

A muted green sidebar contains the brand, four labeled destinations, and a quiet privacy statement. The active destination is a solid green rounded row with white text; hover uses pale sage. Keyboard focus is visibly outlined. On narrow windows, retain the icons in a compact rail.

### Inputs and selection

Fields and selection triggers use pale tinted backgrounds, fine borders, 8px corners, and compact padding. Focus shifts the border toward green; text inputs also receive a subtle green ring.

### Cards and dialogs

White cards use light borders and subtle shadows. Dialogs are centered, padded surfaces above a dimmed backdrop; reserve stronger elevation for these temporary layers.

### Disclosure and status

The transcription settings summary presents the current model and language before opening the advanced controls. Its chevron rotates when expanded. Small pill badges communicate privacy or status without taking over the workspace. Respect reduced-motion preferences across transitions and animations.

## Do's and Don'ts

### Do:
- **Do** keep the recording workflow prominent and disclose advanced settings progressively.
- **Do** use muted green for selected navigation and primary action.
- **Do** retain clear keyboard focus and reduced-motion behavior.

### Don't:
- **Don't** overwhelm the workspace with decorative animation or visual complexity.
- **Don't** use strong elevation for ordinary workspace sections.
- **Don't** hide the meaning of navigation when adapting the interface.
