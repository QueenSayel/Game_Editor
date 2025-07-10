document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURATION ---
    const API_URL_NPCS = '/.netlify/functions/npcs';
    const API_URL_CLASS_RACE = '/.netlify/functions/class_race';
    const AFFINITY_OPTIONS = ["None", "Frost", "Fire", "Lightning", "Water", "Divine", "Chaos"];

    // --- STATE MANAGEMENT ---
    let allNpcs = [];
    let classRaceData = { races: [], classes: [] };
    let allItems = [];
    let selectedNpcId = null;
    let localUnsavedChanges = false;

    // --- DOM ELEMENTS ---
    const npcListContainer = document.getElementById('npc-list');
    const npcForm = document.getElementById('npc-form');
    const addNewNpcBtn = document.getElementById('add-new-npc-btn');
    const deleteNpcBtn = document.getElementById('delete-npc-btn');
    const inventoryListDiv = document.getElementById('npc-inventory-list');
    const inventoryAddSelect = document.getElementById('npc-inventory-add-select');
    const inventoryAddQty = document.getElementById('npc-inventory-add-qty');
    const inventoryAddBtn = document.getElementById('npc-inventory-add-btn');

    const formFields = {
        id: document.getElementById('npcId'), name: document.getElementById('npcName'),
        race: document.getElementById('npcRace'), class: document.getElementById('npcClass'),
        str: document.getElementById('npcStatStr'), intel: document.getElementById('npcStatInt'),
        wis: document.getElementById('npcStatWis'), agi: document.getElementById('npcStatAgi'),
        dex: document.getElementById('npcStatDex'), cha: document.getElementById('npcStatCha'),
        affinity: document.getElementById('npcAffinity'),
    };

    // --- DATA HANDLING ---
    const loadNpcs = async () => {
        const response = await fetch(API_URL_NPCS);
        if (!response.ok) throw new Error('Failed to fetch NPCs.');
        let loadedNpcs = await response.json();
        
        loadedNpcs.forEach(npc => {
            if (npc.inventory && npc.inventory.length > 0 && typeof npc.inventory[0] === 'string') {
                npc.inventory = npc.inventory.map(itemId => ({ id: itemId, quantity: 1 }));
            }
        });
        allNpcs = loadedNpcs;
    };
    const loadClassRaceData = async () => {
        const response = await fetch(API_URL_CLASS_RACE);
        if (!response.ok) throw new Error('Failed to fetch class/race data.');
        classRaceData = await response.json();
    };
    const saveNpcs = async () => {
        const response = await fetch(API_URL_NPCS, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(allNpcs, null, 2)
        });
        if (!response.ok) throw new Error('Failed to save NPCs.');
    };

    // --- UI RENDERING & MANAGEMENT ---
    const setUnsaved = () => {
        localUnsavedChanges = true;
        window.App.DataManager.setUnsavedChanges(true);
    };

    const notifyNpcDataChanged = () => {
        document.dispatchEvent(new CustomEvent('npcDataChanged'));
    };
    
    const renderNpcList = () => {
        const sortedNpcs = [...allNpcs].sort((a, b) => a.name.localeCompare(b.name));
        npcListContainer.innerHTML = '';
        if (sortedNpcs.length === 0) {
            npcListContainer.innerHTML = '<p class="placeholder-text">No NPCs found. Add one!</p>';
            return;
        }
        sortedNpcs.forEach(npc => {
            const el = document.createElement('button');
            el.className = 'list-item';
            el.textContent = npc.name || 'New NPC';
            el.dataset.id = npc.id;
            if (npc.id === selectedNpcId) el.classList.add('selected');
            el.addEventListener('click', () => selectNpc(npc.id));
            npcListContainer.appendChild(el);
        });
    };
    const populateDropdown = (selectEl, options, placeholder) => {
        selectEl.innerHTML = `<option value="">-- ${placeholder} --</option>`;
        options.forEach(opt => selectEl.add(new Option(opt.text, opt.value)));
    };
    
    // UPDATED: This function will now be called only after item data is ready.
    const initializeItemDependentUI = () => {
        allItems = window.App.Items.getAllItems();
        populateInventoryItemDropdown();
        // If an NPC is already selected, re-render its form to show correct item names
        if (selectedNpcId) {
            const currentNpc = allNpcs.find(n => n.id === selectedNpcId);
            populateForm(currentNpc);
        }
    };

    const populateInventoryItemDropdown = () => {
        const sortedItems = [...allItems].sort((a,b) => a.name.localeCompare(b.name));
        inventoryAddSelect.innerHTML = '<option value="">-- Select an Item --</option>';
        sortedItems.forEach(item => {
            if (!item.id || item.id.startsWith('temp_')) return; // Don't add unsaved items
            const displayText = `${item.name} [${item.id}]`;
            inventoryAddSelect.add(new Option(displayText, item.id));
        });
    };
    
    const renderInventoryList = (inventory = []) => {
        inventoryListDiv.innerHTML = '';
        if (inventory.length === 0) {
            inventoryListDiv.innerHTML = '<p class="placeholder-text" style="padding: 5px 0;">Empty Inventory</p>';
            return;
        }
        inventory.forEach((inventoryItem, index) => {
            const item = allItems.find(i => i.id === inventoryItem.id);
            const itemEl = document.createElement('div');
            itemEl.className = 'inventory-item';
            itemEl.innerHTML = `
                <span class="inventory-item-name" title="${item ? `${item.name} [${inventoryItem.id}]` : 'Unknown'}">${item ? `${item.name} [${inventoryItem.id}]` : `(Unknown Item: ${inventoryItem.id})`}</span>
                <input type="number" class="inventory-item-qty-editor" value="${inventoryItem.quantity}" min="1" data-index="${index}">
                <button type="button" data-index="${index}" class="remove-inventory-item-btn" title="Remove Item">×</button>
            `;
            inventoryListDiv.appendChild(itemEl);
        });
        
        document.querySelectorAll('.remove-inventory-item-btn').forEach(btn => {
            btn.addEventListener('click', (e) => removeInventoryItem(parseInt(e.target.dataset.index, 10)));
        });
        document.querySelectorAll('.inventory-item-qty-editor').forEach(input => {
            input.addEventListener('change', (e) => {
                const index = parseInt(e.target.dataset.index, 10);
                const newQuantity = parseInt(e.target.value, 10);
                updateInventoryItemQuantity(index, newQuantity, e.target);
            });
        });
    };

    const populateForm = (npc) => {
        npcForm.style.visibility = npc ? 'visible' : 'hidden';
        deleteNpcBtn.style.visibility = npc ? 'visible' : 'hidden';
        if (!npc) return;
        formFields.id.value = npc.id.startsWith('temp_') ? '' : npc.id;
        formFields.name.value = npc.name;
        formFields.race.value = npc.race || '';
        formFields.class.value = npc.class || '';
        formFields.str.value = npc.stats.strength;
        formFields.intel.value = npc.stats.intelligence;
        formFields.wis.value = npc.stats.wisdom;
        formFields.agi.value = npc.stats.agility;
        formFields.dex.value = npc.stats.dexterity;
        formFields.cha.value = npc.stats.charisma;
        formFields.affinity.value = npc.affinity;
        renderInventoryList(npc.inventory);
    };

    // --- ACTIONS & EVENT HANDLERS ---
    const generateUniqueId = (name, currentIdToIgnore = null) => {
        const baseId = 'npc_' + name.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        if (!allNpcs.some(n => n.id === baseId && n.id !== currentIdToIgnore)) return baseId;
        let counter = 1;
        while (true) {
            let newId = `${baseId}_${String(counter).padStart(2, '0')}`;
            if (!allNpcs.some(n => n.id === newId && n.id !== currentIdToIgnore)) return newId;
            counter++;
        }
    };
    const selectNpc = (id) => {
        selectedNpcId = id;
        populateForm(allNpcs.find(n => n.id === id));
        renderNpcList();
    };
    
    const selectNpcById = (npcId) => {
        const npcTabButton = document.querySelector('button[data-tab="npcs"]');
        if (npcTabButton && !npcTabButton.classList.contains('active')) {
            npcTabButton.click();
        }
        selectNpc(npcId);
    };

    const deleteSelectedNpc = () => {
        if (!selectedNpcId || !confirm('Are you sure you want to delete this NPC?')) return;
        allNpcs = allNpcs.filter(n => n.id !== selectedNpcId);
        selectedNpcId = null;
        populateForm(null);
        renderNpcList();
        setUnsaved();
        notifyNpcDataChanged();
    };
    const handleFormChange = (event) => {
        if (!selectedNpcId) return;
        const npcIndex = allNpcs.findIndex(n => n.id === selectedNpcId);
        if (npcIndex === -1) return;
        const newName = formFields.name.value;
        let newId = selectedNpcId;
        if (event && event.target.id === 'npcName' && newName.trim() !== '') {
            newId = generateUniqueId(newName, selectedNpcId);
            if (newId !== selectedNpcId) selectedNpcId = newId;
        }
        allNpcs[npcIndex] = { ...allNpcs[npcIndex], id: newId, name: newName, race: formFields.race.value, class: formFields.class.value, affinity: formFields.affinity.value, stats: { strength: parseInt(formFields.str.value, 10) || 0, intelligence: parseInt(formFields.intel.value, 10) || 0, wisdom: parseInt(formFields.wis.value, 10) || 0, agility: parseInt(formFields.agi.value, 10) || 0, dexterity: parseInt(formFields.dex.value, 10) || 0, charisma: parseInt(formFields.cha.value, 10) || 0, } };
        setUnsaved();
        renderNpcList();
        notifyNpcDataChanged();
        formFields.id.value = newId.startsWith('temp_') ? '' : newId;
    };
    const addNewNpc = () => {
        const tempId = `temp_${Date.now()}`;
        const newNpc = { id: tempId, name: "", race: classRaceData.races[0] || "", class: classRaceData.classes[0] || "", affinity: "None", stats: { strength: 10, intelligence: 10, wisdom: 10, agility: 10, dexterity: 10, charisma: 10 }, inventory: [] };
        allNpcs.push(newNpc);
        selectNpc(newNpc.id);
        formFields.name.focus();
        setUnsaved();
    };
    const addInventoryItem = () => {
        if (!selectedNpcId) return;
        const npcIndex = allNpcs.findIndex(n => n.id === selectedNpcId);
        if (npcIndex === -1) return;
        const itemId = inventoryAddSelect.value;
        const quantity = parseInt(inventoryAddQty.value, 10);
        if (!itemId || !quantity || quantity < 1) {
            alert("Please select an item and enter a valid quantity (1 or more).");
            return;
        }
        const npc = allNpcs[npcIndex];
        if (!npc.inventory) npc.inventory = [];
        const existingItem = npc.inventory.find(invItem => invItem.id === itemId);
        if (existingItem) {
            existingItem.quantity += quantity;
        } else {
            npc.inventory.push({ id: itemId, quantity: quantity });
        }
        renderInventoryList(npc.inventory);
        setUnsaved();
        notifyNpcDataChanged();
        inventoryAddSelect.value = '';
        inventoryAddQty.value = '1';
    };
    const removeInventoryItem = (index) => {
        if (!selectedNpcId) return;
        const npcIndex = allNpcs.findIndex(n => n.id === selectedNpcId);
        if (npcIndex === -1) return;
        allNpcs[npcIndex].inventory.splice(index, 1);
        renderInventoryList(allNpcs[npcIndex].inventory);
        setUnsaved();
        notifyNpcDataChanged();
    };
    const updateInventoryItemQuantity = (index, newQuantity, inputElement) => {
        if (!selectedNpcId) return;
        const npcIndex = allNpcs.findIndex(n => n.id === selectedNpcId);
        if (npcIndex === -1) return;
        if (isNaN(newQuantity) || newQuantity < 1) {
            newQuantity = 1;
            inputElement.value = newQuantity;
        }
        allNpcs[npcIndex].inventory[index].quantity = newQuantity;
        setUnsaved();
        notifyNpcDataChanged();
    };

    // --- INITIALIZATION ---
    const initializeEditor = async () => {
        try {
            // Register the module object immediately
            window.App.Npcs = {
                save: async () => {
                    if (allNpcs.some(n => n.id.startsWith('temp_'))) {
                        throw new Error("Cannot save NPCs. Please provide a name for all new NPCs first.");
                    }
                    await saveNpcs();
                    localUnsavedChanges = false;
                },
                hasUnsavedChanges: () => localUnsavedChanges,
                getAllNpcs: () => allNpcs,
                selectNpcById: selectNpcById
            };

            await Promise.all([loadClassRaceData(), loadNpcs()]);
            
            // Populate UI that does not depend on items
            populateDropdown(formFields.race, classRaceData.races.map(r => ({text: r, value: r})), 'Select Race');
            populateDropdown(formFields.class, classRaceData.classes.map(c => ({text: c, value: c})), 'Select Class');
            populateDropdown(formFields.affinity, AFFINITY_OPTIONS.map(a => ({text: a, value: a})), 'Select Affinity');
            renderNpcList();
            populateForm(null);

            // UPDATED: Now wait for the items module to be fully ready.
            if (window.App.Items?.isReady) {
                initializeItemDependentUI();
            } else {
                document.addEventListener('itemsDataLoaded', initializeItemDependentUI, { once: true });
            }

            npcForm.addEventListener('input', handleFormChange);
            addNewNpcBtn.addEventListener('click', addNewNpc);
            deleteNpcBtn.addEventListener('click', deleteSelectedNpc);
            inventoryAddBtn.addEventListener('click', addInventoryItem);
            
            console.log("NPCs module initialized.");
			document.dispatchEvent(new CustomEvent('npcsDataLoaded'));
        } catch (error) {
            console.error('NPCs Initialization failed:', error);
            alert(`Failed to initialize the NPC editor.\n\nError: ${error.message}`);
        }
    };
    
    initializeEditor();
});
