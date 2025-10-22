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
     ✓ Wall drawing tool to add obstructions to the floorplan.
     ✓ FOV cones are now dynamically obstructed by walls, casting shadows.
     ✓ NEW: Fixed performance bug in wall drawing feature.
     ✓ NEW: Removed meter text from range slider UI.
*/

(function(){
  // ---- Safe globals & helpers ----
  const STORAGE_KEY = '3xlogicConfig';

  function getConfig() {
    if (!window.configuration) window.configuration = {};
    const cfg = window.configuration;
    // Ensure essential properties are arrays.
    cfg.racks = Array.isArray(cfg.racks) ? cfg.racks : [];
    cfg.cloudCameras = Array.isArray(cfg.cloudCameras) ? cfg.cloudCameras : [];
    cfg.allInOneCameras = Array.isArray(cfg.allInOneCameras) ? cfg.allInOneCameras : [];
    cfg.layoutPlacements = Array.isArray(cfg.layoutPlacements) ? cfg.layoutPlacements : [];
    cfg.layoutWalls = Array.isArray(cfg.layoutWalls) ? cfg.layoutWalls : [];
    return cfg;
  }

  function saveConfig() {
    const cfg = getConfig();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const bucket = raw ? JSON.parse(raw) : {};
      bucket.layoutPlacements = cfg.layoutPlacements || [];
      bucket.layoutWalls = cfg.layoutWalls || [];
      bucket.cameraLayout = cfg.cameraLayout || null;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bucket));
    } catch(e){
      console.error("Failed to save layout config:", e);
    }
  }
  
  (function bootstrapFromStorage(){
    const cfg = getConfig();
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.layoutPlacements)) cfg.layoutPlacements = parsed.layoutPlacements;
        if (Array.isArray(parsed.layoutWalls)) cfg.layoutWalls = parsed.layoutWalls;
        if (parsed.cameraLayout) cfg.cameraLayout = parsed.cameraLayout;
      }
    }catch(e){
        console.error("Failed to bootstrap layout from storage:", e);
    }
  })();

  // ---- Geometry Helper Functions ----
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
          if (val === 0) return 0;
          return (val > 0) ? 1 : 2;
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
      .ldz-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:stretch;justify-content:stretch;background:radial-gradient(circle at top,rgba(34,30,31,0.92),rgba(34,30,31,0.78));backdrop-filter:blur(12px);}
      .ldz-modal{width:100%;height:100%;background:linear-gradient(145deg,#f6f7fb,#fff);border-radius:0;box-shadow:0 28px 64px -40px rgba(34,30,31,0.55);display:grid;grid-template-columns:minmax(320px,360px) minmax(0,1fr);overflow:hidden;color:#221e1f;position:relative;}
      @media(max-width:1080px){.ldz-modal{grid-template-columns:1fr;grid-template-rows:minmax(0,420px) minmax(0,1fr);}}
      @media(max-width:860px){.ldz-modal{grid-template-rows:minmax(0,360px) minmax(0,1fr);}}
      .ldz-sidebar{max-width:360px;}
      .ldz-sidebar{background:rgba(246,247,251,0.92);backdrop-filter:blur(18px);display:flex;flex-direction:column;}
      .ldz-sidebar-header{padding:28px 28px 20px;border-bottom:1px solid rgba(34,30,31,0.2);display:flex;flex-direction:column;gap:14px;}
      .ldz-title{font-size:1.25rem;font-weight:700;letter-spacing:-0.01em;color:#221e1f;}
      .ldz-subtitle{font-size:0.8rem;color:rgba(34,30,31,0.68);line-height:1.4;}
      .ldz-stat-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}
      .ldz-chip{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:14px;background:rgba(194,32,51,0.08);border:1px solid rgba(194,32,51,0.18);font-size:0.72rem;color:#c22033;font-weight:600;}
      .ldz-chip span{font-weight:500;color:rgba(34,30,31,0.55);font-size:0.68rem;}
      .ldz-chip strong{font-size:0.95rem;}
      .ldz-chip.alt{background:rgba(16,185,129,0.08);border-color:rgba(16,185,129,0.2);color:#221e1f;}
      .ldz-chip.neutral{background:rgba(34,30,31,0.12);border-color:rgba(34,30,31,0.2);color:#221e1f;}
      .ldz-sidebar-body{padding:20px 28px;display:flex;flex-direction:column;gap:16px;flex:1;overflow:hidden;}
      .ldz-sidebar-body .ldz-card{box-shadow:0 12px 32px -28px rgba(34,30,31,0.4);}
      .ldz-section-heading{display:flex;justify-content:space-between;align-items:center;font-size:0.75rem;font-weight:600;color:rgba(34,30,31,0.55);padding-top:4px;gap:12px;}
      .ldz-section-title{flex:1;min-width:0;}
      .ldz-section-tools{display:flex;align-items:center;gap:10px;}
      .ldz-section-count{padding:4px 10px;border-radius:9999px;background:rgba(34,30,31,0.15);color:#221e1f;font-size:0.7rem;font-weight:600;}
      .ldz-scroll-controls{display:inline-flex;align-items:center;gap:6px;}
      .ldz-scroll-btn{width:28px;height:28px;border-radius:8px;border:1px solid rgba(34,30,31,0.2);background:rgba(255,255,255,0.9);color:#221e1f;display:inline-flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;cursor:pointer;transition:all .2s;}
      .ldz-scroll-btn:hover{border-color:rgba(194,32,51,0.45);color:#c22033;}
      .ldz-scroll-btn:disabled{opacity:0.4;cursor:not-allowed;border-color:rgba(34,30,31,0.18);color:rgba(96,92,94,0.7);}
      .ldz-list{flex:1;overflow:auto;padding-right:6px;display:flex;flex-direction:column;gap:10px;}
      .ldz-item{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:16px;border:1px solid rgba(34,30,31,0.18);background:rgba(255,255,255,0.96);box-shadow:0 12px 24px -20px rgba(34,30,31,0.65);cursor:grab;transition:transform .2s,box-shadow .2s,border-color .2s;}
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
      .ldz-placed{position:absolute;width:36px;height:36px;border-radius:12px;border:2px solid rgba(255,255,255,0.9);display:flex;align-items:center;justify-content:center;color:#fff;font:600 14px/1 'Inter',sans-serif;cursor:grab;user-select:none;box-shadow:0 14px 32px -24px rgba(34,30,31,0.85);}
      .ldz-placed.camera{background:linear-gradient(160deg,rgba(194,32,51,0.9),rgba(194,32,51,0.85));border-radius:18px;}
      .ldz-placed.nvr{background:linear-gradient(160deg,rgba(100,116,139,0.95),rgba(71,85,105,0.92));font-size:12px;font-weight:700;}
      .ldz-placed.fov{background:rgba(234,179,8,0.75);border-radius:18px;}
      .ldz-placed.fov.linked{display:none;}
      .ldz-placed.selected{box-shadow:0 0 0 4px rgba(194,32,51,0.55);}
      .ldz-placed-label{position:absolute;top:100%;left:50%;transform:translateX(-50%);background:rgba(34,30,31,0.9);color:#f6f7fb;font-size:0.68rem;padding:4px 8px;border-radius:8px;white-space:nowrap;margin-top:6px;font-weight:500;}
      .ldz-camera-rotate-handle{display:none;position:absolute;top:-18px;left:50%;transform:translateX(-50%);width:12px;height:12px;background:#c22033;border:2px solid #fff;border-radius:9999px;cursor:crosshair;}
      .ldz-placed.selected .ldz-camera-rotate-handle{display:block;}
      .ldz-fov-handle{position:absolute;width:12px;height:12px;background:#fff;border-radius:9999px;cursor:crosshair;border:2px solid rgba(194,32,51,0.6);}
      .ldz-fov-rotate{top:-16px;left:50%;transform:translateX(-50%);}
      .ldz-fov-range{bottom:-16px;left:50%;transform:translateX(-50%);}
      .ldz-close{position:absolute;top:18px;right:18px;background:rgba(246,247,251,0.9);border:1px solid rgba(34,30,31,0.3);border-radius:12px;padding:8px;cursor:pointer;z-index:10;display:flex;align-items:center;justify-content:center;transition:all .2s;}
      .ldz-close:hover{border-color:rgba(194,32,51,0.6);background:rgba(194,32,51,0.15);}
      .ldz-close img{width:24px;height:24px;}
      #context-menu button{display:block;width:100%;padding:8px 12px;text-align:left;background:none;border:none;cursor:pointer;}
    `;
    document.head.appendChild(style);
  }

  // ---- Public: Upload / Remove ----
  window.handleLayoutUpload = function(event){
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

  window.removeCameraLayout = function(){
    if (!confirm('Remove the layout image and all placed items and walls?')) return;
    const cfg = getConfig();
    cfg.cameraLayout = null;
    cfg.layoutPlacements = [];
    cfg.layoutWalls = [];
    saveConfig();
    if (typeof window.renderAll === 'function') window.renderAll();
    if (typeof window.showToast === 'function') window.showToast('Camera layout removed.');
  };

  // ---- Main UI ----
  window.openLayoutDesigner = function(){
    const cfg = getConfig();
    if (!cfg.cameraLayout){
      alert('Please upload a site layout image first (Tools → Upload Layout).');
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'ldz-overlay';
    overlay.innerHTML = `
      <div class="ldz-modal">
        <aside class="ldz-sidebar">
          <header class="ldz-sidebar-header">
            <div class="ldz-title">Camera Layout Designer</div>
            <p class="ldz-subtitle">Drag devices, sketch obstructions, and fine-tune coverage zones to mirror the project vision.</p>
            <div class="ldz-stat-grid">
              <div class="ldz-chip"><span>Placed cameras</span><strong id="ldzPlacedCameraCount">0</strong></div>
              <div class="ldz-chip alt"><span>Coverage zones</span><strong id="ldzPlacedFovCount">0</strong></div>
              <div class="ldz-chip neutral"><span>Recorders</span><strong id="ldzPlacedNvrCount">0</strong></div>
              <div class="ldz-chip neutral"><span>Walls</span><strong id="ldzPlacedWallCount">0</strong></div>
            </div>
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
          <div class="ldz-sidebar-footer">
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
                <input id="ldzCameraRange" class="ldz-range" type="range" min="10" max="2000" value="60">
              </div>
              <button id="ldzDeleteBtn" class="ldz-icon-btn danger"><img src="/icons/delete_.png" alt="Delete"><span>Remove from layout</span></button>
            </div>
            <div id="ldzFovControls" class="ldz-card" style="display:none;">
              <div class="ldz-card-title">Coverage settings</div>
              <div class="ldz-field">
                <span class="ldz-label">FOV Angle <strong id="ldzFovAngleValue">90°</strong></span>
                <input id="ldzFovAngle" class="ldz-range" type="range" min="15" max="360" value="90">
              </div>
              <div class="ldz-field">
                <div class="ldz-field-header">
                  <span class="ldz-label">FOV Range<strong id="ldzFovRangeValue">—</strong></span>
                  <div class="ldz-stepper">
                    <button type="button" class="ldz-step-btn" id="ldzRangeDecrease" aria-label="Decrease range" disabled>&minus;</button>
                    <button type="button" class="ldz-step-btn" id="ldzRangeIncrease" aria-label="Increase range" disabled>+</button>
                  </div>
                </div>
                <input id="ldzFovRange" class="ldz-range" type="range" min="10" max="2000" value="60">
              </div>
              <div class="ldz-colors" id="ldzFovColors">
                <button class="ldz-color-swatch selected" style="background:rgba(234,179,8,0.5)" data-color="rgba(234,179,8,0.5)"></button>
                <button class="ldz-color-swatch" style="background:rgba(239,68,68,0.4)" data-color="rgba(239,68,68,0.4)"></button>
                <button class="ldz-color-swatch" style="background:rgba(34,197,94,0.4)" data-color="rgba(34,197,94,0.4)"></button>
                <button class="ldz-color-swatch" style="background:rgba(139,92,246,0.4)" data-color="rgba(139,92,246,0.4)"></button>
              </div>
              <div class="ldz-field">
                <div class="ldz-field-header">
                  <span class="ldz-label">FOV Rotation<strong id="ldzFovRotationValue">—</strong></span>
                  <div class="ldz-stepper">
                    <button type="button" class="ldz-step-btn" id="ldzRotateLeft" aria-label="Rotate counter-clockwise" disabled>&#8630;</button>
                    <button type="button" class="ldz-step-btn" id="ldzRotateRight" aria-label="Rotate clockwise" disabled>&#8631;</button>
                  </div>
                </div>
                <input id="ldzFovRotation" class="ldz-range" type="range" min="0" max="360" value="0">
              </div>
            </div>
            <div class="ldz-footer-actions">
              <div class="ldz-action-row">
                <button id="ldzReset" class="ldz-icon-btn danger"><img src="/icons/reset-left-line_.png" alt="Reset"><span>Reset layout</span></button>
                <button id="ldzDownload" class="ldz-icon-btn primary"><img src="/icons/image-download_.png" alt="Download"><span>Export image</span></button>
              </div>
              <button id="ldzClose" class="ldz-icon-btn ghost"><img src="/icons/close-circle-twotone_.png" alt="Close"><span>Close designer</span></button>
            </div>
          </div>
        </aside>
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
    const fovControls = overlay.querySelector('#ldzFovControls');
    const fovColors = overlay.querySelector('#ldzFovColors');
    const fovRotationInput = overlay.querySelector('#ldzFovRotation');
    const fovRotationValue = overlay.querySelector('#ldzFovRotationValue');
    const rangeDecreaseBtn = overlay.querySelector('#ldzRangeDecrease');
    const rangeIncreaseBtn = overlay.querySelector('#ldzRangeIncrease');
    const rotateLeftBtn = overlay.querySelector('#ldzRotateLeft');
    const rotateRightBtn = overlay.querySelector('#ldzRotateRight');
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
    const availableCountEl = overlay.querySelector('#ldzAvailableTotal');
    const placedCameraCountEl = overlay.querySelector('#ldzPlacedCameraCount');
    const placedFovCountEl = overlay.querySelector('#ldzPlacedFovCount');
    const placedNvrCountEl = overlay.querySelector('#ldzPlacedNvrCount');
    const placedWallCountEl = overlay.querySelector('#ldzPlacedWallCount');
    const zoomIndicator = overlay.querySelector('#ldzZoomIndicator');
    const zoomInBtn = overlay.querySelector('#ldzZoomIn');
    const zoomOutBtn = overlay.querySelector('#ldzZoomOut');
    const zoomResetBtn = overlay.querySelector('#ldzZoomReset');
    const fitViewBtn = overlay.querySelector('#ldzFitView');
    const gridToggleBtn = overlay.querySelector('#ldzGridToggle');
    const ctx = bg.getContext('2d');
    const fovCtx = fovCanvas.getContext('2d');
    const wallCtx = wallCanvas.getContext('2d');
    const img = new Image();

    // -- State Management --
    let view = { scale: 1, x: 0, y: 0 };
    let history = [];
    let historyIndex = -1;
    let selectedId = null;
    let currentMode = 'place'; // 'place', 'drawWall', or 'linkFov'
    let showGrid = false;
    let fovHistoryTimer = null;
    let listResizeObserver = null;
    let listMutationObserver = null;

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
      if (itemsListEl.clientHeight) return itemsListEl.clientHeight;
      const rect = itemsListEl.getBoundingClientRect();
      if (rect && rect.height) return rect.height;
      return 0;
    }

    function computeScrollMetrics(){
      const viewport = getListViewportHeight();
      const scrollTop = itemsListEl ? itemsListEl.scrollTop : 0;
      const maxScroll = itemsListEl ? Math.max(0, itemsListEl.scrollHeight - viewport) : 0;
      return { viewport, scrollTop, maxScroll };
    }

    function updateScrollButtons(){
      if (!itemsListEl || !scrollUpBtn || !scrollDownBtn) return;
      const { scrollTop, maxScroll } = computeScrollMetrics();
      const epsilon = 1;
      scrollUpBtn.disabled = scrollTop <= epsilon;
      scrollDownBtn.disabled = maxScroll - scrollTop <= epsilon;
    }

    function scrollListBy(multiplier){
      if (!itemsListEl) return;
      const { viewport, scrollTop, maxScroll } = computeScrollMetrics();
      if (maxScroll <= 0) {
        updateScrollButtons();
        return;
      }

      const direction = multiplier >= 0 ? 1 : -1;
      const stepBase = viewport > 0 ? viewport : Math.min(itemsListEl.scrollHeight, 240);
      const baseDistance = Math.max(80, stepBase * Math.min(Math.abs(multiplier), 1));
      const target = Math.max(0, Math.min(scrollTop + direction * baseDistance, maxScroll));

      if (typeof itemsListEl.scrollTo === 'function') {
        itemsListEl.scrollTo({ top: target, behavior: 'smooth' });
      } else if (typeof itemsListEl.scrollBy === 'function') {
        itemsListEl.scrollBy({ top: target - scrollTop });
      } else {
        itemsListEl.scrollTop = target;
      }

      schedule(updateScrollButtons);
      setTimeout(updateScrollButtons, 300);
    }

    const listScrollListener = () => schedule(updateScrollButtons);

    if (itemsListEl) {
      itemsListEl.addEventListener('scroll', listScrollListener, { passive: true });
      if (typeof ResizeObserver !== 'undefined') {
        listResizeObserver = new ResizeObserver(listScrollListener);
        listResizeObserver.observe(itemsListEl);
      }
      if (typeof MutationObserver !== 'undefined') {
        listMutationObserver = new MutationObserver(listScrollListener);
        listMutationObserver.observe(itemsListEl, { childList: true, subtree: true });
      }
    }
    if (scrollUpBtn) {
      scrollUpBtn.addEventListener('click', () => scrollListBy(-0.85));
    }
    if (scrollDownBtn) {
      scrollDownBtn.addEventListener('click', () => scrollListBy(0.85));
    }

    schedule(updateScrollButtons);
    setTimeout(updateScrollButtons, 120);

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

      if (availableCountEl) availableCountEl.textContent = items.length;

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
        return `
          <div class="ldz-item" draggable="true" data-type="${item.type}" data-uid="${item.uniqueId}">
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
      if (placedCameraCountEl) placedCameraCountEl.textContent = countType('camera');
      if (placedFovCountEl) placedFovCountEl.textContent = countType('fov');
      if (placedNvrCountEl) placedNvrCountEl.textContent = countType('nvr');
      if (placedWallCountEl) placedWallCountEl.textContent = (cfg.layoutWalls || []).length;
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

        ctx.restore(); fovCtx.restore(); wallCtx.restore();

        overlayLayer.style.width = `${img.width}px`;
        overlayLayer.style.height = `${img.height}px`;
        overlayLayer.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;

        renderPlacedMarkers();
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
            const fovRange = p.fov?.range ?? 60;
            const fovRotation = (p.fov?.rotation ?? 0) * Math.PI / 180;
            const halfAngleRad = (fovAngle / 2) * Math.PI / 180;

            // 1. Draw the base FOV cone
            fovCtx.save();
            fovCtx.translate(fovOrigin.x, fovOrigin.y);
            fovCtx.rotate(fovRotation);
            fovCtx.beginPath();
            if (fovAngle < 360) {
                fovCtx.moveTo(0, 0);
                fovCtx.arc(0, 0, fovRange, -halfAngleRad, halfAngleRad);
                fovCtx.closePath();
            } else {
                fovCtx.arc(0, 0, fovRange, 0, 2 * Math.PI);
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


    function getCameraIcon(name = '') {
        const lowerName = name.toLowerCase();
        if (lowerName.includes('dome')) {
            return `<svg viewBox="0 0 24 24" fill="currentColor" style="width:20px;height:20px;"><path d="M12 2C7.58 2 4 5.58 4 10v2h16v-2c0-4.42-3.58-8-8-8z"></path></svg>`;
        }
        if (lowerName.includes('bullet') || lowerName.includes('box')) {
            return `<svg viewBox="0 0 24 24" fill="currentColor" style="width:20px;height:20px;"><path d="M20 8h-7c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h7c1.1 0 2-.9 2-2v-4c0-1.1-.9-2-2-2zM4 12c0-2.21 1.79-4 4-4h1v8H8c-2.21 0-4-1.79-4-4z"></path></svg>`;
        }
        return `<svg viewBox="0 0 24 24" fill="currentColor" style="width:20px;height:20px;"><path d="M17 10.5V7c0-1.66-1.34-3-3-3s-3 1.34-3 3v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5zM12 2C9.24 2 7 4.24 7 7v3.5c-1.93 0-3.5 1.57-3.5 3.5S5.07 17.5 7 17.5h10c1.93 0 3.5-1.57 3.5-3.5S19.93 10.5 18 10.5V7c0-2.76-2.24-5-5-5z"></path></svg>`;
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
        
        let itemName = '', iconHtml = '';
        if (p.type === 'camera') {
            const baseId = parseInt(String(p.uniqueId).split('-')[0], 10);
            const cam = allCams.find(c => c.instanceId === baseId);
            itemName = cam?.name || 'Camera';
            iconHtml = getCameraIcon(itemName);
        } else if (p.type === 'nvr') {
            const nvr = allNvrs.find(n => `nvr-${n.id}` === p.uniqueId);
            itemName = nvr?.product?.name || 'NVR';
            iconHtml = 'NVR';
        } else if (p.type === 'fov') {
            itemName = 'Field of View';
        }
        el.innerHTML = `${iconHtml}<span class="ldz-placed-label">${itemName}</span>`;

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
          [rangeDecreaseBtn, rangeIncreaseBtn, rotateLeftBtn, rotateRightBtn].forEach(btn => {
              if (btn) btn.disabled = !fovControlsEnabled;
          });
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

              const r = (fovPlacement.fov?.range ?? 60);
              fovRangeInput.value = r;
              if (fovRangeValue) fovRangeValue.textContent = `${r} ft`;
              if (cameraRangeInput) cameraRangeInput.value = r;
              if (cameraRangeValue) cameraRangeValue.textContent = `${r} ft`;

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

          const isRotateFov = e.target.classList.contains('ldz-fov-rotate');
          const isRotateCam = e.target.classList.contains('ldz-camera-rotate-handle');
          const isRange  = e.target.classList.contains('ldz-fov-range');
          let mode = isRotateCam ? 'rotateCam' : isRotateFov ? 'rotateFov' : isRange ? 'range' : 'move';

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
                const ang = Math.atan2(mouseY - p.y, mouseX - p.x) * 180 / Math.PI;
                p.fov = p.fov || {angle:90, range:60, rotation:0};
                p.fov.rotation = Math.round(ang + 90);
                if (fovRotationInput) fovRotationInput.value = p.fov.rotation;
                if (fovRotationValue) fovRotationValue.textContent = `${p.fov.rotation}°`;
                redraw();
            } else if (mode==='range'){
                const delta = Math.sqrt(Math.pow(mouseX - p.x, 2) + Math.pow(mouseY - p.y, 2));
                p.fov = p.fov || {angle:90, range:60, rotation:0};
                p.fov.range = Math.max(10, Math.min(2000, Math.round(delta)));
                if (fovRangeInput) fovRangeInput.value = p.fov.range;
                if (fovRangeValue) fovRangeValue.textContent = `${p.fov.range} ft`;
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
        });

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
              fov: { angle: 90, range: 60, rotation: 0, color: 'rgba(234,179,8,0.5)' }
          };
          newPlacements.push(fovItem);
      } else if (mainItem.type === 'fov') {
          mainItem.fov = { angle: 90, range: 60, rotation: 0, color: 'rgba(234,179,8,0.5)' };
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
                 placementToUpdate.fov = { angle: 90, range: 60, rotation: 0 };
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

    function setFovControlValue(prop, value, finalize = false) {
        const inputs = prop === 'rotation'
            ? [fovRotationInput].filter(Boolean)
            : [fovRangeInput, cameraRangeInput].filter(Boolean);
        if (!inputs.length) return;
        const baseInput = inputs[0];
        const min = baseInput.min !== '' ? parseInt(baseInput.min, 10) : Number.NEGATIVE_INFINITY;
        const max = baseInput.max !== '' ? parseInt(baseInput.max, 10) : Number.POSITIVE_INFINITY;
        const clamped = Math.max(min, Math.min(max, value));
        if (prop === 'rotation') {
            if (fovRotationValue) {
                fovRotationValue.textContent = `${clamped}°`;
            }
        } else if (prop === 'range') {
            if (fovRangeValue) {
                fovRangeValue.textContent = `${clamped} ft`;
            }
            if (cameraRangeValue) {
                cameraRangeValue.textContent = `${clamped} ft`;
            }
        }
        inputs.forEach((inputEl) => {
            inputEl.value = clamped;
        });
        updateSelectedFov(prop, clamped, finalize);
    }

    function adjustFovValue(prop, delta) {
        const inputs = prop === 'rotation'
            ? [fovRotationInput].filter(Boolean)
            : [fovRangeInput, cameraRangeInput].filter(Boolean);
        if (!inputs.length) return;
        const current = parseInt(inputs[0].value, 10) || 0;
        setFovControlValue(prop, current + delta, false);
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
      setFovControlValue('range', range);
    });
    fovRangeInput.addEventListener('change', (e)=>{
      const range = parseInt(e.target.value,10);
      setFovControlValue('range', range, true);
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
      setFovControlValue('rotation', rotation);
    });
    fovRotationInput.addEventListener('change', (e)=>{
      const rotation = parseInt(e.target.value,10);
      setFovControlValue('rotation', rotation, true);
    });

    if (rangeDecreaseBtn) {
      rangeDecreaseBtn.addEventListener('click', (e) => {
        const step = e.shiftKey ? RANGE_STEP * 3 : RANGE_STEP;
        adjustFovValue('range', -step);
      });
    }
    if (rangeIncreaseBtn) {
      rangeIncreaseBtn.addEventListener('click', (e) => {
        const step = e.shiftKey ? RANGE_STEP * 3 : RANGE_STEP;
        adjustFovValue('range', step);
      });
    }
    if (cameraRangeDecreaseBtn) {
      cameraRangeDecreaseBtn.addEventListener('click', (e) => {
        const step = e.shiftKey ? RANGE_STEP * 3 : RANGE_STEP;
        adjustFovValue('range', -step);
      });
    }
    if (cameraRangeIncreaseBtn) {
      cameraRangeIncreaseBtn.addEventListener('click', (e) => {
        const step = e.shiftKey ? RANGE_STEP * 3 : RANGE_STEP;
        adjustFovValue('range', step);
      });
    }
    if (rotateLeftBtn) {
      rotateLeftBtn.addEventListener('click', (e) => {
        const step = e.shiftKey ? ROTATION_STEP * 3 : ROTATION_STEP;
        adjustFovValue('rotation', -step);
      });
    }
    if (rotateRightBtn) {
      rotateRightBtn.addEventListener('click', (e) => {
        const step = e.shiftKey ? ROTATION_STEP * 3 : ROTATION_STEP;
        adjustFovValue('rotation', step);
      });
    }

    if (fovRangeInput) {
      fovRangeInput.addEventListener('wheel', (event) => {
        if (fovControls && fovControls.style.display === 'none') return;
        event.preventDefault();
        const step = event.shiftKey ? RANGE_STEP * 3 : RANGE_STEP;
        adjustFovValue('range', event.deltaY < 0 ? step : -step);
      }, { passive: false });
    }

    if (fovRotationInput) {
      fovRotationInput.addEventListener('wheel', (event) => {
        if (fovControls && fovControls.style.display === 'none') return;
        event.preventDefault();
        const step = event.shiftKey ? ROTATION_STEP * 3 : ROTATION_STEP;
        adjustFovValue('rotation', event.deltaY < 0 ? step : -step);
      }, { passive: false });
    }

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
        [rangeDecreaseBtn, rangeIncreaseBtn, rotateLeftBtn, rotateRightBtn].forEach(btn => {
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
              const step = (e.shiftKey ? 3 : 1) * ROTATION_STEP;
              adjustFovValue('rotation', key === 'q' ? -step : step);
              return;
          }
          if (key === 'w' || key === 's') {
              e.preventDefault();
              const step = (e.shiftKey ? 3 : 1) * RANGE_STEP;
              adjustFovValue('range', key === 'w' ? step : -step);
              return;
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

    const onResize = ()=>{ if (img.width) resetView(); };
    window.addEventListener('resize', onResize);
  };
})();