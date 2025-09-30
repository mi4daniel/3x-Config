(function (window) {
  'use strict';

  let deps = {};
  let index = {
    all: [],
    cameras: [],
    nvrs: [],
    switches: [],
    byId: new Map(),
  };

  /* =========================
     UI (keeps your look/feel)
     ========================= */
  function openChatbotModal() {
    const modalHtml = `
      <div id="chatbot-window">
        <div class="bg-gray-800 text-white p-3 font-bold text-lg flex justify-between items-center">
          <span>3xLOGIC Assistant</span>
          <button id="closeChatbot" class="text-2xl leading-none">&times;</button>
        </div>
        <div id="chatbot-messages" class="flex flex-col"></div>
        <div id="chatbot-input-container" class="flex gap-2 p-2 border-t">
          <input type="text" id="chatbot-input" class="flex-1 border rounded px-3 py-2" placeholder="Ask me something... e.g., Recommend an NVR for 24 cameras on Linux">
          <button id="chatbot-send" class="px-3 py-2 bg-blue-600 text-white rounded">Send</button>
        </div>
      </div>
    `;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = modalHtml;
    document.getElementById('modalContainer').appendChild(overlay);
    setTimeout(() => overlay.classList.add('show'), 10);

    const close = () => {
      overlay.classList.remove('show');
      overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
    };

    overlay.querySelector('#closeChatbot').addEventListener('click', close);
    overlay.querySelector('#chatbot-send').addEventListener('click', processChatInput);
    const input = overlay.querySelector('#chatbot-input');
    input.addEventListener('keyup', (e) => { if (e.key === 'Enter') processChatInput(); });

    setTimeout(() => {
      addChatMessage("Hello! I can recommend NVRs, find cameras, compare models, check capacity, list compatible mounts, and summarize your configuration.", 'bot');
      input.focus();
    }, 250);
  }

  function addChatMessage(message, sender) {
    const box = document.getElementById('chatbot-messages');
    if (!box) return;
    const el = document.createElement('div');
    el.className = `chat-message p-2 rounded-lg mb-2 max-w-[80%] ${sender === 'user' ? 'bg-blue-500 text-white self-end ml-auto' : 'bg-gray-200 text-gray-800 self-start'}`;
    el.innerHTML = message;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  }

  /* =========================
     Build a searchable index
     ========================= */
  function buildProductIndex(products) {
    index = { all: [], cameras: [], nvrs: [], switches: [], byId: new Map() };

    const push = (p) => {
      if (!p || !p.id) return;
      const text = [
        p.id, p.name, p.description, p.type, p.size, p.resolution
      ].filter(Boolean).join(' ').toLowerCase();

      const item = { ...p, _text: text };
      index.all.push(item);
      index.byId.set(p.id, item);

      const dt = (p.deviceType || '').toLowerCase();
      if (dt === 'camera') index.cameras.push(item);
      else if (dt.includes('nvr') || dt.includes('hvr') || p.channels > 0) index.nvrs.push(item);
      else if (dt.includes('switch') || /poe/i.test(p.name || '') || /poe/i.test(p.description || '')) index.switches.push(item);
    };

    // Recorders
    try {
      const cctv = products?.['CCTV Products'];
      const rec = cctv?.['Recorders (NVRs & HVRs)'];
      if (rec) {
        Object.values(rec).forEach(group => {
          if (Array.isArray(group)) group.forEach(push);
          else if (group && typeof group === 'object') {
            Object.values(group).forEach(list => Array.isArray(list) && list.forEach(push));
          }
        });
      }
    } catch (e) { console.warn('[chatbot] Recorder index build warning:', e); }

    // Cameras
    try {
      const camsRoot = products?.['Cameras'];
      if (camsRoot) {
        Object.values(camsRoot).forEach(series => {
          if (Array.isArray(series)) series.forEach(push);
          else if (series && typeof series === 'object') {
            Object.values(series).forEach(list => Array.isArray(list) && list.forEach(push));
          }
        });
      }
    } catch (e) { console.warn('[chatbot] Camera index build warning:', e); }

    // Switches
    try {
      const net = products?.['Networking'];
      const switches = net?.['POE Switches'];
      if (Array.isArray(switches)) switches.forEach(push);
    } catch (e) { console.warn('[chatbot] Switch index build warning:', e); }
  }

  /* =========================
     Domain helpers
     ========================= */
  const camsNumRe = /(\d+)\s*(?:ch|channels?|cams?|cameras?)/i;

  function parseDesiredCameraCount(text) {
    const m = text.match(camsNumRe);
    return m ? parseInt(m[1], 10) : null;
  }

  function estimateFromWords(text) {
    if (/small|few/i.test(text)) return 8;
    if (/medium/i.test(text)) return 16;
    if (/large|bigger/i.test(text)) return 32;
    return null;
  }

  function nearestNvrForCount(count, query = '') {
    const wantLinux = /\blinux\b/i.test(query);
    const wantWindows = /\bwin(?:dows)?\b/i.test(query);

    // Filter by OS hint if present
    const filtered = index.nvrs.filter(n => {
      const desc = `${n.name} ${n.description}`.toLowerCase();
      if (wantLinux && !desc.includes('linux')) return false;
      if (wantWindows && !(desc.includes('windows') || desc.includes('win os') || /\bwin\b/.test(desc))) return false;
      return Number.isFinite(n.channels);
    });

    const pool = filtered.length ? filtered : index.nvrs;
    const fits = pool.filter(n => (n.channels ?? 0) >= count);
    const sorted = (fits.length ? fits : pool)
      .slice()
      .sort((a, b) => (a.channels - b.channels) || String(a.size||'').localeCompare(String(b.size||'')));

    return sorted[0] || null;
  }

  function findCompatibleMounts(cameraId) {
    const cam = index.byId.get(cameraId);
    if (!cam) return [];
    const mountIds = cam.compatibleMounts || [];
    return mountIds.map(id => index.byId.get(id)).filter(Boolean);
  }

  function differenceBetween(aId, bId) {
    const a = index.byId.get(aId);
    const b = index.byId.get(bId);
    if (!a || !b) return null;
    const fields = ['name','type','channels','size','resolution','poe','poeBudget','licensesLocked','prefilledLicenses','description'];
    const rows = [];
    fields.forEach(f => {
      if (a[f] !== undefined || b[f] !== undefined) {
        rows.push({ field: f, a: a[f] ?? '—', b: b[f] ?? '—' });
      }
    });
    return { a, b, rows };
  }

  function filterByWords(items, query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter(it => words.every(w => it._text.includes(w)));
  }

  function showProductsInPicker(title, items) {
    if (!items?.length) return addChatMessage('No matching products found.', 'bot');
    deps.createProductSelectionModal(title, items, deps.addProduct);
  }

  /* =========================
     Answer generators
     ========================= */
  function answerRecommendNvr(userInput) {
    const count = parseDesiredCameraCount(userInput) ?? estimateFromWords(userInput);
    if (!count) return "How many cameras do you need this NVR to support? (e.g., 24)";
    const nvr = nearestNvrForCount(count, userInput);
    if (!nvr) return "I couldn’t find a suitable NVR in the catalog.";

    const lic = nvr.prefilledLicenses ? `Includes ${nvr.prefilledLicenses} IP licenses. ` : '';
    const locked = nvr.licensesLocked ? 'Licenses are locked. ' : '';
    const poe = (nvr.poeBudget > 0 || /poe/i.test(`${nvr.name} ${nvr.description}`)) ? 'Has built-in PoE or PoE kit. ' : 'Requires PoE switch for camera ports. ';

    return `
      I recommend <strong>${nvr.name}</strong> for ~${count} cameras.<br>
      Channels: <strong>${nvr.channels ?? '—'}</strong> • Size: ${nvr.size || '—'}<br>
      ${lic}${locked}${poe}<br><br>
      <button class="bg-blue-600 text-white px-3 py-1 rounded" onclick="window.__chat_pick_nvr('${nvr.id}')">View options</button>
    `;
  }

  function answerFindCameras(userInput) {
    const results = filterByWords(index.cameras, userInput);
    if (!results.length) return "No cameras matched your filters. Try adding a resolution (e.g., 5MP) or type (bullet/turret/dome).";
    showProductsInPicker('Camera Search Results', results.slice(0, 30));
    return `I found <strong>${results.length}</strong> camera(s). Showing the first ${Math.min(30, results.length)}.`;
  }

  function answerFindNvrs(userInput) {
    const results = filterByWords(index.nvrs, userInput);
    if (!results.length) return "No NVRs matched your filters. Try adding channel count (8/16/32/64/96) or OS (Windows/Linux).";
    showProductsInPicker('NVR Search Results', results.slice(0, 30));
    return `I found <strong>${results.length}</strong> NVR(s). Showing the first ${Math.min(30, results.length)}.`;
  }

  function answerMountsForCamera(userInput) {
    const id = (userInput.match(/([A-Z0-9-]{4,})/gi) || []).find(tok => index.byId.has(tok));
    if (!id) return "Tell me the camera model (e.g., VX-5M-OT-CL-RAW-X) and I’ll list compatible mounts.";
    const mounts = findCompatibleMounts(id);
    if (!mounts.length) return `I couldn’t find compatible mounts for <strong>${id}</strong>.`;
    const list = mounts.map(m => `<li>${m.name || m.id}</li>`).join('');
    return `Compatible mounts for <strong>${id}</strong>:<ul>${list}</ul>`;
  }

  function answerCapacity(userInput) {
    const id = (userInput.match(/([A-Z0-9-]{4,})/gi) || []).find(tok => index.byId.has(tok));
    if (!id) return "Tell me the model ID and I’ll check its channel capacity.";
    const item = index.byId.get(id);
    if (!item?.channels) return `<strong>${item.name || id}</strong> doesn’t list a channel count.`;
    const lic = item.prefilledLicenses ? ` • Includes ${item.prefilledLicenses} IP licenses` : '';
    return `<strong>${item.name}</strong> supports up to <strong>${item.channels}</strong> channels${lic}.`;
  }

  function answerDifference(userInput) {
    const ids = (userInput.match(/([A-Z0-9-]{4,})/gi) || []).filter(tok => index.byId.has(tok));
    if (ids.length < 2) return "Tell me two model IDs and I’ll compare them.";
    const diff = differenceBetween(ids[0], ids[1]);
    if (!diff) return "I couldn’t compare those models.";
    const rows = diff.rows.map(r => `<tr><td class="font-medium pr-3">${r.field}</td><td class="pr-3">${r.a}</td><td>${r.b}</td></tr>`).join('');
    return `
      <div class="mb-1"><strong>${diff.a.name}</strong> vs <strong>${diff.b.name}</strong></div>
      <table class="text-sm"><tbody>${rows}</tbody></table>
    `;
  }

  function generateConfigSummary() {
    const config = deps.getConfiguration ? deps.getConfiguration() : { racks: [], cloudServers: [], cloudCameras: [], allInOneCameras: [], projectName: 'Untitled' };
    const rackCount = (config.racks || []).length;
    const allDevices = (config.racks || []).flatMap(r => r.devices || []);
    const nvrCount = allDevices.filter(d => d.product?.deviceType === 'nvr').length;
    const serverCount = allDevices.filter(d => d.product?.deviceType === 'server').length + (config.cloudServers || []).length;

    const allCameras = [
      ...allDevices.flatMap(d => d.cameras || []),
      ...(config.cloudCameras || []),
      ...(config.allInOneCameras || [])
    ];
    const cameraCount = allCameras.reduce((acc, cam) => acc + (cam.quantity || 0), 0);

    const status = deps.checkSystemStatus ? deps.checkSystemStatus(true) : { warnings: [] };
    const warnings = status.warnings || [];

    let summary = `Here’s a summary of your project "${config.projectName || 'Untitled'}":
      <ul>
        <li><strong>Racks:</strong> ${rackCount}</li>
        <li><strong>NVRs:</strong> ${nvrCount}</li>
        <li><strong>Servers:</strong> ${serverCount}</li>
        <li><strong>Total Cameras:</strong> ${cameraCount}</li>
      </ul>
    `;
    summary += warnings.length ? `There are <strong>${warnings.length}</strong> active warnings. Ask "what is the system status?" to see them.` : "System status is OK.";
    return summary;
  }

  /* =========================
     Intents
     ========================= */
  const intents = [
    { name: 'greeting', patterns: [/(^|\b)(hello|hi|hey|help)\b/], action: () =>
      `Try these:
       <ul>
         <li>“Recommend an NVR for 24 cameras on Linux”</li>
         <li>“Find outdoor 5MP turret cameras”</li>
         <li>“Which mounts fit VX-5M-OT-CL-RAW-X?”</li>
         <li>“What’s the difference between NVR-2U-64CH-16IP-18TB-LINUX and NVR-2U-64CH-16IP-18TB-WIN?”</li>
         <li>“How many cameras can NVR-2U-96CH handle?”</li>
         <li>“Summarize the configuration”</li>
       </ul>`
    },

    // Open your existing pickers quickly
    { name: 'add_nvr', patterns: [/add.*\b(nvr|recorder)\b/i], action: () => { deps.addNvr?.(); return "Opening the NVR selection window."; } },
    { name: 'add_server', patterns: [/add.*\b(server|infinias)\b/i], action: () => { deps.addServer?.(); return "Opening Infinias servers."; } },
    { name: 'add_switch', patterns: [/add.*\b(switch|poe)\b/i], action: () => { deps.addPoeSwitch?.(); return "Opening the PoE Switch selection."; } },

    // Product Q&A
    { name: 'recommend_nvr', patterns: [/\b(best|recommend|suggest).*\b(nvr|recorder)\b/i, /\bnvr\b.*\bfor\b.*(cameras|cams|ch|channels)/i], action: (q) => answerRecommendNvr(q) },
    { name: 'find_cameras', patterns: [/\b(find|search|show)\b.*\bcamera/i], action: (q) => answerFindCameras(q) },
    { name: 'find_nvrs', patterns: [/\b(find|search|show)\b.*\bnvr/i], action: (q) => answerFindNvrs(q) },
    { name: 'mounts_for_camera', patterns: [/\b(compatible|which)\b.*\bmounts?\b/i], action: (q) => answerMountsForCamera(q) },
    { name: 'capacity', patterns: [/\bhow many\b.*\b(cameras|channels)\b/i], action: (q) => answerCapacity(q) },
    { name: 'difference', patterns: [/\b(difference|compare|vs\.?)\b/i], action: (q) => answerDifference(q) },

    // Status & summary
    { name: 'check_status', patterns: [/\b(status|issue|warning|error)\b/], action: () => {
        const { warnings = [] } = deps.checkSystemStatus ? deps.checkSystemStatus(true) : { warnings: [] };
        if (!warnings.length) return "System status is OK. No issues found!";
        return `I found ${warnings.length} issue(s): <ul>${warnings.map(w => `<li><strong>${w.title || 'Issue'}:</strong> ${w.message || ''}</li>`).join('')}</ul>`;
      }
    },
    { name: 'summarize_config', patterns: [/\b(summary|summarize|overview|show me the config)\b/], action: () => generateConfigSummary() },
  ];

  /* =========================
     Input processing
     ========================= */
  function processChatInput() {
    const input = document.getElementById('chatbot-input');
    if (!input) return;
    const userRaw = input.value;
    const user = userRaw.trim();
    if (!user) return;

    addChatMessage(userRaw, 'user');
    input.value = '';

    const qLower = user.toLowerCase();
    let botResponse = null;

    outer: for (const intent of intents) {
      for (const pattern of intent.patterns) {
        if (pattern.test(qLower)) {
          botResponse = intent.action(user);
          break outer;
        }
      }
    }

    if (!botResponse) {
      // Fallback: try camera search then NVR search
      const cams = filterByWords(index.cameras, user).slice(0, 20);
      if (cams.length) {
        deps.createProductSelectionModal('Camera Search Results', cams, deps.addProduct);
        botResponse = `I found <strong>${cams.length}</strong> camera(s). Showing up to 20.`;
      } else {
        const nvrs = filterByWords(index.nvrs, user).slice(0, 20);
        if (nvrs.length) {
          deps.createProductSelectionModal('NVR Search Results', nvrs, deps.addProduct);
          botResponse = `I found <strong>${nvrs.length}</strong> NVR(s). Showing up to 20.`;
        }
      }
    }

    if (!botResponse) botResponse = "I’m not sure yet—try: “recommend an NVR for 24 cameras on Linux,” “find outdoor 5MP turret,” or paste a model ID and ask about capacity.”";
    setTimeout(() => addChatMessage(botResponse, 'bot'), 250);
  }

  function processChatInput() {
    const input = document.getElementById('chatbot-input');
    if (!input) return;
    const userRaw = input.value;
    const user = userRaw.trim();
    if (!user) return;

    addChatMessage(userRaw, 'user');
    input.value = '';

    const qLower = user.toLowerCase();
    let botResponse = null;

    outer: for (const intent of intents) {
      for (const pattern of intent.patterns) {
        if (pattern.test(qLower)) {
          botResponse = intent.action(user);
          break outer;
        }
      }
    }

    if (!botResponse) {
      // Fallback: try camera search then NVR search
      const cams = filterByWords(index.cameras, user).slice(0, 20);
      if (cams.length) {
        deps.createProductSelectionModal('Camera Search Results', cams, deps.addProduct);
        botResponse = `I found <strong>${cams.length}</strong> camera(s). Showing up to 20.`;
      } else {
        const nvrs = filterByWords(index.nvrs, user).slice(0, 20);
        if (nvrs.length) {
          deps.createProductSelectionModal('NVR Search Results', nvrs, deps.addProduct);
          botResponse = `I found <strong>${nvrs.length}</strong> NVR(s). Showing up to 20.`;
        }
      }
    }

    if (!botResponse) botResponse = "I’m not sure yet—try: “recommend an NVR for 24 cameras on Linux,” “find outdoor 5MP turret,” or paste a model ID and ask about capacity.”";
    setTimeout(() => addChatMessage(botResponse, 'bot'), 250);
  }

  /* =========================
     Init wiring
     ========================= */
  window.__chat_pick_nvr = (id) => {
    const nvr = index.byId.get(id);
    if (!nvr) return;
    deps.createProductSelectionModal('Recommended NVR', [nvr], deps.addProduct);
  };

  window.initChatbot = function (chatbotDependencies) {
    deps = chatbotDependencies || {};
    if (deps.products) buildProductIndex(deps.products);

    const btn = document.getElementById('chatbotHeaderButton');
    if (btn) btn.addEventListener('click', openChatbotModal);

    if (deps.openStorageCalculator) window.openStorageCalculator = deps.openStorageCalculator;
  };

})(window);
