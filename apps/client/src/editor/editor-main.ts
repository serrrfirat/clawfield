import * as THREE from 'three';
import { loadPalette } from '@clawfield/shared';
import { injectEditorStyles } from './editor-styles';
import { EditorUI, type EditorMode } from './editor-ui';
import { EditorCamera } from './editor-camera';
import { WorldRenderer } from '../voxel/world-renderer';
import { generateTerrain, getDefaultConfig, setEditorMapContext, type TerrainConfig, type MapdefBounds, type TerrainPaletteEntry } from './terrain-generator';
import { ComponentBrowser, type ComponentFile } from './component-browser';
import { PlacementSystem, PaletteManager, type Placement } from './placement-system';
import { MetadataEditor } from './metadata-editor';
import {
  createNewMapdef,
  downloadMapdef,
  openMapdefPicker,
  serializeMapdef,
  parseSpawnsFromMapdef,
  parseCapturesFromMapdef,
  getDefaultPalette,
  type MapdefFile,
} from './mapdef-io';
import { savePrompt, checkForAIResult } from './ai-generator';

// ---------------------------------------------------------------------------
// Editor state
// ---------------------------------------------------------------------------

let dirty = false;
let chunks = new Map<string, Uint8Array>();
let terrainConfig: TerrainConfig;
let terrainPalette: Record<string, TerrainPaletteEntry>;
let paletteManager: PaletteManager;
let mapName = 'Untitled';
let heightmap: Map<string, number> | null = null;

// Capture point naming
let nextCaptureId = 'A';
function advanceCaptureId(): string {
  const id = nextCaptureId;
  nextCaptureId = String.fromCharCode(nextCaptureId.charCodeAt(0) + 1);
  return id;
}

// ---------------------------------------------------------------------------
// Mouse NDC tracking
// ---------------------------------------------------------------------------

const mouseNDC = new THREE.Vector2();
let canvasRect: DOMRect;

