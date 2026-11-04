# CiviForm Flowchart Visualizer Module

This directory contains the standalone, plug-and-play CiviForm Flowchart Visualizer used on Step 3 of `program-generator.html`.

## Files
- `civiform-visualizer.css` — All styles scoped to the visualizer (`program-hero`, `simulator-bar`, `canvas-stage`, `screen-card`, `flow-edge`, etc.).
- `civiform-visualizer.js` — Self-contained JavaScript module exposing `window.CiviFormVisualizer`.

## Plug-In Contract
Any updated version of this module only needs to expose:

```javascript
window.CiviFormVisualizer = {
  mount(containerEl),      // Renders the visualizer shell into containerEl (defaults to #civiform-visualizer-mount)
  render(programWrapper),  // Renders a CiviForm ProgramMigrationWrapper JSON object
  refreshLayout()          // Recalculates sticky offsets and redraws SVG connectors
};
```

To swap in an updated visualizer design later, replace `civiform-visualizer.js` and `civiform-visualizer.css` in this folder.
