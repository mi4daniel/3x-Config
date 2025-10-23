/* layout-designer.js (Updated)
   Public API on window:
     - openLayoutDesigner()
     - handleLayoutUpload(event)
     - removeCameraLayout()
     - getLayoutCanvasAsImage()

   This version includes:
     ✓ Camera-specific icons and a new NVR icon.
     ✓ Automatic FOV creation and linking when a camera is placed.
     ✓ Linked FOV moves with its parent camera.
     ✓ Option to unlink an FOV from its camera.
     ✓ Stale reference bug fixed (just-in-time data fetching).
     ✓ Individual item deletion (button and keyboard shortcuts).
     ✓ Keyboard nudging for precise placement.
     ✓ Item labels on the canvas.
     ✓ FOV color selection.
     ✓ Adjust linked FOV properties when the parent camera is selected.
     ✓ Mouse wheel zoom for the floorplan.
     ✓ Undo/Redo functionality.
     ✓ Rotate a camera and its linked FOV together.
     ✓ FOV range/distance slider when a camera/FOV is selected.
     ✓ Fixed unresponsive close buttons.
     ✓ Wall drawing tool, FOV obstruction, and interactive scaling.
     ✓ NEW: Interactive FOV handles for range, angle, and rotation, simplifying the UI.
*/