function updateMouseNDC(e: MouseEvent): void {
  if (!canvasRect) return;
  mouseNDC.x = ((e.clientX - canvasRect.left) / canvasRect.width) * 2 - 1;
  mouseNDC.y = -((e.clientY - canvasRect.top) / canvasRect.height) * 2 + 1;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  injectEditorStyles();

  // Create UI
  const ui = new EditorUI({
    onNew: handleNew,
    onOpen: handleOpen,
    onSave: handleSave,
    onModeChange: handleModeChange,
    onAIGenerate: handleAIGenerate,
  });

  const container = ui.getCanvasContainer();
  canvasRect = container.getBoundingClientRect();

  // Renderer (simplified — no post-processing)
  const webglRenderer = new THREE.WebGLRenderer({ antialias: true });
  webglRenderer.setSize(container.clientWidth, container.clientHeight);
  webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  webglRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  webglRenderer.toneMappingExposure = 1.1;
  webglRenderer.shadowMap.enabled = true;
  webglRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(webglRenderer.domElement);

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7ec8e3);
  scene.fog = new THREE.Fog(0xa9c2d0, 200, 500);

  // Lighting (same as game renderer)
  const hemi = new THREE.HemisphereLight(0x87ceeb, 0x5c4033, 0.5);
  scene.add(hemi);

  const sunLight = new THREE.DirectionalLight(0xfff4e0, 1.2);
  sunLight.position.set(60, 100, 40);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far = 400;
  sunLight.shadow.camera.left = -120;
  sunLight.shadow.camera.right = 120;
  sunLight.shadow.camera.top = 120;
  sunLight.shadow.camera.bottom = -120;
  sunLight.shadow.bias = -0.001;
  sunLight.shadow.normalBias = 0.3;
  scene.add(sunLight);
  scene.add(sunLight.target);

  const fill = new THREE.DirectionalLight(0xb0d0e8, 0.3);
  fill.position.set(-40, 30, -50);
  scene.add(fill);

  // Grid helper
  const grid = new THREE.GridHelper(300, 300, 0x444466, 0x333355);
  grid.position.y = -0.01;
  scene.add(grid);

  // Camera
  const editorCamera = new EditorCamera(container);
  scene.add(editorCamera.camera);

  // World renderer
  const worldRenderer = new WorldRenderer(scene);

  // Palette manager
  paletteManager = new PaletteManager();
  terrainPalette = getDefaultPalette();
  paletteManager.setTerrainPalette(terrainPalette);

  // Terrain config
  terrainConfig = getDefaultConfig();

  // Subsystems
  const componentBrowser = new ComponentBrowser(ui.getSidebarContent(), handleComponentSelect);
  const placementSystem = new PlacementSystem(scene, editorCamera.camera, markDirty);
  const metadataEditor = new MetadataEditor(scene, editorCamera.camera, markDirty, (pos) =>
    editorCamera.focusOn(pos)
  );

  // Mode panels
  let terrainPanel: HTMLDivElement | null = null;
  let currentMode: EditorMode = 'terrain';

  // ---------------------------------------------------------------------------
  // Terrain panel builder
  // ---------------------------------------------------------------------------

  function buildTerrainPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = 'editor-panel';

    // Seed
    const seedRow = makeRow('Seed');
    const seedInput = document.createElement('input');
    seedInput.type = 'number';
    seedInput.value = String(terrainConfig.seed);
    seedInput.addEventListener('change', () => { terrainConfig.seed = parseInt(seedInput.value) || 0; });
    seedRow.appendChild(seedInput);
    panel.appendChild(seedRow);

    // Max step
    const stepRow = makeRow('Max Step');
    const stepInput = document.createElement('input');
    stepInput.type = 'range';
    stepInput.min = '1';
    stepInput.max = '3';
    stepInput.value = String(terrainConfig.maxStepHeight);
    const stepVal = document.createElement('span');
    stepVal.className = 'value';
    stepVal.textContent = String(terrainConfig.maxStepHeight);
    stepInput.addEventListener('input', () => {
      terrainConfig.maxStepHeight = parseInt(stepInput.value);
      stepVal.textContent = stepInput.value;
    });
    stepRow.append(stepInput, stepVal);
    panel.appendChild(stepRow);

    // Water level
    const waterRow = makeRow('Water Level');
    const waterInput = document.createElement('input');
    waterInput.type = 'range';
    waterInput.min = '-4';
    waterInput.max = '5';
    waterInput.value = String(terrainConfig.waterLevel);
    const waterVal = document.createElement('span');
    waterVal.className = 'value';
    waterVal.textContent = String(terrainConfig.waterLevel);
    waterInput.addEventListener('input', () => {
      terrainConfig.waterLevel = parseInt(waterInput.value);
      waterVal.textContent = waterInput.value;
    });
    waterRow.append(waterInput, waterVal);
    panel.appendChild(waterRow);

    // Bounds
    const boundsTitle = document.createElement('div');
    boundsTitle.style.cssText = 'margin-top:12px;margin-bottom:4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px';
    boundsTitle.textContent = 'Bounds';
    panel.appendChild(boundsTitle);

    const fields: { label: string; key: keyof MapdefBounds }[] = [
      { label: 'X Min', key: 'xMin' },
      { label: 'X Max', key: 'xMax' },
      { label: 'Z Min', key: 'zMin' },
      { label: 'Z Max', key: 'zMax' },
    ];

    for (const { label, key } of fields) {
      const row = makeRow(label);
      const input = document.createElement('input');
      input.type = 'number';
      input.value = String(terrainConfig.bounds[key]);
      input.addEventListener('change', () => {
        (terrainConfig.bounds as unknown as Record<string, number>)[key] = parseInt(input.value) || 0;
      });
      row.appendChild(input);
      panel.appendChild(row);
    }

    // Generate button
    const genBtn = document.createElement('button');
    genBtn.className = 'editor-panel-btn';
    genBtn.textContent = 'Generate Terrain';
    genBtn.addEventListener('click', () => void regenerateTerrain());
    panel.appendChild(genBtn);

    return panel;
  }

  function makeRow(label: string): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'editor-panel-row';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    row.appendChild(lbl);
    return row;
  }

  // ---------------------------------------------------------------------------
  // Terrain generation
  // ---------------------------------------------------------------------------

  async function regenerateTerrain(): Promise<void> {
    console.time('terrain');

    // Clear chunks
    chunks = new Map();
    worldRenderer.dispose();

    // Reset palette
    paletteManager = new PaletteManager();
    paletteManager.setTerrainPalette(terrainPalette);

    // Set map context for heightmap dispatch (Shoreline vs generic)
    setEditorMapContext(mapName, terrainConfig.seed);

    // Generate
    heightmap = generateTerrain(chunks, terrainPalette, terrainConfig);

    // Load palette into shared MATERIAL_COLORS
    loadPalette(paletteManager.toHexArray());

    // Pre-load all unique components needed by placements
    const uniqueIds = new Set(placementSystem.getPlacements().map(p => p.componentId));
    await Promise.all(
      [...uniqueIds].map(id => componentBrowser.loadComponent(id))
    );

    // Re-render all placements (components are now cached)
    for (const placement of placementSystem.getPlacements()) {
      renderPlacement(placement);
    }

    // Upload to GPU
    worldRenderer.loadAll(chunks);

    console.timeEnd('terrain');
    markDirty();
  }

  // ---------------------------------------------------------------------------
  // Component placement
  // ---------------------------------------------------------------------------

  async function handleComponentSelect(id: string): Promise<void> {
    const comp = await componentBrowser.loadComponent(id);
    if (comp) {
      placementSystem.setGhostComponent(id, comp);
    }
  }

  function renderPlacement(placement: Placement): void {
    const comp = componentBrowser.loadComponent(placement.componentId);
    // loadComponent is async but we may have it cached
    const entry = componentBrowser.getEntry(placement.componentId);
    if (!entry) return;

    // Try synchronous cache access
    const cached = (componentBrowser as unknown as { componentCache: Map<string, ComponentFile> }).componentCache?.get(placement.componentId);
    if (cached) {
      const affected = placementSystem.renderPlacementToChunks(
        placement, cached, paletteManager, chunks, terrainConfig.bounds
      );
      for (const key of affected) {
        const chunkData = chunks.get(key);
        if (chunkData) worldRenderer.setChunk(key, chunkData);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Mode switching
  // ---------------------------------------------------------------------------

  function handleModeChange(mode: EditorMode): void {
    currentMode = mode;
    const sidebar = ui.getSidebarContent();
    sidebar.innerHTML = '';

    placementSystem.removeGhost();
    componentBrowser.hide();

    switch (mode) {
      case 'terrain':
        terrainPanel = buildTerrainPanel();
        sidebar.appendChild(terrainPanel);
        break;
      case 'place':
        componentBrowser.show();
        break;
      case 'metadata':
        metadataEditor.buildSidebar(sidebar);
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // File operations
  // ---------------------------------------------------------------------------

  async function handleNew(): Promise<void> {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    const mapdef = createNewMapdef();
    await loadMapdef(mapdef);
  }

  async function handleOpen(): Promise<void> {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    const mapdef = await openMapdefPicker();
    if (mapdef) loadMapdef(mapdef);
  }

  function handleAIGenerate(): void {
    const registry = componentBrowser.getRegistry();
    if (!registry) {
      alert('Component registry not loaded yet. Wait a moment and try again.');
      return;
    }

    // Build modal
    const overlay = document.createElement('div');
    overlay.className = 'editor-ai-overlay';

    const modal = document.createElement('div');
    modal.className = 'editor-ai-modal';

    // Header
    const header = document.createElement('div');
    header.className = 'editor-ai-header';
    const title = document.createElement('h3');
    title.textContent = 'AI Map Generator';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'editor-ai-close';
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', () => overlay.remove());
    header.append(title, closeBtn);
    modal.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'editor-ai-body';

    const descLabel = document.createElement('label');
    descLabel.textContent = 'Describe your map';
    const descInput = document.createElement('textarea');
    descInput.placeholder = 'A coastal town with a central plaza, apartment buildings on the east hill, a harbor with shipping containers on the west shore, and a fortified hilltop in the southeast. Three capture points along the main road.';
    body.append(descLabel, descInput);

    const helpText = document.createElement('div');
    helpText.style.cssText = 'font-size:11px;color:#888;line-height:1.5';
    helpText.innerHTML = 'Your description will be copied to clipboard. In Claude Code, run <code style="background:#2a2a4a;padding:2px 6px;border-radius:3px">/generate-map</code> and paste it. The editor will auto-detect the result.';
    body.appendChild(helpText);

    modal.appendChild(body);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'editor-ai-footer';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'editor-ai-generate';
    copyBtn.textContent = 'Copy to Clipboard';

    const pollBtn = document.createElement('button');
    pollBtn.className = 'editor-ai-generate';
    pollBtn.style.background = '#2a2a4a';
    pollBtn.style.border = '1px solid #444';
    pollBtn.textContent = 'Check for Result';

    const statusEl = document.createElement('span');
    statusEl.className = 'editor-ai-status';

    footer.append(copyBtn, pollBtn, statusEl);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Close on overlay click (not modal)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // Escape to close
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        overlay.remove();
        window.removeEventListener('keydown', escHandler);
      }
    };
    window.addEventListener('keydown', escHandler);

    // Focus textarea
    descInput.focus();

    // Copy handler — copies description to clipboard for Claude Code
    copyBtn.addEventListener('click', async () => {
      const description = descInput.value.trim();
      if (!description) {
        statusEl.textContent = 'Please enter a map description.';
        statusEl.className = 'editor-ai-status error';
        return;
      }

      // Build a prompt that includes registry context
      const componentList = registry.components
        .map((c) => `${c.id} (${c.bounds.sizeX}x${c.bounds.sizeY}x${c.bounds.sizeZ})`)
        .join('\n');

      const prompt = [
        `Generate a Clawfield map based on this description:`,
        ``,
        description,
        ``,
        `Available components (id, size WxHxD):`,
        componentList,
        ``,
        `Write the result as a .mapdef.json file to: assets/maps/_ai_generated.mapdef.json`,
        `Use the mapdef format from assets/maps/shoreline.mapdef.json as reference.`,
      ].join('\n');

      const copied = await savePrompt(prompt);
      if (copied) {
        statusEl.textContent = 'Copied! Paste into Claude Code terminal.';
        statusEl.className = 'editor-ai-status';
      } else {
        // Fallback: select textarea with the prompt for manual copy
        descInput.value = prompt;
        descInput.select();
        statusEl.textContent = 'Copy failed — select and copy manually.';
        statusEl.className = 'editor-ai-status error';
      }
    });

    // Poll handler — checks for AI-generated result
    pollBtn.addEventListener('click', async () => {
      statusEl.className = 'editor-ai-status';
      statusEl.innerHTML = '<span class="editor-ai-spinner"></span>Checking...';

      const mapdef = await checkForAIResult();
      if (mapdef) {
        statusEl.textContent = 'Map found! Loading...';
        await loadMapdef(mapdef);
        overlay.remove();
        window.removeEventListener('keydown', escHandler);
      } else {
        statusEl.textContent = 'No result yet. Make sure Claude Code wrote _ai_generated.mapdef.json';
        statusEl.className = 'editor-ai-status';
      }
    });
  }

  function handleSave(): void {
    const mapdef = serializeMapdef(
      mapName,
      terrainConfig.bounds,
      terrainPalette,
      terrainConfig.waterLevel,
      terrainConfig.seed,
      placementSystem.getPlacements(),
      metadataEditor.getSpawns(),
      metadataEditor.getCaptures(),
    );
    downloadMapdef(mapdef);
    dirty = false;
    updateStatusBar();
  }

  async function loadMapdef(mapdef: MapdefFile): Promise<void> {
    mapName = mapdef.name;
    terrainConfig = {
      seed: mapdef.terrain.seed ?? 0,
      maxStepHeight: 1,
      waterLevel: mapdef.terrain.waterLevel,
      bounds: { ...mapdef.bounds },
    };
    terrainPalette = mapdef.terrainPalette;

    // Load placements
    placementSystem.setPlacements(mapdef.placements.map((p) => ({
      componentId: p.componentId,
      position: { ...p.position },
      rotation: p.rotation,
      terrainCarve: p.terrainCarve ?? false,
    })));

    // Load metadata
    metadataEditor.setSpawns(parseSpawnsFromMapdef(mapdef));
    metadataEditor.setCaptures(parseCapturesFromMapdef(mapdef));

    // Regenerate terrain (async — pre-loads components)
    await regenerateTerrain();

    dirty = false;
    updateStatusBar();

    // Reset mode panel
    handleModeChange(ui.getMode());
  }

  // ---------------------------------------------------------------------------
  // Dirty tracking
  // ---------------------------------------------------------------------------

  function markDirty(): void {
    dirty = true;
    updateStatusBar();
  }

  function updateStatusBar(): void {
    ui.updateStatus(
      placementSystem.getPlacements().length,
      metadataEditor.getSpawnCount(),
      dirty,
    );
  }

  // ---------------------------------------------------------------------------
  // Input handling
  // ---------------------------------------------------------------------------

  container.addEventListener('mousemove', (e) => {
    canvasRect = container.getBoundingClientRect();
    updateMouseNDC(e);

    if (currentMode === 'place' && placementSystem.hasGhost()) {
      placementSystem.updateGhost(mouseNDC);
      const pos = placementSystem.getGhostPosition();
      if (pos) ui.updateCursor(pos.x, pos.y, pos.z);
      else ui.clearCursor();
    }
  });

  container.addEventListener('click', async (e) => {
    // Don't handle if it was a right/middle button
    if (e.button !== 0) return;
    canvasRect = container.getBoundingClientRect();
    updateMouseNDC(e);

    if (currentMode === 'place') {
      if (placementSystem.hasGhost()) {
        // Place component
        const placement = placementSystem.placeGhost();
        if (placement) {
          // Load component and render
          const comp = await componentBrowser.loadComponent(placement.componentId);
          if (comp) {
            const affected = placementSystem.renderPlacementToChunks(
              placement, comp, paletteManager, chunks, terrainConfig.bounds
            );
            // Update palette
            loadPalette(paletteManager.toHexArray());
            // Re-mesh affected chunks
            for (const key of affected) {
              const chunkData = chunks.get(key);
              if (chunkData) worldRenderer.setChunk(key, chunkData);
            }
          }
          markDirty();
        }
      } else {
        // Select existing placement
        const idx = placementSystem.findPlacementAt(mouseNDC);
        if (idx >= 0) placementSystem.selectPlacement(idx);
      }
    }

    if (currentMode === 'metadata') {
      // Handled by key bindings (1, 2, 3)
    }
  });

  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;

    // Ctrl+S = save
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      handleSave();
      return;
    }

    // Ctrl+O = open
    if (e.ctrlKey && e.key === 'o') {
      e.preventDefault();
      handleOpen();
      return;
    }

    // Ctrl+N = new
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      handleNew();
      return;
    }

    if (currentMode === 'place') {
      if (e.key === 'r' || e.key === 'R') {
        placementSystem.rotateGhost();
      }
      if (e.key === 't' || e.key === 'T') {
        const idx = placementSystem.getSelectedIndex();
        if (idx >= 0) {
          placementSystem.toggleTerrainCarve(idx);
          // Regenerate to apply
          void regenerateTerrain();
        }
      }
      if (e.key === 'x' || e.key === 'X' || e.key === 'Delete') {
        const idx = placementSystem.getSelectedIndex();
        if (idx >= 0) {
          placementSystem.deletePlacement(idx);
          void regenerateTerrain();
        }
      }
      if (e.key === 'Escape') {
        placementSystem.removeGhost();
        componentBrowser.clearSelection();
      }
    }

    if (currentMode === 'metadata') {
      if (e.key === '1') {
        metadataEditor.placeSpawn('alpha', mouseNDC);
        markDirty();
      }
      if (e.key === '2') {
        metadataEditor.placeSpawn('bravo', mouseNDC);
        markDirty();
      }
      if (e.key === '3') {
        const id = advanceCaptureId();
        metadataEditor.placeCapture(id, mouseNDC);
        markDirty();
      }
      if (e.key === 'x' || e.key === 'X' || e.key === 'Delete') {
        if (metadataEditor.deleteNearest(mouseNDC)) {
          markDirty();
        }
      }
    }
  });

  // Unsaved changes warning
  window.addEventListener('beforeunload', (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ---------------------------------------------------------------------------
  // Resize handling
  // ---------------------------------------------------------------------------

  window.addEventListener('resize', () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w > 0 && h > 0) {
      webglRenderer.setSize(w, h);
      canvasRect = container.getBoundingClientRect();
    }
  });

  // ---------------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------------

  let lastTime = performance.now();

  function animate(): void {
    requestAnimationFrame(animate);

    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    editorCamera.update(dt);
    webglRenderer.render(scene, editorCamera.camera);
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  // Show terrain panel by default
  handleModeChange('terrain');

  // Init component browser (background load)
  componentBrowser.init();

  // Generate initial terrain
  void regenerateTerrain();

  // Start render loop
  animate();

  console.log('Clawfield Map Editor ready');
}

main().catch(console.error);
