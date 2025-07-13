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

    const tileLegend = {
        0: { name: 'Deep Water', color: '#2980b9' }, 1: { name: 'Water', color: '#3498db' },
        2: { name: 'Sand', color: '#f1c40f' }, 3: { name: 'Grass', color: '#2ecc71' },
        4: { name: 'Forest', color: '#16a085' }, 5: { name: 'Rock', color: '#95a5a6' },
        6: { name: 'Player Red', color: '#e74c3c' },
    };
    const colorToTileIdMap = new Map();
    for (const id in tileLegend) { colorToTileIdMap.set(tileLegend[id].color, parseInt(id)); }
    let currentColor = tileLegend[3].color;

    // --- 2. HELPERS (LRU CACHE ONLY) ---
    class LRUCache {
        constructor(maxSize) { this.maxSize = maxSize; this.cache = new Map(); }
        get(key) {
            if (!this.cache.has(key)) return undefined;
            const item = this.cache.get(key); this.cache.delete(key); this.cache.set(key, item); return item;
        }
        set(key, value) {
            if (this.cache.has(key)) this.cache.delete(key);
            else if (this.cache.size >= this.maxSize) { this.cache.delete(this.cache.keys().next().value); }
            this.cache.set(key, value);
        }
        remove(key) { this.cache.delete(key); }
        has(key) { return this.cache.has(key); }
    }

    // --- 3. APPLICATION STATE & SETUP ---
    const chunkCache = new LRUCache(CACHE_SIZE);
    const chunkImageCache = new LRUCache(IMAGE_CACHE_SIZE);

    let stage, mapLayer, gridLayer;
    let tooltip, minimapContainerEl;
    let isRendering = false;
    let lastTooltipCoord = '';

    let minimapStage, minimapLayer, minimapViewportRect, minimapImage;

    const initializeMap = async () => {
        if (isMapInitialized) return;
        isMapInitialized = true;
        console.log("Initializing Map Module with Server-Side Storage...");

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

    // --- 4. DATA MANAGEMENT & LAZY GENERATION (SERVER-SIDE) ---
    async function getChunkData(coordKey) {
        if (chunkCache.has(coordKey)) return chunkCache.get(coordKey);
        
        const response = await fetch(`${API_URL_CHUNK}?coord=${coordKey}`);
        if (!response.ok) throw new Error(`Failed to fetch chunk ${coordKey}`);
        let data = await response.json();

        if (data) {
            chunkCache.set(coordKey, data);
            return data;
        }

        // If no data from server, generate default and return (don't save yet)
        data = generateChunk();
        chunkCache.set(coordKey, data);
        return data;
    }

    function generateChunk() {
        const chunk = [];
        const defaultTileId = 0;
        for (let y = 0; y < CHUNK_SIZE; y++) {
            chunk.push(new Array(CHUNK_SIZE).fill(defaultTileId));
        }
        return chunk;
    }

    async function saveChunkData(coordKey, data) {
        await fetch(API_URL_CHUNK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ coord: coordKey, data: data })
        });
    }
    
    function createKonvaImageFromURL(url) {
        return new Promise((resolve) => Konva.Image.fromURL(url, resolve));
    }

    // --- 5. RENDERER (Largely unchanged) ---
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
                context.fillStyle = tileLegend[tileId].color;
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
        const scaledPixelSize = PIXEL_SIZE * scale;
        if (scaledPixelSize < 5) { gridLayer.batchDraw(); return; }
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

    // --- 6. HELPERS (Unchanged) ---
    function getVisibleRect() {
        const scale = stage.scaleX();
        const pos = stage.position();
        return {
            x1: -pos.x / scale, y1: -pos.y / scale,
            x2: (-pos.x + stage.width()) / scale, y2: (-pos.y + stage.height()) / scale
        };
    }
    function getVisibleChunkCoords() {
        const view = getVisibleRect();
        const CHUNK_PIXEL_SIZE = CHUNK_SIZE * PIXEL_SIZE;
        const startCX = Math.max(0, Math.floor(view.x1 / CHUNK_PIXEL_SIZE));
        const endCX = Math.min(Math.ceil(WORLD_WIDTH_IN_TILES / CHUNK_SIZE), Math.ceil(view.x2 / CHUNK_PIXEL_SIZE));
        const startCY = Math.max(0, Math.floor(view.y1 / CHUNK_PIXEL_SIZE));
        const endCY = Math.min(Math.ceil(WORLD_HEIGHT_IN_TILES / CHUNK_SIZE), Math.ceil(view.y2 / CHUNK_PIXEL_SIZE));
        const coords = [];
        for (let cy = startCY; cy < endCY; cy++) {
            for (let cx = startCX; cx < endCX; cx++) {
                coords.push({ key: `${cx},${cy}`, x: cx * CHUNK_PIXEL_SIZE, y: cy * CHUNK_PIXEL_SIZE });
            }
        }
        return { data: coords, size: CHUNK_PIXEL_SIZE };
    }
    
    // --- 7. EVENT HANDLING & UI (Updated save logic) ---
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

        stage.on('click tap', async (e) => {
            if (stage.isDragging() || isRendering) return;
            const transform = stage.getAbsoluteTransform().copy().invert();
            const pos = transform.point(stage.getPointerPosition());
            const tx = Math.floor(pos.x / PIXEL_SIZE), ty = Math.floor(pos.y / PIXEL_SIZE);
            if (tx < 0 || tx >= WORLD_WIDTH_IN_TILES || ty < 0 || ty >= WORLD_HEIGHT_IN_TILES) return;
            
            setMapStatus('Saving...', '#f39c12');
            const cx = Math.floor(tx / CHUNK_SIZE), cy = Math.floor(ty / CHUNK_SIZE);
            const chunkKey = `${cx},${cy}`;
            const chunkData = await getChunkData(chunkKey);
            const newTileId = colorToTileIdMap.get(currentColor);

            if (chunkData[ty % CHUNK_SIZE][tx % CHUNK_SIZE] !== newTileId) {
                chunkData[ty % CHUNK_SIZE][tx % CHUNK_SIZE] = newTileId;
                
                // Save to server
                await saveChunkData(chunkKey, chunkData);

                // Update caches
                chunkCache.set(chunkKey, chunkData);
                chunkImageCache.remove(chunkKey);

                // Re-render chunk
                const oldImage = mapLayer.findOne(`[chunkKey="${chunkKey}"]`);
                const CHUNK_PIXEL_SIZE = CHUNK_SIZE * PIXEL_SIZE;
                const chunkMeta = oldImage 
                    ? { key: chunkKey, x: oldImage.x(), y: oldImage.y() }
                    : { key: chunkKey, x: cx * CHUNK_PIXEL_SIZE, y: cy * CHUNK_PIXEL_SIZE };
                if (oldImage) oldImage.destroy();
                
                const newImage = await renderChunkToImage(chunkMeta);
                if (newImage) {
                    chunkImageCache.set(chunkKey, newImage);
                    mapLayer.add(newImage);
                }
                
                await updateMinimapChunk(cx, cy, chunkData);
                mapLayer.batchDraw();
            }
            setMapStatus('Idle', '#2ecc71');
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
            tooltip.style.display = 'block';
            tooltip.innerHTML = `Tile: <strong>${tileLegend[tileId].name}</strong><br>Coords: X: ${tx}, Y: ${ty}`;
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

    // --- 8. MINIMAP LOGIC (Updated save logic) ---
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
        } else {
            console.log("Generating new shared minimap image (this may take a moment)...");
            const offscreenCanvas = document.createElement('canvas');
            offscreenCanvas.width = MINIMAP_WIDTH_CHUNKS;
            offscreenCanvas.height = MINIMAP_HEIGHT_CHUNKS;
            const context = offscreenCanvas.getContext('2d');
            for (let cy = 0; cy < MINIMAP_HEIGHT_CHUNKS; cy++) {
                for (let cx = 0; cx < MINIMAP_WIDTH_CHUNKS; cx++) {
                    const chunkData = await getChunkData(`${cx},${cy}`);
                    context.fillStyle = calculateChunkAverageColor(chunkData);
                    context.fillRect(cx, cy, 1, 1);
                }
            }
            const dataURL = offscreenCanvas.toDataURL();
            await fetch(API_URL_MINIMAP, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: dataURL });
            minimapImage = await createKonvaImageFromURL(dataURL);
            console.log("Minimap image generated and cached on server.");
        }
        minimapImage.setAttrs({ width: MINIMAP_DISPLAY_SIZE, height: MINIMAP_DISPLAY_SIZE, listening: false, zIndex: 0 });
        minimapLayer.add(minimapImage);
        minimapLayer.batchDraw();
        setMapStatus('Idle', '#2ecc71');
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
    
    async function updateMinimapChunk(cx, cy, chunkData) {
        if (!minimapImage) return;
        const canvas = minimapImage.image();
        const context = canvas.getContext('2d');
        context.fillStyle = calculateChunkAverageColor(chunkData);
        context.fillRect(cx, cy, 1, 1);
        const dataURL = canvas.toDataURL();
        await fetch(API_URL_MINIMAP, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: dataURL });
        minimapLayer.batchDraw();
    }

    // --- Color Helpers (Unchanged) ---
    function hexToRgb(hex) { const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex); return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null; }
    function rgbToHex(r, g, b) { return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).padStart(6, '0'); }
    function calculateChunkAverageColor(chunkData) {
        let totalR = 0, totalG = 0, totalB = 0;
        const numTiles = CHUNK_SIZE * CHUNK_SIZE;
        for (let y = 0; y < CHUNK_SIZE; y++) { for (let x = 0; x < CHUNK_SIZE; x++) { const tileId = chunkData[y][x]; const rgb = hexToRgb(tileLegend[tileId].color); totalR += rgb.r; totalG += rgb.g; totalB += rgb.b; } }
        return rgbToHex(Math.round(totalR / numTiles), Math.round(totalG / numTiles), Math.round(totalB / numTiles));
    }
    
    mapTabButton.addEventListener('click', initializeMap, { once: true });
});
