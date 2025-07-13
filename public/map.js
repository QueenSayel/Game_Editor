document.addEventListener('DOMContentLoaded', () => {
    let isMapInitialized = false;
    const mapTabButton = document.querySelector('button[data-tab="map"]');
    if (!mapTabButton) return;

    // --- 1. CONFIGURATION ---
    const API_URL_CHUNK = '/.netlify/functions/map-chunk';
    const API_URL_MINIMAP = '/.netlify/functions/map-minimap';
    const PIXEL_SIZE = 24;
    const CHUNK_SIZE = 16;
    const WORLD_WIDTH_IN_TILES = 10000;
    const WORLD_HEIGHT_IN_TILES = 10000;
    const CACHE_SIZE = 250;
    const IMAGE_CACHE_SIZE = 300;
    const MINIMAP_WIDTH_CHUNKS = Math.ceil(WORLD_WIDTH_IN_TILES / CHUNK_SIZE);
    const MINIMAP_HEIGHT_CHUNKS = Math.ceil(WORLD_HEIGHT_IN_TILES / CHUNK_SIZE);
    const MINIMAP_DISPLAY_SIZE = 250;

    // IMPORTANT: Make sure this is the same version as your generator tool
    const tileLegend = {
        0: { name: 'Ocean', color: '#1A237E' }, 1: { name: 'Deep Water', color: '#1565C0' }, 2: { name: 'Coastal Water', color: '#03A9F4' }, 3: { name: 'Shallow Water', color: '#4FC3F7' }, 4: { name: 'Coral Reef', color: '#E040FB' }, 5: { name: 'Icy Water', color: '#B2EBF2' }, 6: { name: 'Murky Swamp Water', color: '#00695C' },
        20: { name: 'Beach Sand', color: '#FFF59D' }, 21: { name: 'Desert Sand', color: '#FFCA28' }, 22: { name: 'Dirt', color: '#8D6E63' }, 23: { name: 'Mud', color: '#5D4037' }, 24: { name: 'Clay', color: '#BCAAA4' }, 25: { name: 'Gravel', color: '#A1887F' },
        40: { name: 'Lush Grass', color: '#4CAF50' }, 41: { name: 'Plains Grass', color: '#8BC34A' }, 42: { name: 'Dry Grass', color: '#CDDC39' }, 43: { name: 'Savanna', color: '#D4E157' }, 44: { name: 'Steppe', color: '#A4B160' },
        60: { name: 'Temperate Forest', color: '#2E7D32' }, 61: { name: 'Boreal Forest (Taiga)', color: '#1B5E20' }, 62: { name: 'Jungle', color: '#00796B' }, 63: { name: 'Enchanted Forest', color: '#673AB7' }, 64: { name: 'Autumn Forest', color: '#EF6C00' }, 65: { name: 'Dead Forest', color: '#795548' },
        80: { name: 'Stone Ground', color: '#BDBDBD' }, 81: { name: 'Rock', color: '#757575' }, 82: { name: 'Mountain', color: '#616161' }, 83: { name: 'Volcanic Rock', color: '#424242' }, 84: { name: 'Snowy Peak', color: '#FAFAFA' },
        100: { name: 'Snow', color: '#F5F5F5' }, 101: { name: 'Ice Sheet', color: '#E1F5FE' }, 102: { name: 'Tundra', color: '#DCE775' }, 103: { name: 'Wasteland', color: '#9E9D24' }, 104: { name: 'Barren Land', color: '#A1887F' }, 105: { name: 'Scorched Earth', color: '#3E2723' },
        120: { name: 'Lava', color: '#E65100' }, 121: { name: 'Magma', color: '#FF3D00' }, 122: { name: 'Corrupted Land', color: '#6A1B9A' }, 123: { name: 'Crystal Fields', color: '#00E5FF' }, 124: { name: 'Shadowlands', color: '#212121' },
        200: { name: 'Cobblestone Road', color: '#A9A9A9' }, 201: { name: 'Wooden Floor', color: '#A1887F' }, 202: { name: 'Stone Wall', color: '#6E6E6E' }, 203: { name: 'City Pavement', color: '#90A4AE' }, 204: { name: 'Farmland', color: '#AFB42B' }, 205: { name: 'Ruin', color: '#B0BEC5' },
        250: { name: 'Player Start', color: '#FFD600' }, 251: { name: 'NPC Spawn Point', color: '#F50057' }, 252: { name: 'Quest Location', color: '#00B0FF' }, 253: { name: 'Dungeon Entrance', color: '#D50000' },
    };
    const colorToTileIdMap = new Map();
    for (const id in tileLegend) { colorToTileIdMap.set(tileLegend[id].color, parseInt(id)); }
    let currentColor = tileLegend[40].color;

    // --- 2. HELPERS & STATE ---
    class LRUCache {
        constructor(maxSize) { this.maxSize = maxSize; this.cache = new Map(); }
        get(key) { if (!this.cache.has(key)) return undefined; const item = this.cache.get(key); this.cache.delete(key); this.cache.set(key, item); return item; }
        set(key, value) { if (this.cache.has(key)) this.cache.delete(key); else if (this.cache.size >= this.maxSize) { this.cache.delete(this.cache.keys().next().value); } this.cache.set(key, value); }
    }
    const chunkCache = new LRUCache(CACHE_SIZE);
    const chunkImageCache = new LRUCache(IMAGE_CACHE_SIZE);
    let stage, mapLayer, gridLayer, tooltip, minimapContainerEl;
    let minimapStage, minimapLayer, minimapViewportRect, minimapImage;
    let isRendering = false, lastTooltipCoord = '';

    const initializeMap = async () => {
        if (isMapInitialized) return;
        isMapInitialized = true;
        console.log("Initializing Map Module...");
        const container = document.getElementById('map-container');
        tooltip = document.getElementById('map-tooltip');
		minimapContainerEl = document.getElementById('minimap-container');
        setupKonva(container);
        createUIPalette();
        await setupMinimap();
        setupEventListeners();
        await drawVisibleWorld();
        updateMinimapViewport();
    };

    function setupKonva(container) {
        stage = new Konva.Stage({ container: container, width: container.clientWidth, height: container.clientHeight, draggable: true });
        mapLayer = new Konva.Layer();
        gridLayer = new Konva.Layer({ listening: false });
        stage.add(mapLayer, gridLayer);
        const worldCenterX = WORLD_WIDTH_IN_TILES / 2 * PIXEL_SIZE;
        const worldCenterY = WORLD_HEIGHT_IN_TILES / 2 * PIXEL_SIZE;
        stage.position({ x: stage.width() / 2 - worldCenterX, y: stage.height() / 2 - worldCenterY });
    }

    // --- 4. DATA MANAGEMENT ---
    async function getChunkData(coordKey) {
        if (chunkCache.has(coordKey)) return chunkCache.get(coordKey);
        const response = await fetch(`${API_URL_CHUNK}?coord=${coordKey}`);
        if (!response.ok) throw new Error(`Failed to fetch chunk ${coordKey}`);
        let data = await response.json();
        if (data) {
            chunkCache.set(coordKey, data);
            return data;
        }
        data = generateChunk();
        chunkCache.set(coordKey, data);
        return data;
    }

    function generateChunk() {
        const chunk = [];
        for (let y = 0; y < CHUNK_SIZE; y++) {
            chunk.push(new Array(CHUNK_SIZE).fill(1)); // Default to Deep Water (ID 1)
        }
        return chunk;
    }

    async function saveChunkData(coordKey, data) {
        return fetch(API_URL_CHUNK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ coord: coordKey, data: data })
        });
    }
    
    function createKonvaImageFromURL(url) {
        return new Promise((resolve) => Konva.Image.fromURL(url, resolve));
    }

    // --- 5. RENDERER ---
    async function drawVisibleWorld() {
        if (isRendering || !stage) return;
        isRendering = true;
        setMapStatus('Loading...', '#f1c40f');
        drawGrid(); 
        await drawHighDetailView();
        updateMinimapViewport();
        isRendering = false;
        setMapStatus('Idle', '#2ecc71');
    }
    
    async function renderChunkToImage(chunkMeta) {
        const CHUNK_PIXEL_SIZE = CHUNK_SIZE * PIXEL_SIZE;
        const chunkData = await getChunkData(chunkMeta.key);
        if (!chunkData) return null;
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = CHUNK_PIXEL_SIZE;
        offscreenCanvas.height = CHUNK_PIXEL_SIZE;
        const context = offscreenCanvas.getContext('2d');
        for (let y = 0; y < CHUNK_SIZE; y++) {
            for (let x = 0; x < CHUNK_SIZE; x++) {
                const tileId = chunkData[y][x];
                const color = tileLegend[tileId]?.color || tileLegend[0].color;
                context.fillStyle = color;
                context.fillRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
            }
        }
        return createKonvaImageFromURL(offscreenCanvas.toDataURL()).then(image => {
            image.position({ x: chunkMeta.x, y: chunkMeta.y });
            image.setAttr('chunkKey', chunkMeta.key);
            return image;
        });
    }

    async function drawHighDetailView() {
        const visibleChunks = getVisibleChunkCoords();
        const visibleKeys = new Set(visibleChunks.data.map(c => c.key));
        const currentlyRenderedKeys = new Set();
        mapLayer.children.forEach(image => {
            const key = image.getAttr('chunkKey');
            if (!visibleKeys.has(key)) { image.destroy(); chunkImageCache.remove(key); } 
            else { currentlyRenderedKeys.add(key); }
        });
        const newChunksToRender = visibleChunks.data.filter(c => !currentlyRenderedKeys.has(c.key));
        const imagePromises = newChunksToRender.map(async (chunkMeta) => {
            let konvaImage = chunkImageCache.get(chunkMeta.key);
            if (!konvaImage) {
                konvaImage = await renderChunkToImage(chunkMeta);
                if (konvaImage) chunkImageCache.set(chunkMeta.key, konvaImage);
            }
            return konvaImage;
        });
        const newImages = (await Promise.all(imagePromises)).filter(img => img);
        mapLayer.add(...newImages);
        mapLayer.batchDraw();
    }
    
    function drawGrid() {
        gridLayer.destroyChildren();
        const scale = stage.scaleX();
        if (scale * PIXEL_SIZE < 5) { gridLayer.batchDraw(); return; }
        const view = getVisibleRect();
        const strokeWidth = Math.max(0.5, 1 / scale);
        const startTX = Math.floor(view.x1 / PIXEL_SIZE), endTX = Math.ceil(view.x2 / PIXEL_SIZE);
        const startTY = Math.floor(view.y1 / PIXEL_SIZE), endTY = Math.ceil(view.y2 / PIXEL_SIZE);
        const lines = [];
        for (let tx = startTX; tx <= endTX; tx++) { lines.push(new Konva.Line({ points: [tx * PIXEL_SIZE, startTY * PIXEL_SIZE, tx * PIXEL_SIZE, endTY * PIXEL_SIZE], stroke: 'rgba(255, 255, 255, 0.25)', strokeWidth, listening: false })); }
        for (let ty = startTY; ty <= endTY; ty++) { lines.push(new Konva.Line({ points: [startTX * PIXEL_SIZE, ty * PIXEL_SIZE, endTX * PIXEL_SIZE, ty * PIXEL_SIZE], stroke: 'rgba(255, 255, 255, 0.25)', strokeWidth, listening: false })); }
        gridLayer.add(...lines);
        gridLayer.batchDraw();
    }

    // --- 6. HELPERS ---
    function getVisibleRect() {
        const scale = stage.scaleX();
        const pos = stage.position();
        return { x1: -pos.x / scale, y1: -pos.y / scale, x2: (-pos.x + stage.width()) / scale, y2: (-pos.y + stage.height()) / scale };
    }
    function getVisibleChunkCoords() {
        const view = getVisibleRect();
        const CHUNK_PIXEL_SIZE = CHUNK_SIZE * PIXEL_SIZE;
        const startCX = Math.max(0, Math.floor(view.x1 / CHUNK_PIXEL_SIZE)), endCX = Math.min(Math.ceil(WORLD_WIDTH_IN_TILES / CHUNK_SIZE), Math.ceil(view.x2 / CHUNK_PIXEL_SIZE));
        const startCY = Math.max(0, Math.floor(view.y1 / CHUNK_PIXEL_SIZE)), endCY = Math.min(Math.ceil(WORLD_HEIGHT_IN_TILES / CHUNK_SIZE), Math.ceil(view.y2 / CHUNK_PIXEL_SIZE));
        const coords = [];
        for (let cy = startCY; cy < endCY; cy++) { for (let cx = startCX; cx < endCX; cx++) { coords.push({ key: `${cx},${cy}`, x: cx * CHUNK_PIXEL_SIZE, y: cy * CHUNK_PIXEL_SIZE }); } }
        return { data: coords, size: CHUNK_PIXEL_SIZE };
    }
    
    // --- 7. EVENT HANDLING & UI ---
    function setupEventListeners() {
        stage.on('dragstart', () => tooltip.style.display = 'none');
        stage.on('dragend', drawVisibleWorld);
        stage.on('wheel', (e) => {
            tooltip.style.display = 'none';
            e.evt.preventDefault();
            const scaleBy = 1.1;
            const oldScale = stage.scaleX();
            const pointer = stage.getPointerPosition();
            const mousePointTo = { x: (pointer.x - stage.x()) / oldScale, y: (pointer.y - stage.y()) / oldScale };
            let newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
            newScale = Math.max(0.01, Math.min(newScale, 5));
            stage.scale({ x: newScale, y: newScale });
            const newPos = { x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale };
            stage.position(newPos);
            drawVisibleWorld();
        });

        // ===================================================
        // OPTIMISTIC UI: The updated click handler
        // ===================================================
        stage.on('click tap', async (e) => {
            if (stage.isDragging() || isRendering) return;
            const transform = stage.getAbsoluteTransform().copy().invert();
            const pos = transform.point(stage.getPointerPosition());
            const tx = Math.floor(pos.x / PIXEL_SIZE), ty = Math.floor(pos.y / PIXEL_SIZE);
            if (tx < 0 || tx >= WORLD_WIDTH_IN_TILES || ty < 0 || ty >= WORLD_HEIGHT_IN_TILES) return;
            
            const cx = Math.floor(tx / CHUNK_SIZE), cy = Math.floor(ty / CHUNK_SIZE);
            const chunkKey = `${cx},${cy}`;
            const chunkData = await getChunkData(chunkKey); // Still need to get current data
            const newTileId = colorToTileIdMap.get(currentColor);

            if (chunkData[ty % CHUNK_SIZE][tx % CHUNK_SIZE] !== newTileId) {
                // --- STEP 1: Perform all local changes instantly ---
                setMapStatus('Painting...', '#f1c40f');
                chunkData[ty % CHUNK_SIZE][tx % CHUNK_SIZE] = newTileId;
                chunkCache.set(chunkKey, chunkData);
                chunkImageCache.remove(chunkKey);

                // Re-render the chunk visually right away
                const oldImage = mapLayer.findOne(`[chunkKey="${chunkKey}"]`);
                const CHUNK_PIXEL_SIZE = CHUNK_SIZE * PIXEL_SIZE;
                const chunkMeta = oldImage 
                    ? { key: chunkKey, x: oldImage.x(), y: oldImage.y() }
                    : { key: chunkKey, x: cx * CHUNK_PIXEL_SIZE, y: cy * CHUNK_PIXEL_SIZE };
                if (oldImage) oldImage.destroy();
                
                // We must await the render, but it's local and fast
                const newImage = await renderChunkToImage(chunkMeta);
                if (newImage) {
                    chunkImageCache.set(chunkKey, newImage);
                    mapLayer.add(newImage);
                }
                
                // Update the minimap visually right away
                updateMinimapChunk_VisualOnly(cx, cy, chunkData);
                mapLayer.batchDraw();
                setMapStatus('Idle', '#2ecc71');

                // --- STEP 2: Send all server saves in the background ---
                // We don't `await` these. We fire them off and forget.
                saveChunkData(chunkKey, chunkData)
                    .then(() => console.log(`Chunk ${chunkKey} saved.`))
                    .catch(err => console.error(`Failed to save chunk ${chunkKey}:`, err));
                
                updateMinimapChunk_ServerSave()
                    .then(() => console.log(`Minimap updated on server.`))
                    .catch(err => console.error(`Failed to save minimap:`, err));
            }
        });

        stage.on('mousemove', async (e) => {
            if (!e.evt.altKey) { tooltip.style.display = 'none'; lastTooltipCoord = ''; return; }
            const transform = stage.getAbsoluteTransform().copy().invert();
            const pos = transform.point(stage.getPointerPosition());
            const tx = Math.floor(pos.x / PIXEL_SIZE), ty = Math.floor(pos.y / PIXEL_SIZE);
            const currentCoordKey = `${tx},${ty}`;
            if (currentCoordKey === lastTooltipCoord) return;
            lastTooltipCoord = currentCoordKey;
            if (tx < 0 || tx >= WORLD_WIDTH_IN_TILES || ty < 0 || ty >= WORLD_HEIGHT_IN_TILES) { tooltip.style.display = 'none'; return; }
            const cx = Math.floor(tx / CHUNK_SIZE), cy = Math.floor(ty / CHUNK_SIZE);
            const chunkData = await getChunkData(`${cx},${cy}`);
            const tileId = chunkData[ty % CHUNK_SIZE][tx % CHUNK_SIZE];
            const tileInfo = tileLegend[tileId] || {name: 'Unknown Tile'};
            tooltip.style.display = 'block';
            tooltip.innerHTML = `Tile: <strong>${tileInfo.name}</strong><br>Coords: X: ${tx}, Y: ${ty}`;
            tooltip.style.left = `${e.evt.clientX + 15}px`;
            tooltip.style.top = `${e.evt.clientY + 15}px`;
        });

        stage.on('mouseleave', () => tooltip.style.display = 'none');
        window.addEventListener('keyup', (e) => { if (e.key === 'Alt') { tooltip.style.display = 'none'; lastTooltipCoord = ''; }});
        window.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'm') minimapContainerEl.classList.toggle('hidden'); });
        
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                const container = document.getElementById('map-container');
                if (stage && container) {
                    stage.width(container.clientWidth);
                    stage.height(container.clientHeight);
                    drawVisibleWorld();
                }
            }, 250);
        });
    }

    function setMapStatus(text, color) { const el = document.getElementById('map-status'); if(el) {el.textContent = text; el.style.color = color;} }
    function createUIPalette() {
        const paletteContainer = document.getElementById('map-palette');
        Object.values(tileLegend).forEach((tile) => {
            const colorBox = document.createElement('div');
            colorBox.className = 'color-box'; colorBox.style.backgroundColor = tile.color;
            colorBox.dataset.color = tile.color;
            colorBox.addEventListener('click', () => {
                currentColor = tile.color;
                paletteContainer.querySelectorAll('.color-box').forEach(box => box.classList.remove('selected'));
                colorBox.classList.add('selected');
            });
            paletteContainer.appendChild(colorBox);
        });
        paletteContainer.querySelector(`[data-color="${currentColor}"]`).classList.add('selected');
    }

    // --- 8. MINIMAP LOGIC ---
    async function setupMinimap() {
        minimapStage = new Konva.Stage({ container: 'minimap', width: MINIMAP_DISPLAY_SIZE, height: MINIMAP_DISPLAY_SIZE });
        minimapLayer = new Konva.Layer();
        minimapStage.add(minimapLayer);
        await drawMinimapBackground();
        minimapViewportRect = new Konva.Rect({ stroke: '#fff', strokeWidth: 2, listening: false });
        minimapLayer.add(minimapViewportRect);
        minimapLayer.draw();
        const navigate = () => {
            const pos = minimapStage.getPointerPosition();
            const scale = MINIMAP_DISPLAY_SIZE / (WORLD_WIDTH_IN_TILES * PIXEL_SIZE);
            const worldX = pos.x / scale, worldY = pos.y / scale;
            const newStagePos = { x: -worldX * stage.scaleX() + stage.width() / 2, y: -worldY * stage.scaleY() + stage.height() / 2 };
            stage.position(newStagePos);
            drawVisibleWorld();
        };
        minimapStage.on('click tap', navigate);
        minimapStage.on('dragstart', () => minimapStage.startDrag());
        minimapStage.on('dragmove', navigate);
    }
    
    async function drawMinimapBackground() {
        setMapStatus('Minimap...', '#f1c40f');
        const response = await fetch(API_URL_MINIMAP);
        const cachedImageURL = await response.text();
        if (cachedImageURL) {
            minimapImage = await createKonvaImageFromURL(cachedImageURL);
            minimapImage.setAttrs({ width: MINIMAP_DISPLAY_SIZE, height: MINIMAP_DISPLAY_SIZE, listening: false, zIndex: 0 });
            minimapLayer.add(minimapImage);
            minimapLayer.batchDraw();
            setMapStatus('Idle', '#2ecc71');
        } else {
            console.error("Minimap has not been seeded. Please run the local 'admin-generate-minimap.html' tool.");
            setMapStatus('Error: Minimap not found', '#e74c3c');
            const minimapContainer = document.getElementById('minimap');
            if (minimapContainer) {
                minimapContainer.innerHTML = '<p class="placeholder-text" style="padding: 20px;">Minimap not generated.<br>Run generation tool.</p>';
            }
        }
    }

    function updateMinimapViewport() {
        if (!minimapStage || !stage) return;
        const view = getVisibleRect();
        const worldTotalWidth = WORLD_WIDTH_IN_TILES * PIXEL_SIZE;
        const worldTotalHeight = WORLD_HEIGHT_IN_TILES * PIXEL_SIZE;
        const rectX = (view.x1 / worldTotalWidth) * MINIMAP_DISPLAY_SIZE;
        const rectY = (view.y1 / worldTotalHeight) * MINIMAP_DISPLAY_SIZE;
        const rectWidth = ((view.x2 - view.x1) / worldTotalWidth) * MINIMAP_DISPLAY_SIZE;
        const rectHeight = ((view.y2 - view.y1) / worldTotalHeight) * MINIMAP_DISPLAY_SIZE;
        minimapViewportRect.setAttrs({ x: rectX, y: rectY, width: rectWidth, height: rectHeight, strokeWidth: 2 / minimapStage.scaleX() });
        minimapLayer.batchDraw();
    }
    
    // --- OPTIMISTIC UI: Split minimap update into two parts ---
    function updateMinimapChunk_VisualOnly(cx, cy, chunkData) {
        if (!minimapImage) return;
        const canvas = minimapImage.image();
        const context = canvas.getContext('2d');
        context.fillStyle = calculateChunkAverageColor(chunkData);
        context.fillRect(cx, cy, 1, 1);
        minimapLayer.batchDraw();
    }
    
    async function updateMinimapChunk_ServerSave() {
        if (!minimapImage) return;
        const dataURL = minimapImage.image().toDataURL('image/jpeg', 0.9);
        return fetch(API_URL_MINIMAP, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: dataURL
        });
    }

    function hexToRgb(hex) { const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex); return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : {r:0,g:0,b:0}; }
    function rgbToHex(r, g, b) { return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).padStart(6, '0'); }
    function calculateChunkAverageColor(chunkData) {
        let totalR = 0, totalG = 0, totalB = 0;
        const numTiles = CHUNK_SIZE * CHUNK_SIZE;
        for (let y = 0; y < CHUNK_SIZE; y++) { for (let x = 0; x < CHUNK_SIZE; x++) { const tileId = chunkData[y][x]; const color = tileLegend[tileId]?.color || tileLegend[0].color; const rgb = hexToRgb(color); totalR += rgb.r; totalG += rgb.g; totalB += rgb.b; } }
        return `rgb(${Math.round(totalR / numTiles)}, ${Math.round(totalG / numTiles)}, ${Math.round(totalB / numTiles)})`;
    }
    
    mapTabButton.addEventListener('click', initializeMap, { once: true });
});
