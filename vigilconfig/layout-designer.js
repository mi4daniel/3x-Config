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
      .ldz-overlay{position:fixed;inset:0;z-index:9999;background:rgba(17,24,39,.75);display:flex;align-items:center;justify-content:center}
      .ldz-modal{background:#fff;color:#111827;border-radius:16px;box-shadow:0 25px 50px rgba(0,0,0,.25);width:min(1100px,95vw);height:85vh;display:flex;overflow:hidden}
      .ldz-sidebar{width:320px;min-width:280px;max-width:360px;border-right:1px solid #e5e7eb;display:flex;flex-direction:column}
      .ldz-sidebar header{padding:16px 16px 8px 16px;border-bottom:1px solid #f3f4f6}
      .ldz-sidebar .ldz-list{padding:12px 12px 0 12px;overflow:auto;flex:1}
      .ldz-item{display:flex;align-items:center;gap:8px;padding:8px;border-radius:10px;border:1px solid #e5e7eb;margin-bottom:8px;background:#fff;cursor:grab}
      .ldz-item:active{cursor:grabbing}
      .ldz-footer{padding:12px;border-top:1px solid #f3f4f6}
      .ldz-btn{display:block;width:100%;padding:10px 12px;border-radius:10px;border:1px solid #e5e7eb;background:#f3f4f6;font-weight:600; cursor:pointer;}
      .ldz-btn:disabled{cursor:not-allowed; opacity:0.5;}
      .ldz-btn.active{background:#e0e7ff;color:#4f46e5;border-color:#c7d2fe;}
      .ldz-btn.primary{background:#111827;color:#fff;border-color:#111827}
      .ldz-btn.danger{background:#fef2f2;color:#dc2626;border-color:#fecaca}
      .ldz-btn + .ldz-btn{margin-top:8px}
      .ldz-icon-btn{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4px 8px;border-radius:10px;font-size:11px;line-height:1.2;gap:2px;flex:1;cursor:pointer;border:1px solid #e5e7eb;background-color:#f3f4f6;}
      .ldz-icon-btn:hover{background:#e5e7eb;}
      .ldz-icon-btn img{width:24px;height:24px;}
      .ldz-icon-btn.active{background:#e0e7ff;color:#4f46e5;border-color:#c7d2fe;}
      .ldz-icon-btn.primary{background:#111827;color:#fff;border-color:#111827}
      .ldz-icon-btn.primary:hover{background:#374151;}
      .ldz-icon-btn.danger:hover{background:#fee2e2;}
      .ldz-canvas-wrap{position:relative;flex:1;background:#111827;display:flex;align-items:center;justify-content:center;overflow:hidden; cursor: default;}
      .ldz-canvas-wrap.wall-mode{cursor:crosshair;}
      #ldzBg, #ldzFov, #ldzWalls{position:absolute;top:0;left:0}
      #ldzOverlay{position:absolute;top:0;left:0;transform-origin: top left;}
      .ldz-placed{position:absolute;width:32px;height:32px;border:2px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font:600 14px/1 Arial, sans-serif;cursor:grab;user-select:none;box-sizing:border-box}
      .ldz-placed-label{position:absolute;top:100%;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.7);color:#fff;font-size:11px;padding:2px 6px;border-radius:4px;white-space:nowrap;margin-top:5px;font-weight:500}
      .ldz-placed.camera{background:rgba(0,114,198,.9); border-radius: 9999px;}
      .ldz-placed.nvr{background:rgba(74,85,104,.9); border-radius: 6px; font-size:12px; font-weight:700;}
      .ldz-placed.fov{background:rgba(234,179,8,.75); border-radius: 9999px;}
      .ldz-placed.fov.linked{display:none} /* Hide FOV handle when linked */
      .ldz-placed.selected{box-shadow:0 0 0 3px rgba(59,130,246,.5)}
      .ldz-fov-handle{position:absolute;width:10px;height:10px;background:#fff;border-radius:9999px; cursor: crosshair;}
      .ldz-fov-rotate{top:-12px;left:50%;transform:translateX(-50%)}
      .ldz-fov-range{bottom:-12px;left:50%;transform:translateX(-50%)}
      .ldz-camera-rotate-handle{display:none; position:absolute; top:-15px; left:50%; transform:translateX(-50%); width:10px; height:10px; background:#3b82f6; border:1px solid #fff; border-radius:9999px; cursor: crosshair;}
      .ldz-placed.selected .ldz-camera-rotate-handle{display:block;}
      .ldz-close{position:absolute;top:10px;right:10px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:6px 10px;cursor:pointer;z-index:10}
      .ldz-field{display:flex;align-items:center;gap:8px;margin:8px 12px}
      .ldz-label{font-size:12px;color:#374151}
      .ldz-range{width:100%}
      .ldz-colors{display:flex;gap:6px;padding:8px 12px; justify-content: center;}
      .ldz-color-swatch{width:24px;height:24px;border-radius:9999px;border:2px solid transparent;cursor:pointer}
      .ldz-color-swatch.selected{border-color:#3b82f6}
      .ldz-close{position:absolute;top:10px;right:10px;background:transparent;border:0;padding:0;cursor:pointer;z-index:10;opacity:0.8;}
      .ldz-close:hover{opacity:1}
      .ldz-close img{width:32px;height:32px;}
      #context-menu button { display: block; width: 100%; padding: 8px 12px; text-align: left; background: none; border: none; cursor: pointer; }
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

  // ---- Utility: export/print ----
  window.getLayoutCanvasAsImage = async function(){
    const cfg = getConfig();
    const placements = cfg.layoutPlacements || [];
    if (!cfg.cameraLayout) return null;
    
    // This export function is simplified and does NOT render shadows for now.
    const { allCams, allNvrs } = collectItems();

    const temp = document.createElement('canvas');
    const ctx = temp.getContext('2d');
    const img = new Image();
    const legend = [];

    return new Promise(resolve=>{
      img.onload = ()=>{
        temp.width = img.width; temp.height = img.height;
        ctx.drawImage(img, 0, 0);

        // Draw Walls on Export
        drawWalls(ctx); // Use the refactored function

        placements.forEach(p=>{
          if (p.type==='fov'){
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(((p.fov?.rotation)||0)*Math.PI/180);
            const ang = p.fov?.angle ?? 90;
            const r = p.fov?.range ?? 60;
            ctx.beginPath();
            if (ang<360){
              const half = (ang/2)*(Math.PI/180);
              ctx.moveTo(0,0);
              ctx.arc(0,0,r,-half,half);
              ctx.closePath();
            } else {
              ctx.arc(0,0,r,0,2*Math.PI);
            }
            ctx.fillStyle = p.fov?.color || 'rgba(255,255,0,.35)';
            ctx.fill();
            ctx.restore();
            return;
          }
          let item;
          if (p.type==='camera'){
            const baseId = parseInt(String(p.uniqueId).split('-')[0], 10);
            item = allCams.find(c=>c.instanceId===baseId);
          } else if (p.type==='nvr'){
            item = allNvrs.find(n=>n.id===p.deviceId)?.product;
          }
          const name = item?.name || item?.id || p.type;
          const num = legend.push({name});
          ctx.fillStyle = p.type==='camera' ? 'rgba(0,114,198,.9)' : 'rgba(74,85,104,.9)';
          ctx.beginPath(); ctx.arc(p.x,p.y,15,0,2*Math.PI); ctx.fill();
          ctx.lineWidth=2; ctx.strokeStyle='#fff'; ctx.stroke();
          ctx.fillStyle='#fff'; ctx.font='bold 14px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.fillText(String(num), p.x, p.y);
        });
        const legendHtml = `<div class="layout-legend"><h3>Layout Legend</h3><ol>${
          legend.map((i,idx)=>`<li><strong>${idx+1}:</strong> ${i.name}</li>`).join('')
        }</ol></div>`;
        resolve({image: temp.toDataURL('image/png'), legend: legendHtml});
      };
      img.onerror = ()=>resolve(null);
      img.src = cfg.cameraLayout;
    });
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
        <div class="ldz-sidebar">
          <header>
            <div style="font-weight:700;font-size:16px">Camera Layout Designer</div>
            <div style="font-size:12px;color:#6b7280">Drag items or draw walls on the floor plan.</div>
          </header>
          <div class="ldz-list"><div id="ldzItems"></div></div>
          <div class="ldz-footer">
            <div id="ldzFovControls" style="display: none;">
                <div class="ldz-field">
                    <span class="ldz-label">FOV Angle: <strong id="ldzFovAngleValue">90°</strong></span>
                    <input id="ldzFovAngle" class="ldz-range" type="range" min="15" max="360" value="90">
                </div>
                <div class="ldz-field">
                    <span class="ldz-label">FOV Range:</span>
                    <input id="ldzFovRange" class="ldz-range" type="range" min="10" max="500" value="60">
                </div>
                <div class="ldz-colors" id="ldzFovColors">
                    <button class="ldz-color-swatch selected" style="background:rgba(234,179,8,0.5)" data-color="rgba(234,179,8,0.5)"></button>
                    <button class="ldz-color-swatch" style="background:rgba(239,68,68,0.4)" data-color="rgba(239,68,68,0.4)"></button>
                    <button class="ldz-color-swatch" style="background:rgba(34,197,94,0.4)" data-color="rgba(34,197,94,0.4)"></button>
                    <button class="ldz-color-swatch" style="background:rgba(139,92,246,0.4)" data-color="rgba(139,92,246,0.4)"></button>
                </div>
                <div class="ldz-field">
                    <span class="ldz-label">FOV Rotation: <strong id="ldzFovRotationValue">0°</strong></span>
                    <input id="ldzFovRotation" class="ldz-range" type="range" min="0" max="360" value="0">
                </div>
            </div>
            <div id="ldzSelectionControls" style="display: none; flex-direction: column; gap: 8px; margin-top: 8px;">
                <div style="display: flex; gap: 8px;">
                    <button id="ldzLinkBtn" class="ldz-icon-btn" style="display:none;"><img src="/icons/link_.png" alt="Link"><span>Link FOV</span></button>
                    <button id="ldzUnlinkBtn" class="ldz-icon-btn" style="display:none;"><img src="/icons/unlink_.png" alt="Unlink"><span>Unlink FOV</span></button>
                </div>
                <button id="ldzDeleteBtn" class="ldz-icon-btn danger" style="width:100%;"><img src="/icons/delete_.png" alt="Delete"><span>Delete Item</span></button>
            </div>
            <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                <button id="ldzUndo" class="ldz-icon-btn"><img src="/icons/undo.png" alt="Undo"><span>Undo</span></button>
                <button id="ldzRedo" class="ldz-icon-btn"><img src="/icons/redo.png" alt="Redo"><span>Redo</span></button>
                <button id="ldzDrawWall" class="ldz-icon-btn"><img src="/icons/wall_.png" alt="Draw Walls"><span>Draw Walls</span></button>
            </div>
            <div style="display: flex; gap: 8px; margin-top: 8px;">
                <button id="ldzReset" class="ldz-icon-btn danger"><img src="/icons/reset-left-line_.png" alt="Reset"><span>Reset</span></button>
                <button id="ldzDownload" class="ldz-icon-btn primary"><img src="/icons/image-download_.png" alt="Download"><span>Download</span></button>
                <button id="ldzClose" class="ldz-icon-btn"><img src="/icons/close-circle-twotone_.png" alt="Close"><span>Close</span></button>
            </div>
          </div>
        </div>
        <div class="ldz-canvas-wrap">
          <button class="ldz-close" id="ldzX"><img src="/icons/close-circle-twotone_.png" alt="Close"></button>
          <canvas id="ldzBg"></canvas>
          <canvas id="ldzFov"></canvas>
          <canvas id="ldzWalls"></canvas>
          <div id="ldzOverlay"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    
    const wrap = overlay.querySelector('.ldz-canvas-wrap');
    const bg = overlay.querySelector('#ldzBg');
    const fovCanvas = overlay.querySelector('#ldzFov');
    const wallCanvas = overlay.querySelector('#ldzWalls');
    const overlayLayer = overlay.querySelector('#ldzOverlay');
    const fovAngleInput = overlay.querySelector('#ldzFovAngle');
    const fovAngleValue = overlay.querySelector('#ldzFovAngleValue');
    const fovRangeInput = overlay.querySelector('#ldzFovRange');
    const fovControls = overlay.querySelector('#ldzFovControls');
    const fovColors = overlay.querySelector('#ldzFovColors');
    const fovRotationInput = overlay.querySelector('#ldzFovRotation');
    const fovRotationValue = overlay.querySelector('#ldzFovRotationValue');
    const selectionControls = overlay.querySelector('#ldzSelectionControls');
    const deleteBtn = overlay.querySelector('#ldzDeleteBtn');
    const linkBtn = overlay.querySelector('#ldzLinkBtn');
    const unlinkBtn = overlay.querySelector('#ldzUnlinkBtn');
    const drawWallBtn = overlay.querySelector('#ldzDrawWall');
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

    function renderItemsList(){
      const list = overlay.querySelector('#ldzItems');
      const cfg = getConfig();
      const placed = new Set((cfg.layoutPlacements||[]).map(p=>p.uniqueId));
      const {allCams, allNvrs} = collectItems();
      const avail = [];

      allCams.forEach(cam=>{
        const qty = Math.max(1, parseInt(cam.quantity,10) || 1);
        for (let i=0;i<qty;i++){
          const uid = `${cam.instanceId}-${i}`;
          if (!placed.has(uid)) avail.push({type:'camera', uniqueId:uid, name:cam.name||cam.id||`Camera ${cam.instanceId}`, image:cam.image||cam.product?.image});
        }
      });
      allNvrs.forEach(nvr=>{
        const uid = `nvr-${nvr.id}`;
        if (!placed.has(uid)) avail.push({type:'nvr', uniqueId:uid, name:nvr.product?.name||nvr.id||'NVR', image:nvr.product?.image});
      });

      const fovUid = `fov-${Date.now()}`;
      const rows = [`<div class="ldz-item" draggable="true" data-type="fov" data-uid="${fovUid}">
        <div style="width:28px;height:28px;border-radius:8px;background:#fde68a"></div><div>Adjustable FOV</div></div>`];
      avail.forEach(it=>{
        rows.push(`<div class="ldz-item" draggable="true" data-type="${it.type}" data-uid="${it.uniqueId}">
          <img src="${it.image||''}" onerror="this.style.display='none'" style="width:28px;height:28px;object-fit:contain;border-radius:6px;border:1px solid #e5e7eb;background:#fff"/>
          <div style="flex:1">${it.name||it.uniqueId}</div>
        </div>`);
      });
      list.innerHTML = rows.join('') || '<div style="color:#6b7280;font-size:12px">No available items</div>';

      list.querySelectorAll('.ldz-item').forEach(el=>{
        el.addEventListener('dragstart', (e)=>{
          e.dataTransfer.setData('text/plain', JSON.stringify({ type: el.dataset.type, uniqueId: el.dataset.uid }));
        });
      });
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
        drawWalls(wallCtx);
        drawFovs();

        ctx.restore(); fovCtx.restore(); wallCtx.restore();
        
        overlayLayer.style.width = `${img.width}px`;
        overlayLayer.style.height = `${img.height}px`;
        overlayLayer.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
        
        renderPlacedMarkers();
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
    }

    function drawWalls(targetCtx) {
        const cfg = getConfig();
        if (!cfg.layoutWalls) return;

        targetCtx.strokeStyle = '#ff3b30';
        targetCtx.lineWidth = 3;
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
                wrap.style.cursor = 'default';
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
          deleteBtn.style.display = 'block';

          let fovPlacement = null;
          const isCamera = p.type === 'camera';
          const isFov = p.type === 'fov';
          const isUnlinkedFov = isFov && !p.linkedTo;

          if (isFov) {
              fovPlacement = p;
          } else if (isCamera) {
              fovPlacement = cfg.layoutPlacements.find(fp => fp.linkedTo === p.uniqueId);
          }
          fovControls.style.display = fovPlacement ? 'block' : 'none';
          const hasLinkedFov = isCamera && !!fovPlacement;
          selectionControls.style.display = 'flex';
          unlinkBtn.style.display = hasLinkedFov ? 'flex' : 'none';
          linkBtn.style.display = isUnlinkedFov ? 'flex' : 'none';

          if (fovPlacement) {
              const a = (fovPlacement.fov?.angle ?? 90);
              fovAngleInput.value = a;
              fovAngleValue.textContent = `${a}°`;
              
              const r = (fovPlacement.fov?.range ?? 60);
              fovRangeInput.value = r;

              const rot = (fovPlacement.fov?.rotation ?? 0);
              fovRotationInput.value = rot;
              fovRotationValue.textContent = `${rot}°`;

              fovColors.querySelectorAll('.ldz-color-swatch').forEach(sw => {
                  sw.classList.toggle('selected', sw.dataset.color === (fovPlacement.fov?.color || 'rgba(234,179,8,0.5)'));
              });
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
                redraw();
            } else if (mode==='range'){
                const delta = Math.sqrt(Math.pow(mouseX - p.x, 2) + Math.pow(mouseY - p.y, 2));
                p.fov = p.fov || {angle:90, range:60, rotation:0};
                p.fov.range = Math.max(10, Math.min(2000, Math.round(delta)));
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
              wallCtx.lineWidth = 3;
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
          
          const panStartX = e.clientX - view.x;
          const panStartY = e.clientY - view.y;
          wrap.style.cursor = 'grabbing';
          const onPanMove = (moveEvent) => {
              view.x = moveEvent.clientX - panStartX;
              view.y = moveEvent.clientY - panStartY;
              redraw();
          };
          const onPanUp = () => {
              wrap.style.cursor = 'default';
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
        const zoomFactor = 1.1;
        const oldScale = view.scale;
        
        let newScale = e.deltaY > 0 ? oldScale / zoomFactor : oldScale * zoomFactor;
        newScale = Math.max(0.1, Math.min(newScale, 10));

        view.x = mouseX - (mouseX - view.x) * (newScale / oldScale);
        view.y = mouseY - (mouseY - view.y) * (newScale / oldScale);
        view.scale = newScale;
        
        redraw();
    });

    const closeAndCleanup = () => {
        if (document.body.contains(overlay)) {
            document.body.removeChild(overlay);
        }
        document.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('resize', onResize);
    };

    overlay.querySelector('#ldzClose').addEventListener('click', closeAndCleanup);
    overlay.querySelector('#ldzX').addEventListener('click', closeAndCleanup);
    overlay.querySelector('#ldzUndo').onclick = undo;
    overlay.querySelector('#ldzRedo').onclick = redo;

    drawWallBtn.addEventListener('click', () => {
        currentMode = (currentMode === 'place') ? 'drawWall' : 'place';
        drawWallBtn.classList.toggle('active', currentMode === 'drawWall');
        wrap.classList.toggle('wall-mode', currentMode === 'drawWall');
        if (currentMode === 'place') wrap.style.cursor = 'default';
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
                saveHistory();
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
      updateSelectedFov('range', range);
    });
    fovRangeInput.addEventListener('change', (e)=>{
      const range = parseInt(e.target.value,10);
      updateSelectedFov('range', range, true);
    });

    fovRotationInput.addEventListener('input', (e)=>{
      const rotation = parseInt(e.target.value,10);
      fovRotationValue.textContent = `${rotation}°`;
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
            wrap.style.cursor = 'default';
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
                c.style.outline = '2px dashed #3b82f6';
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
        }
    };

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        if (currentMode === 'drawWall' || currentMode === 'linkFov') {
            currentMode = 'place';
            drawWallBtn.classList.remove('active');
            linkBtn.classList.remove('active');
            wrap.classList.remove('wall-mode');
            wrap.style.cursor = 'default';
            overlay.querySelectorAll('.ldz-placed.camera').forEach(c => c.style.outline = 'none');
        } else {
            closeAndCleanup();
        }
        return;
      }
      if (!selectedId) return;
      const cfg = getConfig();
      const placement = (cfg.layoutPlacements || []).find(p => p.uniqueId === selectedId);
      if (!placement) return;
      
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

    const onResize = ()=>{ if (img.width) resetView(); };
    window.addEventListener('resize', onResize);
  };
})();