const STORAGE_KEY = (window.AppState && window.AppState.STORAGE_KEY) || '3xlogicConfig';
  function getConfig() {
    return window.configuration;
  }

  function saveConfig() {
    if (window.AppState) window.AppState.persistConfiguration(getConfig());
  }

  let layoutBootstrapped = false;

  function bootstrapFromStorage(){
    if (layoutBootstrapped) return;
    const cfg = getConfig();
    if (!cfg) {
      return;
    }
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw); // This is for initial load, can be kept for now.
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.layoutPlacements)) cfg.layoutPlacements = parsed.layoutPlacements;
        if (Array.isArray(parsed.layoutWalls)) cfg.layoutWalls = parsed.layoutWalls;
        if (parsed.cameraLayout) cfg.cameraLayout = parsed.cameraLayout;
        if (parsed.layoutScale) cfg.layoutScale = parsed.layoutScale;
      }
      layoutBootstrapped = true;
    }catch(e){
        console.error("Failed to bootstrap layout from storage:", e);
    }
  }

  bootstrapFromStorage();

  document.addEventListener('ldz:configuration-ready', () => {
    if (!layoutBootstrapped) {
      bootstrapFromStorage();
    }
  });

  // ---- Geometry Helper Functions ---- // This is now global
  function getRayCircleIntersection(origin, direction, radius) {
      const dx = direction.x - origin.x, dy = direction.y - origin.y;
      const a = dx*dx + dy*dy;
      if (a === 0) return null;
      const magnitude = Math.sqrt(a);
      return { x: origin.x + dx / magnitude * radius, y: origin.y + dy / magnitude * radius };
  }
  function lineSegmentsIntersect(p1, q1, p2, q2) {
      function orientation(p, q, r) {
          const val = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
          if (val === 0) return 0; // Collinear
          return (val > 0) ? 1 : 2; // Clockwise or Counterclockwise
      }
      function onSegment(p, q, r) {
          return (q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y));
      }
      const o1 = orientation(p1, q1, p2); const o2 = orientation(p1, q1, q2);
      const o3 = orientation(p2, q2, p1); const o4 = orientation(p2, q2, q1);
      if (o1 !== o2 && o3 !== o4) return true;
      if (o1 === 0 && onSegment(p1, p2, q1)) return true;
      if (o2 === 0 && onSegment(p1, q2, q1)) return true;
      if (o3 === 0 && onSegment(p2, p1, q2)) return true;
      if (o4 === 0 && onSegment(p2, q1, q2)) return true;
      return false;
  }

  // ---- Style injection (scoped) ----
  const STYLE_ID = 'layout-designer-css';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .ldz-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:stretch;justify-content:stretch;background:radial-gradient(circle at top,rgba(15,23,42,0.9),rgba(15,23,42,0.75));backdrop-filter:blur(12px);}
      .ldz-modal{width:100vw;height:100vh;background:linear-gradient(145deg,#f8fafc,#fff);border-radius:0;box-shadow:none;display:grid;grid-template-columns:minmax(300px,380px) minmax(0,1fr) minmax(300px,380px);overflow:hidden;color:#0f172a;position:relative;}
      @media(max-width:1080px){.ldz-modal{grid-template-columns:1fr;grid-template-rows:minmax(0,420px) minmax(0,1fr);height:100vh;}}
      @media(max-width:860px){.ldz-modal{grid-template-rows:minmax(0,380px) minmax(0,1fr);}}
      .ldz-sidebar{max-width:420px;}
      .ldz-sidebar{background:rgba(248,250,252,0.95);backdrop-filter:blur(12px);display:flex;flex-direction:column;}
      .ldz-sidebar-header{padding:28px 28px 20px;border-bottom:1px solid rgba(148,163,184,0.18);display:flex;flex-direction:column;gap:14px;}
      .ldz-title{font-size:1.25rem;font-weight:700;letter-spacing:-0.01em;color:#0f172a;}
      .ldz-subtitle{font-size:0.8rem;color:rgba(15,23,42,0.68);line-height:1.4;margin-bottom:14px;}
      .ldz-stat-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}
      .ldz-chip{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:14px;background:rgba(194,32,51,0.08);border:1px solid rgba(194,32,51,0.18);font-size:0.72rem;color:#c22033;font-weight:600;}
      .ldz-chip span{font-weight:500;color:rgba(34,30,31,0.55);font-size:0.68rem;}
      .ldz-chip strong{font-size:0.95rem;}
      .ldz-chip.alt{background:rgba(16,185,129,0.08);border-color:rgba(16,185,129,0.2);color:#221e1f;}
      .ldz-chip.neutral{background:rgba(34,30,31,0.12);border-color:rgba(34,30,31,0.2);color:#221e1f;}
      .ldz-sidebar-body{padding:20px 28px;display:flex;flex-direction:column;gap:16px;flex:1;overflow:visible;}
      .ldz-sidebar-body .ldz-card{box-shadow:0 12px 32px -28px rgba(15,23,42,0.4);}
      .ldz-section-heading{display:flex;justify-content:space-between;align-items:center;font-size:0.75rem;font-weight:600;color:rgba(15,23,42,0.55);padding-top:4px;gap:12px;}
      .ldz-section-title{flex:1;min-width:0;}
      .ldz-section-tools{display:flex;align-items:center;gap:10px;}
      .ldz-section-count{padding:4px 10px;border-radius:9999px;background:rgba(34,30,31,0.15);color:#221e1f;font-size:0.7rem;font-weight:600;}
      .ldz-scroll-controls{display:inline-flex;align-items:center;gap:6px;}
      .ldz-scroll-btn{width:28px;height:28px;border-radius:8px;border:1px solid rgba(34,30,31,0.2);background:rgba(255,255,255,0.9);color:#221e1f;display:inline-flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;cursor:pointer;transition:all .2s;}
      .ldz-scroll-btn:hover{border-color:rgba(194,32,51,0.45);color:#c22033;}
      .ldz-scroll-btn:disabled{opacity:0.4;cursor:not-allowed;border-color:rgba(34,30,31,0.18);color:rgba(96,92,94,0.7);}
      .ldz-list{flex:1;overflow:auto;padding-right:6px;display:flex;flex-direction:column;gap:10px;max-height:calc(100vh - 420px);}
      .ldz-item{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:16px;border:1px solid rgba(34,30,31,0.18);background:rgba(255,255,255,0.96);box-shadow:0 12px 24px -20px rgba(34,30,31,0.65);cursor:grab;transition:transform .2s,box-shadow .2s,border-color .2s;position:relative;}
      .ldz-item:hover{transform:translateY(-1px);border-color:rgba(194,32,51,0.35);box-shadow:0 18px 32px -24px rgba(194,32,51,0.4);}
      .ldz-item:active{cursor:grabbing;}
      .ldz-item-icon{width:36px;height:36px;border-radius:12px;background:rgba(194,32,51,0.1);display:flex;align-items:center;justify-content:center;overflow:hidden;}
      .ldz-item-icon img{width:100%;height:100%;object-fit:cover;}
      .ldz-item-fallback{font-weight:700;font-size:0.95rem;color:#c22033;}
      .ldz-item-content{flex:1;display:flex;flex-direction:column;gap:4px;}
      .ldz-item-title{font-weight:600;font-size:0.85rem;color:#221e1f;}
      .ldz-item-subtitle{font-size:0.7rem;color:rgba(34,30,31,0.55);}
      .ldz-type-pill{padding:4px 10px;border-radius:9999px;background:rgba(194,32,51,0.15);font-size:0.7rem;font-weight:600;color:#c22033;}
      .ldz-type-pill.nvr{background:rgba(34,30,31,0.12);color:#c22033;}
      .ldz-type-pill.fov{background:rgba(234,179,8,0.18);color:#b45309;}
      .ldz-empty-state{padding:40px 12px;text-align:center;color:rgba(34,30,31,0.45);font-size:0.8rem;}
      .ldz-sidebar-footer{padding:20px 28px 28px;border-top:1px solid rgba(34,30,31,0.18);display:flex;flex-direction:column;gap:18px;background:rgba(246,247,251,0.9);}
      .ldz-card{background:rgba(255,255,255,0.96);border:1px solid rgba(34,30,31,0.2);border-radius:18px;padding:16px;display:flex;flex-direction:column;gap:14px;box-shadow:0 12px 32px -28px rgba(34,30,31,0.45);}
      .ldz-card-title{font-weight:600;font-size:0.8rem;color:#221e1f;display:flex;align-items:center;justify-content:space-between;}
      .ldz-card-actions{display:flex;flex-wrap:wrap;gap:10px;}
      .ldz-chip-btn{padding:8px 14px;border-radius:12px;border:1px solid rgba(34,30,31,0.2);background:rgba(246,247,251,0.9);font-weight:600;font-size:0.75rem;color:#221e1f;cursor:pointer;transition:all .2s;}
      .ldz-chip-btn:hover{border-color:rgba(194,32,51,0.45);color:#c22033;}
      .ldz-chip-btn.active{background:rgba(194,32,51,0.18);border-color:rgba(194,32,51,0.45);color:#c22033;}
      .ldz-chip-btn.danger{background:rgba(194,32,51,0.12);border-color:rgba(194,32,51,0.35);color:#c22033;}
      .ldz-chip-btn.danger:hover{border-color:rgba(194,32,51,0.55);color:#221e1f;}
      .ldz-field{display:flex;flex-direction:column;gap:6px;}
      .ldz-field-header{display:flex;align-items:center;justify-content:space-between;gap:12px;}
      .ldz-label{font-size:0.72rem;color:rgba(34,30,31,0.6);font-weight:500;}
      .ldz-label strong{font-weight:700;color:#221e1f;margin-left:6px;}
      .ldz-range{width:100%;}
      .ldz-stepper{display:inline-flex;gap:6px;}
      .ldz-step-btn{width:28px;height:28px;border-radius:8px;border:1px solid rgba(34,30,31,0.35);background:rgba(246,247,251,0.95);color:#221e1f;font-size:0.85rem;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:all .2s;}
      .ldz-step-btn:hover{border-color:rgba(194,32,51,0.55);color:#c22033;background:rgba(194,32,51,0.12);}
      .ldz-step-btn:disabled{opacity:0.45;cursor:not-allowed;border-color:rgba(34,30,31,0.18);}
      .ldz-colors{display:flex;gap:8px;flex-wrap:wrap;}
      .ldz-color-swatch{width:26px;height:26px;border-radius:9999px;border:2px solid transparent;cursor:pointer;box-shadow:0 6px 12px -10px rgba(34,30,31,0.6);}
      .ldz-color-swatch.selected{border-color:#c22033;}
      .ldz-footer-actions{display:flex;flex-direction:column;gap:12px;}
      .ldz-action-row{display:flex;flex-wrap:wrap;gap:10px;}
      .ldz-icon-btn{flex:1;min-width:120px;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 12px;border-radius:12px;border:1px solid rgba(34,30,31,0.2);background:rgba(255,255,255,0.9);font-weight:600;font-size:0.78rem;color:#221e1f;cursor:pointer;transition:all .2s;}
      .ldz-icon-btn img,.ldz-icon-btn svg{width:18px;height:18px;}
      .ldz-icon-btn:hover{border-color:rgba(194,32,51,0.45);box-shadow:0 12px 26px -20px rgba(194,32,51,0.5);}
      .ldz-icon-btn.primary{background:linear-gradient(135deg,#c22033,#221e1f);color:#f6f7fb;border-color:rgba(194,32,51,0.6);}
      .ldz-icon-btn.primary:hover{box-shadow:0 16px 32px -18px rgba(194,32,51,0.4);}
      .ldz-icon-btn.danger{background:linear-gradient(135deg,#c22033,#000000);color:#fff;border-color:rgba(194,32,51,0.65);}
      .ldz-icon-btn.danger:hover{box-shadow:0 16px 32px -18px rgba(194,32,51,0.45);}
      .ldz-icon-btn.ghost{background:rgba(246,247,251,0.85);color:#221e1f;}
      .ldz-icon-btn.ghost.active{border-color:rgba(194,32,51,0.6);background:rgba(194,32,51,0.12);color:#c22033;}
      .ldz-icon-btn:disabled{opacity:0.45;cursor:not-allowed;box-shadow:none;border-color:rgba(34,30,31,0.18);}
      .ldz-canvas-wrap{position:relative;background:radial-gradient(circle at top,#221e1f,#000000);display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:grab;}
      .ldz-canvas-wrap.wall-mode{cursor:crosshair;}
      .ldz-canvas-toolbar{position:absolute;top:88px;right:24px;display:flex;gap:10px;flex-wrap:wrap;background:rgba(34,30,31,0.75);backdrop-filter:blur(10px);padding:10px 12px;border-radius:16px;border:1px solid rgba(34,30,31,0.3);box-shadow:0 24px 40px -28px rgba(34,30,31,0.8);z-index:5;}
      .ldz-toolbar-group{display:flex;align-items:center;gap:8px;}
      .ldz-toolbar-btn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:10px;border:1px solid rgba(34,30,31,0.35);background:rgba(34,30,31,0.65);color:#f6f7fb;cursor:pointer;transition:all .2s;}
      .ldz-toolbar-btn:hover{border-color:rgba(194,32,51,0.6);background:rgba(194,32,51,0.18);color:#f6c8cf;}
      .ldz-toolbar-btn.active{border-color:rgba(194,32,51,0.8);background:rgba(194,32,51,0.25);color:#fde7ea;}
      .ldz-zoom-indicator{padding:0 10px;font-weight:600;font-size:0.75rem;color:#f6f7fb;}
      #ldzBg,#ldzFov,#ldzWalls{position:absolute;top:0;left:0;}
      #ldzOverlay{position:absolute;top:0;left:0;transform-origin:top left;}
      .ldz-placed{position:absolute;width:36px;height:36px;border-radius:12px;border:2px solid rgba(255,255,255,0.9);display:flex;align-items:center;justify-content:center;color:#fff;font:600 14px/1 'Inter',sans-serif;cursor:grab;user-select:none;box-shadow:0 14px 32px -24px rgba(34,30,31,0.85);pointer-events:auto;}
      .ldz-placed.camera{background:linear-gradient(160deg,rgba(194,32,51,0.9),rgba(194,32,51,0.85));border-radius:18px;}
      .ldz-placed.nvr{background:linear-gradient(160deg,rgba(100,116,139,0.95),rgba(71,85,105,0.92));font-size:12px;font-weight:700;}
      .ldz-placed.fov{background:rgba(234,179,8,0.75);border-radius:18px;}
      .ldz-placed.fov.linked{display:none;}
      .ldz-placed.selected{box-shadow:0 0 0 4px rgba(194,32,51,0.55);}
      .ldz-placed-label{position:absolute;top:100%;left:50%;transform:translateX(-50%);background:rgba(34,30,31,0.9);color:#f6f7fb;font-size:0.68rem;padding:4px 8px;border-radius:8px;white-space:nowrap;margin-top:6px;font-weight:500;pointer-events:auto;}
      .ldz-camera-rotate-handle{display:none;position:absolute;top:-18px;left:50%;transform:translateX(-50%);width:12px;height:12px;background:#c22033;border:2px solid #fff;border-radius:9999px;cursor:crosshair;}
      .ldz-placed.selected .ldz-camera-rotate-handle{display:block;}
      .ldz-close{position:absolute;top:18px;right:18px;background:rgba(246,247,251,0.9);border:1px solid rgba(34,30,31,0.3);border-radius:12px;padding:8px;cursor:pointer;z-index:10;display:flex;align-items:center;justify-content:center;transition:all .2s;}
      .ldz-close:hover{border-color:rgba(194,32,51,0.6);background:rgba(194,32,51,0.15);}
      .ldz-close img{width:24px;height:24px;}
      #context-menu button{display:block;width:100%;padding:8px 12px;text-align:left;background:none;border:none;cursor:pointer;}
      .ldz-item-badge{position:absolute;left:8px;top:8px;background:#c22033;color:#fff;width:18px;height:18px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:700;}
      .ldz-placed-badge{position:absolute;right:-8px;bottom:-8px;background:#fff;color:#c22033;width:18px;height:18px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-size:0.68rem;font-weight:700;border:2px solid rgba(34,30,31,0.12);transform-origin:center;}
      .ldz-place-label-input{font-size:0.68rem;padding:3px 6px;border-radius:6px;border:1px solid rgba(0,0,0,0.12);outline:none;}
      .ldz-scale-input-wrap{display:none;align-items:center;gap:8px;}
      .ldz-scale-handle{position:absolute;width:14px;height:14px;background:#fff;border-radius:9999px;cursor:move;border:2px solid #10b981;box-shadow:0 2px 8px rgba(0,0,0,0.3);}
      .ldz-fov-handle{position:absolute;width:14px;height:14px;background:#fff;border-radius:9999px;cursor:crosshair;border:2px solid #c22033;box-shadow:0 2px 8px rgba(0,0,0,0.3);z-index:10;}
    `;
    document.head.appendChild(style);
  }

  window.removeCameraLayout = function removeCameraLayout(){
    if (!confirm('Remove the layout image and all placed items and walls?')) return;
    const cfg = getConfig();
    cfg.cameraLayout = null;
    cfg.layoutPlacements = [];
    cfg.layoutWalls = [];
    saveConfig();
    if (typeof window.renderAll === 'function') window.renderAll();
    if (typeof window.showToast === 'function') window.showToast('Camera layout removed.');
  };

  // ---- Public: Upload / Remove ----
  window.handleLayoutUpload = function handleLayoutUpload(event){
    const file = event?.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e)=>{
      const cfg = getConfig();
      cfg.cameraLayout = e.target.result;
      cfg.layoutPlacements = [];
      cfg.layoutWalls = [];
      saveConfig();
      if (typeof window.renderAll === 'function') window.renderAll();
      if (typeof window.showToast === 'function') window.showToast('Camera layout uploaded.');
    };
    reader.readAsDataURL(file);
    if (event?.target) event.target.value = '';
  };

  // ---- Main UI ----
  window.openLayoutDesigner = function openLayoutDesigner(){
    const cfg = getConfig();
    if (!cfg.cameraLayout){
      alert('Please upload a site layout image first (Tools → Upload Layout).');
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'ldz-overlay';
    overlay.innerHTML = `
      <div class="ldz-modal">
        <!-- Left Sidebar for Available Items -->
        <aside class="ldz-sidebar" style="border-right: 1px solid rgba(148,163,184,0.18);">
          <header class="ldz-sidebar-header">
            <div class="ldz-title">Camera Layout Designer</div>
            <p class="ldz-subtitle">Drag items from this list onto the floorplan.</p>
          </header>
          <div class="ldz-sidebar-body">
            <div class="ldz-section-heading">
              <span class="ldz-section-title">Available items</span>
              <div class="ldz-section-tools">
                <span class="ldz-section-count" id="ldzAvailableTotal">0</span>
                <div class="ldz-scroll-controls">
                  <button type="button" class="ldz-scroll-btn" id="ldzScrollUp" title="Scroll up" aria-label="Scroll up" disabled>&#8593;</button>
                  <button type="button" class="ldz-scroll-btn" id="ldzScrollDown" title="Scroll down" aria-label="Scroll down" disabled>&#8595;</button>
                </div>
              </div>
            </div>
            <div class="ldz-list" id="ldzItems"></div>
          </div>
        </aside>

        <!-- Canvas Area -->
        <div class="ldz-canvas-wrap">
          <button class="ldz-close" id="ldzX"><img src="/icons/close-circle-twotone_.png" alt="Close"></button>
          <div class="ldz-canvas-toolbar">
            <div class="ldz-toolbar-group">
              <button class="ldz-toolbar-btn" id="ldzZoomOut" title="Zoom out">&minus;</button>
              <span class="ldz-zoom-indicator" id="ldzZoomIndicator">100%</span>
              <button class="ldz-toolbar-btn" id="ldzZoomIn" title="Zoom in">+</button>
            </div>
            <div class="ldz-toolbar-group">
              <button class="ldz-toolbar-btn" id="ldzFitView" title="Fit to screen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 9 3 3 9 3"></polyline><polyline points="15 3 21 3 21 9"></polyline><polyline points="21 15 21 21 15 21"></polyline><polyline points="9 21 3 21 3 15"></polyline></svg></button>
              <button class="ldz-toolbar-btn" id="ldzZoomReset" title="Reset zoom">100%</button>
              <button class="ldz-toolbar-btn" id="ldzGridToggle" title="Toggle grid"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18"></rect><path d="M9 3v18"></path><path d="M15 3v18"></path><path d="M3 9h18"></path><path d="M3 15h18"></path></svg></button>
            </div>
          </div>
          <canvas id="ldzBg"></canvas>
          <canvas id="ldzFov"></canvas>
          <canvas id="ldzWalls"></canvas>
          <div id="ldzOverlay"></div>
        </div>

        <!-- Right Sidebar for Tools & Controls -->
        <aside class="ldz-sidebar" style="border-left: 1px solid rgba(148,163,184,0.18);">
            <header class="ldz-sidebar-header">
                <p class="ldz-subtitle">Select an item on the floorplan to see its properties, or use the tools below to manage the layout.</p>
            </header>
            <div class="ldz-sidebar-body">
                <div class="ldz-card">
                    <div class="ldz-card-title">Layout tools</div>
                    <div class="ldz-action-row">
                        <button id="ldzUndo" class="ldz-icon-btn ghost"><img src="/icons/undo.png" alt="Undo"><span>Undo</span></button>
                        <button id="ldzRedo" class="ldz-icon-btn ghost"><img src="/icons/redo.png" alt="Redo"><span>Redo</span></button>
                        <button id="ldzDrawWall" class="ldz-icon-btn ghost"><img src="/icons/wall_.png" alt="Draw Walls"><span>Wall mode</span></button>
                    </div>
                </div>
                <div id="ldzSelectionControls" class="ldz-card" style="display:none;">
                    <div class="ldz-card-title">Selection</div>
                    <div class="ldz-card-actions">
                        <button id="ldzLinkBtn" class="ldz-chip-btn" style="display:none;">Link FOV</button>
                        <button id="ldzUnlinkBtn" class="ldz-chip-btn" style="display:none;">Unlink FOV</button>
                    </div>
                    <div id="ldzCameraRangeControl" class="ldz-field" style="display:none;">
                        <div class="ldz-field-header">
                            <span class="ldz-label">Camera FOV Distance<strong id="ldzCameraRangeValue">—</strong></span>
                            <div class="ldz-stepper">
                                <button type="button" class="ldz-step-btn" id="ldzCameraRangeDecrease" aria-label="Decrease camera range" disabled>&minus;</button>
                                <button type="button" class="ldz-step-btn" id="ldzCameraRangeIncrease" aria-label="Increase camera range" disabled>+</button>
                            </div>
                        </div>
                        <input id="ldzCameraRange" class="ldz-range" type="range" min="1" max="2000" value="60">
                    </div>
                    <button id="ldzDeleteBtn" class="ldz-icon-btn danger"><img src="/icons/delete_.png" alt="Delete"><span>Remove from layout</span></button>
                </div>
                <div id="ldzFovControls" class="ldz-card" style="display:none;">
                    <div class="ldz-card-title">Coverage settings</div>
                    <div class="ldz-field"><span class="ldz-label">FOV Angle <strong id="ldzFovAngleValue">90°</strong></span><input id="ldzFovAngle" class="ldz-range" type="range" min="5" max="360" value="90"></div>
                    <div class="ldz-field"><div class="ldz-field-header"><span class="ldz-label">FOV Range<strong id="ldzFovRangeValue">—</strong></span></div><input id="ldzFovRange" class="ldz-range" type="range" min="1" max="2000" value="60"></div>
                    <div class="ldz-colors" id="ldzFovColors"><button class="ldz-color-swatch selected" style="background:rgba(234,179,8,0.5)" data-color="rgba(234,179,8,0.5)"></button><button class="ldz-color-swatch" style="background:rgba(239,68,68,0.4)" data-color="rgba(239,68,68,0.4)"></button><button class="ldz-color-swatch" style="background:rgba(34,197,94,0.4)" data-color="rgba(34,197,94,0.4)"></button><button class="ldz-color-swatch" style="background:rgba(139,92,246,0.4)" data-color="rgba(139,92,246,0.4)"></button></div>
                    <div class="ldz-field"><div class="ldz-field-header"><span class="ldz-label">FOV Rotation<strong id="ldzFovRotationValue">—</strong></span></div><input id="ldzFovRotation" class="ldz-range" type="range" min="0" max="360" value="0"></div>
                </div>
                <div class="ldz-card" id="ldzScaleCard">
                    <div class="ldz-card-title">Floorplan Scale</div>
                    <div class="ldz-field">
                        <div class="ldz-scale-input-wrap" id="ldzScaleInputWrap">
                            <input type="number" id="ldzScaleDistanceInput" value="10" class="ldz-place-label-input" style="width:60px; text-align:right;">
                            <span class="ldz-label">feet</span>
                        </div>
                        <button id="ldzSetScaleBtn" class="ldz-icon-btn ghost"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" style="width:18px;height:18px;"><path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3.5 1a.5.5 0 00-.5.5v2a.5.5 0 001 0v-2a.5.5 0 00-.5-.5zM6 13.5a.5.5 0 01.5-.5h8a.5.5 0 010 1H6.5a.5.5 0 01-.5-.5z" clip-rule="evenodd"/></svg><span id="ldzSetScaleBtnText">Scale Floor Plan</span></button>
                    </div>
                     <div class="ldz-field-header">
                        <span class="ldz-label">Current: <strong id="ldzScaleValue">1.00 px/ft</strong></span>
                    </div>
                </div>
            </div>
            <div class="ldz-sidebar-footer">
                <div class="ldz-footer-actions">
                    <div class="ldz-action-row"><button id="ldzReset" class="ldz-icon-btn danger"><img src="/icons/reset-left-line_.png" alt="Reset"><span>Reset layout</span></button><button id="ldzDownload" class="ldz-icon-btn primary"><img src="/icons/image-download_.png" alt="Download"><span>Export image</span></button></div>
                    <button id="ldzClose" class="ldz-icon-btn ghost"><img src="/icons/close-circle-twotone_.png" alt="Close"><span>Close designer</span></button>
                </div>
            </div>
        </aside>
      </div>
`;
    document.body.appendChild(overlay);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const schedule = typeof window.requestAnimationFrame === 'function'
      ? (fn) => window.requestAnimationFrame(fn)
      : (fn) => setTimeout(fn, 0);
    
    const wrap = overlay.querySelector('.ldz-canvas-wrap');
    const bg = overlay.querySelector('#ldzBg');
    const fovCanvas = overlay.querySelector('#ldzFov');
    const wallCanvas = overlay.querySelector('#ldzWalls');
    const overlayLayer = overlay.querySelector('#ldzOverlay');
    const fovAngleInput = overlay.querySelector('#ldzFovAngle');
    const fovAngleValue = overlay.querySelector('#ldzFovAngleValue');
    const fovRangeInput = overlay.querySelector('#ldzFovRange');
    const fovRangeValue = overlay.querySelector('#ldzFovRangeValue');
    const fovColors = overlay.querySelector('#ldzFovColors');
    const fovRotationInput = overlay.querySelector('#ldzFovRotation');
    const fovRotationValue = overlay.querySelector('#ldzFovRotationValue');
    const selectionControls = overlay.querySelector('#ldzSelectionControls');
    const cameraRangeControl = overlay.querySelector('#ldzCameraRangeControl');
    const cameraRangeInput = overlay.querySelector('#ldzCameraRange');
    const cameraRangeValue = overlay.querySelector('#ldzCameraRangeValue');
    const cameraRangeDecreaseBtn = overlay.querySelector('#ldzCameraRangeDecrease');
    const cameraRangeIncreaseBtn = overlay.querySelector('#ldzCameraRangeIncrease');
    const deleteBtn = overlay.querySelector('#ldzDeleteBtn');
    const linkBtn = overlay.querySelector('#ldzLinkBtn');
    const unlinkBtn = overlay.querySelector('#ldzUnlinkBtn');
    const itemsListEl = overlay.querySelector('#ldzItems');
    const scrollUpBtn = overlay.querySelector('#ldzScrollUp');
    const scrollDownBtn = overlay.querySelector('#ldzScrollDown');
    const drawWallBtn = overlay.querySelector('#ldzDrawWall');
    const scaleInputWrap = overlay.querySelector('#ldzScaleInputWrap');
    const scaleDistanceInput = overlay.querySelector('#ldzScaleDistanceInput');
    const setScaleBtnText = overlay.querySelector('#ldzSetScaleBtnText');
    const zoomIndicator = overlay.querySelector('#ldzZoomIndicator');
    const zoomInBtn = overlay.querySelector('#ldzZoomIn');
    const zoomOutBtn = overlay.querySelector('#ldzZoomOut');
    const zoomResetBtn = overlay.querySelector('#ldzZoomReset');
    const fitViewBtn = overlay.querySelector('#ldzFitView');
    const gridToggleBtn = overlay.querySelector('#ldzGridToggle');
    const scaleValueEl = overlay.querySelector('#ldzScaleValue');
    const setScaleBtn = overlay.querySelector('#ldzSetScaleBtn');
    const ctx = bg.getContext('2d');
    const fovControls = overlay.querySelector('#ldzFovControls');
    const fovCtx = fovCanvas.getContext('2d');
    const wallCtx = wallCanvas.getContext('2d');
    const img = new Image();

    // -- State Management --
    let view = { scale: 1, x: 0, y: 0 };
    let history = [];
    let historyIndex = -1;
    let selectedId = null;
    let currentMode = 'place'; // 'place', 'drawWall', 'linkFov', 'scale'
    let showGrid = false;
    let fovHistoryTimer = null;
    let listResizeObserver = null;
    let listMutationObserver = null;
    let scaleLine = null;

    // pixelsPerFoot = how many pixels equal one foot on the floorplan
    let pixelsPerFoot = Math.max(0.0001, Number(cfg.layoutScale || 1));

    const RANGE_STEP = 10;
    const ROTATION_STEP = 5;

    // ---- History Management ----
    function updateHistoryButtons() {
        overlay.querySelector('#ldzUndo').disabled = historyIndex <= 0;
        overlay.querySelector('#ldzRedo').disabled = historyIndex >= history.length - 1;
    }

    function saveHistory() {
        history.splice(historyIndex + 1);
        const currentState = {
            placements: JSON.parse(JSON.stringify(getConfig().layoutPlacements)),
            walls: JSON.parse(JSON.stringify(getConfig().layoutWalls))
        };
        history.push(currentState);
        historyIndex++;
        updateHistoryButtons();
    }

    function undo() {
        if (historyIndex > 0) {
            historyIndex--;
            const previousState = history[historyIndex];
            getConfig().layoutPlacements = JSON.parse(JSON.stringify(previousState.placements));
            getConfig().layoutWalls = JSON.parse(JSON.stringify(previousState.walls));
            redraw();
            updateHistoryButtons();
        }
    }

    function redo() {
        if (historyIndex < history.length - 1) {
            historyIndex++;
            const nextState = history[historyIndex];
            getConfig().layoutPlacements = JSON.parse(JSON.stringify(nextState.placements));
            getConfig().layoutWalls = JSON.parse(JSON.stringify(nextState.walls));
            redraw();
            updateHistoryButtons();
        }
    }

    function collectItems(){
      const cfg = getConfig();
      const toArray = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
      const racks = toArray(cfg.racks).map(r => ({ ...r, devices: toArray(r.devices).map(d => ({ ...d, cameras: toArray(d.cameras) })) }));
      const rackCameras = racks.flatMap(r => r.devices.flatMap(d => d.cameras));
      const allCams = [ ...rackCameras, ...toArray(cfg.cloudCameras), ...toArray(cfg.allInOneCameras) ];
      let nextId = 1;
      allCams.forEach(c=>{
        if (typeof c.instanceId === 'undefined' || c.instanceId === null) c.instanceId = (typeof c.id !== 'undefined' && c.id !== null) ? c.id : (Date.now() + nextId++);
        if (typeof c.quantity === 'undefined' || isNaN(c.quantity)) c.quantity = 1;
        if (!c.name && c.product?.name) c.name = c.product.name;
      });
      const allNvrs = racks.flatMap(r => r.devices.filter(d => d.product?.deviceType==='nvr'));
      return {allCams, allNvrs};
    }

    function getListViewportHeight(){
      if (!itemsListEl) return 0;
      const rect = itemsListEl.getBoundingClientRect();
      if (rect && rect.height) return rect.height;
      if (itemsListEl.clientHeight) return itemsListEl.clientHeight;
      return 0;
    }

    function updateScrollButtons(){
      if (!itemsListEl || !scrollUpBtn || !scrollDownBtn) return;
      const viewport = getListViewportHeight();
      const maxScroll = Math.max(0, itemsListEl.scrollHeight - viewport);
      const epsilon = 2;
      scrollUpBtn.disabled = itemsListEl.scrollTop <= epsilon;
      scrollDownBtn.disabled = maxScroll <= epsilon || itemsListEl.scrollTop >= (maxScroll - epsilon);
    }

    function scrollListBy(multiplier){
      if (!itemsListEl) return;
      const viewport = itemsListEl.clientHeight;
      const maxScroll = Math.max(0, itemsListEl.scrollHeight - viewport);
      if (maxScroll <= 0) return;

      const delta = viewport * multiplier;
      const target = Math.max(0, Math.min(itemsListEl.scrollTop + delta, maxScroll));

      if (typeof itemsListEl.scrollTo === 'function') {
        itemsListEl.scrollTo({ top: target, behavior: 'smooth' });
      } else if (typeof itemsListEl.scrollBy === 'function') {
        itemsListEl.scrollBy({ top: target - itemsListEl.scrollTop });
      } else {
        itemsListEl.scrollTop = target;
      }

      schedule(updateScrollButtons);
      setTimeout(updateScrollButtons, 250);
    }

    if (scrollUpBtn) {
      scrollUpBtn.addEventListener('click', () => scrollListBy(-1));
    }

    if (scrollDownBtn) {
      scrollDownBtn.addEventListener('click', () => scrollListBy(1));
    }

    if (itemsListEl) {
      listScrollListener = () => schedule(updateScrollButtons);
      itemsListEl.addEventListener('scroll', listScrollListener);
    }

    function renderItemsList(){
      const list = itemsListEl;
      if (!list) return;
      const cfg = getConfig();
      const placed = new Set((cfg.layoutPlacements||[]).map(p=>p.uniqueId));
      const {allCams, allNvrs} = collectItems();
      const items = [];

      const fovUid = `fov-${Date.now()}`;
      items.push({
        type:'fov',
        uniqueId:fovUid,
        name:'Adjustable FOV',
        subtitle:'Standalone coverage zone',
        isTemplate:true
      });

      allCams.forEach(cam=>{
        const qty = Math.max(1, parseInt(cam.quantity,10) || 1);
        for (let i=0;i<qty;i++){
          const uid = `${cam.instanceId}-${i}`;
          if (placed.has(uid)) continue;
          items.push({
          index: i,
            type:'camera',
            uniqueId:uid,
            name:cam.name||cam.id||`Camera ${cam.instanceId}`,
            subtitle:cam.product?.model||cam.product?.sku||'Network camera',
            image:cam.image||cam.product?.image
          });
        }
      });

      allNvrs.forEach(nvr=>{
        
        const uid = `nvr-${nvr.id}`;
        if (placed.has(uid)) return;
        items.push({
          type:'nvr',
          uniqueId:uid,
          name:nvr.product?.name||nvr.id||'NVR',
          subtitle:nvr.product?.model||'Video recorder',
          image:nvr.product?.image
        });
      });

      if (!items.length){
        list.innerHTML = '<div class="ldz-empty-state">No items available to place.</div>';
        schedule(updateScrollButtons);
        return;
      }

      const rows = items.map(item=>{
        
        const typeClass = item.type === 'nvr' ? 'ldz-type-pill nvr' : item.type === 'fov' ? 'ldz-type-pill fov' : 'ldz-type-pill';
        const typeLabel = item.isTemplate ? 'FOV template' : item.type === 'nvr' ? 'Recorder' : item.type === 'camera' ? 'Camera' : 'FOV';
        const fallbackChar = (String(item.name||'').trim().charAt(0) || '?').toUpperCase();
        const icon = item.image ? `<img src="${item.image}" alt="">` : `<span class="ldz-item-fallback">${fallbackChar}</span>`;
        const subtitle = item.subtitle || 'Drag onto the layout';
        const badge = item.index ? `<span class="ldz-item-badge">${item.index}</span>` : '';
        return `
          <div class="ldz-item" draggable="true" data-type="${item.type}" data-uid="${item.uniqueId}">
            ${badge}
            <div class="ldz-item-icon">${icon}</div>
            <div class="ldz-item-content">
              <div class="ldz-item-title">${item.name||item.uniqueId}</div>
              <div class="ldz-item-subtitle">${subtitle}</div>
            </div>
            <span class="${typeClass}">${typeLabel}</span>
          </div>
        `;
      });

      list.innerHTML = rows.join('');
      list.scrollTop = 0;
      schedule(updateScrollButtons);

      list.querySelectorAll('.ldz-item').forEach(el=>{
        el.addEventListener('dragstart', (e)=>{
          e.dataTransfer.setData('text/plain', JSON.stringify({ type: el.dataset.type, uniqueId: el.dataset.uid }));
        });
      });
    }

    function updatePlacementStats(){
      const cfg = getConfig();
      const placements = cfg.layoutPlacements || [];
      const countType = (type) => placements.filter(p => p.type === type).length;
    }

    function updateZoomDisplay(){
      if (zoomIndicator) {
        const pct = Math.round(view.scale * 100);
        zoomIndicator.textContent = `${pct}%`;
      }
    }

    function setZoom(newScale, originX, originY){
      const rect = wrap.getBoundingClientRect();
      const ox = typeof originX === 'number' ? originX : rect.width / 2;
      const oy = typeof originY === 'number' ? originY : rect.height / 2;
      const oldScale = view.scale || 1;
      newScale = Math.max(0.1, Math.min(newScale, 10));
      view.x = ox - (ox - view.x) * (newScale / oldScale);
      view.y = oy - (oy - view.y) * (newScale / oldScale);
      view.scale = newScale;
      redraw();
      updateZoomDisplay();
    }

    function drawGrid(targetCtx){
      if (!showGrid) return;
      targetCtx.save();
      const step = 100;
      if (!img.width || !img.height) { targetCtx.restore(); return; }
      targetCtx.lineWidth = Math.max(0.5, 1 / view.scale);
      targetCtx.strokeStyle = 'rgba(226,232,240,0.7)';
      targetCtx.globalAlpha = 0.35;
      targetCtx.beginPath();
      for (let x = 0; x <= img.width; x += step) {
        targetCtx.moveTo(x, 0);
        targetCtx.lineTo(x, img.height);
      }
      for (let y = 0; y <= img.height; y += step) {
        targetCtx.moveTo(0, y);
        targetCtx.lineTo(img.width, y);
      }
      targetCtx.stroke();
      targetCtx.restore();
    }

    // ---- Drawing & View Logic ----
    function redraw() {
        const wrap = overlay.querySelector('.ldz-canvas-wrap');
        bg.width = wrap.clientWidth; bg.height = wrap.clientHeight;
        fovCanvas.width = bg.width; fovCanvas.height = bg.height;
        wallCanvas.width = bg.width; wallCanvas.height = bg.height;

        ctx.clearRect(0, 0, bg.width, bg.height);
        fovCtx.clearRect(0, 0, fovCanvas.width, fovCanvas.height);
        wallCtx.clearRect(0,0, wallCanvas.width, wallCanvas.height);

        ctx.save(); fovCtx.save(); wallCtx.save();
        ctx.translate(view.x, view.y); ctx.scale(view.scale, view.scale);
        fovCtx.translate(view.x, view.y); fovCtx.scale(view.scale, view.scale);
        wallCtx.translate(view.x, view.y); wallCtx.scale(view.scale, view.scale);

        ctx.drawImage(img, 0, 0);
        drawGrid(ctx);
        drawWalls(wallCtx);
        drawFovs();
        if (currentMode === 'scale' && scaleLine) {
            wallCtx.save();
            wallCtx.translate(view.x, view.y);
            wallCtx.scale(view.scale, view.scale);
            wallCtx.strokeStyle = '#10b981';
            wallCtx.lineWidth = 3 / view.scale;
            wallCtx.setLineDash([5 / view.scale, 5 / view.scale]);
            wallCtx.lineCap = 'round';
            wallCtx.beginPath();
            wallCtx.moveTo(scaleLine.x1, scaleLine.y1);
            wallCtx.lineTo(scaleLine.x2, scaleLine.y2);
            wallCtx.stroke();
            wallCtx.restore();
        }

        ctx.restore(); fovCtx.restore(); wallCtx.restore();

        overlayLayer.style.width = `${img.width}px`;
        overlayLayer.style.height = `${img.height}px`;
        overlayLayer.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;

        renderPlacedMarkers();
        renderInteractiveHandles();
        updatePlacementStats();
    }

    function resetView() {
        const wrap = overlay.querySelector('.ldz-canvas-wrap');
        const W = wrap.clientWidth, H = wrap.clientHeight;
        const imgRatio = img.width / img.height;
        const wrapRatio = W / H;
        const initialScale = (wrapRatio > imgRatio) ? H / img.height : W / img.width;

        view.scale = initialScale;
        view.x = (W - img.width * view.scale) / 2;
        view.y = (H - img.height * view.scale) / 2;

        redraw();
        updateZoomDisplay();
    }

    function drawWalls(targetCtx) {
        const cfg = getConfig();
        if (!cfg.layoutWalls) return;

        targetCtx.strokeStyle = '#ff3b30';
        targetCtx.lineWidth = 3 / view.scale;
        targetCtx.lineCap = 'round';
        targetCtx.beginPath();
        cfg.layoutWalls.forEach(wall => {
            targetCtx.moveTo(wall.x1, wall.y1);
            targetCtx.lineTo(wall.x2, wall.y2);
        });
        targetCtx.stroke();
    }
    
    function drawFovs(){
        const cfg = getConfig();
        const walls = cfg.layoutWalls || [];

        (cfg.layoutPlacements || []).forEach(p => {
            if (p.type !== 'fov') return;

            let fovOrigin = { x: p.x, y: p.y };
            // If FOV is linked, always get position from the parent camera to prevent desync.
            if (p.linkedTo) {
                const parentCam = cfg.layoutPlacements.find(cam => cam.uniqueId === p.linkedTo);
                if (parentCam) {
                    fovOrigin = { x: parentCam.x, y: parentCam.y };
                }
            }
            const fovAngle = p.fov?.angle ?? 90;
            // range stored in feet: rangeFt (new). If legacy 'range' exists and no rangeFt, use it as px fallback.
            const fovRangePx = (typeof p.fov?.rangeFt === 'number')
                ? (p.fov.rangeFt * pixelsPerFoot)
                : (p.fov?.range ?? 60);
            const fovRotation = (p.fov?.rotation ?? 0) * Math.PI / 180;
            const halfAngleRad = (fovAngle / 2) * Math.PI / 180;

            // 1. Draw the base FOV cone
            fovCtx.save();
            fovCtx.translate(fovOrigin.x, fovOrigin.y);
            fovCtx.rotate(fovRotation);
            fovCtx.beginPath();
            if (fovAngle < 360) {
                fovCtx.moveTo(0, 0);
                fovCtx.arc(0, 0, fovRangePx, -halfAngleRad, halfAngleRad);
                fovCtx.closePath();
            } else {
                fovCtx.arc(0, 0, fovRangePx, 0, 2 * Math.PI);
            }
            fovCtx.fillStyle = p.fov?.color || 'rgba(255,255,0,.25)';
            fovCtx.fill();
            fovCtx.restore();

            if (walls.length === 0) return;

            // 2. Erase shadows from the lit area using destination-out
            fovCtx.globalCompositeOperation = 'destination-out';
            fovCtx.fillStyle = 'black'; // Color doesn't matter for this operation

            walls.forEach(wall => {
                const wallP1 = {x: wall.x1, y: wall.y1};
                const wallP2 = {x: wall.x2, y: wall.y2};

                // Project wall endpoints to a very large distance to form the shadow polygon
                const shadowP1 = getRayCircleIntersection(fovOrigin, wallP1, 10000);
                const shadowP2 = getRayCircleIntersection(fovOrigin, wallP2, 10000);
                
                if(!shadowP1 || !shadowP2) return;

                fovCtx.beginPath();
                fovCtx.moveTo(wallP1.x, wallP1.y);
                fovCtx.lineTo(wallP2.x, wallP2.y);
                fovCtx.lineTo(shadowP2.x, shadowP2.y);
                fovCtx.lineTo(shadowP1.x, shadowP1.y);
                fovCtx.closePath();
                fovCtx.fill();

            });
            // Reset composite operation for the next FOV cone
            fovCtx.globalCompositeOperation = 'source-over';
        });
    }

    // Export function (makes a standalone image of current layout including FOVs, walls and markers)
    window.getLayoutCanvasAsImage = async function() {
        if (!img.width || !img.height) return null;
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = img.width;
        exportCanvas.height = img.height;
        const ex = exportCanvas.getContext('2d');

        // Draw base image
        ex.drawImage(img, 0, 0);

        // Draw FOVs (similar logic to drawFovs but using ex)
        const cfg2 = getConfig();
        const walls = cfg2.layoutWalls || [];
        (cfg2.layoutPlacements || []).forEach(p => {
            if (p.type !== 'fov') return;

            let fovOrigin = { x: p.x, y: p.y };
            if (p.linkedTo) {
                const parentCam = cfg2.layoutPlacements.find(cam => cam.uniqueId === p.linkedTo);
                if (parentCam) fovOrigin = { x: parentCam.x, y: parentCam.y };
            }
            const fovAngle = p.fov?.angle ?? 90;
            const fovRangePx = (typeof p.fov?.rangeFt === 'number') ? (p.fov.rangeFt * pixelsPerFoot) : (p.fov?.range ?? 60);
            const fovRotation = (p.fov?.rotation ?? 0) * Math.PI / 180;
            const halfAngleRad = (fovAngle / 2) * Math.PI / 180;

            ex.save();
            ex.translate(fovOrigin.x, fovOrigin.y);
            ex.rotate(fovRotation);
            ex.beginPath();
            if (fovAngle < 360) {
              ex.moveTo(0,0);
              ex.arc(0,0,fovRangePx, -halfAngleRad, halfAngleRad);
              ex.closePath();
            } else {
              ex.arc(0,0,fovRangePx, 0, Math.PI*2);
            }
            ex.fillStyle = p.fov?.color || 'rgba(255,255,0,0.25)';
            ex.fill();
            ex.restore();

            // Shadows
            if (walls.length>0) {
              ex.save();
              ex.globalCompositeOperation = 'destination-out';
              ex.fillStyle = 'black';
              walls.forEach(wall=>{
                const wallP1 = {x: wall.x1, y: wall.y1};
                const wallP2 = {x: wall.x2, y: wall.y2};
                const shadowP1 = getRayCircleIntersection(fovOrigin, wallP1, 10000);
                const shadowP2 = getRayCircleIntersection(fovOrigin, wallP2, 10000);
                if (!shadowP1 || !shadowP2) return;
                ex.beginPath();
                ex.moveTo(wallP1.x, wallP1.y);
                ex.lineTo(wallP2.x, wallP2.y);
                ex.lineTo(shadowP2.x, shadowP2.y);
                ex.lineTo(shadowP1.x, shadowP1.y);
                ex.closePath();
                ex.fill();
              });
              ex.restore();
            }
        });

        // Draw walls
        ex.save();
        ex.strokeStyle = '#ff3b30';
        ex.lineWidth = 3;
        ex.lineCap = 'round';
        ex.beginPath();
        (cfg2.layoutWalls || []).forEach(w=>{
          ex.moveTo(w.x1, w.y1);
          ex.lineTo(w.x2, w.y2);
        });
        ex.stroke();
        ex.restore();

        // Draw markers (simple circle + number badge + text)
        (cfg2.layoutPlacements || []).forEach(p=>{
          if (p.type === 'camera') {
            ex.save();
            ex.beginPath();
            ex.fillStyle = '#c22033';
            ex.strokeStyle = '#fff';
            ex.lineWidth = 2;
            ex.arc(p.x, p.y, 18, 0, Math.PI*2);
            ex.fill();
            ex.stroke();
            ex.restore();

            // number badge
            const idx = String(p.uniqueId).split('-').slice(-1)[0];
            if (idx != null) {
              ex.save();
              ex.fillStyle = '#fff';
              ex.strokeStyle = 'rgba(34,30,31,0.12)';
              ex.lineWidth = 2;
              ex.beginPath();
              ex.arc(p.x + 12, p.y + 12, 9, 0, Math.PI*2);
              ex.fill();
              ex.stroke();
              ex.fillStyle = '#c22033';
              ex.font = 'bold 11px sans-serif';
              ex.textAlign = 'center';
              ex.textBaseline = 'middle';
              ex.fillText(String(idx), p.x + 12, p.y + 12);
              ex.restore();
            }

            // label text
            const label = p.label || '';
            if (label) {
              ex.save();
              ex.fillStyle = 'rgba(34,30,31,0.95)';
              ex.font = '12px sans-serif';
              ex.textAlign = 'center';
              ex.fillText(label, p.x, p.y + 28);
              ex.restore();
            }
          } else if (p.type === 'nvr') {
            ex.save();
            ex.fillStyle = '#475569';
            ex.fillRect(p.x - 12, p.y - 12, 24, 24);
            ex.restore();
            const label = p.label || '';
            if (label) {
              ex.save();
              ex.fillStyle = 'rgba(34,30,31,0.95)';
              ex.font = '12px sans-serif';
              ex.textAlign = 'center';
              ex.fillText(label, p.x, p.y + 28);
              ex.restore();
            }
          }
        });

        return { image: exportCanvas.toDataURL('image/png') };
    };

    // ---- rest of code remains but with scale-aware conversions, editable labels, counter-rotated label/badge ----

    function getCameraIcon(name = '') {
        const lowerName = name.toLowerCase();
        if (lowerName.includes('dome')) {
            return `<svg viewBox="0 0 24 24" fill="currentColor" style="width:20px;height:20px;"><path d="M12 2C7.58 2 4 5.58 4 10v2h16v-2c0-4.42-3.58-8-8-8z"></path></svg>`;
        }
        if (lowerName.includes('bullet') || lowerName.includes('box')) {
            return `<svg viewBox="0 0 24 24" fill="currentColor" style="width:20px;height:20px;"><path d="M20 8h-7c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h7c1.1 0 2-.9 2-2v-4c0-1.1-.9-2-2-2zM4 12c0-2.21 1.79-4 4-4h1v8H8c-2.21 0-4-1.79-4-4z"></path></svg>`;
        }
        return `<svg viewBox="0 0 24 24" fill="currentColor" style="width:20px;height:20px;"><path d="M17 10.5V7c0-1.66-1.34-3-3-3s-3 1.34-3 3v3.5c-1.93 0-3.5 1.57-3.5 3.5S5.07 17.5 7 17.5h10c1.93 0 3.5-1.57 3.5-3.5S19.93 10.5 18 10.5V7c0-2.76-2.24-5-5-5z"></path></svg>`;
    }

    function renderPlacedMarkers(){
      
      const cfg = getConfig();
      const { allCams, allNvrs } = collectItems();
      overlayLayer.innerHTML = '';
      (cfg.layoutPlacements||[]).forEach((p)=>{
        const el = document.createElement('div');
        el.className = `ldz-placed ${p.type}`;
        if (p.uniqueId === selectedId) el.classList.add('selected');
        if (p.type === 'fov' && p.linkedTo) {
            el.classList.add('linked');
        }
        el.dataset.uid = p.uniqueId;
        el.style.transform = `translate(${p.x - 16}px, ${p.y - 16}px) rotate(${p.rotation || 0}deg)`;
        
        // label and number will be inserted as separate elements so they can be counter-rotated
        let itemName = '', iconHtml = '';
        if (p.type === 'camera') {
            const baseId = parseInt(String(p.uniqueId).split('-')[0], 10);
            const cam = allCams.find(c => c.instanceId === baseId);
            itemName = p.label || cam?.name || 'Camera';
            iconHtml = getCameraIcon(itemName);
        } else if (p.type === 'nvr') {
            const nvr = allNvrs.find(n => `nvr-${n.id}` === p.uniqueId);
            itemName = p.label || nvr?.product?.name || 'NVR';
            iconHtml = 'NVR';
        } else if (p.type === 'fov') {
            itemName = p.label || 'Field of View';
        }
        el.innerHTML = `${iconHtml}`;

        // badge for camera numbering (pull last segment)
        if (p.type === 'camera') {
          const idx = String(p.uniqueId).split('-').slice(-1)[0];
          const badge = document.createElement('div');
          badge.className = 'ldz-placed-badge';
          badge.textContent = idx;
          // counter-rotate the badge so it remains upright
          badge.style.transform = `rotate(${-(p.rotation || 0)}deg)`;
          el.appendChild(badge);
        }

        // label
        const labelEl = document.createElement('div');
        labelEl.className = 'ldz-placed-label';
        labelEl.textContent = itemName;
        // counter-rotate label so it stays readable
        labelEl.style.transform = `translateX(-50%) rotate(${-(p.rotation || 0)}deg)`;
        labelEl.addEventListener('dblclick', (ev) => {
          ev.stopPropagation();
          // replace with input
          const input = document.createElement('input');
          input.className = 'ldz-place-label-input';
          input.value = p.label || '';
          labelEl.replaceWith(input);
          input.focus();
          input.select();
          function commit() {
            const val = (input.value || '').trim();
            if (val) p.label = val;
            else delete p.label;
            saveConfig();
            saveHistory();
            redraw();
          }
          input.addEventListener('blur', commit, { once: true });
          input.addEventListener('keydown', (ke) => {
            if (ke.key === 'Enter') {
              input.blur();
            } else if (ke.key === 'Escape') {
              // cancel
              input.replaceWith(labelEl);
            }
          });
        });
        el.appendChild(labelEl);

        if (p.type==='fov'){
          const rot = document.createElement('div');
          rot.className = 'ldz-fov-handle ldz-fov-rotate';
          const rng = document.createElement('div');
          rng.className = 'ldz-fov-handle ldz-fov-range';
          el.appendChild(rot); el.appendChild(rng);
        }
        
        if (p.type === 'camera') {
            const camRot = document.createElement('div');
            camRot.className = 'ldz-camera-rotate-handle';
            el.appendChild(camRot);
        }

        el.addEventListener('mousedown', (e)=>{
          e.preventDefault();
          e.stopPropagation();

          if (currentMode === 'linkFov') {
            const cfg = getConfig();
            const fovToLink = cfg.layoutPlacements.find(item => item.uniqueId === selectedId);
            const targetCamera = p; // `p` is the placement for the clicked element `el`
    
            if (fovToLink && targetCamera && targetCamera.type === 'camera') {
                fovToLink.linkedTo = targetCamera.uniqueId;
                fovToLink.x = targetCamera.x;
                fovToLink.y = targetCamera.y;
                fovToLink.fov.rotation = targetCamera.rotation || 0;
                
                currentMode = 'place';
                linkBtn.classList.remove('active');
                wrap.style.cursor = 'grab';
                overlay.querySelectorAll('.ldz-placed.camera').forEach(c => c.style.outline = 'none');
                
                redraw();
                saveConfig();
                saveHistory();
            }
            return;
          }

          overlayLayer.querySelectorAll('.ldz-placed').forEach(n=>n.classList.remove('selected'));
          el.classList.add('selected');
          selectedId = p.uniqueId;
          deleteBtn.style.display = 'flex';

          let fovPlacement = null;
          const isCamera = p.type === 'camera';
          const isFov = p.type === 'fov';
          const isUnlinkedFov = isFov && !p.linkedTo;

          if (isFov) {
              fovPlacement = p;
          } else if (isCamera) {
              fovPlacement = cfg.layoutPlacements.find(fp => fp.linkedTo === p.uniqueId);
          }
          fovControls.style.display = fovPlacement ? 'flex' : 'none';
          const hasLinkedFov = isCamera && !!fovPlacement;
          const fovControlsEnabled = !!fovPlacement;
          const cameraRangeEnabled = isCamera && !!fovPlacement;
          if (cameraRangeControl) {
              cameraRangeControl.style.display = cameraRangeEnabled ? 'flex' : 'none';
          }
          if (cameraRangeInput) {
              cameraRangeInput.disabled = !cameraRangeEnabled;
          }
          [cameraRangeDecreaseBtn, cameraRangeIncreaseBtn].forEach(btn => {
              if (btn) btn.disabled = !cameraRangeEnabled;
          });
          selectionControls.style.display = 'flex';
          unlinkBtn.style.display = hasLinkedFov ? 'flex' : 'none';
          linkBtn.style.display = isUnlinkedFov ? 'flex' : 'none';

          if (fovPlacement) {
              const a = (fovPlacement.fov?.angle ?? 90);
              fovAngleInput.value = a;
              fovAngleValue.textContent = `${a}°`;

              // Range in feet: prefer stored rangeFt
              const rFt = (typeof fovPlacement.fov?.rangeFt === 'number') ? fovPlacement.fov.rangeFt : (fovPlacement.fov?.range ?? 60);
              fovRangeInput.value = rFt;
              if (fovRangeValue) fovRangeValue.textContent = `${rFt} ft`;
              if (cameraRangeInput) cameraRangeInput.value = rFt;
              if (cameraRangeValue) cameraRangeValue.textContent = `${rFt} ft`;

              const rot = (fovPlacement.fov?.rotation ?? 0);
              fovRotationInput.value = rot;
              fovRotationValue.textContent = `${rot}°`;

              fovColors.querySelectorAll('.ldz-color-swatch').forEach(sw => {
                  sw.classList.toggle('selected', sw.dataset.color === (fovPlacement.fov?.color || 'rgba(234,179,8,0.5)'));
              });
          } else {
              if (fovRangeValue) fovRangeValue.textContent = '—';
              if (fovRotationValue) fovRotationValue.textContent = '—';
              if (cameraRangeValue) cameraRangeValue.textContent = '—';
              if (cameraRangeInput) cameraRangeInput.disabled = true;
          }

          const isRotateCam = e.target.classList.contains('ldz-camera-rotate-handle');
          const isFovBody = e.target.classList.contains('ldz-fov-body');
          let mode = 'move';
          if (isRotateCam) mode = 'rotateCam';
          else if (isFovBody) mode = 'rotateFov';

          
          const start = { mx:e.clientX, my:e.clientY, x:p.x, y:p.y };
          
          function onMove(ev){
            const rect = overlayLayer.getBoundingClientRect();
            const mouseX = (ev.clientX - rect.left) / view.scale;
            const mouseY = (ev.clientY - rect.top) / view.scale;

            if (mode==='move'){
              const dx = (ev.clientX - start.mx) / view.scale;
              const dy = (ev.clientY - start.my) / view.scale;
              p.x = Math.max(0, Math.min(img.width, start.x + dx));
              p.y = Math.max(0, Math.min(img.height, start.y + dy));
              
              if (p.type === 'camera') {
                  const linkedFov = cfg.layoutPlacements.find(fp => fp.linkedTo === p.uniqueId);
                  if (linkedFov) { linkedFov.x = p.x; linkedFov.y = p.y; }
              }
              redraw();
            } else if (mode === 'rotateCam') {
                const ang = Math.atan2(mouseY - p.y, mouseX - p.x) * 180 / Math.PI;
                const newRotation = Math.round(ang + 90);
                p.rotation = newRotation;
                const linkedFov = cfg.layoutPlacements.find(fp => fp.linkedTo === p.uniqueId);
                if (linkedFov) {
                    linkedFov.fov.rotation = newRotation;
                    fovRotationInput.value = newRotation;
                    fovRotationValue.textContent = `${newRotation}°`;
                }
                redraw();
            } else if (mode==='rotateFov'){
                const ang = Math.atan2(mouseY - fovPlacement.y, mouseX - fovPlacement.x) * 180 / Math.PI;
                const newRotation = Math.round(ang + 90);
                fovPlacement.fov = fovPlacement.fov || {angle:90, rangeFt:60, rotation:0};
                fovPlacement.fov.rotation = newRotation;
                if (fovRotationInput) fovRotationInput.value = newRotation;
                if (fovRotationValue) fovRotationValue.textContent = `${newRotation}°`;
                redraw();
            }
          }
          function onUp(){
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            saveConfig();
            saveHistory();
          }
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
      }
    }); // This is the end of the mousedown listener

        overlayLayer.appendChild(el);
      });

    }

    wrap.addEventListener('dragover', (e)=>{ e.preventDefault(); });
    wrap.addEventListener('drop', (e)=>{
      e.preventDefault();
      
      const rect = bg.getBoundingClientRect();
      const x = (e.clientX - rect.left - view.x) / view.scale;
      const y = (e.clientY - rect.top - view.y) / view.scale;
      if (x < 0 || y < 0 || x > img.width || y > img.height) return;

      const data = e.dataTransfer.getData('text/plain');
      if (!data) return;
      let parsed; try { parsed = JSON.parse(data); } catch { return; }
      
      const cfg = getConfig();
      const newPlacements = [];
      const mainItem = {
        type: parsed.type, uniqueId: parsed.uniqueId,
        x: Math.max(0, Math.min(img.width, x)), y: Math.max(0, Math.min(img.height, y)),
        rotation: 0,
        deviceId: parsed.type==='nvr' ? parseInt(String(parsed.uniqueId).replace('nvr-',''),10) : null,
      };
      
      if (mainItem.type === 'camera') {
          const fovItem = {
              type: 'fov', uniqueId: `fov-${Date.now()}`, linkedTo: mainItem.uniqueId,
              x: mainItem.x, y: mainItem.y,
              fov: { angle: 90, rangeFt: 60, rotation: 0, color: 'rgba(234,179,8,0.5)' }
          };
          newPlacements.push(fovItem);
      } else if (mainItem.type === 'fov') {
          mainItem.fov = { angle: 90, rangeFt: 60, rotation: 0, color: 'rgba(234,179,8,0.5)' };
      }
      
      newPlacements.push(mainItem);
      cfg.layoutPlacements.push(...newPlacements);

      saveConfig();
      saveHistory();
      renderItemsList();
      redraw();
    });
    
    wrap.addEventListener('mousedown', (e) => {
      const isBackground = e.target === e.currentTarget || e.target.id === 'ldzBg' || e.target.id === 'ldzFov' || e.target.id === 'ldzWalls' || e.target.id === 'ldzOverlay';
      if (!isBackground) return;
      e.preventDefault();
      
      const rect = bg.getBoundingClientRect();
      const startX = (e.clientX - rect.left - view.x) / view.scale;
      const startY = (e.clientY - rect.top - view.y) / view.scale;

      if (currentMode === 'drawWall') {
          const onWallMove = (moveEvent) => {
              const currentX = (moveEvent.clientX - rect.left - view.x) / view.scale;
              const currentY = (moveEvent.clientY - rect.top - view.y) / view.scale;
              
              // OPTIMIZED: Only clear and redraw the wall canvas
              wallCtx.clearRect(0, 0, wallCanvas.width, wallCanvas.height);
              wallCtx.save();
              wallCtx.translate(view.x, view.y);
              wallCtx.scale(view.scale, view.scale);
              
              drawWalls(wallCtx); // Redraw permanent walls

              // Draw the temporary line
              wallCtx.strokeStyle = 'rgba(255, 59, 48, 0.7)';
              wallCtx.lineWidth = 3 / view.scale;
              wallCtx.lineCap = 'round';
              wallCtx.beginPath();
              wallCtx.moveTo(startX, startY);
              wallCtx.lineTo(currentX, currentY);
              wallCtx.stroke();
              wallCtx.restore();
          };
          const onWallUp = (upEvent) => {
              document.removeEventListener('mousemove', onWallMove);
              document.removeEventListener('mouseup', onWallUp);
              const endX = (upEvent.clientX - rect.left - view.x) / view.scale;
              const endY = (upEvent.clientY - rect.top - view.y) / view.scale;
              
              if (Math.hypot(endX - startX, endY - startY) > 5) {
                  getConfig().layoutWalls.push({x1: startX, y1: startY, x2: endX, y2: endY});
                  saveConfig();
                  saveHistory();
              }
              redraw();
          };
          document.addEventListener('mousemove', onWallMove);
          document.addEventListener('mouseup', onWallUp);

      } else { // 'place' mode (panning)
          overlayLayer.querySelectorAll('.ldz-placed').forEach(n => n.classList.remove('selected'));
          selectedId = null;
          deleteBtn.style.display = 'none';
          selectionControls.style.display = 'none';
          fovControls.style.display = 'none';
          unlinkBtn.style.display = 'none';
          if (cameraRangeControl) cameraRangeControl.style.display = 'none';
          if (cameraRangeValue) cameraRangeValue.textContent = '—';
          if (cameraRangeInput) cameraRangeInput.disabled = true;
          [cameraRangeDecreaseBtn, cameraRangeIncreaseBtn].forEach(btn => {
              if (btn) btn.disabled = true;
          });
          const panStartX = e.clientX - view.x;
          const panStartY = e.clientY - view.y;
          wrap.style.cursor = 'grabbing';
          const onPanMove = (moveEvent) => {
              view.x = moveEvent.clientX - panStartX;
              view.y = moveEvent.clientY - panStartY;
              redraw();
          };
          const onPanUp = () => {
              wrap.style.cursor = 'grab';
              document.removeEventListener('mousemove', onPanMove);
              document.removeEventListener('mouseup', onPanUp);
          };
          document.addEventListener('mousemove', onPanMove);
          document.addEventListener('mouseup', onPanUp);
      }
    });

    wrap.addEventListener('wheel', e => {
        e.preventDefault();
        const rect = wrap.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const newScale = e.deltaY > 0 ? view.scale / 1.1 : view.scale * 1.1;
        setZoom(newScale, mouseX, mouseY);
    });

    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', () => {
            setZoom(view.scale * 1.2);
        });
    }

    if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', () => {
            setZoom(view.scale / 1.2);
        });
    }

    if (zoomResetBtn) {
        zoomResetBtn.addEventListener('click', () => {
            setZoom(1, wrap.clientWidth / 2, wrap.clientHeight / 2);
        });
    }

    if (fitViewBtn) {
        fitViewBtn.addEventListener('click', () => {
            resetView();
        });
    }

    if (gridToggleBtn) {
        gridToggleBtn.addEventListener('click', () => {
            showGrid = !showGrid;
            gridToggleBtn.classList.toggle('active', showGrid);
            redraw();
        });
        gridToggleBtn.classList.toggle('active', showGrid);
    }

    const closeAndCleanup = () => {
        if (document.body.contains(overlay)) {
            document.body.removeChild(overlay);
        }
        document.body.style.overflow = previousOverflow;
        document.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('resize', onResize);
        if (itemsListEl) {
            itemsListEl.removeEventListener('scroll', listScrollListener);
        }
        if (listResizeObserver) {
            try { listResizeObserver.disconnect(); } catch (e) {}
            listResizeObserver = null;
        }
        if (listMutationObserver) {
            try { listMutationObserver.disconnect(); } catch (e) {}
            listMutationObserver = null;
        }
        flushFovHistoryCommit();
    };

    overlay.querySelector('#ldzClose').addEventListener('click', closeAndCleanup);
    overlay.querySelector('#ldzX').addEventListener('click', closeAndCleanup);
    overlay.querySelector('#ldzUndo').onclick = undo;
    overlay.querySelector('#ldzRedo').onclick = redo;

    drawWallBtn.addEventListener('click', () => {
        currentMode = (currentMode === 'place') ? 'drawWall' : 'place';
        drawWallBtn.classList.toggle('active', currentMode === 'drawWall');
        wrap.classList.toggle('wall-mode', currentMode === 'drawWall');
        if (currentMode === 'place') wrap.style.cursor = 'grab';
    });

    overlay.querySelector('#ldzReset').onclick = () => {
      if (!confirm('Remove ALL placed items AND walls from this layout?')) return;
      const cfg = getConfig();
      cfg.layoutPlacements = [];
      cfg.layoutWalls = [];
      saveConfig();
      saveHistory();
      renderItemsList();
      redraw();
    };

    overlay.querySelector('#ldzDownload').onclick = async ()=>{
      const data = await window.getLayoutCanvasAsImage();
      if (data){
        const a = document.createElement('a');
        a.href = data.image;
        a.download = `${getConfig().projectName || 'layout'}.png`;
        a.click();
      }
    };

    setScaleBtn.addEventListener('click', () => {
        if (currentMode === 'scale') { // User is clicking "Set Scale"
            const feetDistance = parseFloat(scaleDistanceInput.value);
            if (feetDistance > 0 && scaleLine) {
                const pixelDistance = Math.hypot(scaleLine.x2 - scaleLine.x1, scaleLine.y2 - scaleLine.y1);
                pixelsPerFoot = pixelDistance / feetDistance;
                getConfig().layoutScale = pixelsPerFoot;
                if (scaleValueEl) scaleValueEl.textContent = `${pixelsPerFoot.toFixed(2)} px/ft`;
                saveConfig();
                saveHistory();
                if (typeof window.showToast === 'function') showToast(`Scale set to ${pixelsPerFoot.toFixed(2)} pixels per foot.`);
            }

            // Exit scale mode
            currentMode = 'place';
            scaleLine = null;
            setScaleBtn.classList.remove('active');
            setScaleBtnText.textContent = 'Scale Floor Plan';
            scaleInputWrap.style.display = 'none';
            clearScaleHandles();
            redraw();

        } else { // User is clicking "Scale Floor Plan"
            currentMode = 'scale';
            drawWallBtn.classList.remove('active');
            wrap.classList.remove('wall-mode');
            
            // Create a default line in the center of the image
            const centerX = img.width / 2;
            const centerY = img.height / 2;
            scaleLine = { x1: centerX - 50, y1: centerY, x2: centerX + 50, y2: centerY };

            setScaleBtn.classList.add('active');
            setScaleBtnText.textContent = 'Set Scale';
            scaleInputWrap.style.display = 'flex';
            if (typeof window.showToast === 'function') showToast('Drag the green handles to measure a known distance.');
            redraw();
        }
    });

    function queueFovHistoryCommit() {
        if (fovHistoryTimer) clearTimeout(fovHistoryTimer);
        fovHistoryTimer = setTimeout(() => {
            saveHistory();
            fovHistoryTimer = null;
        }, 250);
    }

    function flushFovHistoryCommit() {
        if (fovHistoryTimer) {
            clearTimeout(fovHistoryTimer);
            fovHistoryTimer = null;
        }
    }

    function updateSelectedFov(prop, value, finalize = false) {
        if (!selectedId) return;
        const cfg = getConfig();
        let placementToUpdate = null;
        const selectedItem = (cfg.layoutPlacements || []).find(p => p.uniqueId === selectedId);
        if (!selectedItem) return;
    
        if (selectedItem.type === 'fov') {
            placementToUpdate = selectedItem;
        } else if (selectedItem.type === 'camera') {
            placementToUpdate = (cfg.layoutPlacements || []).find(p => p.linkedTo === selectedId);
        }
        
        if (placementToUpdate) {
            if (!placementToUpdate.fov) {
                 placementToUpdate.fov = { angle: 90, rangeFt: 60, rotation: 0 };
            }
            placementToUpdate.fov[prop] = value;
            redraw();
            saveConfig();
            if (finalize) {
                flushFovHistoryCommit();
                saveHistory();
            }
            else {
                queueFovHistoryCommit();
            }
        }
    }

    fovAngleInput.addEventListener('input', (e)=>{
      const angle = parseInt(e.target.value,10);
      fovAngleValue.textContent = `${angle}°`;
      updateSelectedFov('angle', angle);
    });
    fovAngleInput.addEventListener('change', (e)=>{
      const angle = parseInt(e.target.value,10);
      updateSelectedFov('angle', angle, true);
    });
    
    fovRangeInput.addEventListener('input', (e)=>{
      const range = parseInt(e.target.value,10);
      updateSelectedFov('rangeFt', range);
    });
    fovRangeInput.addEventListener('change', (e)=>{
      const range = parseInt(e.target.value,10);
      updateSelectedFov('rangeFt', range, true);
    });

    if (cameraRangeInput) {
      cameraRangeInput.addEventListener('input', (e) => {
        const range = parseInt(e.target.value, 10);
        setFovControlValue('range', range);
      });
      cameraRangeInput.addEventListener('change', (e) => {
        const range = parseInt(e.target.value, 10);
        setFovControlValue('range', range, true);
      });
    }

    fovRotationInput.addEventListener('input', (e)=>{
      const rotation = parseInt(e.target.value,10);
      updateSelectedFov('rotation', rotation);
    });
    fovRotationInput.addEventListener('change', (e)=>{
      const rotation = parseInt(e.target.value,10);
      updateSelectedFov('rotation', rotation, true);
    });

    fovColors.addEventListener('click', (e) => {
        const swatch = e.target.closest('.ldz-color-swatch');
        if (swatch) {
            const color = swatch.dataset.color;
            fovColors.querySelectorAll('.ldz-color-swatch').forEach(sw => sw.classList.remove('selected'));
            swatch.classList.add('selected');
            updateSelectedFov('color', color, true);
        }
    });

    linkBtn.onclick = () => {
        if (currentMode === 'linkFov') { // Toggle off
            currentMode = 'place';
            linkBtn.classList.remove('active');
            wrap.style.cursor = 'grab';
            overlay.querySelectorAll('.ldz-placed.camera').forEach(c => c.style.outline = 'none');
        } else {
            if (!selectedId) return;
            const cfg = getConfig();
            const fov = cfg.layoutPlacements.find(p => p.uniqueId === selectedId);
            if (!fov || fov.type !== 'fov' || fov.linkedTo) return;
            
            currentMode = 'linkFov';
            linkBtn.classList.add('active');
            wrap.style.cursor = 'pointer';
            overlay.querySelectorAll('.ldz-placed.camera').forEach(c => {
                c.style.outline = '2px dashed #c22033';
                c.style.outlineOffset = '2px';
            });
            if (typeof window.showToast === 'function') showToast('Select a camera to link this FOV.');
        }
    };

    function deleteSelectedItem() {
        if (!selectedId) return;
        const cfg = getConfig();
        const itemToDelete = cfg.layoutPlacements.find(p => p.uniqueId === selectedId);
        if (itemToDelete && itemToDelete.type === 'camera') {
            cfg.layoutPlacements = (cfg.layoutPlacements || []).filter(p => p.uniqueId !== selectedId && p.linkedTo !== selectedId);
        } else {
            cfg.layoutPlacements = (cfg.layoutPlacements || []).filter(p => p.uniqueId !== selectedId);
        }
        selectedId = null;
        deleteBtn.style.display = 'none';
        selectionControls.style.display = 'none';
        fovControls.style.display = 'none';
        unlinkBtn.style.display = 'none';
        linkBtn.style.display = 'none';
        if (cameraRangeControl) cameraRangeControl.style.display = 'none';
        if (cameraRangeValue) cameraRangeValue.textContent = '—';
        if (cameraRangeInput) cameraRangeInput.disabled = true;
        [cameraRangeDecreaseBtn, cameraRangeIncreaseBtn].forEach(btn => {
            if (btn) btn.disabled = true;
        });
        if (fovRangeValue) fovRangeValue.textContent = '—';
        if (fovRotationValue) fovRotationValue.textContent = '—';
        saveConfig();
        saveHistory();
        renderItemsList();
        redraw();
    }
    deleteBtn.onclick = deleteSelectedItem;

    unlinkBtn.onclick = () => {
        if (!selectedId) return;
        const cfg = getConfig();
        const fov = cfg.layoutPlacements.find(p => p.linkedTo === selectedId);
        if (fov) {
            delete fov.linkedTo;
            saveConfig();
            saveHistory();
            redraw();
            unlinkBtn.style.display = 'none';
            if (cameraRangeControl) cameraRangeControl.style.display = 'none';
            if (cameraRangeValue) cameraRangeValue.textContent = '—';
            if (cameraRangeInput) cameraRangeInput.disabled = true;
            [cameraRangeDecreaseBtn, cameraRangeIncreaseBtn].forEach(btn => {
                if (btn) btn.disabled = true;
            });
        }
    };

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        if (currentMode === 'drawWall' || currentMode === 'linkFov') {
            currentMode = 'place';
            drawWallBtn.classList.remove('active');
            linkBtn.classList.remove('active');
            wrap.classList.remove('wall-mode');
            wrap.style.cursor = 'grab';
            overlay.querySelectorAll('.ldz-placed.camera').forEach(c => c.style.outline = 'none');
        } else {
            closeAndCleanup();
        }
        return;
      }
      const activeElement = document.activeElement;
      const isEditable = activeElement && (activeElement.isContentEditable || activeElement.tagName === 'TEXTAREA' || (activeElement.tagName === 'INPUT' && activeElement.type !== 'range' && activeElement.type !== 'checkbox'));
      if (isEditable) return;
      if (!selectedId) return;
      const cfg = getConfig();
      const placement = (cfg.layoutPlacements || []).find(p => p.uniqueId === selectedId);
      if (!placement) return;

      const key = e.key.toLowerCase();
      const linkedFov = placement.type === 'fov'
          ? placement
          : (cfg.layoutPlacements || []).find(p => p.linkedTo === placement.uniqueId);
      if (linkedFov) {
          if (key === 'q' || key === 'e') {
              e.preventDefault();
          }
      }

      let needsUpdate = false;
      if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          deleteSelectedItem();
      } else if (e.key.startsWith('Arrow')) {
          e.preventDefault();
          needsUpdate = true;
          const step = e.shiftKey ? 10 : 2;
          switch (e.key) {
              case 'ArrowUp':    placement.y -= step; break;
              case 'ArrowDown':  placement.y += step; break;
              case 'ArrowLeft':  placement.x -= step; break;
              case 'ArrowRight': placement.x += step; break;
          }
      }

      if (needsUpdate) {
          placement.x = Math.max(0, Math.min(img.width, placement.x));
          placement.y = Math.max(0, Math.min(img.height, placement.y));
          
          if (placement.type === 'camera') {
              const linkedFov = cfg.layoutPlacements.find(fp => fp.linkedTo === placement.uniqueId);
              if (linkedFov) {
                  linkedFov.x = placement.x;
                  linkedFov.y = placement.y;
              }
          }
          redraw();
          saveConfig();
          saveHistory();
      }
    }
    document.addEventListener('keydown', handleKeyDown);

    img.onload = () => {
        resetView();
        saveHistory(); // Save the initial state
    };
    img.src = cfg.cameraLayout;
    
    renderItemsList();
    updatePlacementStats();
    if (scaleValueEl) scaleValueEl.textContent = `${pixelsPerFoot.toFixed(2)} px/ft`;

    const onResize = ()=>{ if (img.width) resetView(); };
    window.addEventListener('resize', onResize);
  }; // end of openLayoutDesigner
